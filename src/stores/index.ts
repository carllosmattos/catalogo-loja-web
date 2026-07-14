import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CartItem,
  CouponValidation,
  Customer,
  ProductSize,
  ShippingMethod,
} from "@/types";

interface CartState {
  items: CartItem[];
  shippingMethod: ShippingMethod;
  couponCode: string;
  coupon: CouponValidation | null;
  addItem: (item: Omit<CartItem, "quantity"> & { quantity?: number }) => void;
  updateQuantity: (productId: string, size: ProductSize, quantity: number) => void;
  removeItem: (productId: string, size: ProductSize) => void;
  setShippingMethod: (method: ShippingMethod) => void;
  setCoupon: (code: string, coupon: CouponValidation | null) => void;
  clearCoupon: () => void;
  clear: () => void;
  totalItems: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      shippingMethod: "delivery",
      couponCode: "",
      coupon: null,
      addItem: (item) => {
        const qty = item.quantity || 1;
        const existing = get().items.find(
          (i) => i.product_id === item.product_id && i.size === item.size
        );
        if (existing) {
          set({
            items: get().items.map((i) =>
              i.product_id === item.product_id && i.size === item.size
                ? { ...i, quantity: i.quantity + qty }
                : i
            ),
          });
        } else {
          set({ items: [...get().items, { ...item, quantity: qty }] });
        }
      },
      updateQuantity: (productId, size, quantity) => {
        if (quantity <= 0) {
          set({
            items: get().items.filter(
              (i) => !(i.product_id === productId && i.size === size)
            ),
          });
        } else {
          set({
            items: get().items.map((i) =>
              i.product_id === productId && i.size === size
                ? { ...i, quantity }
                : i
            ),
          });
        }
      },
      removeItem: (productId, size) => {
        set({
          items: get().items.filter(
            (i) => !(i.product_id === productId && i.size === size)
          ),
        });
      },
      setShippingMethod: (method) => set({ shippingMethod: method }),
      setCoupon: (code, coupon) => set({ couponCode: code, coupon }),
      clearCoupon: () => set({ couponCode: "", coupon: null }),
      clear: () =>
        set({
          items: [],
          shippingMethod: "delivery",
          couponCode: "",
          coupon: null,
        }),
      totalItems: () => get().items.reduce((s, i) => s + i.quantity, 0),
    }),
    { name: "catalog-cart" }
  )
);

interface CustomerState {
  customer: Customer | null;
  setCustomer: (customer: Customer | null) => void;
}

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set) => ({
      customer: null,
      setCustomer: (customer) => set({ customer }),
    }),
    { name: "catalog-customer" }
  )
);
