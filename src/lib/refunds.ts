export type RefundReasonCode = "cooling_off" | "defect" | "other";

export const REFUND_REASON_OPTIONS: Array<{
  value: RefundReasonCode;
  label: string;
  hint: string;
}> = [
  {
    value: "cooling_off",
    label: "Direito de arrependimento (7 dias)",
    hint: "Desisti da compra em até 7 dias após o recebimento (CDC).",
  },
  {
    value: "defect",
    label: "Produto com defeito, errado ou avariado",
    hint: "Nesses casos o frete de devolução costuma ser da loja.",
  },
  {
    value: "other",
    label: "Outro motivo",
    hint: "Ex.: troca de tamanho fora do prazo — sujeito à análise.",
  },
];

export function refundReasonLabel(code: string | null | undefined): string {
  const opt = REFUND_REASON_OPTIONS.find((o) => o.value === code);
  return opt?.label || "Outro motivo";
}
