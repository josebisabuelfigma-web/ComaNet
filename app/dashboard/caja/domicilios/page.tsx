import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { CollectList, type CollectOrder } from "@/components/cobros/collect-list";
import type { Order, OrderItem } from "@/lib/supabase/types";

export default async function DomiciliosPorCobrarPage() {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.CAJA);
  await requireModule(profile.organization_id, MODULE_KEYS.MENU_ONLINE);
  const supabase = await createClient();

  const [{ data: orders }, { data: session }, { data: org }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("channel", "domicilio")
      .eq("status", "despachado")
      .is("completed_at", null)
      .order("dispatched_at"),
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

  const rows: CollectOrder[] = list.map((order) => ({
    id: order.id,
    number: order.order_number,
    title: order.customer_name ?? `Pedido #${order.order_number}`,
    detail: order.fulfillment === "recoger" ? "Recoge en el local" : order.address,
    since: order.dispatched_at,
    total: Number(order.total),
    method: order.payment_method,
    lines: ((items as OrderItem[]) ?? [])
      .filter((i) => i.order_id === order.id)
      .map((i) => `${i.quantity} × ${i.product_name}`),
  }));

  return (
    <>
      <RealtimeRefresh organizationId={profile.organization_id} tables={["orders"]} />
      <CollectList
        kind="domicilio"
        heading="Domicilios por cobrar"
        description="Pedidos enviados. Cuando el domiciliario entregue el dinero o verifiques la transferencia, cóbralo y el pedido quedará cerrado."
        emptyText="No hay domicilios por cobrar."
        orders={rows}
        currency={org?.currency ?? "COP"}
        cashOpen={!!session}
      />
    </>
  );
}
