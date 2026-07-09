import { NextResponse } from "next/server";
import { cancelPayment } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { orderId, customerId, providerPaymentId } = await request.json();
    if (!orderId || !customerId) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    if (providerPaymentId) {
      try {
        await cancelPayment(providerPaymentId);
      } catch {
        // ignore MP cancel errors
      }
    }

    const supabase = await createClient();
    await supabase.rpc("cancel_unpaid_order", {
      p_order_id: orderId,
      p_customer_id: customerId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
