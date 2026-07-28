"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminButton } from "@/components/admin/AdminUI";
import { formatCurrency } from "@/lib/utils";
import { refundReasonLabel } from "@/lib/refunds";

type RefundRow = {
  id: string;
  order_id: string;
  status: string;
  reason?: string | null;
  reason_code?: string | null;
  reason_detail?: string | null;
  created_at?: string;
  orders?: Record<string, unknown> | Record<string, unknown>[] | null;
  payments?: Record<string, unknown> | Record<string, unknown>[] | null;
};

export default function AdminReembolsosPage() {
  const [pendingRefunds, setPendingRefunds] = useState<RefundRow[]>([]);
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);
  const [refundNotes, setRefundNotes] = useState<Record<string, string>>({});
  const [receivedOk, setReceivedOk] = useState<Record<string, boolean>>({});
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
    if (action === "approve" && !receivedOk[refundId]) {
      setMessage(
        "Marque “Produto recebido e conferido” antes de aprovar o estorno."
      );
      return;
    }
    setRefundBusyId(refundId);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/refunds/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refundId,
          adminNotes: refundNotes[refundId] || "",
          productReceived: action === "approve" ? true : undefined,
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
        Status do pedido fica em <strong>Aguardando devolução</strong> até você
        receber a peça. <strong>Só aprove o estorno depois de conferir o
        produto</strong> — aí o estoque volta e o Mercado Pago estorna. Pedidos
        em{" "}
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
      <AdminCard title={`Aguardando análise (${pendingRefunds.length})`}>
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
              const isDefect = r.reason_code === "defect";
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
                  <p className="mt-1 text-xs text-gray-700">
                    <span className="font-medium">Motivo:</span>{" "}
                    {refundReasonLabel(r.reason_code)}
                    {isDefect ? (
                      <span className="ml-1 text-amber-800">
                        (frete de retorno pode ser da loja)
                      </span>
                    ) : (
                      <span className="ml-1 text-gray-500">
                        (frete de devolução em geral do cliente)
                      </span>
                    )}
                  </p>
                  {(r.reason_detail || r.reason) && (
                    <p className="mt-0.5 text-xs text-gray-600">
                      Detalhe:{" "}
                      {String(r.reason_detail || r.reason || "").trim() || "—"}
                    </p>
                  )}
                  <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs text-gray-800">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={Boolean(receivedOk[r.id])}
                      onChange={(e) =>
                        setReceivedOk((n) => ({
                          ...n,
                          [r.id]: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      <strong>Produto recebido e conferido</strong> — obrigatório
                      para aprovar. Só marque após a peça chegar e estar ok para
                      reentrada no estoque.
                    </span>
                  </label>
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
                      disabled={
                        refundBusyId === r.id || !receivedOk[r.id]
                      }
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
