export type ProductSize = "U" | "P" | "M" | "G";

export interface SizeStock {
  size: ProductSize;
  stock: number;
}

export interface StoreSettings {
  id?: string;
  store_name: string;
  whatsapp_number: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string | null;
  default_banner_url: string | null;
  sender_zip?: string;
  sender_street?: string;
  sender_number?: string;
  sender_complement?: string;
  sender_neighborhood?: string;
  sender_city?: string;
  sender_state?: string;
  default_package_weight_kg?: number;
  melhor_envio_enabled?: boolean;
  /** Dias da semana de coleta/envio: 0=Dom … 6=Sáb */
  shipping_dispatch_weekdays?: number[];
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  category_id: string | null;
  image_urls: string[];
  purchase_price: number;
  purchase_freight: number;
  sale_price: number;
  sale_freight: number;
  stock: number;
  active: boolean;
  sizes?: SizeStock[];
  created_at?: string;
}

export interface Gift {
  id: string;
  name: string;
  stock: number;
  purchase_price: number;
  purchase_freight: number;
  sale_markup: number;
  image_url: string | null;
  image_urls: string[];
  active: boolean;
}

export interface Promotion {
  id: string;
  name: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  /** Escopo de produtos: todos ou selecionados */
  applies_to: "all" | "selected";
  /** Onde abate: preço do produto ou frete cotado */
  discount_target?: "product" | "shipping";
  product_ids: string[];
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  banner_url: string | null;
  show_banner: boolean;
  image_urls: string[];
}

export interface StoreBanner {
  id: string;
  image_url: string;
  active: boolean;
  sort_order: number;
}

export interface Coupon {
  id: string;
  code: string;
  title: string;
  image_url: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  discount_target?: "product" | "shipping";
  max_uses: number;
  used_count: number;
  active: boolean;
}

export interface CouponValidation {
  ok: boolean;
  error?: string;
  coupon_id?: string;
  code?: string;
  title?: string;
  discount_type?: "percent" | "fixed";
  discount_value?: number;
  discount_amount?: number;
  discount_target?: "product" | "shipping";
  image_url?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  cpf: string;
  email: string;
  address: string;
  address_zip: string;
  address_street: string;
  address_number: string;
  address_complement: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
  points: number;
  auth_user_id?: string | null;
}

export interface CartItem {
  product_id: string;
  name: string;
  size: ProductSize;
  quantity: number;
  image_url?: string;
  sale_price: number;
  sale_freight: number;
}

export type ShippingMethod = "delivery" | "uber";

export interface ShippingQuote {
  amount: number;
  zone_type: string;
  label: string;
  blocked: boolean;
  source: string;
  /** Prazo em dias úteis (Melhor Envio), quando disponível */
  delivery_days?: number | null;
  /** Texto amigável do prazo, ex: "3 a 5 dias úteis" */
  delivery_range?: string | null;
  company?: string | null;
  service?: string | null;
  dispatch_weekday?: number | null;
  dispatch_wait_days?: number | null;
}

export type PaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "in_process";

export interface OrderItem {
  product_id: string;
  product_name: string;
  product_size: string;
  quantity: number;
  preco_final_line: number;
}

export interface Order {
  id: string;
  status: string;
  total_amount: number;
  shipping_amount: number;
  tracking_token: string;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
  items?: OrderItem[];
  payment?: {
    status: string;
    pix_copy_paste: string;
    qr_code_base64?: string;
    provider_payment_id: string;
    expires_at: string;
  };
}

export interface ShippingZone {
  id?: string;
  zone_type: "free" | "paid" | "blocked";
  scope: "country" | "state" | "city" | "neighborhood";
  country: string;
  state: string;
  city: string;
  neighborhood: string;
  freight_amount: number;
  priority: number;
  label: string;
  active: boolean;
}

export interface ProfitResult {
  product_name: string;
  custo_peca: number;
  custo_brindes: number;
  repasse_brinde: number;
  preco_catalogo: number;
  desconto: number;
  preco_final_cliente: number;
  lucro_bruto: number;
  margem_percent: number;
  promotion_name: string | null;
  stock: number;
  gift_stock_ok: boolean;
}
