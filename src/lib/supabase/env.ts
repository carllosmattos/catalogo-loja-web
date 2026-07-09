/** Resolve variáveis Supabase — aceita nomes com e sem NEXT_PUBLIC_ (comum no Vercel). */

function cleanEnv(value: string | undefined): string {
  let v = (value || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function resolveSupabaseUrl(): string {
  return cleanEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
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

export function isSupabaseConfigured(): boolean {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseAnonKey();
  return url.startsWith("https://") && isValidAnonKey(key);
}

export function getSupabaseConfigStatus(): {
  configured: boolean;
  hasUrl: boolean;
  hasKey: boolean;
  urlValid: boolean;
  keyLength: number;
  keyLooksValid: boolean;
} {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseAnonKey();
  return {
    configured: url.startsWith("https://") && isValidAnonKey(key),
    hasUrl: url.length > 0,
    hasKey: key.length > 0,
    urlValid: url.startsWith("https://"),
    keyLength: key.length,
    keyLooksValid: isValidAnonKey(key),
  };
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  if (!url.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL inválida.");
  }
  if (!isValidAnonKey(anonKey)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY inválida — copie a chave anon completa (eyJ...) no Supabase → Settings → API."
    );
  }
  return { url, anonKey };
}
