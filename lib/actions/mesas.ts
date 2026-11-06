"use server";

import { revalidatePath } from "next/cache";

import { requireOrgRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";
import type { OrderItem } from "@/lib/supabase/types";

type ActionResult = { error?: string } | void;

async function mesaContext() {
  const profile = await requireOrgRole("owner", "cajero", "mesero");
  await requireModule(profile.organization_id, MODULE_KEYS.MESAS);
  return profile;
}

function refresh(tableId?: string) {
  revalidatePath("/dashboard/mesas");
  if (tableId) revalidatePath(`/dashboard/mesas/${tableId}`);
}

/** Abre una cuenta para la mesa (si ya tiene una abierta, no hace nada). */
export async function openTable(tableId: string): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("table_id", tableId)
    .eq("status", "abierta")
    .maybeSingle();
  if (existing) return;

  const { error } = await supabase.from("orders").insert({
    organization_id: profile.organization_id,
    channel: "mesa",
    status: "abierta",
    table_id: tableId,
    created_by: profile.id,
  });
  if (error) {
    return {
      error: friendlyDbError(error, "openTable", "No se pudo abrir la mesa", {
        "23505": "Esa mesa ya tiene una cuenta abierta",
      }),
    };
  }

  refresh(tableId);
}

export async function addTableItem(
  orderId: string,
  tableId: string,
  productId: string,
  notes: string
): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();
  const cleanNotes = notes.trim().slice(0, 200);

  // Si ya hay una línea igual (mismo producto y mismas notas) suma la cantidad.
  const { data: lines } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .eq("product_id", productId);
  const same = ((lines as OrderItem[]) ?? []).find((l) => (l.notes ?? "") === cleanNotes);

  if (same) {
    const { error } = await supabase
      .from("order_items")
      .update({ quantity: same.quantity + 1 })
      .eq("id", same.id);
    if (error) return { error: friendlyDbError(error, "addTableItem:update", "No se pudo agregar el producto") };
  } else {
    // product_name y unit_price los fija la base de datos desde la carta.
    const { error } = await supabase.from("order_items").insert({
      organization_id: profile.organization_id,
      order_id: orderId,
      product_id: productId,
      product_name: "",
      unit_price: 0,
      quantity: 1,
      notes: cleanNotes || null,
    });
    if (error) return { error: friendlyDbError(error, "addTableItem:insert", "No se pudo agregar el producto") };
  }

  refresh(tableId);
}

export async function changeTableItemQuantity(
  itemId: string,
  tableId: string,
  quantity: number
): Promise<ActionResult> {
  await mesaContext();
  const supabase = await createClient();

  const { error } =
    quantity <= 0
      ? await supabase.from("order_items").delete().eq("id", itemId)
      : await supabase.from("order_items").update({ quantity }).eq("id", itemId);
  if (error) return { error: friendlyDbError(error, "changeTableItemQuantity", "No se pudo actualizar el producto") };

  refresh(tableId);
}

export async function updateTableItemNotes(
  itemId: string,
  tableId: string,
  notes: string
): Promise<ActionResult> {
  await mesaContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("order_items")
    .update({ notes: notes.trim().slice(0, 200) || null })
    .eq("id", itemId);
  if (error) return { error: friendlyDbError(error, "updateTableItemNotes", "No se pudo guardar la nota") };

  refresh(tableId);
}

/** Lleva a cocina los productos que aún no se han enviado de esta cuenta. */
export async function sendTableToKitchen(orderId: string, tableId: string): Promise<ActionResult> {
  await mesaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("send_order_to_kitchen", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "sendTableToKitchen", "No se pudo enviar a cocina") };

  refresh(tableId);
  revalidatePath("/dashboard/cocina");
}

/** El mesero recibió el dinero: la mesa sigue ocupada hasta que caja lo confirme. */
export async function requestTablePayment(
  orderId: string,
  tableId: string,
  payment: "efectivo" | "transferencia"
): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("request_table_payment", { p_order_id: orderId, p_payment: payment });
  if (error) return { error: friendlyDbError(error, "requestTablePayment", "No se pudo avisar a caja") };

  await logActivity(profile, "Pidió cobro de mesa", payment);
  refresh(tableId);
}

export async function cancelTablePaymentRequest(orderId: string, tableId: string): Promise<ActionResult> {
  await mesaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_table_payment_request", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "cancelTablePaymentRequest", "No se pudo retirar el aviso") };

  refresh(tableId);
}

/** Solo caja o administrador confirman el dinero y dejan la mesa libre. */
export async function closeTable(
  orderId: string,
  tableId: string,
  payment: "efectivo" | "transferencia"
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.MESAS);
  const supabase = await createClient();

  const { data: total, error } = await supabase.rpc("close_table_order", {
    p_order_id: orderId,
    p_payment: payment,
  });
  if (error) return { error: friendlyDbError(error, "closeTable", "No se pudo cobrar la cuenta") };

  await logActivity(profile, "Confirmó pago y cerró mesa", `${payment} · ${total}`);
  refresh(tableId);
}
