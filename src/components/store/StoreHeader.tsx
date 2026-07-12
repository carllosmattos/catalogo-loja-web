"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, User, Package, Home, Shirt } from "lucide-react";
import { useCartStore } from "@/stores";
import { cn } from "@/lib/utils";
import { STORE_CONTAINER } from "@/lib/store-layout";

interface StoreHeaderProps {
  storeName: string;
  logoUrl?: string | null;
}

const NAV = [
  { href: "/", label: "Início", icon: Home },
  { href: "/catalogo", label: "Catálogo", icon: Shirt },
  { href: "/pedidos", label: "Pedidos", icon: Package },
  { href: "/conta", label: "Conta", icon: User },
];

const DEFAULT_LOGO = "/logo-lm.png";

export function StoreHeader({ storeName, logoUrl }: StoreHeaderProps) {
  const totalItems = useCartStore((s) => s.totalItems());
  const pathname = usePathname();
  const logo = logoUrl || DEFAULT_LOGO;

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-primary)]/10 bg-white/95 backdrop-blur-md">
      <div className={cn(STORE_CONTAINER, "flex h-14 items-center justify-between md:h-16")}>
        <Link href="/" className="flex items-center gap-2 md:gap-3">
          <img
            src={logo}
            alt={storeName}
            className="h-8 w-8 object-contain md:h-10 md:w-10"
          />
          <span className="text-sm font-semibold text-[var(--color-primary)] line-clamp-1 md:text-base">
            {storeName}
          </span>
        </Link>

        {/* Nav desktop — inline no header */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[var(--color-accent)] text-[var(--color-primary)]"
                    : "text-gray-500 hover:bg-gray-50 hover:text-[var(--color-primary)]"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/carrinho"
          className="relative rounded-full p-2 text-[var(--color-primary)] hover:bg-[var(--color-accent)] md:p-2.5"
        >
          <ShoppingBag className="h-5 w-5 md:h-6 md:w-6" />
          {totalItems > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-bold text-white md:h-5 md:w-5 md:text-xs">
              {totalItems}
            </span>
          )}
        </Link>
      </div>

      {/* Nav mobile — barra inferior */}
      <nav className={cn(STORE_CONTAINER, "flex border-t border-[var(--color-primary)]/5 md:hidden")}>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                active ? "text-[var(--color-primary)]" : "text-gray-500"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
