"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCustomerStore } from "@/stores";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Copy, Check, RefreshCw } from "lucide-react";
import type { StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";

interface OrderDetailClientProps {
  settings: StoreSettings;
  token: string;
  initialOrder: Record<string, unknown> | null;
}

export function OrderDetailClient({
  settings,
  token,
  initialOrder,
}: OrderDetailClientProps) {
  const customer = useCustomerStore((s) => s.customer);
  const [order, setOrder] = useState(initialOrder);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase.rpc("get_order_by_tracking", {
      p_token: token,
    });
    setOrder(data as Record<string, unknown>);
  }

  async function syncPayment() {
    if (!order) return;
    const payment = order.payment as Record<string, unknown> | undefined;
    if (!payment?.provider_payment_id) return;
    setSyncing(true);
    await fetch(`/api/payments/${order.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerPaymentId: payment.provider_payment_id,
        customerId: customer?.id,
      }),
    });
    await refresh();
    setSyncing(false);
  }

  async function cancelOrder() {
    if (!order || !customer?.id) return;
    const payment = order.payment as Record<string, unknown> | undefined;
    await fetch("/api/orders/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        customerId: customer.id,
        providerPaymentId: payment?.provider_payment_id,
      }),
    });
    await refresh();
  }

  async function requestRefund() {
    if (!order || !customer?.id) return;
    await fetch("/api/orders/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        customerId: customer.id,
        reason: "Solicitação do cliente",
      }),
    });
    await refresh();
  }

  useEffect(() => {
    if (order?.status === "pending_payment") {
      const interval = setInterval(syncPayment, 15000);
      return () => clearInterval(interval);
    }
  }, [order?.status]);

  if (!order) {
    return (
      <>
        <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
        <main className={`${STORE_MAIN} text-center text-gray-500`}>
          Pedido não encontrado.
          <Link href="/pedidos" className="mt-2 block text-[var(--color-primary)]">
            Voltar
          </Link>
        </main>
      </>
    );
  }

  const payment = order.payment as Record<string, unknown> | undefined;
  const pixCode = String(payment?.pix_copy_paste || "");
  const items = (order.items as Record<string, unknown>[]) || [];

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <div className="lg:mx-auto lg:max-w-3xl">
        <Link href="/pedidos" className="text-sm text-[var(--color-primary)]">
          ← Voltar
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[var(--color-primary)]">
          Pedido #{String(order.id).slice(0, 8)}
        </h1>
        <p className="text-sm text-gray-500">
          Status: {String(order.status)}
        </p>
        <p className="mt-2 text-2xl font-bold text-[var(--color-primary)]">
          {formatCurrency(Number(order.total_amount))}
        </p>

        {order.status === "pending_payment" && pixCode && (
          <div className="mt-4 rounded-2xl bg-[var(--color-accent)] p-4">
            <p className="text-sm font-medium">PIX Copia e Cola</p>
            <div className="mt-2 flex gap-2">
              <code className="flex-1 break-all text-xs">{pixCode.slice(0, 60)}...</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(pixCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={syncPayment}
              disabled={syncing}
              className="mt-3 flex items-center gap-1 text-sm text-[var(--color-primary)]"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              Atualizar status
            </button>
          </div>
        )}

        {items.length > 0 && (
          <ul className="mt-4 space-y-2">
            {items.map((item, i) => (
              <li key={i} className="text-sm text-gray-600">
                {String(item.product_name)} — Tam. {String(item.product_size)} x
                {Number(item.quantity)}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {order.status === "pending_payment" && customer && (
            <button
              type="button"
              onClick={cancelOrder}
              className="rounded-full border border-red-300 py-2 text-sm text-red-600"
            >
              Cancelar pedido
            </button>
          )}
          {order.status === "paid" && customer && (
            <button
              type="button"
              onClick={requestRefund}
              className="rounded-full border border-gray-300 py-2 text-sm text-gray-600"
            >
              Solicitar reembolso
            </button>
          )}
        </div>
        </div>
      </main>
    </>
  );
}
