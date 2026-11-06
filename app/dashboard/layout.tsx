import { requireProfile } from "@/lib/auth";
import { getModulesWithStatus, MODULE_KEYS } from "@/lib/modules";
import { ROLE_LABELS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { Sidebar, type SidebarNavItem } from "@/components/sidebar";
import { BrandFooter } from "@/components/brand-footer";
import { OrderNotifier } from "@/components/order-notifier";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const isSuperAdmin = profile.role === "super_admin";
  const isOwner = profile.role === "owner";
  const isCajero = profile.role === "cajero";
  const isCocina = profile.role === "cocina";

  let brandName = "ComaNet";
  let brandLogoUrl: string | null = null;
  let currency = "COP";
  let pendingCount = 0;
  let toCollectCount = 0;

  const modules =
    profile.organization_id && !isSuperAdmin
      ? await getModulesWithStatus(profile.organization_id)
      : [];

  const isModuleEnabled = (key: string) =>
    modules.find((m) => m.key === key)?.enabled ?? false;

  if (profile.organization_id && !isSuperAdmin) {
    const [{ data: org }, { count }, { count: mesasCount }, { count: domiciliosCount }] = await Promise.all([
      supabase
        .from("organizations")
        .select("name, logo_url, currency")
        .eq("id", profile.organization_id)
        .single(),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", profile.organization_id)
        .eq("status", "pendiente"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", profile.organization_id)
        .eq("channel", "mesa")
        .eq("status", "abierta")
        .not("payment_requested_at", "is", null),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", profile.organization_id)
        .eq("channel", "domicilio")
        .eq("status", "despachado")
        .is("completed_at", null),
    ]);
    brandName = org?.name ?? brandName;
    brandLogoUrl = org?.logo_url ?? null;
    currency = org?.currency ?? "COP";
    pendingCount = count ?? 0;
    toCollectCount = (mesasCount ?? 0) + (domiciliosCount ?? 0);
  }

  const items: SidebarNavItem[] = [];

  if (isSuperAdmin) {
    items.push({ href: "/superadmin", label: "Organizaciones", icon: "superadmin" });
  } else {
    if (isOwner || isCajero) {
      items.push({
        href: "/dashboard/pedidos",
        label: "Pedidos a domicilio",
        icon: "pedidos",
        locked: !isModuleEnabled(MODULE_KEYS.MENU_ONLINE),
        badge: pendingCount,
      });
    }
    if (!isCocina) {
      items.push({
        href: "/dashboard/mesas",
        label: "Mesas",
        icon: "mesas",
        locked: !isModuleEnabled(MODULE_KEYS.MESAS),
      });
    }
    if (isOwner || isCajero || isCocina) {
      items.push({
        href: "/dashboard/cocina",
        label: "Cocina",
        icon: "cocina",
        locked: !isModuleEnabled(MODULE_KEYS.COCINA),
      });
    }
    if (isOwner || isCajero) {
      items.push({
        href: "/dashboard/caja",
        label: "Caja",
        icon: "caja",
        locked: !isModuleEnabled(MODULE_KEYS.CAJA),
        badge: toCollectCount,
      });
    }
    if (isOwner || isCajero) {
      items.push({
        href: "/dashboard/finanzas",
        label: "Ingresos y egresos",
        icon: "finanzas",
        locked: !isModuleEnabled(MODULE_KEYS.FINANZAS),
      });
      items.push({
        href: "/dashboard/facturas",
        label: "Facturas",
        icon: "facturas",
        locked: !isModuleEnabled(MODULE_KEYS.FINANZAS),
      });
    }
    if (isOwner) {
      items.push({
        href: "/dashboard/reportes",
        label: "Reportes",
        icon: "reportes",
        locked: !isModuleEnabled(MODULE_KEYS.REPORTES),
      });
    }
    if (isOwner || isCajero) {
      items.push({ href: "/dashboard/menu", label: "Carta y productos", icon: "menu" });
    }
    if (isOwner) {
      items.push({ href: "/dashboard/ajustes", label: "Ajustes", icon: "ajustes" });
      items.push({ href: "/dashboard/actividad", label: "Registro de Actividad", icon: "actividad" });
      items.push({ href: "/dashboard/modulos", label: "Módulos", icon: "modulos" });
    }
  }

  items.push({ href: "/dashboard/cuenta", label: "Mi Cuenta", icon: "cuenta" });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        fullName={profile.full_name}
        roleLabel={ROLE_LABELS[profile.role] ?? profile.role}
        items={items}
        brandName={brandName}
        brandLogoUrl={brandLogoUrl}
      />
      {(isOwner || isCajero) && profile.organization_id && isModuleEnabled(MODULE_KEYS.MENU_ONLINE) && (
        <OrderNotifier organizationId={profile.organization_id} currency={currency} />
      )}
      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 pt-20 lg:px-8 lg:py-8 lg:pt-8">
        <div className="mx-auto w-full max-w-6xl flex-1">{children}</div>
        <BrandFooter />
      </main>
    </div>
  );
}
