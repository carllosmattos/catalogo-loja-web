"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminInput, AdminButton } from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import type { Promotion } from "@/types";

export default function AdminPromocoesPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [form, setForm] = useState({
    name: "",
    discount_type: "percent" as "percent" | "fixed",
    discount_value: 10,
    applies_to: "all" as "all" | "selected",
    active: true,
    show_banner: false,
    banner_url: "",
  });
  const supabase = createClient();

  async function load() {
    const { data } = await supabase.from("promotions").select("*").order("created_at", { ascending: false });
    setPromotions(data || []);
  }

  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("promotions").insert({
      ...form,
      product_ids: [],
      image_urls: form.banner_url ? [form.banner_url] : [],
    });
    setForm({ name: "", discount_type: "percent", discount_value: 10, applies_to: "all", active: true, show_banner: false, banner_url: "" });
    load();
  }

  async function toggle(id: string, active: boolean) {
    await supabase.from("promotions").update({ active: !active }).eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Promoções</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Nova promoção">
          <form onSubmit={save} className="space-y-3">
            <AdminInput label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as "percent" | "fixed" })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select>
            </div>
            <AdminInput label="Valor do desconto" type="number" step="0.01" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })} />
            <ImageUploadField
              label="Banner (opcional)"
              folder="promotions"
              value={form.banner_url}
              onChange={(url) => setForm({ ...form, banner_url: url, show_banner: Boolean(url) })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.show_banner} onChange={(e) => setForm({ ...form, show_banner: e.target.checked })} />
              Exibir banner
            </label>
            <AdminButton type="submit">Criar</AdminButton>
          </form>
        </AdminCard>
        <AdminCard title="Lista">
          <ul className="space-y-2">
            {promotions.map((p) => (
              <li key={p.id} className="flex justify-between rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-gray-400">{p.discount_type === "percent" ? `${p.discount_value}%` : `R$ ${p.discount_value}`}</p>
                </div>
                <AdminButton variant="secondary" onClick={() => toggle(p.id, p.active)}>
                  {p.active ? "Desativar" : "Ativar"}
                </AdminButton>
              </li>
            ))}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
