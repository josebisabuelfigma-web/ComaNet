"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrgRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";

type ActionResult = { error?: string } | void;

const amountSchema = z.coerce.number().min(0, "El valor no puede ser negativo").max(1_000_000_000);

async function cajaContext() {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.CAJA);
  return profile;
}

export async function openCash(opening: number): Promise<ActionResult> {
  const profile = await cajaContext();
  const parsed = amountSchema.safeParse(opening);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_cash_session", { p_opening: parsed.data });
  if (error) return { error: friendlyDbError(error, "openCash", "No se pudo abrir la caja") };

  await logActivity(profile, "Abrió caja", `Base ${parsed.data}`);
  revalidatePath("/dashboard/caja");
}

export async function addCashMovement(
  sessionId: string,
  type: "ingreso" | "egreso",
  amount: number,
  description: string
): Promise<ActionResult> {
  const profile = await cajaContext();

  const parsedAmount = amountSchema.safeParse(amount);
  if (!parsedAmount.success || parsedAmount.data <= 0) return { error: "Escribe un valor mayor a 0" };
  const text = description.trim();
  if (!text) return { error: "Escribe una descripción" };
  if (type !== "ingreso" && type !== "egreso") return { error: "Tipo inválido" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_cash_movement", {
    p_type: type,
    p_amount: parsedAmount.data,
    p_description: text,
    p_payment: "efectivo",
    p_invoice_path: null,
    p_invoice_name: null,
  });
  if (error) return { error: friendlyDbError(error, "addCashMovement", "No se pudo registrar el movimiento") };

  await logActivity(profile, type === "ingreso" ? "Ingreso de caja" : "Egreso de caja", `${amount} · ${text}`);
  revalidatePath("/dashboard/caja");
}

export async function closeCash(
  sessionId: string,
  counted: number,
  notes: string
): Promise<ActionResult> {
  const profile = await cajaContext();
  const parsed = amountSchema.safeParse(counted);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_counted: parsed.data,
    p_notes: notes,
  });
  if (error) return { error: friendlyDbError(error, "closeCash", "No se pudo cerrar la caja") };

  await logActivity(
    profile,
    "Cerró caja",
    `Esperado ${data?.expected_cash} · contado ${parsed.data} · diferencia ${data?.difference}`
  );
  revalidatePath("/dashboard/caja");
}
