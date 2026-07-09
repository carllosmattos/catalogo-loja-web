import { NextResponse } from "next/server";
import { getPayment, mapMpStatus } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json();
    const { providerPaymentId, customerId } = body;

    if (!providerPaymentId) {
      return NextResponse.json({ error: "ID de pagamento ausente" }, { status: 400 });
    }

    const payment = await getPayment(providerPaymentId);
    const status = mapMpStatus(String(payment.status || "pending"));

    const supabase = await createClient();
    if (customerId) {
      await supabase.rpc("apply_payment_status_public", {
        p_order_id: orderId,
        p_customer_id: customerId,
        p_status: status,
        p_provider_payment_id: providerPaymentId,
      });
    } else {
      await supabase.rpc("apply_payment_status_admin", {
        p_order_id: orderId,
        p_status: status,
        p_provider_payment_id: providerPaymentId,
      });
    }

    return NextResponse.json({ status, payment });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
