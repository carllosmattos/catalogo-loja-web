import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Providers } from "@/components/Providers";
import { fetchStoreSettings } from "@/lib/catalog";
import { themeCssVars } from "@/lib/branding";
import "./globals.css";

export const dynamic = "force-dynamic";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await fetchStoreSettings();
  return {
    title: {
      default: settings.store_name,
      template: `%s — ${settings.store_name}`,
    },
    description: `Catálogo de moda feminina — ${settings.store_name}. Peças exclusivas com entrega.`,
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: settings.store_name,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await fetchStoreSettings();
  const vars = themeCssVars(settings);

  return (
    <html lang="pt-BR" className={`${geist.variable} h-full antialiased`}>
      <body
        className="min-h-full flex flex-col bg-white"
        style={vars as React.CSSProperties}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
