import { NextResponse } from "next/server";
import {
  extractPixCopyPaste,
  getPayment,
  mapMpStatus,
} from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    let { providerPaymentId, customerId } = body as {
      providerPaymentId?: string;
      customerId?: string;
    };

    const supabase = await createClient();

    // Se não veio o ID do MP, busca no pedido
    if (!providerPaymentId) {
      const { data: payRows } = await supabase
        .from("payments")
        .select("provider_payment_id")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1);
      providerPaymentId = payRows?.[0]?.provider_payment_id
        ? String(payRows[0].provider_payment_id)
        : undefined;
    }

    if (!providerPaymentId) {
      return NextResponse.json(
        { error: "ID de pagamento ausente" },
        { status: 400 }
      );
    }

    const payment = await getPayment(providerPaymentId);
    if (!payment || payment.error) {
      return NextResponse.json(
        {
          error:
            typeof payment?.message === "string"
              ? payment.message
              : "Não foi possível consultar o Mercado Pago",
        },
        { status: 502 }
      );
    }

    const status = mapMpStatus(String(payment.status || "pending"));
    const amount = Number(payment.transaction_amount) || 0;
    let pix = extractPixCopyPaste(payment);
    if (pix.length > 500) pix = "";

    const rpcArgs: Record<string, unknown> = {
      p_order_id: orderId,
      p_provider_payment_id: String(providerPaymentId),
      p_status: status,
      p_amount: amount,
      p_pix_copy_paste: pix,
      p_raw: payment,
    };

    let rpcError: { message: string } | null = null;
    let rpcData: unknown = null;

    if (customerId) {
      const { data, error } = await supabase.rpc(
        "apply_payment_status_public",
        { ...rpcArgs, p_customer_id: customerId }
      );
      rpcError = error;
      rpcData = data;
    } else {
      const { data, error } = await supabase.rpc(
        "apply_payment_status_admin",
        rpcArgs
      );
      rpcError = error;
      rpcData = data;
    }

    if (rpcError) {
      console.error("sync payment RPC:", rpcError);
      return NextResponse.json(
        { error: rpcError.message || "Erro ao aplicar status no banco" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status,
      amount,
      result: rpcData,
      message:
        status === "approved"
          ? "Pagamento aprovado — venda registrada."
          : `Status: ${status}`,
    });
  } catch (e) {
    console.error("sync payment:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
