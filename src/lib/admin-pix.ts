import {
  fetchActivePromotions,
  fetchProduct,
  fetchProductGifts,
} from "@/lib/catalog";
import { buildAdminSalePricing } from "@/lib/admin-sale-pricing";
import {
  redeemCouponServer,
  validateCouponServer,
} from "@/lib/coupons-server";
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
import type { Customer } from "@/types";

const PIX_EXPIRY_MINUTES = 15;

export type AdminPixSaleInput = {
  customer: {
    id?: string | null;
    name: string;
    phone: string;
    cpf: string;
    email?: string;
    address_zip?: string;
    address_street?: string;
    address_number?: string;
    address_complement?: string;
    address_neighborhood?: string;
    address_city?: string;
    address_state?: string;
  };
  productId: string;
  size: string;
  quantity: number;
  /** Frete cotado (antes de promo/cupom de frete). */
  freightQuoted: number;
  shippingMethod: "delivery" | "uber";
  shippingLabel?: string;
  couponCode?: string | null;
  notes?: string;
};

function normalizePhoneBr(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  return digits;
}

/** Garante cliente com e-mail válido para create_checkout_order + Mercado Pago. */
export async function ensureCustomerForAdminPix(
  input: AdminPixSaleInput["customer"]
): Promise<Customer> {
  const supabase = await createServiceClient();
  const cpf = normalizeCpf(input.cpf);
  const phone = normalizePhoneBr(input.phone || "");
  const name = (input.name || "").trim();
  let email = (input.email || "").trim().toLowerCase();

  if (!name) throw new Error("Informe o nome do cliente.");
  if (cpf.length !== 11) throw new Error("Informe um CPF válido.");
  if (phone.length < 12) {
    throw new Error(
      "Informe o WhatsApp do cliente com DDD (ex.: 11999999999)."
    );
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(
      "Informe o e-mail do cliente para gerar o PIX."
    );
  }

  if (input.id) {
    const { data: byId } = await supabase
      .from("customers")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (byId) {
      const patch: Record<string, unknown> = {
        name,
        phone,
        cpf,
        email,
        updated_at: new Date().toISOString(),
      };
      if (input.address_zip) {
        patch.address_zip = input.address_zip.replace(/\D/g, "");
        patch.address_street = input.address_street || "";
        patch.address_number = input.address_number || "";
        patch.address_complement = input.address_complement || "";
        patch.address_neighborhood = input.address_neighborhood || "";
        patch.address_city = input.address_city || "";
        patch.address_state = (input.address_state || "").toUpperCase();
      }
      const { data: updated, error } = await supabase
        .from("customers")
        .update(patch)
        .eq("id", byId.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return updated as Customer;
    }
  }

  const { data: byCpf } = await supabase
    .from("customers")
    .select("*")
    .eq("cpf", cpf)
    .maybeSingle();

  if (byCpf) {
    const { data: updated, error } = await supabase
      .from("customers")
      .update({
        name,
        phone,
        email,
        address_zip: input.address_zip?.replace(/\D/g, "") || byCpf.address_zip,
        address_street: input.address_street || byCpf.address_street,
        address_number: input.address_number || byCpf.address_number,
        address_complement:
          input.address_complement || byCpf.address_complement,
        address_neighborhood:
          input.address_neighborhood || byCpf.address_neighborhood,
        address_city: input.address_city || byCpf.address_city,
        address_state:
          (input.address_state || byCpf.address_state || "").toUpperCase(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", byCpf.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated as Customer;
  }

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      name,
      phone,
      cpf,
      email,
      points: 0,
      address_zip: input.address_zip?.replace(/\D/g, "") || "",
      address_street: input.address_street || "",
      address_number: input.address_number || "",
      address_complement: input.address_complement || "",
      address_neighborhood: input.address_neighborhood || "",
      address_city: input.address_city || "",
      address_state: (input.address_state || "").toUpperCase(),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return created as Customer;
}

async function cancelPendingOrdersForCustomer(customerId: string) {
  const supabase = await createServiceClient();

  // Libera reservas expiradas antes de tentar novo PIX
  try {
    await supabase.rpc("expire_stale_orders");
  } catch {
    // ignore se RPC antiga
  }

  const { data: pending } = await supabase
    .from("orders")
    .select("id, payments(provider_payment_id, status)")
    .eq("customer_id", customerId)
    .eq("status", "pending_payment");

  for (const row of pending || []) {
    const payments = Array.isArray(row.payments) ? row.payments : [];
    for (const p of payments) {
      const pid = p?.provider_payment_id
        ? String(p.provider_payment_id)
        : "";
      const st = String(p?.status || "");
      if (pid && ["pending", "in_process"].includes(st)) {
        try {
          await cancelPayment(pid);
        } catch {
          // ignore MP
        }
      }
    }

    const { error } = await supabase.rpc("cancel_unpaid_order", {
      p_order_id: row.id,
      p_customer_id: customerId,
    });
    if (error) {
      // Fallback: liberar reservas direto se a RPC falhar
      await supabase
        .from("stock_reservations")
        .delete()
        .eq("order_id", row.id);
      await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "pending_payment");
      await supabase
        .from("payments")
        .update({ status: "cancelled" })
        .eq("order_id", row.id)
        .in("status", ["pending", "in_process"]);
    }
  }
}

export async function startAdminPixSale(input: AdminPixSaleInput) {
  if (!paymentsEnabled()) {
    throw new Error(
      "Pagamentos PIX desativados. Ative PAYMENTS_ENABLED e o Mercado Pago."
    );
  }

  const product = await fetchProduct(input.productId);
  if (!product) throw new Error("Produto não encontrado.");

  const qty = Math.max(1, Number(input.quantity) || 1);
  const [promotions, linkedGifts] = await Promise.all([
    fetchActivePromotions(),
    fetchProductGifts(product.id),
  ]);

  const customer = await ensureCustomerForAdminPix(input.customer);
  await cancelPendingOrdersForCustomer(customer.id);

  const freightQuoted =
    input.shippingMethod === "uber"
      ? 0
      : Math.max(0, Number(input.freightQuoted) || 0);

  let coupon = null;
  if (input.couponCode?.trim()) {
    const unitProbe = buildAdminSalePricing({
      product,
      linkedGifts,
      promotions,
      size: input.size,
      quantity: qty,
      freightQuoted,
      applyShippingPromo: false,
      coupon: null,
    });
    const subtotalForCoupon =
      unitProbe.preco_catalogo - unitProbe.desconto_promo;
    // Uber: shipping=0 → cupom deferred (fixo ou %); Melhor Envio: frete cotado
    const freightForCoupon =
      input.shippingMethod === "uber" ? 0 : unitProbe.sale_freight;
    coupon = await validateCouponServer(
      input.couponCode.trim(),
      customer.id,
      subtotalForCoupon,
      freightForCoupon
    );
    if (!coupon.ok) {
      throw new Error(coupon.error || "Cupom inválido");
    }
  }

  const pricing = buildAdminSalePricing({
    product,
    linkedGifts,
    promotions,
    size: input.size,
    quantity: qty,
    freightQuoted,
    applyShippingPromo: false,
    coupon,
  });

  const lines = [
    {
      product_id: String(product.id),
      product_name: product.name,
      product_size: input.size,
      quantity: qty,
      preco_catalogo: pricing.preco_catalogo,
      desconto: pricing.desconto_total,
      sale_freight: pricing.sale_freight,
      preco_final_line: pricing.preco_final,
      lucro_line: pricing.lucro,
      promotion_id: pricing.promotion_id || "",
      promotion_name: pricing.promotion_name || "",
      gifts_snapshot: pricing.gifts,
    },
  ];

  const supabase = await createServiceClient();
  const { data: created, error } = await supabase.rpc("create_checkout_order", {
    p_customer_id: customer.id,
    p_items: lines,
    p_shipping_amount: 0,
    p_discount_amount: 0,
    p_shipping_discount: 0,
  });
  if (error) throw new Error(error.message);

  const orderData = Array.isArray(created) ? created[0] : created;
  if (!orderData) throw new Error("Erro ao criar pedido.");

  const orderId = String(orderData.order_id);
  const trackingToken = String(orderData.tracking_token);
  const total = Number(orderData.total_amount);
  const expiresAt = String(orderData.expires_at || "");

  if (pricing.frete_absorvido > 0) {
    try {
      await supabase
        .from("orders")
        .update({ frete_absorvido: pricing.frete_absorvido })
        .eq("id", orderId);
    } catch {
      // Migration 037 ainda não aplicada
    }
  }

  const couponRedeemAmt =
    pricing.desconto_cupom_produto + pricing.coupon_shipping_discount;
  if (
    coupon?.ok &&
    coupon.code &&
    (couponRedeemAmt > 0 ||
      coupon.discount_target === "shipping" ||
      coupon.shipping_deferred)
  ) {
    await redeemCouponServer(
      coupon.code,
      customer.id,
      orderId,
      Math.max(couponRedeemAmt, 0)
    );
  }

  const now = new Date();
  now.setMinutes(now.getMinutes() + PIX_EXPIRY_MINUTES);
  const brOffset = -3 * 60;
  const brDate = new Date(now.getTime() + brOffset * 60 * 1000);
  const expiresIso =
    brDate.toISOString().replace("Z", "").replace(/\.\d+/, "") + ".000-03:00";

  const result = await createPixCheckout({
    orderId,
    amount: total,
    description: product.name,
    payer: {
      email: customer.email,
      name: customer.name,
      cpf: normalizeCpf(customer.cpf),
      phone: customer.phone,
    },
    notificationUrl: webhookNotificationUrl(),
    expiresAtIso: expiresIso,
  });

  const { data: paymentId, error: attachError } = await supabase.rpc(
    "attach_order_payment_public",
    {
      p_order_id: orderId,
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
  const qrBase64 = result.qrCodeBase64 || extractPixQrBase64(result.raw);

  return {
    order_id: orderId,
    tracking_token: trackingToken,
    payment_id: paymentId,
    pix_copy_paste: result.pixCopyPaste,
    pix_qr_base64: qrBase64,
    ticket_url: result.ticketUrl,
    provider_payment_id: result.providerPaymentId,
    total,
    shipping_method: input.shippingMethod,
    shipping_label: input.shippingLabel || null,
    expires_at: expiresAt || expiresIso,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_phone: customer.phone,
    customer_email: customer.email,
    product_name: product.name,
    product_size: input.size,
    quantity: qty,
    tracking_url: `${base}/pedidos/${trackingToken}`,
    pricing,
  };
}
