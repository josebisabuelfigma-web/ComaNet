import "server-only";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { ModuleDef, OrganizationModule } from "@/lib/supabase/types";

export const MODULE_KEYS = {
  MENU_ONLINE: "menu_online",
  MESAS: "mesas",
  CAJA: "caja",
  REPORTES: "reportes",
  COCINA: "cocina",
  FINANZAS: "finanzas",
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

export interface ModuleStatus extends ModuleDef {
  enabled: boolean;
}

export async function getModulesWithStatus(
  organizationId: string
): Promise<ModuleStatus[]> {
  const supabase = await createClient();

  const [{ data: modules }, { data: orgModules }] = await Promise.all([
    supabase.from("modules").select("*").order("name"),
    supabase
      .from("organization_modules")
      .select("*")
      .eq("organization_id", organizationId),
  ]);

  const enabledByModuleId = new Map(
    ((orgModules as OrganizationModule[]) ?? []).map((row) => [
      row.module_id,
      row.enabled,
    ])
  );

  return ((modules as ModuleDef[]) ?? []).map((mod) => ({
    ...mod,
    enabled: enabledByModuleId.get(mod.id) ?? false,
  }));
}

export async function isModuleEnabled(
  organizationId: string,
  key: ModuleKey
): Promise<boolean> {
  const supabase = await createClient();

  const { data: mod } = await supabase
    .from("modules")
    .select("id")
    .eq("key", key)
    .single();

  if (!mod) return false;

  const { data: orgModule } = await supabase
    .from("organization_modules")
    .select("enabled")
    .eq("organization_id", organizationId)
    .eq("module_id", mod.id)
    .maybeSingle();

  return orgModule?.enabled ?? false;
}

/**
 * Corta la ejecución (server component o server action) si el módulo no
 * está habilitado para la organización. Debe llamarse en cada página y en
 * cada server action que mute datos del módulo — ocultar el link del menú
 * es solo cosmético.
 */
export async function requireModule(
  organizationId: string,
  key: ModuleKey,
  redirectTo = "/dashboard/modulos"
) {
  const enabled = await isModuleEnabled(organizationId, key);
  if (!enabled) redirect(redirectTo);
}
