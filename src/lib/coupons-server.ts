import type { CouponValidation } from "@/types";
import { unwrapCoupon } from "@/lib/coupons";
import { createServiceClient } from "@/lib/supabase/server";

/** Validação no servidor (checkout). */
export async function validateCouponServer(
  code: string,
  customerId: string | null | undefined,
  subtotal: number,
  shipping = 0
): Promise<CouponValidation> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase.rpc("validate_coupon", {
    p_code: code,
    p_customer_id: customerId || null,
    p_subtotal: subtotal,
    p_shipping: shipping,
  });
  if (error) return { ok: false, error: error.message };
  return unwrapCoupon(data);
}

export async function redeemCouponServer(
  code: string,
  customerId: string | null,
  orderId: string | null,
  discountAmount: number,
  saleId?: string | null
): Promise<void> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase.rpc("redeem_coupon", {
    p_code: code,
    p_customer_id: customerId,
    p_order_id: orderId,
    p_discount_amount: discountAmount,
    p_sale_id: saleId || null,
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
