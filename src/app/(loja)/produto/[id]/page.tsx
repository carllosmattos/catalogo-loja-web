import { notFound } from "next/navigation";
import {
  fetchActivePromotions,
  fetchProduct,
  fetchProductGifts,
  fetchStoreSettings,
} from "@/lib/catalog";
import { StoreHeader } from "@/components/store/StoreHeader";
import { ProductDetailClient } from "@/components/store/ProductDetailClient";
import { calculateProfit } from "@/lib/profit";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [product, settings, promotions] = await Promise.all([
    fetchProduct(id),
    fetchStoreSettings(),
    fetchActivePromotions(),
  ]);
  if (!product) notFound();

  const gifts = await fetchProductGifts(product.id);
  const profit = calculateProfit(product, gifts, promotions);

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <ProductDetailClient
        product={product}
        profit={profit}
        settings={settings}
        promotions={promotions}
        gifts={gifts}
      />
    </>
  );
}
