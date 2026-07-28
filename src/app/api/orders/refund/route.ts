import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = body.orderId;
    const customerId = body.customerId;
    const reason = body.reason || "";
    const reasonCode = body.reasonCode || "other";
    if (!orderId || !customerId) {
      return NextResponse.json(
        { error: "orderId e customerId obrigatórios" },
        { status: 400 }
      );
    }
    if (!["cooling_off", "defect", "other"].includes(String(reasonCode))) {
      return NextResponse.json({ error: "Motivo inválido" }, { status: 400 });
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("request_order_refund", {
      p_order_id: orderId,
      p_customer_id: customerId,
      p_reason: reason,
      p_reason_code: reasonCode,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, refund_id: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
