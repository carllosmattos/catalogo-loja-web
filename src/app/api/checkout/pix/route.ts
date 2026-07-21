import { NextResponse } from "next/server";
import { buildLinesFromCart, startPixCheckout } from "@/lib/checkout";
import { fetchProduct } from "@/lib/catalog";
import { createServiceClient } from "@/lib/supabase/server";
import type { Customer } from "@/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      customerId,
      cart,
      shippingMethod,
      couponCode,
      uberFreightEstimate,
    } = body;
    if (!customerId || !cart?.length) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
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

    const productsById: Record<string, Awaited<ReturnType<typeof fetchProduct>>> = {};
    for (const item of cart) {
      if (!productsById[item.product_id]) {
        productsById[item.product_id] = await fetchProduct(item.product_id);
      }
    }

    const validProducts = Object.fromEntries(
      Object.entries(productsById).filter(([, p]) => p !== null)
    ) as Record<string, NonNullable<Awaited<ReturnType<typeof fetchProduct>>>>;

    const lines = await buildLinesFromCart(cart, validProducts);
    const result = await startPixCheckout(
      customer as Customer,
      lines,
      method,
      typeof couponCode === "string" ? couponCode : null,
      Number(uberFreightEstimate) || 0
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro no checkout" },
      { status: 500 }
    );
  }
}
