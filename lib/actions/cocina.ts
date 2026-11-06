"use server";

import { revalidatePath } from "next/cache";

import { requireOrgRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";

type ActionResult = { error?: string } | void;

// La cocina es informativa: marcar "listo" no despacha ni cobra nada.
async function cocinaContext() {
  const profile = await requireOrgRole("owner", "cocina");
  await requireModule(profile.organization_id, MODULE_KEYS.COCINA);
  return profile;
}

export async function setItemReady(itemId: string, ready: boolean): Promise<ActionResult> {
  const profile = await cocinaContext();
  const supabase = await createClient();

  const { data: line } = await supabase
    .from("order_items")
    .select("product_name, quantity, order_id")
    .eq("id", itemId)
    .maybeSingle();

  const { error } = await supabase.rpc("set_item_kitchen_status", {
    p_item_id: itemId,
    p_ready: ready,
  });
  if (error) return { error: friendlyDbError(error, "setItemReady", "No se pudo actualizar el producto") };

  await logActivity(
    profile,
    ready ? "Despachó producto en cocina" : "Reabrió producto en cocina",
    line ? `${line.quantity} × ${line.product_name}` : undefined
  );

  revalidatePath("/dashboard/cocina");
}

export async function setOrderReady(orderId: string, ready: boolean): Promise<ActionResult> {
  const profile = await cocinaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_order_kitchen_status", {
    p_order_id: orderId,
    p_ready: ready,
  });
  if (error) return { error: friendlyDbError(error, "setOrderReady", "No se pudo actualizar el pedido") };

  const { data: order } = await supabase.from("orders").select("order_number").eq("id", orderId).maybeSingle();
  await logActivity(
    profile,
    ready ? "Despachó pedido completo en cocina" : "Reabrió pedido en cocina",
    order ? `#${order.order_number}` : undefined
  );

  revalidatePath("/dashboard/cocina");
}

/** Cocina confirma que vio los cambios de un pedido. */
export async function ackKitchenChanges(orderId: string): Promise<ActionResult> {
  const profile = await cocinaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("ack_kitchen_changes", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "ackKitchenChanges", "No se pudo marcar como visto") };

  const { data: order } = await supabase.from("orders").select("order_number").eq("id", orderId).maybeSingle();
  await logActivity(profile, "Vio cambios en cocina", order ? `#${order.order_number}` : undefined);

  revalidatePath("/dashboard/cocina");
}
