"use client";

import Link from "next/link";
import type { Product, Promotion } from "@/types";
import { calculateProfit } from "@/lib/profit";
import {
  DEAL_GREEN,
  GIFT_LILAC,
  PROMO_YELLOW,
  hasFreeShippingPromo,
  productDiscountPercent,
} from "@/lib/deals";
import { formatCurrency } from "@/lib/utils";
import { totalStock } from "@/lib/sizes";

interface ProductCardProps {
  product: Product;
  promotions: Promotion[];
}

export function ProductCard({ product, promotions }: ProductCardProps) {
  const giftsForProfit = (product.linked_gifts || []).map((g) => ({
    quantity_per_sale: g.quantity_per_sale,
    gift_data: {
      id: g.gift_id,
      name: g.name,
      purchase_price: 0,
      purchase_freight: 0,
      sale_markup: 0,
      stock: 99,
    },
  }));
  const profit = calculateProfit(product, giftsForProfit, promotions);
  const image = product.image_urls?.[0];
  const soldOut = totalStock(product.sizes) <= 0;
  const listPrice = profit.preco_catalogo;
  const finalPrice = Math.max(0, listPrice - profit.desconto);
  const offPct = productDiscountPercent(listPrice, profit.desconto);
  const freeShipping = hasFreeShippingPromo(promotions);
  const gifts = product.linked_gifts || [];
  const giftPreview = gifts[0];

  return (
    <Link
      href={`/produto/${product.id}`}
      className="group animate-fade-in overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-[var(--color-accent)]">
        {image ? (
          <img
            src={image}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-300">
            Sem foto
          </div>
        )}

        {profit.promotion_name && profit.desconto > 0 && (
          <span
            className="absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
            style={{ backgroundColor: PROMO_YELLOW }}
          >
            Promo
          </span>
        )}

        {giftPreview && (
          <div className="absolute bottom-2 right-2 flex flex-col items-end gap-0.5">
            <div
              className="relative h-11 w-11 overflow-hidden rounded-full border-2 bg-white shadow-md"
              style={{ borderColor: GIFT_LILAC }}
              title={`Brinde: ${giftPreview.name}`}
            >
              {giftPreview.image_url ? (
                <img
                  src={giftPreview.image_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-[9px] font-bold text-white"
                  style={{ backgroundColor: GIFT_LILAC }}
                >
                  +
                </div>
              )}
              <span
                className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 text-[8px] font-bold uppercase text-white"
                style={{ backgroundColor: GIFT_LILAC }}
              >
                Grátis
              </span>
            </div>
            {gifts.length > 1 && (
              <span
                className="rounded-full px-1.5 text-[9px] font-semibold text-white"
                style={{ backgroundColor: GIFT_LILAC }}
              >
                +{gifts.length - 1}
              </span>
            )}
          </div>
        )}

        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-semibold text-white">
            Esgotado
          </span>
        )}
      </div>

      <div className="space-y-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium text-gray-900">
          {product.name}
        </h3>

        {profit.desconto > 0 ? (
          <div className="space-y-0.5">
            <p className="text-xs text-gray-400 line-through">
              {formatCurrency(listPrice)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-base font-bold text-gray-900">
                {formatCurrency(finalPrice)}
              </span>
              {offPct > 0 && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                  style={{ backgroundColor: DEAL_GREEN }}
                >
                  {offPct}% OFF
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-base font-bold text-gray-900">
            {formatCurrency(listPrice)}
          </p>
        )}

        {freeShipping && (
          <p className="text-xs font-bold" style={{ color: DEAL_GREEN }}>
            Frete grátis
          </p>
        )}

        {product.category && (
          <p className="text-[10px] text-gray-400">{product.category}</p>
        )}
      </div>
    </Link>
  );
}
