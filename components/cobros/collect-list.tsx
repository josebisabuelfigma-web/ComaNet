"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentDialog } from "@/components/cobros/payment-dialog";
import { closeTable } from "@/lib/actions/mesas";
import { closeDeliveryOrder } from "@/lib/actions/pedidos";
import { formatMoney, formatTime, whatsappLink } from "@/lib/format";
import { orderWhatsappMessage } from "@/lib/whatsapp-messages";
import type { PaymentMethod } from "@/lib/supabase/types";

export type CollectOrder = {
  id: string;
  number: number;
  title: string;
  detail: string | null;
  /** Desde cuándo espera el cobro (cuenta entregada o pedido enviado). */
  since: string | null;
  total: number;
  method: PaymentMethod | null;
  lines: string[];
  /** Solo domicilios: para el aviso opcional de WhatsApp al cerrar. */
  customerName?: string | null;
  customerPhone?: string | null;
  fulfillment?: string | null;
};

/** Mesas o domicilios por cobrar en caja. */
export function CollectList({
  kind,
  heading,
  description,
  emptyText,
  orders,
  currency,
  cashOpen,
}: {
  kind: "mesa" | "domicilio";
  heading: string;
  description: string;
  emptyText: string;
  orders: CollectOrder[];
  currency: string;
  cashOpen: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<CollectOrder | null>(null);
  // Domicilio recién cobrado: se ofrece (sin obligar) avisarle al cliente.
  const [justClosed, setJustClosed] = React.useState<{ number: number; url: string } | null>(null);

  async function collect(order: CollectOrder, method: PaymentMethod, cashReceived: number | null) {
    const result =
      kind === "mesa"
        ? await closeTable(order.id, method, cashReceived)
        : await closeDeliveryOrder(order.id, order.number, method, cashReceived);
    if (!result?.error) {
      if (kind === "domicilio") {
        const url = whatsappLink(
          order.customerPhone,
          orderWhatsappMessage(
            {
              status: "pagada",
              completed_at: new Date().toISOString(),
              order_number: order.number,
              customer_name: order.customerName ?? null,
              fulfillment: order.fulfillment,
            },
            "cerrado"
          )
        );
        setJustClosed(url ? { number: order.number, url } : null);
      }
      router.refresh();
    }
    return result;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/dashboard/caja"
          className="mb-1 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Caja
        </Link>
        <h1 className="text-2xl font-semibold text-brand-ink">{heading}</h1>
        <p className="text-sm text-brand-muted">{description}</p>
      </div>

      {!cashOpen && (
        <p className="rounded-[var(--radius-brand-sm)] bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          La caja está cerrada: ábrela para poder cobrar.{" "}
          <Link href="/dashboard/caja/turno" className="font-medium underline">
            Abrir caja
          </Link>
        </p>
      )}

      {justClosed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-brand-sm)] bg-brand-success/10 px-3 py-2 text-sm text-brand-ink">
          <span>Pedido #{justClosed.number} cobrado y cerrado.</span>
          <span className="flex items-center gap-2">
            <a
              href={justClosed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-brand-success hover:underline"
            >
              <MessageCircle className="h-4 w-4" />
              Avisarle al cliente por WhatsApp (opcional)
            </a>
            <button
              type="button"
              onClick={() => setJustClosed(null)}
              className="text-brand-muted hover:text-brand-ink"
              aria-label="Cerrar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white p-10 text-center text-brand-muted">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <Card key={order.id} className="border-brand">
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold text-brand-ink">{order.title}</p>
                    <p className="text-sm text-brand-muted">
                      #{order.number}
                      {order.since ? ` · desde ${formatTime(order.since)}` : ""}
                    </p>
                  </div>
                  {order.method && (
                    <Badge variant="outline" className="capitalize">
                      {order.method}
                    </Badge>
                  )}
                </div>
                {order.detail && <p className="text-sm text-brand-muted">{order.detail}</p>}
                <ul className="flex-1 text-sm text-brand-ink">
                  {order.lines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-2 border-t border-brand-border pt-3">
                  <p className="text-xl font-bold text-brand-ink">{formatMoney(order.total, currency)}</p>
                  <Button disabled={!cashOpen} onClick={() => setSelected(order)}>
                    Cobrar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <PaymentDialog
          open
          onOpenChange={(open) => !open && setSelected(null)}
          title={`Cobrar ${selected.title}`}
          total={selected.total}
          currency={currency}
          defaultMethod={selected.method}
          onConfirm={(method, cashReceived) => collect(selected, method, cashReceived)}
        />
      )}
    </div>
  );
}
