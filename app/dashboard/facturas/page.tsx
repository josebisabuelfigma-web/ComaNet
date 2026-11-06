import { FileText } from "lucide-react";

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
import { isPdf, signInvoiceUrls } from "@/lib/invoices";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CashMovement } from "@/lib/supabase/types";

export default async function FacturasPage({
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
      .not("invoice_path", "is", null)
      .gte("created_at", fromTs)
      .lt("created_at", toTs)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
  ]);

  const list = (moves as CashMovement[]) ?? [];
  const money = (n: number) => formatMoney(n, org?.currency ?? "COP");
  const urls = await signInvoiceUrls(
    supabase,
    list.map((m) => m.invoice_path).filter((p): p is string => !!p)
  );
  const totalEgresos = list.filter((m) => m.type === "egreso").reduce((s, m) => s + Number(m.amount), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-ink">Facturas</h1>
          <p className="text-sm text-brand-muted">
            Soportes que adjuntaste al registrar ingresos y egresos. {list.length} en este periodo
            {list.length > 0 ? ` · egresos con factura ${money(totalEgresos)}` : ""}.
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

      {list.length === 0 ? (
        <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white p-10 text-center text-brand-muted">
          No hay facturas en estas fechas. Adjúntalas desde Ingresos y egresos.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((move) => {
            const url = move.invoice_path ? urls.get(move.invoice_path) : undefined;
            const pdf = isPdf(move.invoice_path);
            return (
              <Card key={move.id}>
                <CardContent className="flex flex-col gap-3 p-4">
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-40 items-center justify-center overflow-hidden rounded-[var(--radius-brand-sm)] bg-black/[0.04]"
                    >
                      {pdf ? (
                        <FileText className="h-12 w-12 text-brand-muted" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={`Factura: ${move.description}`} className="h-full w-full object-cover" />
                      )}
                    </a>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-brand-ink">{move.description}</p>
                    <Badge variant={move.type === "egreso" ? "danger" : "success"}>
                      {move.type === "egreso" ? "Egreso" : "Ingreso"}
                    </Badge>
                  </div>
                  <p className="text-xl font-semibold text-brand-ink">{money(Number(move.amount))}</p>
                  <p className="text-sm text-brand-muted">
                    {formatDateTime(move.created_at)} · <span className="capitalize">{move.payment_method}</span>
                  </p>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="w-full">
                        {pdf ? "Abrir PDF" : "Ver factura"}
                      </Button>
                    </a>
                  ) : (
                    <p className="text-sm text-brand-danger">No se pudo cargar el archivo.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
