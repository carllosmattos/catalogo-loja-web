import type { CouponValidation } from "@/types";
import { createClient } from "@/lib/supabase/client";

export function unwrapCoupon(data: unknown): CouponValidation {
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
