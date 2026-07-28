"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const ADMIN_PAGE_SIZE = 20;

/** Monta lista de páginas com reticências (ex.: 1 … 4 5 6 … 20). */
export function buildPageItems(
  current: number,
  totalPages: number
): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let p = current - 1; p <= current + 1; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("ellipsis");
    out.push(sorted[i]);
  }
  return out;
}

export function AdminPagination({
  page,
  totalPages,
  totalItems,
  pageSize = ADMIN_PAGE_SIZE,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalItems <= 0 || totalPages <= 1) {
    if (totalItems > 0) {
      return (
        <p className={cn("mt-3 text-center text-xs text-gray-400", className)}>
          {totalItems} {totalItems === 1 ? "item" : "itens"}
        </p>
      );
    }
    return null;
  }

  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, totalItems);
  const items = buildPageItems(safePage, totalPages);

  return (
    <div
      className={cn(
        "mt-4 flex flex-col items-stretch gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <p className="text-center text-xs text-gray-500 sm:text-left">
        {from}–{to} de {totalItems}
      </p>

      {/* Mobile: compacto */}
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </button>
        <span className="text-sm tabular-nums text-gray-600">
          {safePage}/{totalPages}
        </span>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-40"
        >
          Próxima
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Desktop: números */}
      <div className="hidden items-center gap-1 sm:flex">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {items.map((item, idx) =>
          item === "ellipsis" ? (
            <span
              key={`e-${idx}`}
              className="px-1.5 text-sm text-gray-400"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              className={cn(
                "inline-flex h-9 min-w-9 items-center justify-center rounded-xl px-2.5 text-sm font-medium tabular-nums",
                item === safePage
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              )}
              aria-current={item === safePage ? "page" : undefined}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Barra de filtros de lista (data + status). */
export function AdminListFilters({
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
  status,
  onStatus,
  statusOptions,
  children,
  className,
}: {
  dateFrom?: string;
  dateTo?: string;
  onDateFrom?: (v: string) => void;
  onDateTo?: (v: string) => void;
  status?: string;
  onStatus?: (v: string) => void;
  statusOptions?: Array<{ value: string; label: string }>;
  children?: ReactNode;
  className?: string;
}) {
  const showDates = onDateFrom != null && onDateTo != null;
  const showStatus = onStatus != null && statusOptions && statusOptions.length > 0;

  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50/80 p-3 sm:flex-row sm:flex-wrap sm:items-end",
        className
      )}
    >
      {showDates && (
        <>
          <div className="min-w-0 flex-1 sm:max-w-[160px]">
            <label className="text-xs font-medium text-gray-500">De</label>
            <input
              type="date"
              value={dateFrom || ""}
              onChange={(e) => onDateFrom!(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div className="min-w-0 flex-1 sm:max-w-[160px]">
            <label className="text-xs font-medium text-gray-500">Até</label>
            <input
              type="date"
              value={dateTo || ""}
              onChange={(e) => onDateTo!(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            />
          </div>
        </>
      )}
      {showStatus && (
        <div className="min-w-0 flex-1 sm:max-w-[200px]">
          <label className="text-xs font-medium text-gray-500">Status</label>
          <select
            value={status || ""}
            onChange={(e) => onStatus!(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            {statusOptions!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {children}
    </div>
  );
}

/** Início/fim do dia em ISO (local → UTC aproximado via Date). */
export function dayStartIso(dateYmd: string): string | null {
  if (!dateYmd) return null;
  const d = new Date(`${dateYmd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function dayEndIso(dateYmd: string): string | null {
  if (!dateYmd) return null;
  const d = new Date(`${dateYmd}T23:59:59.999`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
