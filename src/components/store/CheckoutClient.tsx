"use client";

import { useState } from "react";
import Link from "next/link";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCartStore, useCustomerStore } from "@/stores";
import { buildCartMessage, buildWhatsappUrl } from "@/lib/whatsapp";
import { formatCurrency } from "@/lib/utils";
import type { StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";
import { Copy, Check } from "lucide-react";

interface CheckoutClientProps {
  settings: StoreSettings;
  paymentsEnabled: boolean;
}

export function CheckoutClient({
  settings,
  paymentsEnabled,
}: CheckoutClientProps) {
  const items = useCartStore((s) => s.items);
  const clear = useCartStore((s) => s.clear);
  const customer = useCustomerStore((s) => s.customer);
  const [loading, setLoading] = useState(false);
  const [pixResult, setPixResult] = useState<Record<string, unknown> | null>(
    null
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shipping, setShipping] = useState(0);

  const subtotal = items.reduce(
    (s, i) => s + (Number(i.sale_price) + Number(i.sale_freight)) * i.quantity,
    0
  );

  async function handlePix() {
    if (!customer?.id) {
      setError("Complete seu cadastro em Minha conta.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkout/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, cart: items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPixResult(data);
      setShipping(Number(data.shipping_amount) || 0);
      clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const waMessage = buildCartMessage(
    items.map((i) => ({
      name: i.name,
      size: i.size,
      quantity: i.quantity,
      preco_final: Number(i.sale_price) + Number(i.sale_freight),
    })),
    settings.store_name,
    customer
      ? {
          name: customer.name,
          phone: customer.phone,
          cpf: customer.cpf,
          email: customer.email,
          address: customer.address,
        }
      : null,
    shipping
  );
  const waUrl = settings.whatsapp_number
    ? buildWhatsappUrl(settings.whatsapp_number, waMessage)
    : null;

  if (pixResult) {
    const pixCode = String(pixResult.pix_copy_paste || "");
    return (
      <>
        <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
        <main className={STORE_MAIN}>
          <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)]">
            Pague com PIX
          </h1>
          <div className="mx-auto max-w-lg rounded-2xl bg-[var(--color-accent)] p-6 text-center md:max-w-xl md:p-8">
            <img src="/icons/pix.svg" alt="PIX" className="mx-auto h-12 w-12" />
            <p className="mt-2 text-2xl font-bold text-[var(--color-primary)]">
              {formatCurrency(Number(pixResult.total))}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Válido por 15 minutos
            </p>
            {pixCode && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-gray-500">Copia e cola:</p>
                <div className="flex items-center gap-2 rounded-lg bg-white p-3">
                  <code className="flex-1 break-all text-left text-xs">
                    {pixCode.slice(0, 80)}...
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(pixCode);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="shrink-0 rounded-full p-2 hover:bg-gray-100"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
            <Link
              href={`/pedidos/${pixResult.tracking_token}`}
              className="mt-6 inline-block rounded-full bg-[var(--color-primary)] px-6 py-3 text-sm font-semibold text-white"
            >
              Acompanhar pedido
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <div className="md:mx-auto md:max-w-xl lg:max-w-2xl">
        <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)] md:text-2xl">
          Finalizar compra
        </h1>
        {!customer && (
          <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
            <Link href="/conta" className="underline font-medium">
              Complete seu cadastro
            </Link>{" "}
            antes de finalizar.
          </p>
        )}
        <p className="mb-4 text-sm text-gray-600">
          Total estimado: {formatCurrency(subtotal)}
        </p>
        {error && (
          <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="space-y-3">
          {paymentsEnabled && (
            <button
              type="button"
              onClick={handlePix}
              disabled={loading || !customer || !items.length}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] py-3.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <img src="/icons/pix.svg" alt="" className="h-5 w-5 invert" />
              {loading ? "Gerando PIX..." : "Pagar com PIX"}
            </button>
          )}
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-[#25D366] py-3.5 text-sm font-semibold text-[#25D366]"
            >
              <img src="/icons/whatsapp.svg" alt="" className="h-5 w-5" />
              Finalizar no WhatsApp
            </a>
          )}
        </div>
        </div>
      </main>
    </>
  );
}
