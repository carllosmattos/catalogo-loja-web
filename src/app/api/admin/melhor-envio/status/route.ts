import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  clearMelhorEnvioTokens,
  getMelhorEnvioConnectionStatus,
  melhorEnvioRedirectUri,
} from "@/lib/melhor-envio";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const status = await getMelhorEnvioConnectionStatus();
  return NextResponse.json({
    ...status,
    redirectUri: melhorEnvioRedirectUri(),
  });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  await clearMelhorEnvioTokens();
  return NextResponse.json({ ok: true });
}
