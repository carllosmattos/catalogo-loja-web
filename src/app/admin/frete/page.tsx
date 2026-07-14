"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminInput, AdminButton } from "@/components/admin/AdminUI";
import { BRAZILIAN_STATES } from "@/lib/address";
import type { ShippingZone } from "@/types";

export default function AdminFretePage() {
  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [meStatus, setMeStatus] = useState<{
    configured: boolean;
    connected: boolean;
    expiresAt: string | null;
    expiresInDays: number | null;
    redirectUri: string;
  } | null>(null);
  const [meMsg, setMeMsg] = useState("");
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
      supabase.from("shipping_zones").select("*").order("priority", { ascending: false }),
      supabase.from("store_settings").select("*").limit(1).single(),
    ]);
    setZones(z || []);
    if (s) setSettings(s);
  }

  async function loadMeStatus() {
    try {
      const res = await fetch("/api/admin/melhor-envio/status");
      if (!res.ok) return;
      setMeStatus(await res.json());
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
    loadMeStatus();
    const params = new URLSearchParams(window.location.search);
    const err = params.get("me_error");
    const ok = params.get("me");
    if (err) setMeMsg(`Erro: ${err}`);
    if (ok === "connected") {
      setMeMsg("Melhor Envio conectado com sucesso.");
      loadMeStatus();
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
    await supabase.from("store_settings").update({
      sender_zip: settings.sender_zip,
      sender_street: settings.sender_street,
      sender_city: settings.sender_city,
      sender_state: settings.sender_state,
      default_package_weight_kg: settings.default_package_weight_kg,
      melhor_envio_enabled: settings.melhor_envio_enabled,
    }).eq("id", settings.id);
    load();
  }

  async function disconnectMe() {
    if (!confirm("Desconectar Melhor Envio?")) return;
    await fetch("/api/admin/melhor-envio/status", { method: "DELETE" });
    setMeMsg("Desconectado.");
    loadMeStatus();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Frete</h1>

      <AdminCard title="Integração Melhor Envio (OAuth)">
        <div className="space-y-3 text-sm">
          {meMsg && (
            <p className={`rounded-xl px-3 py-2 ${meMsg.startsWith("Erro") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {meMsg}
            </p>
          )}
          {!meStatus?.configured ? (
            <p className="text-amber-700">
              Configure no Vercel: <code>MELHOR_ENVIO_CLIENT_ID</code>,{" "}
              <code>MELHOR_ENVIO_CLIENT_SECRET</code> e{" "}
              <code>APP_BASE_URL</code>. No app do Melhor Envio, use o redirect:
            </p>
          ) : meStatus.connected ? (
            <p className="text-gray-600">
              Conectado
              {meStatus.expiresInDays != null
                ? ` · token renova sozinho (expira em ~${meStatus.expiresInDays} dias)`
                : ""}
            </p>
          ) : (
            <p className="text-gray-600">
              App configurado. Clique em conectar e autorize no Melhor Envio.
            </p>
          )}
          {meStatus?.redirectUri && (
            <p className="break-all rounded-lg bg-gray-50 p-2 text-xs text-gray-500">
              Redirect URI (cole no app Melhor Envio):{" "}
              <strong>{meStatus.redirectUri}</strong>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <a href="/api/admin/melhor-envio/connect">
              <AdminButton type="button">
                {meStatus?.connected ? "Reconectar" : "Conectar Melhor Envio"}
              </AdminButton>
            </a>
            {meStatus?.connected && (
              <AdminButton type="button" variant="secondary" onClick={disconnectMe}>
                Desconectar
              </AdminButton>
            )}
          </div>
        </div>
      </AdminCard>

      <div className="mt-6">
      <AdminCard title="Endereço remetente">
        <form onSubmit={saveSender} className="grid gap-3 md:grid-cols-2">
          <AdminInput label="CEP remetente" value={String(settings.sender_zip || "")} onChange={(e) => setSettings({ ...settings, sender_zip: e.target.value })} />
          <AdminInput label="Rua" value={String(settings.sender_street || "")} onChange={(e) => setSettings({ ...settings, sender_street: e.target.value })} />
          <AdminInput label="Cidade" value={String(settings.sender_city || "")} onChange={(e) => setSettings({ ...settings, sender_city: e.target.value })} />
          <div>
            <label className="text-sm font-medium">UF</label>
            <select value={String(settings.sender_state || "SP")} onChange={(e) => setSettings({ ...settings, sender_state: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {BRAZILIAN_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <AdminInput label="Peso padrão (kg)" type="number" step="0.1" value={Number(settings.default_package_weight_kg) || 0.3} onChange={(e) => setSettings({ ...settings, default_package_weight_kg: Number(e.target.value) })} />
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={Boolean(settings.melhor_envio_enabled)} onChange={(e) => setSettings({ ...settings, melhor_envio_enabled: e.target.checked })} />
            Melhor Envio ativo na cotação do carrinho
          </label>
          <AdminButton type="submit">Salvar remetente</AdminButton>
        </form>
      </AdminCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AdminCard title="Nova zona">
          <form onSubmit={saveZone} className="space-y-3">
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <select value={form.zone_type} onChange={(e) => setForm({ ...form, zone_type: e.target.value as ShippingZone["zone_type"] })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="free">Grátis</option>
                <option value="paid">Pago</option>
                <option value="blocked">Bloqueado</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Escopo</label>
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as ShippingZone["scope"] })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="state">Estado</option>
                <option value="city">Cidade</option>
                <option value="neighborhood">Bairro</option>
              </select>
            </div>
            <AdminInput label="UF" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            <AdminInput label="Cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <AdminInput label="Valor frete" type="number" step="0.01" value={form.freight_amount} onChange={(e) => setForm({ ...form, freight_amount: Number(e.target.value) })} />
            <AdminInput label="Rótulo" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <AdminButton type="submit">Adicionar zona</AdminButton>
          </form>
        </AdminCard>
        <AdminCard title="Zonas cadastradas">
          <ul className="space-y-2 text-sm">
            {zones.map((z) => (
              <li key={z.id} className="rounded-lg border p-3">
                <p className="font-medium">{z.label || z.zone_type} — {z.state}{z.city ? `/${z.city}` : ""}</p>
                <p className="text-gray-400">{z.zone_type} · R$ {z.freight_amount}</p>
              </li>
            ))}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
