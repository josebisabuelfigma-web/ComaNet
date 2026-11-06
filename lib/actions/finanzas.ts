"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { requireOrgRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";

type ActionResult = { error?: string } | void;

const MAX_INVOICE_BYTES = 5 * 1024 * 1024;
const INVOICE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Registra un ingreso o egreso (con factura opcional) sin depender del módulo de caja. */
export async function registerMovement(formData: FormData): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.FINANZAS);

  const type = String(formData.get("type") ?? "");
  const payment = String(formData.get("payment") ?? "efectivo");
  const description = String(formData.get("description") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(",", "."));

  if (type !== "ingreso" && type !== "egreso") return { error: "Elige si es ingreso o egreso" };
  if (payment !== "efectivo" && payment !== "transferencia") return { error: "Elige el medio de pago" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Escribe un valor mayor a 0" };
  if (amount > 1_000_000_000) return { error: "El valor es demasiado grande" };
  if (!description) return { error: "Escribe una descripción" };

  const supabase = await createClient();

  let invoicePath: string | null = null;
  let invoiceName: string | null = null;
  const file = formData.get("invoice");
  if (file instanceof File && file.size > 0) {
    const ext = INVOICE_TYPES[file.type];
    if (!ext) return { error: "La factura debe ser una imagen (JPG, PNG, WEBP) o un PDF" };
    if (file.size > MAX_INVOICE_BYTES) return { error: "La factura pesa más de 5 MB" };

    invoicePath = `${profile.organization_id}/${randomUUID()}.${ext}`;
    invoiceName = file.name.slice(0, 200);
    const { error: uploadError } = await supabase.storage
      .from("facturas")
      .upload(invoicePath, file, { contentType: file.type });
    if (uploadError) {
      return { error: friendlyDbError(uploadError, "registerMovement:upload", "No se pudo subir la factura") };
    }
  }

  const { error } = await supabase.rpc("register_cash_movement", {
    p_type: type,
    p_amount: amount,
    p_description: description.slice(0, 200),
    p_payment: payment,
    p_invoice_path: invoicePath,
    p_invoice_name: invoiceName,
  });
  if (error) {
    if (invoicePath) await supabase.storage.from("facturas").remove([invoicePath]);
    return { error: friendlyDbError(error, "registerMovement", "No se pudo registrar el movimiento") };
  }

  await logActivity(
    profile,
    type === "ingreso" ? "Registró ingreso" : "Registró egreso",
    `${amount} · ${description.slice(0, 80)}${invoicePath ? " · con factura" : ""}`
  );
  revalidatePath("/dashboard/finanzas");
  revalidatePath("/dashboard/facturas");
  revalidatePath("/dashboard/caja");
}
