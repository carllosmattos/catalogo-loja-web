import { fetchStoreSettings, getOrderByTracking } from "@/lib/catalog";
import { OrdersClient } from "@/components/store/OrdersClient";

export default async function PedidosPage() {
  const settings = await fetchStoreSettings();
  return <OrdersClient settings={settings} />;
}
