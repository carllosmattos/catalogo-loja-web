"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  AdminCard,
  AdminInput,
  AdminButton,
  AdminFormActions,
} from "@/components/admin/AdminUI";
import {
  BRAZILIAN_STATES,
  addressFieldsFromCustomer,
  formatCustomerAddress,
  type AddressFields,
} from "@/lib/address";
import { SIZES, SIZE_LABELS, sizeDisplayLabel } from "@/lib/sizes";
import { formatCurrency, formatCpf, normalizeCpf } from "@/lib/utils";
import {
  buildAdminPixPaymentMessage,
  buildAdminSaleQuoteMessage,
  buildWhatsappUrl,
} from "@/lib/whatsapp";
import { buildAdminSalePricing } from "@/lib/admin-sale-pricing";
import { validateCouponClient } from "@/lib/coupons";
import type { CouponValidation, Product, Promotion } from "@/types";

type SaleRow = Record<string, unknown> & {
  id: string;
  sale_gifts?: Array<Record<string, unknown>>;
};

type ProductOption = {
  id: string;
  name: string;
  purchase_price: number;
  purchase_freight: number;
  sale_price: number;
  sizes: Record<string, number>;
};

type ShippingQuoteState = {
  amount: number;
  label: string;
  blocked: boolean;
  delivery_range?: string | null;
  source?: string;
};

type PixResult = {
  order_id: string;
  tracking_token: string;
  tracking_url: string;
  pix_copy_paste: string;
  pix_qr_base64?: string;
  total: number;
  provider_payment_id?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  product_name?: string;
  product_size?: string;
  quantity?: number;
  shipping_method?: string;
};

const emptyAddress = (): AddressFields => ({
  zip: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
});

