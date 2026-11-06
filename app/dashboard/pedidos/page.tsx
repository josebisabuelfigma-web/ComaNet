import { requireOrgRole } from "@/lib/auth";
import { isModuleEnabled, requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { OrderCard } from "@/components/pedidos/order-card";
import type { MenuCategory, MenuComboItem, MenuProduct, Order, OrderItem } from "@/lib/supabase/types";

export default async function PedidosPage() {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.MENU_ONLINE);
  const supabase = await createClient();

  const [{ data: pending }, { data: toCollect }, { data: recent }, { data: org }, kitchenEnabled, { data: categories }, { data: products }, { data: comboItems }, { data: settings }, cajaEnabled] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("channel", "domicilio")
      .eq("status", "pendiente")
      .order("created_at", { ascending: true }),
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("channel", "domicilio")
      .eq("status", "despachado")
      .is("completed_at", null)
      .order("dispatched_at", { ascending: true }),
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("channel", "domicilio")
      .in("status", ["despachado", "pagada", "cancelado"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(30),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
    isModuleEnabled(profile.organization_id, MODULE_KEYS.COCINA),
    supabase
      .from("menu_categories")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("menu_products")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at"),
    supabase.from("menu_combo_items").select("*").eq("organization_id", profile.organization_id),
    supabase
      .from("restaurant_settings")
      .select("delivery_fee")
      .eq("organization_id", profile.organization_id)
      .single(),
    isModuleEnabled(profile.organization_id, MODULE_KEYS.CAJA),
  ]);

  const menu = {
    categories: (categories as MenuCategory[]) ?? [],
    products: (products as MenuProduct[]) ?? [],
    comboItems: (comboItems as MenuComboItem[]) ?? [],
    defaultDeliveryFee: Number(settings?.delivery_fee ?? 0),
  };

  const pendingOrders = (pending as Order[]) ?? [];
  const collectOrders = (toCollect as Order[]) ?? [];
  const recentOrders = (recent as Order[]) ?? [];
  const ids = [...pendingOrders, ...collectOrders, ...recentOrders].map((o) => o.id);

  const { data: items } = ids.length
    ? await supabase.from("order_items").select("*").in("order_id", ids).order("created_at")
    : { data: [] as OrderItem[] };

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of (items as OrderItem[]) ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  const currency = org?.currency ?? "COP";

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh
        organizationId={profile.organization_id}
        tables={["orders", "order_items"]}
      />

      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Pedidos a domicilio</h1>
        <p className="text-sm text-brand-muted">
          Los pedidos llegan aquí al instante. Escríbele al cliente por WhatsApp si hace falta, edita el pedido y envíalo a cocina. Cuando salga, márcalo como enviado: queda por cobrar hasta que caja reciba el dinero.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-brand-ink">Pendientes ({pendingOrders.length})</h2>
        {pendingOrders.length === 0 ? (
          <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white p-8 text-center text-brand-muted">
            No hay pedidos pendientes.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {pendingOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                items={itemsByOrder.get(order.id) ?? []}
                currency={currency}
                kitchenEnabled={kitchenEnabled}
                menu={menu}
              />
            ))}
          </div>
        )}
      </section>

      {collectOrders.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-brand-ink">Enviados, por cobrar ({collectOrders.length})</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {collectOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                items={itemsByOrder.get(order.id) ?? []}
                currency={currency}
                cajaEnabled={cajaEnabled}
              />
            ))}
          </div>
        </section>
      )}

      {recentOrders.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-brand-ink">Historial reciente</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {recentOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                items={itemsByOrder.get(order.id) ?? []}
                currency={currency}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
