import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = body.orderId ? String(body.orderId) : "";
    const customerId = body.customerId ? String(body.customerId) : "";

    if (!orderId || !customerId) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mark_order_received", {
      p_order_id: orderId,
      p_customer_id: customerId,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Erro ao confirmar recebimento" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, result: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
