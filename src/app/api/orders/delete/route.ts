import { NextResponse } from "next/server";
import { cancelPayment } from "@/lib/payments";
import { createClient, createServiceClient } from "@/lib/supabase/server";

function isMissingRpc(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("delete_customer_order") ||
    m.includes("could not find the function") ||
    m.includes("does not exist")
  );
}

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
    const { error } = await supabase.rpc("delete_customer_order", {
      p_order_id: orderId,
      p_customer_id: customerId,
    });

    if (!error) {
      return NextResponse.json({ ok: true });
    }

    if (!isMissingRpc(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Fallback sem migração 027: cancela pendente e remove o pedido
    const service = await createServiceClient();
    const { data: order, error: fetchError } = await service
      .from("orders")
      .select("id, customer_id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (fetchError || !order) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }
    if (String(order.customer_id) !== String(customerId)) {
      return NextResponse.json({ error: "Pedido não pertence ao cliente" }, { status: 403 });
    }

    if (order.status === "pending_payment") {
      const { error: cancelError } = await supabase.rpc("cancel_unpaid_order", {
        p_order_id: orderId,
        p_customer_id: customerId,
      });
      if (cancelError) {
        return NextResponse.json({ error: cancelError.message }, { status: 400 });
      }
    }

    const { error: deleteError } = await service
      .from("orders")
      .delete()
      .eq("id", orderId)
      .eq("customer_id", customerId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, mode: "hard_delete" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
