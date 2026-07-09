/** Resolve variáveis Supabase — aceita nomes com e sem NEXT_PUBLIC_ (comum no Vercel). */

export function resolveSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).trim();
}

export function resolveSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  ).trim();
}

export function isSupabaseConfigured(): boolean {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseAnonKey();
  return url.startsWith("https://") && key.length > 20;
}

export function getSupabaseConfigStatus(): {
  configured: boolean;
  hasUrl: boolean;
  hasKey: boolean;
  urlValid: boolean;
} {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseAnonKey();
  return {
    configured: url.startsWith("https://") && key.length > 20,
    hasUrl: url.length > 0,
    hasKey: key.length > 0,
    urlValid: url.startsWith("https://"),
  };
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  if (!url.startsWith("https://") || !anonKey) {
    throw new Error(
      "Supabase não configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no Vercel."
    );
  }
  return { url, anonKey };
}
