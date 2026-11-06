import Link from "next/link";

import { requireOrgRole } from "@/lib/auth";
import { isModuleEnabled, requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { cleanSearch, dateTimeRange, formatDateTime, formatMoney, normalizeDateTime, todayInColombia } from "@/lib/format";
import { RangeFilter } from "@/components/range-filter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CashMovement, SalesByProductRow, SalesSummaryRow } from "@/lib/supabase/types";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-brand-muted">{label}</p>
        <p className="text-2xl font-semibold text-brand-ink">{value}</p>
        {hint && <p className="text-xs text-brand-muted">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
}) {
  const profile = await requireOrgRole("owner");
  await requireModule(profile.organization_id, MODULE_KEYS.REPORTES);

  const params = await searchParams;
  const today = todayInColombia();
  const range = dateTimeRange(
    normalizeDateTime(params.from, `${today}T00:00`),
    normalizeDateTime(params.to, `${today}T23:59`, true)
  );
  const { from: fromTs, to: toTs } = range;
  const search = cleanSearch(params.q);

  const supabase = await createClient();
  const [finanzasOn, cajaOn] = await Promise.all([
    isModuleEnabled(profile.organization_id, MODULE_KEYS.FINANZAS),
    isModuleEnabled(profile.organization_id, MODULE_KEYS.CAJA),
  ]);
  const showMovements = finanzasOn || cajaOn;

  const [{ data: summary }, { data: byProduct }, { data: org }, { data: moves }] = await Promise.all([
    supabase.rpc("report_sales_summary", { p_from: fromTs, p_to: toTs }),
    supabase.rpc("report_sales_by_product", { p_from: fromTs, p_to: toTs }),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
    showMovements
      ? (() => {
          let query = supabase
            .from("cash_movements")
            .select("*")
            .eq("organization_id", profile.organization_id)
            .gte("created_at", fromTs)
            .lt("created_at", toTs);
          if (search) query = query.or(`description.ilike.%${search}%,counterparty.ilike.%${search}%`);
          return query.order("created_at", { ascending: false }).limit(300);
        })()
      : Promise.resolve({ data: [] as CashMovement[] }),
  ]);

  const movements = (moves as CashMovement[]) ?? [];
  const sumMoves = (type: "ingreso" | "egreso", method?: string) =>
    movements
      .filter((m) => m.type === type && (!method || m.payment_method === method))
      .reduce((acc, m) => acc + Number(m.amount), 0);
  const ingresos = sumMoves("ingreso");
  const egresos = sumMoves("egreso");

  const currency = org?.currency ?? "COP";
  const money = (n: number) => formatMoney(n, currency);
  const rows = (summary as SalesSummaryRow[]) ?? [];

  const sum = (filter: (r: SalesSummaryRow) => boolean, field: "total" | "orders_count" | "subtotal" | "delivery_fees" | "disposables") =>
    rows.filter(filter).reduce((acc, r) => acc + Number(r[field]), 0);

  const totalSales = sum(() => true, "total");
  const totalOrders = sum(() => true, "orders_count");
  const domTotal = sum((r) => r.fulfillment === "domicilio", "total");
  const domOrders = sum((r) => r.fulfillment === "domicilio", "orders_count");
  const domFees = sum((r) => r.fulfillment === "domicilio", "delivery_fees");
  const domDisposables = sum((r) => r.fulfillment === "domicilio", "disposables");
  const pickupTotal = sum((r) => r.fulfillment === "recoger", "total");
  const pickupOrders = sum((r) => r.fulfillment === "recoger", "orders_count");
  const mesaTotal = sum((r) => r.channel === "mesa", "total");
  const mesaOrders = sum((r) => r.channel === "mesa", "orders_count");
  const cashTotal = sum((r) => r.payment_method === "efectivo", "total");
  const transferTotal = sum((r) => r.payment_method === "transferencia", "total");

  const channels = [
    { label: "Domicilio", match: (r: SalesSummaryRow) => r.fulfillment === "domicilio" },
    { label: "Para recoger", match: (r: SalesSummaryRow) => r.fulfillment === "recoger" },
    { label: "Mesa", match: (r: SalesSummaryRow) => r.channel === "mesa" },
  ].map((c) => ({
    label: c.label,
    orders: sum(c.match, "orders_count"),
    total: sum(c.match, "total"),
    cash: sum((r) => c.match(r) && r.payment_method === "efectivo", "total"),
    transfer: sum((r) => c.match(r) && r.payment_method === "transferencia", "total"),
  }));

  // Pivot por producto (no por categoría).
  const products = new Map<string, { name: string; dom: number; mesa: number; revenue: number }>();
  for (const row of (byProduct as SalesByProductRow[]) ?? []) {
    const current = products.get(row.product_name) ?? { name: row.product_name, dom: 0, mesa: 0, revenue: 0 };
    if (row.channel === "domicilio") current.dom += Number(row.quantity);
    else current.mesa += Number(row.quantity);
    current.revenue += Number(row.revenue);
    products.set(row.product_name, current);
  }
  const productList = [...products.values()].sort((a, b) => b.dom + b.mesa - (a.dom + a.mesa));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-ink">Reportes de ventas</h1>
          <p className="text-sm text-brand-muted">
            Solo cuentan los pedidos y las mesas ya cobrados en caja. Puedes filtrar por fecha y hora (útil para turnos que pasan de medianoche).
          </p>
        </div>
        <RangeFilter
          fromLocal={range.fromLocal}
          toLocal={range.toLocal}
          query={search}
          searchLabel={showMovements ? "Buscar en ingresos y egresos" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ventas totales" value={money(totalSales)} hint={`${totalOrders} pedidos / cuentas`} />
        <Stat label="Ventas por domicilio" value={money(domTotal)} hint={`${domOrders} pedidos`} />
        <Stat label="Pedidos para recoger" value={money(pickupTotal)} hint={`${pickupOrders} pedidos`} />
        <Stat label="Ventas en mesa" value={money(mesaTotal)} hint={`${mesaOrders} cuentas`} />
        <Stat
          label="Cobrado en domicilio"
          value={money(domFees + domDisposables)}
          hint={`Domicilios ${money(domFees)} · Desechables ${money(domDisposables)}`}
        />
        <Stat label="En efectivo" value={money(cashTotal)} />
        <Stat label="Por transferencia" value={money(transferTotal)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ventas por canal</CardTitle>
          <CardDescription>Cada venta cuenta una sola vez, según cómo se atendió.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-brand-border text-left text-brand-muted">
                <th className="p-2 font-medium">Canal</th>
                <th className="p-2 text-right font-medium">Pedidos / cuentas</th>
                <th className="p-2 text-right font-medium">Efectivo</th>
                <th className="p-2 text-right font-medium">Transferencia</th>
                <th className="p-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.label} className="border-b border-brand-border last:border-0">
                  <td className="p-2 font-medium text-brand-ink">{c.label}</td>
                  <td className="p-2 text-right">{c.orders}</td>
                  <td className="p-2 text-right">{money(c.cash)}</td>
                  <td className="p-2 text-right">{money(c.transfer)}</td>
                  <td className="p-2 text-right font-semibold">{money(c.total)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="p-2">Total ventas</td>
                <td className="p-2 text-right">{totalOrders}</td>
                <td className="p-2 text-right">{money(cashTotal)}</td>
                <td className="p-2 text-right">{money(transferTotal)}</td>
                <td className="p-2 text-right">{money(totalSales)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Por medio de pago</CardTitle>
          <CardDescription>
            {showMovements
              ? "Cuánto entró y salió en efectivo y cuánto por transferencia. El neto es ventas + ingresos − egresos."
              : "Cuánto se vendió en efectivo y cuánto por transferencia."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-brand-border text-left text-brand-muted">
                <th className="p-2 font-medium">Medio de pago</th>
                <th className="p-2 text-right font-medium">Ventas</th>
                {showMovements && (
                  <>
                    <th className="p-2 text-right font-medium">Ingresos</th>
                    <th className="p-2 text-right font-medium">Egresos</th>
                    <th className="p-2 text-right font-medium">Neto</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  { label: "Efectivo", method: "efectivo", sales: cashTotal },
                  { label: "Transferencia", method: "transferencia", sales: transferTotal },
                ] as const
              ).map((row) => {
                const ing = sumMoves("ingreso", row.method);
                const egr = sumMoves("egreso", row.method);
                return (
                  <tr key={row.method} className="border-b border-brand-border last:border-0">
                    <td className="p-2 font-medium text-brand-ink">{row.label}</td>
                    <td className="p-2 text-right">{money(row.sales)}</td>
                    {showMovements && (
                      <>
                        <td className="p-2 text-right text-brand-success">{money(ing)}</td>
                        <td className="p-2 text-right text-brand-danger">{money(egr)}</td>
                        <td className="p-2 text-right font-semibold">{money(row.sales + ing - egr)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <td className="p-2">Total</td>
                <td className="p-2 text-right">{money(totalSales)}</td>
                {showMovements && (
                  <>
                    <td className="p-2 text-right">{money(ingresos)}</td>
                    <td className="p-2 text-right">{money(egresos)}</td>
                    <td className="p-2 text-right">{money(totalSales + ingresos - egresos)}</td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {showMovements && (
        <Card>
          <CardHeader>
            <CardTitle>Ingresos y egresos</CardTitle>
            <CardDescription>
              Dinero que entró o salió del negocio fuera de las ventas (compras, pagos, servicios…).{" "}
              {finanzasOn && (
                <Link href="/dashboard/finanzas" className="underline">
                  Registrar o ver facturas
                </Link>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Ingresos" value={money(ingresos)} hint={`Efectivo ${money(sumMoves("ingreso", "efectivo"))} · Transf. ${money(sumMoves("ingreso", "transferencia"))}`} />
              <Stat label="Egresos (gastos)" value={money(egresos)} hint={`Efectivo ${money(sumMoves("egreso", "efectivo"))} · Transf. ${money(sumMoves("egreso", "transferencia"))}`} />
              <Stat label="Ventas − egresos" value={money(totalSales - egresos)} hint="Lo que queda después de los gastos" />
              <Stat label="Resultado del periodo" value={money(totalSales + ingresos - egresos)} hint="Ventas + ingresos − egresos" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-brand-border text-left text-brand-muted">
                    <th className="p-2 font-medium">Fecha y hora</th>
                    <th className="p-2 font-medium">Descripción</th>
                    <th className="p-2 font-medium">Persona / proveedor</th>
                    <th className="p-2 font-medium">Medio</th>
                    <th className="p-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-brand-muted">
                        No hay ingresos ni egresos con estos filtros.
                      </td>
                    </tr>
                  )}
                  {movements.map((move) => (
                    <tr key={move.id} className="border-b border-brand-border last:border-0">
                      <td className="whitespace-nowrap p-2">{formatDateTime(move.created_at)}</td>
                      <td className="p-2">
                        {move.description}{" "}
                        {move.invoice_path && <Badge variant="muted">con factura</Badge>}
                      </td>
                      <td className="p-2">{move.counterparty ?? <span className="text-brand-muted">—</span>}</td>
                      <td className="p-2 capitalize">{move.payment_method}</td>
                      <td
                        className={`whitespace-nowrap p-2 text-right font-medium ${
                          move.type === "ingreso" ? "text-brand-success" : "text-brand-danger"
                        }`}
                      >
                        {move.type === "ingreso" ? "+" : "−"}
                        {money(Number(move.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Unidades vendidas por producto</CardTitle>
          <CardDescription>
            Ordenado de más a menos vendido. Los combos se desglosan producto por producto.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-brand-border text-left text-brand-muted">
                <th className="p-2 font-medium">Producto</th>
                <th className="p-2 text-right font-medium">Domicilio</th>
                <th className="p-2 text-right font-medium">Mesa</th>
                <th className="p-2 text-right font-medium">Total unidades</th>
                <th className="p-2 text-right font-medium">Ventas</th>
              </tr>
            </thead>
            <tbody>
              {productList.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-brand-muted">
                    No hay ventas en este rango.
                  </td>
                </tr>
              )}
              {productList.map((product) => (
                <tr key={product.name} className="border-b border-brand-border last:border-0">
                  <td className="p-2 font-medium text-brand-ink">{product.name}</td>
                  <td className="p-2 text-right">{product.dom}</td>
                  <td className="p-2 text-right">{product.mesa}</td>
                  <td className="p-2 text-right font-semibold">{product.dom + product.mesa}</td>
                  <td className="p-2 text-right">{money(product.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
