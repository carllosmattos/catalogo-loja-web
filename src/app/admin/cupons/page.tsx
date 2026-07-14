"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminInput, AdminButton } from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import { formatCurrency } from "@/lib/utils";
import type { Coupon } from "@/types";

export default function AdminCuponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState({
    code: "",
    title: "",
    image_url: "",
    discount_type: "percent" as "percent" | "fixed",
    discount_value: 10,
    max_uses: 50,
    active: true,
  });
  const [message, setMessage] = useState("");
  const supabase = createClient();

  async function load() {
    const { data } = await supabase
      .from("coupons")
      .select("*")
      .order("created_at", { ascending: false });
    setCoupons((data as Coupon[]) || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const code = form.code.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) {
      setMessage("Informe o código");
      return;
    }
    const { error } = await supabase.from("coupons").insert({
      code,
      title: form.title.trim() || code,
      image_url: form.image_url || "",
      discount_type: form.discount_type,
      discount_value: form.discount_value,
      max_uses: Math.max(0, Number(form.max_uses) || 0),
      active: form.active,
      used_count: 0,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setForm({
      code: "",
      title: "",
      image_url: "",
      discount_type: "percent",
      discount_value: 10,
      max_uses: 50,
      active: true,
    });
    setMessage("Cupom criado");
    load();
  }

  async function setActive(id: string, active: boolean) {
    await supabase.from("coupons").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Cupons</h1>
      {message && <p className="mb-4 text-sm text-gray-600">{message}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Novo cupom">
          <form onSubmit={save} className="space-y-3">
            <AdminInput
              label="Código"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="EX: VERAO10"
              required
            />
            <AdminInput
              label="Título"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex: 10% off verão"
            />
            <ImageUploadField
              label="Imagem do cupom"
              folder="coupons"
              value={form.image_url}
              onChange={(url) => setForm({ ...form, image_url: url })}
            />
            <div>
              <label className="text-sm font-medium">Tipo de desconto</label>
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
              label="Valor"
              type="number"
              step="0.01"
              value={form.discount_value}
              onChange={(e) =>
                setForm({ ...form, discount_value: Number(e.target.value) })
              }
            />
            <AdminInput
              label="Quantidade de usos"
              type="number"
              min={0}
              value={form.max_uses}
              onChange={(e) =>
                setForm({ ...form, max_uses: Number(e.target.value) })
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Ativo
            </label>
            <AdminButton type="submit">Criar cupom</AdminButton>
          </form>
        </AdminCard>
        <AdminCard title="Lista">
          <ul className="space-y-2">
            {coupons.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-lg border p-3 text-sm"
              >
                {c.image_url ? (
                  <img
                    src={c.image_url}
                    alt=""
                    className="h-12 w-12 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                    —
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.code}</p>
                  <p className="truncate text-gray-400">
                    {c.title} ·{" "}
                    {c.discount_type === "percent"
                      ? `${c.discount_value}%`
                      : formatCurrency(Number(c.discount_value))}{" "}
                    · {c.used_count}/{c.max_uses} usos
                  </p>
                </div>
                <AdminButton
                  variant="secondary"
                  onClick={() => setActive(c.id, !c.active)}
                >
                  {c.active ? "Invalidar" : "Reativar"}
                </AdminButton>
              </li>
            ))}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
