"use server";

import { revalidatePath } from "next/cache";

import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";

type ActionResult = { error?: string } | void;

// La cocina es informativa: marcar "listo" no despacha ni cobra nada.
async function cocinaContext() {
  const profile = await requireOrgRole("owner", "cajero", "cocina");
  await requireModule(profile.organization_id, MODULE_KEYS.COCINA);
  return profile;
}

export async function setItemReady(itemId: string, ready: boolean): Promise<ActionResult> {
  await cocinaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_item_kitchen_status", {
    p_item_id: itemId,
    p_ready: ready,
  });
  if (error) return { error: friendlyDbError(error, "setItemReady", "No se pudo actualizar el producto") };

  revalidatePath("/dashboard/cocina");
}

export async function setOrderReady(orderId: string, ready: boolean): Promise<ActionResult> {
  await cocinaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_order_kitchen_status", {
    p_order_id: orderId,
    p_ready: ready,
  });
  if (error) return { error: friendlyDbError(error, "setOrderReady", "No se pudo actualizar el pedido") };

  revalidatePath("/dashboard/cocina");
}

/** Cocina confirma que vio los cambios de un pedido. */
export async function ackKitchenChanges(orderId: string): Promise<ActionResult> {
  await cocinaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("ack_kitchen_changes", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "ackKitchenChanges", "No se pudo marcar como visto") };

  revalidatePath("/dashboard/cocina");
}
