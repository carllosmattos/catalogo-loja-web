import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  clearMelhorEnvioTokens,
  getMelhorEnvioConnectionStatus,
  melhorEnvioConfigDiagnostic,
  melhorEnvioRedirectUri,
} from "@/lib/melhor-envio";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const diagnostic = melhorEnvioConfigDiagnostic();

  if (!user) {
    return NextResponse.json(
      {
        error: "Não autenticado",
        ...diagnostic,
        connected: false,
        expiresAt: null,
        expiresInDays: null,
      },
      { status: 401 }
    );
  }

  const status = await getMelhorEnvioConnectionStatus();
  return NextResponse.json({
    ...status,
    ...diagnostic,
    redirectUri: diagnostic.redirectUri || melhorEnvioRedirectUri(),
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
