import { NextResponse } from "next/server";
import { fetchProduct, fetchStoreSettings } from "@/lib/catalog";
import { calculateShipping } from "@/lib/shipping";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customerId, cart } = body;
    if (!customerId || !cart?.length) {
      return NextResponse.json({ amount: 0, label: "", blocked: false });
    }

    const supabase = await createClient();
    const { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .single();
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
      settings as unknown as Record<string, unknown>
    );
    return NextResponse.json(quote);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
