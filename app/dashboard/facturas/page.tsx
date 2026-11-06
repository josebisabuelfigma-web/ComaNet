import { redirect } from "next/navigation";

// Facturas se unió a Ingresos y egresos: se conservan los enlaces viejos.
export default function FacturasPage() {
  redirect("/dashboard/finanzas?factura=1");
}
