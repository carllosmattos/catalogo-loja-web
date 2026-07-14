import { NextResponse } from "next/server";
import {
  fetchActivePromotions,
  fetchProduct,
  fetchStoreSettings,
} from "@/lib/catalog";
import { applyShippingPromotion } from "@/lib/profit";
import { calculateShipping } from "@/lib/shipping";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customerId, cart, shippingMethod } = body;
    if (!customerId || !cart?.length) {
      return NextResponse.json({
        amount: 0,
        label: "",
        blocked: false,
        source: "",
      });
    }

    const method = shippingMethod === "uber" ? "uber" : "delivery";

    const supabase = await createServiceClient();
    const { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }

    const settings = await fetchStoreSettings();
    const lines = [];
    for (const item of cart) {
      const product = await fetchProduct(item.product_id);
      if (!product) continue;
      lines.push({
        quantity: item.quantity,
        sale_freight: product.sale_freight,
        preco_final_line:
          (Number(product.sale_price) + Number(product.sale_freight)) *
          item.quantity,
      });
    }

    const quote = await calculateShipping(
      customer as Record<string, string>,
      lines,
      settings as unknown as Record<string, unknown>,
      method
    );

    if (quote.blocked || method === "uber") {
      return NextResponse.json({
        ...quote,
        amount_before_discount: quote.amount,
        shipping_promo_discount: 0,
        shipping_promo_name: null,
      });
    }

    const promotions = await fetchActivePromotions();
    const shippingPromo = applyShippingPromotion(quote.amount, promotions);
    const amount = Math.max(0, quote.amount - shippingPromo.discount);

    return NextResponse.json({
      ...quote,
      amount,
      amount_before_discount: quote.amount,
      shipping_promo_discount: shippingPromo.discount,
      shipping_promo_name: shippingPromo.name,
      label:
        shippingPromo.discount > 0
          ? quote.label
            ? `${quote.label} · promo frete`
            : "Frete com promoção"
          : quote.label,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
