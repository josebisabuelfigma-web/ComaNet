import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import {
  dayRangeToTimestamps,
  formatDateTime,
  formatMoney,
  normalizeDay,
  todayInColombia,
} from "@/lib/format";
import { signInvoiceUrls } from "@/lib/invoices";
import { MovementForm } from "@/components/finanzas/movement-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashMovement } from "@/lib/supabase/types";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  const color = tone === "success" ? "text-brand-success" : tone === "danger" ? "text-brand-danger" : "text-brand-ink";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-brand-muted">{label}</p>
        <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function FinanzasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const profile = await requireOrgRole("owner", "cajero");
  await requireModule(profile.organization_id, MODULE_KEYS.FINANZAS);

  const params = await searchParams;
  const today = todayInColombia();
  const from = normalizeDay(params.from, `${today.slice(0, 8)}01`);
  const to = normalizeDay(params.to, today);
  const range = from <= to ? { from, to } : { from: to, to: from };
  const { from: fromTs, to: toTs } = dayRangeToTimestamps(range.from, range.to);

  const supabase = await createClient();
  const [{ data: moves }, { data: org }] = await Promise.all([
    supabase
      .from("cash_movements")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .gte("created_at", fromTs)
      .lt("created_at", toTs)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
  ]);

  const list = (moves as CashMovement[]) ?? [];
  const money = (n: number) => formatMoney(n, org?.currency ?? "COP");
  const total = (type: "ingreso" | "egreso", method?: string) =>
    list
      .filter((m) => m.type === type && (!method || m.payment_method === method))
      .reduce((sum, m) => sum + Number(m.amount), 0);

  const ingresos = total("ingreso");
  const egresos = total("egreso");
  const urls = await signInvoiceUrls(
    supabase,
    list.map((m) => m.invoice_path).filter((p): p is string => !!p)
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-ink">Ingresos y egresos</h1>
          <p className="text-sm text-brand-muted">
            Registra lo que entra y sale del negocio. Adjunta la factura y consúltala después en Facturas.
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-brand-muted">
            Desde
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm text-brand-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-brand-muted">
            Hasta
            <input
              type="date"
              name="to"
              defaultValue={range.to}
              className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm text-brand-ink"
            />
          </label>
          <Button type="submit">Ver</Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registrar movimiento</CardTitle>
          <CardDescription>Escribe cualquier valor, sin restricciones.</CardDescription>
        </CardHeader>
        <CardContent>
          <MovementForm />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Ingresos" value={money(ingresos)} tone="success" />
        <Stat label="Egresos" value={money(egresos)} tone="danger" />
        <Stat label="Balance del periodo" value={money(ingresos - egresos)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos del periodo</CardTitle>
          <CardDescription>
            {list.length === 500 ? "Se muestran los 500 más recientes." : `${list.length} movimientos.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {list.length === 0 ? (
            <p className="py-4 text-sm text-brand-muted">No hay movimientos en estas fechas.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-brand-border text-left text-brand-muted">
                  <th className="p-2 font-medium">Fecha y hora</th>
                  <th className="p-2 font-medium">Descripción</th>
                  <th className="p-2 font-medium">Medio</th>
                  <th className="p-2 font-medium">Factura</th>
                  <th className="p-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {list.map((move) => {
                  const url = move.invoice_path ? urls.get(move.invoice_path) : undefined;
                  return (
                    <tr key={move.id} className="border-b border-brand-border last:border-0">
                      <td className="whitespace-nowrap p-2">{formatDateTime(move.created_at)}</td>
                      <td className="p-2">{move.description}</td>
                      <td className="p-2">
                        <Badge variant="muted" className="capitalize">
                          {move.payment_method}
                        </Badge>
                      </td>
                      <td className="p-2">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-dark underline">
                            Ver
                          </a>
                        ) : (
                          <span className="text-brand-muted">—</span>
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap p-2 text-right font-medium ${
                          move.type === "ingreso" ? "text-brand-success" : "text-brand-danger"
                        }`}
                      >
                        {move.type === "ingreso" ? "+" : "−"}
                        {money(Number(move.amount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
