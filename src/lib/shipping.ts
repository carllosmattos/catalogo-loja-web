import type { ShippingQuote } from "@/types";
import { addressFieldsFromCustomer, type AddressFields } from "@/lib/address";
import {
  getValidMelhorEnvioAccessToken,
  melhorEnvioUserAgent,
} from "@/lib/melhor-envio";
import { createClient } from "@/lib/supabase/server";

export interface MelhorEnvioQuote {
  amount: number;
  deliveryDays: number | null;
  deliveryRange: string | null;
  company: string | null;
  service: string | null;
}

export async function resolveShippingZone(
  address: AddressFields
): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("resolve_shipping_zone", {
    p_country: "BR",
    p_state: (address.state || "").toUpperCase(),
    p_city: address.city || "",
    p_neighborhood: address.neighborhood || "",
  });
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) || {};
  return (data as Record<string, unknown>) || { zone_type: "none", freight_amount: 0 };
}

function parseDeliveryDays(option: Record<string, unknown>): number | null {
  const raw =
    option.custom_delivery_time ??
    option.delivery_time ??
    option.delivery_range ??
    null;
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  const text = String(raw);
  const nums = text.match(/\d+/g)?.map(Number) || [];
  if (!nums.length) return null;
  return Math.max(...nums);
}

function formatDeliveryRange(days: number | null, option: Record<string, unknown>): string | null {
  const custom =
    option.custom_delivery_time != null
      ? String(option.custom_delivery_time)
      : option.delivery_range != null
        ? String(option.delivery_range)
        : null;
  if (custom && /dia/i.test(custom)) return custom;
  if (days == null) return null;
  if (days <= 0) return "mesmo dia";
  if (days === 1) return "1 dia útil";
  return `${days} dias úteis`;
}

export async function quoteMelhorEnvio(params: {
  fromPostal: string;
  toPostal: string;
  weightKg: number;
  insuranceValue: number;
}): Promise<MelhorEnvioQuote | null> {
  const token = await getValidMelhorEnvioAccessToken();
  if (!token) return null;

  const fromZip = params.fromPostal.replace(/\D/g, "");
  const toZip = params.toPostal.replace(/\D/g, "");
  if (fromZip.length !== 8 || toZip.length !== 8) return null;

  const apiHost = (process.env.MELHOR_ENVIO_SANDBOX || "").trim() === "true"
    ? "https://sandbox.melhorenvio.com.br"
    : "https://melhorenvio.com.br";

  try {
    const res = await fetch(
      `${apiHost}/api/v2/me/shipment/calculate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": melhorEnvioUserAgent(),
        },
        body: JSON.stringify({
          from: { postal_code: fromZip },
          to: { postal_code: toZip },
          products: [
            {
              weight: Math.max(params.weightKg, 0.1),
              height: 4,
              width: 16,
              length: 20,
              insurance_value: Math.max(params.insuranceValue, 0),
              quantity: 1,
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    let best: MelhorEnvioQuote | null = null;
    for (const option of data) {
      if (!option || option.error) continue;
      const price = option.price ?? option.custom_price;
      const n = Number(price);
      if (isNaN(n)) continue;
      const deliveryDays = parseDeliveryDays(option as Record<string, unknown>);
      const company =
        (option.company && (option.company.name || option.company)) || null;
      const service = option.name ? String(option.name) : null;
      const candidate: MelhorEnvioQuote = {
        amount: n,
        deliveryDays,
        deliveryRange: formatDeliveryRange(
          deliveryDays,
          option as Record<string, unknown>
        ),
        company: company ? String(company) : null,
        service,
      };
      if (!best || candidate.amount < best.amount) best = candidate;
    }
    return best;
  } catch {
    return null;
  }
}

function fallbackFreight(lines: Array<{ sale_freight?: number }>): number {
  return lines.reduce((sum, line) => sum + Number(line.sale_freight || 0), 0);
}

/** Uber: frete não entra no site — cliente combina no WhatsApp. */
export function uberShippingQuote(): ShippingQuote {
  return {
    amount: 0,
    zone_type: "uber",
    label: "Uber — combinar no WhatsApp",
    blocked: false,
    source: "uber",
    delivery_days: null,
    delivery_range: "Combinar pelo WhatsApp",
    company: "Uber",
    service: "Solicitação pelo cliente",
  };
}

export async function calculateShipping(
  customer: Record<string, string>,
  lines: Array<{
    quantity?: number;
    sale_freight?: number;
    preco_final_line?: number;
  }>,
  settings: Record<string, unknown>,
  method: "delivery" | "uber" = "delivery"
): Promise<ShippingQuote> {
  if (method === "uber") {
    return uberShippingQuote();
  }

  const address = addressFieldsFromCustomer(customer);
  const zone = await resolveShippingZone(address);
  const zoneType = String(zone.zone_type || "none");
  const label = String(zone.label || "");

  if (zoneType === "blocked") {
    return {
      amount: 0,
      zone_type: zoneType,
      label: label || "Região indisponível para entrega",
      blocked: true,
      source: "zone",
    };
  }
  if (zoneType === "free") {
    return {
      amount: 0,
      zone_type: zoneType,
      label: label || "Frete grátis",
      blocked: false,
      source: "zone",
    };
  }
  if (zoneType === "paid") {
    return {
      amount: Number(zone.freight_amount) || 0,
      zone_type: zoneType,
      label: label || "Frete da região",
      blocked: false,
      source: "zone",
    };
  }

  if (settings.melhor_envio_enabled) {
    const pieces = lines.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    const weight = Number(settings.default_package_weight_kg) || 0.3;
    const me = await quoteMelhorEnvio({
      fromPostal: String(settings.sender_zip || ""),
      toPostal: address.zip,
      weightKg: weight * Math.max(pieces, 1),
      insuranceValue: lines.reduce(
        (s, l) => s + Number(l.preco_final_line || 0),
        0
      ),
    });
    if (me) {
      const parts = ["Melhor Envio"];
      if (me.company) parts.push(me.company);
      if (me.service) parts.push(me.service);
      return {
        amount: me.amount,
        zone_type: "quoted",
        label: parts.join(" · "),
        blocked: false,
        source: "melhor_envio",
        delivery_days: me.deliveryDays,
        delivery_range: me.deliveryRange,
        company: me.company,
        service: me.service,
      };
    }
  }

  const fallback = fallbackFreight(lines);
  return {
    amount: fallback,
    zone_type: "fallback",
    label: fallback > 0 ? "Frete do produto" : "",
    blocked: false,
    source: "product",
  };
}
