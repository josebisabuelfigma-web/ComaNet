import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { dayRangeToTimestamps, todayInColombia } from "@/lib/format";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { KitchenBoard, type KitchenHistoryRow, type KitchenOrder } from "@/components/cocina/kitchen-board";
import type { KitchenChange, Order, OrderItem, RestaurantTable } from "@/lib/supabase/types";

export default async function CocinaPage() {
  const profile = await requireOrgRole("owner", "cajero", "cocina");
  await requireModule(profile.organization_id, MODULE_KEYS.COCINA);
  const supabase = await createClient();
  const today = todayInColombia();
  const { from: todayStart } = dayRangeToTimestamps(today, today);

  const [{ data: orders }, { data: tables }, { data: finished }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .in("status", ["pendiente", "abierta"])
      .not("kitchen_sent_at", "is", null)
      .order("kitchen_sent_at", { ascending: true }),
    supabase.from("restaurant_tables").select("*").eq("organization_id", profile.organization_id),
    // Tiempos de hoy: pedidos que cocina terminó (aunque ya estén despachados o cobrados).
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .neq("status", "cancelado")
      .gte("kitchen_done_at", todayStart)
      .order("kitchen_done_at", { ascending: false })
      .limit(100),
  ]);

  const list = (orders as Order[]) ?? [];
  const [{ data: items }, { data: changes }] = list.length
    ? await Promise.all([
        supabase
          .from("order_items")
          .select("*")
          .in("order_id", list.map((o) => o.id))
          .not("sent_to_kitchen_at", "is", null)
          .order("sent_to_kitchen_at")
          .order("created_at"),
        supabase
          .from("kitchen_changes")
          .select("*")
          .in("order_id", list.map((o) => o.id))
          .is("acked_at", null)
          .neq("kind", "envio")
          .order("created_at"),
      ])
    : [{ data: [] as OrderItem[] }, { data: [] as KitchenChange[] }];

  const tableName = new Map(((tables as RestaurantTable[]) ?? []).map((t) => [t.id, t.name]));
  const titleOf = (order: Order) =>
    order.channel === "mesa"
      ? (tableName.get(order.table_id ?? "") ?? "Mesa")
      : order.fulfillment === "recoger"
        ? "Recoger en el local"
        : "Domicilio";

  const board: KitchenOrder[] = list
    .map((order) => ({
      id: order.id,
      number: order.order_number,
      title: titleOf(order),
      sentAt: order.kitchen_sent_at ?? order.created_at,
      doneAt: order.kitchen_done_at,
      customer: order.customer_name,
      notes: order.notes,
      items: ((items as OrderItem[]) ?? []).filter((i) => i.order_id === order.id),
      changes: ((changes as KitchenChange[]) ?? []).filter((c) => c.order_id === order.id),
    }))
    .filter((o) => o.items.length > 0);

  const history: KitchenHistoryRow[] = ((finished as Order[]) ?? [])
    .filter((o) => o.kitchen_sent_at && o.kitchen_done_at)
    .map((o) => ({
      id: o.id,
      number: o.order_number,
      title: titleOf(o),
      sentAt: o.kitchen_sent_at as string,
      doneAt: o.kitchen_done_at as string,
    }));

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh
        organizationId={profile.organization_id}
        tables={["orders", "order_items", "kitchen_changes"]}
        beepOnInsert={["kitchen_changes"]}
      />
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Cocina</h1>
        <p className="text-sm text-brand-muted">
          Aquí llega lo que caja o los meseros envían a cocina. Marcar &quot;despachado&quot; solo avisa al
          equipo: el cajero despacha y cobra aparte.
        </p>
      </div>
      <KitchenBoard orders={board} history={history} />
    </div>
  );
}
