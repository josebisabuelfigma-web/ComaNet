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
  const profile = await requireOrgRole("owner", "mesero");
  await requireModule(profile.organization_id, MODULE_KEYS.MESAS);
  return profile;
}

function refresh(tableId?: string) {
  revalidatePath("/dashboard/mesas");
  if (tableId) revalidatePath(`/dashboard/mesas/${tableId}`);
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function tableName(supabase: Db, tableId: string) {
  const { data } = await supabase.from("restaurant_tables").select("name").eq("id", tableId).maybeSingle();
  return data?.name ?? "Mesa";
}

/** "Mesa 3 #12" a partir de la cuenta, para el registro de actividad. */
async function orderTag(supabase: Db, orderId: string) {
  const { data: order } = await supabase
    .from("orders")
    .select("order_number, table_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return "";
  const name = order.table_id ? await tableName(supabase, order.table_id) : "Mesa";
  return `${name} #${order.order_number}`;
}

/** Tras cambiar lo que hay por cobrar: mesas, caja y el contador del menú. */
function refreshCollections() {
  revalidatePath("/dashboard", "layout");
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

  await logActivity(profile, "Abrió mesa", await tableName(supabase, tableId));
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

  // Si ya hay una línea igual (mismo producto y mismas notas) que AÚN NO se envió a
  // cocina, suma la cantidad. Lo ya enviado no se toca: lo nuevo queda aparte,
  // "sin enviar", hasta que el mesero pulse "Enviar a cocina".
  const { data: lines } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .eq("product_id", productId);
  const same = ((lines as OrderItem[]) ?? []).find(
    (l) => (l.notes ?? "") === cleanNotes && !l.sent_to_kitchen_at
  );

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

  const { data: product } = await supabase.from("menu_products").select("name").eq("id", productId).maybeSingle();
  await logActivity(profile, "Agregó producto a mesa", `${await tableName(supabase, tableId)}: ${product?.name ?? "producto"}`);
  refresh(tableId);
}

export async function changeTableItemQuantity(
  itemId: string,
  tableId: string,
  quantity: number
): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();

  const { data: before } = await supabase
    .from("order_items")
    .select("product_name, quantity")
    .eq("id", itemId)
    .maybeSingle();

  const { error } =
    quantity <= 0
      ? await supabase.from("order_items").delete().eq("id", itemId)
      : await supabase.from("order_items").update({ quantity }).eq("id", itemId);
  if (error) return { error: friendlyDbError(error, "changeTableItemQuantity", "No se pudo actualizar el producto") };

  if (before) {
    const where = await tableName(supabase, tableId);
    await logActivity(
      profile,
      quantity <= 0 ? "Quitó producto de mesa" : "Cambió cantidad en mesa",
      quantity <= 0
        ? `${where}: ${before.product_name}`
        : `${where}: ${before.product_name} (${before.quantity} → ${quantity})`
    );
  }
  refresh(tableId);
}

export async function updateTableItemNotes(
  itemId: string,
  tableId: string,
  notes: string
): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();

  const { data: line } = await supabase.from("order_items").select("product_name").eq("id", itemId).maybeSingle();
  const { error } = await supabase
    .from("order_items")
    .update({ notes: notes.trim().slice(0, 200) || null })
    .eq("id", itemId);
  if (error) return { error: friendlyDbError(error, "updateTableItemNotes", "No se pudo guardar la nota") };

  await logActivity(
    profile,
    "Cambió comentario en mesa",
    `${await tableName(supabase, tableId)}: ${line?.product_name ?? "producto"} · ${notes.trim().slice(0, 80) || "sin comentario"}`
  );

  refresh(tableId);
}

/** Lleva a cocina los productos que aún no se han enviado de esta cuenta. */
export async function sendTableToKitchen(orderId: string, tableId: string): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("send_order_to_kitchen", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "sendTableToKitchen", "No se pudo enviar a cocina") };

  await logActivity(profile, "Envió mesa a cocina", await tableName(supabase, tableId));
  refresh(tableId);
  revalidatePath("/dashboard/cocina");
}

/** Cuenta entregada: la mesa sigue ocupada hasta que caja reciba el dinero. */
export async function requestTablePayment(
  orderId: string,
  payment: "efectivo" | "transferencia"
): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("request_table_payment", { p_order_id: orderId, p_payment: payment });
  if (error) return { error: friendlyDbError(error, "requestTablePayment", "No se pudo avisar a caja") };

  await logActivity(profile, "Entregó cuenta de mesa", `${await orderTag(supabase, orderId)} · ${payment}`);
  refreshCollections();
}

export async function cancelTablePaymentRequest(orderId: string): Promise<ActionResult> {
  const profile = await mesaContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_table_payment_request", { p_order_id: orderId });
  if (error) return { error: friendlyDbError(error, "cancelTablePaymentRequest", "No se pudo retirar el aviso") };

  await logActivity(profile, "Retiró cuenta entregada", await orderTag(supabase, orderId));

  refreshCollections();
}

/** Solo caja o administrador reciben el dinero y dejan la mesa libre. */
export async function closeTable(
  orderId: string,
  payment: "efectivo" | "transferencia",
  cashReceived: number | null = null
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.MESAS);
  const supabase = await createClient();

  const { data: total, error } = await supabase.rpc("close_table_order", {
    p_order_id: orderId,
    p_payment: payment,
    p_cash_received: payment === "efectivo" ? cashReceived : null,
  });
  if (error) return { error: friendlyDbError(error, "closeTable", "No se pudo cobrar la cuenta") };

  await logActivity(profile, "Cobró y cerró mesa", `${await orderTag(supabase, orderId)} · ${payment} · ${total}`);
  refreshCollections();
}
