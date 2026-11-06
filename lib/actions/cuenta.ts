"use server";

import { revalidatePath } from "next/cache";

import { requireOrgRole, requireProfile } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { changePasswordSchema, createStaffSchema } from "@/lib/validations/cuenta";

type ActionResult = { error?: string; success?: string } | void;

export async function changePassword(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireProfile();
  // Los usuarios del equipo (cajero, mesero, cocina) no cambian su contraseña:
  // la restablece el administrador desde Mi Cuenta → Usuarios.
  if (profile.role !== "owner" && profile.role !== "super_admin") {
    return { error: "Tu contraseña la cambia el administrador del negocio." };
  }

  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "No se pudo actualizar la contraseña" };

  await logActivity(profile, "Cambió su contraseña");
  return { success: "Contraseña actualizada correctamente" };
}

export async function createStaff(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");

  const parsed = createStaffSchema.safeParse({
    role: formData.get("role"),
    username: formData.get("username"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();

  const [{ data: org }, { count }] = await Promise.all([
    supabase
      .from("organizations")
      .select("max_usuarios")
      .eq("id", profile.organization_id)
      .single(),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .neq("role", "owner"),
  ]);

  if (!org) return { error: "No se pudo verificar el límite de usuarios" };
  if ((count ?? 0) >= org.max_usuarios) {
    return {
      error: `Ya alcanzaste el límite de ${org.max_usuarios} usuario(s) de tu plan. Contáctanos para ampliarlo.`,
    };
  }

  const admin = createAdminClient();
  const authEmail = `${crypto.randomUUID()}@comanet.internal`;

  // El usuario y su contraseña viven en la base de datos (Supabase Auth +
  // profiles) y se crean aquí por código; no hay credenciales en variables.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return { error: "No se pudo crear el usuario" };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    organization_id: profile.organization_id,
    username: parsed.data.username,
    full_name: parsed.data.fullName,
    auth_email: authEmail,
    role: parsed.data.role,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "Ese nombre de usuario ya está en uso" };
  }

  await logActivity(profile, `Creó usuario ${parsed.data.role}`, parsed.data.username);
  revalidatePath("/dashboard/cuenta");
  return { success: "Usuario creado correctamente" };
}

export async function resetStaffPassword(
  userId: string,
  password: string
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres" };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, username, organization_id, role")
    .eq("id", userId)
    .single();
  if (!target || target.organization_id !== profile.organization_id || target.role === "owner") {
    return { error: "No se pudo actualizar ese usuario" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: "No se pudo actualizar la contraseña" };

  await logActivity(profile, "Restableció contraseña", target.username);
  return { success: "Contraseña actualizada" };
}

export async function deleteStaff(userId: string, username: string): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", userId)
    .single();

  if (!target || target.organization_id !== profile.organization_id || target.role === "owner") {
    return { error: "No se pudo eliminar ese usuario" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: "No se pudo eliminar el usuario" };

  await logActivity(profile, "Eliminó usuario", username);
  revalidatePath("/dashboard/cuenta");
}
