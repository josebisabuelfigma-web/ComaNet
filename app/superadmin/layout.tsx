import Image from "next/image";

import { requireRole } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import { BrandFooter } from "@/components/brand-footer";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("super_admin");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between bg-brand-ink px-4 py-4 text-white md:px-8">
        <div className="flex items-center gap-3">
          <Image src="/brand/logo.svg" alt="Logo" width={32} height={32} />
          <div>
            <p className="text-sm font-semibold">ComaNet — Super Administrador</p>
            <p className="text-xs text-white/60">{profile.full_name}</p>
          </div>
        </div>
        <LogoutButton className="text-white/70 hover:text-white" />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:px-8">{children}</main>
      <BrandFooter />
    </div>
  );
}
