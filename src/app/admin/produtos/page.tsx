"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminInput, AdminButton, AdminFormActions } from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import { SIZES, SIZE_LABELS } from "@/lib/sizes";
import { formatCurrency } from "@/lib/utils";
import type { Product, Category } from "@/types";

export default function AdminProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
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
    sizes: Object.fromEntries(SIZES.map((s) => [s, 0])),
  });
  const [message, setMessage] = useState("");

  const supabase = createClient();

  async function load() {
    const [{ data: prods }, { data: cats }] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("sort_order"),
    ]);
    const ids = (prods || []).map((p) => p.id);
    const { data: sizeRows } = await supabase
      .from("product_sizes")
      .select("product_id, size, stock")
      .in("product_id", ids);
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
    });
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
      await supabase.from("products").update(payload).eq("id", editing);
    } else {
      const { data } = await supabase.from("products").insert(payload).select().single();
      productId = data?.id;
    }
    if (productId) {
      await supabase.from("product_sizes").delete().eq("product_id", productId);
      await supabase.from("product_sizes").insert(
        SIZES.map((s) => ({
          product_id: productId,
          size: s,
          stock: Number(form.sizes[s]) || 0,
        }))
      );
    }
    setMessage("Salvo!");
    setEditing(null);
    resetForm();
    load();
  }

  function editProduct(p: Product) {
    setEditing(p.id);
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
    });
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from("products").update({ active: !active }).eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Produtos</h1>
      {message && <p className="mb-4 text-sm text-green-600">{message}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title={editing ? "Editar produto" : "Novo produto"}>
          <form onSubmit={saveProduct} className="space-y-3">
            <AdminInput label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <div>
              <label className="text-sm font-medium">Descrição</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Categoria</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["purchase_price", "purchase_freight", "sale_price", "sale_freight"] as const).map((key) => (
                <AdminInput
                  key={key}
                  label={key.replace(/_/g, " ")}
                  type="number"
                  step="0.01"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                />
              ))}
            </div>
            <div>
              <label className="text-sm font-medium">Estoque por tamanho</label>
              <div className="mt-1 flex gap-2">
                {SIZES.map((s) => (
                  <div key={s} className="flex-1">
                    <span className="text-xs text-gray-500">{SIZE_LABELS[s]}</span>
                    <input
                      type="number"
                      min={0}
                      value={form.sizes[s]}
                      onChange={(e) =>
                        setForm({ ...form, sizes: { ...form.sizes, [s]: Number(e.target.value) } })
                      }
                      className="w-full rounded-lg border px-2 py-1 text-sm"
                    />
                  </div>
                ))}
              </div>
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
                      <img src={url} alt="" className="h-16 w-16 rounded object-cover ring-1 ring-black/5" />
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
                <AdminButton type="button" variant="secondary" onClick={() => { setEditing(null); resetForm(); }}>
                  Cancelar
                </AdminButton>
              )}
            </AdminFormActions>
          </form>
        </AdminCard>
        <AdminCard title="Lista">
          <ul className="max-h-[600px] space-y-2 overflow-y-auto">
            {products.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {p.image_urls?.[0] && (
                    <img src={p.image_urls[0]} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-gray-400">{formatCurrency(Number(p.sale_price))} · {p.active ? "Ativo" : "Inativo"}</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <AdminButton variant="secondary" onClick={() => editProduct(p)}>Editar</AdminButton>
                  <AdminButton variant="secondary" onClick={() => toggleActive(p.id, p.active)}>
                    {p.active ? "Arquivar" : "Ativar"}
                  </AdminButton>
                </div>
              </li>
            ))}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
