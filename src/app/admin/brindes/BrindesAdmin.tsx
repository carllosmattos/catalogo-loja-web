"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import { giftPreviewImage } from "@/lib/deals";
import { giftUnitCost } from "@/lib/profit";
import { formatCurrency } from "@/lib/utils";
import type { Gift } from "@/types";

const emptyForm = {
  name: "",
  stock: 0,
  purchase_price: 0,
  purchase_freight: 0,
  purchase_lot_qty: 1,
  sale_markup: 0,
  image_url: "",
};

export default function BrindesAdmin({
  section,
}: {
  section: "cadastro" | "lista";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const supabase = createClient();

  const unitCostPreview = useMemo(
    () =>
      giftUnitCost({
        purchase_price: form.purchase_price,
        purchase_freight: form.purchase_freight,
        purchase_lot_qty: form.purchase_lot_qty,
      }),
    [form.purchase_price, form.purchase_freight, form.purchase_lot_qty]
  );

  async function load() {
    const { data } = await supabase.from("gifts").select("*").order("name");
    setGifts((data as Gift[]) || []);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (section !== "cadastro" || gifts.length === 0) return;
    const editId = searchParams.get("edit");
    if (!editId) return;
    const g = gifts.find((x) => x.id === editId);
    if (g && editing !== editId) {
      editGift(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, gifts, searchParams]);

  function resetForm() {
    setEditing(null);
    setForm(emptyForm);
  }

  function editGift(g: Gift) {
    setEditing(g.id);
    setMessage("");
    setForm({
      name: g.name,
      stock: Number(g.stock) || 0,
      purchase_price: Number(g.purchase_price) || 0,
      purchase_freight: Number(g.purchase_freight) || 0,
      purchase_lot_qty: Math.max(1, Number(g.purchase_lot_qty) || 1),
      sale_markup: Number(g.sale_markup) || 0,
      image_url: giftPreviewImage(g) || g.image_url || "",
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const payload = {
      name: form.name.trim(),
      stock: Math.max(0, Number(form.stock) || 0),
      purchase_price: Number(form.purchase_price) || 0,
      purchase_freight: Number(form.purchase_freight) || 0,
      purchase_lot_qty: Math.max(1, Number(form.purchase_lot_qty) || 1),
      sale_markup: Number(form.sale_markup) || 0,
      image_url: form.image_url || null,
      image_urls: form.image_url ? [form.image_url] : [],
      active: true,
      updated_at: new Date().toISOString(),
    };

    if (editing) {
      const { error } = await supabase
        .from("gifts")
        .update(payload)
        .eq("id", editing);
      if (error) {
        setMessage(
          error.message.includes("purchase_lot_qty")
            ? "Rode a migration 041 no Supabase para salvar o lote do frete."
            : error.message
        );
        return;
      }
      setMessage("Brinde atualizado.");
    } else {
      const { error } = await supabase.from("gifts").insert(payload);
      if (error) {
        setMessage(
          error.message.includes("purchase_lot_qty")
            ? "Rode a migration 041 no Supabase para cadastrar o lote do frete."
            : error.message
        );
        return;
      }
      setMessage("Brinde criado.");
    }
    resetForm();
    load();
  }

  async function setActive(id: string, active: boolean) {
    await supabase
      .from("gifts")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        {section === "lista" ? "Lista de brindes" : "Cadastro de brindes"}
      </h1>
      {message && (
        <p className="mb-4 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-gray-700">
          {message}
        </p>
      )}
      {section === "cadastro" && (
        <div className="mx-auto max-w-2xl">
        <AdminCard title={editing ? "Editar brinde" : "Novo brinde"}>
          <form onSubmit={save} className="space-y-3">
            <AdminInput
              label="Nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <AdminInput
              label="Estoque atual"
              type="number"
              min={0}
              value={form.stock}
              onChange={(e) =>
                setForm({ ...form, stock: Number(e.target.value) })
              }
            />
            <AdminInput
              label="Preço de compra (por unidade)"
              type="number"
              step="0.01"
              min={0}
              value={form.purchase_price}
              onChange={(e) =>
                setForm({ ...form, purchase_price: Number(e.target.value) })
              }
            />
            <AdminInput
              label="Frete na compra (total do lote)"
              type="number"
              step="0.01"
              min={0}
              value={form.purchase_freight}
              onChange={(e) =>
                setForm({ ...form, purchase_freight: Number(e.target.value) })
              }
            />
            <AdminInput
              label="Qtd. do lote (para ratear o frete)"
              type="number"
              min={1}
              step={1}
              value={form.purchase_lot_qty}
              onChange={(e) =>
                setForm({
                  ...form,
                  purchase_lot_qty: Math.max(1, Number(e.target.value) || 1),
                })
              }
            />
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Custo unitário no lucro:{" "}
              <strong>{formatCurrency(unitCostPreview)}</strong>
              {" = "}
              preço/un + (frete ÷ qtd. do lote). Ex.: 100 un., frete R$ 30 →
              frete/un R$ 0,30.
            </p>
            <AdminInput
              label="Markup na venda"
              type="number"
              step="0.01"
              value={form.sale_markup}
              onChange={(e) =>
                setForm({ ...form, sale_markup: Number(e.target.value) })
              }
            />
            <ImageUploadField
              label="Imagem"
              folder="gifts"
              value={form.image_url}
              onChange={(url) => setForm({ ...form, image_url: url })}
            />
            <AdminFormActions>
              <AdminButton type="submit">
                {editing ? "Salvar alterações" : "Criar brinde"}
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
        </div>
      )}

      {section === "lista" && (
        <AdminCard title="Lista">
          <ul className="max-h-[640px] space-y-2 overflow-y-auto">
            {gifts.map((g) => {
              const img = giftPreviewImage(g);
              const unit = giftUnitCost(g);
              const lot = Math.max(1, Number(g.purchase_lot_qty) || 1);
              return (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {img ? (
                      <img
                        src={img}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-400">
                        sem foto
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{g.name}</p>
                      <p className="text-gray-400">
                        Estoque {g.stock} · Custo/un {formatCurrency(unit)}
                        {Number(g.purchase_freight) > 0
                          ? ` (lote ${lot})`
                          : ""}
                        {Number(g.sale_markup) > 0
                          ? ` · Markup ${formatCurrency(Number(g.sale_markup))}`
                          : ""}{" "}
                        · {g.active ? "Ativo" : "Inativo"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <AdminButton
                      variant="secondary"
                      onClick={() =>
                        router.push(`/admin/brindes/cadastro?edit=${g.id}`)
                      }
                    >
                      Editar
                    </AdminButton>
                    <AdminButton
                      variant="secondary"
                      onClick={() => setActive(g.id, !g.active)}
                    >
                      {g.active ? "Arquivar" : "Reativar"}
                    </AdminButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminCard>
      )}
    </div>
  );
}
