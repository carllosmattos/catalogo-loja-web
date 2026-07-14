"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminButton } from "@/components/admin/AdminUI";
import { formatCurrency } from "@/lib/utils";
import { orderStatusLabel } from "@/lib/order-status";

export default function AdminPagamentosPage() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const supabase = createClient();

  async function load() {
    const { data } = await supabase
      .from("orders")
      .select("*, payments(*)")
      .order("created_at", { ascending: false })
      .limit(50);
    setOrders(data || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function syncOrder(order: Record<string, unknown>) {
    const payments = order.payments as Record<string, unknown>[] | undefined;
    const payment = Array.isArray(payments) ? payments[0] : payments;
    if (!payment?.provider_payment_id) {
      setMessage("Pedido sem pagamento PIX vinculado.");
      return;
    }
    setSyncingId(String(order.id));
    setMessage("");
    try {
      const res = await fetch(`/api/payments/${order.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerPaymentId: payment.provider_payment_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || "Falha ao atualizar status");
      } else {
        setMessage("Status atualizado com o Mercado Pago.");
      }
      await load();
    } catch {
      setMessage("Erro de rede ao sincronizar.");
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Pagamentos
      </h1>
      <p className="mb-4 text-sm text-gray-500">
        Lista pedidos online (PIX). A ação{" "}
        <strong>Atualizar status</strong> consulta o Mercado Pago quando o
        webhook atrasou. Cancelamento/reembolso o cliente faz em Minhas
        compras.
      </p>
      {message && (
        <p className="mb-4 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-gray-700">
          {message}
        </p>
      )}
      <AdminCard title="Pedidos online">
        {orders.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum pedido ainda.</p>
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => {
              const payments = o.payments as
                | Record<string, unknown>[]
                | Record<string, unknown>
                | undefined;
              const payment = Array.isArray(payments)
                ? payments[0]
                : payments;
              const payStatus = payment?.status
                ? String(payment.status)
                : null;
              return (
                <li
                  key={String(o.id)}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">
                      #{String(o.id).slice(0, 8)} ·{" "}
                      {String(o.customer_name || "Cliente")}
                    </p>
                    <p className="text-gray-500">
                      Pedido: {orderStatusLabel(String(o.status))} ·{" "}
                      {formatCurrency(Number(o.total_amount))}
                    </p>
                    {payStatus && (
                      <p className="text-xs text-gray-400">
                        PIX: {orderStatusLabel(payStatus)}
                        {payment?.provider_payment_id
                          ? ` · MP ${String(payment.provider_payment_id).slice(0, 10)}…`
                          : ""}
                      </p>
                    )}
                    {o.tracking_token ? (
                      <a
                        href={`/pedidos/${String(o.tracking_token)}`}
                        className="inline-block text-xs text-[var(--color-primary)] underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver na loja
                      </a>
                    ) : null}
                  </div>
                  <AdminButton
                    variant="secondary"
                    disabled={
                      syncingId === String(o.id) ||
                      !payment?.provider_payment_id
                    }
                    onClick={() => syncOrder(o)}
                  >
                    {syncingId === String(o.id)
                      ? "Atualizando…"
                      : "Atualizar status"}
                  </AdminButton>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
