"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, Phone, Store, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cancelOrder, dispatchOrder } from "@/lib/actions/pedidos";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Order, OrderItem } from "@/lib/supabase/types";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "success" | "danger" | "muted" }> = {
  pendiente: { label: "Pendiente", variant: "default" },
  despachado: { label: "Despachado", variant: "success" },
  cancelado: { label: "Cancelado", variant: "danger" },
};

export function OrderCard({
  order,
  items,
  currency,
}: {
  order: Order;
  items: OrderItem[];
  currency: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const badge = STATUS_BADGE[order.status] ?? { label: order.status, variant: "muted" as const };
  const pending = order.status === "pendiente";

  async function handleDispatch() {
    setBusy(true);
    setError(null);
    const result = await dispatchOrder(order.id, order.order_number);
    setBusy(false);
    if (result?.error) return setError(result.error);
    router.refresh();
  }

  async function handleCancel() {
    setBusy(true);
    const result = await cancelOrder(order.id, order.order_number);
    setBusy(false);
    setConfirmCancel(false);
    if (result?.error) return setError(result.error);
    router.refresh();
  }

  return (
    <Card className={pending ? "border-brand" : undefined}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold text-brand-ink">Pedido #{order.order_number}</p>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Badge variant="outline">{order.fulfillment === "recoger" ? "Recoger" : "Domicilio"}</Badge>
          </div>
          <p className="text-sm text-brand-muted">{formatDateTime(order.created_at)}</p>
        </div>

        <div className="grid gap-1 text-sm text-brand-ink">
          <p className="font-medium">{order.customer_name}</p>
          {order.customer_phone && (
            <p className="flex items-center gap-1.5 text-brand-muted">
              <Phone className="h-3.5 w-3.5" />
              {order.customer_phone}
            </p>
          )}
          {order.fulfillment === "recoger" ? (
            <p className="flex items-center gap-1.5 font-medium text-brand-dark">
              <Store className="h-3.5 w-3.5" />
              Recoge en el local
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-brand-muted">
              <MapPin className="h-3.5 w-3.5" />
              {order.address}
            </p>
          )}
        </div>

        <ul className="flex flex-col gap-1 rounded-[var(--radius-brand-sm)] bg-black/[0.03] p-3 text-sm">
          {items.map((item) => (
            <li key={item.id}>
              <div className="flex justify-between gap-2">
                <span>
                  {item.quantity} × {item.product_name}
                </span>
                <span className="text-brand-muted">
                  {formatMoney(Number(item.unit_price) * item.quantity, currency)}
                </span>
              </div>
              {item.combo_snapshot && (
                <p className="text-xs text-brand-muted">
                  Incluye: {item.combo_snapshot.map((c) => `${c.quantity * item.quantity} ${c.name}`).join(", ")}
                </p>
              )}
              {item.notes && <p className="text-xs font-medium text-brand-danger">📝 {item.notes}</p>}
            </li>
          ))}
        </ul>

        {order.notes && <p className="text-sm text-brand-muted">Observaciones: {order.notes}</p>}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-sm text-brand-muted">
            <p>Productos: {formatMoney(order.subtotal, currency)}</p>
            {order.fulfillment !== "recoger" && (
              <p>Domicilio: {Number(order.delivery_fee) > 0 ? formatMoney(order.delivery_fee, currency) : "Gratis"}</p>
            )}
            {Number(order.disposables_fee) > 0 && <p>Desechables: {formatMoney(order.disposables_fee, currency)}</p>}
            <p className="mt-1 text-base font-semibold text-brand-ink">
              Total {formatMoney(order.total, currency)} ·{" "}
              <span className="capitalize">{order.payment_method}</span>
            </p>
          </div>

          {pending && (
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setConfirmCancel(true)}>
                <X className="h-4 w-4" />
                Cancelar
              </Button>
              <Button disabled={busy} onClick={handleDispatch}>
                <Check className="h-4 w-4" />
                Marcar despachado
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-brand-danger">{error}</p>}
      </CardContent>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancelar pedido"
        description={`¿Cancelar el pedido #${order.order_number}? No contará en las ventas.`}
        confirmLabel="Sí, cancelar"
        isLoading={busy}
        onConfirm={handleCancel}
      />
    </Card>
  );
}
