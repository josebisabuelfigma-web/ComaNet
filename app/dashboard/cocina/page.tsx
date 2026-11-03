import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { KitchenBoard, type KitchenOrder } from "@/components/cocina/kitchen-board";
import type { Order, OrderItem, RestaurantTable } from "@/lib/supabase/types";

export default async function CocinaPage() {
  const profile = await requireOrgRole("owner", "cajero", "cocina");
  await requireModule(profile.organization_id, MODULE_KEYS.COCINA);
  const supabase = await createClient();

  const [{ data: orders }, { data: tables }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .in("status", ["pendiente", "abierta"])
      .order("created_at", { ascending: true }),
    supabase.from("restaurant_tables").select("*").eq("organization_id", profile.organization_id),
  ]);

  const list = (orders as Order[]) ?? [];
  const { data: items } = list.length
    ? await supabase
        .from("order_items")
        .select("*")
        .in("order_id", list.map((o) => o.id))
        .order("created_at")
    : { data: [] as OrderItem[] };

  const tableName = new Map(((tables as RestaurantTable[]) ?? []).map((t) => [t.id, t.name]));

  const board: KitchenOrder[] = list
    .map((order) => ({
      id: order.id,
      number: order.order_number,
      title:
        order.channel === "mesa"
          ? (tableName.get(order.table_id ?? "") ?? "Mesa")
          : order.fulfillment === "recoger"
            ? "Recoger en el local"
            : "Domicilio",
      createdAt: order.created_at,
      customer: order.customer_name,
      notes: order.notes,
      items: ((items as OrderItem[]) ?? []).filter((i) => i.order_id === order.id),
    }))
    .filter((o) => o.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh
        organizationId={profile.organization_id}
        tables={["orders", "order_items"]}
        beepOnInsert={["order_items"]}
      />
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Cocina</h1>
        <p className="text-sm text-brand-muted">
          Pedidos activos de domicilio y mesas. Marcar &quot;listo&quot; solo avisa al equipo: el cajero
          despacha y cobra aparte.
        </p>
      </div>
      <KitchenBoard orders={board} />
    </div>
  );
}
