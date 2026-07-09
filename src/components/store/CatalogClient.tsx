"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProductCard } from "@/components/store/ProductCard";
import { StoreHeader } from "@/components/store/StoreHeader";
import type { Category, Product, Promotion, StoreSettings } from "@/types";
import { cn } from "@/lib/utils";
import { STORE_MAIN, PRODUCT_GRID } from "@/lib/store-layout";

interface CatalogClientProps {
  settings: StoreSettings;
  categories: Category[];
  initialProducts: Product[];
  initialTotal: number;
  promotions: Promotion[];
}

export function CatalogClient({
  settings,
  categories,
  initialProducts,
  initialTotal,
  promotions,
}: CatalogClientProps) {
  const searchParams = useSearchParams();
  const [categoryId, setCategoryId] = useState(
    searchParams.get("categoria") || ""
  );
  const [products, setProducts] = useState(initialProducts);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialProducts.length < initialTotal);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    const nextPage = page + 1;
    const params = new URLSearchParams({ page: String(nextPage) });
    if (categoryId) params.set("categoryId", categoryId);
    const res = await fetch(`/api/catalog?${params}`);
    const data = await res.json();
    setProducts((prev) => [...prev, ...data.products]);
    setPage(nextPage);
    setHasMore(data.products.length > 0 && products.length + data.products.length < data.total);
    setLoading(false);
  }

  async function filterCategory(id: string) {
    setCategoryId(id);
    setPage(1);
    setLoading(true);
    const params = new URLSearchParams({ page: "1" });
    if (id) params.set("categoryId", id);
    const res = await fetch(`/api/catalog?${params}`);
    const data = await res.json();
    setProducts(data.products);
    setHasMore(data.products.length < data.total);
    setLoading(false);
  }

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)]">
          Catálogo
        </h1>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => filterCategory("")}
            className={cn(
              "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium",
              !categoryId
                ? "bg-[var(--color-primary)] text-white"
                : "bg-gray-100 text-gray-600"
            )}
          >
            Todos
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => filterCategory(cat.id)}
              className={cn(
                "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium",
                categoryId === cat.id
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-gray-100 text-gray-600"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <div className={PRODUCT_GRID}>
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              promotions={promotions}
            />
          ))}
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="mt-6 w-full rounded-full border border-[var(--color-primary)] py-3 text-sm font-medium text-[var(--color-primary)] disabled:opacity-50"
          >
            {loading ? "Carregando..." : "Carregar mais"}
          </button>
        )}
      </main>
    </>
  );
}
