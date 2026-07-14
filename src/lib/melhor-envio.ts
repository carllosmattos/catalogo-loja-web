import { createServiceClient } from "@/lib/supabase/server";

const ME_SCOPES = [
  "shipping-calculate",
  "shipping-companies",
  "shipping-preview",
  "cart-read",
  "cart-write",
  "companies-read",
].join(" ");

export function melhorEnvioBaseUrl(): string {
  const sandbox = (process.env.MELHOR_ENVIO_SANDBOX || "").trim() === "true";
  return sandbox
    ? "https://sandbox.melhorenvio.com.br"
    : "https://melhorenvio.com.br";
}

export function melhorEnvioUserAgent(): string {
  return (
    process.env.MELHOR_ENVIO_USER_AGENT?.trim() ||
    "LM Moda Catalogo (contato@loja.local)"
  );
}

export function melhorEnvioClientConfigured(): boolean {
  return Boolean(
    process.env.MELHOR_ENVIO_CLIENT_ID?.trim() &&
      process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim()
  );
}

export function melhorEnvioRedirectUri(): string {
  const explicit = process.env.MELHOR_ENVIO_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = (
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
  return `${base}/api/admin/melhor-envio/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const clientId = process.env.MELHOR_ENVIO_CLIENT_ID?.trim();
  if (!clientId) throw new Error("MELHOR_ENVIO_CLIENT_ID não configurado.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: melhorEnvioRedirectUri(),
    response_type: "code",
    scope: ME_SCOPES,
    state,
  });
  return `${melhorEnvioBaseUrl()}/oauth/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const clientId = process.env.MELHOR_ENVIO_CLIENT_ID?.trim();
  const clientSecret = process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Client ID/Secret do Melhor Envio não configurados.");
  }

  const payload: Record<string, string> = {
    grant_type: body.grant_type,
    client_id: clientId,
    client_secret: clientSecret,
    ...body,
  };
  if (body.grant_type === "authorization_code") {
    payload.redirect_uri = melhorEnvioRedirectUri();
  }

  const res = await fetch(`${melhorEnvioBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": melhorEnvioUserAgent(),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    if (data?.error === "invalid_client") {
      throw new Error(
        "invalid_client: Client ID/Secret incorretos ou sandbox/produção trocados no Vercel."
      );
    }
    const msg =
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Falha OAuth Melhor Envio (${res.status})`;
    throw new Error(String(msg));
  }

  return {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token || ""),
    expires_in: Number(data.expires_in) || 2592000,
    token_type: data.token_type ? String(data.token_type) : "Bearer",
    scope: data.scope ? String(data.scope) : "",
  };
}

export async function exchangeAuthorizationCode(code: string): Promise<TokenResponse> {
  return requestToken({
    grant_type: "authorization_code",
    code,
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function saveMelhorEnvioTokens(tokens: TokenResponse): Promise<void> {
  const supabase = await createServiceClient();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error } = await supabase.from("melhor_envio_credentials").upsert({
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || "",
    token_type: tokens.token_type || "Bearer",
    expires_at: expiresAt,
    scope: tokens.scope || "",
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function clearMelhorEnvioTokens(): Promise<void> {
  const supabase = await createServiceClient();
  await supabase
    .from("melhor_envio_credentials")
    .upsert({
      id: 1,
      access_token: "",
      refresh_token: "",
      token_type: "Bearer",
      expires_at: null,
      scope: "",
      updated_at: new Date().toISOString(),
    });
}

export async function getMelhorEnvioConnectionStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  expiresAt: string | null;
  expiresInDays: number | null;
}> {
  const configured = melhorEnvioClientConfigured();
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("melhor_envio_credentials")
      .select("access_token, refresh_token, expires_at")
      .eq("id", 1)
      .maybeSingle();

    const connected = Boolean(data?.access_token || data?.refresh_token);
    let expiresInDays: number | null = null;
    if (data?.expires_at) {
      expiresInDays = Math.max(
        0,
        Math.round(
          (new Date(data.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      );
    }
    return {
      configured,
      connected,
      expiresAt: data?.expires_at || null,
      expiresInDays,
    };
  } catch {
    return { configured, connected: false, expiresAt: null, expiresInDays: null };
  }
}

/**
 * Retorna um access token válido (OAuth com refresh, ou MELHOR_ENVIO_TOKEN legado).
 */
export async function getValidMelhorEnvioAccessToken(): Promise<string | null> {
  // OAuth preferido
  if (melhorEnvioClientConfigured()) {
    try {
      const supabase = await createServiceClient();
      const { data } = await supabase
        .from("melhor_envio_credentials")
        .select("access_token, refresh_token, expires_at")
        .eq("id", 1)
        .maybeSingle();

      if (data?.access_token) {
        const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
        const stillValid = expiresAt > Date.now() + 60_000; // margem 1 min
        if (stillValid) return data.access_token;

        if (data.refresh_token) {
          const refreshed = await refreshAccessToken(data.refresh_token);
          // Preserva refresh_token se a API não devolver um novo
          if (!refreshed.refresh_token) {
            refreshed.refresh_token = data.refresh_token;
          }
          await saveMelhorEnvioTokens(refreshed);
          return refreshed.access_token;
        }
      }
    } catch (e) {
      console.error("Melhor Envio OAuth token:", e);
    }
  }

  // Fallback: token manual (expira rápido)
  const staticToken = process.env.MELHOR_ENVIO_TOKEN?.trim();
  return staticToken || null;
}
