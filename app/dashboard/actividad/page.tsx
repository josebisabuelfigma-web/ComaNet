import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActivityLogEntry } from "@/lib/supabase/types";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super administrador",
  owner: "Administrador",
  cajero: "Cajero",
  mesero: "Mesero",
  cocina: "Cocina",
};

export default async function ActividadPage() {
  const profile = await requireRole("owner", "super_admin");
  // El registro de actividad es por organización; un super_admin no tiene
  // una propia (ve todo el sistema desde /superadmin), así que aquí no hay
  // nada que mostrarle.
  if (!profile.organization_id) {
    return (
      <p className="text-sm text-brand-muted">
        El registro de actividad es por organización. Entra a Super Admin para revisar la
        actividad de una organización específica.
      </p>
    );
  }
  const supabase = await createClient();

  const { data: entries } = await supabase
    .from("activity_log")
    .select("*")
    .eq("organization_id", profile.organization_id)
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (entries as ActivityLogEntry[]) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Registro de Actividad</h1>
        <p className="text-sm text-brand-muted">
          Últimas 200 acciones registradas por los usuarios de tu organización.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-brand-md)] border border-brand-border bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-brand-border text-left text-brand-muted">
              <th className="p-3 font-medium">Fecha</th>
              <th className="p-3 font-medium">Usuario</th>
              <th className="p-3 font-medium">Rol</th>
              <th className="p-3 font-medium">Acción</th>
              <th className="p-3 font-medium">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-brand-muted">
                  Aún no hay actividad registrada.
                </td>
              </tr>
            )}
            {list.map((entry) => (
              <tr key={entry.id} className="border-b border-brand-border last:border-0">
                <td className="p-3 whitespace-nowrap">
                  {new Date(entry.created_at).toLocaleString("es-CO")}
                </td>
                <td className="p-3 font-medium text-brand-ink">{entry.username}</td>
                <td className="p-3 text-brand-muted">
                  {ROLE_LABELS[entry.role] ?? entry.role}
                </td>
                <td className="p-3">{entry.action}</td>
                <td className="p-3 text-brand-muted">{entry.details || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
