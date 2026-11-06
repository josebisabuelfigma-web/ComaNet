import { Button } from "@/components/ui/button";

const fieldClass =
  "h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm text-brand-ink";

/**
 * Filtro por fecha Y hora (hora de Colombia) con búsqueda opcional. Es un
 * formulario GET normal: no necesita JavaScript. Sirve para turnos que cruzan
 * la medianoche (ej. viernes 4:00 pm → sábado 2:00 am).
 */
export function RangeFilter({
  fromLocal,
  toLocal,
  query,
  searchLabel,
  invoiceFilter,
  onlyInvoice,
}: {
  fromLocal: string;
  toLocal: string;
  query?: string;
  /** Si se indica, muestra la casilla de búsqueda con esa etiqueta. */
  searchLabel?: string;
  /** Muestra la casilla "Solo con factura". */
  invoiceFilter?: boolean;
  onlyInvoice?: boolean;
}) {
  return (
    <form className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-brand-muted">
        Desde (fecha y hora)
        <input type="datetime-local" name="from" defaultValue={fromLocal} className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-brand-muted">
        Hasta (fecha y hora)
        <input type="datetime-local" name="to" defaultValue={toLocal} className={fieldClass} />
      </label>
      {searchLabel && (
        <label className="flex flex-col gap-1 text-xs text-brand-muted">
          {searchLabel}
          <input
            type="search"
            name="q"
            defaultValue={query ?? ""}
            placeholder="Nombre, proveedor o descripción"
            className={`${fieldClass} w-60`}
          />
        </label>
      )}
      {invoiceFilter && (
        <label className="flex h-10 items-center gap-2 text-sm text-brand-ink">
          <input type="checkbox" name="factura" value="1" defaultChecked={onlyInvoice} className="h-4 w-4" />
          Solo con factura
        </label>
      )}
      <Button type="submit">Ver</Button>
    </form>
  );
}
