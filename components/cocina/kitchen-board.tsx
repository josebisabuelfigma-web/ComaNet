"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { setItemReady, setOrderReady } from "@/lib/actions/cocina";
import { formatTime } from "@/lib/format";
import type { OrderItem } from "@/lib/supabase/types";

export type KitchenOrder = {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  customer: string | null;
  notes: string | null;
  items: OrderItem[];
};

export function KitchenBoard({ orders }: { orders: KitchenOrder[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ error?: string } | void>) {
    setBusy(key);
    setError(null);
    const result = await action();
    setBusy(null);
    if (result?.error) setError(result.error);
    router.refresh();
  }

  const pending = orders.filter((o) => o.items.some((i) => i.kitchen_status === "pendiente"));
  const done = orders.filter((o) => o.items.every((i) => i.kitchen_status === "listo"));

  function renderOrder(order: KitchenOrder) {
    const allReady = order.items.every((i) => i.kitchen_status === "listo");
    return (
      <Card key={order.id} className={allReady ? "opacity-60" : "border-brand"}>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold text-brand-ink">{order.title}</p>
              <Badge variant="muted">#{order.number}</Badge>
            </div>
            <p className="text-sm text-brand-muted">{formatTime(order.createdAt)}</p>
          </div>
          {order.customer && <p className="text-sm text-brand-muted">{order.customer}</p>}

          <ul className="flex flex-col gap-2">
            {order.items.map((item) => {
              const ready = item.kitchen_status === "listo";
              return (
                <li
                  key={item.id}
                  className={`flex items-start justify-between gap-3 rounded-[var(--radius-brand-sm)] p-2 ${
                    ready ? "bg-brand-success/10" : "bg-black/[0.03]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-base font-medium ${ready ? "line-through" : ""}`}>
                      {item.quantity} × {item.product_name}
                    </p>
                    {item.combo_snapshot && (
                      <p className="text-xs text-brand-muted">
                        Incluye:{" "}
                        {item.combo_snapshot.map((c) => `${c.quantity * item.quantity} ${c.name}`).join(", ")}
                      </p>
                    )}
                    {item.notes && (
                      <p className="text-sm font-semibold text-brand-danger">📝 {item.notes}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={ready ? "outline" : "default"}
                    disabled={busy === item.id}
                    onClick={() => run(item.id, () => setItemReady(item.id, !ready))}
                  >
                    {ready ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    {ready ? "Deshacer" : "Listo"}
                  </Button>
                </li>
              );
            })}
          </ul>

          {order.notes && <p className="text-sm text-brand-muted">Observaciones: {order.notes}</p>}

          <Button
            variant={allReady ? "outline" : "dark"}
            disabled={busy === order.id}
            onClick={() => run(order.id, () => setOrderReady(order.id, !allReady))}
          >
            {allReady ? "Reabrir pedido" : "Todo listo"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-brand-danger">{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-brand-ink">Por preparar ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white p-8 text-center text-brand-muted">
            No hay nada por preparar.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{pending.map(renderOrder)}</div>
        )}
      </section>

      {done.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-brand-ink">Listos, esperando despacho o cobro ({done.length})</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{done.map(renderOrder)}</div>
        </section>
      )}
    </div>
  );
}
