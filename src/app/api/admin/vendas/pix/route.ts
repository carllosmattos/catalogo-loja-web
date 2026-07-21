import { NextResponse } from "next/server";
import { startAdminPixSale } from "@/lib/admin-pix";
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
    const {
      customer,
      productId,
      size,
      quantity,
      freightQuoted,
      shippingMethod,
      shippingLabel,
      couponCode,
      uberFreightEstimate,
      notes,
    } = body;

    if (!productId || !size || !customer?.cpf || !customer?.name) {
      return NextResponse.json(
        { error: "Preencha cliente, produto e tamanho." },
        { status: 400 }
      );
    }

    const result = await startAdminPixSale({
      customer: {
        id: customer.id || null,
        name: String(customer.name),
        phone: String(customer.phone || ""),
        cpf: String(customer.cpf),
        email: customer.email ? String(customer.email) : undefined,
        address_zip: customer.address_zip,
        address_street: customer.address_street,
        address_number: customer.address_number,
        address_complement: customer.address_complement,
        address_neighborhood: customer.address_neighborhood,
        address_city: customer.address_city,
        address_state: customer.address_state,
      },
      productId: String(productId),
      size: String(size),
      quantity: Number(quantity) || 1,
      freightQuoted: Number(freightQuoted) || 0,
      shippingMethod: shippingMethod === "uber" ? "uber" : "delivery",
      shippingLabel: shippingLabel ? String(shippingLabel) : undefined,
      couponCode: typeof couponCode === "string" ? couponCode : null,
      uberFreightEstimate: Number(uberFreightEstimate) || 0,
      notes: notes ? String(notes) : undefined,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao gerar PIX" },
      { status: 500 }
    );
  }
}
