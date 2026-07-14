"use client";

import { cn } from "@/lib/utils";

export function AdminCard({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5", className)}>
      {title && (
        <h2 className="mb-4 text-lg font-semibold text-[var(--color-primary)]">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

export function AdminInput({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        {...props}
        className={cn(
          "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm",
          props.className
        )}
      />
    </div>
  );
}

export function AdminButton({
  children,
  variant = "primary",
  fullWidth = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  fullWidth?: boolean;
}) {
  const variants = {
    primary:
      "bg-[var(--color-primary)] text-white hover:opacity-90 shadow-sm",
    secondary:
      "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        fullWidth && "w-full",
        variants[variant],
        props.className
      )}
    >
      {children}
    </button>
  );
}

/** Área de ação no rodapé do formulário (botão de submit alinhado). */
export function AdminFormActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4",
        className
      )}
    >
      {children}
    </div>
  );
}
