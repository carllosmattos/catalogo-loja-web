import { fetchStoreSettings, getOrderByTracking } from "@/lib/catalog";
import { OrderDetailClient } from "@/components/store/OrderDetailClient";

export default async function PedidoDetailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [settings, order] = await Promise.all([
    fetchStoreSettings(),
    getOrderByTracking(token),
  ]);
  return (
    <OrderDetailClient
      settings={settings}
      token={token}
      initialOrder={order}
    />
  );
}
