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

type Mode = "login" | "register";

export function AccountClient({ settings }: AccountClientProps) {
  const { customer, setCustomer } = useCustomerStore();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: customer?.name || "",
    cpf: customer?.cpf || "",
    email: customer?.email || "",
    phone: customer?.phone || "",
    address_zip: customer?.address_zip || "",
    address_street: customer?.address_street || "",
    address_number: customer?.address_number || "",
    address_complement: customer?.address_complement || "",
    address_neighborhood: customer?.address_neighborhood || "",
    address_city: customer?.address_city || "",
    address_state: customer?.address_state || "SP",
  });

  function applyCustomer(found: Customer) {
    setCustomer(found);
    setForm({
      name: found.name || "",
      cpf: found.cpf || "",
      email: found.email || "",
      phone: found.phone || "",
      address_zip: found.address_zip || "",
      address_street: found.address_street || "",
      address_number: found.address_number || "",
      address_complement: found.address_complement || "",
      address_neighborhood: found.address_neighborhood || "",
      address_city: found.address_city || "",
      address_state: found.address_state || "SP",
    });
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError("E-mail inválido");
      return;
    }
    if (password.length < 6) {
      setError("Senha deve ter no mínimo 6 caracteres");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      if (mode === "register") {
        const { data, error: rpcError } = await supabase.rpc(
          "register_customer_account",
          {
            p_email: email.trim(),
            p_password: password,
            p_phone: phone ? normalizePhoneBr(phone) : "",
            p_name: "",
          }
        );
        if (rpcError) throw new Error(rpcError.message);
        const found = Array.isArray(data) ? data[0] : data;
        if (!found) throw new Error("Não foi possível criar a conta");
        applyCustomer(found as Customer);
      } else {
        const { data, error: rpcError } = await supabase.rpc(
          "login_customer_account",
          {
            p_email: email.trim(),
            p_password: password,
          }
        );
        if (rpcError) throw new Error(rpcError.message);
        const found = Array.isArray(data) ? data[0] : data;
        if (!found) throw new Error("E-mail ou senha inválidos");
        applyCustomer(found as Customer);
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
    const phoneNorm = normalizePhoneBr(form.phone || customer?.phone || "");
    if (!phoneNorm || phoneNorm.length < 10) {
      setError("Informe um WhatsApp válido");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
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
      setCustomer({
        ...(saved as Customer),
        id: (saved as Customer).id || customer?.id || "",
      });
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
            <form onSubmit={handleAuth} className="space-y-4">
              <div className="flex gap-2 rounded-full bg-gray-100 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`flex-1 rounded-full py-2 font-medium ${
                    mode === "login"
                      ? "bg-white text-[var(--color-primary)] shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className={`flex-1 rounded-full py-2 font-medium ${
                    mode === "register"
                      ? "bg-white text-[var(--color-primary)] shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  Criar conta
                </button>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  placeholder="Mínimo 6 caracteres"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"
                  required
                />
              </div>
              {mode === "register" && (
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    WhatsApp (opcional agora)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-[var(--color-primary)] py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {loading
                  ? "Aguarde..."
                  : mode === "login"
                    ? "Entrar"
                    : "Criar conta"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSave} className="space-y-3">
              <p className="text-sm text-gray-500">
                {customer.email || form.email}
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
                {
                  key: "phone",
                  label: "WhatsApp",
                  type: "tel",
                  placeholder: "(11) 99999-9999",
                },
                {
                  key: "cpf",
                  label: "CPF",
                  type: "text",
                  placeholder: "000.000.000-00",
                },
                { key: "email", label: "E-mail", type: "email" },
                { key: "address_zip", label: "CEP", type: "text" },
                { key: "address_street", label: "Rua", type: "text" },
                { key: "address_number", label: "Número", type: "text" },
                {
                  key: "address_complement",
                  label: "Complemento",
                  type: "text",
                },
                { key: "address_neighborhood", label: "Bairro", type: "text" },
                { key: "address_city", label: "Cidade", type: "text" },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="text-sm font-medium text-gray-700">
                    {label}
                  </label>
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
