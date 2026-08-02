import { WhatsAppFloat } from "@/components/store/WhatsAppFloat";
import { ChatFloat } from "@/components/store/ChatFloat";
import { fetchStoreSettings } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await fetchStoreSettings();
  return (
    <div className="flex min-h-screen flex-col">
      {children}
      <ChatFloat settings={settings} />
      <WhatsAppFloat settings={settings} />
    </div>
  );
}
