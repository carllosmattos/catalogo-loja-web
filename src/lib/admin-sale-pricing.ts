import { applyShippingPromotion, calculateProfit } from "@/lib/profit";
import type { CouponValidation, Product, Promotion } from "@/types";

export type GiftLinkLike = {
  quantity_per_sale?: number;
  gift_data?: Record<string, unknown>;
  gifts?: Record<string, unknown>;
  gift?: Record<string, unknown>;
};

export type AdminSalePricing = {
  preco_catalogo: number;
  desconto_promo: number;
  desconto_cupom_produto: number;
  desconto_total: number;
  sale_freight: number;
  freight_before_discounts: number;
  shipping_promo_discount: number;
  shipping_promo_name: string | null;
  coupon_shipping_discount: number;
  /** Frete que a loja banca (cliente não pagou) — entra no lucro como custo. */
  frete_absorvido: number;
  preco_final: number;
  lucro: number;
  promotion_id: string | null;
  promotion_name: string | null;
  coupon_code: string | null;
  coupon_title: string | null;
  gifts: Array<{ gift_id: string; gift_name: string; quantity: number }>;
};

/** Precificação de venda admin: promo vigente + frete cotado + cupom. */
export function buildAdminSalePricing(params: {
  product: Product;
  linkedGifts: GiftLinkLike[];
  promotions: Promotion[];
  size: string;
  quantity: number;
  /** Frete cotado / cobrado (antes de promo de frete e cupom de frete). */
  freightQuoted: number;
  /** Se false, não reaplica promo de frete (já veio líquido da cotação). */
  applyShippingPromo?: boolean;
  coupon?: CouponValidation | null;
}): AdminSalePricing {
  const qty = Math.max(1, Number(params.quantity) || 1);
  const profit = calculateProfit(
    params.product,
    params.linkedGifts,
    params.promotions,
    params.size
  );

  // Preço da peça sem frete do cadastro — frete vem da cotação/admin
  const unitProduct = Math.max(
    0,
    Number(profit.preco_catalogo) - Number(profit.desconto)
  );
  let productSubtotal = unitProduct * qty;
  const descontoPromo = Number(profit.desconto) * qty;

  let freightBefore = Math.max(0, Number(params.freightQuoted) || 0);
  let shippingPromoDiscount = 0;
  let shippingPromoName: string | null = null;
  if (params.applyShippingPromo !== false) {
    const shipPromo = applyShippingPromotion(freightBefore, params.promotions);
    shippingPromoDiscount = shipPromo.discount;
    shippingPromoName = shipPromo.name;
    freightBefore = Math.max(0, freightBefore - shippingPromoDiscount);
  }

  let couponProductDisc = 0;
  let couponShipDisc = 0;
  let couponCode: string | null = null;
  let couponTitle: string | null = null;

  if (params.coupon?.ok) {
    couponCode = params.coupon.code || null;
    couponTitle = params.coupon.title || null;
    const amt = Number(params.coupon.discount_amount) || 0;
    if (params.coupon.discount_target === "shipping") {
      if (freightBefore > 0) {
        // Melhor Envio / frete cotado: parcial ou total
        couponShipDisc = Math.min(amt, freightBefore);
      } else {
        // Uber / sem cotação: cupom fixo já traz discount_amount;
        // % fica 0 até o admin lançar pós-envio
        couponShipDisc = amt;
      }
    } else {
      couponProductDisc = Math.min(amt, productSubtotal);
    }
  }

  productSubtotal = Math.max(0, productSubtotal - couponProductDisc);
  const saleFreight = Math.max(0, freightBefore - Math.min(couponShipDisc, freightBefore));
  const freightOriginal = Math.max(0, Number(params.freightQuoted) || 0);

  // Frete na conta da loja:
  // - com cotação: o que a cliente não pagou do frete cotado (parcial ou total)
  // - Uber sem cotação: valor do cupom fixo (se houver); % fica para pós-venda
  let freteAbsorvido = 0;
  if (freightOriginal > 0) {
    freteAbsorvido = Math.max(
      0,
      Math.round((freightOriginal - saleFreight) * 100) / 100
    );
  } else if (
    params.coupon?.ok &&
    params.coupon.discount_target === "shipping"
  ) {
    freteAbsorvido = Math.max(0, couponShipDisc);
  }

  const precoFinal = productSubtotal + saleFreight;

  const custoTotal =
    (Number(profit.custo_peca) + Number(profit.custo_brindes)) * qty;
  const lucro = precoFinal - custoTotal - freteAbsorvido;

  let promotionId: string | null = null;
  if (profit.promotion_name) {
    const promo = params.promotions.find(
      (p) => p.name === profit.promotion_name
    );
    promotionId = promo?.id || null;
  }

  const gifts = params.linkedGifts
    .map((lg) => {
      const gift =
        lg.gift_data ||
        (lg.gifts as Record<string, unknown> | undefined) ||
        (lg.gift as Record<string, unknown> | undefined);
      if (!gift?.id) return null;
      const perSale = Number(lg.quantity_per_sale) || 1;
      return {
        gift_id: String(gift.id),
        gift_name: String(gift.name || "Brinde"),
        quantity: perSale * qty,
      };
    })
    .filter(Boolean) as Array<{
    gift_id: string;
    gift_name: string;
    quantity: number;
  }>;

  return {
    preco_catalogo: Number(profit.preco_catalogo) * qty,
    desconto_promo: descontoPromo,
    desconto_cupom_produto: couponProductDisc,
    desconto_total: descontoPromo + couponProductDisc,
    sale_freight: saleFreight,
    freight_before_discounts: Math.max(0, Number(params.freightQuoted) || 0),
    shipping_promo_discount: shippingPromoDiscount,
    shipping_promo_name: shippingPromoName,
    coupon_shipping_discount: couponShipDisc,
    frete_absorvido: freteAbsorvido,
    preco_final: precoFinal,
    lucro,
    promotion_id: promotionId,
    promotion_name: profit.promotion_name,
    coupon_code: couponCode,
    coupon_title: couponTitle,
    gifts,
  };
}
