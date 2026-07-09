import { NextResponse } from "next/server";
import { getSupabaseConfigStatus } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/** Diagnóstico — não expõe segredos. Acesse /api/health no Vercel. */
export async function GET() {
  const status = getSupabaseConfigStatus();
  let hint = "Supabase OK";
  if (!status.configured) {
    if (!status.hasUrl || !status.hasKey) {
      hint = "Faltam variáveis NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY";
    } else if (!status.urlValid) {
      hint = `URL inválida: ${status.urlDiagnostic}. Corrija NEXT_PUBLIC_SUPABASE_URL no Vercel → Redeploy`;
    } else if (!status.keyLooksValid) {
      hint = `Chave anon inválida (${status.keyLength} chars). Deve ser o JWT completo eyJ... (~200+ caracteres) do Supabase → Settings → API → anon public`;
    }
  }
  return NextResponse.json({ ok: status.configured, supabase: status, hint });
}
