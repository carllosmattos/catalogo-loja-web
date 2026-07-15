import { fetchStoreSettings } from "@/lib/catalog";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export default async function AdminLoginPage() {
  const settings = await fetchStoreSettings();
  return (
    <AdminLoginForm
      logoUrl={settings.logo_url || "/logo-lm.png"}
      storeName={settings.store_name}
    />
  );
}
