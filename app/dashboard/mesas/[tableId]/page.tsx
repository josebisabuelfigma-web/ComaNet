import { notFound } from "next/navigation";

import { requireOrgRole } from "@/lib/auth";
import { isModuleEnabled, requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { TableOrder } from "@/components/mesas/table-order";
import type {
  MenuCategory,
  MenuComboItem,
  MenuProduct,
  Order,
  OrderItem,
  RestaurantTable,
} from "@/lib/supabase/types";

export default async function MesaDetallePage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  const profile = await requireOrgRole("owner", "cajero", "mesero");
  await requireModule(profile.organization_id, MODULE_KEYS.MESAS);
  const supabase = await createClient();
  const [kitchenEnabled, cajaEnabled] = await Promise.all([
    isModuleEnabled(profile.organization_id, MODULE_KEYS.COCINA),
    isModuleEnabled(profile.organization_id, MODULE_KEYS.CAJA),
  ]);

  const [{ data: table }, { data: order }, { data: categories }, { data: products }, { data: comboItems }, { data: org }] =
    await Promise.all([
      supabase
        .from("restaurant_tables")
        .select("*")
        .eq("id", tableId)
        .eq("organization_id", profile.organization_id)
        .maybeSingle(),
      supabase
        .from("orders")
        .select("*")
        .eq("table_id", tableId)
        .eq("status", "abierta")
        .maybeSingle(),
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
      supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
    ]);

  if (!table) notFound();

  const { data: items } = order
    ? await supabase.from("order_items").select("*").eq("order_id", order.id).order("created_at")
    : { data: [] as OrderItem[] };

  return (
    <>
      <RealtimeRefresh
        organizationId={profile.organization_id}
        tables={["orders", "order_items", "menu_products"]}
      />
      <TableOrder
        table={table as RestaurantTable}
        order={(order as Order | null) ?? null}
        items={(items as OrderItem[]) ?? []}
        categories={(categories as MenuCategory[]) ?? []}
        products={(products as MenuProduct[]) ?? []}
        comboItems={(comboItems as MenuComboItem[]) ?? []}
        currency={org?.currency ?? "COP"}
        canCancel={profile.role === "owner"}
        readOnly={profile.role === "cajero"}
        canClose={profile.role !== "mesero"}
        kitchenEnabled={kitchenEnabled}
        cajaEnabled={cajaEnabled}
      />
    </>
  );
}
