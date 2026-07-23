import { NextResponse } from "next/server";
import { reissuePixFromOrder } from "@/lib/reissue-pix";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json();
    const orderId = body.orderId ? String(body.orderId) : "";
    if (!orderId) {
      return NextResponse.json({ error: "Informe orderId." }, { status: 400 });
    }

    const result = await reissuePixFromOrder({ orderId });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao gerar novo PIX" },
      { status: 500 }
    );
  }
}
