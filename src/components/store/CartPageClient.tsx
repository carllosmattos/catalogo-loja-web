"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCartStore, useCustomerStore } from "@/stores";
import { validateCouponClient } from "@/lib/coupons";
import { formatCurrency, cn } from "@/lib/utils";
import type { ShippingMethod, StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";

interface CartPageClientProps {
  settings: StoreSettings;
}

interface ShippingState {
  amount: number;
  label: string;
  blocked: boolean;
  delivery_range?: string | null;
  source?: string;
}

export function CartPageClient({ settings }: CartPageClientProps) {
  const {
    items,
    updateQuantity,
    removeItem,
    shippingMethod,
    setShippingMethod,
    couponCode,
    coupon,
    setCoupon,
    clearCoupon,
  } = useCartStore();
  const customer = useCustomerStore((s) => s.customer);
  const setCustomer = useCustomerStore((s) => s.setCustomer);
  const [shipping, setShipping] = useState<ShippingState | null>(null);
  const [loadingShip, setLoadingShip] = useState(false);
  const [shipError, setShipError] = useState("");
  const [couponInput, setCouponInput] = useState(couponCode || "");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");

  const subtotal = items.reduce(
    (s, i) => s + (Number(i.sale_price) + Number(i.sale_freight)) * i.quantity,
    0
  );
  const discountAmount = coupon?.ok ? Number(coupon.discount_amount) || 0 : 0;

  useEffect(() => {
    if (!items.length || !customer?.id) {
      setShipping(null);
      setShipError("");
      return;
    }
    setLoadingShip(true);
    setShipError("");
    fetch("/api/shipping/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        cart: items,
        shippingMethod,
      }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 404) {
          setShipping(null);
          setCustomer(null);
          setShipError("Sessão expirada. Entre de novo em Conta.");
          return;
        }
        if (!r.ok || data?.error != null || typeof data?.amount !== "number") {
          setShipping(null);
          setShipError(data?.error ? String(data.error) : "Não foi possível calcular o frete.");
          return;
        }
        setShipping({
          amount: Number(data.amount) || 0,
          label: String(data.label || ""),
          blocked: Boolean(data.blocked),
          delivery_range: data.delivery_range ? String(data.delivery_range) : null,
          source: data.source ? String(data.source) : undefined,
        });
      })
      .catch(() => {
        setShipping(null);
        setShipError("Erro ao calcular frete.");
      })
      .finally(() => setLoadingShip(false));
  }, [items, customer?.id, shippingMethod, setCustomer]);

  useEffect(() => {
    if (!coupon?.ok || !couponCode) return;
    let cancelled = false;
    validateCouponClient(couponCode, customer?.id, subtotal).then((result) => {
      if (cancelled) return;
      if (result.ok) setCoupon(String(result.code || couponCode), result);
      else clearCoupon();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só revalida quando subtotal/customer mudam
  }, [subtotal, customer?.id]);

  const freightAmount =
    shippingMethod === "uber" ? 0 : shipping?.amount || 0;
  const total = Math.max(subtotal - discountAmount, 0) + freightAmount;

  function selectMethod(method: ShippingMethod) {
    setShippingMethod(method);
  }

  async function applyCoupon() {
    setCouponLoading(true);
    setCouponError("");
    try {
      const result = await validateCouponClient(
        couponInput,
        customer?.id,
        subtotal
      );
      if (!result.ok) {
        clearCoupon();
        setCouponError(result.error || "Cupom inválido");
        return;
      }
      setCoupon(String(result.code || couponInput), result);
    } catch (e) {
      setCouponError(e instanceof Error ? e.message : "Erro ao validar cupom");
    } finally {
      setCouponLoading(false);
    }
  }

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
            <div className="mt-6 space-y-3 rounded-2xl bg-[var(--color-accent)] p-4 text-sm lg:sticky lg:top-24 lg:mt-0">
              {customer && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Como deseja receber?
                  </p>
                  <button
                    type="button"
                    onClick={() => selectMethod("delivery")}
                    className={cn(
                      "w-full rounded-xl border bg-white p-3 text-left transition-colors",
                      shippingMethod === "delivery"
                        ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
                        : "border-transparent hover:border-gray-200"
                    )}
                  >
                    <p className="font-medium text-gray-900">Entrega (transportadora)</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Frete calculado para o seu endereço
                    </p>
                    {shippingMethod === "delivery" && shipping && !shipping.blocked && (
                      <p className="mt-1 text-xs text-[var(--color-primary)]">
                        {formatCurrency(shipping.amount)}
                        {shipping.delivery_range
                          ? ` · prazo ${shipping.delivery_range}`
                          : ""}
                      </p>
                    )}
                    {shippingMethod === "delivery" && loadingShip && (
                      <p className="mt-1 text-xs text-gray-400">Calculando frete...</p>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectMethod("uber")}
                    className={cn(
                      "w-full rounded-xl border bg-white p-3 text-left transition-colors",
                      shippingMethod === "uber"
                        ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
                        : "border-transparent hover:border-gray-200"
                    )}
                  >
                    <p className="font-medium text-gray-900">Uber</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Você solicita o Uber e combina com a loja no WhatsApp. Frete
                      não entra no total do site.
                    </p>
                    {shippingMethod === "uber" && (
                      <p className="mt-1 text-xs text-[var(--color-primary)]">
                        Frete a combinar · R$ 0,00 no checkout
                      </p>
                    )}
                  </button>
                  {shipError && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {shipError}{" "}
                      <Link href="/conta" className="underline font-medium">
                        Ir para Conta
                      </Link>
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="space-y-2 border-t border-[var(--color-primary)]/10 pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Cupom
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Código"
                    className="min-w-0 flex-1 rounded-xl border border-white/60 bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={applyCoupon}
                    disabled={couponLoading || !couponInput.trim()}
                    className="shrink-0 rounded-full bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {couponLoading ? "..." : "Aplicar"}
                  </button>
                </div>
                {coupon?.ok && (
                  <div className="flex items-center justify-between text-xs text-green-700">
                    <span>
                      {coupon.code}
                      {coupon.title ? ` — ${coupon.title}` : ""} (−
                      {formatCurrency(discountAmount)})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        clearCoupon();
                        setCouponInput("");
                      }}
                      className="underline"
                    >
                      Remover
                    </button>
                  </div>
                )}
                {couponError && (
                  <p className="text-xs text-red-600">{couponError}</p>
                )}
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Desconto</span>
                  <span>−{formatCurrency(discountAmount)}</span>
                </div>
              )}
              {customer && (
                <div className="flex justify-between gap-2">
                  <span className="min-w-0">Frete</span>
                  <span className="shrink-0 text-right">
                    {shippingMethod === "uber"
                      ? "A combinar"
                      : shipping?.blocked
                        ? "Indisponível"
                        : loadingShip
                          ? "..."
                          : formatCurrency(freightAmount)}
                  </span>
                </div>
              )}
              {shippingMethod === "delivery" &&
                shipping?.delivery_range &&
                !shipping.blocked && (
                  <p className="text-xs text-gray-500">
                    Prazo estimado: {shipping.delivery_range}
                  </p>
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
                className={`mt-2 flex w-full items-center justify-center rounded-full py-3.5 text-sm font-semibold text-white md:py-4 md:text-base ${
                  shippingMethod === "delivery" && shipping?.blocked
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
