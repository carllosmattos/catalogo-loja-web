/** Resolve variáveis Supabase — aceita nomes com e sem NEXT_PUBLIC_ (comum no Vercel). */

function cleanEnv(value: string | undefined): string {
  let v = (value || "").trim();
  // Remove BOM / caracteres invisíveis no início
  v = v.replace(/^\uFEFF/, "");
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/** Corrige typos comuns na URL do Supabase. */
export function normalizeSupabaseUrl(raw: string): string {
  let v = cleanEnv(raw);
  if (v.startsWith("hhttps://")) v = v.slice(1);
  if (v.startsWith("http://")) v = `https://${v.slice("http://".length)}`;
  if (!v.startsWith("https://") && v.includes(".supabase.co")) {
    v = `https://${v.replace(/^\/+/, "")}`;
  }
  // Remove /rest/v1, /auth/v1 etc. — Project URL é só o domínio base
  const baseMatch = v.match(/^(https:\/\/[a-z0-9-]+\.supabase\.co)/i);
  if (baseMatch) v = baseMatch[1];
  return v.replace(/\/$/, "");
}

export function resolveSupabaseUrl(): string {
  return normalizeSupabaseUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  );
}

export function resolveSupabaseAnonKey(): string {
  return cleanEnv(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  );
}

/** Chave anon do Supabase é um JWT longo (eyJ...). */
export function isValidAnonKey(key: string): boolean {
  return key.startsWith("eyJ") && key.length > 100;
}

export function isValidSupabaseUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
}

export function isSupabaseConfigured(): boolean {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseAnonKey();
  return isValidSupabaseUrl(url) && isValidAnonKey(key);
}

export function getUrlDiagnostic(raw: string): string {
  const cleaned = cleanEnv(raw);
  if (!cleaned) return "vazia";
  if (cleaned.startsWith("hhttps://")) return "typo hhttps:// — remova o h extra";
  if (cleaned.startsWith("http://")) return "use https:// (não http://)";
  if (!cleaned.startsWith("https://") && cleaned.includes(".supabase.co")) {
    return "falta https:// no início";
  }
  if (!cleaned.includes(".supabase.co")) return "não parece URL do Supabase";
  if (/\/rest\/v1|\/auth\/v1/i.test(cleaned)) {
    return "remova /rest/v1 — use só https://SEU-REF.supabase.co";
  }
  if (cleaned.match(/\.supabase\.co\/.+/)) {
    return "remova o caminho após .supabase.co";
  }
  if (cleaned.endsWith("/")) return "remova a barra / no final";
  if (!/^https:\/\//.test(cleaned)) return `prefixo inválido: "${cleaned.slice(0, 10)}..."`;
  return "ok";
}

export function getSupabaseConfigStatus(): {
  configured: boolean;
  hasUrl: boolean;
  hasKey: boolean;
  urlValid: boolean;
  urlLength: number;
  urlDiagnostic: string;
  keyLength: number;
  keyLooksValid: boolean;
} {
  const rawUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseAnonKey();
  return {
    configured: isValidSupabaseUrl(url) && isValidAnonKey(key),
    hasUrl: rawUrl.trim().length > 0,
    hasKey: key.length > 0,
    urlValid: isValidSupabaseUrl(url),
    urlLength: url.length,
    urlDiagnostic: getUrlDiagnostic(rawUrl),
    keyLength: key.length,
    keyLooksValid: isValidAnonKey(key),
  };
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  if (!isValidSupabaseUrl(url)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL inválida (${getUrlDiagnostic(process.env.NEXT_PUBLIC_SUPABASE_URL || "")}). Use: https://SEU-REF.supabase.co`
    );
  }
  if (!isValidAnonKey(anonKey)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY inválida — copie a chave anon completa (eyJ...) no Supabase → Settings → API."
    );
  }
  return { url, anonKey };
}
