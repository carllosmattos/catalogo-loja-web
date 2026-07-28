import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refundPayment } from "@/lib/payments";

export async function POST(request: Request) {
  try {
    const { refundId, adminNotes } = await request.json();
    if (!refundId) {
      return NextResponse.json(
        { error: "refundId obrigatório" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: req, error: fetchErr } = await supabase
      .from("refund_requests")
      .select("*, orders(*), payments(*)")
      .eq("id", refundId)
      .maybeSingle();

    if (fetchErr || !req) {
      return NextResponse.json(
        { error: fetchErr?.message || "Solicitação não encontrada" },
        { status: 404 }
      );
    }
    if (String(req.status) !== "pending") {
      return NextResponse.json(
        { error: "Solicitação já foi tratada" },
        { status: 400 }
      );
    }

    const payment = Array.isArray(req.payments) ? req.payments[0] : req.payments;
    const mpId = payment?.provider_payment_id
      ? String(payment.provider_payment_id)
      : "";
    if (!mpId) {
      return NextResponse.json(
        { error: "Pagamento sem ID do Mercado Pago" },
        { status: 400 }
      );
    }

    const refundResult = await refundPayment(mpId);
    if (
      refundResult.error ||
      (refundResult.status &&
        !["approved", "authorized"].includes(String(refundResult.status)) &&
        !refundResult.id)
    ) {
      const msg =
        typeof refundResult.message === "string"
          ? refundResult.message
          : typeof refundResult.error === "string"
            ? refundResult.error
            : JSON.stringify(refundResult.error || refundResult);
      return NextResponse.json(
        { error: `Falha no estorno MP: ${msg}` },
        { status: 502 }
      );
    }

    const providerRefundId = String(
      refundResult.id || refundResult.refund_id || ""
    );

    const { error: updErr } = await supabase
      .from("refund_requests")
      .update({
        status: "approved",
        admin_notes: String(adminNotes || "").trim(),
        provider_refund_id: providerRefundId || null,
      })
      .eq("id", refundId);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    const orderId = req.order_id;
    const { error: rpcErr } = await supabase.rpc("mark_order_refunded", {
      p_order_id: orderId,
    });
    if (rpcErr) {
      return NextResponse.json(
        {
          error: `Estorno MP ok, mas falha ao finalizar pedido: ${rpcErr.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, provider_refund_id: providerRefundId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
