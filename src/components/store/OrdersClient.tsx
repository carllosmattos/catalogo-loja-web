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

interface OrderRow {
  id: string;
  status: string;
  total_amount: number;
  tracking_token: string;
}

function unwrapOrder(row: Record<string, unknown>): OrderRow | null {
  const nested = (row.order as Record<string, unknown> | undefined) || row;
  const id = nested.id != null ? String(nested.id) : "";
  const token =
    nested.tracking_token != null ? String(nested.tracking_token) : "";
  if (!id || !token) return null;
  return {
    id,
    status: String(nested.status || ""),
    total_amount: Number(nested.total_amount) || 0,
    tracking_token: token,
  };
}

interface OrdersClientProps {
  settings: StoreSettings;
}

export function OrdersClient({ settings }: OrdersClientProps) {
  const customer = useCustomerStore((s) => s.customer);
  const [orders, setOrders] = useState<OrderRow[]>([]);
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
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          setOrders([]);
        } else {
          const rows = Array.isArray(data) ? data : [];
          setOrders(
            rows
              .map((row) => unwrapOrder(row as Record<string, unknown>))
              .filter((o): o is OrderRow => Boolean(o))
          );
        }
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
            <p className="text-sm text-gray-500 md:col-span-full">
              Nenhum pedido ainda.
            </p>
          ) : (
            orders.map((order) => (
              <Link
                key={order.id}
                href={`/pedidos/${order.tracking_token}`}
                className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <div className="flex justify-between">
                  <span className="text-sm font-medium">
                    Pedido #{order.id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[var(--color-primary)]">
                  {formatCurrency(order.total_amount)}
                </p>
              </Link>
            ))
          )}
        </div>
      </main>
    </>
  );
}
