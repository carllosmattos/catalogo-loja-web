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
import type { Promotion } from "@/types";

export default function AdminPromocoesPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>(
    []
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    discount_type: "percent" as "percent" | "fixed",
    discount_value: 10,
    discount_target: "product" as "product" | "shipping",
    applies_to: "all" as "all" | "selected",
    product_ids: [] as string[],
    active: true,
    show_banner: false,
    banner_url: "",
  });
  const supabase = createClient();

  async function load() {
    const [{ data: promos }, { data: prods }] = await Promise.all([
      supabase
        .from("promotions")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id, name")
        .eq("active", true)
        .order("name"),
    ]);
    setPromotions((promos as Promotion[]) || []);
    setProducts(prods || []);
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setForm({
      name: "",
      discount_type: "percent",
      discount_value: 10,
      discount_target: "product",
      applies_to: "all",
      product_ids: [],
      active: true,
      show_banner: false,
      banner_url: "",
    });
    setEditing(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      discount_type: form.discount_type,
      discount_value: form.discount_value,
      discount_target: form.discount_target,
      applies_to:
        form.discount_target === "shipping" ? "all" : form.applies_to,
      product_ids:
        form.discount_target === "shipping" || form.applies_to === "all"
          ? []
          : form.product_ids,
      active: form.active,
      show_banner: form.show_banner,
      banner_url: form.banner_url,
      image_urls: form.banner_url ? [form.banner_url] : [],
    };
    if (editing) {
      await supabase.from("promotions").update(payload).eq("id", editing);
    } else {
      await supabase.from("promotions").insert(payload);
    }
    resetForm();
    load();
  }

  function editPromo(p: Promotion) {
    setEditing(p.id);
    setForm({
      name: p.name,
      discount_type: p.discount_type,
      discount_value: Number(p.discount_value),
      discount_target: p.discount_target === "shipping" ? "shipping" : "product",
      applies_to: p.applies_to === "selected" ? "selected" : "all",
      product_ids: (p.product_ids || []).map(String),
      active: Boolean(p.active),
      show_banner: Boolean(p.show_banner),
      banner_url: p.banner_url || "",
    });
  }

  function toggleProduct(id: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      product_ids: checked
        ? [...f.product_ids, id]
        : f.product_ids.filter((x) => x !== id),
    }));
  }

  async function toggle(id: string, active: boolean) {
    await supabase.from("promotions").update({ active: !active }).eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Promoções
      </h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title={editing ? "Editar promoção" : "Nova promoção"}>
          <form onSubmit={save} className="space-y-3">
            <AdminInput
              label="Nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <div>
              <label className="text-sm font-medium">Abate em</label>
              <select
                value={form.discount_target}
                onChange={(e) => {
                  const target = e.target.value as "product" | "shipping";
                  setForm({
                    ...form,
                    discount_target: target,
                    ...(target === "shipping"
                      ? {
                          discount_type: "percent" as const,
                          discount_value: 100,
                          applies_to: "all" as const,
                          product_ids: [],
                        }
                      : {}),
                  });
                }}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="product">Produtos (preço)</option>
                <option value="shipping">Frete somente</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <select
                value={form.discount_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    discount_type: e.target.value as "percent" | "fixed",
                  })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select>
            </div>
            <AdminInput
              label={
                form.discount_target === "shipping"
                  ? "Desconto no frete"
                  : "Valor do desconto"
              }
              type="number"
              step="0.01"
              value={form.discount_value}
              onChange={(e) =>
                setForm({ ...form, discount_value: Number(e.target.value) })
              }
            />
            {form.discount_target === "product" && (
              <>
                <div>
                  <label className="text-sm font-medium">Aplica em</label>
                  <select
                    value={form.applies_to}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        applies_to: e.target.value as "all" | "selected",
                        product_ids:
                          e.target.value === "all" ? [] : form.product_ids,
                      })
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  >
                    <option value="all">Todos os produtos</option>
                    <option value="selected">Produtos selecionados</option>
                  </select>
                </div>
                {form.applies_to === "selected" && (
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-3">
                    <p className="mb-2 text-xs text-gray-500">
                      Marque os produtos desta promoção
                    </p>
                    {products.length === 0 ? (
                      <p className="text-xs text-amber-600">
                        Nenhum produto ativo.
                      </p>
                    ) : (
                      products.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={form.product_ids.includes(p.id)}
                            onChange={(e) =>
                              toggleProduct(p.id, e.target.checked)
                            }
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
            {form.discount_target === "shipping" && (
              <p className="text-xs text-gray-500">
                100% = frete grátis. Vale para o frete cotado do pedido.
              </p>
            )}
            <ImageUploadField
              label="Banner (opcional)"
              folder="promotions"
              value={form.banner_url}
              onChange={(url) =>
                setForm({
                  ...form,
                  banner_url: url,
                  show_banner: Boolean(url),
                })
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.show_banner}
                onChange={(e) =>
                  setForm({ ...form, show_banner: e.target.checked })
                }
              />
              Exibir banner
            </label>
            <AdminFormActions>
              <AdminButton type="submit">
                {editing ? "Salvar promoção" : "Criar promoção"}
              </AdminButton>
              {editing && (
                <AdminButton
                  type="button"
                  variant="secondary"
                  onClick={resetForm}
                >
                  Cancelar
                </AdminButton>
              )}
            </AdminFormActions>
          </form>
        </AdminCard>
        <AdminCard title="Lista">
          <ul className="space-y-2">
            {promotions.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-gray-400">
                    {p.discount_target === "shipping" ? "Frete" : "Produto"} ·{" "}
                    {p.discount_type === "percent"
                      ? `${p.discount_value}%`
                      : `R$ ${p.discount_value}`}
                    {p.discount_target !== "shipping" &&
                      (p.applies_to === "selected"
                        ? ` · ${(p.product_ids || []).length} produto(s)`
                        : " · todos")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <AdminButton
                    variant="secondary"
                    onClick={() => editPromo(p)}
                  >
                    Editar
                  </AdminButton>
                  <AdminButton
                    variant="secondary"
                    onClick={() => toggle(p.id, p.active)}
                  >
                    {p.active ? "Desativar" : "Ativar"}
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
