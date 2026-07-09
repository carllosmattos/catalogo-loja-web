"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCartStore, useCustomerStore } from "@/stores";
import { formatCurrency } from "@/lib/utils";
import type { StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";

interface CartPageClientProps {
  settings: StoreSettings;
}

export function CartPageClient({ settings }: CartPageClientProps) {
  const { items, updateQuantity, removeItem } = useCartStore();
  const customer = useCustomerStore((s) => s.customer);
  const [shipping, setShipping] = useState<{
    amount: number;
    label: string;
    blocked: boolean;
  } | null>(null);

  const subtotal = items.reduce(
    (s, i) => s + (Number(i.sale_price) + Number(i.sale_freight)) * i.quantity,
    0
  );

  useEffect(() => {
    if (!items.length || !customer?.id) {
      setShipping(null);
      return;
    }
    fetch("/api/shipping/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customer.id, cart: items }),
    })
      .then((r) => r.json())
      .then(setShipping)
      .catch(() => setShipping(null));
  }, [items, customer?.id]);

  const total = subtotal + (shipping?.amount || 0);

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)] md:text-2xl">
          Carrinho
        </h1>
        {items.length === 0 ? (
          <div className="rounded-2xl bg-[var(--color-accent)] p-8 text-center">
            <p className="text-gray-500">Seu carrinho está vazio</p>
            <Link
              href="/catalogo"
              className="mt-4 inline-block rounded-full bg-[var(--color-primary)] px-6 py-2 text-sm font-medium text-white"
            >
              Ver catálogo
            </Link>
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-8">
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={`${item.product_id}-${item.size}`}
                  className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5"
                >
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt=""
                      className="h-20 w-16 rounded-lg object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-gray-400">Tam. {item.size}</p>
                    <p className="text-sm font-semibold text-[var(--color-primary)]">
                      {formatCurrency(
                        (Number(item.sale_price) + Number(item.sale_freight)) *
                          item.quantity
                      )}
                    </p>
                    <div className="mt-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.product_id,
                            item.size,
                            item.quantity - 1
                          )
                        }
                        className="rounded-full p-1 hover:bg-gray-100"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="text-sm">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.product_id,
                            item.size,
                            item.quantity + 1
                          )
                        }
                        className="rounded-full p-1 hover:bg-gray-100"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.product_id, item.size)}
                        className="ml-auto rounded-full p-1 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 space-y-2 rounded-2xl bg-[var(--color-accent)] p-4 text-sm lg:sticky lg:top-24 lg:mt-0">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {shipping && (
                <div className="flex justify-between">
                  <span>Frete {shipping.label && `(${shipping.label})`}</span>
                  <span>
                    {shipping.blocked
                      ? "Indisponível"
                      : formatCurrency(shipping.amount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--color-primary)]/10 pt-2 font-semibold">
                <span>Total</span>
                <span className="text-[var(--color-primary)]">
                  {formatCurrency(total)}
                </span>
              </div>
              {!customer && (
                <p className="pt-2 text-center text-sm text-amber-600">
                  <Link href="/conta" className="underline">
                    Faça login
                  </Link>{" "}
                  para calcular frete e finalizar
                </p>
              )}
              <Link
                href="/checkout"
                className={`mt-4 flex w-full items-center justify-center rounded-full py-3.5 text-sm font-semibold text-white md:py-4 md:text-base ${
                  shipping?.blocked
                    ? "pointer-events-none bg-gray-300"
                    : "bg-[var(--color-primary)]"
                }`}
              >
                Finalizar compra
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