export default function AdminVendasPage() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [storeName, setStoreName] = useState("LM moda feminina");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [address, setAddress] = useState<AddressFields>(emptyAddress());
  const [shippingMethod, setShippingMethod] = useState<"delivery" | "uber">(
    "delivery"
  );
  const [quote, setQuote] = useState<ShippingQuoteState | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [pixResult, setPixResult] = useState<PixResult | null>(null);
  const [pixBusy, setPixBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [linkedGifts, setLinkedGifts] = useState<
    Array<{
      quantity_per_sale?: number;
      gift_data?: Record<string, unknown>;
      gifts?: Record<string, unknown>;
    }>
  >([]);
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<CouponValidation | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [ajusteDraft, setAjusteDraft] = useState<Record<string, string>>({});
  const [ajusteBusyId, setAjusteBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_cpf: "",
    customer_name: "",
    product_id: "",
    product_size: "",
    quantity: 1,
    sale_freight: 0,
  });
  const [cpfHint, setCpfHint] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [message, setMessage] = useState("");
  const nameFromLookup = useRef(false);
  const supabase = createClient();

  const selectedProduct = products.find((p) => p.id === form.product_id);

  const availableSizes = useMemo(() => {
    if (!selectedProduct) return [];
    return SIZES.filter((s) => (selectedProduct.sizes[s] || 0) > 0).map(
      (s) => ({
        size: s,
        stock: selectedProduct.sizes[s] || 0,
      })
    );
  }, [selectedProduct]);

  const maxQty = useMemo(() => {
    if (!selectedProduct || !form.product_size) return 0;
    return selectedProduct.sizes[form.product_size] || 0;
  }, [selectedProduct, form.product_size]);

  const productAsCatalog: Product | null = selectedProduct
    ? ({
        id: selectedProduct.id,
        name: selectedProduct.name,
        purchase_price: selectedProduct.purchase_price,
        purchase_freight: selectedProduct.purchase_freight,
        sale_price: selectedProduct.sale_price,
        sale_freight: 0,
        stock: 0,
        active: true,
        sizes: SIZES.map((s) => ({
          size: s,
          stock: selectedProduct.sizes[s] || 0,
        })),
      } as Product)
    : null;

  const freightQuoted =
    shippingMethod === "uber" ? 0 : Math.max(0, Number(form.sale_freight) || 0);

  const pricing = useMemo(() => {
    if (!productAsCatalog || !form.product_size) return null;
    return buildAdminSalePricing({
      product: productAsCatalog,
      linkedGifts,
      promotions,
      size: form.product_size,
      quantity: Math.max(1, Number(form.quantity) || 1),
      freightQuoted,
      applyShippingPromo: false,
      coupon,
    });
  }, [
    productAsCatalog,
    linkedGifts,
    promotions,
    form.product_size,
    form.quantity,
    freightQuoted,
    coupon,
  ]);

  const productSubtotal = pricing
    ? pricing.preco_final - pricing.sale_freight
    : selectedProduct
      ? Number(selectedProduct.sale_price) * Math.max(0, Number(form.quantity) || 0)
      : 0;
  const freightCharged = pricing?.sale_freight ?? freightQuoted;
  const precoFinal = pricing?.preco_final ?? productSubtotal + freightCharged;
  const lucroEstimado = pricing?.lucro ?? 0;

  const outOfStock =
    Boolean(form.product_id) && availableSizes.length === 0;
  const canSell =
    Boolean(form.product_id) &&
    Boolean(form.product_size) &&
    maxQty > 0 &&
    form.quantity >= 1 &&
    form.quantity <= maxQty &&
    !(shippingMethod === "delivery" && quote?.blocked);

  async function load() {
    const now = new Date().toISOString();
    const [{ data: s }, { data: p }, { data: sizeRows }, { data: settings }, { data: promos }] =
      await Promise.all([
        supabase
          .from("sales")
          .select("*, sale_gifts(*)")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("products")
          .select("id, name, purchase_price, purchase_freight, sale_price")
          .eq("active", true)
          .order("name"),
        supabase.from("product_sizes").select("product_id, size, stock"),
        supabase
          .from("store_settings")
          .select("store_name, whatsapp_number")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("promotions")
          .select("*")
          .eq("active", true)
          .or(`starts_at.is.null,starts_at.lte.${now}`)
          .or(`ends_at.is.null,ends_at.gte.${now}`),
      ]);

    const sizeMap: Record<string, Record<string, number>> = {};
    for (const row of sizeRows || []) {
      if (!sizeMap[row.product_id]) sizeMap[row.product_id] = {};
      sizeMap[row.product_id][row.size] = Number(row.stock) || 0;
    }

    setSales((s as SaleRow[]) || []);
    setProducts(
      (p || []).map((row) => ({
        id: row.id,
        name: row.name,
        purchase_price: Number(row.purchase_price) || 0,
        purchase_freight: Number(row.purchase_freight) || 0,
        sale_price: Number(row.sale_price) || 0,
        sizes: Object.fromEntries(
          SIZES.map((sz) => [sz, sizeMap[row.id]?.[sz] ?? 0])
        ),
      }))
    );
    if (settings?.store_name) setStoreName(String(settings.store_name));
    if (settings?.whatsapp_number) {
      setWhatsappNumber(String(settings.whatsapp_number));
    }
    setPromotions((promos as Promotion[]) || []);
  }

  async function loadGiftsForProduct(productId: string) {
    if (!productId) {
      setLinkedGifts([]);
      return;
    }
    const { data } = await supabase
      .from("product_gifts")
      .select("quantity_per_sale, gifts(*)")
      .eq("product_id", productId);
    setLinkedGifts(
      (data || []).map((row) => {
        const raw = row.gifts;
        const gift = Array.isArray(raw) ? raw[0] : raw;
        return {
          quantity_per_sale: Number(row.quantity_per_sale) || 1,
          gift_data: (gift as Record<string, unknown>) || undefined,
        };
      })
    );
  }

  useEffect(() => {
    load();
  }, []);

  function resetSaleForm() {
    setForm({
      customer_cpf: "",
      customer_name: "",
      product_id: "",
      product_size: "",
      quantity: 1,
      sale_freight: 0,
    });
    setCustomerId(null);
    setCustomerPhone("");
    setCustomerEmail("");
    setAddress(emptyAddress());
    setQuote(null);
    setShippingMethod("delivery");
    setPixResult(null);
    setCouponCode("");
    setCoupon(null);
    setLinkedGifts([]);
    setCpfHint(null);
    nameFromLookup.current = false;
  }

  async function lookupCustomerByCpf(raw: string) {
    const cpf = normalizeCpf(raw);
    if (!cpf) {
      setCpfHint(null);
      setCustomerId(null);
      return;
    }
    setLookingUp(true);
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("cpf", cpf)
      .maybeSingle();
    setLookingUp(false);

    if (data?.name) {
      nameFromLookup.current = true;
      setCustomerId(String(data.id));
      setCustomerPhone(String(data.phone || ""));
      setCustomerEmail(String(data.email || ""));
      setAddress(addressFieldsFromCustomer(data));
      setForm((f) => ({ ...f, customer_name: String(data.name) }));
      const hasAddr = Boolean(
        data.address_zip || data.address_city || data.address
      );
      setCpfHint(
        hasAddr
          ? "Cliente encontrado — nome e endereço preenchidos."
          : "Cliente encontrado sem endereço. Preencha abaixo para cotar frete."
      );
    } else {
      setCustomerId(null);
      setCustomerPhone("");
      setCustomerEmail("");
      setCpfHint(
        "CPF sem cadastro. Preencha nome, WhatsApp e endereço (PIX cria o cliente)."
      );
      if (nameFromLookup.current) {
        nameFromLookup.current = false;
        setForm((f) => ({ ...f, customer_name: "" }));
        setAddress(emptyAddress());
      }
    }
  }

  function onCpfChange(value: string) {
    setForm((f) => ({ ...f, customer_cpf: value }));
    setCpfHint(null);
    const digits = value.replace(/\D/g, "");
    if (digits.length === 11) {
      lookupCustomerByCpf(value);
    }
  }

  function onProductChange(id: string) {
    const p = products.find((x) => x.id === id);
    const sizes = p
      ? SIZES.filter((s) => (p.sizes[s] || 0) > 0)
      : [];
    const firstSize = sizes[0] || "";
    const stock = firstSize && p ? p.sizes[firstSize] || 0 : 0;
    setForm((f) => ({
      ...f,
      product_id: id,
      product_size: firstSize,
      quantity: stock > 0 ? 1 : 0,
      sale_freight: 0,
    }));
    setQuote(null);
    setCoupon(null);
    loadGiftsForProduct(id);
  }

  function onSizeChange(size: string) {
    const stock = selectedProduct?.sizes[size] || 0;
    setForm((f) => ({
      ...f,
      product_size: size,
      quantity: Math.min(Math.max(1, f.quantity), stock || 1),
    }));
    setQuote(null);
  }

  async function quoteShipping() {
    if (!form.product_id) {
      setMessage("Selecione um produto para cotar o frete.");
      return;
    }
    setQuoting(true);
    setMessage("");
    try {
      const res = await fetch("/api/shipping/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId || undefined,
          address: {
            zip: address.zip,
            street: address.street,
            number: address.number,
            complement: address.complement,
            neighborhood: address.neighborhood,
            city: address.city,
            state: address.state,
          },
          cart: [
            {
              product_id: form.product_id,
              quantity: Math.max(1, Number(form.quantity) || 1),
            },
          ],
          shippingMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Falha ao cotar frete");
        setQuote(null);
        return;
      }
      setQuote({
        amount: Number(data.amount) || 0,
        label: String(data.label || ""),
        blocked: Boolean(data.blocked),
        delivery_range: data.delivery_range ?? null,
        source: data.source,
      });
      if (shippingMethod === "delivery" && !data.blocked) {
        setForm((f) => ({ ...f, sale_freight: Number(data.amount) || 0 }));
      } else if (shippingMethod === "uber") {
        setForm((f) => ({ ...f, sale_freight: 0 }));
      }
    } catch {
      setMessage("Erro ao cotar frete.");
    } finally {
      setQuoting(false);
    }
  }

  function addressText() {
    return formatCustomerAddress({
      address_zip: address.zip,
      address_street: address.street,
      address_number: address.number,
      address_complement: address.complement,
      address_neighborhood: address.neighborhood,
      address_city: address.city,
      address_state: address.state,
      address: "",
      name: "",
      phone: "",
      cpf: "",
      email: "",
      id: "",
      points: 0,
    });
  }

  function shareWhatsApp() {
    if (pixResult?.pix_copy_paste) {
      const phone =
        (pixResult.customer_phone || customerPhone).replace(/\D/g, "") ||
        whatsappNumber;
      if (!phone) {
        setMessage(
          "Informe o WhatsApp do cliente ou configure o da loja em Admin → Loja."
        );
        return;
      }
      const msg = buildAdminPixPaymentMessage({
        storeName,
        customerName: pixResult.customer_name || form.customer_name,
        productName: String(pixResult.product_name || selectedProduct?.name),
        size: pixResult.product_size || form.product_size,
        quantity: Number(pixResult.quantity) || form.quantity,
        total: Number(pixResult.total),
        pixCopyPaste: pixResult.pix_copy_paste,
        trackingUrl: pixResult.tracking_url,
        shippingMethod:
          pixResult.shipping_method === "uber" ? "uber" : "delivery",
      });
      window.open(buildWhatsappUrl(phone, msg), "_blank", "noopener");
      return;
    }
    if (!form.product_id || !selectedProduct) {
      setMessage("Selecione o produto antes de compartilhar.");
      return;
    }
    const msg = buildAdminSaleQuoteMessage({
      storeName,
      productName: selectedProduct.name,
      size: form.product_size,
      quantity: Math.max(1, Number(form.quantity) || 1),
      productSubtotal,
      shippingMethod,
      shippingAmount: freightCharged,
      shippingLabel: quote?.label,
      deliveryRange: quote?.delivery_range,
      total: precoFinal,
      customerName: form.customer_name || undefined,
      addressText: shippingMethod === "delivery" ? addressText() : undefined,
    });
    const phone = customerPhone.replace(/\D/g, "") || whatsappNumber;
    if (!phone) {
      setMessage(
        "Informe o WhatsApp do cliente ou configure o da loja em Admin → Loja."
      );
      return;
    }
    window.open(buildWhatsappUrl(phone, msg), "_blank", "noopener");
  }

  async function applyCoupon() {
    if (!couponCode.trim()) {
      setCoupon(null);
      setMessage("Informe o código do cupom.");
      return;
    }
    if (!pricing && !selectedProduct) {
      setMessage("Selecione o produto antes de aplicar o cupom.");
      return;
    }
    setCouponBusy(true);
    setMessage("");
    const base = productAsCatalog
      ? buildAdminSalePricing({
          product: productAsCatalog,
          linkedGifts,
          promotions,
          size: form.product_size || "M",
          quantity: Math.max(1, Number(form.quantity) || 1),
          freightQuoted,
          applyShippingPromo: false,
          coupon: null,
        })
      : null;
    const subtotal = base
      ? base.preco_catalogo - base.desconto_promo
      : productSubtotal;
    const freight = base?.sale_freight ?? freightQuoted;
    const result = await validateCouponClient(
      couponCode.trim(),
      customerId,
      subtotal,
      freight
    );
    setCouponBusy(false);
    if (!result.ok) {
      setCoupon(null);
      setMessage(result.error || "Cupom inválido");
      return;
    }
    setCoupon(result);
    setMessage(
      `Cupom ${result.code} aplicado (−${formatCurrency(Number(result.discount_amount) || 0)}${
        result.discount_target === "shipping" ? " no frete" : ""
      }).`
    );
  }

  async function generatePix() {
    setMessage("");
    if (!canSell || !selectedProduct) {
      setMessage(
        outOfStock
          ? "Produto sem estoque — não é possível gerar PIX."
          : "Selecione tamanho e quantidade disponíveis."
      );
      return;
    }
    if (!form.customer_name.trim() || !normalizeCpf(form.customer_cpf)) {
      setMessage("Para PIX, informe CPF e nome do cliente.");
      return;
    }
    if (!customerPhone.replace(/\D/g, "")) {
      setMessage("Para PIX, informe o WhatsApp do cliente com DDD.");
      return;
    }
    setPixBusy(true);
    try {
      const res = await fetch("/api/admin/vendas/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            id: customerId,
            name: form.customer_name,
            phone: customerPhone,
            cpf: form.customer_cpf,
            email: customerEmail || undefined,
            address_zip: address.zip,
            address_street: address.street,
            address_number: address.number,
            address_complement: address.complement,
            address_neighborhood: address.neighborhood,
            address_city: address.city,
            address_state: address.state,
          },
          productId: selectedProduct.id,
          size: form.product_size,
          quantity: form.quantity,
          freightQuoted,
          shippingMethod,
          shippingLabel: quote?.label,
          couponCode: coupon?.ok ? coupon.code : couponCode || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao gerar PIX");
      setPixResult(data as PixResult);
      setMessage(
        "PIX gerado. Estoque reservado — a venda só efetua quando pagar. Acompanhe em Pagamentos."
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao gerar PIX");
    } finally {
      setPixBusy(false);
    }
  }

  async function syncPixPayment() {
    if (!pixResult?.order_id) return;
    setSyncBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/payments/${pixResult.order_id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerPaymentId: pixResult.provider_payment_id,
          customerId: pixResult.customer_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || "Falha ao atualizar status");
      } else if (String(data.status) === "approved") {
        setMessage("Pagamento aprovado — venda registrada e estoque baixado.");
        setPixResult(null);
        resetSaleForm();
        load();
      } else {
        setMessage(`Status do PIX: ${data.status || "pendente"}`);
      }
    } catch {
      setMessage("Erro de rede ao sincronizar pagamento.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function registerSale(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    if (!canSell || !selectedProduct || !pricing) {
      setMessage(
        outOfStock
          ? "Produto sem estoque — não é possível vender."
          : "Selecione tamanho e quantidade disponíveis."
      );
      return;
    }
    const qty = Math.max(1, Number(form.quantity) || 1);
    if (qty > maxQty) {
      setMessage(`Estoque insuficiente (máx. ${maxQty}).`);
      return;
    }

    const notesParts: string[] = [];
    if (shippingMethod === "uber") notesParts.push("Entrega: Uber");
    else if (quote?.label) notesParts.push(`Frete: ${quote.label}`);
    if (pricing.promotion_name) {
      notesParts.push(`Promo: ${pricing.promotion_name}`);
    }
    if (pricing.coupon_code) {
      notesParts.push(
        `Cupom: ${pricing.coupon_code}${
          pricing.coupon_title ? ` (${pricing.coupon_title})` : ""
        }`
      );
    }
    if (pricing.frete_absorvido > 0) {
      notesParts.push(
        `Frete na conta da loja (estimado): R$ ${pricing.frete_absorvido.toFixed(2)}`
      );
    }
    const addr = addressText();
    if (addr) notesParts.push(`Endereço:\n${addr}`);

    const { data: saleId, error } = await supabase.rpc("register_sale", {
      p_customer_cpf: form.customer_cpf.replace(/\D/g, ""),
      p_customer_name: form.customer_name,
      p_customer_phone: customerPhone,
      p_customer_id: customerId,
      p_product_id: form.product_id,
      p_product_name: selectedProduct.name,
      p_product_size: form.product_size,
      p_quantity: qty,
      p_preco_catalogo: pricing.preco_catalogo,
      p_desconto: pricing.desconto_total,
      p_sale_freight: pricing.sale_freight,
      p_preco_final: pricing.preco_final,
      p_lucro: pricing.lucro,
      p_promotion_id: pricing.promotion_id,
      p_promotion_name: pricing.promotion_name,
      p_notes: notesParts.join("\n"),
      p_gifts: pricing.gifts,
      p_ajuste_valor: pricing.frete_absorvido,
    });
    if (error) {
      setMessage(error.message);
      return;
    }

    const couponRedeem =
      pricing.desconto_cupom_produto + pricing.coupon_shipping_discount;
    if (pricing.coupon_code && couponRedeem > 0 && saleId) {
      const { error: redeemErr } = await supabase.rpc("redeem_coupon", {
        p_code: pricing.coupon_code,
        p_customer_id: customerId,
        p_order_id: null,
        p_discount_amount: couponRedeem,
        p_sale_id: saleId,
      });
      if (redeemErr) {
        setMessage(
          `Venda ok, mas o cupom não foi marcado como usado: ${redeemErr.message}. Rode a migration 036.`
        );
        resetSaleForm();
        load();
        return;
      }
    }

    resetSaleForm();
    setMessage("Venda registrada.");
    load();
  }

  async function saveSaleAjuste(saleId: string) {
    const raw = ajusteDraft[saleId];
    const value = Number(raw);
    if (Number.isNaN(value)) {
      setMessage("Informe um valor numérico no ajuste.");
      return;
    }
    setAjusteBusyId(saleId);
    setMessage("");
    const { error } = await supabase.rpc("update_sale_ajuste", {
      p_sale_id: saleId,
      p_ajuste_valor: value,
    });
    setAjusteBusyId(null);
    if (error) {
      setMessage(
        error.message.includes("update_sale_ajuste")
          ? "Rode a migration 036 no Supabase para salvar o ajuste pós-venda."
          : error.message
      );
      return;
    }
    setMessage("Ajuste de frete real salvo — lucro atualizado.");
    load();
  }

  async function cancelSale(saleId: string) {
    if (!confirm("Cancelar esta venda e devolver estoque?")) return;
    setMessage("");
    const { error } = await supabase.rpc("cancel_sale", {
      p_sale_id: saleId,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Venda cancelada.");
    setExpandedId(null);
    load();
  }

  const activeSales = sales.filter((s) => !s.cancelled_at);
  const cancelledSales = sales.filter((s) => s.cancelled_at);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Vendas
      </h1>
      {message && (
        <p className="mb-4 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-gray-700">
          {message}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Registrar venda manual">
          <form onSubmit={registerSale} className="space-y-3">
            <div>
              <AdminInput
                label="CPF cliente"
                value={form.customer_cpf}
                onChange={(e) => onCpfChange(e.target.value)}
                onBlur={(e) => lookupCustomerByCpf(e.target.value)}
              />
              {lookingUp && (
                <p className="mt-1 text-xs text-gray-400">Buscando cliente…</p>
              )}
              {!lookingUp && cpfHint && (
                <p className="mt-1 text-xs text-gray-500">{cpfHint}</p>
              )}
            </div>
            <AdminInput
              label="Nome cliente"
              value={form.customer_name}
              onChange={(e) => {
                nameFromLookup.current = false;
                setForm({ ...form, customer_name: e.target.value });
              }}
            />
            <AdminInput
              label="WhatsApp do cliente"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Com DDD — obrigatório para PIX"
            />
            <AdminInput
              label="E-mail do cliente (PIX)"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="Opcional — se vazio, usamos e-mail técnico"
            />

            <div>
              <label className="text-sm font-medium">Produto</label>
              <select
                value={form.product_id}
                onChange={(e) => onProductChange(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                required
              >
                <option value="">Selecione</option>
                {products.map((p) => {
                  const total = SIZES.reduce(
                    (s, sz) => s + (p.sizes[sz] || 0),
                    0
                  );
                  return (
                    <option key={p.id} value={p.id} disabled={total === 0}>
                      {p.name}
                      {total === 0 ? " (esgotado)" : ` · est. ${total}`}
                    </option>
                  );
                })}
              </select>
            </div>

            {form.product_id && (
              <>
                {outOfStock ? (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                    Produto esgotado — não é possível selecionar tamanho nem
                    quantidade.
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="text-sm font-medium">Tamanho</label>
                      <select
                        value={form.product_size}
                        onChange={(e) => onSizeChange(e.target.value)}
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        required
                      >
                        <option value="">Selecione</option>
                        {availableSizes.map(({ size, stock }) => (
                          <option key={size} value={size}>
                            {SIZE_LABELS[size]} — {stock} em estoque
                          </option>
                        ))}
                      </select>
                    </div>
                    <AdminInput
                      label={`Quantidade (máx. ${maxQty})`}
                      type="number"
                      min={1}
                      max={maxQty}
                      value={form.quantity}
                      onChange={(e) => {
                        const q = Number(e.target.value);
                        setForm({
                          ...form,
                          quantity: Math.min(Math.max(1, q), maxQty || 1),
                        });
                        setQuote(null);
                      }}
                      required
                    />
                  </>
                )}
              </>
            )}

            <div className="space-y-2 rounded-xl border border-gray-100 p-3">
              <p className="text-sm font-medium">Entrega</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShippingMethod("delivery");
                    setQuote(null);
                  }}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                    shippingMethod === "delivery"
                      ? "border-[var(--color-primary)] bg-[var(--color-accent)]"
                      : ""
                  }`}
                >
                  Frete no endereço
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShippingMethod("uber");
                    setForm((f) => ({ ...f, sale_freight: 0 }));
                    setQuote({
                      amount: 0,
                      label: "Uber — combinar no WhatsApp",
                      blocked: false,
                      delivery_range: "Combinar pelo WhatsApp",
                      source: "uber",
                    });
                  }}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                    shippingMethod === "uber"
                      ? "border-[var(--color-primary)] bg-[var(--color-accent)]"
                      : ""
                  }`}
                >
                  Uber
                </button>
              </div>

              {shippingMethod === "delivery" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <AdminInput
                    label="CEP"
                    value={address.zip}
                    onChange={(e) =>
                      setAddress({ ...address, zip: e.target.value })
                    }
                  />
                  <div>
                    <label className="text-sm font-medium">UF</label>
                    <select
                      value={address.state}
                      onChange={(e) =>
                        setAddress({ ...address, state: e.target.value })
                      }
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {BRAZILIAN_STATES.map((uf) => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <AdminInput
                      label="Rua"
                      value={address.street}
                      onChange={(e) =>
                        setAddress({ ...address, street: e.target.value })
                      }
                    />
                  </div>
                  <AdminInput
                    label="Número"
                    value={address.number}
                    onChange={(e) =>
                      setAddress({ ...address, number: e.target.value })
                    }
                  />
                  <AdminInput
                    label="Complemento"
                    value={address.complement}
                    onChange={(e) =>
                      setAddress({ ...address, complement: e.target.value })
                    }
                  />
                  <AdminInput
                    label="Bairro"
                    value={address.neighborhood}
                    onChange={(e) =>
                      setAddress({ ...address, neighborhood: e.target.value })
                    }
                  />
                  <AdminInput
                    label="Cidade"
                    value={address.city}
                    onChange={(e) =>
                      setAddress({ ...address, city: e.target.value })
                    }
                  />
                </div>
              )}

              {shippingMethod === "delivery" && (
                <AdminButton
                  type="button"
                  variant="secondary"
                  onClick={quoteShipping}
                  disabled={quoting || !form.product_id}
                >
                  {quoting ? "Cotando…" : "Calcular frete (como no site)"}
                </AdminButton>
              )}

              {quote && (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  {quote.blocked ? (
                    <p className="text-red-600">
                      Região indisponível: {quote.label}
                    </p>
                  ) : (
                    <>
                      <p>{quote.label || "Frete"}</p>
                      {quote.delivery_range && (
                        <p className="text-xs text-gray-500">
                          Prazo: {quote.delivery_range}
                        </p>
                      )}
                      {shippingMethod === "delivery" && (
                        <p className="font-medium">
                          {formatCurrency(quote.amount)}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {shippingMethod === "delivery" && (
                <AdminInput
                  label="Frete cobrado do cliente (R$)"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.sale_freight}
                  onChange={(e) =>
                    setForm({ ...form, sale_freight: Number(e.target.value) })
                  }
                />
              )}
            </div>

            <AdminInput
              label="Cupom (opcional)"
              value={couponCode}
              onChange={(e) => {
                setCouponCode(e.target.value);
                setCoupon(null);
              }}
              placeholder="Código do cupom"
            />
            <div className="flex gap-2">
              <AdminButton
                type="button"
                variant="secondary"
                onClick={applyCoupon}
                disabled={couponBusy || !form.product_id}
              >
                {couponBusy ? "Validando…" : "Aplicar cupom"}
              </AdminButton>
              {coupon?.ok && (
                <AdminButton
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setCoupon(null);
                    setCouponCode("");
                  }}
                >
                  Remover cupom
                </AdminButton>
              )}
            </div>
            {pricing?.promotion_name && (
              <p className="text-xs text-green-700">
                Promoção vigente: {pricing.promotion_name} (−
                {formatCurrency(pricing.desconto_promo)})
              </p>
            )}

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Catálogo</span>
                <span>
                  {formatCurrency(pricing?.preco_catalogo ?? productSubtotal)}
                </span>
              </div>
              {(pricing?.desconto_total || 0) > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Descontos</span>
                  <span>−{formatCurrency(pricing!.desconto_total)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Frete cobrado</span>
                <span>{formatCurrency(freightCharged)}</span>
              </div>
              {(pricing?.frete_absorvido || 0) > 0 && (
                <div className="flex justify-between text-amber-800">
                  <span>Frete na sua conta (est.)</span>
                  <span>−{formatCurrency(pricing!.frete_absorvido)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                <span>Total cliente</span>
                <span>{formatCurrency(precoFinal)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Lucro estimado</span>
                <span>{formatCurrency(lucroEstimado)}</span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Frete grátis/cupom de frete já reduz o lucro. Depois do envio,
                ajuste o valor real no histórico da venda se for diferente.
              </p>
            </div>

            <AdminFormActions>
              <AdminButton
                type="button"
                onClick={generatePix}
                disabled={!canSell || pixBusy}
              >
                {pixBusy ? "Gerando PIX…" : "Gerar PIX"}
              </AdminButton>
              <AdminButton
                type="submit"
                variant="secondary"
                disabled={!canSell}
              >
                Registrar sem PIX
              </AdminButton>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={shareWhatsApp}
                disabled={!form.product_id && !pixResult}
              >
                WhatsApp
              </AdminButton>
            </AdminFormActions>
            <p className="text-xs text-gray-500">
              <strong>Gerar PIX</strong> reserva o estoque e só baixa de verdade
              quando pagar (como no site).{" "}
              <strong>Registrar sem PIX</strong> é para dinheiro/já pago —
              efetiva na hora.
            </p>
          </form>

          {pixResult && (
            <div className="mt-4 space-y-3 rounded-xl border border-[var(--color-primary)]/20 bg-[var(--color-accent)] p-4 text-center">
              <p className="text-sm font-semibold text-[var(--color-primary)]">
                PIX gerado — aguardando pagamento
              </p>
              <p className="text-2xl font-bold text-[var(--color-primary)]">
                {formatCurrency(Number(pixResult.total))}
              </p>
              <p className="text-xs text-gray-500">Válido por cerca de 15 min</p>
              {pixResult.pix_qr_base64 ? (
                <img
                  src={pixResult.pix_qr_base64}
                  alt="QR Code PIX"
                  className="mx-auto h-48 w-48 rounded-lg bg-white p-2"
                />
              ) : pixResult.pix_copy_paste ? (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixResult.pix_copy_paste)}`}
                  alt="QR Code PIX"
                  className="mx-auto h-48 w-48 rounded-lg bg-white p-2"
                />
              ) : null}
              {pixResult.pix_copy_paste && (
                <div className="flex items-center gap-2 rounded-lg bg-white p-3 text-left">
                  <code className="flex-1 break-all text-xs">
                    {pixResult.pix_copy_paste.slice(0, 72)}…
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(pixResult.pix_copy_paste);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="shrink-0 rounded-full p-2 hover:bg-gray-100"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <AdminButton
                  type="button"
                  onClick={syncPixPayment}
                  disabled={syncBusy}
                >
                  {syncBusy ? "Verificando…" : "Já pagou? Atualizar status"}
                </AdminButton>
                <AdminButton
                  type="button"
                  variant="secondary"
                  onClick={shareWhatsApp}
                >
                  Enviar PIX no WhatsApp
                </AdminButton>
                <Link
                  href={`/pedidos/${pixResult.tracking_token}`}
                  target="_blank"
                  className="inline-flex items-center rounded-xl border px-4 py-2 text-sm"
                >
                  Ver pedido
                </Link>
                <AdminButton
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setPixResult(null);
                    setMessage("");
                  }}
                >
                  Nova venda
                </AdminButton>
              </div>
              <p className="text-xs text-gray-500">
                Também aparece em{" "}
                <Link href="/admin/pagamentos" className="underline">
                  Admin → Pagamentos
                </Link>
                .
              </p>
            </div>
          )}
        </AdminCard>

        <AdminCard title={`Histórico (${activeSales.length})`}>
          {activeSales.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma venda ainda.</p>
          ) : (
            <ul className="max-h-[640px] space-y-2 overflow-y-auto text-sm">
              {activeSales.map((s) => {
                const open = expandedId === String(s.id);
                const gifts = Array.isArray(s.sale_gifts) ? s.sale_gifts : [];
                const created = s.created_at
                  ? new Date(String(s.created_at)).toLocaleString("pt-BR")
                  : "";
                return (
                  <li key={String(s.id)} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {String(s.product_name)}
                        </p>
                        <p className="text-gray-400">
                          {formatCurrency(Number(s.preco_final))} · Tam.{" "}
                          {sizeDisplayLabel(String(s.product_size))}
                          {s.customer_name
                            ? ` · ${String(s.customer_name)}`
                            : ""}
                        </p>
                        {created && (
                          <p className="text-xs text-gray-400">{created}</p>
                        )}
                      </div>
                      <AdminButton
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          setExpandedId(open ? null : String(s.id))
                        }
                      >
                        {open ? (
                          <>
                            Ocultar <ChevronUp className="h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Detalhes <ChevronDown className="h-4 w-4" />
                          </>
                        )}
                      </AdminButton>
                    </div>

                    {open && (
                      <div className="mt-3 space-y-2 border-t pt-3 text-sm text-gray-600">
                        <div className="grid gap-1 sm:grid-cols-2">
                          {s.customer_cpf ? (
                            <p>
                              <span className="text-gray-400">CPF:</span>{" "}
                              {formatCpf(String(s.customer_cpf))}
                            </p>
                          ) : null}
                          {s.customer_phone ? (
                            <p>
                              <span className="text-gray-400">Tel:</span>{" "}
                              {String(s.customer_phone)}
                            </p>
                          ) : null}
                          <p>
                            <span className="text-gray-400">Qtd:</span>{" "}
                            {Number(s.quantity) || 1}
                          </p>
                          <p>
                            <span className="text-gray-400">Catálogo:</span>{" "}
                            {formatCurrency(Number(s.preco_catalogo) || 0)}
                          </p>
                          {Number(s.desconto) > 0 && (
                            <p>
                              <span className="text-gray-400">Desconto:</span>{" "}
                              {formatCurrency(Number(s.desconto))}
                            </p>
                          )}
                          {Number(s.sale_freight) > 0 && (
                            <p>
                              <span className="text-gray-400">Frete:</span>{" "}
                              {formatCurrency(Number(s.sale_freight))}
                            </p>
                          )}
                          {Number(s.ajuste_valor) !== 0 && (
                            <p>
                              <span className="text-gray-400">
                                Frete na conta da loja:
                              </span>{" "}
                              {formatCurrency(Number(s.ajuste_valor))}
                            </p>
                          )}
                          <p>
                            <span className="text-gray-400">Lucro:</span>{" "}
                            {formatCurrency(Number(s.lucro) || 0)}
                          </p>
                          {(Number(s.custo_peca) > 0 ||
                            Number(s.custo_brindes) > 0) && (
                            <p>
                              <span className="text-gray-400">Custo:</span>{" "}
                              {formatCurrency(
                                Number(s.custo_peca || 0) +
                                  Number(s.custo_brindes || 0)
                              )}
                            </p>
                          )}
                          {s.promotion_name ? (
                            <p>
                              <span className="text-gray-400">Promo:</span>{" "}
                              {String(s.promotion_name)}
                            </p>
                          ) : null}
                          {s.order_id ? (
                            <p className="sm:col-span-2">
                              <span className="text-gray-400">
                                Pedido online:
                              </span>{" "}
                              #{String(s.order_id).slice(0, 8)}
                            </p>
                          ) : null}
                          {s.payment_id ? (
                            <p className="sm:col-span-2">
                              <span className="text-gray-400">Pagamento:</span>{" "}
                              #{String(s.payment_id).slice(0, 8)}
                            </p>
                          ) : null}
                          {s.notes ? (
                            <p className="sm:col-span-2 whitespace-pre-wrap">
                              <span className="text-gray-400">Obs:</span>{" "}
                              {String(s.notes)}
                            </p>
                          ) : null}
                        </div>

                        {gifts.length > 0 && (
                          <div className="rounded-xl bg-purple-50 p-3">
                            <p className="mb-1 text-xs font-semibold uppercase text-[#A855F7]">
                              Brindes
                            </p>
                            <ul className="space-y-1">
                              {gifts.map((g, i) => (
                                <li key={String(g.id || i)}>
                                  {String(g.gift_name || "Brinde")} ×
                                  {Number(g.quantity) || 1}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="rounded-xl border border-dashed border-gray-200 p-3">
                          <p className="mb-1 text-sm font-medium">
                            Frete real pago pela loja
                          </p>
                          <p className="mb-2 text-xs text-gray-500">
                            Se a cliente ganhou frete grátis (ou parte), o
                            estimado já entrou no lucro. Depois do envio, coloque
                            o valor que você pagou de verdade (substitui o
                            estimado).
                          </p>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[120px] flex-1">
                              <AdminInput
                                label="Valor (R$)"
                                type="number"
                                step="0.01"
                                value={
                                  ajusteDraft[String(s.id)] ??
                                  String(Number(s.ajuste_valor) || 0)
                                }
                                onChange={(e) =>
                                  setAjusteDraft((d) => ({
                                    ...d,
                                    [String(s.id)]: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <AdminButton
                              type="button"
                              variant="secondary"
                              disabled={ajusteBusyId === String(s.id)}
                              onClick={() => saveSaleAjuste(String(s.id))}
                            >
                              {ajusteBusyId === String(s.id)
                                ? "Salvando…"
                                : "Salvar ajuste"}
                            </AdminButton>
                          </div>
                        </div>

                        <AdminButton
                          variant="danger"
                          type="button"
                          onClick={() => cancelSale(String(s.id))}
                        >
                          Cancelar venda
                        </AdminButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {cancelledSales.length > 0 && (
            <div className="mt-6 border-t pt-4">
              <p className="mb-2 text-xs font-semibold uppercase text-gray-400">
                Canceladas ({cancelledSales.length})
              </p>
              <ul className="space-y-1 text-xs text-gray-400">
                {cancelledSales.slice(0, 10).map((s) => (
                  <li key={String(s.id)}>
                    {String(s.product_name)} ·{" "}
                    {formatCurrency(Number(s.preco_final))}
                    {s.cancelled_at
                      ? ` · ${new Date(String(s.cancelled_at)).toLocaleDateString("pt-BR")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
