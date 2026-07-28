"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notifications/NotificationBell";

type NavChild = { href: string, label: string };
type NavItem =
  | { href: string; label: string; icon: typeof Package; children?: undefined }
  | {
      href: string;
      label: string;
      icon: typeof Package;
      children: NavChild[];
    };

const NAV: NavItem[] = [
  {
    href: "/admin/produtos",
    label: "Produtos",
    icon: Package,
    children: [
      { href: "/admin/produtos/cadastro", label: "Cadastro" },
      { href: "/admin/produtos", label: "Lista" },
    ],
  },
  {
    href: "/admin/promocoes",
    label: "Promoções",
    icon: Tag,
    children: [
      { href: "/admin/promocoes/cadastro", label: "Cadastro" },
      { href: "/admin/promocoes", label: "Lista" },
    ],
  },
  {
    href: "/admin/brindes",
    label: "Brindes",
    icon: Gift,
    children: [
      { href: "/admin/brindes/cadastro", label: "Cadastro" },
      { href: "/admin/brindes", label: "Lista" },
    ],
  },
  {
    href: "/admin/cupons",
    label: "Cupons",
    icon: Ticket,
    children: [
      { href: "/admin/cupons/cadastro", label: "Cadastro" },
      { href: "/admin/cupons", label: "Lista" },
    ],
  },
  {
    href: "/admin/loja",
    label: "Loja",
    icon: Store,
    children: [
      { href: "/admin/loja", label: "Identidade" },
      { href: "/admin/loja/banners", label: "Banners" },
    ],
  },
  { href: "/admin/lucro", label: "Lucro", icon: TrendingUp },
  {
    href: "/admin/vendas",
    label: "Vendas",
    icon: ShoppingCart,
    children: [
      { href: "/admin/vendas", label: "Nova venda" },
      { href: "/admin/vendas/historico", label: "Histórico" },
    ],
  },
  { href: "/admin/pagamentos", label: "Pagamentos", icon: CreditCard },
  { href: "/admin/reembolsos", label: "Reembolsos", icon: RotateCcw },
  {
    href: "/admin/frete",
    label: "Frete",
    icon: Truck,
    children: [
      { href: "/admin/frete", label: "Melhor Envio" },
      { href: "/admin/frete/remetente", label: "Remetente" },
      { href: "/admin/frete/regras", label: "Regras" },
    ],
  },
];

function pathMatches(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // Evita /admin/produtos casar com /admin/produtos/cadastro quando href é lista
  if (href === "/admin/produtos" || href === "/admin/promocoes" || href === "/admin/brindes" || href === "/admin/cupons") {
    return pathname === href;
  }
  if (href === "/admin/loja") return pathname === "/admin/loja";
  if (href === "/admin/vendas") return pathname === "/admin/vendas";
  if (href === "/admin/frete") return pathname === "/admin/frete";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupActive(pathname: string, item: NavItem): boolean {
  if (item.children) {
    return item.children.some((c) => pathMatches(pathname, c.href))
      || pathname.startsWith(item.href + "/")
      || pathname === item.href;
  }
  return pathMatches(pathname, item.href);
}

function NavLinks({
  onNavigate,
  className,
  collapsed = false,
}: {
  onNavigate?: () => void;
  className?: string;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const item of NAV) {
      if (item.children && groupActive(pathname, item)) {
        next[item.href] = true;
      }
    }
    setOpenGroups((prev) => ({ ...prev, ...next }));
  }, [pathname]);

  return (
    <nav className={cn("space-y-0.5", className)}>
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = groupActive(pathname, item);
        const open = Boolean(openGroups[item.href]) || active;

        if (!item.children) {
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
                active
                  ? "bg-[var(--color-accent)] font-medium text-[var(--color-primary)]"
                  : "text-gray-600 hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]",
                collapsed && "justify-center px-2"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        }

        if (collapsed) {
          return (
            <Link
              key={item.href}
              href={item.children[0].href}
              onClick={onNavigate}
              title={item.label}
              className={cn(
                "flex justify-center rounded-lg px-2 py-2.5 text-sm",
                active
                  ? "bg-[var(--color-accent)] font-medium text-[var(--color-primary)]"
                  : "text-gray-600 hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        }

        return (
          <div key={item.href}>
            <button
              type="button"
              onClick={() =>
                setOpenGroups((g) => ({ ...g, [item.href]: !open }))
              }
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
                active
                  ? "bg-[var(--color-accent)]/60 font-medium text-[var(--color-primary)]"
                  : "text-gray-600 hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  open && "rotate-180"
                )}
              />
            </button>
            {open && (
              <div className="ml-3 space-y-0.5 border-l border-gray-100 py-0.5 pl-2">
                {item.children.map((child) => {
                  const childActive = pathMatches(pathname, child.href);
                  return (
                    <Link
                      key={child.href + child.label}
                      href={child.href}
                      onClick={onNavigate}
                      className={cn(
                        "block rounded-lg px-3 py-2 text-sm",
                        childActive
                          ? "bg-[var(--color-accent)] font-medium text-[var(--color-primary)]"
                          : "text-gray-500 hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]"
                      )}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
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

const SIDEBAR_KEY = "admin-sidebar-collapsed";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-gray-50">
      {/* Desktop sidebar — altura total, sem scroll da página */}
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col border-r bg-white transition-[width] duration-200 md:flex",
          sidebarCollapsed ? "w-[68px]" : "w-60"
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 border-b p-3",
            sidebarCollapsed ? "flex-col" : "justify-between"
          )}
        >
          {!sidebarCollapsed && (
            <Link href="/admin" className="flex min-w-0 flex-1 justify-center">
              <img
                src={logoUrl}
                alt={storeName}
                className="h-16 w-auto max-w-full object-contain"
              />
            </Link>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label={sidebarCollapsed ? "Abrir menu" : "Fechar menu"}
            title={sidebarCollapsed ? "Abrir menu" : "Fechar menu"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
          {sidebarCollapsed && (
            <Link href="/admin" className="mt-1">
              <img
                src={logoUrl}
                alt={storeName}
                className="h-9 w-9 object-contain"
              />
            </Link>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NavLinks collapsed={sidebarCollapsed} />
          </div>
          <div className="mt-2 shrink-0 border-t pt-2">
            {!sidebarCollapsed && (
              <div className="mb-1 flex justify-center px-2">
                <NotificationBell mode="admin" />
              </div>
            )}
            {sidebarCollapsed && (
              <div className="mb-1 flex justify-center">
                <NotificationBell mode="admin" />
              </div>
            )}
            <LogoutButton
              className={cn("w-full", sidebarCollapsed && "justify-center")}
              iconOnly={sidebarCollapsed}
            />
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Desktop top bar with toggle when needed + mobile header */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-white px-3 py-2.5 md:hidden">
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
          <div className="flex shrink-0 items-center gap-0.5">
            <NotificationBell mode="admin" />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="shrink-0 rounded-lg p-2 text-gray-700 hover:bg-gray-100"
              aria-label="Abrir menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </header>

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
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
                <NavLinks onNavigate={() => setMenuOpen(false)} />
              </div>
              <div className="shrink-0 border-t px-2 py-2">
                <LogoutButton className="w-full" />
              </div>
            </div>
          </div>
        )}

        {/* Só o conteúdo da página rola */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
