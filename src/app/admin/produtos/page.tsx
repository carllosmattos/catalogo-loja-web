"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import { SIZES, SIZE_LABELS } from "@/lib/sizes";
import { formatCurrency } from "@/lib/utils";
import type { Product, Category, Gift } from "@/types";

type GiftLinkForm = { gift_id: string; quantity_per_sale: number };

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

const PRICE_LABELS: Record<
  "purchase_price" | "purchase_freight" | "sale_price" | "sale_freight",
  string
> = {
  purchase_price: "Preço de compra",
  purchase_freight: "Frete na compra",
  sale_price: "Preço de venda",
  sale_freight: "Frete na venda",
};

const MOVEMENT_LABELS: Record<string, string> = {
  in: "Entrada",
  out_sale: "Saída (venda)",
  out_other: "Saída",
  adjust: "Ajuste",
};

export default function AdminProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    category_id: "",
    purchase_price: 0,
    purchase_freight: 0,
    sale_price: 0,
    sale_freight: 0,
    image_urls: [] as string[],
    new_image: "",
    sizes: Object.fromEntries(SIZES.map((s) => [s, 0])) as Record<string, number>,
    gift_links: [] as GiftLinkForm[],
  });
  const [stockForm, setStockForm] = useState({
    size: "M",
    mode: "in" as "in" | "adjust" | "out_other",
    quantity: 1,
    reason: "",
  });
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [message, setMessage] = useState("");
  const [stockBusy, setStockBusy] = useState(false);

  const supabase = createClient();

  async function load() {
    const [{ data: prods }, { data: cats }, { data: giftRows }] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("gifts").select("*").eq("active", true).order("name"),
    ]);
    const ids = (prods || []).map((p) => p.id);
    const { data: sizeRows } = ids.length
      ? await supabase
          .from("product_sizes")
          .select("product_id, size, stock")
          .in("product_id", ids)
      : { data: [] as { product_id: string; size: string; stock: number }[] };
    const sizeMap: Record<string, Record<string, number>> = {};
    for (const row of sizeRows || []) {
      if (!sizeMap[row.product_id]) sizeMap[row.product_id] = {};
      sizeMap[row.product_id][row.size] = row.stock;
    }
    setProducts(
      (prods || []).map((p) => ({
        ...p,
        sizes: SIZES.map((s) => ({
          size: s,
          stock: sizeMap[p.id]?.[s] ?? 0,
        })),
      }))
    );
    setCategories(cats || []);
    setGifts((giftRows as Gift[]) || []);
  }

  async function loadMovements(productId: string) {
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
    load();
  }, []);

  function resetForm() {
    setForm({
      name: "",
      description: "",
      category_id: "",
      purchase_price: 0,
      purchase_freight: 0,
      sale_price: 0,
      sale_freight: 0,
      image_urls: [],
      new_image: "",
      sizes: Object.fromEntries(SIZES.map((s) => [s, 0])),
      gift_links: [],
    });
    setStockForm({ size: "M", mode: "in", quantity: 1, reason: "" });
    setMovements([]);
  }

  async function applyInitialStock(productId: string) {
    for (const s of SIZES) {
      const qty = Number(form.sizes[s]) || 0;
      if (qty <= 0) {
        await supabase.from("product_sizes").upsert(
          { product_id: productId, size: s, stock: 0 },
          { onConflict: "product_id,size" }
        );
        continue;
      }
      const { error } = await supabase.rpc("adjust_product_stock", {
        p_product_id: productId,
        p_size: s,
        p_movement_type: "in",
        p_quantity: qty,
        p_reason: "Estoque inicial",
        p_unit_cost: form.purchase_price + form.purchase_freight,
        p_reference_type: "manual",
        p_reference_id: null,
        p_set_absolute: false,
      });
      if (error) {
        // Fallback se a migration ainda não foi aplicada
        await supabase.from("product_sizes").upsert(
          { product_id: productId, size: s, stock: qty },
          { onConflict: "product_id,size" }
        );
      }
    }
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const images = [...form.image_urls];
    if (form.new_image && !images.includes(form.new_image)) {
      images.push(form.new_image);
    }
    const payload = {
      name: form.name,
      description: form.description,
      category_id: form.category_id || null,
      category: categories.find((c) => c.id === form.category_id)?.name || "",
      purchase_price: form.purchase_price,
      purchase_freight: form.purchase_freight,
      sale_price: form.sale_price,
      sale_freight: form.sale_freight,
      image_urls: images,
      active: true,
    };
    let productId = editing;
    if (editing) {
      const { error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", editing);
      if (error) {
        setMessage(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("products")
        .insert(payload)
        .select()
        .single();
      if (error) {
        setMessage(error.message);
        return;
      }
      productId = data?.id;
      if (productId) {
        await applyInitialStock(productId);
      }
    }
    if (productId) {
      await supabase.from("product_gifts").delete().eq("product_id", productId);
      const links = form.gift_links.filter((l) => l.gift_id);
      if (links.length) {
        await supabase.from("product_gifts").insert(
          links.map((l) => ({
            product_id: productId,
            gift_id: l.gift_id,
            quantity_per_sale: Math.max(1, Number(l.quantity_per_sale) || 1),
          }))
        );
      }
    }
    setMessage(
      editing
        ? "Produto atualizado. Preços novos valem só para vendas futuras — lucro passado não muda."
        : "Produto criado com estoque inicial registrado."
    );
    setEditing(null);
    resetForm();
    load();
  }

  async function editProduct(p: Product) {
    setEditing(p.id);
    setMessage("");
    const { data: links } = await supabase
      .from("product_gifts")
      .select("gift_id, quantity_per_sale")
      .eq("product_id", p.id);
    setForm({
      name: p.name,
      description: p.description || "",
      category_id: p.category_id || "",
      purchase_price: Number(p.purchase_price),
      purchase_freight: Number(p.purchase_freight),
      sale_price: Number(p.sale_price),
      sale_freight: Number(p.sale_freight),
      image_urls: p.image_urls || [],
      new_image: "",
      sizes: Object.fromEntries(
        SIZES.map((s) => [s, p.sizes?.find((x) => x.size === s)?.stock ?? 0])
      ),
      gift_links: (links || []).map((l) => ({
        gift_id: String(l.gift_id),
        quantity_per_sale: Number(l.quantity_per_sale) || 1,
      })),
    });
    setStockForm({ size: "M", mode: "in", quantity: 1, reason: "" });
    await loadMovements(p.id);
  }

  async function submitStockMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setStockBusy(true);
    setMessage("");
    const qty = Math.max(0, Number(stockForm.quantity) || 0);
    const { error } = await supabase.rpc("adjust_product_stock", {
      p_product_id: editing,
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
          ? form.purchase_price + form.purchase_freight
          : null,
      p_reference_type: "manual",
      p_reference_id: null,
      p_set_absolute: stockForm.mode === "adjust",
    });
    setStockBusy(false);
    if (error) {
      setMessage(
        error.message.includes("adjust_product_stock")
          ? "Rode a migration 034 no Supabase (SQL Editor) para ativar o histórico de estoque."
          : error.message
      );
      return;
    }
    setMessage("Movimento de estoque registrado.");
    setStockForm((f) => ({ ...f, quantity: 1, reason: "" }));
    await load();
    await loadMovements(editing);
    const { data: sizeRows } = await supabase
      .from("product_sizes")
      .select("size, stock")
      .eq("product_id", editing);
    setForm((f) => ({
      ...f,
      sizes: Object.fromEntries(
        SIZES.map((s) => [
          s,
          sizeRows?.find((r) => r.size === s)?.stock ?? 0,
        ])
      ),
    }));
  }

  function toggleGift(giftId: string, checked: boolean) {
    if (checked) {
      setForm((f) => ({
        ...f,
        gift_links: [
          ...f.gift_links,
          { gift_id: giftId, quantity_per_sale: 1 },
        ],
      }));
    } else {
      setForm((f) => ({
        ...f,
        gift_links: f.gift_links.filter((l) => l.gift_id !== giftId),
      }));
    }
  }

  function setGiftQty(giftId: string, qty: number) {
    setForm((f) => ({
      ...f,
      gift_links: f.gift_links.map((l) =>
        l.gift_id === giftId
          ? { ...l, quantity_per_sale: Math.max(1, qty) }
          : l
      ),
    }));
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from("products").update({ active: !active }).eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Produtos
      </h1>
      {message && <p className="mb-4 text-sm text-green-700">{message}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <AdminCard title={editing ? "Editar produto" : "Novo produto"}>
            <form onSubmit={saveProduct} className="space-y-3">
              <AdminInput
                label="Nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <div>
                <label className="text-sm font-medium">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  rows={3}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Categoria</label>
                <select
                  value={form.category_id}
                  onChange={(e) =>
                    setForm({ ...form, category_id: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    "purchase_price",
                    "purchase_freight",
                    "sale_price",
                    "sale_freight",
                  ] as const
                ).map((key) => (
                  <AdminInput
                    key={key}
                    label={PRICE_LABELS[key]}
                    type="number"
                    step="0.01"
                    value={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: Number(e.target.value) })
                    }
                  />
                ))}
              </div>
              <p className="text-xs text-gray-500">
                Alterar preço/custo aqui não muda o lucro de vendas já
                registradas — só vale para vendas futuras.
              </p>

              {!editing ? (
                <div>
                  <label className="text-sm font-medium">
                    Estoque inicial por tamanho
                  </label>
                  <div className="mt-1 flex gap-2">
                    {SIZES.map((s) => (
                      <div key={s} className="flex-1">
                        <span className="text-xs text-gray-500">
                          {SIZE_LABELS[s]}
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={form.sizes[s]}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              sizes: {
                                ...form.sizes,
                                [s]: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full rounded-lg border px-2 py-1 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-sm font-medium">Estoque atual</p>
                  <div className="mt-2 flex gap-2">
                    {SIZES.map((s) => (
                      <div
                        key={s}
                        className="flex-1 rounded-lg bg-white px-2 py-2 text-center text-sm ring-1 ring-gray-100"
                      >
                        <div className="text-xs text-gray-500">
                          {SIZE_LABELS[s]}
                        </div>
                        <div className="font-semibold">{form.sizes[s]}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Para alterar quantidade, use o painel de movimentação abaixo
                    (gera histórico).
                  </p>
                </div>
              )}

              <div className="space-y-2 rounded-xl border border-gray-100 p-3">
                <p className="text-sm font-medium">Brindes vinculados</p>
                <p className="text-xs text-gray-500">
                  Cadastre brindes em Admin → Brindes e associe aqui.
                </p>
                {gifts.length === 0 ? (
                  <p className="text-xs text-amber-600">Nenhum brinde ativo.</p>
                ) : (
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {gifts.map((g) => {
                      const linked = form.gift_links.find(
                        (l) => l.gift_id === g.id
                      );
                      return (
                        <li
                          key={g.id}
                          className="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(linked)}
                              onChange={(e) =>
                                toggleGift(g.id, e.target.checked)
                              }
                            />
                            <span className="truncate">{g.name}</span>
                          </label>
                          {linked && (
                            <input
                              type="number"
                              min={1}
                              value={linked.quantity_per_sale}
                              onChange={(e) =>
                                setGiftQty(g.id, Number(e.target.value))
                              }
                              className="w-16 rounded-lg border px-2 py-1 text-sm"
                              title="Qtd por venda"
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <ImageUploadField
                  label="Adicionar foto"
                  folder="products"
                  value={form.new_image}
                  onChange={(url) => {
                    if (!url) {
                      setForm((f) => ({ ...f, new_image: "" }));
                      return;
                    }
                    setForm((f) => ({
                      ...f,
                      new_image: "",
                      image_urls: f.image_urls.includes(url)
                        ? f.image_urls
                        : [...f.image_urls, url],
                    }));
                  }}
                />
                {form.image_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.image_urls.map((url) => (
                      <div key={url} className="relative">
                        <img
                          src={url}
                          alt=""
                          className="h-16 w-16 rounded object-cover ring-1 ring-black/5"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              image_urls: f.image_urls.filter((u) => u !== url),
                            }))
                          }
                          className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-xs text-white"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <AdminFormActions>
                <AdminButton type="submit">Salvar produto</AdminButton>
                {editing && (
                  <AdminButton
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setEditing(null);
                      resetForm();
                    }}
                  >
                    Cancelar
                  </AdminButton>
                )}
              </AdminFormActions>
            </form>
          </AdminCard>

          {editing && (
            <AdminCard title="Movimentar estoque">
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
                          {SIZE_LABELS[s]} (atual: {form.sizes[s]})
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
                    stockForm.mode === "adjust"
                      ? "Estoque desejado"
                      : "Quantidade"
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
                </AdminFormActions>
              </form>

              <div className="mt-4 border-t pt-4">
                <p className="mb-2 text-sm font-medium">Histórico recente</p>
                {movements.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    Nenhum movimento ainda (ou migration 034 não aplicada).
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-2 overflow-y-auto text-xs">
                    {movements.map((m) => (
                      <li
                        key={m.id}
                        className="rounded-lg border border-gray-100 px-2 py-2"
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">
                            {MOVEMENT_LABELS[m.movement_type] || m.movement_type}{" "}
                            · {SIZE_LABELS[m.product_size] || m.product_size}
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
              </div>
            </AdminCard>
          )}
        </div>

        <AdminCard title="Lista">
          <ul className="max-h-[600px] space-y-2 overflow-y-auto">
            {products.map((p) => {
              const total =
                p.sizes?.reduce((s, row) => s + Number(row.stock || 0), 0) ??
                Number(p.stock) ||
                0;
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {p.image_urls?.[0] && (
                      <img
                        src={p.image_urls[0]}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-gray-400">
                        {formatCurrency(Number(p.sale_price))} · Estoque {total}{" "}
                        · {p.active ? "Ativo" : "Inativo"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <AdminButton
                      variant="secondary"
                      onClick={() => editProduct(p)}
                    >
                      Editar
                    </AdminButton>
                    <AdminButton
                      variant="secondary"
                      onClick={() => toggleActive(p.id, p.active)}
                    >
                      {p.active ? "Arquivar" : "Ativar"}
                    </AdminButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
