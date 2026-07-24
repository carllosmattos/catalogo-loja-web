import {
  appBaseUrl,
  cancelPayment,
  createPixCheckout,
  extractPixQrBase64,
  paymentsEnabled,
  webhookNotificationUrl,
} from "@/lib/payments";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizeCpf } from "@/lib/utils";

const PIX_EXPIRY_MINUTES = 15;

function canReissueOrderStatus(status: string): boolean {
  return ["cancelled", "canceled", "expired"].includes(status);
}

function canReissueFromPayment(status: string | null | undefined): boolean {
  if (!status) return true;
  return ["cancelled", "canceled", "rejected", "expired"].includes(
    String(status).toLowerCase()
  );
}

/** Reemite PIX a partir de um pedido cancelado/expirado (novo pedido + QR). */
export async function reissuePixFromOrder(params: {
  orderId: string;
  /** Se informado, valida ownership do cliente. */
  customerId?: string | null;
}): Promise<{
  order_id: string;
  tracking_token: string;
  tracking_url: string;
  pix_copy_paste: string;
  pix_qr_base64?: string;
  total: number;
  provider_payment_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  expires_at: string;
}> {
  if (!paymentsEnabled()) {
    throw new Error("Pagamentos PIX desativados.");
  }

  const supabase = await createServiceClient();

  try {
    await supabase.rpc("expire_stale_orders");
  } catch {
    // ignore
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("*, order_items(*), payments(*)")
    .eq("id", params.orderId)
    .maybeSingle();

  if (orderErr) throw new Error(orderErr.message);
  if (!order) throw new Error("Pedido não encontrado.");

  if (
    params.customerId &&
    String(order.customer_id) !== String(params.customerId)
  ) {
    throw new Error("Pedido não pertence ao cliente.");
  }

  const orderStatus = String(order.status || "");
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const latestPay = payments[0] as Record<string, unknown> | undefined;
  const payStatus = latestPay?.status
    ? String(latestPay.status)
    : null;

  const unpaidStuck =
    orderStatus === "pending_payment" && canReissueFromPayment(payStatus);
  if (!canReissueOrderStatus(orderStatus) && !unpaidStuck) {
    throw new Error(
      "Só é possível gerar novo PIX para pedidos cancelados, expirados ou com PIX cancelado."
    );
  }

  if (orderStatus === "paid" || payStatus === "approved") {
    throw new Error("Pedido já pago — não é possível gerar novo PIX.");
  }

  const items = Array.isArray(order.order_items) ? order.order_items : [];
  if (items.length === 0) {
    throw new Error("Pedido sem itens para reemitir.");
  }

  const customerId = String(order.customer_id);
  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) throw new Error("Cliente não encontrado.");

  const email = String(customer.email || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(
      "Cliente sem e-mail válido. Atualize o cadastro antes de gerar novo PIX."
    );
  }

  // Cancela MP + pedido antigo se ainda estiver pending
  for (const p of payments) {
    const pid = p?.provider_payment_id ? String(p.provider_payment_id) : "";
    const st = String(p?.status || "");
    if (pid && ["pending", "in_process"].includes(st)) {
      try {
        await cancelPayment(pid);
      } catch {
        // ignore
      }
    }
  }

  if (orderStatus === "pending_payment") {
    try {
      await supabase.rpc("cancel_unpaid_order", {
        p_order_id: params.orderId,
        p_customer_id: customerId,
      });
    } catch {
      // pode já ter sido cancelado
    }
  }

  // Cancela outros pending do mesmo cliente
  const { data: otherPending } = await supabase
    .from("orders")
    .select("id")
    .eq("customer_id", customerId)
    .eq("status", "pending_payment");
  for (const row of otherPending || []) {
    try {
      await supabase.rpc("cancel_unpaid_order", {
        p_order_id: row.id,
        p_customer_id: customerId,
      });
    } catch {
      // ignore
    }
  }

  const lines = items.map((it: Record<string, unknown>) => ({
    product_id: String(it.product_id),
    product_name: String(it.product_name || ""),
    product_size: String(it.product_size || "M"),
    quantity: Math.max(1, Number(it.quantity) || 1),
    preco_catalogo: Number(it.preco_catalogo) || 0,
    desconto: Number(it.desconto) || 0,
    sale_freight: Number(it.sale_freight) || 0,
    preco_final_line: Number(it.preco_final_line) || 0,
    lucro_line: Number(it.lucro_line) || 0,
    promotion_id: it.promotion_id ? String(it.promotion_id) : "",
    promotion_name: it.promotion_name ? String(it.promotion_name) : "",
    gifts_snapshot: it.gifts_snapshot || [],
  }));

  const shippingAmount = Math.max(0, Number(order.shipping_amount) || 0);
  const discountAmount = Math.max(0, Number(order.discount_amount) || 0);
  const shippingDiscount = Math.max(
    0,
    Number(order.shipping_discount_amount) || 0
  );

  const { data: created, error: createErr } = await supabase.rpc(
    "create_checkout_order",
    {
      p_customer_id: customerId,
      p_items: lines,
      p_shipping_amount: shippingAmount,
      p_discount_amount: discountAmount,
      p_shipping_discount: shippingDiscount,
    }
  );
  if (createErr) throw new Error(createErr.message);

  const orderData = Array.isArray(created) ? created[0] : created;
  if (!orderData) throw new Error("Erro ao criar novo pedido.");

  const newOrderId = String(orderData.order_id);
  const trackingToken = String(orderData.tracking_token);
  const total = Number(orderData.total_amount);
  const expiresAt = String(orderData.expires_at || "");

  const freteAbs = Number(order.frete_absorvido) || 0;
  if (freteAbs > 0) {
    try {
      await supabase
        .from("orders")
        .update({ frete_absorvido: freteAbs })
        .eq("id", newOrderId);
    } catch {
      // ignore
    }
  }

  const now = new Date();
  now.setMinutes(now.getMinutes() + PIX_EXPIRY_MINUTES);
  const brOffset = -3 * 60;
  const brDate = new Date(now.getTime() + brOffset * 60 * 1000);
  const expiresIso =
    brDate.toISOString().replace("Z", "").replace(/\.\d+/, "") + ".000-03:00";

  const desc =
    lines.length === 1
      ? lines[0].product_name
      : `Pedido ${newOrderId.slice(0, 8)}`;

  const result = await createPixCheckout({
    orderId: newOrderId,
    amount: total,
    description: desc,
    payer: {
      email,
      name: String(customer.name || ""),
      cpf: normalizeCpf(String(customer.cpf || "")),
      phone: String(customer.phone || ""),
    },
    notificationUrl: webhookNotificationUrl(),
    expiresAtIso: expiresIso,
  });

  const { error: attachError } = await supabase.rpc(
    "attach_order_payment_public",
    {
      p_order_id: newOrderId,
      p_provider_payment_id: result.providerPaymentId,
      p_status: result.status,
      p_amount: total,
      p_pix_copy_paste: result.pixCopyPaste,
      p_raw: result.raw,
      p_expires_at: expiresAt || expiresIso,
    }
  );
  if (attachError) throw new Error(attachError.message);

  const base = appBaseUrl();
  return {
    order_id: newOrderId,
    tracking_token: trackingToken,
    tracking_url: `${base}/pedidos/${trackingToken}`,
    pix_copy_paste: result.pixCopyPaste,
    pix_qr_base64: result.qrCodeBase64 || extractPixQrBase64(result.raw),
    total,
    provider_payment_id: result.providerPaymentId,
    customer_id: customerId,
    customer_name: String(customer.name || ""),
    customer_phone: String(customer.phone || ""),
    expires_at: expiresAt || expiresIso,
  };
}
