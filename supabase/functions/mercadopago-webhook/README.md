# Deploy desta Edge Function

O código no GitHub **não** aparece sozinho no painel. É preciso publicar uma vez.

## Opção A — Painel Supabase (sem instalar CLI)

1. [Dashboard](https://supabase.com/dashboard) → projeto **ktvlhviikifcxbibxsas**
2. Menu **Edge Functions** → **Deploy a new function** → **Via Editor**
3. Nome: `mercadopago-webhook` (igual ao nome da pasta)
4. Cole o conteúdo de `index.ts` → **Deploy**
5. **Edge Functions** → `mercadopago-webhook` → **Secrets**:
   - `MERCADOPAGO_ACCESS_TOKEN`
   - `SUPABASE_URL` = `https://ktvlhviikifcxbibxsas.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` (Settings → API → service_role)

URL final:

`https://ktvlhviikifcxbibxsas.supabase.co/functions/v1/mercadopago-webhook`

## Opção B — CLI (Windows)

```powershell
npx supabase@latest login
cd c:\workspace\catalogo-loja-web
npx supabase@latest link --project-ref ktvlhviikifcxbibxsas
npx supabase@latest secrets set MERCADOPAGO_ACCESS_TOKEN=seu_token --project-ref ktvlhviikifcxbibxsas
npx supabase@latest secrets set SUPABASE_URL=https://ktvlhviikifcxbibxsas.supabase.co --project-ref ktvlhviikifcxbibxsas
npx supabase@latest secrets set SUPABASE_SERVICE_ROLE_KEY=sua_service_role --project-ref ktvlhviikifcxbibxsas
npx supabase@latest functions deploy mercadopago-webhook --project-ref ktvlhviikifcxbibxsas
```

Depois use essa URL em `MERCADOPAGO_WEBHOOK_URL` (Vercel / `.env.local`).
