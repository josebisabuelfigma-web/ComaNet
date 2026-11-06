import { requireRole } from "@/lib/auth";
import { Sidebar, type SidebarNavItem } from "@/components/sidebar";
import { BrandFooter } from "@/components/brand-footer";

const NAV_ITEMS: SidebarNavItem[] = [
  { href: "/superadmin", label: "Organizaciones", icon: "superadmin" },
  { href: "/superadmin/organizaciones/nueva", label: "Nueva organización", icon: "modulos" },
  { href: "/dashboard/cuenta", label: "Mi Cuenta", icon: "cuenta" },
];

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("super_admin");

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        fullName={profile.full_name}
        roleLabel="Super Administrador"
        items={NAV_ITEMS}
        brandName="ComaNet"
        brandLogoUrl={null}
      />
      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 pt-20 lg:px-8 lg:py-8 lg:pt-8">
        <div className="mx-auto w-full max-w-5xl flex-1">{children}</div>
        <BrandFooter />
      </main>
    </div>
  );
}
