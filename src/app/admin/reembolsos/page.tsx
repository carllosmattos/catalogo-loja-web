"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminButton } from "@/components/admin/AdminUI";
import { formatCurrency } from "@/lib/utils";

type RefundRow = {
  id: string;
  order_id: string;
  status: string;
  reason?: string | null;
  created_at?: string;
  orders?: Record<string, unknown> | Record<string, unknown>[] | null;
  payments?: Record<string, unknown> | Record<string, unknown>[] | null;
};

export default function AdminReembolsosPage() {
  const [pendingRefunds, setPendingRefunds] = useState<RefundRow[]>([]);
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);
  const [refundNotes, setRefundNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("refund_requests")
      .select("*, orders(*), payments(*)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    setPendingRefunds((data as RefundRow[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function decideRefund(refundId: string, action: "approve" | "reject") {
    setRefundBusyId(refundId);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/refunds/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refundId,
          adminNotes: refundNotes[refundId] || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(String(data.error || "Falha ao processar reembolso"));
      } else {
        setMessage(
          action === "approve"
            ? "Reembolso aprovado — estorno no MP e estoque devolvido."
            : "Reembolso rejeitado — pedido voltou a Pago."
        );
      }
      await load();
    } catch {
      setMessage("Erro de rede ao processar reembolso.");
    } finally {
      setRefundBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Reembolsos
      </h1>
      <p className="mb-4 text-sm text-gray-500">
        Solicitações dos clientes. Ao aprovar, o valor é estornado no Mercado
        Pago e o estoque da venda volta. Pedidos pagos ficam em{" "}
        <Link href="/admin/pagamentos" className="underline">
          Pagamentos
        </Link>
        .
      </p>
      {message && (
        <p className="mb-4 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-gray-700">
          {message}
        </p>
      )}
      <AdminCard title={`Pendentes (${pendingRefunds.length})`}>
        {loading ? (
          <p className="text-sm text-gray-400">Carregando…</p>
        ) : pendingRefunds.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum reembolso pendente.</p>
        ) : (
          <ul className="space-y-3">
            {pendingRefunds.map((r) => {
              const order = Array.isArray(r.orders) ? r.orders[0] : r.orders;
              const name = String(order?.customer_name || "Cliente");
              const totalAmt = Number(order?.total_amount) || 0;
              const created = r.created_at
                ? new Date(r.created_at).toLocaleString("pt-BR")
                : "";
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm"
                >
                  <p className="font-medium">
                    {name} · {formatCurrency(totalAmt)} · #
                    {String(r.order_id).slice(0, 8)}
                  </p>
                  {created && (
                    <p className="text-xs text-gray-400">{created}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-600">
                    Motivo: {r.reason?.trim() || "—"}
                  </p>
                  <label className="mt-2 block text-xs text-gray-500">
                    Observações (opcional)
                    <input
                      type="text"
                      value={refundNotes[r.id] || ""}
                      onChange={(e) =>
                        setRefundNotes((n) => ({
                          ...n,
                          [r.id]: e.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <AdminButton
                      type="button"
                      disabled={refundBusyId === r.id}
                      onClick={() => decideRefund(r.id, "approve")}
                    >
                      {refundBusyId === r.id
                        ? "Processando…"
                        : "Aprovar e estornar"}
                    </AdminButton>
                    <AdminButton
                      type="button"
                      variant="secondary"
                      disabled={refundBusyId === r.id}
                      onClick={() => decideRefund(r.id, "reject")}
                    >
                      Rejeitar
                    </AdminButton>
                    <Link
                      href={`/admin/pagamentos?order=${r.order_id}`}
                      className="inline-flex items-center rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Ver pedido
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
