import type { StoreSettings } from "@/types";
import { buildWhatsappUrl } from "@/lib/whatsapp";

interface WhatsAppFloatProps {
  settings: StoreSettings;
  message?: string;
}

export function WhatsAppFloat({ settings, message }: WhatsAppFloatProps) {
  if (!settings.whatsapp_number) return null;
  const defaultMsg = `Olá! Vi o catálogo da ${settings.store_name} e gostaria de mais informações.`;
  const url = buildWhatsappUrl(settings.whatsapp_number, message || defaultMsg);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:right-6"
      aria-label="Falar no WhatsApp"
    >
      <img src="/icons/whatsapp.svg" alt="" className="h-7 w-7" />
    </a>
  );
}
