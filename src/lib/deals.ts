import type { ProductGiftPreview, Promotion } from "@/types";

/** Verde estilo “economia” (desconto / frete grátis). */
export const DEAL_GREEN = "#00A650";
/** Amarelo de campanha / selo de promoção. */
export const PROMO_YELLOW = "#F5A623";
/** Lilás para brinde. */
export const GIFT_LILAC = "#A855F7";

export function productDiscountPercent(
  listPrice: number,
  discountAmount: number
): number {
  if (listPrice <= 0 || discountAmount <= 0) return 0;
  return Math.max(1, Math.round((discountAmount / listPrice) * 100));
}

/** Há promoção ativa de frete 100% (frete grátis no catálogo). */
export function hasFreeShippingPromo(promotions: Promotion[]): boolean {
  return promotions.some((p) => {
    if ((p.discount_target || "product") !== "shipping") return false;
    if (p.active === false) return false;
    if (p.discount_type === "percent") {
      return Number(p.discount_value) >= 100;
    }
    return false;
  });
}

export function giftPreviewImage(gift: {
  image_url?: string | null;
  image_urls?: string[] | null;
}): string | null {
  if (gift.image_url) return gift.image_url;
  const urls = gift.image_urls || [];
  return urls[0] || null;
}

export function toGiftPreviews(
  links: Array<{
    gift_id?: string;
    quantity_per_sale?: number;
    gifts?: {
      id?: string;
      name?: string;
      image_url?: string | null;
      image_urls?: string[] | null;
      active?: boolean;
    } | null;
  }>
): ProductGiftPreview[] {
  const out: ProductGiftPreview[] = [];
  for (const link of links) {
    const g = link.gifts;
    if (!g?.id || g.active === false) continue;
    out.push({
      gift_id: String(g.id),
      name: String(g.name || "Brinde"),
      image_url: giftPreviewImage(g),
      quantity_per_sale: Math.max(1, Number(link.quantity_per_sale) || 1),
    });
  }
  return out;
}
