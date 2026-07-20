"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminButton } from "@/components/admin/AdminUI";
import { formatCurrency, formatCpf } from "@/lib/utils";
import { orderStatusLabel } from "@/lib/order-status";

type OrderRow = Record<string, unknown> & {
  id: string;
  payments?: Record<string, unknown>[] | Record<string, unknown>;
  order_items?: Record<string, unknown>[];
};

export default function AdminPagamentosPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const supabase = createClient();

  async function load() {
    const { data } = await supabase
      .from("orders")
      .select("*, payments(*), order_items(*)")
      .order("created_at", { ascending: false })
      .limit(50);
    setOrders((data as OrderRow[]) || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function syncOrder(order: OrderRow) {
    const payments = order.payments;
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
        const st = String(data.status || "");
        setMessage(
          data.message ||
            (st === "approved"
              ? "Pagamento aprovado — venda deve aparecer em Vendas."
              : `Status: ${st}`)
        );
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
        Lista pedidos online (PIX). Use <strong>Ver detalhes</strong> para ver
        itens e dados do cliente aqui no admin.{" "}
        <strong>Atualizar status</strong> consulta o Mercado Pago quando o
        webhook atrasou.
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
              const payments = o.payments;
              const payment = Array.isArray(payments)
                ? payments[0]
                : payments;
              const payStatus = payment?.status
                ? String(payment.status)
                : null;
              const items = Array.isArray(o.order_items) ? o.order_items : [];
              const open = expandedId === String(o.id);
              const created = o.created_at
                ? new Date(String(o.created_at)).toLocaleString("pt-BR")
                : "";

              return (
                <li
                  key={String(o.id)}
                  className="rounded-lg border p-4 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
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
                      {created && (
                        <p className="text-xs text-gray-400">{created}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AdminButton
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          setExpandedId(open ? null : String(o.id))
                        }
                      >
                        {open ? (
                          <>
                            Ocultar <ChevronUp className="h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Ver detalhes <ChevronDown className="h-4 w-4" />
                          </>
                        )}
                      </AdminButton>
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
                    </div>
                  </div>

                  {open && (
                    <div className="mt-4 space-y-3 border-t pt-3 text-sm">
                      <div className="grid gap-1 text-gray-600 sm:grid-cols-2">
                        {o.customer_phone ? (
                          <p>
                            <span className="text-gray-400">Telefone:</span>{" "}
                            {String(o.customer_phone)}
                          </p>
                        ) : null}
                        {o.customer_cpf ? (
                          <p>
                            <span className="text-gray-400">CPF:</span>{" "}
                            {formatCpf(String(o.customer_cpf))}
                          </p>
                        ) : null}
                        {o.customer_email ? (
                          <p>
                            <span className="text-gray-400">E-mail:</span>{" "}
                            {String(o.customer_email)}
                          </p>
                        ) : null}
                        {o.shipping_label || o.shipping_amount != null ? (
                          <p>
                            <span className="text-gray-400">Frete:</span>{" "}
                            {String(o.shipping_label || "Entrega")}
                            {o.shipping_amount != null
                              ? ` · ${formatCurrency(Number(o.shipping_amount))}`
                              : ""}
                          </p>
                        ) : null}
                        {o.shipping_address || o.customer_address ? (
                          <p className="sm:col-span-2">
                            <span className="text-gray-400">Endereço:</span>{" "}
                            {String(
                              o.shipping_address || o.customer_address || ""
                            )}
                          </p>
                        ) : null}
                      </div>

                      {items.length > 0 ? (
                        <ul className="space-y-1.5 rounded-xl bg-gray-50 p-3">
                          {items.map((item, i) => (
                            <li
                              key={String(item.id || i)}
                              className="flex flex-wrap justify-between gap-2"
                            >
                              <span>
                                {String(item.product_name || "Item")}
                                {item.product_size
                                  ? ` · Tam. ${String(item.product_size)}`
                                  : ""}{" "}
                                ×{Number(item.quantity) || 1}
                              </span>
                              <span className="font-medium text-gray-700">
                                {formatCurrency(
                                  Number(
                                    item.preco_final_line ??
                                      item.line_total ??
                                      item.unit_price ??
                                      0
                                  )
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-gray-400">
                          Sem itens vinculados.
                        </p>
                      )}

                      {payment?.pix_copy_paste ? (
                        <p className="break-all text-xs text-gray-400">
                          PIX: {String(payment.pix_copy_paste).slice(0, 80)}…
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
