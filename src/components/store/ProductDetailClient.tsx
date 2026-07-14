"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product, ProfitResult, Promotion, StoreSettings } from "@/types";
import { SizeSelector } from "./SizeSelector";
import { formatCurrency } from "@/lib/utils";
import type { ProductSize } from "@/types";
import { normalizeSize } from "@/lib/sizes";
import { useCartStore } from "@/stores";
import { buildOrderMessage, buildWhatsappUrl } from "@/lib/whatsapp";
import { calculateProfit } from "@/lib/profit";
import { ShoppingBag } from "lucide-react";
import { STORE_MAIN } from "@/lib/store-layout";

interface ProductDetailClientProps {
  product: Product;
  profit: ProfitResult;
  settings: StoreSettings;
  promotions: Promotion[];
  gifts: Array<{ gift_data?: Record<string, unknown> }>;
}

export function ProductDetailClient({
  product,
  settings,
  promotions,
  gifts,
}: ProductDetailClientProps) {
  const [selectedSize, setSelectedSize] = useState<ProductSize>("M");
  const [imageIndex, setImageIndex] = useState(0);
  const addItem = useCartStore((s) => s.addItem);

  const profit = calculateProfit(product, gifts, promotions, selectedSize);
  const images = product.image_urls?.length ? product.image_urls : [];
  const size = normalizeSize(selectedSize);

  function handleAddToCart() {
    addItem({
      product_id: product.id,
      name: product.name,
      size,
      sale_price: product.sale_price,
      sale_freight: Number(product.sale_freight) || 0,
      image_url: images[0],
    });
  }

  const waUrl = settings.whatsapp_number
    ? buildWhatsappUrl(
        settings.whatsapp_number,
        buildOrderMessage(product, profit, settings.store_name, null, size)
      )
    : null;

  return (
    <main className={STORE_MAIN}>
      <div className="lg:grid lg:grid-cols-2 lg:gap-10 lg:items-start">
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-[var(--color-accent)] lg:sticky lg:top-24 lg:aspect-[4/5]">
          {images[imageIndex] ? (
            <img
              src={images[imageIndex]}
              alt={product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-300">
              Sem foto
            </div>
          )}
          {images.length > 1 && (
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  className={`h-1.5 w-1.5 rounded-full ${i === imageIndex ? "bg-white" : "bg-white/50"}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 lg:mt-0">
          <h1 className="text-xl font-semibold text-gray-900 md:text-2xl lg:text-3xl">
            {product.name}
          </h1>
          {product.category && (
            <p className="text-sm text-gray-400 md:text-base">{product.category}</p>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {profit.desconto > 0 ? (
              <>
                <div>
                  <p className="text-sm text-gray-400 line-through md:text-base">
                    {formatCurrency(profit.preco_catalogo)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xl font-bold text-gray-900 md:text-3xl">
                      {formatCurrency(
                        Math.max(0, profit.preco_catalogo - profit.desconto)
                      )}
                    </span>
                    {(() => {
                      const pct = Math.round(
                        (profit.desconto / profit.preco_catalogo) * 100
                      );
                      return pct > 0 ? (
                        <span className="rounded-md bg-[#00A650] px-2 py-0.5 text-xs font-bold uppercase text-white">
                          {pct}% OFF
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>
              </>
            ) : (
              <span className="text-2xl font-bold text-gray-900 md:text-3xl">
                {formatCurrency(profit.preco_catalogo)}
              </span>
            )}
          </div>
          {profit.promotion_name && profit.desconto > 0 && (
            <p className="mt-1 text-sm font-medium text-[#F5A623]">
              {profit.promotion_name}
            </p>
          )}
          {promotions.some(
            (p) =>
              (p.discount_target || "product") === "shipping" &&
              p.discount_type === "percent" &&
              Number(p.discount_value) >= 100
          ) && (
            <p className="mt-1 text-sm font-bold text-[#00A650]">Frete grátis</p>
          )}
          {gifts.some((g) => g.gift_data?.id) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {gifts.map((link, i) => {
                const g = link.gift_data as
                  | {
                      id?: string;
                      name?: string;
                      image_url?: string;
                      image_urls?: string[];
                    }
                  | undefined;
                if (!g?.id) return null;
                const img = g.image_url || g.image_urls?.[0];
                return (
                  <div
                    key={String(g.id) + i}
                    className="flex items-center gap-2 rounded-full border border-[#A855F7]/40 bg-[#A855F7]/10 py-1 pl-1 pr-3"
                  >
                    <div className="h-8 w-8 overflow-hidden rounded-full border-2 border-[#A855F7] bg-white">
                      {img ? (
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#A855F7] text-xs text-white">
                          +
                        </div>
                      )}
                    </div>
                    <div className="text-xs">
                      <p className="font-medium text-gray-800">
                        {String(g.name || "Brinde")}
                      </p>
                      <p className="font-bold text-[#A855F7]">Grátis</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {product.description && (
            <p className="mt-3 text-sm text-gray-600 whitespace-pre-wrap md:text-base">
              {product.description}
            </p>
          )}

          <div className="mt-6">
            <p className="mb-2 text-sm font-medium text-gray-700">Tamanho</p>
            <SizeSelector
              sizes={product.sizes || []}
              selected={size}
              onChange={setSelectedSize}
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={profit.stock <= 0 || !profit.gift_stock_ok}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] py-3.5 text-sm font-semibold text-white disabled:opacity-50 md:py-4 md:text-base"
            >
              <ShoppingBag className="h-5 w-5" />
              Adicionar ao carrinho
            </button>
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-full border-2 border-[#25D366] py-3.5 text-sm font-semibold text-[#25D366] md:py-4 md:text-base"
              >
                <img src="/icons/whatsapp.svg" alt="" className="h-5 w-5" />
                WhatsApp
              </a>
            )}
          </div>
          <Link
            href="/carrinho"
            className="mt-3 inline-block text-sm text-[var(--color-primary)] underline"
          >
            Ver carrinho
          </Link>
        </div>
      </div>
    </main>
  );
}
