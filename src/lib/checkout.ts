import {
  fetchActivePromotions,
  fetchProductGifts,
  fetchStoreSettings,
} from "@/lib/catalog";
import {
  redeemCouponServer,
  validateCouponServer,
} from "@/lib/coupons-server";
import {
  appBaseUrl,
  createPixCheckout,
  paymentsEnabled,
  webhookNotificationUrl,
} from "@/lib/payments";
import { applyShippingPromotion, calculateProfit } from "@/lib/profit";
import { calculateShipping } from "@/lib/shipping";
import { createClient } from "@/lib/supabase/server";
import { normalizeCpf } from "@/lib/utils";
import type { Customer, Product } from "@/types";

const PIX_EXPIRY_MINUTES = 15;

function giftsSnapshot(
  linked: Array<{ quantity_per_sale?: number; gift_data?: Record<string, unknown> }>,
  quantity: number
) {
  return linked
    .map((lg) => {
      const gift = lg.gift_data;
      if (!gift?.id) return null;
      const perSale = Number(lg.quantity_per_sale) || 1;
      return {
        gift_id: String(gift.id),
        gift_name: String(gift.name || "Brinde"),
        quantity: perSale * quantity,
      };
    })
    .filter(Boolean);
}

async function lineFromProduct(
  product: Product,
  size: string,
  quantity: number,
  promotions: Awaited<ReturnType<typeof fetchActivePromotions>>
) {
  const linked = await fetchProductGifts(product.id);
  const profit = calculateProfit(product, linked, promotions, size);
  const qty = Math.max(Number(quantity), 1);
  if (profit.stock < qty) {
    throw new Error(`Estoque insuficiente para ${product.name}.`);
  }
  let promoId = "";
  if (profit.promotion_name) {
    const p = promotions.find((x) => x.name === profit.promotion_name);
    promoId = p?.id || "";
  }
  const unitFinal = profit.preco_final_cliente;
  const unitLucro = profit.lucro_bruto;
  return {
    product_id: String(product.id),
    product_name: product.name,
    product_size: size,
    quantity: qty,
    preco_catalogo: profit.preco_catalogo,
    desconto: profit.desconto,
    sale_freight: Number(product.sale_freight) || 0,
    preco_final_line: unitFinal * qty,
    lucro_line: unitLucro * qty,
    promotion_id: promoId,
    promotion_name: profit.promotion_name || "",
    gifts_snapshot: giftsSnapshot(linked, qty),
  };
}

export async function buildLinesFromCart(
  cart: Array<{ product_id: string; size: string; quantity: number }>,
  productsById: Record<string, Product>
) {
  const promotions = await fetchActivePromotions();
  const lines = [];
  for (const item of cart) {
    const product = productsById[item.product_id];
    if (!product) {
      throw new Error(`Produto não encontrado: ${item.product_id}`);
    }
    lines.push(
      await lineFromProduct(product, item.size, item.quantity, promotions)
    );
  }
  return lines;
}

export async function startPixCheckout(
  customer: Customer,
  lines: Awaited<ReturnType<typeof buildLinesFromCart>>,
  shippingMethod: "delivery" | "uber" = "delivery",
  couponCode?: string | null
) {
  if (!paymentsEnabled()) {
    throw new Error("Pagamentos online desativados.");
  }
  if (!customer.id) {
    throw new Error("Complete seu cadastro em Minha conta.");
  }

  const settings = await fetchStoreSettings();
  const shipping = await calculateShipping(
    customer as unknown as Record<string, string>,
    lines,
    settings as unknown as Record<string, unknown>,
    shippingMethod
  );
  if (shipping.blocked) {
    throw new Error(
      shipping.label || "Não entregamos neste endereço. Atualize em Minha conta."
    );
  }

  const subtotal = lines.reduce(
    (s, l) => s + Number(l.preco_final_line || 0),
    0
  );

  let shippingGross = Math.round(shipping.amount * 100) / 100;
  let shippingPromoDiscount = 0;
  let shippingPromoName: string | null = null;
  if (shippingMethod === "delivery" && shippingGross > 0) {
    const promotions = await fetchActivePromotions();
    const shippingPromo = applyShippingPromotion(shippingGross, promotions);
    shippingPromoDiscount = shippingPromo.discount;
    shippingPromoName = shippingPromo.name;
  }
  const shippingAfterPromo = Math.max(0, shippingGross - shippingPromoDiscount);

  let productDiscount = 0;
  let shippingCouponDiscount = 0;
  let appliedCode = "";
  if (couponCode?.trim()) {
    const coupon = await validateCouponServer(
      couponCode.trim(),
      customer.id,
      subtotal,
      shippingAfterPromo
    );
    if (!coupon.ok) {
      throw new Error(coupon.error || "Cupom inválido");
    }
    appliedCode = String(coupon.code || couponCode.trim());
    const amt = Number(coupon.discount_amount) || 0;
    if (coupon.discount_target === "shipping") {
      shippingCouponDiscount = Math.min(amt, shippingAfterPromo);
    } else {
      productDiscount = Math.min(amt, subtotal);
    }
  }

  const shippingDiscountTotal = shippingPromoDiscount + shippingCouponDiscount;
  const couponRedeemAmount = productDiscount + shippingCouponDiscount;

  const supabase = await createClient();
  const { data: created, error } = await supabase.rpc("create_checkout_order", {
    p_customer_id: customer.id,
    p_items: lines,
    p_shipping_amount: shippingGross,
    p_discount_amount: Math.round(productDiscount * 100) / 100,
    p_shipping_discount: Math.round(shippingDiscountTotal * 100) / 100,
  });
  if (error) throw new Error(error.message);
  const orderData = Array.isArray(created) ? created[0] : created;
  if (!orderData) throw new Error("Erro ao criar pedido.");

  const orderId = String(orderData.order_id);
  const trackingToken = String(orderData.tracking_token);
  const total = Number(orderData.total_amount);
  const expiresAt = String(orderData.expires_at || "");

  if (appliedCode && couponRedeemAmount > 0) {
    await redeemCouponServer(
      appliedCode,
      customer.id,
      orderId,
      couponRedeemAmount
    );
  }

  const now = new Date();
  now.setMinutes(now.getMinutes() + PIX_EXPIRY_MINUTES);
  const brOffset = -3 * 60;
  const brDate = new Date(now.getTime() + brOffset * 60 * 1000);
  const expiresIso = brDate
    .toISOString()
    .replace("Z", "")
    .replace(/\.\d+/, "") + ".000-03:00";

  const desc =
    lines.length === 1 ? lines[0].product_name : `Pedido ${orderId.slice(0, 8)}`;
  const base = appBaseUrl();

  const result = await createPixCheckout({
    orderId,
    amount: total,
    description: desc,
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

  return {
    order_id: orderId,
    tracking_token: trackingToken,
    payment_id: paymentId,
    pix_copy_paste: result.pixCopyPaste,
    ticket_url: result.ticketUrl,
    provider_payment_id: result.providerPaymentId,
    total,
    discount_amount: productDiscount,
    shipping_discount_amount: shippingDiscountTotal,
    shipping_promo_name: shippingPromoName,
    coupon_code: appliedCode || null,
    shipping_amount: Math.max(0, shippingGross - shippingDiscountTotal),
    shipping_label: shipping.label,
    shipping_method: shippingMethod,
    delivery_range: shipping.delivery_range || null,
    expires_at: expiresAt || expiresIso,
    back_url: `${base}/pedidos/${trackingToken}`,
  };
}
