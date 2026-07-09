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
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const variants = {
    primary: "bg-[var(--color-primary)] text-white",
    secondary: "border border-gray-300 text-gray-700",
    danger: "bg-red-600 text-white",
  };
  return (
    <button
      {...props}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50",
        variants[variant],
        props.className
      )}
    />
  );
}
