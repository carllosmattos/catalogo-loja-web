"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
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
  const [modalOpen, setModalOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const categoryLabel = selectedCategory?.name || "Todas as categorias";

  useEffect(() => {
    if (!modalOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [modalOpen]);

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
    setHasMore(
      data.products.length > 0 &&
        products.length + data.products.length < data.total
    );
    setLoading(false);
  }

  async function filterCategory(id: string) {
    setCategoryId(id);
    setPage(1);
    setModalOpen(false);
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

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mb-4 flex w-full items-center justify-between rounded-2xl border border-[var(--color-primary)]/15 bg-white px-4 py-3 text-left shadow-sm"
        >
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Categoria
            </p>
            <p className="text-sm font-semibold text-[var(--color-primary)]">
              {categoryLabel}
            </p>
          </div>
          <ChevronDown className="h-5 w-5 text-[var(--color-primary)]" />
        </button>

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

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-modal-title"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2
                id="category-modal-title"
                className="text-base font-semibold text-[var(--color-primary)]"
              >
                Escolher categoria
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-3 py-2">
              <button
                type="button"
                onClick={() => filterCategory("")}
                className={cn(
                  "mb-1 flex w-full items-center rounded-xl px-4 py-3 text-left text-sm font-medium",
                  !categoryId
                    ? "bg-[var(--color-accent)] text-[var(--color-primary)]"
                    : "text-gray-700 hover:bg-gray-50"
                )}
              >
                Todas as categorias
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => filterCategory(cat.id)}
                  className={cn(
                    "mb-1 flex w-full items-center rounded-xl px-4 py-3 text-left text-sm font-medium",
                    categoryId === cat.id
                      ? "bg-[var(--color-accent)] text-[var(--color-primary)]"
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
