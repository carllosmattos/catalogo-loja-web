import Link from "next/link";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";

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

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen bg-gray-50">
      {user && (
        <aside className="hidden w-56 shrink-0 border-r bg-white md:block">
          <div className="p-4">
            <Link href="/admin" className="text-lg font-bold text-[var(--color-primary)]">
              Admin
            </Link>
          </div>
          <nav className="space-y-0.5 px-2">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
            <Link
              href="/"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400"
            >
              ← Loja
            </Link>
          </nav>
        </aside>
      )}
      <div className="flex-1">
        {user && (
          <header className="flex items-center justify-between border-b bg-white px-4 py-3 md:hidden">
            <span className="font-semibold text-[var(--color-primary)]">Admin</span>
            <form action="/admin/logout" method="post">
              <button type="submit" className="text-gray-400">
                <LogOut className="h-5 w-5" />
              </button>
            </form>
          </header>
        )}
        <div className="p-4 md:p-8">{children}</div>
      </div>
    </div>
  );
}
