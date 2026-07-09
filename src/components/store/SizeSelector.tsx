"use client";

import type { ProductSize } from "@/types";
import { SIZES, SIZE_LABELS, stockForSize } from "@/lib/sizes";
import { cn } from "@/lib/utils";
import type { SizeStock } from "@/types";

interface SizeSelectorProps {
  sizes: SizeStock[];
  selected: ProductSize;
  onChange: (size: ProductSize) => void;
}

export function SizeSelector({ sizes, selected, onChange }: SizeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {SIZES.map((size) => {
        const stock = stockForSize(sizes, size);
        const disabled = stock <= 0;
        return (
          <button
            key={size}
            type="button"
            disabled={disabled}
            onClick={() => onChange(size)}
            className={cn(
              "min-w-[3rem] rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              selected === size
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-[var(--color-primary)]",
              disabled && "cursor-not-allowed opacity-40"
            )}
          >
            {SIZE_LABELS[size]}
            {stock > 0 && stock <= 3 && (
              <span className="ml-1 text-[10px] opacity-70">({stock})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
