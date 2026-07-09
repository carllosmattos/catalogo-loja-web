import { fetchStoreSettings } from "@/lib/catalog";
import { AccountClient } from "@/components/store/AccountClient";

export default async function ContaPage() {
  const settings = await fetchStoreSettings();
  return <AccountClient settings={settings} />;
}
