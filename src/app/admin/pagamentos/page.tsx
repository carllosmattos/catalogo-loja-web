"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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

function isReissueable(order: OrderRow, payStatus: string | null): boolean {
  const st = String(order.status || "");
  if (["cancelled", "canceled", "expired"].includes(st)) return true;
  if (
    st === "pending_payment" &&
    payStatus &&
    ["cancelled", "canceled", "rejected", "expired"].includes(payStatus)
  ) {
    return true;
  }
  return false;
}

export default function AdminPagamentosPage() {
  const searchParams = useSearchParams();
  const highlightOrder = searchParams.get("order");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [reissuingId, setReissuingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(
    highlightOrder || null
  );
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

  useEffect(() => {
    if (highlightOrder) setExpandedId(highlightOrder);
  }, [highlightOrder]);

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
              : st === "cancelled" || st === "rejected" || st === "expired"
                ? "PIX cancelado — pedido marcado como cancelado."
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

  async function reissueOrder(order: OrderRow) {
    setReissuingId(String(order.id));
    setMessage("");
    try {
      const res = await fetch("/api/admin/orders/reissue-pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(String(data.error || "Falha ao gerar novo PIX"));
      } else {
        setMessage(
          `Novo PIX gerado (${formatCurrency(Number(data.total) || 0)}). Pedido #${String(data.order_id).slice(0, 8)}.`
        );
        setExpandedId(String(data.order_id));
      }
      await load();
    } catch {
      setMessage("Erro de rede ao gerar novo PIX.");
    } finally {
      setReissuingId(null);
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
        webhook atrasou.{" "}
        <strong>Gerar novo PIX</strong> cria um pedido novo se o anterior
        expirou ou foi cancelado.
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
              const displayOrderStatus =
                String(o.status) === "pending_payment" &&
                payStatus &&
                ["cancelled", "canceled", "rejected", "expired"].includes(
                  payStatus
                )
                  ? "cancelled"
                  : String(o.status);
              const showReissue = isReissueable(o, payStatus);
              const highlight = highlightOrder === String(o.id);

              return (
                <li
                  key={String(o.id)}
                  id={`order-${o.id}`}
                  className={`rounded-lg border p-4 text-sm ${
                    highlight
                      ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
                      : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        #{String(o.id).slice(0, 8)} ·{" "}
                        {String(o.customer_name || "Cliente")}
                      </p>
                      <p className="text-gray-500">
                        Pedido: {orderStatusLabel(displayOrderStatus)} ·{" "}
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
                      {showReissue && (
                        <AdminButton
                          type="button"
                          disabled={reissuingId === String(o.id)}
                          onClick={() => reissueOrder(o)}
                        >
                          {reissuingId === String(o.id)
                            ? "Gerando…"
                            : "Gerar novo PIX"}
                        </AdminButton>
                      )}
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

                      {payment?.pix_copy_paste &&
                      String(o.status) === "pending_payment" &&
                      !(
                        payStatus &&
                        ["cancelled", "canceled", "rejected", "expired"].includes(
                          payStatus
                        )
                      ) ? (
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
