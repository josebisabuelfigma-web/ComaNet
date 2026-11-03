"use server";

import { revalidatePath } from "next/cache";

import { requireOrgRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_MB,
  businessInfoSchema,
  settingsSchema,
  tableSchema,
} from "@/lib/validations/menu";

type ActionResult = { error?: string; success?: string } | void;

export async function saveSettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");

  const parsed = settingsSchema.safeParse({
    whatsappNumber: formData.get("whatsappNumber") ?? "",
    deliveryFee: formData.get("deliveryFee") || 0,
    deliveryMessage: formData.get("deliveryMessage") ?? "",
    disposablesFee: formData.get("disposablesFee") || 0,
    disposablesLabel: formData.get("disposablesLabel") || "Desechables",
    pickupEnabled: formData.get("pickupEnabled") === "on",
    opensAt: formData.get("opensAt") ?? "",
    closesAt: formData.get("closesAt") ?? "",
    openDays: formData.getAll("openDays").map(Number),
    acceptsCash: formData.get("acceptsCash") === "on",
    acceptsTransfer: formData.get("acceptsTransfer") === "on",
    transferInstructions: formData.get("transferInstructions") ?? "",
    welcomeMessage: formData.get("welcomeMessage") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  if (Boolean(parsed.data.opensAt) !== Boolean(parsed.data.closesAt)) {
    return { error: "Escribe la hora de apertura y la de cierre (o deja ambas vacías)" };
  }
  if (parsed.data.openDays.length === 0) {
    return { error: "Selecciona al menos un día de atención" };
  }

  if (!parsed.data.acceptsCash && !parsed.data.acceptsTransfer) {
    return { error: "Debes aceptar al menos un medio de pago" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("restaurant_settings")
    .update({
      whatsapp_number: parsed.data.whatsappNumber || null,
      delivery_fee: parsed.data.deliveryFee,
      delivery_message: parsed.data.deliveryMessage || null,
      disposables_fee: parsed.data.disposablesFee,
      disposables_label: parsed.data.disposablesLabel,
      pickup_enabled: parsed.data.pickupEnabled,
      opens_at: parsed.data.opensAt || null,
      closes_at: parsed.data.closesAt || null,
      open_days: parsed.data.openDays,
      accepts_cash: parsed.data.acceptsCash,
      accepts_transfer: parsed.data.acceptsTransfer,
      transfer_instructions: parsed.data.transferInstructions || null,
      welcome_message: parsed.data.welcomeMessage || null,
    })
    .eq("organization_id", profile.organization_id);
  if (error) return { error: friendlyDbError(error, "saveSettings", "No se pudieron guardar los ajustes") };

  await logActivity(profile, "Actualizó ajustes del negocio");
  revalidatePath("/dashboard/ajustes");
  revalidatePath("/dashboard/mesas");
  return { success: "Ajustes guardados" };
}

/** Abre o cierra la recepción de pedidos en línea (pausa rápida). */
export async function setOrdersOpen(open: boolean): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");
  const supabase = await createClient();

  // El cajero no tiene permiso de escritura sobre los ajustes por RLS; esta
  // pausa rápida la hace el owner. Si es cajero se informa.
  if (profile.role !== "owner") return { error: "Solo el administrador puede pausar los pedidos" };

  const { error } = await supabase
    .from("restaurant_settings")
    .update({ orders_open: open })
    .eq("organization_id", profile.organization_id);
  if (error) return { error: friendlyDbError(error, "setOrdersOpen", "No se pudo actualizar el estado") };

  await logActivity(profile, open ? "Abrió recepción de pedidos" : "Pausó recepción de pedidos");
  revalidatePath("/dashboard/ajustes");
  revalidatePath("/dashboard/pedidos");
}

export async function saveBusinessInfo(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");

  const parsed = businessInfoSchema.safeParse({
    legalName: formData.get("legalName") ?? "",
    taxId: formData.get("taxId") ?? "",
    billingAddress: formData.get("billingAddress") ?? "",
    billingPhone: formData.get("billingPhone") ?? "",
    ticketFooter: formData.get("ticketFooter") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();

  let logoUrl: string | undefined;
  const file = formData.get("logo") as File | null;
  if (file && file.size > 0) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
      return { error: "El logo debe ser PNG, JPG o WEBP" };
    }
    if (file.size > MAX_IMAGE_FILE_SIZE_MB * 1024 * 1024) {
      return { error: `El logo no puede superar ${MAX_IMAGE_FILE_SIZE_MB}MB` };
    }
    const path = `${profile.organization_id}/logo-${crypto.randomUUID()}`;
    const { error: uploadError } = await supabase.storage
      .from("branding")
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      return { error: friendlyDbError(uploadError, "saveBusinessInfo:upload", "No se pudo subir el logo") };
    }
    logoUrl = supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      legal_name: parsed.data.legalName || null,
      tax_id: parsed.data.taxId || null,
      billing_address: parsed.data.billingAddress || null,
      billing_phone: parsed.data.billingPhone || null,
      ticket_footer: parsed.data.ticketFooter || null,
      ...(logoUrl ? { logo_url: logoUrl } : {}),
    })
    .eq("id", profile.organization_id);
  if (error) return { error: friendlyDbError(error, "saveBusinessInfo", "No se pudieron guardar los datos") };

  await logActivity(profile, "Actualizó datos del negocio");
  revalidatePath("/dashboard/ajustes");
  return { success: "Datos guardados" };
}

export async function createTable(name: string): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  const parsed = tableSchema.safeParse({ name });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { count } = await supabase
    .from("restaurant_tables")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", profile.organization_id);

  const { error } = await supabase.from("restaurant_tables").insert({
    organization_id: profile.organization_id,
    name: parsed.data.name,
    sort_order: count ?? 0,
  });
  if (error) {
    return {
      error: friendlyDbError(error, "createTable", "No se pudo crear la mesa", {
        "23505": "Ya existe una mesa con ese nombre",
      }),
    };
  }

  await logActivity(profile, "Creó mesa", parsed.data.name);
  revalidatePath("/dashboard/ajustes");
  revalidatePath("/dashboard/mesas");
}

export async function deleteTable(tableId: string, name: string): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  const supabase = await createClient();

  const { data: open } = await supabase
    .from("orders")
    .select("id")
    .eq("table_id", tableId)
    .eq("status", "abierta")
    .maybeSingle();
  if (open) return { error: "La mesa tiene una cuenta abierta. Ciérrala antes de eliminarla." };

  const { error } = await supabase
    .from("restaurant_tables")
    .delete()
    .eq("id", tableId)
    .eq("organization_id", profile.organization_id);
  if (error) return { error: friendlyDbError(error, "deleteTable", "No se pudo eliminar la mesa") };

  await logActivity(profile, "Eliminó mesa", name);
  revalidatePath("/dashboard/ajustes");
  revalidatePath("/dashboard/mesas");
}
