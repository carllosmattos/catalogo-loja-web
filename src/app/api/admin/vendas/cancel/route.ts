import { NextResponse } from "next/server";
import { cancelPayment } from "@/lib/payments";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Cancela venda no admin: bloqueia se PIX aprovado; cancela payments pendentes no MP + RPC. */
export async function POST(request: Request) {
  try {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { saleId } = await request.json();
    if (!saleId) {
      return NextResponse.json({ error: "Informe saleId." }, { status: 400 });
    }

    const supabase = await createServiceClient();
    const { data: sale, error: saleErr } = await supabase
      .from("sales")
      .select("id, order_id, payment_id, cancelled_at")
      .eq("id", saleId)
      .maybeSingle();
    if (saleErr) throw new Error(saleErr.message);
    if (!sale) {
      return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
    }
    if (sale.cancelled_at) {
      return NextResponse.json({ error: "Venda já cancelada." }, { status: 400 });
    }

    let payments: Array<{
      provider_payment_id?: string | null;
      status?: string | null;
    }> = [];

    if (sale.order_id) {
      const { data } = await supabase
        .from("payments")
        .select("provider_payment_id, status")
        .eq("order_id", sale.order_id);
      payments = data || [];
    } else if (sale.payment_id) {
      const { data } = await supabase
        .from("payments")
        .select("provider_payment_id, status")
        .eq("id", sale.payment_id);
      payments = data || [];
    }

    if (payments.some((p) => String(p.status) === "approved")) {
      return NextResponse.json(
        {
          error:
            "Não é possível cancelar venda com pagamento aprovado. Use estorno/reembolso do pedido.",
        },
        { status: 400 }
      );
    }

    for (const p of payments) {
      const st = String(p.status || "");
      const pid = p.provider_payment_id ? String(p.provider_payment_id) : "";
      if (pid && ["pending", "in_process"].includes(st)) {
        try {
          await cancelPayment(pid);
        } catch {
          // ignore MP errors
        }
      }
    }

    const { error } = await auth.rpc("cancel_sale", { p_sale_id: saleId });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao cancelar venda" },
      { status: 500 }
    );
  }
}
