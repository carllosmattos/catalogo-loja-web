import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildAuthorizeUrl,
  melhorEnvioClientConfigured,
} from "@/lib/melhor-envio";

function appBase(): string {
  return (
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const base = appBase();
    if (!user) {
      return NextResponse.redirect(new URL("/admin/login", base));
    }

    if (!melhorEnvioClientConfigured()) {
      return NextResponse.redirect(
        new URL(
          "/admin/frete?me_error=" +
            encodeURIComponent("Configure MELHOR_ENVIO_CLIENT_ID e SECRET no Vercel"),
          base
        )
      );
    }

    const state = crypto.randomUUID();
    const url = buildAuthorizeUrl(state);
    const res = NextResponse.redirect(url);
    res.cookies.set("me_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao conectar";
    return NextResponse.redirect(
      new URL(
        "/admin/frete?me_error=" + encodeURIComponent(msg),
        appBase()
      )
    );
  }
}
