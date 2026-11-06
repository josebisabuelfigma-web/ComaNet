import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { CollectList, type CollectOrder } from "@/components/cobros/collect-list";
import type { Order, OrderItem, RestaurantTable } from "@/lib/supabase/types";

export default async function MesasPorCobrarPage() {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.CAJA);
  await requireModule(profile.organization_id, MODULE_KEYS.MESAS);
  const supabase = await createClient();

  const [{ data: orders }, { data: tables }, { data: session }, { data: org }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("channel", "mesa")
      .eq("status", "abierta")
      .not("payment_requested_at", "is", null)
      .order("payment_requested_at"),
    supabase.from("restaurant_tables").select("*").eq("organization_id", profile.organization_id),
    supabase
      .from("cash_sessions")
      .select("id")
      .eq("organization_id", profile.organization_id)
      .is("closed_at", null)
      .maybeSingle(),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
  ]);

  const list = (orders as Order[]) ?? [];
  const { data: items } = list.length
    ? await supabase.from("order_items").select("*").in("order_id", list.map((o) => o.id)).order("created_at")
    : { data: [] as OrderItem[] };

  const tableName = new Map(((tables as RestaurantTable[]) ?? []).map((t) => [t.id, t.name]));

  const rows: CollectOrder[] = list.map((order) => {
    const lines = ((items as OrderItem[]) ?? []).filter((i) => i.order_id === order.id);
    return {
      id: order.id,
      number: order.order_number,
      title: tableName.get(order.table_id ?? "") ?? "Mesa",
      detail: null,
      since: order.payment_requested_at,
      // El total de una mesa abierta sale de sus productos, igual que en el cobro.
      total: lines.reduce((sum, i) => sum + Number(i.unit_price) * i.quantity, 0),
      method: order.payment_requested_method,
      lines: lines.map((i) => `${i.quantity} × ${i.product_name}`),
    };
  });

  return (
    <>
      <RealtimeRefresh organizationId={profile.organization_id} tables={["orders", "order_items"]} />
      <CollectList
        kind="mesa"
        heading="Mesas por cobrar"
        description="Mesas con la cuenta entregada. Cuando recibas el dinero o verifiques la transferencia, cóbrala y la mesa quedará libre."
        emptyText="No hay mesas por cobrar."
        orders={rows}
        currency={org?.currency ?? "COP"}
        cashOpen={!!session}
      />
    </>
  );
}
