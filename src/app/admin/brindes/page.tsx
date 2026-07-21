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
import { giftPreviewImage } from "@/lib/deals";
import { formatCurrency } from "@/lib/utils";
import type { Gift } from "@/types";

const emptyForm = {
  name: "",
  stock: 0,
  purchase_price: 0,
  purchase_freight: 0,
  sale_markup: 0,
  image_url: "",
};

export default function AdminBrindesPage() {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const supabase = createClient();

  async function load() {
    const { data } = await supabase.from("gifts").select("*").order("name");
    setGifts((data as Gift[]) || []);
  }

  useEffect(() => {
    load();
  }, []);

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
        setMessage(error.message);
        return;
      }
      setMessage("Brinde atualizado.");
    } else {
      const { error } = await supabase.from("gifts").insert({
        ...payload,
        active: true,
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      setMessage("Brinde criado.");
    }
    resetForm();
    load();
  }

  async function toggleActive(g: Gift) {
    await supabase
      .from("gifts")
      .update({ active: !g.active, updated_at: new Date().toISOString() })
      .eq("id", g.id);
    if (editing === g.id) resetForm();
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Brindes
      </h1>
      {message && (
        <p className="mb-4 text-sm text-green-700">{message}</p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title={editing ? "Editar brinde" : "Novo brinde"}>
          <form onSubmit={save} className="space-y-3">
            <AdminInput
              label="Nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <AdminInput
              label="Estoque"
              type="number"
              min={0}
              value={form.stock}
              onChange={(e) =>
                setForm({ ...form, stock: Number(e.target.value) })
              }
            />
            <AdminInput
              label="Preço de compra"
              type="number"
              step="0.01"
              value={form.purchase_price}
              onChange={(e) =>
                setForm({ ...form, purchase_price: Number(e.target.value) })
              }
            />
            <AdminInput
              label="Frete na compra"
              type="number"
              step="0.01"
              value={form.purchase_freight}
              onChange={(e) =>
                setForm({ ...form, purchase_freight: Number(e.target.value) })
              }
            />
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

        <AdminCard title="Lista">
          <ul className="max-h-[640px] space-y-2 overflow-y-auto">
            {gifts.map((g) => {
              const img = giftPreviewImage(g);
              const custo =
                Number(g.purchase_price || 0) + Number(g.purchase_freight || 0);
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
                        Estoque {g.stock} · Custo {formatCurrency(custo)}
                        {Number(g.sale_markup) > 0
                          ? ` · Markup ${formatCurrency(Number(g.sale_markup))}`
                          : ""}{" "}
                        · {g.active ? "Ativo" : "Inativo"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <AdminButton
                      type="button"
                      variant="secondary"
                      onClick={() => editGift(g)}
                    >
                      Editar
                    </AdminButton>
                    <AdminButton
                      type="button"
                      variant="secondary"
                      onClick={() => toggleActive(g)}
                    >
                      {g.active ? "Arquivar" : "Ativar"}
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
