"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Armchair,
  BarChart3,
  Bike,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  LogOut,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  User,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface SidebarNavItem {
  href: string;
  label: string;
  icon:
    | "menu"
    | "pedidos"
    | "mesas"
    | "caja"
    | "finanzas"
    | "facturas"
    | "cocina"
    | "reportes"
    | "ajustes"
    | "actividad"
    | "modulos"
    | "cuenta"
    | "superadmin";
  locked?: boolean;
  badge?: number;
}

const ICONS = {
  menu: UtensilsCrossed,
  pedidos: Bike,
  mesas: Armchair,
  caja: Wallet,
  finanzas: ArrowLeftRight,
  facturas: Receipt,
  cocina: ChefHat,
  reportes: BarChart3,
  ajustes: Settings,
  actividad: ClipboardList,
  modulos: LayoutGrid,
  cuenta: User,
  superadmin: ShieldCheck,
};

interface SidebarProps {
  fullName: string;
  roleLabel: string;
  items: SidebarNavItem[];
  /** Nombre y logo del negocio al que pertenece el usuario. */
  brandName: string;
  brandLogoUrl: string | null;
}

function BrandMark({ url, size }: { url: string | null; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url ?? "/brand/logo.svg"}
      alt="Logo"
      width={size}
      height={size}
      className="shrink-0 rounded-[var(--radius-brand-sm)] object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export function Sidebar({ fullName, roleLabel, items, brandName, brandLogoUrl }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const content = (
    <div className="flex h-full flex-col bg-brand-ink text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <BrandMark url={brandLogoUrl} size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{brandName}</p>
          <p className="text-xs text-white/60">{roleLabel}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-brand-sm)] px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-brand font-medium text-brand-ink"
                  : "text-white/80 hover:bg-white/10 hover:text-white",
                item.locked && "opacity-60"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.locked && <span className="ml-auto text-xs">🔒</span>}
              {!item.locked && item.badge ? (
                <span className="ml-auto rounded-full bg-brand-danger px-2 py-0.5 text-xs font-semibold text-white">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-medium">{fullName}</p>
        <button
          onClick={handleLogout}
          className="mt-3 flex items-center gap-2 text-sm text-white/70 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
        <p className="mt-3 text-[11px] text-white/40">Con tecnología ComaNet</p>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between bg-brand-ink px-4 py-3 text-white lg:hidden print:hidden">
        <div className="flex items-center gap-2">
          <BrandMark url={brandLogoUrl} size={28} />
          <span className="text-sm font-semibold">{brandName}</span>
        </div>
        <button onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open} className="rounded p-1 hover:bg-white/10">
          <Menu className="h-6 w-6" />
        </button>
      </div>

      <aside className="hidden w-64 shrink-0 lg:block print:hidden">{content}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 text-white"
              aria-label="Cerrar menú"
            >
              <X className="h-5 w-5" />
            </button>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
