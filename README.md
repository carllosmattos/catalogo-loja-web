# LM Moda — Catálogo Web (Next.js)

Frontend React/Next.js do catálogo de moda feminina.

## Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 4
- Supabase (banco, auth, storage, RPCs)
- Mercado Pago PIX + WhatsApp checkout
- Deploy: Vercel (grátis)

## Desenvolvimento local

```bash
cp .env.local.example .env.local
# Preencha com credenciais do Supabase e Mercado Pago
npm install
npm run dev
```

Acesse http://localhost:3000

## Deploy no Vercel

Este projeto fica na **raiz do repositório** — não precisa configurar Root Directory.

1. Crie um repositório no GitHub (ex: `catalogo-loja-web`)
2. Faça push desta pasta
3. No [Vercel](https://vercel.com) → **Add New Project** → importe o repo
4. **Root Directory:** deixe em branco (`.` — raiz)
5. Configure as variáveis de ambiente:

| Variável | Descrição |
|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (server only) |
| `MERCADOPAGO_ACCESS_TOKEN` | Token MP para PIX |
| `MERCADOPAGO_WEBHOOK_URL` | URL da Edge Function webhook |
| `APP_BASE_URL` | URL de produção (ex: https://sua-loja.vercel.app) |
| `PAYMENTS_ENABLED` | `true` |
| `RESEND_API_KEY` | E-mail de pagamento aprovado (Resend) |
| `EMAIL_FROM` | Remetente (teste: `LM Moda <onboarding@resend.dev>`) |
| `EMAIL_TEST_TO` | Opcional — força destino no teste com onboarding@ |
| `OPENROUTER_API_KEY` | Chat IA da loja (OpenRouter) |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |
| `LLM_MODELS` | Lista CSV de modelos `:free` com failover |
| `MELHOR_ENVIO_TOKEN` | Opcional — cotação de frete |

6. Após deploy, atualize `APP_BASE_URL` com a URL real

**Segredos:** nunca commite `.env.local` — só `.env.local.example`.

## Estrutura

```
src/app/(loja)/     # Loja pública
src/app/admin/      # Painel admin
src/app/api/        # Checkout PIX, frete, pagamentos
src/lib/            # Lógica de negócio
src/components/     # UI components
supabase/           # Migrations SQL + Edge Functions
```

## Admin

Acesse `/admin/login` com usuário Supabase Auth.

## Banco de dados

Migrations e Edge Functions ficam em [`supabase/`](supabase/) neste repositório (fonte de verdade). Aplique SQL novos no Supabase SQL Editor na ordem numérica; detalhes em [`supabase/README.md`](supabase/README.md).
