"use server";

import { revalidatePath } from "next/cache";

import { requireOrgRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";

type ActionResult = { error?: string } | void;

export async function dispatchOrder(orderId: string, orderNumber: number): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.MENU_ONLINE);

  const supabase = await createClient();
  const { error } = await supabase.rpc("dispatch_order", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "dispatchOrder", "No se pudo despachar el pedido") };

  await logActivity(profile, "Despachó pedido", `#${orderNumber}`);
  revalidatePath("/dashboard/pedidos");
}

export async function cancelOrder(orderId: string, orderNumber: number): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "cancelOrder", "No se pudo cancelar el pedido") };

  await logActivity(profile, "Canceló pedido", `#${orderNumber}`);
  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard/mesas");
}
