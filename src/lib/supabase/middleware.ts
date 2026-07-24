import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isSupabaseConfigured,
  resolveSupabaseUrl,
  resolveSupabaseAnonKey,
} from "@/lib/supabase/env";

/** Rotas da loja que o admin logado não deve usar (usa Vendas/Pagamentos). */
function isCustomerShoppingPath(pathname: string): boolean {
  if (pathname.startsWith("/admin")) return false;
  if (pathname.startsWith("/api")) return false;
  // Bloqueia catálogo, conta, carrinho e também /pedidos/[token] —
  // cliente abre o link no celular sem sessão admin.
  return (
    pathname === "/" ||
    pathname.startsWith("/catalogo") ||
    pathname.startsWith("/produto") ||
    pathname.startsWith("/carrinho") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/conta") ||
    pathname.startsWith("/pedidos")
  );
}

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    resolveSupabaseUrl(),
    resolveSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (
    path.startsWith("/admin") &&
    !path.startsWith("/admin/login") &&
    !user
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }

  // Admin autenticado não navega a loja como cliente
  if (user && isCustomerShoppingPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/vendas";
    url.search = "";
    url.searchParams.set("aviso", "loja");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
