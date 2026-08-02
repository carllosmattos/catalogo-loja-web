import { NextResponse } from "next/server";
import { sendShippedEmailIfNeeded } from "@/lib/email";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const orderId = body.orderId ? String(body.orderId) : "";
    const trackingCode =
      typeof body.trackingCode === "string" ? body.trackingCode.trim() : "";
    const trackingUrl =
      typeof body.trackingUrl === "string" ? body.trackingUrl.trim() : "";

    if (!orderId) {
      return NextResponse.json({ error: "Informe orderId." }, { status: 400 });
    }

    const service = await createServiceClient();
    const { data, error } = await service.rpc("mark_order_shipped", {
      p_order_id: orderId,
      p_tracking_code: trackingCode,
      p_tracking_url: trackingUrl,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Erro ao marcar enviado" },
        { status: 400 }
      );
    }

    await sendShippedEmailIfNeeded(orderId);

    return NextResponse.json({ ok: true, result: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
