import { getSupabaseConfigStatus } from "@/lib/supabase/env";

export function SetupBanner() {
  const status = getSupabaseConfigStatus();
  if (status.configured) return null;

  let hint = "Confira as variáveis no Vercel e faça Redeploy.";
  if (!status.hasUrl && !status.hasKey) {
    hint =
      "Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.";
  } else if (!status.hasUrl) {
    hint = "NEXT_PUBLIC_SUPABASE_URL não encontrada.";
  } else if (!status.hasKey) {
    hint = "NEXT_PUBLIC_SUPABASE_ANON_KEY não encontrada.";
  } else if (!status.urlValid) {
    hint = `URL inválida: ${status.urlDiagnostic}. Use exatamente: https://ktvlhviikifcxbibxsas.supabase.co`;
  } else if (!status.keyLooksValid) {
    hint = `Chave anon inválida (${status.keyLength} caracteres). Copie a chave completa eyJ... em Supabase → Settings → API → anon public.`;
  }

  return (
    <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
      Supabase não configurado — {hint}
    </div>
  );
}
