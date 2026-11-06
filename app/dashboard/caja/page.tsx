import Link from "next/link";
import { Armchair, Bike, Wallet } from "lucide-react";

import { requireOrgRole } from "@/lib/auth";
import { isModuleEnabled, requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Order, OrderItem } from "@/lib/supabase/types";

function SectionCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
}: {
  href: string;
  icon: typeof Wallet;
  title: string;
  description: string;
  badge: React.ReactNode;
}) {
  return (
    <Link href={href} className="block h-full">
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <Icon className="h-6 w-6 text-brand-dark" />
            {badge}
          </div>
          <p className="text-lg font-semibold text-brand-ink">{title}</p>
          <p className="text-sm text-brand-muted">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function CajaPage() {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.CAJA);
  const supabase = await createClient();

  const [mesasOn, domiciliosOn, { data: session }, { data: open }, { data: sent }, { data: org }] =
    await Promise.all([
      isModuleEnabled(profile.organization_id, MODULE_KEYS.MESAS),
      isModuleEnabled(profile.organization_id, MODULE_KEYS.MENU_ONLINE),
      supabase
        .from("cash_sessions")
        .select("opened_at")
        .eq("organization_id", profile.organization_id)
        .is("closed_at", null)
        .maybeSingle(),
      supabase
        .from("orders")
        .select("id")
        .eq("organization_id", profile.organization_id)
        .eq("channel", "mesa")
        .eq("status", "abierta")
        .not("payment_requested_at", "is", null),
      supabase
        .from("orders")
        .select("total")
        .eq("organization_id", profile.organization_id)
        .eq("channel", "domicilio")
        .eq("status", "despachado")
        .is("completed_at", null),
      supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
    ]);

  const mesas = (open as Pick<Order, "id">[]) ?? [];
  const { data: items } = mesas.length
    ? await supabase
        .from("order_items")
        .select("unit_price, quantity")
        .in("order_id", mesas.map((m) => m.id))
    : { data: [] as Pick<OrderItem, "unit_price" | "quantity">[] };

  const money = (n: number) => formatMoney(n, org?.currency ?? "COP");
  const mesasTotal = ((items as Pick<OrderItem, "unit_price" | "quantity">[]) ?? []).reduce(
    (sum, i) => sum + Number(i.unit_price) * i.quantity,
    0
  );
  const domicilios = (sent as Pick<Order, "total">[]) ?? [];
  const domiciliosTotal = domicilios.reduce((sum, o) => sum + Number(o.total), 0);

  const countBadge = (count: number) =>
    count > 0 ? <Badge variant="danger">{count} por cobrar</Badge> : <Badge variant="muted">Al día</Badge>;

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh organizationId={profile.organization_id} tables={["orders"]} />
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Caja</h1>
        <p className="text-sm text-brand-muted">
          Maneja el turno y cobra las mesas y domicilios. Solo caja o el administrador cierran una cuenta.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SectionCard
          href="/dashboard/caja/turno"
          icon={Wallet}
          title="Turno de caja"
          description={
            session
              ? `Abierta desde ${formatDateTime(session.opened_at)}. Ingresos, egresos y cierre.`
              : "Abre la caja con la base para empezar a cobrar."
          }
          badge={
            session ? <Badge variant="success">Abierta</Badge> : <Badge variant="danger">Cerrada</Badge>
          }
        />
        {mesasOn && (
          <SectionCard
            href="/dashboard/caja/mesas"
            icon={Armchair}
            title="Mesas por cobrar"
            description={
              mesas.length > 0
                ? `Cuentas entregadas por ${money(mesasTotal)}.`
                : "Aquí llegan las mesas con la cuenta entregada."
            }
            badge={countBadge(mesas.length)}
          />
        )}
        {domiciliosOn && (
          <SectionCard
            href="/dashboard/caja/domicilios"
            icon={Bike}
            title="Domicilios por cobrar"
            description={
              domicilios.length > 0
                ? `Pedidos enviados por ${money(domiciliosTotal)}.`
                : "Aquí llegan los pedidos marcados como enviados."
            }
            badge={countBadge(domicilios.length)}
          />
        )}
      </div>
    </div>
  );
}
