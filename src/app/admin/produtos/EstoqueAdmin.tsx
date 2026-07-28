"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import { SIZES, SIZE_LABELS, sizeDisplayLabel } from "@/lib/sizes";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

type StockMovement = {
  id: string;
  product_size: string;
  movement_type: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  reason: string;
  created_at: string;
};

const MOVEMENT_LABELS: Record<string, string> = {
  in: "Entrada",
  out_sale: "Saída (venda)",
  out_other: "Saída",
  adjust: "Ajuste",
};

export default function EstoqueAdmin() {
  const searchParams = useSearchParams();
  const productId = searchParams.get("id");
  const supabase = createClient();

  const [product, setProduct] = useState<Product | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>(
    Object.fromEntries(SIZES.map((s) => [s, 0]))
  );
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [message, setMessage] = useState("");
  const [stockBusy, setStockBusy] = useState(false);
  const [stockForm, setStockForm] = useState({
    size: "M",
    mode: "in" as "in" | "adjust" | "out_other",
    quantity: 1,
    reason: "",
  });

  async function loadProduct() {
    if (!productId) {
      setProduct(null);
      return;
    }
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .maybeSingle();
    if (!data) {
      setProduct(null);
      return;
    }
    const { data: sizeRows } = await supabase
      .from("product_sizes")
      .select("size, stock")
      .eq("product_id", productId);
    const sizeMap = Object.fromEntries(
      SIZES.map((s) => [s, sizeRows?.find((r) => r.size === s)?.stock ?? 0])
    );
    setSizes(sizeMap);
    setProduct({
      ...(data as Product),
      sizes: SIZES.map((s) => ({ size: s, stock: sizeMap[s] })),
    });
  }

  async function loadMovements() {
    if (!productId) {
      setMovements([]);
      return;
    }
    const { data, error } = await supabase
      .from("stock_movements")
      .select(
        "id, product_size, movement_type, quantity, stock_before, stock_after, reason, created_at"
      )
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      setMovements([]);
      return;
    }
    setMovements((data as StockMovement[]) || []);
  }

  useEffect(() => {
    void loadProduct();
    void loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function submitStockMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !product) return;
    setStockBusy(true);
    setMessage("");
    const qty = Math.max(0, Number(stockForm.quantity) || 0);
    const { error } = await supabase.rpc("adjust_product_stock", {
      p_product_id: productId,
      p_size: stockForm.size,
      p_movement_type: stockForm.mode,
      p_quantity: qty,
      p_reason:
        stockForm.reason.trim() ||
        (stockForm.mode === "in"
          ? "Entrada de estoque"
          : stockForm.mode === "adjust"
            ? "Ajuste de inventário"
            : "Saída de estoque"),
      p_unit_cost:
        stockForm.mode === "in"
          ? Number(product.purchase_price) + Number(product.purchase_freight)
          : null,
      p_reference_type: "manual",
      p_reference_id: null,
      p_set_absolute: stockForm.mode === "adjust",
    });
    setStockBusy(false);
    if (error) {
      setMessage(
        error.message.includes("adjust_product_stock")
          ? "Rode a migration 034 no Supabase para ativar o histórico de estoque."
          : error.message
      );
      return;
    }
    setMessage("Movimento de estoque registrado.");
    setStockForm((f) => ({ ...f, quantity: 1, reason: "" }));
    await loadProduct();
    await loadMovements();
  }

  if (!productId) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold text-[var(--color-primary)]">
          Movimentar estoque
        </h1>
        <p className="text-sm text-gray-500">
          Escolha um produto na{" "}
          <Link href="/admin/produtos" className="underline">
            lista
          </Link>
          .
        </p>
      </div>
    );
  }

  if (!product) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold text-[var(--color-primary)]">
          Movimentar estoque
        </h1>
        <p className="text-sm text-gray-500">Produto não encontrado.</p>
        <Link
          href="/admin/produtos"
          className="mt-2 inline-block text-sm text-[var(--color-primary)] underline"
        >
          Voltar à lista
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          href="/admin/produtos"
          className="text-sm text-[var(--color-primary)]"
        >
          ← Lista de produtos
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[var(--color-primary)]">
          Estoque · {product.name}
        </h1>
        <p className="text-sm text-gray-500">
          {formatCurrency(Number(product.sale_price))} ·{" "}
          {product.active ? "Ativo" : "Inativo"}
        </p>
      </div>

      {message && (
        <p className="rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-gray-700">
          {message}
        </p>
      )}

      <AdminCard title="Estoque atual">
        <div className="flex flex-wrap gap-2">
          {SIZES.map((s) => (
            <div
              key={s}
              className="min-w-[4.5rem] flex-1 rounded-lg bg-gray-50 px-2 py-2 text-center text-sm ring-1 ring-gray-100"
            >
              <div className="text-xs text-gray-500">{SIZE_LABELS[s]}</div>
              <div className="font-semibold">{sizes[s]}</div>
            </div>
          ))}
        </div>
      </AdminCard>

      <AdminCard title="Registrar movimento">
        <form onSubmit={submitStockMovement} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">Tamanho</label>
              <select
                value={stockForm.size}
                onChange={(e) =>
                  setStockForm({ ...stockForm, size: e.target.value })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {SIZE_LABELS[s]} (atual: {sizes[s]})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <select
                value={stockForm.mode}
                onChange={(e) =>
                  setStockForm({
                    ...stockForm,
                    mode: e.target.value as typeof stockForm.mode,
                  })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="in">Entrada (+)</option>
                <option value="adjust">Ajuste (definir total)</option>
                <option value="out_other">Saída / perda (−)</option>
              </select>
            </div>
          </div>
          <AdminInput
            label={
              stockForm.mode === "adjust" ? "Estoque desejado" : "Quantidade"
            }
            type="number"
            min={0}
            value={stockForm.quantity}
            onChange={(e) =>
              setStockForm({
                ...stockForm,
                quantity: Number(e.target.value),
              })
            }
            required
          />
          <AdminInput
            label="Motivo"
            value={stockForm.reason}
            onChange={(e) =>
              setStockForm({ ...stockForm, reason: e.target.value })
            }
            placeholder="Ex.: compra fornecedor, inventário, perda"
          />
          <AdminFormActions>
            <AdminButton type="submit" disabled={stockBusy}>
              {stockBusy ? "Salvando…" : "Registrar movimento"}
            </AdminButton>
            <AdminButton
              type="button"
              variant="secondary"
              onClick={() =>
                (window.location.href = `/admin/produtos/cadastro?edit=${productId}`)
              }
            >
              Editar produto
            </AdminButton>
          </AdminFormActions>
        </form>
      </AdminCard>

      <AdminCard title="Histórico recente">
        {movements.length === 0 ? (
          <p className="text-xs text-gray-400">
            Nenhum movimento ainda (ou migration 034 não aplicada).
          </p>
        ) : (
          <ul className="max-h-[420px] space-y-2 overflow-y-auto text-xs">
            {movements.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-gray-100 px-2 py-2"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {MOVEMENT_LABELS[m.movement_type] || m.movement_type} ·{" "}
                    {sizeDisplayLabel(m.product_size)}
                  </span>
                  <span
                    className={
                      m.quantity >= 0 ? "text-green-700" : "text-red-600"
                    }
                  >
                    {m.quantity >= 0 ? "+" : ""}
                    {m.quantity}
                  </span>
                </div>
                <p className="text-gray-500">
                  {m.stock_before} → {m.stock_after}
                  {m.reason ? ` · ${m.reason}` : ""}
                </p>
                <p className="text-gray-400">
                  {new Date(m.created_at).toLocaleString("pt-BR")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
