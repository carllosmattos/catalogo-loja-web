"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard, AdminInput, AdminButton, AdminFormActions } from "@/components/admin/AdminUI";
import { ImageUploadField } from "@/components/admin/ImageUploadField";
import { DEFAULT_SETTINGS } from "@/lib/branding";
import type { StoreSettings } from "@/types";

export default function AdminLojaPage() {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [banners, setBanners] = useState<{ id: string; image_url: string; active: boolean }[]>([]);
  const [newBannerUrl, setNewBannerUrl] = useState("");
  const [message, setMessage] = useState("");
  const supabase = createClient();

  async function load() {
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.from("store_settings").select("*").limit(1).single(),
      supabase.from("store_banners").select("*").order("sort_order"),
    ]);
    if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
    setBanners(b || []);
  }

  useEffect(() => { load(); }, []);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      store_name: settings.store_name,
      whatsapp_number: settings.whatsapp_number,
      primary_color: settings.primary_color,
      secondary_color: settings.secondary_color,
      accent_color: settings.accent_color,
      logo_url: settings.logo_url,
      default_banner_url: settings.default_banner_url,
    };
    if (settings.id) {
      await supabase.from("store_settings").update(payload).eq("id", settings.id);
    } else {
      await supabase.from("store_settings").insert(payload);
    }
    setMessage("Configurações salvas!");
    load();
  }

  async function addBanner() {
    if (!newBannerUrl) return;
    await supabase.from("store_banners").insert({
      image_url: newBannerUrl,
      active: true,
      sort_order: banners.length,
    });
    setNewBannerUrl("");
    load();
  }

  async function toggleBanner(id: string, active: boolean) {
    await supabase.from("store_banners").update({ active }).eq("id", id);
    load();
  }

  async function deleteBanner(id: string) {
    if (!confirm("Excluir este banner?")) return;
    await supabase.from("store_banners").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Loja</h1>
      {message && <p className="mb-4 text-sm text-green-600">{message}</p>}
      <AdminCard title="Identidade visual">
        <form onSubmit={saveSettings} className="grid gap-3 md:grid-cols-2">
          <AdminInput label="Nome da loja" value={settings.store_name} onChange={(e) => setSettings({ ...settings, store_name: e.target.value })} />
          <AdminInput label="WhatsApp" value={settings.whatsapp_number} onChange={(e) => setSettings({ ...settings, whatsapp_number: e.target.value })} />
          <AdminInput label="Cor primária" type="color" value={settings.primary_color} onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })} />
          <AdminInput label="Cor secundária" type="color" value={settings.secondary_color} onChange={(e) => setSettings({ ...settings, secondary_color: e.target.value })} />
          <AdminInput label="Cor de fundo" type="color" value={settings.accent_color} onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })} />
          <div className="md:col-span-2">
            <ImageUploadField
              label="Logo"
              folder="branding"
              value={settings.logo_url || ""}
              onChange={(url) => setSettings({ ...settings, logo_url: url })}
            />
          </div>
          <div className="md:col-span-2">
            <AdminFormActions>
              <AdminButton type="submit">Salvar loja</AdminButton>
            </AdminFormActions>
          </div>
        </form>
      </AdminCard>
      <AdminCard title="Banners do carrossel" className="mt-6">
        <ImageUploadField
          label="Novo banner"
          folder="banners"
          value={newBannerUrl}
          onChange={setNewBannerUrl}
        />
        <AdminButton type="button" onClick={addBanner} className="mt-3" disabled={!newBannerUrl}>
          Adicionar banner
        </AdminButton>
        <ul className="mt-4 space-y-2">
          {banners.map((b) => (
            <li
              key={b.id}
              className={`flex flex-wrap items-center gap-3 rounded-lg border p-2 ${
                b.active ? "" : "opacity-60"
              }`}
            >
              <img src={b.image_url} alt="" className="h-12 w-20 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs text-gray-500">{b.image_url}</span>
                <span className="text-xs font-medium text-gray-400">
                  {b.active ? "Ativo no site" : "Inativo"}
                </span>
              </div>
              <div className="flex gap-2">
                <AdminButton
                  type="button"
                  variant="secondary"
                  onClick={() => toggleBanner(b.id, !b.active)}
                >
                  {b.active ? "Inativar" : "Ativar"}
                </AdminButton>
                <AdminButton
                  type="button"
                  variant="danger"
                  onClick={() => deleteBanner(b.id)}
                >
                  Excluir
                </AdminButton>
              </div>
            </li>
          ))}
        </ul>
      </AdminCard>
    </div>
  );
}
