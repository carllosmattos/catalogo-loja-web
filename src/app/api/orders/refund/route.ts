import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { orderId, customerId, reason } = await request.json();
    const supabase = await createClient();
    await supabase.rpc("request_order_refund", {
      p_order_id: orderId,
      p_customer_id: customerId,
      p_reason: reason || "",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
