import { NextResponse } from "next/server";
import { getSupabaseConfigStatus } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/** Diagnóstico — não expõe segredos. Acesse /api/health no Vercel. */
export async function GET() {
  const status = getSupabaseConfigStatus();
  return NextResponse.json({
    ok: status.configured,
    supabase: status,
    hint: status.configured
      ? "Supabase OK"
      : "Adicione NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no Vercel → Redeploy",
  });
}
