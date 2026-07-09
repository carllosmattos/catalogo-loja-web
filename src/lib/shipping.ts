import type { ShippingQuote } from "@/types";
import { addressFieldsFromCustomer, type AddressFields } from "@/lib/address";
import { createClient } from "@/lib/supabase/server";

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

export async function quoteMelhorEnvio(params: {
  fromPostal: string;
  toPostal: string;
  weightKg: number;
  insuranceValue: number;
}): Promise<number | null> {
  const token = (process.env.MELHOR_ENVIO_TOKEN || "").trim();
  if (!token) return null;

  const fromZip = params.fromPostal.replace(/\D/g, "");
  const toZip = params.toPostal.replace(/\D/g, "");
  if (fromZip.length !== 8 || toZip.length !== 8) return null;

  try {
    const res = await fetch(
      "https://melhorenvio.com.br/api/v2/me/shipment/calculate",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "catalogo-loja (contato@loja.local)",
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
    const prices: number[] = [];
    for (const option of data) {
      if (!option || option.error) continue;
      const price = option.price ?? option.custom_price;
      const n = Number(price);
      if (!isNaN(n)) prices.push(n);
    }
    return prices.length ? Math.min(...prices) : null;
  } catch {
    return null;
  }
}

function fallbackFreight(lines: Array<{ sale_freight?: number }>): number {
  return lines.reduce((sum, line) => sum + Number(line.sale_freight || 0), 0);
}

export async function calculateShipping(
  customer: Record<string, string>,
  lines: Array<{
    quantity?: number;
    sale_freight?: number;
    preco_final_line?: number;
  }>,
  settings: Record<string, unknown>
): Promise<ShippingQuote> {
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

  const melhorEnabled =
    Boolean(process.env.MELHOR_ENVIO_TOKEN) && Boolean(settings.melhor_envio_enabled);
  if (melhorEnabled) {
    const pieces = lines.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    const weight = Number(settings.default_package_weight_kg) || 0.3;
    const mePrice = await quoteMelhorEnvio({
      fromPostal: String(settings.sender_zip || ""),
      toPostal: address.zip,
      weightKg: weight * Math.max(pieces, 1),
      insuranceValue: lines.reduce(
        (s, l) => s + Number(l.preco_final_line || 0),
        0
      ),
    });
    if (mePrice !== null) {
      return {
        amount: mePrice,
        zone_type: "quoted",
        label: "Frete Melhor Envio",
        blocked: false,
        source: "melhor_envio",
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
