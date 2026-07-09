import type { PaymentStatus } from "@/types";

const MP_STATUS_MAP: Record<string, PaymentStatus> = {
  approved: "approved",
  pending: "pending",
  in_process: "in_process",
  rejected: "rejected",
  cancelled: "cancelled",
  refunded: "refunded",
};

export function mapMpStatus(status: string): PaymentStatus {
  return MP_STATUS_MAP[(status || "").toLowerCase()] || "pending";
}

export function extractPixCopyPaste(payment: Record<string, unknown>): string {
  const poi = (payment.point_of_interaction || {}) as Record<string, unknown>;
  const tx = (poi.transaction_data || {}) as Record<string, unknown>;
  const qr = tx.qr_code || tx.qr_code_base64 || "";
  return typeof qr === "string" ? qr : "";
}

export interface CheckoutPayer {
  email: string;
  name: string;
  cpf: string;
  phone?: string;
}

export interface CheckoutRequest {
  orderId: string;
  amount: number;
  description: string;
  payer: CheckoutPayer;
  notificationUrl?: string;
  expiresAtIso?: string;
}

export interface CheckoutResult {
  providerPaymentId: string;
  status: PaymentStatus;
  pixCopyPaste: string;
  ticketUrl: string;
  raw: Record<string, unknown>;
}

function getAccessToken(): string {
  const token = (process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
  if (!token) throw new Error("Mercado Pago não configurado.");
  return token;
}

export function paymentsEnabled(): boolean {
  return (
    process.env.PAYMENTS_ENABLED === "true" &&
    Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN)
  );
}

export function appBaseUrl(): string {
  const url =
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
  return url.replace(/\/$/, "");
}

export function webhookNotificationUrl(): string {
  return (process.env.MERCADOPAGO_WEBHOOK_URL || "").trim();
}

export async function createPixCheckout(
  request: CheckoutRequest
): Promise<CheckoutResult> {
  const cpf = request.payer.cpf.replace(/\D/g, "");
  const firstName = (request.payer.name || "Cliente").split(" ")[0].slice(0, 50);
  const paymentData: Record<string, unknown> = {
    transaction_amount: Math.round(request.amount * 100) / 100,
    description: request.description.slice(0, 200),
    payment_method_id: "pix",
    external_reference: request.orderId,
    payer: {
      email: request.payer.email,
      first_name: firstName,
      identification: { type: "CPF", number: cpf },
    },
  };
  if (request.notificationUrl) {
    paymentData.notification_url = request.notificationUrl;
  }
  if (request.expiresAtIso) {
    paymentData.date_of_expiration = request.expiresAtIso;
  }

  const res = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `${request.orderId}-${Date.now()}`,
    },
    body: JSON.stringify(paymentData),
  });

  const payment = await res.json();
  if (!res.ok) {
    const msg =
      payment.message || payment.error || JSON.stringify(payment);
    throw new Error(`Mercado Pago: ${msg}`);
  }

  const poi = (payment.point_of_interaction || {}) as Record<string, unknown>;
  const tx = (poi.transaction_data || {}) as Record<string, unknown>;
  const pix = extractPixCopyPaste(payment);
  return {
    providerPaymentId: String(payment.id || ""),
    status: mapMpStatus(String(payment.status || "pending")),
    pixCopyPaste: pix.length < 5000 ? pix : "",
    ticketUrl: String(tx.ticket_url || ""),
    raw: payment,
  };
}

export async function getPayment(
  providerPaymentId: string
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${providerPaymentId}`,
    {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    }
  );
  return res.json();
}

export async function cancelPayment(
  providerPaymentId: string
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${providerPaymentId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${getAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "cancelled" }),
    }
  );
  return res.json();
}

export async function refundPayment(
  providerPaymentId: string,
  amount?: number
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (amount !== undefined) body.amount = Math.round(amount * 100) / 100;
  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${providerPaymentId}/refunds`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  return res.json();
}
