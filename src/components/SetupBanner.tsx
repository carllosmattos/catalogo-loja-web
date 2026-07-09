import { getSupabaseConfigStatus } from "@/lib/supabase/env";

export function SetupBanner() {
  const status = getSupabaseConfigStatus();
  if (status.configured) return null;

  let hint = "Confira os nomes exatos no Vercel e faça redeploy.";
  if (!status.hasUrl && !status.hasKey) {
    hint =
      "Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (ou SUPABASE_URL / SUPABASE_ANON_KEY).";
  } else if (!status.hasUrl) {
    hint = "NEXT_PUBLIC_SUPABASE_URL não encontrada.";
  } else if (!status.hasKey) {
    hint = "NEXT_PUBLIC_SUPABASE_ANON_KEY não encontrada.";
  } else if (!status.urlValid) {
    hint = "URL inválida — use https:// (sem hhttps, sem espaços).";
  }

  return (
    <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
      Supabase não configurado — {hint} Depois de salvar no Vercel, clique em
      Redeploy.
    </div>
  );
}
