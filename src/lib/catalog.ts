import type {
  CartItem,
  Category,
  Customer,
  Gift,
  Product,
  Promotion,
  StoreBanner,
  StoreSettings,
} from "@/types";
import { DEFAULT_SETTINGS, mergeBrandSettings } from "@/lib/branding";
import { mergeSizes } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";

export async function fetchStoreSettings(): Promise<StoreSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_settings")
    .select("*")
    .limit(1)
    .single();
  return mergeBrandSettings(data || DEFAULT_SETTINGS);
}

export async function fetchCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  return data || [];
}

export async function fetchProductsPage(params: {
  categoryId?: string;
  page?: number;
  perPage?: number;
}): Promise<{ products: Product[]; total: number }> {
  const supabase = await createClient();
  const page = Math.max(1, params.page || 1);
  const perPage = Math.max(1, params.perPage || 20);
  const start = (page - 1) * perPage;
  const end = start + perPage - 1;

  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (params.categoryId) {
    query = query.eq("category_id", params.categoryId);
  }

  const { data, count } = await query.range(start, end);
  const products = await attachSizes(data || []);
  return { products, total: count || products.length };
}

export async function fetchProduct(id: string): Promise<Product | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
  if (!data) return null;
  const [product] = await attachSizes([data]);
  return product;
}

async function attachSizes(products: Product[]): Promise<Product[]> {
  if (!products.length) return [];
  const supabase = await createClient();
  const ids = products.map((p) => p.id);
  const { data: rows } = await supabase
    .from("product_sizes")
    .select("product_id, size, stock")
    .in("product_id", ids);

  const grouped: Record<string, { size: string; stock: number }[]> = {};
  for (const row of rows || []) {
    const pid = String(row.product_id);
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push({ size: row.size, stock: row.stock });
  }

  return products.map((product) => ({
    ...product,
    sizes: grouped[product.id]
      ? mergeSizes(grouped[product.id] as never)
      : mergeSizes(null),
  }));
}

export async function fetchActivePromotions(): Promise<Promotion[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("promotions")
    .select("*")
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`);
  return data || [];
}

export async function fetchStoreBanners(): Promise<StoreBanner[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_banners")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  return data || [];
}

export async function fetchProductGifts(productId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_gifts")
    .select("*, gifts(*)")
    .eq("product_id", productId);
  return (data || []).map((row) => ({
    ...row,
    gift_data: row.gifts,
  }));
}

export async function lookupCustomerByPhone(
  phone: string
): Promise<Customer | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("lookup_customer_by_phone", {
    p_phone: phone,
  });
  if (Array.isArray(data)) return (data[0] as Customer) || null;
  return (data as Customer) || null;
}

export async function saveCustomerProfile(
  payload: Record<string, unknown>
): Promise<Customer> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_customer_profile", payload);
  if (error) throw new Error(error.message);
  if (Array.isArray(data)) return data[0] as Customer;
  return data as Customer;
}

export async function listCustomerOrders(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_orders_by_customer", {
    p_customer_id: customerId,
    p_limit: 30,
  });
  if (error) return { orders: [], error: error.message };
  return { orders: (data as unknown[]) || [], error: null };
}

export async function getOrderByTracking(token: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_order_by_tracking", {
    p_token: token,
  });
  return data as Record<string, unknown> | null;
}

// Admin helpers
export async function fetchAllProductsAdmin(): Promise<Product[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });
  return attachSizes(data || []);
}

export async function fetchAllGiftsAdmin(): Promise<Gift[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gifts")
    .select("*")
    .order("name");
  return data || [];
}

export async function fetchAllPromotionsAdmin(): Promise<Promotion[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotions")
    .select("*")
    .order("created_at", { ascending: false });
  return data || [];
}

export async function fetchShippingZonesAdmin() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipping_zones")
    .select("*")
    .order("priority", { ascending: false });
  return data || [];
}

export type { CartItem };
