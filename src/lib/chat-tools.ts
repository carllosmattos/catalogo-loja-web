import {
  fetchActivePromotions,
  fetchProduct,
  fetchStoreSettings,
} from "@/lib/catalog";
import { validateCouponServer } from "@/lib/coupons-server";
import { calculateProfit } from "@/lib/profit";
import { createServiceClient } from "@/lib/supabase/server";
import { buildWhatsappUrl } from "@/lib/whatsapp";
import type { CouponValidation, Product, ProductSize } from "@/types";

export type ChatProductCard = {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  sizes: { size: string; stock: number }[];
};

export type ChatCartAction = {
  type: "add";
  product_id: string;
  name: string;
  size: ProductSize;
  quantity: number;
  sale_price: number;
  sale_freight: number;
  image_url?: string;
};

function productImage(p: Product): string | null {
  return p.image_urls?.[0] || null;
}

async function toCard(product: Product): Promise<ChatProductCard> {
  const promotions = await fetchActivePromotions();
  const profit = calculateProfit(product, [], promotions);
  const sizes = (product.sizes || [])
    .map((s) => ({
      size: s.size,
      stock: Number(s.stock) || 0,
    }))
    .filter((s) => s.stock > 0);
  return {
    id: product.id,
    name: product.name,
    image_url: productImage(product),
    price: Math.round((profit.preco_catalogo - profit.desconto) * 100) / 100,
    sizes,
  };
}

/** Só peças com algum tamanho em estoque. */
export function onlyInStock(cards: ChatProductCard[]): ChatProductCard[] {
  return cards.filter((p) => (p.sizes || []).some((s) => s.stock > 0));
}

