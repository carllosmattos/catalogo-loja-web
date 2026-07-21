/** Regras de cupom de frete + Uber (estimativa só no admin, após/no envio). */

export function isShippingCoupon(coupon: {
  ok?: boolean;
  discount_target?: string;
} | null | undefined): boolean {
  return Boolean(coupon?.ok && coupon.discount_target === "shipping");
}

/** Aviso suave na loja: custo do Uber é da loja; cliente não estima. */
export const UBER_SHIPPING_COUPON_HINT =
  "Cupom de frete no Uber: você não paga frete no site. A loja combina e banca a corrida (total ou parcial, conforme o cupom).";

/** Aviso no admin: lançar custo real depois. */
export const UBER_ADMIN_FREIGHT_HINT =
  "Uber + cupom de frete: a cliente não estima. No envio, lance em “Frete real pago pela loja” o valor que a loja bancou (integral ou parcial).";
