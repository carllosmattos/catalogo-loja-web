import { NextResponse } from "next/server";
import { reissuePixFromOrder } from "@/lib/reissue-pix";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = body.orderId ? String(body.orderId) : "";
    const customerId = body.customerId ? String(body.customerId) : "";
    if (!orderId || !customerId) {
      return NextResponse.json(
        { error: "Informe orderId e customerId." },
        { status: 400 }
      );
    }
    const result = await reissuePixFromOrder({ orderId, customerId });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao gerar novo PIX" },
      { status: 500 }
    );
  }
}
