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
  if (error) return { error: friendlyDbError(error, "dispatchOrder", "No se pudo marcar como enviado") };

  await logActivity(profile, "Envió pedido", `#${orderNumber}`);
  revalidatePath("/dashboard", "layout");
}

/** Caja recibió el dinero (o verificó la transferencia): se cierra el pedido. */
export async function closeDeliveryOrder(
  orderId: string,
  orderNumber: number,
  payment: "efectivo" | "transferencia",
  cashReceived: number | null = null
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.MENU_ONLINE);

  const supabase = await createClient();
  const { data: total, error } = await supabase.rpc("close_delivery_order", {
    p_order_id: orderId,
    p_payment: payment,
    p_cash_received: payment === "efectivo" ? cashReceived : null,
  });
  if (error) return { error: friendlyDbError(error, "closeDeliveryOrder", "No se pudo cobrar el pedido") };

  await logActivity(profile, "Cobró y cerró pedido", `#${orderNumber} · ${payment} · ${total}`);
  revalidatePath("/dashboard", "layout");
}

export async function cancelOrder(orderId: string, orderNumber: number): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "cancelOrder", "No se pudo cancelar el pedido") };

  await logActivity(profile, "Canceló pedido", `#${orderNumber}`);
  revalidatePath("/dashboard", "layout");
}

async function pedidosContext() {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.MENU_ONLINE);
  return profile;
}

/** Envía a cocina lo que aún no se ha enviado (primer envío o cambios posteriores). */
export async function sendOrderToKitchen(orderId: string, orderNumber: number): Promise<ActionResult> {
  const profile = await pedidosContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("send_order_to_kitchen", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "sendOrderToKitchen", "No se pudo enviar a cocina") };

  await logActivity(profile, "Envió pedido a cocina", `#${orderNumber}`);
  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard/cocina");
}

export async function addDeliveryItem(
  orderId: string,
  productId: string,
  notes: string
): Promise<ActionResult> {
  const profile = await pedidosContext();
  const supabase = await createClient();
  const cleanNotes = notes.trim().slice(0, 200);

  const { data: lines } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .eq("product_id", productId);
  const same = (lines ?? []).find((l) => (l.notes ?? "") === cleanNotes && l.sent_to_kitchen_at === null);

  if (same) {
    const { error } = await supabase.from("order_items").update({ quantity: same.quantity + 1 }).eq("id", same.id);
    if (error) return { error: friendlyDbError(error, "addDeliveryItem:update", "No se pudo agregar el producto") };
  } else {
    const { error } = await supabase.from("order_items").insert({
      organization_id: profile.organization_id,
      order_id: orderId,
      product_id: productId,
      product_name: "",
      unit_price: 0,
      quantity: 1,
      notes: cleanNotes || null,
    });
    if (error) return { error: friendlyDbError(error, "addDeliveryItem:insert", "No se pudo agregar el producto") };
  }

  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard/cocina");
}

export async function changeDeliveryItemQuantity(
  orderId: string,
  itemId: string,
  quantity: number
): Promise<ActionResult> {
  await pedidosContext();
  const supabase = await createClient();

  if (quantity <= 0) {
    const { count } = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
    if ((count ?? 0) <= 1) {
      return { error: "El pedido debe tener al menos un producto. Si el cliente ya no lo quiere, cancélalo." };
    }
    const { error } = await supabase.from("order_items").delete().eq("id", itemId);
    if (error) return { error: friendlyDbError(error, "changeDeliveryItemQuantity:delete", "No se pudo quitar el producto") };
  } else {
    const { error } = await supabase
      .from("order_items")
      .update({ quantity: Math.min(quantity, 50) })
      .eq("id", itemId);
    if (error) return { error: friendlyDbError(error, "changeDeliveryItemQuantity", "No se pudo actualizar el producto") };
  }

  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard/cocina");
}

export async function updateDeliveryItemNotes(itemId: string, notes: string): Promise<ActionResult> {
  await pedidosContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("order_items")
    .update({ notes: notes.trim().slice(0, 200) || null })
    .eq("id", itemId);
  if (error) return { error: friendlyDbError(error, "updateDeliveryItemNotes", "No se pudo guardar el comentario") };

  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard/cocina");
}

export async function updateDeliveryInfo(
  orderId: string,
  orderNumber: number,
  info: {
    name: string;
    phone: string;
    address: string;
    notes: string;
    payment: "efectivo" | "transferencia";
    fulfillment: "domicilio" | "recoger";
    deliveryFee: number;
    disposablesFee: number;
  }
): Promise<ActionResult> {
  if (!Number.isFinite(info.deliveryFee) || info.deliveryFee < 0) return { error: "El valor del domicilio no es válido" };
  if (!Number.isFinite(info.disposablesFee) || info.disposablesFee < 0) return { error: "El valor de desechables no es válido" };
  const profile = await pedidosContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("update_delivery_order_info", {
    p_order_id: orderId,
    p_customer_name: info.name,
    p_customer_phone: info.phone,
    p_address: info.address,
    p_notes: info.notes,
    p_payment: info.payment,
    p_fulfillment: info.fulfillment,
    p_delivery_fee: info.deliveryFee,
    p_disposables_fee: info.disposablesFee,
  });
  if (error) return { error: friendlyDbError(error, "updateDeliveryInfo", "No se pudieron guardar los cambios") };

  await logActivity(profile, "Editó pedido", `#${orderNumber}`);
  revalidatePath("/dashboard/pedidos");
}
