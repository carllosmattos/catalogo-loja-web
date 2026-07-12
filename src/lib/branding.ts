import type { StoreSettings } from "@/types";

export const DEFAULT_SETTINGS: StoreSettings = {
  store_name: "LM moda feminina",
  whatsapp_number: "",
  primary_color: "#8B0A50",
  secondary_color: "#D4AF37",
  accent_color: "#FFF5F8",
  logo_url: "/logo-lm.png",
  default_banner_url: null,
};

export function mergeBrandSettings(
  settings: Partial<StoreSettings> | null
): StoreSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!merged.store_name || merged.store_name === "Minha Loja") {
    merged.store_name = DEFAULT_SETTINGS.store_name;
  }
  for (const key of [
    "primary_color",
    "secondary_color",
    "accent_color",
  ] as const) {
    if (!(settings || {})[key]) {
      merged[key] = DEFAULT_SETTINGS[key];
    }
  }
  if (!merged.logo_url) {
    merged.logo_url = DEFAULT_SETTINGS.logo_url;
  }
  return merged;
}

export function themeCssVars(settings: StoreSettings): Record<string, string> {
  return {
    "--color-primary": settings.primary_color,
    "--color-secondary": settings.secondary_color,
    "--color-accent": settings.accent_color,
  };
}
