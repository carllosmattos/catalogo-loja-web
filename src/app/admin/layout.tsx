import { createClient } from "@/lib/supabase/server";
import { fetchStoreSettings } from "@/lib/catalog";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const settings = user ? await fetchStoreSettings() : null;
  const logoUrl = settings?.logo_url || "/logo-lm.png";
  const storeName = settings?.store_name || "Admin";

  if (!user) {
    // fixed inset-0 cobre o body (bg-white) e elimina a “borda” branca no login
    return (
      <div className="fixed inset-0 overflow-y-auto bg-[var(--color-accent)]">
        {children}
      </div>
    );
  }

  return (
    <AdminShell logoUrl={logoUrl} storeName={storeName}>
      {children}
    </AdminShell>
  );
}
