"use client";

import Link from "next/link";
import type { Product, Promotion } from "@/types";
import { calculateProfit } from "@/lib/profit";
import { formatCurrency } from "@/lib/utils";
import { totalStock } from "@/lib/sizes";

interface ProductCardProps {
  product: Product;
  promotions: Promotion[];
}

export function ProductCard({ product, promotions }: ProductCardProps) {
  const profit = calculateProfit(product, [], promotions);
  const image = product.image_urls?.[0];
  const soldOut = totalStock(product.sizes) <= 0;

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
          <div className="flex h-full items-center justify-center text-gray-300 text-sm">
            Sem foto
          </div>
        )}
        {profit.promotion_name && (
          <span className="absolute left-2 top-2 rounded-full bg-[var(--color-secondary)] px-2 py-0.5 text-[10px] font-bold text-white">
            Promo
          </span>
        )}
        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-semibold text-white">
            Esgotado
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 text-sm font-medium text-gray-900">
          {product.name}
        </h3>
        <div className="mt-1 flex items-baseline gap-2">
          {profit.desconto > 0 ? (
            <>
              <span className="text-xs text-gray-400 line-through">
                {formatCurrency(profit.preco_catalogo)}
              </span>
              <span className="text-sm font-bold text-[var(--color-primary)]">
                {formatCurrency(profit.preco_final_cliente - Number(product.sale_freight))}
              </span>
            </>
          ) : (
            <span className="text-sm font-bold text-[var(--color-primary)]">
              {formatCurrency(profit.preco_catalogo)}
            </span>
          )}
        </div>
        {product.category && (
          <p className="mt-0.5 text-[10px] text-gray-400">{product.category}</p>
        )}
      </div>
    </Link>
  );
}
