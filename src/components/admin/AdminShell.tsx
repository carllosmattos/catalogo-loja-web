"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Package,
  Tag,
  Gift,
  Store,
  TrendingUp,
  ShoppingCart,
  CreditCard,
  Truck,
  Ticket,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/produtos", label: "Produtos", icon: Package },
  { href: "/admin/promocoes", label: "Promoções", icon: Tag },
  { href: "/admin/brindes", label: "Brindes", icon: Gift },
  { href: "/admin/cupons", label: "Cupons", icon: Ticket },
  { href: "/admin/loja", label: "Loja", icon: Store },
  { href: "/admin/lucro", label: "Lucro", icon: TrendingUp },
  { href: "/admin/vendas", label: "Vendas", icon: ShoppingCart },
  { href: "/admin/pagamentos", label: "Pagamentos", icon: CreditCard },
  { href: "/admin/frete", label: "Frete", icon: Truck },
];

function NavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <nav className={cn("space-y-0.5", className)}>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
              active
                ? "bg-[var(--color-accent)] font-medium text-[var(--color-primary)]"
                : "text-gray-600 hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function LogoutButton({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <form action="/admin/logout" method="post">
      <button
        type="submit"
        className={cn(
          "flex items-center gap-2 rounded-lg text-sm text-gray-600 hover:bg-red-50 hover:text-red-600",
          iconOnly ? "p-2" : "px-3 py-2",
          className
        )}
        aria-label="Sair"
        title="Sair"
      >
        <LogOut className="h-5 w-5 shrink-0" />
        {!iconOnly && <span>Sair</span>}
      </button>
    </form>
  );
}

export function AdminShell({
  logoUrl,
  storeName,
  children,
}: {
  logoUrl: string;
  storeName: string;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-white md:flex">
        <div className="border-b p-5">
          <Link href="/admin" className="flex items-center justify-center">
            <img
              src={logoUrl}
              alt={storeName}
              className="h-20 w-auto max-w-full object-contain"
            />
          </Link>
        </div>
        <div className="flex flex-1 flex-col px-2 py-3">
          <NavLinks className="flex-1" />
          <div className="mt-auto border-t pt-2">
            <LogoutButton className="w-full" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header: logo + sair à esquerda, menu à direita */}
        <header className="flex items-center justify-between gap-2 border-b bg-white px-3 py-2.5 md:hidden">
          <div className="flex min-w-0 items-center gap-1">
            <LogoutButton iconOnly className="shrink-0" />
            <Link href="/admin" className="min-w-0 shrink">
              <img
                src={logoUrl}
                alt={storeName}
                className="h-11 w-auto max-w-[150px] object-contain"
              />
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="shrink-0 rounded-lg p-2 text-gray-700 hover:bg-gray-100"
            aria-label="Abrir menu"
          >
            <Menu className="h-6 w-6" />
          </button>
        </header>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="Fechar menu"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-0 flex h-full w-[min(100%,280px)] flex-col bg-white shadow-xl">
              <div className="flex items-center justify-between border-b px-3 py-3">
                <p className="text-sm font-semibold text-[var(--color-primary)]">
                  Menu
                </p>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-3">
                <NavLinks onNavigate={() => setMenuOpen(false)} />
              </div>
              <div className="border-t px-2 py-2">
                <LogoutButton className="w-full" />
              </div>
            </div>
          </div>
        )}

        <div className="p-4 md:p-8">{children}</div>
      </div>
    </div>
  );
}
