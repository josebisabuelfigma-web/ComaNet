"use client";

import * as React from "react";
import { ArrowLeftRight, Banknote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/lib/supabase/types";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  total: number;
  currency: string;
  /** Medio que indicó el cliente o el mesero; caja puede cambiarlo. */
  defaultMethod: PaymentMethod | null;
  /** Devuelve el error a mostrar, o nada si el cobro quedó hecho. */
  onConfirm: (method: PaymentMethod, cashReceived: number | null) => Promise<{ error?: string } | void>;
}

/** Cobro único de mesas y domicilios: valor, dinero recibido y cambio. */
export function PaymentDialog({
  open,
  onOpenChange,
  title,
  total,
  currency,
  defaultMethod,
  onConfirm,
}: PaymentDialogProps) {
  const [method, setMethod] = React.useState<PaymentMethod>(defaultMethod ?? "efectivo");
  const [received, setReceived] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMethod(defaultMethod ?? "efectivo");
    setReceived("");
    setError(null);
  }, [open, defaultMethod]);

  const money = (n: number) => formatMoney(n, currency);
  const receivedNumber = Number(received || 0);
  const change = receivedNumber - total;
  const canConfirm = method === "transferencia" || (received !== "" && change >= 0);

  async function handleConfirm(event: React.FormEvent) {
    event.preventDefault();
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    const result = await onConfirm(method, method === "efectivo" ? receivedNumber : null);
    setBusy(false);
    if (result?.error) setError(result.error);
    else onOpenChange(false);
  }

  const methodButton = (value: PaymentMethod, label: string, Icon: typeof Banknote) => (
    <button
      type="button"
      onClick={() => setMethod(value)}
      aria-pressed={method === value}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-brand-sm)] border px-3 py-2.5 text-sm font-medium",
        method === value
          ? "border-brand bg-brand text-brand-ink"
          : "border-brand-border bg-white text-brand-muted hover:bg-black/5"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Al aceptar se cierra y cuenta como venta del turno.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirm} className="flex flex-col gap-4">
          <div className="rounded-[var(--radius-brand-sm)] bg-black/[0.03] p-3 text-center">
            <p className="text-sm text-brand-muted">Valor a pagar</p>
            <p className="text-3xl font-bold text-brand-ink">{money(total)}</p>
          </div>

          <div className="flex gap-2">
            {methodButton("efectivo", "Efectivo", Banknote)}
            {methodButton("transferencia", "Transferencia", ArrowLeftRight)}
          </div>

          {method === "efectivo" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cash-received">¿Cuánto recibiste?</Label>
              <div className="flex gap-2">
                <Input
                  id="cash-received"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  autoFocus
                  value={received}
                  onChange={(event) => setReceived(event.target.value)}
                  placeholder={String(total)}
                />
                <Button type="button" variant="outline" onClick={() => setReceived(String(total))}>
                  Exacto
                </Button>
              </div>
              {received !== "" &&
                (change >= 0 ? (
                  <p className="text-lg font-semibold text-brand-success">Cambio: {money(change)}</p>
                ) : (
                  <p className="text-sm font-medium text-brand-danger">Faltan {money(Math.abs(change))}</p>
                ))}
            </div>
          ) : (
            <p className="text-sm text-brand-muted">
              Verifica en tu cuenta que llegó la transferencia por {money(total)} y acepta.
            </p>
          )}

          {error && <p className="text-sm text-brand-danger">{error}</p>}

          <Button type="submit" size="lg" disabled={busy || !canConfirm}>
            {busy ? "Guardando…" : "Aceptar y cerrar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