export function sanitizeAssistantReply(text: string): string {
  return String(text || "")
    .replace(/<\/?channel[^>]*>/gi, "")
    .replace(/<\|[^|>]+\|>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function toolSearchProducts(query: string, limit = 6) {
  const q = String(query || "")
    .trim()
    .replace(/[%_,.()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (!q) return { products: [] as ChatProductCard[], note: "Informe um termo de busca." };

  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .or(`name.ilike.%${q}%,category.ilike.%${q}%,description.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(Math.min(12, Math.max(1, limit)));

  const ids = (data || []).map((p) => p.id);
  if (!ids.length) {
    // Fallback: primeiros produtos ativos
    const { data: fallback } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(6);
    const withSizes = await attachSizesLocal(fallback || []);
    const cards = onlyInStock(await Promise.all(withSizes.map(toCard)));
    return {
      products: cards,
      note: `Nada encontrado para "${q}". Seguem peças com estoque.`,
    };
  }

  const withSizes = await attachSizesLocal(data || []);
  const cards = onlyInStock(await Promise.all(withSizes.map(toCard)));
  return { products: cards, note: null as string | null };
}

export async function toolListRecentProducts(limit = 8) {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(Math.min(12, Math.max(1, limit)));
  const withSizes = await attachSizesLocal(data || []);
  const cards = onlyInStock(await Promise.all(withSizes.map(toCard)));
  return { products: cards, note: null as string | null };
}

export async function toolGetProduct(productId: string) {
  const product = await fetchProduct(productId);
  if (!product) return { error: "Produto não encontrado", product: null };
  const card = await toCard(product);
  if (!card.sizes.length) {
    return {
      error: "Produto sem estoque no momento",
      product: null,
      unavailable: true,
      name: product.name,
    };
  }
  const promotions = await fetchActivePromotions();
  const profit = calculateProfit(product, [], promotions);
  return {
    product: {
      ...card,
      description: product.description || "",
      category: product.category || "",
      sale_freight: Number(product.sale_freight) || 0,
      promotion: profit.promotion_name,
      price_final: profit.preco_final_cliente,
    },
  };
}

/** Cupons ativos E aplicáveis à cliente (validate_coupon ok). */
export async function toolListApplicableCoupons(
  customerId: string | null | undefined,
  subtotal = 100,
  shipping = 20
) {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("coupons")
    .select(
      "code, title, discount_type, discount_value, discount_target, max_uses, used_count, active"
    )
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(15);

  const candidates = (data || []).filter(
    (c) => Number(c.used_count) < Number(c.max_uses)
  );

  const applicable: Array<{
    code: string;
    title: string;
    discount_type: string;
    discount_value: number;
    discount_target: string;
    validation: CouponValidation;
  }> = [];

  for (const c of candidates) {
    const validation = await validateCouponServer(
      String(c.code),
      customerId,
      subtotal,
      shipping
    );
    if (!validation.ok) continue;
    applicable.push({
      code: String(c.code),
      title: String(c.title || ""),
      discount_type: String(c.discount_type),
      discount_value: Number(c.discount_value),
      discount_target: String(c.discount_target || "product"),
      validation,
    });
    if (applicable.length >= 3) break;
  }

  return {
    coupons: applicable,
    has_coupons: applicable.length > 0,
  };
}

export async function toolListActiveCoupons(customerId?: string | null) {
  return toolListApplicableCoupons(customerId);
}

export async function toolValidateCoupon(
  code: string,
  customerId: string | null | undefined,
  subtotal = 100,
  shipping = 20
): Promise<{ validation: CouponValidation }> {
  const validation = await validateCouponServer(
    code,
    customerId,
    subtotal,
    shipping
  );
  return { validation };
}

export function buildWhatsappContextSummary(
  messages: Array<{ role: string; content: string }>,
  extras?: { productHint?: string | null }
): string {
  const recent = messages.slice(-8);
  const lines: string[] = [
    "Resumo do atendimento no chat do site:",
  ];
  if (extras?.productHint) {
    lines.push(`Peça mencionada: ${extras.productHint}`);
  }
  for (const m of recent) {
    const who = m.role === "user" ? "Cliente" : "Consultora";
    const text = String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (text) lines.push(`- ${who}: ${text}`);
  }
  lines.push("", "Pode continuar o atendimento por aqui?");
  return lines.join("\n");
}

export async function toolBuildWhatsappHandoff(summary: string) {
  const settings = await fetchStoreSettings();
  if (!settings.whatsapp_number) {
    return {
      ok: false,
      whatsapp_url: null as string | null,
      error: "WhatsApp não configurado",
    };
  }
  const msg = [
    `Olá! Vim pelo chat da ${settings.store_name}.`,
    "",
    summary.trim() || "Gostaria de atendimento humano.",
  ].join("\n");
  return {
    ok: true,
    whatsapp_url: buildWhatsappUrl(settings.whatsapp_number, msg),
    error: null as string | null,
  };
}

export async function buildCartAction(
  productId: string,
  size: string,
  quantity = 1
): Promise<ChatCartAction | { error: string }> {
  const product = await fetchProduct(productId);
  if (!product) return { error: "Produto não encontrado" };
  const sz = (size || "M").toUpperCase() as ProductSize;
  const stockRow = (product.sizes || []).find((s) => s.size === sz);
  const stock = stockRow ? Number(stockRow.stock) : 0;
  if (stock <= 0) return { error: `Tamanho ${sz} sem estoque` };

  const promotions = await fetchActivePromotions();
  const profit = calculateProfit(product, [], promotions, sz);
  const unit = Math.round((profit.preco_catalogo - profit.desconto) * 100) / 100;

  return {
    type: "add",
    product_id: product.id,
    name: product.name,
    size: sz,
    quantity: Math.max(1, Math.min(5, quantity)),
    sale_price: unit,
    sale_freight: Number(product.sale_freight) || 0,
    image_url: productImage(product) || undefined,
  };
}

async function attachSizesLocal(products: Product[]): Promise<Product[]> {
  if (!products.length) return [];
  const supabase = await createServiceClient();
  const ids = products.map((p) => p.id);
  const { data: rows } = await supabase
    .from("product_sizes")
    .select("product_id, size, stock")
    .in("product_id", ids);

  const grouped: Record<string, { size: string; stock: number }[]> = {};
  for (const row of rows || []) {
    const pid = String(row.product_id);
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push({ size: String(row.size), stock: Number(row.stock) || 0 });
  }

  const { mergeSizes } = await import("@/lib/sizes");
  return products.map((p) => ({
    ...p,
    sizes: grouped[p.id] ? mergeSizes(grouped[p.id] as never) : mergeSizes(null),
  }));
}

export const CHAT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_products",
      description:
        "Busca peças da loja por nome, categoria ou descrição. Use sempre antes de falar de preços ou estoque.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca (ex: vestido, blusa preta)" },
          limit: { type: "integer", description: "Máximo de resultados (1-8)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_product",
      description: "Detalha um produto pelo id (preço, tamanhos e estoque).",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_active_coupons",
      description:
        "Lista cupons que a cliente PODE usar agora (já validados). Use só depois de negociar (qualidade/motivo) ou se ela pedir cupom/desconto explicitamente. Nunca despeje vários cupons de uma vez — ofereça no máximo um.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_store_info",
      description:
        "Informações sobre a loja LM (proposta, atendimento, frete em termos gerais).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "validate_coupon",
      description: "Valida um código de cupom específico.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string" },
          subtotal: { type: "number" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_to_cart",
      description:
        "Prepara adição ao carrinho quando a cliente escolheu peça e tamanho.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          size: { type: "string", enum: ["U", "P", "M", "G"] },
          quantity: { type: "integer" },
        },
        required: ["product_id", "size"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "build_whatsapp_handoff",
      description:
        "Gera link do WhatsApp com resumo do atendimento (não só a última frase). Use em off-topic, pedido de humana ou quando a cliente pedir WhatsApp.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "Contexto: peça citada, dúvida e o que já foi conversado",
          },
        },
        required: ["summary"],
      },
    },
  },
];

export async function runChatTool(
  name: string,
  argsJson: string,
  customerId?: string | null
): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }

  switch (name) {
    case "search_products":
      return toolSearchProducts(
        String(args.query || ""),
        Number(args.limit) || 6
      );
    case "get_product":
      return toolGetProduct(String(args.product_id || ""));
    case "list_active_coupons":
      return toolListApplicableCoupons(customerId);
    case "get_store_info":
      return toolGetStoreInfo();
    case "validate_coupon":
      return toolValidateCoupon(
        String(args.code || ""),
        customerId,
        Number(args.subtotal) || 100,
        Number(args.shipping) || 20
      );
    case "add_to_cart":
      return buildCartAction(
        String(args.product_id || ""),
        String(args.size || "M"),
        Number(args.quantity) || 1
      );
    case "build_whatsapp_handoff":
      return toolBuildWhatsappHandoff(String(args.summary || ""));
    default:
      return { error: `Tool desconhecida: ${name}` };
  }
}

export async function toolGetStoreInfo() {
  const settings = await fetchStoreSettings();
  return {
    store_name: settings.store_name,
    about: [
      `${settings.store_name} é uma loja de moda feminina online.`,
      "Propõe peças com estilo, atendimento próximo e compra fácil pelo site (PIX) ou WhatsApp.",
      "Ajuda a escolher tamanho, combinar looks, informar estoque real e acompanhar pedidos.",
      "Frete conforme região (transportadora/Correios) ou Uber combinado com a loja.",
      "Trocas e devoluções seguem a política publicada no site.",
    ].join(" "),
    whatsapp_configured: Boolean(settings.whatsapp_number),
  };
}

export type NegotiationStage =
  | "probe"
  | "value"
  | "alternative"
  | "close"
  | "coupon";

export function wantsAlternative(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\b(outra|outro|mais barat|mais em conta|alternativa|outra opcao|outra opção|outra peca|outra peça|tem algo|tem alguma)\b/.test(
    t
  );
}

/** Estágio da conversa de venda a partir do histórico. */
export function getNegotiationStage(
  hesitations: number,
  intentKind: string,
  lastUserText: string
): NegotiationStage {
  if (intentKind === "ask_coupon" || hesitations >= 3) return "coupon";
  if (wantsAlternative(lastUserText) && hesitations >= 1) return "alternative";
  if (hesitations >= 2) return "value";
  if (hesitations >= 1 || intentKind === "hesitate") return "probe";
  return "close";
}

export function buildNegotiationGuide(opts: {
  stage: NegotiationStage;
  focalProduct: ChatProductCard | null;
  alternatives: ChatProductCard[];
  mayOfferCoupon: boolean;
  hasCoupon: boolean;
}): string {
  const { stage, focalProduct, alternatives, mayOfferCoupon, hasCoupon } = opts;
  const focal = focalProduct
    ? `${focalProduct.name} (${formatMoneyBr(focalProduct.price)}; tamanhos: ${(focalProduct.sizes || []).map((s) => s.size).join(", ") || "—"})`
    : "peça ainda não identificada no histórico — pergunte qual peça ela está olhando";

  const altBlock =
    alternatives.length > 0
      ? `ALTERNATIVAS COM ESTOQUE (pode mostrar):\n${JSON.stringify(alternatives.slice(0, 4))}`
      : "ALTERNATIVAS: nenhuma com estoque agora. NÃO diga que vai mostrar outra peça. Não invente nomes/preços. Foque na peça atual, no fecho ou no WhatsApp.";

  const stageLines: Record<NegotiationStage, string> = {
    probe: [
      "ESTÁGIO: probe (1ª hesitação).",
      "Aja como vendedora de moda: acolha, cite a PEÇA EM JOGO pelo nome, diga 1 gancho de valor concreto (caimento, uso no dia a dia, como combina).",
      "Faça UMA pergunta só (ex.: valor em si, comparação, ou dúvida de tamanho).",
      "NÃO ofereça cupom. NÃO diga que tem outra peça se não houver alternativas listadas.",
      "Tom natural de loja, sem linguagem corporativa ('investimento', 'priorizamos acabamento').",
    ].join(" "),
    value: [
      "ESTÁGIO: value.",
      "Reforce o valor da peça em jogo com 1–2 frases práticas (como vestir / ocasião).",
      "Feche leve: convidar a escolher tamanho e ir ao carrinho.",
      "Só mencione outra opção se houver ALTERNATIVAS COM ESTOQUE acima.",
      "Ainda sem cupom, a menos que o sistema diga o contrário.",
    ].join(" "),
    alternative: [
      "ESTÁGIO: alternative.",
      alternatives.length
        ? "Apresente no máximo 1–2 alternativas listadas (com preço real) e pergunte qual prefere."
        : "Não há alternativa em estoque. Seja honesta: continue com a peça atual, ajuste de tamanho, ou WhatsApp — sem prometer catálogo.",
    ].join(" "),
    close: [
      "ESTÁGIO: close.",
      "Convide com clareza a escolher o tamanho e seguir ao pagamento no site.",
    ].join(" "),
    coupon: [
      "ESTÁGIO: coupon.",
      mayOfferCoupon && hasCoupon
        ? "Ofereça NO MÁXIMO o cupom já validado pelo sistema, como gesto, e convide ao carrinho."
        : mayOfferCoupon
          ? "Não há cupom aplicável. Seja honesta e mantenha o fecho ou WhatsApp."
          : "Ainda não libere cupom.",
    ].join(" "),
  };

  return [
    "PLAYBOOK DE VENDA (obrigatório nesta resposta):",
    `PEÇA EM JOGO: ${focal}`,
    altBlock,
    stageLines[stage],
    "Resposta curta (2–4 frases), 1 pergunta no máximo, 1 CTA claro. Sem tags técnicas.",
  ].join("\n");
}

export function buildSystemPrompt(storeName: string): string {
  return `Você é a consultora de vendas da "${storeName}", loja de moda feminina online.
Aja como vendedora de boutique: calorosa, segura, prática — conversa real de loja, não script de chatbot.

Proposta da loja: peças femininas com carinho, atendimento humanizado, compra pelo site (PIX) e suporte no WhatsApp.

Escopo: só peças, tamanhos, estoque, preços, frete em geral, cupons/promoções válidos e pedidos desta loja.
Sobre a loja: use get_store_info se perguntarem o que a loja é / o que oferece.

REGRA CRÍTICA DE DADOS:
- Nunca invente preço, estoque, tamanho, nome de peça ou cupom.
- Só use dados das tools / "DADOS DO CATÁLOGO" / playbook.
- Peça só é disponível se houver tamanho com stock > 0.
- Alternativa/outra peça: SÓ se houver produtos com estoque nos dados. Se a lista estiver vazia, não diga que vai mostrar outra opção.
- Cupom/promoção: só se a tool/sistema confirmar aplicável. Nunca despeje vários cupons.
- Preço = campo "price" (reais).

NEGOCIAÇÃO (objeção / "tá caro" / "vou pensar"):
Siga o PLAYBOOK DE VENDA quando enviado (estágios probe → value → alternative → close → coupon).
Empatia + peça pelo nome + valor concreto + 1 pergunta + fecho leve. Cupom só no estágio coupon.

Off-topic: recuse em uma frase e ofereça WhatsApp (build_whatsapp_handoff com resumo).
Tom: pt-BR natural de vendedora. Sem pressão agressiva.
Compra: peça+tamanho → add_to_cart → convidar ao pagamento no site.
Não peça CPF/cartão no chat. Não finalize PIX aqui.
Nunca escreva tags técnicas (ex.: channel).`;
}

export type ChatIntent =
  | { kind: "offtopic" }
  | { kind: "hesitate" }
  | { kind: "ask_coupon" }
  | { kind: "human" }
  | { kind: "search"; query: string }
  | { kind: "price"; query?: string }
  | { kind: "list" }
  | { kind: "about_store" }
  | { kind: "other" };

/** Heurística se o modelo free ignorar tools. */
export function detectChatIntent(text: string): ChatIntent {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (
    /\b(whatsapp|atendente|humana|vendedor|pessoa real|falar com alguem|falar com alguém)\b/.test(
      t
    )
  ) {
    return { kind: "human" };
  }
  if (
    /\b(eleicao|politica|bitcoin|receita de bolo|javascript|python|chatgpt|openai)\b/.test(
      t
    ) ||
    /\b(quem ganhou|presidente|futebol|bbb)\b/.test(t)
  ) {
    return { kind: "offtopic" };
  }
  if (
    /\b(sobre a loja|quem sao voces|quem são vocês|o que e a loja|o que é a loja|o que voces fazem|o que vocês fazem|proposta da loja)\b/.test(
      t
    )
  ) {
    return { kind: "about_store" };
  }
  if (/\b(cupom|desconto|promo(c|ç)ao)\b/.test(t)) {
    return { kind: "ask_coupon" };
  }
  if (/\b(caro|desisto|depois|vou pensar|nao sei|não sei)\b/.test(t)) {
    return { kind: "hesitate" };
  }
  if (
    /\b(preco|preço|valor|custa|quanto (custa|e|é|fica)|qnto)\b/.test(t) ||
    /\b(qual o valor|qual o preco|qual o preço)\b/.test(t)
  ) {
    return { kind: "price" };
  }
  if (
    /\b(quais pecas|quais peças|o que tem|pecas disponiveis|peças disponíveis|catalogo|catálogo|tem disponivel|tem disponível)\b/.test(
      t
    )
  ) {
    return { kind: "list" };
  }
  const fashion =
    t.match(
      /\b(vestido|blusa|saia|calca|calça|short|conjunto|cropped|body|macacao|macacão|jaqueta|casaco|regata|top|lingerie|calcinha|sutiã|sutia|camiseta|t-?shirt|urso)\b/
    ) || t.match(/(tem |quero |procuro |mostra |mostrar )(.{2,40})/);
  if (fashion) {
    return {
      kind: "search",
      query:
        fashion[0]
          .replace(/^(tem |quero |procuro |mostra |mostrar )/i, "")
          .trim() || fashion[0],
    };
  }
  return { kind: "other" };
}

export function countHesitations(
  messages: Array<{ role: string; content: string }>
): number {
  return messages.filter(
    (m) => m.role === "user" && detectChatIntent(m.content).kind === "hesitate"
  ).length;
}

/** Tenta achar nome de peça no histórico (ex.: "t-shirt de urso"). */
export function extractProductHintFromHistory(
  messages: Array<{ role: string; content: string }>
): string | null {
  const blob = messages
    .map((m) => m.content)
    .join(" \n ")
    .toLowerCase();
  const patterns = [
    /t-?shirt[^.\n?]{0,40}/i,
    /camiseta[^.\n?]{0,40}/i,
    /vestido[^.\n?]{0,40}/i,
    /blusa[^.\n?]{0,40}/i,
    /conjunto[^.\n?]{0,40}/i,
    /saia[^.\n?]{0,40}/i,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (m?.[0]) return m[0].replace(/[?.!,]/g, "").trim().slice(0, 60);
  }
  return null;
}

export function formatMoneyBr(value: number): string {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

/** Resposta factual de preço/estoque — não passa pela criatividade da LLM. */
export function buildFactualProductReply(
  products: ChatProductCard[],
  mode: "price" | "list" | "search"
): string {
  if (!products.length) {
    return "Não encontrei essa peça no catálogo agora. Quer buscar por outro nome?";
  }

  if (mode === "price" || products.length === 1) {
    const p = products[0];
    const avail = (p.sizes || []).filter((s) => s.stock > 0);
    const price = formatMoneyBr(p.price);
    if (!avail.length) {
      return `${p.name} custa ${price}, mas está esgotada no momento. Quer que eu procure outra peça?`;
    }
    const sizes = avail.map((s) => s.size).join(", ");
    return `${p.name} custa ${price}. Tamanhos disponíveis: ${sizes}. Quer adicionar ao carrinho?`;
  }

  const inStock = products.filter((p) =>
    (p.sizes || []).some((s) => s.stock > 0)
  );
  if (!inStock.length) {
    return "No momento não tenho essa peça com estoque. Quer buscar outra opção?";
  }
  const lines = inStock
    .slice(0, 5)
    .map((p) => `• ${p.name} — ${formatMoneyBr(p.price)}`);
  return `Estas são opções disponíveis agora:\n${lines.join("\n")}\nQuer o detalhe de alguma?`;
}
