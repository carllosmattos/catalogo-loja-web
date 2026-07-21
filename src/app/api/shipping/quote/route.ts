import { NextResponse } from "next/server";
import {
  fetchActivePromotions,
  fetchProduct,
  fetchStoreSettings,
} from "@/lib/catalog";
import { applyShippingPromotion } from "@/lib/profit";
import { calculateShipping } from "@/lib/shipping";
import { createServiceClient } from "@/lib/supabase/server";

type AddressBody = {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
};

function customerFromAddress(address: AddressBody): Record<string, string> {
  return {
    address_zip: String(address.zip || ""),
    address_street: String(address.street || ""),
    address_number: String(address.number || ""),
    address_complement: String(address.complement || ""),
    address_neighborhood: String(address.neighborhood || ""),
    address_city: String(address.city || ""),
    address_state: String(address.state || "").toUpperCase(),
  };
}

function hasUsableAddress(address?: AddressBody | null): boolean {
  if (!address) return false;
  const zip = String(address.zip || "").replace(/\D/g, "");
  return zip.length === 8 || Boolean(address.city && address.state);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customerId, cart, shippingMethod, address } = body as {
      customerId?: string;
      cart?: Array<{ product_id: string; quantity: number }>;
      shippingMethod?: string;
      address?: AddressBody;
    };

    if (!cart?.length) {
      return NextResponse.json({
        amount: 0,
        label: "",
        blocked: false,
        source: "",
      });
    }

    const method = shippingMethod === "uber" ? "uber" : "delivery";
    let customer: Record<string, string> | null = null;

    // Endereço explícito tem prioridade (admin pode editar na hora)
    if (hasUsableAddress(address)) {
      customer = customerFromAddress(address!);
    } else if (customerId) {
      const supabase = await createServiceClient();
      const { data } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .maybeSingle();
      if (!data) {
        return NextResponse.json(
          { error: "Cliente não encontrado" },
          { status: 404 }
        );
      }
      customer = data as Record<string, string>;
    } else {
      return NextResponse.json(
        { error: "Informe o cliente ou o endereço para cotar o frete" },
        { status: 400 }
      );
    }

    const settings = await fetchStoreSettings();
    const lines = [];
    for (const item of cart) {
      const product = await fetchProduct(item.product_id);
      if (!product) continue;
      lines.push({
        quantity: item.quantity,
        sale_freight: product.sale_freight,
        preco_final_line:
          (Number(product.sale_price) + Number(product.sale_freight)) *
          item.quantity,
      });
    }

    const quote = await calculateShipping(
      customer,
      lines,
      settings as unknown as Record<string, unknown>,
      method
    );

    if (quote.blocked || method === "uber") {
      return NextResponse.json({
        ...quote,
        amount_before_discount: quote.amount,
        shipping_promo_discount: 0,
        shipping_promo_name: null,
      });
    }

    const promotions = await fetchActivePromotions();
    const shippingPromo = applyShippingPromotion(quote.amount, promotions);
    const amount = Math.max(0, quote.amount - shippingPromo.discount);

    return NextResponse.json({
      ...quote,
      amount,
      amount_before_discount: quote.amount,
      shipping_promo_discount: shippingPromo.discount,
      shipping_promo_name: shippingPromo.name,
      label:
        shippingPromo.discount > 0
          ? quote.label
            ? `${quote.label} · promo frete`
            : "Frete com promoção"
          : quote.label,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
