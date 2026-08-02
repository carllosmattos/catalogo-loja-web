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
  return {
    id: product.id,
    name: product.name,
    image_url: productImage(product),
    price: Math.round((profit.preco_catalogo - profit.desconto) * 100) / 100,
    sizes: (product.sizes || []).map((s) => ({
      size: s.size,
      stock: Number(s.stock) || 0,
    })),
  };
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
    const cards = await Promise.all(withSizes.map(toCard));
    return {
      products: cards,
      note: `Nada encontrado para "${q}". Seguem destaques recentes.`,
    };
  }

  const withSizes = await attachSizesLocal(data || []);
  const cards = await Promise.all(withSizes.map(toCard));
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
  const cards = await Promise.all(withSizes.map(toCard));
  return { products: cards, note: null as string | null };
}

export async function toolGetProduct(productId: string) {
  const product = await fetchProduct(productId);
  if (!product) return { error: "Produto não encontrado", product: null };
  const card = await toCard(product);
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

export async function toolListActiveCoupons() {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("coupons")
    .select("code, title, discount_type, discount_value, discount_target, max_uses, used_count, active")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const coupons = (data || [])
    .filter((c) => Number(c.used_count) < Number(c.max_uses))
    .map((c) => ({
      code: String(c.code),
      title: String(c.title || ""),
      discount_type: c.discount_type,
      discount_value: Number(c.discount_value),
      discount_target: c.discount_target || "product",
      remaining: Math.max(0, Number(c.max_uses) - Number(c.used_count)),
    }));

  return { coupons, has_coupons: coupons.length > 0 };
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

export async function toolBuildWhatsappHandoff(summary: string) {
  const settings = await fetchStoreSettings();
  if (!settings.whatsapp_number) {
    return { ok: false, whatsapp_url: null as string | null, error: "WhatsApp não configurado" };
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
        "Lista cupons ativos da loja. Use quando a cliente hesitar por preço ou pedir desconto.",
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
        "Gera link do WhatsApp para atendimento humano (off-topic, pedido de pessoa ou falha).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Resumo curto do que a cliente precisa" },
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
      return toolListActiveCoupons();
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

export function buildSystemPrompt(storeName: string): string {
  return `Você é a consultora de vendas da loja de moda feminina "${storeName}".
Só fala de: peças, tamanhos, estoque, preços, promoções, frete em termos gerais, cupons e pedidos desta loja.

REGRA CRÍTICA DE DADOS:
- Nunca invente preço, estoque, tamanho ou cupom.
- Só use números e nomes que aparecerem nos resultados das tools ou no bloco "DADOS DO CATÁLOGO".
- Se não houver dado no catálogo, diga que vai verificar e chame a tool — não chute.
- Preço deve ser exatamente o campo "price" do produto (em reais).

Se a cliente demonstrar objeção de preço ou hesitar ("tá caro", "depois", "vou pensar", "não sei"), chame list_active_coupons e/ou validate_coupon; se não houver cupom, diga com honestidade.
Off-topic (notícias, política, código, outros assuntos): recuse em uma frase e ofereça falar com a vendedora no WhatsApp (tool build_whatsapp_handoff).
Tom: acolhedor, direto, sem pressão agressiva. Respostas curtas em português do Brasil.
Quando a cliente quiser comprar: confirme peça+tamanho e use add_to_cart; diga que pode ir ao pagamento no site.
Quando pedir humana / WhatsApp: use build_whatsapp_handoff.
Nunca peça CPF, cartão ou dados sensíveis no chat. Não finalize PIX aqui.`;
}

export type ChatIntent =
  | { kind: "offtopic" }
  | { kind: "hesitate" }
  | { kind: "human" }
  | { kind: "search"; query: string }
  | { kind: "price"; query?: string }
  | { kind: "list" }
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
    /\b(caro|desisto|depois|vou pensar|nao sei|não sei|desconto|cupom|promocao|promoção)\b/.test(
      t
    )
  ) {
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

  const lines = products.slice(0, 5).map((p) => {
    const avail = (p.sizes || []).some((s) => s.stock > 0);
    return `• ${p.name} — ${formatMoneyBr(p.price)}${avail ? "" : " (esgotada)"}`;
  });
  return `Estas são opções do nosso catálogo:\n${lines.join("\n")}\nQuer o detalhe de alguma?`;
}
