# Supabase — migrations e Edge Functions

Fonte de verdade do schema da loja **LM Moda** (Next.js em produção).

Scripts versionados em ordem numérica. Execute no **SQL Editor** do Supabase (ou CLI).

## Pastas

```
supabase/
  migrations/     # 001 … 046 (+ próximas)
  functions/      # Edge Functions (ex.: mercadopago-webhook)
  config.toml
```

## Migrations recentes (após 028)

| # | Arquivo | Conteúdo |
|---|---------|----------|
| 029–032 | cupons, descontos frete | Auth cliente, frete, cupom case-insensitive |
| 033–041 | estoque, lucro, brindes | Movimentações, frete absorvido, Uber deferred |
| 042–044 | destaques, notificações, reembolsos | Featured, bell, awaiting_return |
| 045 | `order_email_log` | Idempotência e-mail de pagamento |
| 046 | shipped / received | Enviado, recebido, rastreio, lista paginada |

Para o histórico completo 001–028, veja as tabelas no histórico do git ou rode só o que ainda falta no projeto.

## Já tem banco em produção?

**Não** rode o **001** de novo. Aplique apenas migrations ainda não executadas (ex.: **045**, **046**).

## Edge Function Mercado Pago

Ver [`functions/mercadopago-webhook/README.md`](functions/mercadopago-webhook/README.md).

Deploy via painel ou:

```powershell
cd c:\workspace\catalogo-loja-web
npx supabase@latest functions deploy mercadopago-webhook --project-ref SEU_PROJECT_REF
```

## Nota

Uma cópia espelhada pode existir no repo Streamlit `catalogo`. **Novas** migrations e functions devem ser adicionadas **aqui** (`catalogo-loja-web/supabase/`).
