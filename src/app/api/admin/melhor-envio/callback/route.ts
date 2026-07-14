import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeAuthorizationCode,
  melhorEnvioRedirectUri,
  saveMelhorEnvioTokens,
} from "@/lib/melhor-envio";

function appBase(): string {
  return (
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

export async function GET(request: NextRequest) {
  const base = appBase();
  const freteUrl = new URL("/admin/frete", base);

  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const error = request.nextUrl.searchParams.get("error");
    const cookieState = request.cookies.get("me_oauth_state")?.value;

    if (error) {
      freteUrl.searchParams.set(
        "me_error",
        request.nextUrl.searchParams.get("error_description") || error
      );
      return NextResponse.redirect(freteUrl);
    }

    if (!code) {
      freteUrl.searchParams.set("me_error", "Código OAuth ausente");
      return NextResponse.redirect(freteUrl);
    }

    if (!state || !cookieState || state !== cookieState) {
      freteUrl.searchParams.set("me_error", "State OAuth inválido — tente conectar de novo");
      return NextResponse.redirect(freteUrl);
    }

    // Garante redirect_uri igual ao cadastrado no app
    void melhorEnvioRedirectUri();

    const tokens = await exchangeAuthorizationCode(code);
    await saveMelhorEnvioTokens(tokens);

    freteUrl.searchParams.set("me", "connected");
    const res = NextResponse.redirect(freteUrl);
    res.cookies.set("me_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    freteUrl.searchParams.set(
      "me_error",
      e instanceof Error ? e.message : "Falha ao salvar tokens"
    );
    return NextResponse.redirect(freteUrl);
  }
}
