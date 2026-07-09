import { isSupabaseConfigured } from "@/lib/supabase/env";

export function SetupBanner() {
  if (isSupabaseConfigured()) return null;
  return (
    <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
      Supabase não configurado — adicione NEXT_PUBLIC_SUPABASE_URL e
      NEXT_PUBLIC_SUPABASE_ANON_KEY no Vercel e faça redeploy.
    </div>
  );
}
