import type { ProfitResult } from "@/types";
import { sizeDisplayLabel } from "@/lib/sizes";
import { formatCurrency, parseWhatsappNumber } from "@/lib/utils";

export function buildWhatsappUrl(whatsappNumber: string, message: string): string {
  const number = parseWhatsappNumber(whatsappNumber);
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** Mensagem padrão de atendimento (home / float). */
export function buildAttendMessage(storeName: string): string {
  return [
    `Olá! Vi o site da ${storeName} e gostaria de atendimento personalizado.`,
    "",
    "Pode me ajudar a escolher uma peça ou tirar algumas dúvidas?",
  ].join("\n");
}

function customerLines(customer: Record<string, string> | null | undefined): string[] {
  if (!customer) return [];
  const lines: string[] = [];
  if (customer.name) lines.push(`Nome: ${customer.name}`);
  if (customer.phone) lines.push(`Tel: ${customer.phone}`);
  if (customer.cpf) lines.push(`CPF: ${customer.cpf}`);
  if (customer.email) lines.push(`E-mail: ${customer.email}`);
  if (customer.address) lines.push(`Endereço: ${customer.address}`);
  if (lines.length) lines.push("");
  return lines;
}

export function buildOrderMessage(
  product: { name?: string; category?: string; sale_freight?: number },
  profit: ProfitResult,
  storeName: string,
  customer: Record<string, string> | null | undefined,
  size?: string | null
): string {
  const lines = ["Olá! Quero comprar:", "", ...customerLines(customer)];
  lines.push(`Peça: ${product.name || ""}`);
  if (size) lines.push(`Tamanho: ${sizeDisplayLabel(size)}`);
  if (product.category) lines.push(`Categoria: ${product.category}`);
  lines.push(`Preço: ${formatCurrency(profit.preco_catalogo)}`);
  if (profit.promotion_name && profit.desconto > 0) {
    lines.push(`Promoção: ${profit.promotion_name}`);
    lines.push(`Desconto: -${formatCurrency(profit.desconto)}`);
  }
  if (Number(product.sale_freight) > 0) {
    lines.push(`Frete: ${formatCurrency(Number(product.sale_freight))}`);
  }
  lines.push("", `Valor final: ${formatCurrency(profit.preco_final_cliente)}`, "", `Vi no catálogo da ${storeName}`);
  return lines.join("\n");
}

export function buildCartMessage(
  items: Array<{
    name?: string;
    size?: string;
    quantity?: number;
    preco_final?: number;
    promotion_name?: string;
    desconto?: number;
  }>,
  storeName: string,
  customer: Record<string, string> | null | undefined,
  shippingAmount = 0,
  shippingInfo?: {
    method?: "delivery" | "uber";
    label?: string;
    deliveryRange?: string | null;
  }
): string {
  const lines = ["Olá! Quero comprar:", "", ...customerLines(customer)];
  let grandTotal = 0;
  items.forEach((item, i) => {
    const qty = Number(item.quantity) || 1;
    const unitFinal = Number(item.preco_final) || 0;
    const subtotal = unitFinal * qty;
    grandTotal += subtotal;
    lines.push(`${i + 1}. ${item.name || "Peça"}`);
    if (item.size) lines.push(`   Tam.: ${sizeDisplayLabel(item.size)}`);
    lines.push(`   Qtd: ${qty}`);
    lines.push(`   Preço unit.: ${formatCurrency(unitFinal)}`);
    if (item.promotion_name && Number(item.desconto) > 0) {
      lines.push(`   Promo: ${item.promotion_name} (−${formatCurrency(Number(item.desconto))}/un.)`);
    }
    lines.push(`   Subtotal: ${formatCurrency(subtotal)}`, "");
  });
  if (shippingInfo?.method === "uber") {
    lines.push(
      "Entrega: Uber (vou solicitar o Uber e combinar com a loja pelo WhatsApp)",
      "Frete: a combinar (não incluso no site)",
      ""
    );
  } else {
    if (shippingInfo?.label) {
      lines.push(`Entrega: ${shippingInfo.label}`);
    }
    if (shippingInfo?.deliveryRange) {
      lines.push(`Prazo: ${shippingInfo.deliveryRange}`);
    }
    if (shippingAmount > 0) {
      lines.push(`Frete: ${formatCurrency(shippingAmount)}`);
      grandTotal += shippingAmount;
    }
    lines.push("");
  }
  lines.push(`TOTAL: ${formatCurrency(grandTotal)}`, "", `Vi no catálogo da ${storeName}`);
  return lines.join("\n");
}

/** Cotação de venda manual (admin → cliente no WhatsApp). */
export function buildAdminSaleQuoteMessage(params: {
  storeName: string;
  productName: string;
  size?: string | null;
  quantity: number;
  productSubtotal: number;
  shippingMethod: "delivery" | "uber";
  shippingAmount: number;
  shippingLabel?: string | null;
  deliveryRange?: string | null;
  ajuste?: number;
  total: number;
  customerName?: string;
  addressText?: string;
}): string {
  const lines = [
    `Olá${params.customerName ? `, ${params.customerName}` : ""}!`,
    "",
    `Segue a cotação da ${params.storeName}:`,
    "",
    `Peça: ${params.productName}`,
  ];
  if (params.size) lines.push(`Tamanho: ${sizeDisplayLabel(params.size)}`);
  lines.push(`Quantidade: ${params.quantity}`);
  lines.push(`Produto: ${formatCurrency(params.productSubtotal)}`);

  if (params.shippingMethod === "uber") {
    lines.push("Entrega: Uber (a combinar)");
    lines.push("Frete: a combinar pelo WhatsApp");
  } else {
    if (params.shippingLabel) lines.push(`Entrega: ${params.shippingLabel}`);
    if (params.deliveryRange) lines.push(`Prazo: ${params.deliveryRange}`);
    lines.push(`Frete: ${formatCurrency(params.shippingAmount)}`);
  }

  if (params.addressText) {
    lines.push("", "Endereço:", params.addressText);
  }

  if (params.ajuste) {
    lines.push(
      `Ajuste: ${params.ajuste > 0 ? "+" : ""}${formatCurrency(params.ajuste)}`
    );
  }

  lines.push("", `TOTAL: ${formatCurrency(params.total)}`, "");
  lines.push("Qualquer dúvida, me chama aqui 💕");
  return lines.join("\n");
}
