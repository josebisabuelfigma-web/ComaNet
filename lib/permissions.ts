import type { UserRole } from "@/lib/supabase/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super administrador",
  owner: "Administrador",
  cajero: "Cajero",
  mesero: "Mesero",
  cocina: "Cocina",
};

/** Roles que crea el administrador de cada negocio. */
export const STAFF_ROLES = ["cajero", "mesero", "cocina"] as const;

/** Página de inicio de cada rol dentro del dashboard. */
export function homeForRole(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "/superadmin";
    case "mesero":
      return "/dashboard/mesas";
    case "cocina":
      return "/dashboard/cocina";
    case "cajero":
      return "/dashboard/pedidos";
    default:
      return "/dashboard/menu";
  }
}
