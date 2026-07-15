import {
  fetchActivePromotions,
  fetchProductsPage,
  fetchStoreBanners,
  fetchStoreSettings,
} from "@/lib/catalog";
import { StoreHeader } from "@/components/store/StoreHeader";
import { BannerCarousel } from "@/components/store/BannerCarousel";
import { ProductCard } from "@/components/store/ProductCard";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { STORE_MAIN, PRODUCT_GRID } from "@/lib/store-layout";
import { buildAttendMessage, buildWhatsappUrl } from "@/lib/whatsapp";

export default async function HomePage() {
  const [settings, promotions, banners, { products }] = await Promise.all([
    fetchStoreSettings(),
    fetchActivePromotions(),
    fetchStoreBanners(),
    fetchProductsPage({ perPage: 6 }),
  ]);

  const bannerUrls = banners.length
    ? banners.map((b) => b.image_url)
    : settings.default_banner_url
      ? [settings.default_banner_url]
      : [];

  const promoBanners = promotions
    .filter((p) => p.show_banner && p.banner_url)
    .map((p) => p.banner_url!);

  const carouselUrls =
    bannerUrls.length >= 2
      ? bannerUrls
      : promoBanners.length >= 2
        ? promoBanners
        : bannerUrls.length
          ? bannerUrls
          : promoBanners;

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        {carouselUrls.length > 0 && (
          <section className="mb-6">
            <BannerCarousel urls={carouselUrls} />
          </section>
        )}

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--color-primary)]">
              Destaques
            </h2>
            <Link
              href="/catalogo"
              className="flex items-center gap-1 text-sm text-[var(--color-primary)]"
            >
              Ver tudo <ArrowRight className="h-4 w-4" />
            </Link>
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
        </section>

        {settings.whatsapp_number && (
          <section className="mt-8 rounded-2xl border border-[#25D366]/30 bg-[#25D366]/5 p-4 text-center">
            <p className="text-sm text-gray-600">
              Prefere atendimento personalizado?
            </p>
            <a
              href={buildWhatsappUrl(
                settings.whatsapp_number,
                buildAttendMessage(settings.store_name)
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-6 py-2.5 text-sm font-semibold text-white"
            >
              <img src="/icons/whatsapp.svg" alt="" className="h-5 w-5" />
              Falar no WhatsApp
            </a>
          </section>
        )}
      </main>
    </>
  );
}