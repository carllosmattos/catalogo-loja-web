import { StoreHeader } from "@/components/store/StoreHeader";
import { WhatsAppFloat } from "@/components/store/WhatsAppFloat";
import { fetchStoreSettings } from "@/lib/catalog";

export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await fetchStoreSettings();
  return (
    <div className="flex min-h-screen flex-col">
      {children}
      <WhatsAppFloat settings={settings} />
    </div>
  );
}
