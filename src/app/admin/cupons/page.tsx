"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import { formatCurrency } from "@/lib/utils";
import type { Coupon } from "@/types";

const PROMO_TYPES = [
  { value: "VERAO", label: "VERAO" },
  { value: "FRETE", label: "FRETE" },
  { value: "OUTRO", label: "OUTRO" },
] as const;

const SUFFIX_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SUFFIX_CHARS[b % SUFFIX_CHARS.length]).join(
    ""
  );
}

function normalizeTipo(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 16);
}

function buildCouponCode(tipo: string, suffix: string): string {
  const t = normalizeTipo(tipo) || "OUTRO";
  return `LM-${t}-${suffix}`;
}

export default function AdminCuponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [promoKind, setPromoKind] = useState<"VERAO" | "FRETE" | "OUTRO">(
    "VERAO"
  );
  const [customTipo, setCustomTipo] = useState("");
  const [suffix, setSuffix] = useState(() => randomSuffix());
  const [form, setForm] = useState({
    title: "",
    image_url: "",
    discount_type: "percent" as "percent" | "fixed",
    discount_value: 10,
    discount_target: "product" as "product" | "shipping",
    max_uses: 50,
    active: true,
  });
  const [message, setMessage] = useState("");
  const supabase = createClient();

  const tipo =
    promoKind === "OUTRO" ? normalizeTipo(customTipo) || "OUTRO" : promoKind;
  const code = useMemo(
    () => buildCouponCode(tipo, suffix),
    [tipo, suffix]
  );

  useEffect(() => {
    if (promoKind === "FRETE") {
      setForm((f) => ({
        ...f,
        discount_target: "shipping",
        discount_type: "percent",
        discount_value: 100,
      }));
    }
  }, [promoKind]);

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
    if (promoKind === "OUTRO" && !normalizeTipo(customTipo)) {
      setMessage("Informe o tipo do cupom (ex: NATAL)");
      return;
    }
    const { error } = await supabase.from("coupons").insert({
      code,
      title:
        form.title.trim() ||
        (form.discount_target === "shipping"
          ? form.discount_type === "percent" && form.discount_value >= 100
            ? "Frete grátis"
            : "Desconto no frete"
          : ""),
      image_url: form.image_url || "",
      discount_type: form.discount_type,
      discount_value: form.discount_value,
      discount_target: form.discount_target,
      max_uses: Math.max(0, Number(form.max_uses) || 0),
      active: form.active,
      used_count: 0,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setForm({
      title: "",
      image_url: "",
      discount_type: "percent",
      discount_value: 10,
      discount_target: "product",
      max_uses: 50,
      active: true,
    });
    setPromoKind("VERAO");
    setCustomTipo("");
    setSuffix(randomSuffix());
    setMessage("Cupom criado");
    load();
  }

  async function setActive(id: string, active: boolean) {
    await supabase
      .from("coupons")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Cupons
      </h1>
      {message && <p className="mb-4 text-sm text-gray-600">{message}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Novo cupom">
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Tipo da promoção
              </label>
              <select
                value={promoKind}
                onChange={(e) =>
                  setPromoKind(e.target.value as "VERAO" | "FRETE" | "OUTRO")
                }
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {PROMO_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {promoKind === "OUTRO" && (
              <AdminInput
                label="Nome do tipo"
                value={customTipo}
                onChange={(e) => setCustomTipo(e.target.value)}
                placeholder="Ex: NATAL"
                required
              />
            )}
            <div>
              <label className="text-sm font-medium text-gray-700">
                Código gerado
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-sm tracking-wide text-[var(--color-primary)]">
                  LM-
                  <span className="font-semibold">{tipo}</span>-
                  <span>{suffix}</span>
                </code>
                <AdminButton
                  type="button"
                  variant="secondary"
                  onClick={() => setSuffix(randomSuffix())}
                >
                  Novo sufixo
                </AdminButton>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Máscara: LM-{"{TIPO}"}-{"{4 caracteres}"} — o final gera sozinho
              </p>
            </div>
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
              <label className="text-sm font-medium">Abate em</label>
              <select
                value={form.discount_target}
                onChange={(e) =>
                  setForm({
                    ...form,
                    discount_target: e.target.value as "product" | "shipping",
                  })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="product">Produtos (subtotal)</option>
                <option value="shipping">Frete somente</option>
              </select>
            </div>
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
                onChange={(e) =>
                  setForm({ ...form, active: e.target.checked })
                }
              />
              Ativo
            </label>
            <AdminFormActions>
              <AdminButton type="submit">Criar cupom</AdminButton>
            </AdminFormActions>
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
                  <p className="font-mono font-medium">{c.code}</p>
                  <p className="truncate text-gray-400">
                    {c.discount_target === "shipping" ? "Frete" : "Produto"} ·{" "}
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
