import type { ProductSize, SizeStock } from "@/types";

export const SIZES: ProductSize[] = ["U", "P", "M", "G"];

export const SIZE_LABELS: Record<ProductSize, string> = {
  U: "Único",
  P: "P",
  M: "M",
  G: "G",
};

export function normalizeSize(size: string | null | undefined): ProductSize {
  const s = (size || "M").trim().toUpperCase();
  if (["UNICO", "ÚNICO", "UNIQUE", "UN"].includes(s)) return "U";
  return SIZES.includes(s as ProductSize) ? (s as ProductSize) : "M";
}

export function sizeDisplayLabel(size: string | null | undefined): string {
  return SIZE_LABELS[normalizeSize(size)] || String(size || "");
}

export function defaultSizeRows(): SizeStock[] {
  return SIZES.map((size) => ({ size, stock: 0 }));
}

export function mergeSizes(rows: SizeStock[] | null | undefined): SizeStock[] {
  const bySize = Object.fromEntries(
    (rows || [])
      .filter((r) => SIZES.includes(r.size))
      .map((r) => [r.size, Number(r.stock) || 0])
  ) as Record<ProductSize, number>;
  return SIZES.map((size) => ({ size, stock: bySize[size] ?? 0 }));
}

export function totalStock(sizes: SizeStock[] | null | undefined): number {
  return mergeSizes(sizes).reduce((sum, s) => sum + s.stock, 0);
}

export function stockForSize(
  sizes: SizeStock[] | null | undefined,
  size: string
): number {
  const norm = normalizeSize(size);
  return mergeSizes(sizes).find((r) => r.size === norm)?.stock ?? 0;
}
