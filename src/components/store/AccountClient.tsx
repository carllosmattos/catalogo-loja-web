"use client";

import { useState } from "react";
import { StoreHeader } from "@/components/store/StoreHeader";
import { useCustomerStore } from "@/stores";
import { createClient } from "@/lib/supabase/client";
import {
  normalizePhoneBr,
  isValidCpf,
  isValidEmail,
} from "@/lib/utils";
import { BRAZILIAN_STATES } from "@/lib/address";
import type { Customer, StoreSettings } from "@/types";
import { STORE_MAIN } from "@/lib/store-layout";

interface AccountClientProps {
  settings: StoreSettings;
}

export function AccountClient({ settings }: AccountClientProps) {
  const { customer, setCustomer } = useCustomerStore();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: customer?.name || "",
    cpf: customer?.cpf || "",
    email: customer?.email || "",
    address_zip: customer?.address_zip || "",
    address_street: customer?.address_street || "",
    address_number: customer?.address_number || "",
    address_complement: customer?.address_complement || "",
    address_neighborhood: customer?.address_neighborhood || "",
    address_city: customer?.address_city || "",
    address_state: customer?.address_state || "SP",
  });

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const normalized = normalizePhoneBr(phone);
      const { data, error: rpcError } = await supabase.rpc(
        "lookup_customer_by_phone",
        { p_phone: normalized }
      );
      if (rpcError) throw new Error(rpcError.message);
      const found = Array.isArray(data) ? data[0] : data;
      if (found) {
        setCustomer(found as Customer);
        setForm({
          name: found.name || "",
          cpf: found.cpf || "",
          email: found.email || "",
          address_zip: found.address_zip || "",
          address_street: found.address_street || "",
          address_number: found.address_number || "",
          address_complement: found.address_complement || "",
          address_neighborhood: found.address_neighborhood || "",
          address_city: found.address_city || "",
          address_state: found.address_state || "SP",
        });
      } else {
        setCustomer({
          id: "",
          name: "",
          phone: normalized,
          cpf: "",
          email: "",
          address: "",
          address_zip: "",
          address_street: "",
          address_number: "",
          address_complement: "",
          address_neighborhood: "",
          address_city: "",
          address_state: "SP",
          points: 0,
        });
        setForm((f) => ({ ...f, name: "" }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidCpf(form.cpf)) {
      setError("CPF inválido");
      return;
    }
    if (!isValidEmail(form.email)) {
      setError("E-mail inválido (obrigatório para PIX)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const phoneNorm = customer?.phone || normalizePhoneBr(phone);
      const { data, error: rpcError } = await supabase.rpc(
        "save_customer_profile",
        {
          p_phone: phoneNorm,
          p_name: form.name,
          p_cpf: form.cpf.replace(/\D/g, ""),
          p_email: form.email,
          p_address_zip: form.address_zip.replace(/\D/g, ""),
          p_address_street: form.address_street,
          p_address_number: form.address_number,
          p_address_complement: form.address_complement,
          p_address_neighborhood: form.address_neighborhood,
          p_address_city: form.address_city,
          p_address_state: form.address_state,
        }
      );
      if (rpcError) throw new Error(rpcError.message);
      const saved = Array.isArray(data) ? data[0] : data;
      setCustomer(saved as Customer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <h1 className="mb-4 text-xl font-semibold text-[var(--color-primary)] md:text-2xl">
          Minha conta
        </h1>
        <div className="md:mx-auto md:max-w-xl lg:max-w-2xl">
        {error && (
          <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {error}
          </p>
        )}
        {!customer ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Telefone (WhatsApp)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[var(--color-primary)] py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Buscando..." : "Entrar / Cadastrar"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <p className="text-sm text-gray-500">
              Tel: {customer.phone}
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="ml-2 text-[var(--color-primary)] underline"
              >
                Sair
              </button>
            </p>
            {[
              { key: "name", label: "Nome completo", type: "text" },
              { key: "cpf", label: "CPF", type: "text", placeholder: "000.000.000-00" },
              { key: "email", label: "E-mail", type: "email" },
              { key: "address_zip", label: "CEP", type: "text" },
              { key: "address_street", label: "Rua", type: "text" },
              { key: "address_number", label: "Número", type: "text" },
              { key: "address_complement", label: "Complemento", type: "text" },
              { key: "address_neighborhood", label: "Bairro", type: "text" },
              { key: "address_city", label: "Cidade", type: "text" },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label className="text-sm font-medium text-gray-700">{label}</label>
                <input
                  type={type}
                  value={form[key as keyof typeof form]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [key]: e.target.value }))
                  }
                  placeholder={placeholder}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm"
                />
              </div>
            ))}
            <div>
              <label className="text-sm font-medium text-gray-700">UF</label>
              <select
                value={form.address_state}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address_state: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm"
              >
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[var(--color-primary)] py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Salvando..." : "Salvar dados"}
            </button>
          </form>
        )}
        </div>
      </main>
    </>
  );
}
