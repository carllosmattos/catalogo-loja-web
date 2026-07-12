"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCustomerStore } from "@/stores";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { orderStatusLabel } from "@/lib/order-status";
import { Copy, Check, RefreshCw } from "lucide-react";
import type { StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";

interface OrderBundle {
  order: Record<string, unknown>;
  items: Record<string, unknown>[];
  payment?: Record<string, unknown> | null;
}

function normalizeBundle(
  data: Record<string, unknown> | null
): OrderBundle | null {
  if (!data) return null;
  if (data.order && typeof data.order === "object") {
    return {
      order: data.order as Record<string, unknown>,
      items: Array.isArray(data.items)
        ? (data.items as Record<string, unknown>[])
        : [],
      payment: (data.payment as Record<string, unknown> | null) || null,
    };
  }
  if (data.id != null) {
    return { order: data, items: [], payment: null };
  }
  return null;
}

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
  const router = useRouter();
  const customer = useCustomerStore((s) => s.customer);
  const [bundle, setBundle] = useState(() => normalizeBundle(initialOrder));
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "delete" | "refund" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase.rpc("get_order_by_tracking", {
      p_token: token,
    });
    setBundle(normalizeBundle(data as Record<string, unknown> | null));
  }

  async function syncPayment() {
    if (!bundle?.order?.id) return;
    const payment = bundle.payment;
    if (!payment?.provider_payment_id) return;
    setSyncing(true);
    await fetch(`/api/payments/${bundle.order.id}/sync`, {
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
    if (!bundle?.order?.id || !customer?.id || busy) return;
    setBusy("cancel");
    setActionError(null);
    const payment = bundle.payment;
    const res = await fetch("/api/orders/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: bundle.order.id,
        customerId: customer.id,
        providerPaymentId: payment?.provider_payment_id,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setActionError(String(data.error || "Não foi possível cancelar."));
      return;
    }
    await refresh();
  }

  async function deleteOrder() {
    if (!bundle?.order?.id || !customer?.id || busy) return;
    const ok = window.confirm(
      "Excluir este pedido da sua lista? Essa ação não pode ser desfeita."
    );
    if (!ok) return;
    setBusy("delete");
    setActionError(null);
    const payment = bundle.payment;
    const res = await fetch("/api/orders/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: bundle.order.id,
        customerId: customer.id,
        providerPaymentId: payment?.provider_payment_id,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setActionError(String(data.error || "Não foi possível excluir."));
      return;
    }
    router.push("/pedidos");
    router.refresh();
  }

  async function requestRefund() {
    if (!bundle?.order?.id || !customer?.id || busy) return;
    setBusy("refund");
    setActionError(null);
    const res = await fetch("/api/orders/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: bundle.order.id,
        customerId: customer.id,
        reason: "Solicitação do cliente",
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setActionError(String(data.error || "Não foi possível solicitar reembolso."));
      return;
    }
    await refresh();
  }

  const status = String(bundle?.order?.status || "");
  const paymentStatus = String(bundle?.payment?.status || "");

  useEffect(() => {
    if (status === "pending_payment") {
      const interval = setInterval(syncPayment, 15000);
      return () => clearInterval(interval);
    }
  }, [status]);

  if (!bundle) {
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

  const { order, items, payment } = bundle;
  const pixCode = String(payment?.pix_copy_paste || "");

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
            Status: {orderStatusLabel(status)}
          </p>
          {paymentStatus && paymentStatus !== status && (
            <p className="text-xs text-gray-400">
              Pagamento: {orderStatusLabel(paymentStatus)}
            </p>
          )}
          <p className="mt-2 text-2xl font-bold text-[var(--color-primary)]">
            {formatCurrency(Number(order.total_amount))}
          </p>

          {status === "pending_payment" && pixCode && (
            <div className="mt-4 rounded-2xl bg-[var(--color-accent)] p-4">
              <p className="text-sm font-medium">PIX Copia e Cola</p>
              <div className="mt-2 flex gap-2">
                <code className="flex-1 break-all text-xs">
                  {pixCode.slice(0, 60)}...
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(pixCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={syncPayment}
                disabled={syncing}
                className="mt-3 flex items-center gap-1 text-sm text-[var(--color-primary)]"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                />
                Atualizar status
              </button>
            </div>
          )}

          {items.length > 0 && (
            <ul className="mt-4 space-y-2">
              {items.map((item, i) => (
                <li key={i} className="text-sm text-gray-600">
                  {String(item.product_name)} — Tam. {String(item.product_size)}{" "}
                  x{Number(item.quantity)}
                </li>
              ))}
            </ul>
          )}

          {actionError && (
            <p className="mt-4 text-sm text-red-600">{actionError}</p>
          )}

          <div className="mt-6 flex flex-col gap-2">
            {status === "pending_payment" && customer && (
              <button
                type="button"
                onClick={cancelOrder}
                disabled={Boolean(busy)}
                className="rounded-full border border-red-300 py-2 text-sm text-red-600 disabled:opacity-50"
              >
                {busy === "cancel" ? "Cancelando..." : "Cancelar pedido"}
              </button>
            )}
            {status === "paid" && customer && (
              <button
                type="button"
                onClick={requestRefund}
                disabled={Boolean(busy)}
                className="rounded-full border border-gray-300 py-2 text-sm text-gray-600 disabled:opacity-50"
              >
                {busy === "refund" ? "Enviando..." : "Solicitar reembolso"}
              </button>
            )}
            {customer && (
              <button
                type="button"
                onClick={deleteOrder}
                disabled={Boolean(busy)}
                className="rounded-full border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50"
              >
                {busy === "delete" ? "Excluindo..." : "Excluir da minha lista"}
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
