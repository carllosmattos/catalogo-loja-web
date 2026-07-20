"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import { BRAZILIAN_STATES } from "@/lib/address";
import { WEEKDAY_OPTIONS, parseDispatchWeekdays } from "@/lib/dispatch";
import type { ShippingZone } from "@/types";

function parseMeError(raw: string | null): string {
  if (!raw) return "";
  const decoded = decodeURIComponent(raw);
  try {
    const json = JSON.parse(decoded) as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    if (json.error === "invalid_client") {
      return (
        "Client ID ou Client Secret inválidos no Vercel (ou ambiente sandbox/produção trocado). " +
        "Confira MELHOR_ENVIO_CLIENT_ID, MELHOR_ENVIO_CLIENT_SECRET e MELHOR_ENVIO_SANDBOX."
      );
    }
    return (
      json.error_description ||
      json.message ||
      json.error ||
      decoded
    );
  } catch {
    if (decoded.includes("invalid_client")) {
      return (
        "Client ID ou Client Secret inválidos no Vercel (ou sandbox/produção trocado)."
      );
    }
    return decoded;
  }
}

export default function AdminFretePage() {
  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [meStatus, setMeStatus] = useState<{
    configured: boolean;
    connected: boolean;
    expiresAt: string | null;
    expiresInDays: number | null;
    redirectUri: string;
    hasClientId?: boolean;
    hasClientSecret?: boolean;
    hasAppBaseUrl?: boolean;
    sandbox?: boolean;
  } | null>(null);
  const [meStatusLoaded, setMeStatusLoaded] = useState(false);
  const [meMsg, setMeMsg] = useState("");
  const [meError, setMeError] = useState("");
  const [form, setForm] = useState<ShippingZone>({
    zone_type: "paid",
    scope: "state",
    country: "BR",
    state: "SP",
    city: "",
    neighborhood: "",
    freight_amount: 15,
    priority: 10,
    label: "",
    active: true,
  });
  const supabase = createClient();

  async function load() {
    const [{ data: z }, { data: s }] = await Promise.all([
      supabase
        .from("shipping_zones")
        .select("*")
        .order("priority", { ascending: false }),
      supabase.from("store_settings").select("*").limit(1).single(),
    ]);
    setZones(z || []);
    if (s) setSettings(s);
  }

  async function loadMeStatus() {
    try {
      const res = await fetch("/api/admin/melhor-envio/status");
      const data = await res.json().catch(() => ({}));
      const fallbackUri =
        typeof window !== "undefined"
          ? `${window.location.origin}/api/admin/melhor-envio/callback`
          : "";
      setMeStatus({
        configured: Boolean(data.configured),
        connected: Boolean(data.connected),
        expiresAt: data.expiresAt || null,
        expiresInDays:
          data.expiresInDays != null ? Number(data.expiresInDays) : null,
        redirectUri: data.redirectUri || fallbackUri,
        hasClientId: Boolean(data.hasClientId),
        hasClientSecret: Boolean(data.hasClientSecret),
        hasAppBaseUrl: Boolean(data.hasAppBaseUrl),
        sandbox: Boolean(data.sandbox),
      });
      if (res.status === 401) {
        setMeError("Sessão admin expirada. Faça login de novo.");
      }
    } catch {
      setMeStatus({
        configured: false,
        connected: false,
        expiresAt: null,
        expiresInDays: null,
        redirectUri:
          typeof window !== "undefined"
            ? `${window.location.origin}/api/admin/melhor-envio/callback`
            : "",
        hasClientId: false,
        hasClientSecret: false,
        hasAppBaseUrl: false,
        sandbox: false,
      });
    } finally {
      setMeStatusLoaded(true);
    }
  }

  useEffect(() => {
    load();
    loadMeStatus();
    const params = new URLSearchParams(window.location.search);
    const err = parseMeError(params.get("me_error"));
    const ok = params.get("me");
    if (err) setMeError(err);
    if (ok === "connected") {
      setMeMsg("Melhor Envio conectado com sucesso.");
      loadMeStatus();
    }
    if (err || ok) {
      window.history.replaceState({}, "", "/admin/frete");
    }
  }, []);

  async function saveZone(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("shipping_zones").insert(form);
    setForm({ ...form, city: "", neighborhood: "", label: "" });
    load();
  }

  async function saveSender(e: React.FormEvent) {
    e.preventDefault();
    if (!settings.id) return;
    await supabase
      .from("store_settings")
      .update({
        sender_zip: settings.sender_zip,
        sender_street: settings.sender_street,
        sender_city: settings.sender_city,
        sender_state: settings.sender_state,
        default_package_weight_kg: settings.default_package_weight_kg,
        melhor_envio_enabled: settings.melhor_envio_enabled,
        shipping_dispatch_weekdays: parseDispatchWeekdays(
          settings.shipping_dispatch_weekdays
        ),
      })
      .eq("id", settings.id);
    load();
  }

  function toggleDispatchDay(day: number) {
    const current = parseDispatchWeekdays(settings.shipping_dispatch_weekdays);
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setSettings({ ...settings, shipping_dispatch_weekdays: next });
  }

  async function disconnectMe() {
    if (!confirm("Desconectar Melhor Envio?")) return;
    await fetch("/api/admin/melhor-envio/status", { method: "DELETE" });
    setMeMsg("Desconectado.");
    setMeError("");
    loadMeStatus();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Frete
      </h1>

      <AdminCard title="Integração Melhor Envio (OAuth)">
        <div className="space-y-3 text-sm">
          {meError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-red-700">
              {meError}
            </p>
          )}
          {meMsg && !meError && (
            <p className="rounded-xl bg-green-50 px-3 py-2 text-green-700">
              {meMsg}
            </p>
          )}
          {!meStatusLoaded ? (
            <p className="text-sm text-gray-400">Verificando configuração…</p>
          ) : !meStatus?.configured ? (
            <div className="space-y-2 rounded-xl bg-amber-50 px-3 py-3 text-amber-800">
              <p className="font-medium">
                Vercel ainda não enxerga Client ID/Secret
              </p>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                <li>
                  CLIENT_ID:{" "}
                  {meStatus?.hasClientId ? "encontrado" : "não encontrado"}
                </li>
                <li>
                  CLIENT_SECRET:{" "}
                  {meStatus?.hasClientSecret
                    ? "encontrado"
                    : "não encontrado"}
                </li>
                <li>
                  APP_BASE_URL:{" "}
                  {meStatus?.hasAppBaseUrl ? "ok" : "faltando (usa VERCEL_URL)"}
                </li>
              </ul>
              <p className="text-sm">
                Confira os nomes exatos (sem espaço):{" "}
                <code>MELHOR_ENVIO_CLIENT_ID</code> e{" "}
                <code>MELHOR_ENVIO_CLIENT_SECRET</code>, marcados para{" "}
                <strong>Production</strong>, e faça{" "}
                <strong>Redeploy</strong> depois de salvar.
              </p>
              <ol className="list-decimal space-y-1 pl-4 text-sm">
                <li>
                  No Melhor Envio, cole a Redirect URI abaixo no app OAuth.
                </li>
                <li>Salve as variáveis no Vercel → Redeploy.</li>
                <li>
                  Volte aqui e clique em <strong>Conectar Melhor Envio</strong>.
                </li>
              </ol>
            </div>
          ) : meStatus.connected ? (
            <p className="text-gray-600">
              Conectado
              {meStatus.expiresInDays != null
                ? ` · token renova sozinho (expira em ~${meStatus.expiresInDays} dias)`
                : ""}
              {meStatus.sandbox ? " · sandbox" : " · produção"}
            </p>
          ) : (
            <p className="text-gray-600">
              App configurado no Vercel
              {meStatus.sandbox ? " (sandbox)" : " (produção)"}. Clique em
              conectar e autorize no Melhor Envio.
            </p>
          )}
          <p className="break-all rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
            Redirect URI (cole no app Melhor Envio, sem barra no final):
            <br />
            <strong>
              {meStatus?.redirectUri ||
                "https://lm-moda-feminina.vercel.app/api/admin/melhor-envio/callback"}
            </strong>
          </p>
          <AdminFormActions>
            <a
              href="/api/admin/melhor-envio/connect"
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            >
              {meStatus?.connected ? "Reconectar" : "Conectar Melhor Envio"}
            </a>
            {meStatus?.connected && (
              <AdminButton
                type="button"
                variant="secondary"
                onClick={disconnectMe}
              >
                Desconectar
              </AdminButton>
            )}
          </AdminFormActions>
        </div>
      </AdminCard>

      <div className="mt-6">
        <AdminCard title="Endereço remetente">
          <form onSubmit={saveSender} className="grid gap-3 md:grid-cols-2">
            <AdminInput
              label="CEP remetente"
              value={String(settings.sender_zip || "")}
              onChange={(e) =>
                setSettings({ ...settings, sender_zip: e.target.value })
              }
            />
            <AdminInput
              label="Rua"
              value={String(settings.sender_street || "")}
              onChange={(e) =>
                setSettings({ ...settings, sender_street: e.target.value })
              }
            />
            <AdminInput
              label="Cidade"
              value={String(settings.sender_city || "")}
              onChange={(e) =>
                setSettings({ ...settings, sender_city: e.target.value })
              }
            />
            <div>
              <label className="text-sm font-medium">UF</label>
              <select
                value={String(settings.sender_state || "SP")}
                onChange={(e) =>
                  setSettings({ ...settings, sender_state: e.target.value })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </div>
            <AdminInput
              label="Peso padrão (kg)"
              type="number"
              step="0.1"
              value={Number(settings.default_package_weight_kg) || 0.3}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  default_package_weight_kg: Number(e.target.value),
                })
              }
            />
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(settings.melhor_envio_enabled)}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    melhor_envio_enabled: e.target.checked,
                  })
                }
              />
              Melhor Envio ativo na cotação do carrinho
            </label>
            <div className="space-y-2 md:col-span-2">
              <p className="text-sm font-medium">Dias de coleta / envio</p>
              <p className="text-xs text-gray-500">
                O prazo mostrado ao cliente é o total (espera até a coleta +
                transporte). Com vários dias, usa o mais próximo da compra.
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((w) => {
                  const selected = parseDispatchWeekdays(
                    settings.shipping_dispatch_weekdays
                  ).includes(w.value);
                  return (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => toggleDispatchDay(w.value)}
                      className={`rounded-xl px-3 py-1.5 text-sm font-medium ${
                        selected
                          ? "bg-[var(--color-primary)] text-white"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="md:col-span-2">
              <AdminFormActions>
                <AdminButton type="submit">Salvar remetente</AdminButton>
              </AdminFormActions>
            </div>
          </form>
        </AdminCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AdminCard title="Regra de frete por região">
          <p className="mb-4 text-sm text-gray-600">
            Aqui você define uma regra <strong>manual</strong> para um lugar
            (estado, cidade ou bairro): frete grátis, valor fixo ou não entregar.
            Se o endereço do cliente bater nessa regra, ela vale{" "}
            <strong>no lugar</strong> da cotação Melhor Envio. Só quando{" "}
            <strong>nenhuma</strong> regra bater é que o site usa Melhor Envio
            (se estiver ativo) ou o frete do produto.
          </p>
          <p className="mb-4 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Exemplos: “SP inteiro grátis”, “Campinas R$ 12”, “não entrega no
            Interior de MG”. Quanto mais específico (bairro &gt; cidade &gt;
            estado), maior a prioridade.
          </p>
          <form onSubmit={saveZone} className="space-y-3">
            <div>
              <label className="text-sm font-medium">Tipo da regra</label>
              <select
                value={form.zone_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    zone_type: e.target.value as ShippingZone["zone_type"],
                  })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="free">Frete grátis</option>
                <option value="paid">Valor fixo</option>
                <option value="blocked">Não entrega (bloqueado)</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Abrangência</label>
              <select
                value={form.scope}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scope: e.target.value as ShippingZone["scope"],
                  })
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="state">Estado inteiro</option>
                <option value="city">Cidade</option>
                <option value="neighborhood">Bairro</option>
              </select>
            </div>
            <AdminInput
              label="UF"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
            {(form.scope === "city" || form.scope === "neighborhood") && (
              <AdminInput
                label="Cidade"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            )}
            {form.scope === "neighborhood" && (
              <AdminInput
                label="Bairro"
                value={form.neighborhood}
                onChange={(e) =>
                  setForm({ ...form, neighborhood: e.target.value })
                }
              />
            )}
            {form.zone_type === "paid" && (
              <AdminInput
                label="Valor do frete (R$)"
                type="number"
                step="0.01"
                value={form.freight_amount}
                onChange={(e) =>
                  setForm({ ...form, freight_amount: Number(e.target.value) })
                }
              />
            )}
            <AdminInput
              label="Nome da regra (opcional)"
              placeholder="Ex.: Frete grátis São Paulo"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <AdminFormActions>
              <AdminButton type="submit">Adicionar regra</AdminButton>
            </AdminFormActions>
          </form>
        </AdminCard>
        <AdminCard title="Regras cadastradas">
          {zones.length === 0 ? (
            <p className="text-sm text-gray-400">
              Nenhuma regra ainda. Sem regras, o frete vem do Melhor Envio ou do
              produto.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {zones.map((z) => {
                const typeLabel =
                  z.zone_type === "free"
                    ? "Grátis"
                    : z.zone_type === "blocked"
                      ? "Bloqueado"
                      : `R$ ${Number(z.freight_amount || 0).toFixed(2)}`;
                const where = [z.state, z.city, z.neighborhood]
                  .filter(Boolean)
                  .join(" / ");
                return (
                  <li key={z.id} className="rounded-lg border p-3">
                    <p className="font-medium">
                      {z.label || typeLabel} — {where || "Brasil"}
                    </p>
                    <p className="text-gray-400">
                      {z.scope === "state"
                        ? "Estado"
                        : z.scope === "city"
                          ? "Cidade"
                          : z.scope === "neighborhood"
                            ? "Bairro"
                            : z.scope}{" "}
                      · {typeLabel}
                      {!z.active ? " · inativa" : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
