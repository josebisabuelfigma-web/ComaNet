import { requireOrgRole } from "@/lib/auth";
import { isModuleEnabled, requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { CashManager } from "@/components/caja/cash-manager";
import type { CashMovement, CashSession, Order } from "@/lib/supabase/types";

export default async function CajaPage() {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.CAJA);
  const supabase = await createClient();

  const [{ data: openSession }, { data: history }, { data: org }] = await Promise.all([
    supabase
      .from("cash_sessions")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .is("closed_at", null)
      .maybeSingle(),
    supabase
      .from("cash_sessions")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(15),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
  ]);

  const session = (openSession as CashSession | null) ?? null;

  let movements: CashMovement[] = [];
  let cashSales = 0;
  let transferSales = 0;
  let ordersCount = 0;

  if (session) {
    const [{ data: moves }, { data: sales }] = await Promise.all([
      supabase
        .from("cash_movements")
        .select("*")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("total, payment_method")
        .eq("organization_id", profile.organization_id)
        .in("status", ["despachado", "pagada"])
        .gte("completed_at", session.opened_at),
    ]);
    movements = (moves as CashMovement[]) ?? [];
    for (const sale of (sales as Pick<Order, "total" | "payment_method">[]) ?? []) {
      ordersCount += 1;
      if (sale.payment_method === "efectivo") cashSales += Number(sale.total);
      else transferSales += Number(sale.total);
    }
  }

  return (
    <CashManager
      session={session}
      movements={movements}
      history={(history as CashSession[]) ?? []}
      cashSales={cashSales}
      transferSales={transferSales}
      ordersCount={ordersCount}
      currency={org?.currency ?? "COP"}
      invoiceEnabled={await isModuleEnabled(profile.organization_id, MODULE_KEYS.FINANZAS)}
    />
  );
}
