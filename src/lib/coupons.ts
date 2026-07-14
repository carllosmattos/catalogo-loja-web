import type { CouponValidation } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { createServiceClient } from "@/lib/supabase/server";

function unwrapCoupon(data: unknown): CouponValidation {
  const raw = (Array.isArray(data) ? data[0] : data) as CouponValidation | null;
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Cupom inválido" };
  }
  return {
    ok: Boolean(raw.ok),
    error: raw.error ? String(raw.error) : undefined,
    coupon_id: raw.coupon_id ? String(raw.coupon_id) : undefined,
    code: raw.code ? String(raw.code) : undefined,
    title: raw.title ? String(raw.title) : undefined,
    discount_type: raw.discount_type,
    discount_value:
      raw.discount_value != null ? Number(raw.discount_value) : undefined,
    discount_amount:
      raw.discount_amount != null ? Number(raw.discount_amount) : undefined,
    image_url: raw.image_url ? String(raw.image_url) : undefined,
  };
}

/** Validação no browser (carrinho). */
export async function validateCouponClient(
  code: string,
  customerId: string | null | undefined,
  subtotal: number
): Promise<CouponValidation> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("validate_coupon", {
    p_code: code,
    p_customer_id: customerId || null,
    p_subtotal: subtotal,
  });
  if (error) return { ok: false, error: error.message };
  return unwrapCoupon(data);
}

/** Validação no servidor (checkout). */
export async function validateCouponServer(
  code: string,
  customerId: string | null | undefined,
  subtotal: number
): Promise<CouponValidation> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase.rpc("validate_coupon", {
    p_code: code,
    p_customer_id: customerId || null,
    p_subtotal: subtotal,
  });
  if (error) return { ok: false, error: error.message };
  return unwrapCoupon(data);
}

export async function redeemCouponServer(
  code: string,
  customerId: string,
  orderId: string,
  discountAmount: number
): Promise<void> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase.rpc("redeem_coupon", {
    p_code: code,
    p_customer_id: customerId,
    p_order_id: orderId,
    p_discount_amount: discountAmount,
  });
  if (error) throw new Error(error.message);
  const result = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (result && result.ok === false) {
    throw new Error(result.error || "Não foi possível aplicar o cupom");
  }
}
