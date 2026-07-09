import { fetchStoreSettings } from "@/lib/catalog";
import { paymentsEnabled } from "@/lib/payments";
import { CheckoutClient } from "@/components/store/CheckoutClient";

export default async function CheckoutPage() {
  const settings = await fetchStoreSettings();
  return (
    <CheckoutClient
      settings={settings}
      paymentsEnabled={paymentsEnabled()}
    />
  );
}
