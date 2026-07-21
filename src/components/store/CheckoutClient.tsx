"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCartStore, useCustomerStore } from "@/stores";
import { buildCartMessage, buildWhatsappUrl } from "@/lib/whatsapp";
import { formatCurrency, cn } from "@/lib/utils";
import {
  UBER_SHIPPING_COUPON_HINT,
  isShippingCoupon,
} from "@/lib/uber-freight";
import type { ShippingMethod, StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";
import { Copy, Check } from "lucide-react";

interface CheckoutClientProps {
  settings: StoreSettings;
  paymentsEnabled: boolean;
}

interface ShippingState {
  amount: number;
  shipping_promo_discount?: number;
  shipping_promo_name?: string | null;
  label: string;
  blocked: boolean;
  delivery_range?: string | null;
}

export function CheckoutClient({
  settings,
  paymentsEnabled,
}: CheckoutClientProps) {
  const items = useCartStore((s) => s.items);
  const clear = useCartStore((s) => s.clear);
  const shippingMethod = useCartStore((s) => s.shippingMethod);
  const setShippingMethod = useCartStore((s) => s.setShippingMethod);
  const couponCode = useCartStore((s) => s.couponCode);
  const coupon = useCartStore((s) => s.coupon);
  const customer = useCustomerStore((s) => s.customer);
  const [loading, setLoading] = useState(false);
  const [pixResult, setPixResult] = useState<Record<string, unknown> | null>(
    null
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shipping, setShipping] = useState<ShippingState | null>(null);

  const subtotal = items.reduce(
    (s, i) => s + (Number(i.sale_price) + Number(i.sale_freight)) * i.quantity,
    0
  );

  useEffect(() => {
    if (!items.length || !customer?.id) {
      setShipping(null);
      return;
    }
    fetch("/api/shipping/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        cart: items,
        shippingMethod,
      }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || data?.error != null || typeof data?.amount !== "number") {
          setShipping(null);
          return;
        }
        setShipping({
          amount: Number(data.amount) || 0,
          shipping_promo_discount: Number(data.shipping_promo_discount) || 0,
          shipping_promo_name: data.shipping_promo_name
            ? String(data.shipping_promo_name)
            : null,
          label: String(data.label || ""),
          blocked: Boolean(data.blocked),
          delivery_range: data.delivery_range
            ? String(data.delivery_range)
            : null,
        });
      })
      .catch(() => setShipping(null));
  }, [items, customer?.id, shippingMethod]);

  const freightAfterPromo =
    shippingMethod === "uber" ? 0 : Number(shipping?.amount) || 0;
  const productDiscount =
    coupon?.ok && coupon.discount_target !== "shipping"
      ? Number(coupon.discount_amount) || 0
      : 0;
  const shippingCouponDiscount =
    coupon?.ok && coupon.discount_target === "shipping" && shippingMethod !== "uber"
      ? Math.min(Number(coupon.discount_amount) || 0, freightAfterPromo)
      : 0;
  const freightAmount = Math.max(0, freightAfterPromo - shippingCouponDiscount);
  const estimatedTotal =
    Math.max(subtotal - productDiscount, 0) + freightAmount;
  const showUberCouponHint =
    shippingMethod === "uber" && isShippingCoupon(coupon);

  async function handlePix() {
    if (!customer?.id) {
      setError("Complete seu cadastro em Minha conta.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkout/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          cart: items,
          shippingMethod,
          couponCode: coupon?.ok ? couponCode : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPixResult(data);
      clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const waMessage = buildCartMessage(
    items.map((i) => ({
      name: i.name,
      size: i.size,
      quantity: i.quantity,
      preco_final: Number(i.sale_price) + Number(i.sale_freight),
    })),
    settings.store_name,
    customer
      ? {
          name: customer.name,
          phone: customer.phone,
          cpf: customer.cpf,
          email: customer.email,
          address: customer.address,
        }
      : null,
    freightAmount,
    {
      method: shippingMethod,
      label: shipping?.label,
      deliveryRange: shipping?.delivery_range,
    }
  );
  const waUrl = settings.whatsapp_number
    ? buildWhatsappUrl(settings.whatsapp_number, waMessage)
    : null;

  if (pixResult) {
    const pixCode = String(pixResult.pix_copy_paste || "");
    return (
      <>
        <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
        <main className={STORE_MAIN}>
          <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)]">
            Pague com PIX
          </h1>
          <div className="mx-auto max-w-lg rounded-2xl bg-[var(--color-accent)] p-6 text-center md:max-w-xl md:p-8">
            <img src="/icons/pix.svg" alt="PIX" className="mx-auto h-12 w-12" />
            <p className="mt-2 text-2xl font-bold text-[var(--color-primary)]">
              {formatCurrency(Number(pixResult.total))}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Válido por 15 minutos
            </p>
            {shippingMethod === "uber" && (
              <p className="mt-2 text-xs text-gray-500">
                Entrega via Uber — combine pelo WhatsApp (frete não incluso).
              </p>
            )}
            {pixResult.delivery_range != null &&
              String(pixResult.delivery_range) !== "" && (
              <p className="mt-1 text-xs text-gray-500">
                Prazo: {String(pixResult.delivery_range)}
              </p>
            )}
            {pixCode && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-gray-500">Copia e cola:</p>
                <div className="flex items-center gap-2 rounded-lg bg-white p-3">
                  <code className="flex-1 break-all text-left text-xs">
                    {pixCode.slice(0, 80)}...
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(pixCode);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="shrink-0 rounded-full p-2 hover:bg-gray-100"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
            <Link
              href={`/pedidos/${pixResult.tracking_token}`}
              className="mt-6 inline-block rounded-full bg-[var(--color-primary)] px-6 py-3 text-sm font-semibold text-white"
            >
              Acompanhar pedido
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <div className="md:mx-auto md:max-w-xl lg:max-w-2xl">
          <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)] md:text-2xl">
            Finalizar compra
          </h1>
          {!customer && (
            <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
              <Link href="/conta" className="underline font-medium">
                Complete seu cadastro
              </Link>{" "}
              antes de finalizar.
            </p>
          )}

          {customer && items.length > 0 && (
            <div className="mb-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Entrega
              </p>
              {(
                [
                  ["delivery", "Entrega (transportadora)"],
                  ["uber", "Uber (combinar no WhatsApp)"],
                ] as [ShippingMethod, string][]
              ).map(([method, label]) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setShippingMethod(method)}
                  className={cn(
                    "w-full rounded-xl border bg-white p-3 text-left text-sm",
                    shippingMethod === method
                      ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
                      : "border-gray-100"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {showUberCouponHint && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {UBER_SHIPPING_COUPON_HINT}
            </p>
          )}

          <div className="mb-4 space-y-1 text-sm text-gray-600">
            <p>Subtotal: {formatCurrency(subtotal)}</p>
            {productDiscount > 0 && (
              <p className="text-green-700">
                Cupom {couponCode}: −{formatCurrency(productDiscount)}
              </p>
            )}
            <p>
              Frete:{" "}
              {shippingMethod === "uber"
                ? "a combinar (Uber)"
                : shipping?.blocked
                  ? "indisponível"
                  : formatCurrency(freightAmount)}
            </p>
            {(Number(shipping?.shipping_promo_discount) > 0 ||
              shippingCouponDiscount > 0) &&
              shippingMethod === "delivery" && (
                <p className="text-green-700">
                  {Number(shipping?.shipping_promo_discount) > 0 &&
                    `Promo frete: −${formatCurrency(Number(shipping?.shipping_promo_discount))}`}
                  {Number(shipping?.shipping_promo_discount) > 0 &&
                    shippingCouponDiscount > 0 &&
                    " · "}
                  {shippingCouponDiscount > 0 &&
                    `Cupom frete: −${formatCurrency(shippingCouponDiscount)}`}
                </p>
              )}
            {shippingMethod === "delivery" && shipping?.delivery_range && (
              <p>Prazo: {shipping.delivery_range}</p>
            )}
            <p className="font-semibold text-[var(--color-primary)]">
              Total estimado: {formatCurrency(estimatedTotal)}
            </p>
          </div>

          {error && (
            <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="space-y-3">
            {paymentsEnabled && (
              <button
                type="button"
                onClick={handlePix}
                disabled={
                  loading ||
                  !customer ||
                  !items.length ||
                  (shippingMethod === "delivery" && Boolean(shipping?.blocked))
                }
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] py-3.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                <img src="/icons/pix.svg" alt="" className="h-5 w-5 invert" />
                {loading ? "Gerando PIX..." : "Pagar com PIX"}
              </button>
            )}
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-[#25D366] py-3.5 text-sm font-semibold text-[#25D366]"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  aria-hidden="true"
                  fill="currentColor"
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                </svg>
                Finalizar no WhatsApp
              </a>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
