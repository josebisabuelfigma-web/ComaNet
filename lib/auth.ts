import "server-only";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { homeForRole } from "@/lib/permissions";
import type { Profile, UserRole } from "@/lib/supabase/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (profile as Profile) ?? null;
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** Exige uno de los roles; si no, manda al usuario a la página de su rol. */
export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect(homeForRole(profile.role));
  return profile;
}

/** Como requireRole, pero además garantiza que el usuario pertenece a una organización. */
export async function requireOrgRole(
  ...roles: UserRole[]
): Promise<Profile & { organization_id: string }> {
  const profile = await requireRole(...roles);
  if (!profile.organization_id) redirect("/superadmin");
  return profile as Profile & { organization_id: string };
}
