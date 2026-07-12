/** Labels amigáveis de status de pedido / pagamento (cliente). */
const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: "Aguardando PIX",
  pending: "Aguardando pagamento",
  paid: "Pago",
  approved: "Pago",
  cancelled: "Cancelado",
  canceled: "Cancelado",
  refund_requested: "Reembolso solicitado",
  refunded: "Reembolsado",
  rejected: "Pagamento recusado",
  in_process: "Processando pagamento",
  expired: "Expirado",
};

export function orderStatusLabel(status: string | null | undefined): string {
  const key = String(status || "").trim();
  if (!key) return "Sem status";
  return ORDER_STATUS_LABELS[key] || ORDER_STATUS_LABELS[key.toLowerCase()] || key;
}
