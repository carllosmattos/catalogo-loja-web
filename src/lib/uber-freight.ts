/** Regras de frete grátis + Uber (loja banca o Uber). */

export function isShippingCoupon(coupon: {
  ok?: boolean;
  discount_target?: string;
} | null | undefined): boolean {
  return Boolean(coupon?.ok && coupon.discount_target === "shipping");
}

export function uberNeedsStoreFreightEstimate(
  shippingMethod: "delivery" | "uber",
  coupon: { ok?: boolean; discount_target?: string } | null | undefined
): boolean {
  return shippingMethod === "uber" && isShippingCoupon(coupon);
}

export const UBER_FREE_SHIPPING_HINT =
  "Cupom de frete + Uber: a loja banca a corrida. Informe uma estimativa agora (entra no lucro) e ajuste o valor real depois do envio.";

export function parseUberEstimate(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}
