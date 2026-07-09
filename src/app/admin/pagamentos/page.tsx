"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminButton } from "@/components/admin/AdminUI";
import { formatCurrency } from "@/lib/utils";

export default function AdminPagamentosPage() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const supabase = createClient();

  async function load() {
    const { data } = await supabase
      .from("orders")
      .select("*, payments(*)")
      .order("created_at", { ascending: false })
      .limit(50);
    setOrders(data || []);
  }

  useEffect(() => { load(); }, []);

  async function syncOrder(order: Record<string, unknown>) {
    const payments = order.payments as Record<string, unknown>[] | undefined;
    const payment = payments?.[0];
    if (!payment?.provider_payment_id) return;
    await fetch(`/api/payments/${order.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerPaymentId: payment.provider_payment_id }),
    });
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Pagamentos</h1>
      <AdminCard title="Pedidos online">
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={String(o.id)} className="flex items-center justify-between rounded-lg border p-4 text-sm">
              <div>
                <p className="font-medium">#{String(o.id).slice(0, 8)}</p>
                <p className="text-gray-400">
                  {String(o.status)} · {formatCurrency(Number(o.total_amount))}
                </p>
              </div>
              <AdminButton variant="secondary" onClick={() => syncOrder(o)}>
                Sync MP
              </AdminButton>
            </li>
          ))}
        </ul>
      </AdminCard>
    </div>
  );
}
