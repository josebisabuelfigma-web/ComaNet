import Link from "next/link";

import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TablesManager } from "@/components/ajustes/ajustes-forms";
import type { Order, OrderItem, RestaurantTable } from "@/lib/supabase/types";

export default async function MesasPage() {
  const profile = await requireOrgRole("owner", "cajero", "mesero");
  await requireModule(profile.organization_id, MODULE_KEYS.MESAS);
  const supabase = await createClient();

  const [{ data: tables }, { data: open }, { data: org }] = await Promise.all([
    supabase
      .from("restaurant_tables")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("orders")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("channel", "mesa")
      .eq("status", "abierta"),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
  ]);

  const openOrders = (open as Order[]) ?? [];
  const orderByTable = new Map(openOrders.map((o) => [o.table_id, o]));

  const { data: items } = openOrders.length
    ? await supabase.from("order_items").select("*").in("order_id", openOrders.map((o) => o.id))
    : { data: [] as OrderItem[] };

  const totals = new Map<string, { count: number; total: number }>();
  for (const item of (items as OrderItem[]) ?? []) {
    const current = totals.get(item.order_id) ?? { count: 0, total: 0 };
    current.count += item.quantity;
    current.total += Number(item.unit_price) * item.quantity;
    totals.set(item.order_id, current);
  }

  const list = (tables as RestaurantTable[]) ?? [];
  const currency = org?.currency ?? "COP";

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh organizationId={profile.organization_id} tables={["orders", "order_items"]} />

      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Mesas</h1>
        <p className="text-sm text-brand-muted">
          Toca una mesa para tomar el pedido o ver su cuenta.
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white p-10 text-center text-brand-muted">
          Aún no hay mesas.{" "}
          {profile.role === "owner"
            ? "Créalas aquí abajo."
            : "Pídele al administrador que las cree."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((table) => {
            const order = orderByTable.get(table.id);
            const summary = order ? totals.get(order.id) : undefined;
            return (
              <Link key={table.id} href={`/dashboard/mesas/${table.id}`}>
                <Card
                  className={`h-full transition-shadow hover:shadow-md ${order?.payment_requested_at ? "border-brand-danger bg-brand-danger/10" : order ? "border-brand bg-brand/10" : ""}`}
                >
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-brand-ink">{table.name}</p>
                      <Badge variant={order?.payment_requested_at ? "danger" : order ? "default" : "success"}>
                        {order?.payment_requested_at ? "Por cobrar" : order ? "Ocupada" : "Libre"}
                      </Badge>
                    </div>
                    {order?.payment_requested_at && (
                      <p className="text-xs font-medium text-brand-danger">
                        Cuenta entregada · falta cobrar en caja
                      </p>
                    )}
                    {order ? (
                      <p className="text-sm text-brand-muted">
                        {summary?.count ?? 0} productos ·{" "}
                        <span className="font-semibold text-brand-ink">
                          {formatMoney(summary?.total ?? 0, currency)}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-brand-muted">{profile.role === "cajero" ? "Libre" : "Toca para abrir"}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {profile.role === "owner" && <TablesManager tables={list} />}
    </div>
  );
}
