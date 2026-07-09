"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminInput, AdminButton } from "@/components/admin/AdminUI";
import { formatCurrency } from "@/lib/utils";

export default function AdminVendasPage() {
  const [sales, setSales] = useState<Record<string, unknown>[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    customer_cpf: "",
    customer_name: "",
    product_id: "",
    product_size: "M",
    quantity: 1,
    preco_final: 0,
  });
  const supabase = createClient();

  async function load() {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("sales").select("*, products(name)").order("created_at", { ascending: false }).limit(50),
      supabase.from("products").select("id, name").eq("active", true),
    ]);
    setSales(s || []);
    setProducts(p || []);
  }

  useEffect(() => { load(); }, []);

  async function registerSale(e: React.FormEvent) {
    e.preventDefault();
    const product = products.find((p) => p.id === form.product_id);
    await supabase.rpc("register_sale", {
      p_customer_cpf: form.customer_cpf.replace(/\D/g, ""),
      p_customer_name: form.customer_name,
      p_customer_phone: "",
      p_product_id: form.product_id,
      p_product_name: product?.name || "",
      p_product_size: form.product_size,
      p_quantity: form.quantity,
      p_preco_catalogo: form.preco_final,
      p_desconto: 0,
      p_sale_freight: 0,
      p_preco_final: form.preco_final,
      p_lucro: 0,
      p_promotion_id: null,
    });
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Vendas</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Registrar venda manual">
          <form onSubmit={registerSale} className="space-y-3">
            <AdminInput label="CPF cliente" value={form.customer_cpf} onChange={(e) => setForm({ ...form, customer_cpf: e.target.value })} />
            <AdminInput label="Nome cliente" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            <div>
              <label className="text-sm font-medium">Produto</label>
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" required>
                <option value="">Selecione</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <AdminInput label="Tamanho" value={form.product_size} onChange={(e) => setForm({ ...form, product_size: e.target.value })} />
            <AdminInput label="Quantidade" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            <AdminInput label="Preço final" type="number" step="0.01" value={form.preco_final} onChange={(e) => setForm({ ...form, preco_final: Number(e.target.value) })} />
            <AdminButton type="submit">Registrar</AdminButton>
          </form>
        </AdminCard>
        <AdminCard title="Histórico">
          <ul className="max-h-[500px] space-y-2 overflow-y-auto text-sm">
            {sales.map((s) => (
              <li key={String(s.id)} className="rounded-lg border p-3">
                <p className="font-medium">{String(s.product_name)}</p>
                <p className="text-gray-400">{formatCurrency(Number(s.preco_final))} · {String(s.product_size)}</p>
              </li>
            ))}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
