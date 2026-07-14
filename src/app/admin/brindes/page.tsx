"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminInput, AdminButton } from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import type { Gift } from "@/types";

export default function AdminBrindesPage() {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [form, setForm] = useState({
    name: "",
    stock: 0,
    purchase_price: 0,
    purchase_freight: 0,
    sale_markup: 0,
    image_url: "",
  });
  const supabase = createClient();

  async function load() {
    const { data } = await supabase.from("gifts").select("*").order("name");
    setGifts(data || []);
  }

  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("gifts").insert({
      name: form.name,
      stock: form.stock,
      purchase_price: form.purchase_price,
      purchase_freight: form.purchase_freight,
      sale_markup: form.sale_markup,
      active: true,
      image_urls: form.image_url ? [form.image_url] : [],
    });
    setForm({
      name: "",
      stock: 0,
      purchase_price: 0,
      purchase_freight: 0,
      sale_markup: 0,
      image_url: "",
    });
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Brindes</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Novo brinde">
          <form onSubmit={save} className="space-y-3">
            <AdminInput label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <AdminInput label="Estoque" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
            <AdminInput label="Preço compra" type="number" step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })} />
            <AdminInput label="Frete compra" type="number" step="0.01" value={form.purchase_freight} onChange={(e) => setForm({ ...form, purchase_freight: Number(e.target.value) })} />
            <AdminInput label="Markup venda" type="number" step="0.01" value={form.sale_markup} onChange={(e) => setForm({ ...form, sale_markup: Number(e.target.value) })} />
            <ImageUploadField
              label="Imagem"
              folder="gifts"
              value={form.image_url}
              onChange={(url) => setForm({ ...form, image_url: url })}
            />
            <AdminButton type="submit">Criar</AdminButton>
          </form>
        </AdminCard>
        <AdminCard title="Lista">
          <ul className="space-y-2">
            {gifts.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                {g.image_urls?.[0] && (
                  <img src={g.image_urls[0]} alt="" className="h-10 w-10 rounded object-cover" />
                )}
                <div>
                  <p className="font-medium">{g.name}</p>
                  <p className="text-gray-400">Estoque: {g.stock}</p>
                </div>
              </li>
            ))}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
