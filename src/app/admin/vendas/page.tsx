"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import { formatCurrency, normalizeCpf } from "@/lib/utils";

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
  const [cpfHint, setCpfHint] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const nameFromLookup = useRef(false);
  const supabase = createClient();

  async function load() {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase
        .from("sales")
        .select("*, products(name)")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("products").select("id, name").eq("active", true),
    ]);
    setSales(s || []);
    setProducts(p || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function lookupCustomerByCpf(raw: string) {
    const cpf = normalizeCpf(raw);
    if (!cpf) {
      setCpfHint(null);
      return;
    }
    setLookingUp(true);
    const { data } = await supabase
      .from("customers")
      .select("id, name, cpf")
      .eq("cpf", cpf)
      .maybeSingle();
    setLookingUp(false);

    if (data?.name) {
      nameFromLookup.current = true;
      setForm((f) => ({ ...f, customer_name: String(data.name) }));
      setCpfHint("Cliente encontrado — nome preenchido.");
    } else {
      setCpfHint(
        "CPF sem cadastro. Nome ficará só na venda (não cria cliente)."
      );
      if (nameFromLookup.current) {
        nameFromLookup.current = false;
        setForm((f) => ({ ...f, customer_name: "" }));
      }
    }
  }

  function onCpfChange(value: string) {
    setForm((f) => ({ ...f, customer_cpf: value }));
    setCpfHint(null);
    const digits = value.replace(/\D/g, "");
    if (digits.length === 11) {
      lookupCustomerByCpf(value);
    }
  }

  async function registerSale(e: React.FormEvent) {
    e.preventDefault();
    const product = products.find((p) => p.id === form.product_id);
    // Só grava CPF/nome na venda — não cria/atualiza registro em customers
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
    setForm({
      customer_cpf: "",
      customer_name: "",
      product_id: "",
      product_size: "M",
      quantity: 1,
      preco_final: 0,
    });
    setCpfHint(null);
    nameFromLookup.current = false;
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Vendas
      </h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Registrar venda manual">
          <form onSubmit={registerSale} className="space-y-3">
            <div>
              <AdminInput
                label="CPF cliente"
                value={form.customer_cpf}
                onChange={(e) => onCpfChange(e.target.value)}
                onBlur={(e) => lookupCustomerByCpf(e.target.value)}
              />
              {lookingUp && (
                <p className="mt-1 text-xs text-gray-400">Buscando cliente…</p>
              )}
              {!lookingUp && cpfHint && (
                <p className="mt-1 text-xs text-gray-500">{cpfHint}</p>
              )}
            </div>
            <AdminInput
              label="Nome cliente"
              value={form.customer_name}
              onChange={(e) => {
                nameFromLookup.current = false;
                setForm({ ...form, customer_name: e.target.value });
              }}
            />
            <div>
              <label className="text-sm font-medium">Produto</label>
              <select
                value={form.product_id}
                onChange={(e) =>
                  setForm({ ...form, product_id: e.target.value })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                required
              >
                <option value="">Selecione</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <AdminInput
              label="Tamanho"
              value={form.product_size}
              onChange={(e) =>
                setForm({ ...form, product_size: e.target.value })
              }
            />
            <AdminInput
              label="Quantidade"
              type="number"
              value={form.quantity}
              onChange={(e) =>
                setForm({ ...form, quantity: Number(e.target.value) })
              }
            />
            <AdminInput
              label="Preço final"
              type="number"
              step="0.01"
              value={form.preco_final}
              onChange={(e) =>
                setForm({ ...form, preco_final: Number(e.target.value) })
              }
            />
            <AdminFormActions>
              <AdminButton type="submit">Registrar venda</AdminButton>
            </AdminFormActions>
          </form>
        </AdminCard>
        <AdminCard title="Histórico">
          <ul className="max-h-[500px] space-y-2 overflow-y-auto text-sm">
            {sales.map((s) => (
              <li key={String(s.id)} className="rounded-lg border p-3">
                <p className="font-medium">{String(s.product_name)}</p>
                <p className="text-gray-400">
                  {formatCurrency(Number(s.preco_final))} ·{" "}
                  {String(s.product_size)}
                  {s.customer_name
                    ? ` · ${String(s.customer_name)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
