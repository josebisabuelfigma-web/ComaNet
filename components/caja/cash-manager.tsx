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

/** Renglón de una cuenta: "+ Ventas en efectivo ...... $X". */
function Line({ sign, label, value, bold }: { sign?: "+" | "−" | "="; label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-sm ${bold ? "border-t border-brand-border pt-2 font-semibold text-brand-ink" : "text-brand-muted"}`}>
      <span>
        {sign && <span className="mr-1.5 inline-block w-3 text-center">{sign}</span>}
        {label}
      </span>
      <span className={bold ? "text-lg" : "text-brand-ink"}>{value}</span>
    </div>
  );
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
  const [countedTransfer, setCountedTransfer] = React.useState("");
  const [closeNotes, setCloseNotes] = React.useState("");
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Dos cuentas separadas: el efectivo (cajón) y las transferencias (cuenta del banco).
  const sumBy = (type: "ingreso" | "egreso", method: "efectivo" | "transferencia") =>
    movements
      .filter((m) => m.type === type && m.payment_method === method)
      .reduce((acc, m) => acc + Number(m.amount), 0);
  const cashIn = sumBy("ingreso", "efectivo");
  const cashOut = sumBy("egreso", "efectivo");
  const transferIn = sumBy("ingreso", "transferencia");
  const transferOut = sumBy("egreso", "transferencia");

  const opening_ = session ? Number(session.opening_amount) : 0;
  const expected = opening_ + cashSales + cashIn - cashOut;
  const expectedTransfer = transferSales + transferIn - transferOut;
  const expectedTotal = expected + expectedTransfer;

  const countedNumber = Number(counted);
  const countedTransferNumber = Number(countedTransfer);
  const difference = counted === "" ? null : countedNumber - expected;
  // Si no hubo movimiento por transferencia no hay nada que verificar.
  const transferNeeded = expectedTransfer !== 0;
  const transferEntered = countedTransfer !== "";
  const differenceTransfer = transferEntered
    ? countedTransferNumber - expectedTransfer
    : transferNeeded
      ? null
      : 0;
  const differenceTotal =
    difference !== null && differenceTransfer !== null ? difference + differenceTransfer : null;
  const canClose = counted !== "" && (!transferNeeded || transferEntered);

  const diffText = (value: number) =>
    value === 0 ? "Cuadra" : value > 0 ? `Sobrante ${money(value)}` : `Faltante ${money(Math.abs(value))}`;
  const diffClass = (value: number) => (value === 0 ? "text-brand-success" : "text-brand-danger");

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
    const ok = await run(() =>
      closeCash(session.id, countedNumber, transferEntered ? countedTransferNumber : null, closeNotes)
    );
    setConfirmClose(false);
    if (ok) {
      setCounted("");
      setCountedTransfer("");
      setCloseNotes("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Caja</h1>
        <p className="text-sm text-brand-muted">
          Abre con la base, registra ingresos y egresos, y cierra cuadrando el efectivo y las transferencias por separado.
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
            <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-[var(--radius-brand-sm)] bg-black/[0.03] p-4">
                <p className="font-semibold text-brand-ink">Efectivo (cajón)</p>
                <Line sign="+" label="Base inicial" value={money(opening_)} />
                <Line sign="+" label={`Ventas en efectivo (${ordersCount} pedidos en total)`} value={money(cashSales)} />
                <Line sign="+" label="Ingresos en efectivo" value={money(cashIn)} />
                <Line sign="−" label="Egresos en efectivo" value={money(cashOut)} />
                <Line sign="=" label="Efectivo que debería haber" value={money(expected)} bold />
              </div>
              <div className="flex flex-col gap-2 rounded-[var(--radius-brand-sm)] bg-black/[0.03] p-4">
                <p className="font-semibold text-brand-ink">Transferencias (cuenta)</p>
                <Line sign="+" label="Ventas por transferencia" value={money(transferSales)} />
                <Line sign="+" label="Ingresos por transferencia" value={money(transferIn)} />
                <Line sign="−" label="Egresos por transferencia" value={money(transferOut)} />
                <Line sign="=" label="Transferencias del turno que deberías ver" value={money(expectedTransfer)} bold />
              </div>
              <div className="lg:col-span-2">
                <Stat label="Total esperado del turno (efectivo + transferencias)" value={money(expectedTotal)} strong />
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
                            Transferencia
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
                  Cuenta el efectivo y revisa las transferencias en tu cuenta; cada una debe cuadrar con lo esperado.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="counted">Efectivo contado en el cajón</Label>
                  <Input
                    id="counted"
                    type="number"
                    min={0}
                    step="any"
                    value={counted}
                    onChange={(event) => setCounted(event.target.value)}
                  />
                  {difference !== null && (
                    <p className={`text-sm font-medium ${diffClass(difference)}`}>Efectivo: {diffText(difference)}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="countedTransfer">
                    Transferencias del turno según tu cuenta (recibido − pagado)
                  </Label>
                  <Input
                    id="countedTransfer"
                    type="number"
                    step="any"
                    value={countedTransfer}
                    onChange={(event) => setCountedTransfer(event.target.value)}
                    placeholder={transferNeeded ? String(expectedTransfer) : "0"}
                  />
                  <p className="text-xs text-brand-muted">
                    {transferNeeded
                      ? "Revisa el banco o la app: suma lo que entró por ventas e ingresos y resta lo que pagaste por transferencia en este turno."
                      : "No hubo movimientos por transferencia en este turno."}
                  </p>
                  {differenceTransfer !== null && transferNeeded && (
                    <p className={`text-sm font-medium ${diffClass(differenceTransfer)}`}>
                      Transferencias: {diffText(differenceTransfer)}
                    </p>
                  )}
                </div>
                {differenceTotal !== null && (
                  <p className={`text-sm font-semibold ${diffClass(differenceTotal)}`}>
                    Total del turno: {diffText(differenceTotal)}
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
                  disabled={busy || !canClose}
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
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-brand-border text-left text-brand-muted">
                  <th className="p-2 font-medium">Cierre</th>
                  <th className="p-2 font-medium">Base</th>
                  <th className="p-2 font-medium">Ventas efectivo</th>
                  <th className="p-2 font-medium">Esperado efectivo</th>
                  <th className="p-2 font-medium">Contado</th>
                  <th className="p-2 font-medium">Dif. efectivo</th>
                  <th className="p-2 font-medium">Esperado transf.</th>
                  <th className="p-2 font-medium">Verificado</th>
                  <th className="p-2 font-medium">Dif. transf.</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-brand-border last:border-0">
                    <td className="p-2 whitespace-nowrap">{formatDateTime(row.closed_at)}</td>
                    <td className="p-2">{money(Number(row.opening_amount))}</td>
                    <td className="p-2">{money(Number(row.summary?.cash_sales ?? 0))}</td>
                    <td className="p-2">{money(Number(row.expected_cash ?? 0))}</td>
                    <td className="p-2">{money(Number(row.counted_cash ?? 0))}</td>
                    <td className={`p-2 font-medium ${diffClass(Number(row.difference ?? 0))}`}>
                      {money(Number(row.difference ?? 0))}
                    </td>
                    {row.expected_transfer === null ? (
                      <td className="p-2 text-brand-muted" colSpan={3}>
                        Transferencias sin verificar (cierre anterior). Ventas: {money(Number(row.summary?.transfer_sales ?? 0))}
                      </td>
                    ) : (
                      <>
                        <td className="p-2">{money(Number(row.expected_transfer))}</td>
                        <td className="p-2">{money(Number(row.counted_transfer ?? 0))}</td>
                        <td className={`p-2 font-medium ${diffClass(Number(row.difference_transfer ?? 0))}`}>
                          {money(Number(row.difference_transfer ?? 0))}
                        </td>
                      </>
                    )}
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
        description={`Efectivo: contado ${money(countedNumber)}, esperado ${money(expected)}. Transferencias: ${transferEntered ? `verificado ${money(countedTransferNumber)}` : "sin movimientos"}, esperado ${money(expectedTransfer)}. Esta acción no se puede deshacer.`}
        confirmLabel="Cerrar caja"
        isLoading={busy}
        onConfirm={handleClose}
      />
    </div>
  );
}
