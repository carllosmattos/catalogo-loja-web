import { NextResponse } from "next/server";
import {
  CHAT_TOOLS,
  buildSystemPrompt,
  detectChatIntent,
  runChatTool,
  toolBuildWhatsappHandoff,
  toolListActiveCoupons,
  toolSearchProducts,
  type ChatCartAction,
  type ChatProductCard,
} from "@/lib/chat-tools";
import { fetchStoreSettings } from "@/lib/catalog";
import {
  chatCompletion,
  llmConfigured,
  type ChatMessage,
} from "@/lib/llm";
import type { CouponValidation } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const rateMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, max = 12, windowMs = 60_000): boolean {
  const now = Date.now();
  const row = rateMap.get(key);
  if (!row || now > row.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (row.count >= max) return false;
  row.count += 1;
  return true;
}

type InMsg = { role: string; content: string };

export async function POST(request: Request) {
  try {
    if (!llmConfigured()) {
      return NextResponse.json(
        {
          reply:
            "O chat está temporariamente indisponível. Fale conosco no WhatsApp.",
          handoff_whatsapp: true,
          whatsapp_url: (await toolBuildWhatsappHandoff("Chat indisponível"))
            .whatsapp_url,
        },
        { status: 503 }
      );
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "anon";
    if (!rateLimit(ip)) {
      const handoff = await toolBuildWhatsappHandoff(
        "Limite de mensagens no chat"
      );
      return NextResponse.json({
        reply:
          "Um instante… muitas mensagens agora. Prefere continuar no WhatsApp?",
        handoff_whatsapp: true,
        whatsapp_url: handoff.whatsapp_url,
      });
    }

    const body = await request.json().catch(() => ({}));
    const messagesIn = Array.isArray(body.messages)
      ? (body.messages as InMsg[])
      : [];
    const customerId = body.customerId ? String(body.customerId) : null;

    const cleaned = messagesIn
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim()
      )
      .slice(-12)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content.trim().slice(0, 1500),
      }));

    if (!cleaned.length) {
      return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
    }

    const settings = await fetchStoreSettings();
    const lastUser = [...cleaned].reverse().find((m) => m.role === "user");
    const intent = detectChatIntent(lastUser?.content || "");

    const products: ChatProductCard[] = [];
    const cartActions: ChatCartAction[] = [];
    let coupon: { code: string; validation: CouponValidation } | null = null;
    let handoffWhatsapp = false;
    let whatsappUrl: string | null = null;

    // Atalhos determinísticos (modelos free inconsistentes)
    if (intent.kind === "offtopic" || intent.kind === "human") {
      const handoff = await toolBuildWhatsappHandoff(
        intent.kind === "offtopic"
          ? "Assunto fora do escopo da loja"
          : lastUser?.content || "Atendimento humano"
      );
      return NextResponse.json({
        reply:
          intent.kind === "offtopic"
            ? "Consigo ajudar só com as peças e pedidos da loja 😊 Quer falar com a nossa equipe no WhatsApp?"
            : "Claro! Te conecto com a nossa equipe no WhatsApp.",
        handoff_whatsapp: true,
        whatsapp_url: handoff.whatsapp_url,
      });
    }

    if (intent.kind === "hesitate") {
      const listed = await toolListActiveCoupons();
      if (listed.has_coupons && listed.coupons[0]) {
        const code = listed.coupons[0].code;
        const { validation } = await runChatTool(
          "validate_coupon",
          JSON.stringify({ code }),
          customerId
        ) as { validation: CouponValidation };
        if (validation.ok) {
          coupon = { code, validation };
        }
      }
    }

    if (intent.kind === "search" && intent.query) {
      const found = await toolSearchProducts(intent.query, 6);
      products.push(...found.products);
    }

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(settings.store_name) },
      ...cleaned.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    if (products.length) {
      messages.push({
        role: "system",
        content: `Resultados de busca já obtidos (use estes dados, não invente):\n${JSON.stringify(products)}`,
      });
    }
    if (coupon) {
      messages.push({
        role: "system",
        content: `Cupom disponível para oferecer: ${JSON.stringify(coupon)}`,
      });
    }

    let reply = "";
    const maxRounds = 3;

    try {
      for (let round = 0; round < maxRounds; round++) {
        const result = await chatCompletion({
          messages,
          tools: CHAT_TOOLS,
        });

        if (result.tool_calls?.length) {
          messages.push({
            role: "assistant",
            content: result.content,
            tool_calls: result.tool_calls,
          });

          for (const call of result.tool_calls) {
            const toolName = call.function?.name || "";
            const toolResult = await runChatTool(
              toolName,
              call.function?.arguments || "{}",
              customerId
            );

            if (toolName === "search_products") {
              const r = toolResult as { products?: ChatProductCard[] };
              if (r.products?.length) products.push(...r.products);
            }
            if (toolName === "get_product") {
              const r = toolResult as { product?: ChatProductCard | null };
              if (r.product) products.push(r.product);
            }
            if (toolName === "add_to_cart") {
              const r = toolResult as ChatCartAction | { error: string };
              if ("type" in r && r.type === "add") cartActions.push(r);
            }
            if (toolName === "validate_coupon") {
              const r = toolResult as { validation: CouponValidation };
              if (r.validation?.ok && r.validation.code) {
                coupon = {
                  code: String(r.validation.code),
                  validation: r.validation,
                };
              }
            }
            if (toolName === "list_active_coupons") {
              const r = toolResult as {
                coupons?: Array<{ code: string }>;
                has_coupons?: boolean;
              };
              if (r.has_coupons && r.coupons?.[0]?.code && !coupon) {
                const code = r.coupons[0].code;
                const validated = (await runChatTool(
                  "validate_coupon",
                  JSON.stringify({ code }),
                  customerId
                )) as { validation: CouponValidation };
                if (validated.validation?.ok) {
                  coupon = { code, validation: validated.validation };
                }
              }
            }
            if (toolName === "build_whatsapp_handoff") {
              const r = toolResult as {
                whatsapp_url?: string | null;
                ok?: boolean;
              };
              if (r.whatsapp_url) {
                handoffWhatsapp = true;
                whatsappUrl = r.whatsapp_url;
              }
            }

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify(toolResult),
            });
          }
          continue;
        }

        reply = (result.content || "").trim();
        break;
      }
    } catch (e) {
      console.error("[chat] llm", e);
      const handoff = await toolBuildWhatsappHandoff(
        "Falha no assistente virtual"
      );
      return NextResponse.json({
        reply:
          "Estou com instabilidade agora. Posso te passar para o WhatsApp da loja?",
        handoff_whatsapp: true,
        whatsapp_url: handoff.whatsapp_url,
        products: dedupeProducts(products),
        cart_actions: cartActions,
        coupon,
      });
    }

    if (!reply) {
      if (products.length) {
        reply =
          "Encontrei estas opções. Quer que eu detalhe alguma ou adicione no carrinho (me diga o tamanho)?";
      } else if (coupon) {
        reply = `Tenho um cupom que pode ajudar: ${coupon.code}. Posso aplicar no carrinho se quiser.`;
      } else if (intent.kind === "hesitate") {
        reply =
          "Entendo! No momento não tenho cupom ativo, mas posso te ajudar a escolher outra peça ou falar no WhatsApp.";
      } else {
        reply =
          "Posso te ajudar a achar uma peça, ver tamanhos/estoque ou aplicar cupom. O que você procura?";
      }
    }

    // Parse soft markers from model text
    if (/whatsapp|atendente/i.test(reply) && !whatsappUrl) {
      const handoff = await toolBuildWhatsappHandoff(lastUser?.content || "");
      handoffWhatsapp = true;
      whatsappUrl = handoff.whatsapp_url;
    }

    return NextResponse.json({
      reply,
      products: dedupeProducts(products).slice(0, 8),
      cart_actions: cartActions,
      coupon,
      handoff_whatsapp: handoffWhatsapp,
      whatsapp_url: whatsappUrl,
      go_checkout: /pagamento|checkout|carrinho|finalizar/i.test(reply),
    });
  } catch (e) {
    console.error("[chat]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro no chat" },
      { status: 500 }
    );
  }
}

function dedupeProducts(list: ChatProductCard[]): ChatProductCard[] {
  const seen = new Set<string>();
  const out: ChatProductCard[] = [];
  for (const p of list) {
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
