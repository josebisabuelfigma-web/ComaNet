"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyDbError } from "@/lib/db-errors";
import {
  createOrganizationSchema,
} from "@/lib/validations/superadmin";

type ActionResult = { error?: string } | void;

export async function createOrganization(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const admin_profile = await requireRole("super_admin");

  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    ownerFullName: formData.get("ownerFullName"),
    ownerUsername: formData.get("ownerUsername"),
    ownerPassword: formData.get("ownerPassword"),
    maxUsuarios: formData.get("maxUsuarios") || 3,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      max_usuarios: parsed.data.maxUsuarios,
    })
    .select()
    .single();

  if (orgError || !org) {
    return {
      error: friendlyDbError(
        orgError,
        "createOrganization:org",
        "No se pudo crear la organización (verifica que el slug sea único)"
      ),
    };
  }

  const authEmail = `${crypto.randomUUID()}@comanet.internal`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: parsed.data.ownerPassword,
    email_confirm: true,
  });

  if (createError || !created.user) {
    await admin.from("organizations").delete().eq("id", org.id);
    return {
      error: friendlyDbError(createError, "createOrganization:authUser", "No se pudo crear el usuario del administrador"),
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    organization_id: org.id,
    username: parsed.data.ownerUsername,
    full_name: parsed.data.ownerFullName,
    auth_email: authEmail,
    role: "owner",
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("organizations").delete().eq("id", org.id);
    return { error: "Ese nombre de usuario ya está en uso" };
  }

  const { data: modules } = await admin.from("modules").select("id");
  if (modules && modules.length > 0) {
    await admin.from("organization_modules").insert(
      modules.map((m) => ({ organization_id: org.id, module_id: m.id, enabled: false }))
    );
  }

  await logActivity(admin_profile, "Creó organización", parsed.data.name);
  revalidatePath("/superadmin");
  redirect(`/superadmin/organizaciones/${org.id}`);
}

export async function toggleModule(
  organizationId: string,
  moduleId: string,
  enabled: boolean
) {
  const profile = await requireRole("super_admin");
  const supabase = await createClient();

  const { error } = await supabase.from("organization_modules").upsert({
    organization_id: organizationId,
    module_id: moduleId,
    enabled,
    enabled_at: enabled ? new Date().toISOString() : null,
  });
  if (error) return { error: friendlyDbError(error, "toggleModule", "No se pudo actualizar el módulo") };

  await logActivity(profile, enabled ? "Activó módulo" : "Desactivó módulo", moduleId);
  revalidatePath(`/superadmin/organizaciones/${organizationId}`);
  revalidatePath("/dashboard/modulos");
}

export async function updateMaxUsuarios(organizationId: string, maxUsuarios: number) {
  const profile = await requireRole("super_admin");
  const supabase = await createClient();

  const { error } = await supabase
    .from("organizations")
    .update({ max_usuarios: maxUsuarios })
    .eq("id", organizationId);
  if (error) return { error: friendlyDbError(error, "updateMaxUsuarios", "No se pudo actualizar el límite de usuarios") };

  await logActivity(profile, "Actualizó límite de usuarios", String(maxUsuarios));
  revalidatePath(`/superadmin/organizaciones/${organizationId}`);
}

export async function deleteOrganization(organizationId: string): Promise<ActionResult> {
  const profile = await requireRole("super_admin");
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  const { data: users } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", organizationId);

  const { error } = await admin.from("organizations").delete().eq("id", organizationId);
  if (error) {
    return {
      error: friendlyDbError(error, "deleteOrganization", "No se pudo eliminar la organización"),
    };
  }

  for (const user of users ?? []) {
    await admin.auth.admin.deleteUser(user.id);
  }

  await logActivity(profile, "Eliminó organización", org?.name ?? organizationId);
  revalidatePath("/superadmin");
  redirect("/superadmin");
}

export async function toggleOrganizationActive(organizationId: string, isActive: boolean) {
  const profile = await requireRole("super_admin");
  const supabase = await createClient();

  const { error } = await supabase
    .from("organizations")
    .update({ is_active: isActive })
    .eq("id", organizationId);
  if (error) return { error: friendlyDbError(error, "toggleOrganizationActive", "No se pudo actualizar el estado de la organización") };

  await logActivity(profile, isActive ? "Reactivó organización" : "Suspendió organización");
  revalidatePath(`/superadmin/organizaciones/${organizationId}`);
  revalidatePath("/superadmin");
}
