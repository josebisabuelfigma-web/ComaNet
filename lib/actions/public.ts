"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyDbError } from "@/lib/db-errors";
import { formatMoney, onlyDigits } from "@/lib/format";
import { checkoutSchema } from "@/lib/validations/menu";
import { isWithinSchedule } from "@/lib/schedule";
import type { OrderItem } from "@/lib/supabase/types";

export type CheckoutInput = {
  orgId: string;
  customerName: string;
  customerPhone: string;
  fulfillment: "domicilio" | "recoger";
  address?: string;
  notes?: string;
  payment: "efectivo" | "transferencia";
  items: { productId: string; quantity: number; notes?: string }[];
};

export type CheckoutResult =
  | { error: string }
  | { orderNumber: number; total: number; whatsappUrl: string | null };

/**
 * Crea el pedido de domicilio desde la carta pública. No confía en nada del
 * cliente salvo los ids y cantidades: precios, disponibilidad, domicilio y
 * desechables se recalculan en la base de datos (create_delivery_order).
 */
export async function createPublicOrder(input: CheckoutInput): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const data = parsed.data;
  if (data.fulfillment === "domicilio" && (data.address ?? "").length < 5) {
    return { error: "Escribe la dirección de entrega" };
  }

  const admin = createAdminClient();

  const { data: rows, error } = await admin.rpc("create_delivery_order", {
    p_org: data.orgId,
    p_items: data.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      notes: i.notes ?? "",
    })),
    p_customer_name: data.customerName,
    p_customer_phone: data.customerPhone,
    p_address: data.address ?? "",
    p_notes: data.notes ?? "",
    p_payment: data.payment,
    p_fulfillment: data.fulfillment,
  });

  const order = rows?.[0];
  if (error || !order) {
    return {
      error: friendlyDbError(error, "createPublicOrder", "No se pudo registrar el pedido. Intenta de nuevo."),
    };
  }

  const [{ data: items }, { data: settings }, { data: org }] = await Promise.all([
    admin.from("order_items").select("*").eq("order_id", order.order_id).order("created_at"),
    admin.from("restaurant_settings").select("*").eq("organization_id", data.orgId).single(),
    admin.from("organizations").select("name, currency, billing_address").eq("id", data.orgId).single(),
  ]);

  const currency = org?.currency ?? "COP";
  const money = (n: number) => formatMoney(n, currency);
  const lines = ((items as OrderItem[]) ?? []).map((item, index) => {
    const base = `${index + 1}. ${item.quantity} x ${item.product_name} — ${money(
      Number(item.unit_price) * item.quantity
    )}`;
    const parts = (item.combo_snapshot ?? [])
      .map((c) => `${c.quantity * item.quantity} ${c.name}`)
      .join(", ");
    const lines = [base];
    if (parts) lines.push(`    (incluye: ${parts})`);
    if (item.notes) lines.push(`    📝 ${item.notes}`);
    return lines.join("\n");
  });

  const delivery = Number(order.delivery_fee);
  const disposables = Number(order.disposables_fee);

  const message = [
    `🧾 *Nuevo pedido #${order.order_number}*${org?.name ? ` — ${org.name}` : ""}`,
    ...(settings && !isWithinSchedule(settings)
      ? ["🕒 _Pedido hecho fuera de horario: se gestiona al abrir._"]
      : []),
    "",
    `👤 ${data.customerName}`,
    `📞 ${data.customerPhone}`,
    data.fulfillment === "recoger"
      ? `🛍️ *RECOGE EN EL LOCAL*${org?.billing_address ? ` (${org.billing_address})` : ""}`
      : `🛵 *DOMICILIO*\n📍 ${data.address}`,
    "",
    "*Productos*",
    ...lines,
    "",
    `Valor productos: ${money(Number(order.subtotal))}`,
    ...(data.fulfillment === "domicilio" ? [`Domicilio: ${delivery > 0 ? money(delivery) : "Gratis"}`] : []),
    ...(disposables > 0 ? [`${settings?.disposables_label ?? "Desechables"}: ${money(disposables)}`] : []),
    `*Total a pagar: ${money(Number(order.total))}*`,
    "",
    `💳 Pago: ${data.payment === "efectivo" ? "Efectivo" : "Transferencia"}`,
    ...(data.notes ? ["", `Observaciones: ${data.notes}`] : []),
  ].join("\n");

  const number = settings?.whatsapp_number ? onlyDigits(settings.whatsapp_number) : "";
  const whatsappUrl = number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;

  return { orderNumber: order.order_number, total: Number(order.total), whatsappUrl };
}
