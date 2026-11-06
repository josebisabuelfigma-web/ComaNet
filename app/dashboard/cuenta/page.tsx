import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/permissions";
import { ChangePasswordForm } from "@/components/cuenta/change-password-form";
import { StaffManager } from "@/components/cuenta/staff-manager";
import type { Profile } from "@/lib/supabase/types";

export default async function CuentaPage() {
  const profile = await requireProfile();

  let staff: Profile[] = [];
  let maxUsuarios = 0;

  if (profile.role === "owner" && profile.organization_id) {
    const supabase = await createClient();
    const [{ data: users }, { data: org }] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .eq("organization_id", profile.organization_id)
        .neq("role", "owner")
        .order("created_at", { ascending: true }),
      supabase
        .from("organizations")
        .select("max_usuarios")
        .eq("id", profile.organization_id)
        .single(),
    ]);
    staff = (users as Profile[]) ?? [];
    maxUsuarios = org?.max_usuarios ?? 0;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Mi Cuenta</h1>
        <p className="text-sm text-brand-muted">
          {profile.full_name} · @{profile.username} · {ROLE_LABELS[profile.role]}
        </p>
      </div>

      {profile.role === "owner" || profile.role === "super_admin" ? (
        <ChangePasswordForm />
      ) : (
        <div className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-4 text-sm text-brand-muted">
          Tu contraseña la gestiona el administrador del negocio. Si la olvidaste o quieres cambiarla,
          pídesela a él.
        </div>
      )}

      {profile.role === "owner" && <StaffManager staff={staff} maxUsuarios={maxUsuarios} />}
    </div>
  );
}
