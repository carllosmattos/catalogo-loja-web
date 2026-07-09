import { fetchStoreSettings } from "@/lib/catalog";
import { CartPageClient } from "@/components/store/CartPageClient";

export default async function CarrinhoPage() {
  const settings = await fetchStoreSettings();
  return <CartPageClient settings={settings} />;
}
