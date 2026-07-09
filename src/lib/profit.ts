import type { Product, Promotion, ProfitResult } from "@/types";
import { mergeSizes, stockForSize, totalStock } from "@/lib/sizes";

interface GiftLink {
  quantity_per_sale?: number;
  gift_data?: Record<string, unknown>;
  gifts?: Record<string, unknown>;
  gift?: Record<string, unknown>;
}

function extractGift(link: GiftLink): Record<string, unknown> | null {
  for (const key of ["gift_data", "gifts", "gift"] as const) {
    const value = link[key];
    if (value && typeof value === "object" && (value as { id?: string }).id) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

export function applyPromotion(
  salePrice: number,
  productId: string,
  promotions: Promotion[]
): [number, string | null] {
  let bestDiscount = 0;
  let bestName: string | null = null;
  const pid = String(productId);
  for (const promo of promotions) {
    const productIds = (promo.product_ids || []).map(String);
    const applies =
      promo.applies_to === "all" || productIds.includes(pid);
    if (!applies) continue;
    const discount =
      promo.discount_type === "percent"
        ? salePrice * (Number(promo.discount_value) / 100)
        : Math.min(Number(promo.discount_value), salePrice);
    if (discount > bestDiscount) {
      bestDiscount = discount;
      bestName = promo.name;
    }
  }
  return [bestDiscount, bestName];
}

export function calculateProfit(
  product: Product,
  linkedGifts: GiftLink[],
  promotions: Promotion[] | null = null,
  selectedSize?: string | null
): ProfitResult {
  const purchasePrice = Number(product.purchase_price) || 0;
  const purchaseFreight = Number(product.purchase_freight) || 0;
  const salePrice = Number(product.sale_price) || 0;
  const saleFreight = Number(product.sale_freight) || 0;
  const sizes = product.sizes;
  const stock = sizes
    ? selectedSize
      ? stockForSize(sizes, selectedSize)
      : totalStock(sizes)
    : Number(product.stock) || 0;

  const custoPeca = purchasePrice + purchaseFreight;
  let custoBrindes = 0;
  let repasseBrinde = 0;
  let giftStockOk = true;

  for (const lg of linkedGifts) {
    const gift = extractGift(lg);
    if (!gift) continue;
    const qty = Number(lg.quantity_per_sale) || 1;
    const giftCost =
      (Number(gift.purchase_price) + Number(gift.purchase_freight)) * qty;
    const markup = Number(gift.sale_markup) * qty;
    custoBrindes += giftCost;
    repasseBrinde += markup;
    if (Number(gift.stock) < qty) giftStockOk = false;
  }

  const precoCatalogo = salePrice + repasseBrinde;
  let desconto = 0;
  let promotionName: string | null = null;
  if (promotions?.length) {
    [desconto, promotionName] = applyPromotion(
      precoCatalogo,
      product.id,
      promotions
    );
  }

  const precoFinalCliente = precoCatalogo - desconto + saleFreight;
  const lucroBruto = precoFinalCliente - custoPeca - custoBrindes;
  const margem =
    precoFinalCliente > 0 ? (lucroBruto / precoFinalCliente) * 100 : 0;

  return {
    product_name: product.name,
    custo_peca: custoPeca,
    custo_brindes: custoBrindes,
    repasse_brinde: repasseBrinde,
    preco_catalogo: precoCatalogo,
    desconto,
    preco_final_cliente: precoFinalCliente,
    lucro_bruto: lucroBruto,
    margem_percent: margem,
    promotion_name: promotionName,
    stock,
    gift_stock_ok: giftStockOk,
  };
}

export function attachSizesToProducts(
  products: Product[],
  sizeMap: Record<string, { size: string; stock: number }[]>
): Product[] {
  return products.map((product) => {
    const pid = String(product.id);
    if (sizeMap[pid]) {
      return { ...product, sizes: mergeSizes(sizeMap[pid] as never) };
    }
    const legacy = Number(product.stock) || 0;
    const rows = mergeSizes(null);
    return { ...product, sizes: rows };
  });
}
