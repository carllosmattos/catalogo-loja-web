import { Suspense } from "react";
import {
  fetchActivePromotions,
  fetchCategories,
  fetchProductsPage,
  fetchStoreSettings,
} from "@/lib/catalog";
import { CatalogClient } from "@/components/store/CatalogClient";

export default async function CatalogoPage() {
  const [settings, categories, promotions, { products, total }] =
    await Promise.all([
      fetchStoreSettings(),
      fetchCategories(),
      fetchActivePromotions(),
      fetchProductsPage({ perPage: 20 }),
    ]);

  return (
    <Suspense>
      <CatalogClient
        settings={settings}
        categories={categories}
        initialProducts={products}
        initialTotal={total}
        promotions={promotions}
      />
    </Suspense>
  );
}
