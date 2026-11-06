"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MovementForm } from "@/components/finanzas/movement-form";
import { closeCash, openCash } from "@/lib/actions/caja";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { CashMovement, CashSession } from "@/lib/supabase/types";

interface CashManagerProps {
  session: CashSession | null;
  movements: CashMovement[];
  history: CashSession[];
  cashSales: number;
  transferSales: number;
  ordersCount: number;
  currency: string;
  /** El módulo de facturas está activo: el formulario permite adjuntar factura. */
  invoiceEnabled: boolean;
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-[var(--radius-brand-sm)] bg-black/[0.03] p-3">
      <p className="text-xs text-brand-muted">{label}</p>
      <p className={`${strong ? "text-xl" : "text-base"} font-semibold text-brand-ink`}>{value}</p>
    </div>
  );
}

export function CashManager({
  session,
  movements,
  history,
  cashSales,
  transferSales,
  ordersCount,
  currency,
  invoiceEnabled,
}: CashManagerProps) {
  const router = useRouter();
  const money = (n: number) => formatMoney(n, currency);
  const [opening, setOpening] = React.useState("");
  const [counted, setCounted] = React.useState("");
  const [closeNotes, setCloseNotes] = React.useState("");
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Solo el efectivo mueve el arqueo; las transferencias se listan pero no cuentan.
  const cashMoves = movements.filter((m) => m.payment_method === "efectivo");
  const ingresos = cashMoves.filter((m) => m.type === "ingreso").reduce((s, m) => s + Number(m.amount), 0);
  const egresos = cashMoves.filter((m) => m.type === "egreso").reduce((s, m) => s + Number(m.amount), 0);
  const expected = (session ? Number(session.opening_amount) : 0) + cashSales + ingresos - egresos;
  const countedNumber = Number(counted);
  const difference = counted === "" ? null : countedNumber - expected;

  async function run(action: () => Promise<{ error?: string } | void>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function handleOpen(event: React.FormEvent) {
    event.preventDefault();
    if (await run(() => openCash(Number(opening || 0)))) setOpening("");
  }

  async function handleClose() {
    if (!session) return;
    const ok = await run(() => closeCash(session.id, countedNumber, closeNotes));
    setConfirmClose(false);
    if (ok) {
      setCounted("");
      setCloseNotes("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Caja</h1>
        <p className="text-sm text-brand-muted">
          Abre con la base, registra ingresos y egresos, y cierra con el arqueo de efectivo.
        </p>
      </div>

      {!session ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Abrir caja</CardTitle>
            <CardDescription>
              Escribe el efectivo con el que inicia el turno (la base).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleOpen} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="opening">Base inicial</Label>
                <Input
                  id="opening"
                  type="number"
                  min={0}
                  step="any"
                  value={opening}
                  onChange={(event) => setOpening(event.target.value)}
                  placeholder="0"
                  required
                />
              </div>
              {error && <p className="text-sm text-brand-danger">{error}</p>}
              <Button type="submit" disabled={busy} className="w-fit">
                Abrir caja
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Caja abierta <Badge variant="success">En curso</Badge>
              </CardTitle>
              <CardDescription>Desde {formatDateTime(session.opened_at)}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Base inicial" value={money(Number(session.opening_amount))} />
              <Stat label={`Ventas en efectivo (${ordersCount} pedidos en total)`} value={money(cashSales)} />
              <Stat label="Ventas por transferencia" value={money(transferSales)} />
              <Stat label="Ingresos − egresos" value={money(ingresos - egresos)} />
              <div className="col-span-2 lg:col-span-4">
                <Stat label="Efectivo que debería haber en caja" value={money(expected)} strong />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Ingresos y egresos</CardTitle>
                <CardDescription>
                  Registra aquí los gastos del turno (compras, pagos, servicios) o el dinero que entra a la caja.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <MovementForm allowInvoice={invoiceEnabled} />
                <ul className="flex flex-col divide-y divide-brand-border text-sm">
                  {movements.length === 0 && <li className="py-2 text-brand-muted">Sin movimientos.</li>}
                  {movements.map((move) => (
                    <li key={move.id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        {move.description}
                        {move.counterparty && <span className="ml-1 text-brand-muted">· {move.counterparty}</span>}
                        {move.payment_method === "transferencia" && (
                          <Badge variant="muted" className="ml-2">
                            Transferencia · no afecta el efectivo
                          </Badge>
                        )}
                        {move.invoice_path && (
                          <Badge variant="muted" className="ml-2">
                            con factura
                          </Badge>
                        )}
                        <span className="ml-2 text-xs text-brand-muted">{formatDateTime(move.created_at)}</span>
                      </span>
                      <span className={move.type === "ingreso" ? "text-brand-success" : "text-brand-danger"}>
                        {move.type === "ingreso" ? "+" : "−"}
                        {money(Number(move.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cerrar caja (arqueo)</CardTitle>
                <CardDescription>
                  Cuenta el efectivo físico y compáralo con lo esperado.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="counted">Efectivo contado</Label>
                  <Input
                    id="counted"
                    type="number"
                    min={0}
                    step="any"
                    value={counted}
                    onChange={(event) => setCounted(event.target.value)}
                  />
                </div>
                {difference !== null && (
                  <p
                    className={`text-sm font-medium ${
                      difference === 0 ? "text-brand-success" : "text-brand-danger"
                    }`}
                  >
                    {difference === 0
                      ? "La caja cuadra."
                      : difference > 0
                        ? `Sobrante: ${money(difference)}`
                        : `Faltante: ${money(Math.abs(difference))}`}
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="closeNotes">Observaciones (opcional)</Label>
                  <Input id="closeNotes" value={closeNotes} onChange={(event) => setCloseNotes(event.target.value)} />
                </div>
                {error && <p className="text-sm text-brand-danger">{error}</p>}
                <Button
                  variant="dark"
                  className="w-fit"
                  disabled={busy || counted === ""}
                  onClick={() => setConfirmClose(true)}
                >
                  Cerrar caja
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cierres anteriores</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-brand-border text-left text-brand-muted">
                  <th className="p-2 font-medium">Cierre</th>
                  <th className="p-2 font-medium">Base</th>
                  <th className="p-2 font-medium">Ventas efectivo</th>
                  <th className="p-2 font-medium">Transferencias</th>
                  <th className="p-2 font-medium">Esperado</th>
                  <th className="p-2 font-medium">Contado</th>
                  <th className="p-2 font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-brand-border last:border-0">
                    <td className="p-2 whitespace-nowrap">{formatDateTime(row.closed_at)}</td>
                    <td className="p-2">{money(Number(row.opening_amount))}</td>
                    <td className="p-2">{money(Number(row.summary?.cash_sales ?? 0))}</td>
                    <td className="p-2">{money(Number(row.summary?.transfer_sales ?? 0))}</td>
                    <td className="p-2">{money(Number(row.expected_cash ?? 0))}</td>
                    <td className="p-2">{money(Number(row.counted_cash ?? 0))}</td>
                    <td
                      className={`p-2 font-medium ${
                        Number(row.difference) === 0 ? "text-brand-success" : "text-brand-danger"
                      }`}
                    >
                      {money(Number(row.difference ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Cerrar caja"
        description={`Vas a cerrar el turno con ${money(countedNumber)} contados (esperado ${money(expected)}). Esta acción no se puede deshacer.`}
        confirmLabel="Cerrar caja"
        isLoading={busy}
        onConfirm={handleClose}
      />
    </div>
  );
}
