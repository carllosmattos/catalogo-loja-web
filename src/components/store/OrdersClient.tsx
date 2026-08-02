"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCustomerStore } from "@/stores";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, cn } from "@/lib/utils";
import { orderStatusLabel } from "@/lib/order-status";
import type { StoreSettings } from "@/types";
import { STORE_MAIN, STORE_CARD, STORE_BTN_OUTLINE } from "@/lib/store-layout";

const PAGE_SIZE = 10;

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

function parseListPayload(data: unknown): { items: OrderRow[]; total: number } {
  if (Array.isArray(data)) {
    const items = data
      .map((row) => unwrapOrder(row as Record<string, unknown>))
      .filter((o): o is OrderRow => Boolean(o));
    return { items, total: items.length };
  }
  const obj = (data || {}) as { items?: unknown[]; total?: number };
  const raw = Array.isArray(obj.items) ? obj.items : [];
  const items = raw
    .map((row) => unwrapOrder(row as Record<string, unknown>))
    .filter((o): o is OrderRow => Boolean(o));
  return { items, total: Number(obj.total) || items.length };
}

interface OrdersClientProps {
  settings: StoreSettings;
}

export function OrdersClient({ settings }: OrdersClientProps) {
  const customer = useCustomerStore((s) => s.customer);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer?.id) {
      setLoading(false);
      setOrders([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const offset = (page - 1) * PAGE_SIZE;
    supabase
      .rpc("list_orders_by_customer", {
        p_customer_id: customer.id,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      })
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          setOrders([]);
          setTotal(0);
        } else {
          const parsed = parseListPayload(data);
          setOrders(parsed.items);
          setTotal(parsed.total);
        }
        setLoading(false);
      });
  }, [customer?.id, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
                Entre na conta
              </Link>{" "}
              para ver seus pedidos.
            </p>
          ) : loading ? (
            <p className="text-sm text-gray-400 md:col-span-full">Carregando…</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-gray-400 md:col-span-full">
              Nenhum pedido ainda.
            </p>
          ) : (
            orders.map((order) => (
              <Link
                key={order.id}
                href={`/pedidos/${order.tracking_token}`}
                className={cn("block p-4", STORE_CARD)}
              >
                <p className="font-medium text-gray-900">
                  #{order.id.slice(0, 8).toUpperCase()}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {orderStatusLabel(order.status)} ·{" "}
                  {formatCurrency(order.total_amount)}
                </p>
              </Link>
            ))
          )}
        </div>
        {customer && totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={cn("px-4 py-2 text-sm", STORE_BTN_OUTLINE)}
            >
              Anterior
            </button>
            <span className="text-sm text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className={cn("px-4 py-2 text-sm", STORE_BTN_OUTLINE)}
            >
              Próxima
            </button>
          </div>
        )}
      </main>
    </>
  );
}
