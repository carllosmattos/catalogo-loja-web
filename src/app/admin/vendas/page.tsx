"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import { formatCurrency, formatCpf, normalizeCpf } from "@/lib/utils";
import { sizeDisplayLabel } from "@/lib/sizes";

type SaleRow = Record<string, unknown> & {
  id: string;
  sale_gifts?: Array<Record<string, unknown>>;
};

export default function AdminVendasPage() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const [message, setMessage] = useState("");
  const nameFromLookup = useRef(false);
  const supabase = createClient();

  async function load() {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase
        .from("sales")
        .select("*, sale_gifts(*)")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("products").select("id, name").eq("active", true),
    ]);
    setSales((s as SaleRow[]) || []);
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
    setMessage("");
    const product = products.find((p) => p.id === form.product_id);
    const { error } = await supabase.rpc("register_sale", {
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
    if (error) {
      setMessage(error.message);
      return;
    }
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
    setMessage("Venda registrada.");
    load();
  }

  async function cancelSale(saleId: string) {
    if (!confirm("Cancelar esta venda e devolver estoque?")) return;
    setMessage("");
    const { error } = await supabase.rpc("cancel_sale", {
      p_sale_id: saleId,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Venda cancelada.");
    setExpandedId(null);
    load();
  }

  const activeSales = sales.filter((s) => !s.cancelled_at);
  const cancelledSales = sales.filter((s) => s.cancelled_at);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Vendas
      </h1>
      {message && (
        <p className="mb-4 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-gray-700">
          {message}
        </p>
      )}
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

        <AdminCard title={`Histórico (${activeSales.length})`}>
          {activeSales.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma venda ainda.</p>
          ) : (
            <ul className="max-h-[640px] space-y-2 overflow-y-auto text-sm">
              {activeSales.map((s) => {
                const open = expandedId === String(s.id);
                const gifts = Array.isArray(s.sale_gifts) ? s.sale_gifts : [];
                const created = s.created_at
                  ? new Date(String(s.created_at)).toLocaleString("pt-BR")
                  : "";
                return (
                  <li key={String(s.id)} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {String(s.product_name)}
                        </p>
                        <p className="text-gray-400">
                          {formatCurrency(Number(s.preco_final))} · Tam.{" "}
                          {sizeDisplayLabel(String(s.product_size))}
                          {s.customer_name
                            ? ` · ${String(s.customer_name)}`
                            : ""}
                        </p>
                        {created && (
                          <p className="text-xs text-gray-400">{created}</p>
                        )}
                      </div>
                      <AdminButton
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          setExpandedId(open ? null : String(s.id))
                        }
                      >
                        {open ? (
                          <>
                            Ocultar <ChevronUp className="h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Detalhes <ChevronDown className="h-4 w-4" />
                          </>
                        )}
                      </AdminButton>
                    </div>

                    {open && (
                      <div className="mt-3 space-y-2 border-t pt-3 text-sm text-gray-600">
                        <div className="grid gap-1 sm:grid-cols-2">
                          {s.customer_cpf ? (
                            <p>
                              <span className="text-gray-400">CPF:</span>{" "}
                              {formatCpf(String(s.customer_cpf))}
                            </p>
                          ) : null}
                          {s.customer_phone ? (
                            <p>
                              <span className="text-gray-400">Tel:</span>{" "}
                              {String(s.customer_phone)}
                            </p>
                          ) : null}
                          <p>
                            <span className="text-gray-400">Qtd:</span>{" "}
                            {Number(s.quantity) || 1}
                          </p>
                          <p>
                            <span className="text-gray-400">Catálogo:</span>{" "}
                            {formatCurrency(Number(s.preco_catalogo) || 0)}
                          </p>
                          {Number(s.desconto) > 0 && (
                            <p>
                              <span className="text-gray-400">Desconto:</span>{" "}
                              {formatCurrency(Number(s.desconto))}
                            </p>
                          )}
                          {Number(s.sale_freight) > 0 && (
                            <p>
                              <span className="text-gray-400">Frete:</span>{" "}
                              {formatCurrency(Number(s.sale_freight))}
                            </p>
                          )}
                          <p>
                            <span className="text-gray-400">Lucro:</span>{" "}
                            {formatCurrency(Number(s.lucro) || 0)}
                          </p>
                          {s.promotion_name ? (
                            <p>
                              <span className="text-gray-400">Promo:</span>{" "}
                              {String(s.promotion_name)}
                            </p>
                          ) : null}
                          {s.order_id ? (
                            <p className="sm:col-span-2">
                              <span className="text-gray-400">Pedido online:</span>{" "}
                              #{String(s.order_id).slice(0, 8)}
                            </p>
                          ) : null}
                          {s.payment_id ? (
                            <p className="sm:col-span-2">
                              <span className="text-gray-400">Pagamento:</span>{" "}
                              #{String(s.payment_id).slice(0, 8)}
                            </p>
                          ) : null}
                          {s.notes ? (
                            <p className="sm:col-span-2">
                              <span className="text-gray-400">Obs:</span>{" "}
                              {String(s.notes)}
                            </p>
                          ) : null}
                        </div>

                        {gifts.length > 0 && (
                          <div className="rounded-xl bg-purple-50 p-3">
                            <p className="mb-1 text-xs font-semibold uppercase text-[#A855F7]">
                              Brindes
                            </p>
                            <ul className="space-y-1">
                              {gifts.map((g, i) => (
                                <li key={String(g.id || i)}>
                                  {String(g.gift_name || "Brinde")} ×
                                  {Number(g.quantity) || 1}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <AdminButton
                          variant="danger"
                          type="button"
                          onClick={() => cancelSale(String(s.id))}
                        >
                          Cancelar venda
                        </AdminButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {cancelledSales.length > 0 && (
            <div className="mt-6 border-t pt-4">
              <p className="mb-2 text-xs font-semibold uppercase text-gray-400">
                Canceladas ({cancelledSales.length})
              </p>
              <ul className="space-y-1 text-xs text-gray-400">
                {cancelledSales.slice(0, 10).map((s) => (
                  <li key={String(s.id)}>
                    {String(s.product_name)} ·{" "}
                    {formatCurrency(Number(s.preco_final))}
                    {s.cancelled_at
                      ? ` · ${new Date(String(s.cancelled_at)).toLocaleDateString("pt-BR")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
