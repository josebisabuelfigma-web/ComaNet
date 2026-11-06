"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shrinkImage } from "@/components/image-picker";
import { registerMovement } from "@/lib/actions/finanzas";

const selectClass =
  "h-10 w-full rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-2 text-sm";

/** Formulario de ingreso / egreso con factura opcional (imagen o PDF). */
export function MovementForm() {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [type, setType] = React.useState<"ingreso" | "egreso">("egreso");
  const [payment, setPayment] = React.useState<"efectivo" | "transferencia">("efectivo");
  const [amount, setAmount] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [counterparty, setCounterparty] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    // Las fotos de celular pesan varios MB: se reducen manteniendo el texto legible.
    const ready = picked.type.startsWith("image/") ? await shrinkImage(picked, 2000) : picked;
    setFile(ready);
  }

  function clearFile() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const data = new FormData();
    data.set("type", type);
    data.set("payment", payment);
    data.set("amount", amount);
    data.set("description", description);
    data.set("counterparty", counterparty);
    if (file) data.set("invoice", file);

    const result = await registerMovement(data);
    setBusy(false);
    if (result?.error) return setError(result.error);

    setAmount("");
    setDescription("");
    setCounterparty("");
    clearFile();
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      <div className="flex flex-col gap-1.5 sm:col-span-1">
        <Label htmlFor="mv-type">Tipo</Label>
        <select
          id="mv-type"
          value={type}
          onChange={(event) => setType(event.target.value as "ingreso" | "egreso")}
          className={selectClass}
        >
          <option value="egreso">Egreso</option>
          <option value="ingreso">Ingreso</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="mv-amount">Valor</Label>
        <Input
          id="mv-amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Ej: 200000"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-3">
        <Label htmlFor="mv-description">Descripción</Label>
        <Input
          id="mv-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={200}
          placeholder="Ej: pago recibo de energía"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-4">
        <Label htmlFor="mv-counterparty">
          {type === "egreso" ? "Pagado a (persona o proveedor, opcional)" : "Recibido de (persona o cliente, opcional)"}
        </Label>
        <Input
          id="mv-counterparty"
          value={counterparty}
          onChange={(event) => setCounterparty(event.target.value)}
          maxLength={120}
          placeholder={type === "egreso" ? "Ej: Electrificadora, Don Pedro" : "Ej: Juan Pérez"}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="mv-payment">Medio de pago</Label>
        <select
          id="mv-payment"
          value={payment}
          onChange={(event) => setPayment(event.target.value as "efectivo" | "transferencia")}
          className={selectClass}
        >
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-6">
        <Label>Factura o soporte (opcional)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp className="h-4 w-4" />
            {file ? "Cambiar archivo" : "Subir imagen o PDF"}
          </Button>
          {file && (
            <span className="flex items-center gap-1 text-sm text-brand-muted">
              {file.name}
              <button type="button" onClick={clearFile} aria-label="Quitar archivo">
                <X className="h-4 w-4" />
              </button>
            </span>
          )}
          <span className="text-xs text-brand-muted">JPG, PNG, WEBP o PDF. Máximo 5 MB.</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleFile}
          className="sr-only"
        />
      </div>
      {error && <p className="text-sm text-brand-danger sm:col-span-6">{error}</p>}
      {saved && <p className="text-sm text-brand-success sm:col-span-6">Movimiento guardado.</p>}
      <Button type="submit" disabled={busy} className="sm:col-span-6 sm:w-fit">
        {busy ? "Guardando…" : "Registrar"}
      </Button>
    </form>
  );
}
