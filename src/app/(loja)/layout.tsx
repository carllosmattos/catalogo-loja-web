import { StoreHeader } from "@/components/store/StoreHeader";
import { WhatsAppFloat } from "@/components/store/WhatsAppFloat";
import { SetupBanner } from "@/components/SetupBanner";
import { fetchStoreSettings } from "@/lib/catalog";

export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await fetchStoreSettings();
  return (
    <div className="flex min-h-screen flex-col">
      <SetupBanner />
      {children}
      <WhatsAppFloat settings={settings} />
    </div>
  );
}
