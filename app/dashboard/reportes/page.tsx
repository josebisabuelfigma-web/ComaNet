import { requireOrgRole } from "@/lib/auth";
import { requireModule, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { dayRangeToTimestamps, formatMoney, normalizeDay, todayInColombia } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalesByProductRow, SalesSummaryRow } from "@/lib/supabase/types";

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
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const profile = await requireOrgRole("owner");
  await requireModule(profile.organization_id, MODULE_KEYS.REPORTES);

  const params = await searchParams;
  const today = todayInColombia();
  const from = normalizeDay(params.from, today);
  const to = normalizeDay(params.to, today);
  const range = from <= to ? { from, to } : { from: to, to: from };
  const { from: fromTs, to: toTs } = dayRangeToTimestamps(range.from, range.to);

  const supabase = await createClient();
  const [{ data: summary }, { data: byProduct }, { data: org }] = await Promise.all([
    supabase.rpc("report_sales_summary", { p_from: fromTs, p_to: toTs }),
    supabase.rpc("report_sales_by_product", { p_from: fromTs, p_to: toTs }),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
  ]);

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
            Solo cuentan los pedidos despachados y las cuentas de mesa cobradas.
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
