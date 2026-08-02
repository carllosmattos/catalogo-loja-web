// Webhook Mercado Pago — confirma pagamento e registra vendas
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const paymentId =
      body?.data?.id ?? body?.id ?? null;

    if (!paymentId) {
      return new Response(JSON.stringify({ ok: true, skip: "no id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!mpToken || !supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "missing env" }), { status: 500 });
    }

    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${mpToken}` } },
    );
    const payment = await mpRes.json();

    const orderId = payment.external_reference;
    if (!orderId) {
      return new Response(JSON.stringify({ ok: true, skip: "no order" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = (payment.status || "pending").toLowerCase();
    const pix =
      payment.point_of_interaction?.transaction_data?.qr_code ?? "";

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: paymentRowId, error: upsertErr } = await supabase.rpc(
      "upsert_order_payment",
      {
        p_order_id: orderId,
        p_provider_payment_id: String(paymentId),
        p_status: status,
        p_amount: payment.transaction_amount ?? 0,
        p_pix_copy_paste: pix,
        p_raw: payment,
      },
    );

    if (upsertErr) {
      console.error("upsert_order_payment", upsertErr);
      return new Response(JSON.stringify({ error: upsertErr.message }), { status: 500 });
    }

    if (status === "approved") {
      const { error: fulfillErr } = await supabase.rpc("fulfill_paid_order", {
        p_order_id: orderId,
        p_payment_id: paymentRowId,
        p_provider_payment_id: String(paymentId),
      });
      if (fulfillErr) {
        console.error("fulfill_paid_order", fulfillErr);
        return new Response(JSON.stringify({ error: fulfillErr.message }), { status: 500 });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
