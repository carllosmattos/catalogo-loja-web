"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCustomerStore } from "@/stores";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import type { StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Aguardando PIX",
  paid: "Pago",
  cancelled: "Cancelado",
  refund_requested: "Reembolso solicitado",
  refunded: "Reembolsado",
};

interface OrdersClientProps {
  settings: StoreSettings;
}

export function OrdersClient({ settings }: OrdersClientProps) {
  const customer = useCustomerStore((s) => s.customer);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer?.id) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    supabase
      .rpc("list_orders_by_customer", {
        p_customer_id: customer.id,
        p_limit: 30,
      })
      .then(({ data }) => {
        setOrders((data as Record<string, unknown>[]) || []);
        setLoading(false);
      });
  }, [customer?.id]);

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)] md:text-2xl">
          Minhas compras
        </h1>
        <div className="md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {!customer ? (
          <p className="text-sm text-gray-500 md:col-span-full">
            <Link href="/conta" className="text-[var(--color-primary)] underline">
              Faça login
            </Link>{" "}
            para ver seus pedidos.
          </p>
        ) : loading ? (
          <p className="text-sm text-gray-400 md:col-span-full">Carregando...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-500 md:col-span-full">Nenhum pedido ainda.</p>
        ) : (
          orders.map((order) => (
            <Link
              key={String(order.id)}
              href={`/pedidos/${order.tracking_token}`}
              className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
            >
              <div className="flex justify-between">
                <span className="text-sm font-medium">
                  Pedido #{String(order.id).slice(0, 8)}
                </span>
                <span className="text-xs text-gray-400">
                  {STATUS_LABELS[String(order.status)] || String(order.status)}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-[var(--color-primary)]">
                {formatCurrency(Number(order.total_amount))}
              </p>
            </Link>
          ))
        )}
        </div>
      </main>
    </>
  );
}
