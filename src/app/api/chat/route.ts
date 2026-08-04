import { NextResponse } from "next/server";
import {
  CHAT_TOOLS,
  buildFactualProductReply,
  buildSystemPrompt,
  buildWhatsappContextSummary,
  countHesitations,
  detectChatIntent,
  extractProductHintFromHistory,
  runChatTool,
  sanitizeAssistantReply,
  toolBuildWhatsappHandoff,
  toolGetStoreInfo,
  toolListApplicableCoupons,
  toolListRecentProducts,
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
          whatsapp_url: (
            await toolBuildWhatsappHandoff(
              "Chat indisponível — cliente pediu atendimento."
            )
          ).whatsapp_url,
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
        "Limite de mensagens no chat do site."
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
    const historyHint = extractProductHintFromHistory(cleaned);
    const waSummary = () =>
      buildWhatsappContextSummary(cleaned, { productHint: historyHint });

    const products: ChatProductCard[] = [];
    const cartActions: ChatCartAction[] = [];
    let coupon: { code: string; validation: CouponValidation } | null = null;
    let handoffWhatsapp = false;
    let whatsappUrl: string | null = null;

    if (intent.kind === "offtopic" || intent.kind === "human") {
      const handoff = await toolBuildWhatsappHandoff(waSummary());
      return NextResponse.json({
        reply: sanitizeAssistantReply(
          intent.kind === "offtopic"
            ? "Consigo ajudar só com as peças e pedidos da loja 😊 Quer falar com a nossa equipe no WhatsApp?"
            : "Claro! Te conecto com a nossa equipe no WhatsApp."
        ),
        handoff_whatsapp: true,
        whatsapp_url: handoff.whatsapp_url,
      });
    }

    if (intent.kind === "about_store") {
      const info = await toolGetStoreInfo();
      return NextResponse.json({
        reply: sanitizeAssistantReply(
          `${info.about} Quer que eu te ajude a achar uma peça?`
        ),
        products: [],
        cart_actions: [],
        coupon: null,
        handoff_whatsapp: false,
        whatsapp_url: null,
      });
    }

    // Cupom só se pedir explicitamente OU insistir no preço (2+ hesitações)
    const hesitations = countHesitations(cleaned);
    const mayOfferCoupon =
      intent.kind === "ask_coupon" ||
      (intent.kind === "hesitate" && hesitations >= 2);

    if (mayOfferCoupon) {
      const listed = await toolListApplicableCoupons(customerId);
      if (listed.has_coupons && listed.coupons[0]) {
        coupon = {
          code: listed.coupons[0].code,
          validation: listed.coupons[0].validation,
        };
      }
    }

    if (intent.kind === "search" && intent.query) {
      const found = await toolSearchProducts(intent.query, 6);
      products.push(...found.products);
    } else if (intent.kind === "list") {
      const listed = await toolListRecentProducts(8);
      products.push(...listed.products);
    } else if (intent.kind === "price") {
      const q = historyHint || intent.query;
      if (q) {
        const found = await toolSearchProducts(q, 4);
        products.push(...found.products);
      }
    } else if (
      historyHint &&
      /\b(dela|dele|dessa|desse|essa|esse|aquela)\b/i.test(
        lastUser?.content || ""
      )
    ) {
      const found = await toolSearchProducts(historyHint, 4);
      products.push(...found.products);
    }

    if (
      products.length &&
      (intent.kind === "price" ||
        intent.kind === "list" ||
        intent.kind === "search" ||
        /\b(valor|preco|preço|custa|quanto)\b/i.test(lastUser?.content || ""))
    ) {
      const mode =
        intent.kind === "price" ||
        /\b(valor|preco|preço|custa|quanto)\b/i.test(lastUser?.content || "")
          ? "price"
          : intent.kind === "list"
            ? "list"
            : "search";
      const factual = buildFactualProductReply(dedupeProducts(products), mode);
      return NextResponse.json({
        reply: sanitizeAssistantReply(factual),
        products: dedupeProducts(products).slice(0, 8),
        cart_actions: [],
        coupon: null,
        handoff_whatsapp: false,
        whatsapp_url: null,
      });
    }

    // Primeira hesitação: força negociação sem cupom
    if (intent.kind === "hesitate" && hesitations < 2) {
      return NextResponse.json({
        reply: sanitizeAssistantReply(
          [
            "Entendo perfeitamente — o investimento importa.",
            "Me conta o que mais pesou pra você: o valor em si, o caimento, ou estava comparando com outra peça?",
            "As nossas peças priorizam caimento e acabamento pra vestir bem no dia a dia. Se quiser, te ajudo a achar uma opção no seu estilo e orçamento.",
          ].join(" ")
        ),
        products: dedupeProducts(products).slice(0, 8),
        cart_actions: [],
        coupon: null,
        handoff_whatsapp: false,
        whatsapp_url: null,
      });
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
        content: `DADOS DO CATÁLOGO (obrigatório — use só estes preços/estoques):\n${JSON.stringify(dedupeProducts(products))}`,
      });
    }
    if (coupon) {
      messages.push({
        role: "system",
        content: `Pode oferecer NO MÁXIMO este cupom (já validado para a cliente): ${JSON.stringify(coupon)}. Não liste outros.`,
      });
    } else if (intent.kind === "ask_coupon") {
      messages.push({
        role: "system",
        content:
          "Não há cupom aplicável agora para esta cliente. Seja honesta e ofereça ajuda por qualidade/outra peça ou WhatsApp.",
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
            let toolResult = await runChatTool(
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
              if (r.validation?.ok && r.validation.code && mayOfferCoupon) {
                coupon = {
                  code: String(r.validation.code),
                  validation: r.validation,
                };
              }
            }
            if (toolName === "list_active_coupons") {
              if (!mayOfferCoupon) {
                toolResult = {
                  coupons: [],
                  has_coupons: false,
                  note: "Ainda não ofereça cupom — continue negociando (qualidade/motivo).",
                };
              } else {
                const r = toolResult as {
                  coupons?: Array<{
                    code: string;
                    validation: CouponValidation;
                  }>;
                  has_coupons?: boolean;
                };
                if (r.has_coupons && r.coupons?.[0]?.code && !coupon) {
                  coupon = {
                    code: r.coupons[0].code,
                    validation: r.coupons[0].validation,
                  };
                }
              }
            }
            if (toolName === "build_whatsapp_handoff") {
              toolResult = await toolBuildWhatsappHandoff(waSummary());
              const r = toolResult as {
                whatsapp_url?: string | null;
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

        reply = sanitizeAssistantReply(result.content || "");
        break;
      }
    } catch (e) {
      console.error("[chat] llm", e);
      const handoff = await toolBuildWhatsappHandoff(waSummary());
      return NextResponse.json({
        reply: sanitizeAssistantReply(
          "Estou com instabilidade agora. Posso te passar para o WhatsApp da loja?"
        ),
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
      } else if (intent.kind === "ask_coupon" || mayOfferCoupon) {
        reply =
          "No momento não tenho cupom aplicável pra você, mas posso te ajudar a escolher outra peça ou falar no WhatsApp.";
      } else {
        reply =
          "Posso te ajudar a achar uma peça, ver tamanhos/estoque ou tirar dúvidas da loja. O que você procura?";
      }
      reply = sanitizeAssistantReply(reply);
    }

    if (/whatsapp|atendente/i.test(reply) && !whatsappUrl) {
      const handoff = await toolBuildWhatsappHandoff(waSummary());
      handoffWhatsapp = true;
      whatsappUrl = handoff.whatsapp_url;
    }

    return NextResponse.json({
      reply,
      products: dedupeProducts(products).slice(0, 8),
      cart_actions: cartActions,
      coupon: mayOfferCoupon ? coupon : null,
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
