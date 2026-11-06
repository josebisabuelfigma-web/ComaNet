"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, Clock, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ackKitchenChanges, setItemReady, setOrderReady } from "@/lib/actions/cocina";
import { formatTime } from "@/lib/format";
import { isAudioUnlocked, unlockAudio } from "@/lib/sound";
import type { KitchenChange, OrderItem } from "@/lib/supabase/types";

export type KitchenOrder = {
  id: string;
  number: number;
  title: string;
  /** Cuándo se envió por primera vez a cocina. */
  sentAt: string;
  /** Cuándo cocina terminó todo lo enviado (null si falta algo). */
  doneAt: string | null;
  customer: string | null;
  notes: string | null;
  items: OrderItem[];
  /** Avisos de cambios que cocina aún no ha visto. */
  changes: KitchenChange[];
};

export type KitchenHistoryRow = {
  id: string;
  number: number;
  title: string;
  sentAt: string;
  doneAt: string;
};

function minutesBetween(from: string, to: string | number) {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${minutes % 60} min`;
}

/** Reloj que se actualiza cada 30 s para mostrar cuánto lleva cada pedido en cocina. */
function useNow() {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function KitchenBoard({
  orders,
  history,
  readOnly = false,
}: {
  orders: KitchenOrder[];
  history: KitchenHistoryRow[];
  /** Cajero: ve la cocina pero no despacha ni confirma avisos. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const now = useNow();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [soundOn, setSoundOn] = React.useState(false);

  // El navegador solo deja sonar avisos después de un toque en la pantalla.
  React.useEffect(() => {
    setSoundOn(isAudioUnlocked());
    const unlock = async () => {
      if (await unlockAudio()) {
        setSoundOn(true);
        window.removeEventListener("pointerdown", unlock);
      }
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  async function run(key: string, action: () => Promise<{ error?: string } | void>) {
    setBusy(key);
    setError(null);
    const result = await action();
    setBusy(null);
    if (result?.error) setError(result.error);
    router.refresh();
  }

  const isDone = (o: KitchenOrder) => o.items.every((i) => i.kitchen_status === "listo") && o.changes.length === 0;
  const pending = orders.filter((o) => !isDone(o));
  const done = orders.filter(isDone);

  const averageMinutes =
    history.length > 0
      ? Math.round(history.reduce((sum, h) => sum + minutesBetween(h.sentAt, h.doneAt), 0) / history.length)
      : null;

  function renderOrder(order: KitchenOrder) {
    const allReady = order.items.every((i) => i.kitchen_status === "listo");
    const finished = isDone(order);
    const minutes = order.doneAt ? minutesBetween(order.sentAt, order.doneAt) : minutesBetween(order.sentAt, now);
    const late = !order.doneAt && minutes >= 20;
    const firstSend = new Date(order.sentAt).getTime();

    return (
      <Card key={order.id} className={finished ? "opacity-70" : order.changes.length ? "border-brand-danger" : "border-brand"}>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold text-brand-ink">{order.title}</p>
              <Badge variant="muted">#{order.number}</Badge>
            </div>
            <div className="text-right text-sm text-brand-muted">
              <p>Enviado {formatTime(order.sentAt)}</p>
              <p className={`flex items-center justify-end gap-1 font-medium ${late ? "text-brand-danger" : ""}`}>
                <Clock className="h-3.5 w-3.5" />
                {order.doneAt ? `Tardó ${formatDuration(minutes)}` : `Lleva ${formatDuration(minutes)}`}
              </p>
            </div>
          </div>
          {order.customer && <p className="text-sm text-brand-muted">{order.customer}</p>}

          {order.changes.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-brand-sm)] border border-brand-danger bg-brand-danger/10 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-danger">
                <BellRing className="h-4 w-4" />
                {order.title} tuvo cambios
              </p>
              <ul className="list-disc pl-5 text-sm text-brand-ink">
                {order.changes.map((change) => (
                  <li key={change.id}>
                    {change.kind === "agregado" ? "Agregaron: " : ""}
                    {change.description}
                  </li>
                ))}
              </ul>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="dark"
                  className="w-fit"
                  disabled={busy === `ack-${order.id}`}
                  onClick={() => run(`ack-${order.id}`, () => ackKitchenChanges(order.id))}
                >
                  Entendido
                </Button>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {order.items.map((item) => {
              const ready = item.kitchen_status === "listo";
              const addedLater =
                !ready && item.sent_to_kitchen_at && new Date(item.sent_to_kitchen_at).getTime() - firstSend > 5000;
              return (
                <li
                  key={item.id}
                  className={`flex items-start justify-between gap-3 rounded-[var(--radius-brand-sm)] p-2 ${
                    ready ? "bg-brand-success/10" : "bg-black/[0.03]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-base font-medium ${ready ? "line-through" : ""}`}>
                      {item.quantity} × {item.product_name}{" "}
                      {addedLater && <Badge variant="danger">Nuevo</Badge>}
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
                    {ready && item.kitchen_done_at && (
                      <p className="text-xs text-brand-muted">Despachado {formatTime(item.kitchen_done_at)}</p>
                    )}
                  </div>
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant={ready ? "outline" : "default"}
                      disabled={busy === item.id}
                      onClick={() => run(item.id, () => setItemReady(item.id, !ready))}
                    >
                      {ready ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      {ready ? "Deshacer" : "Despachar"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {order.notes && <p className="text-sm text-brand-muted">Observaciones: {order.notes}</p>}

          {!readOnly && (
            <Button
              variant={allReady ? "outline" : "dark"}
              disabled={busy === order.id}
              onClick={() => run(order.id, () => setOrderReady(order.id, !allReady))}
            >
              {allReady ? "Reabrir pedido" : "Despachar todo"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-brand-danger">{error}</p>}
      {readOnly && (
        <p className="rounded-[var(--radius-brand-sm)] bg-black/5 px-3 py-2 text-sm text-brand-muted">
          Estás viendo la cocina en modo de solo lectura: el despacho lo hace cocina o el administrador.
        </p>
      )}
      {!readOnly && !soundOn && (
        <p className="rounded-[var(--radius-brand-sm)] bg-brand/15 px-3 py-2 text-sm text-brand-ink">
          🔔 Toca cualquier parte de la pantalla para activar el sonido de los avisos.
        </p>
      )}

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
          <h2 className="text-lg font-semibold text-brand-ink">
            Despachados por cocina, esperando entrega o cobro ({done.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{done.map(renderOrder)}</div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-brand-ink">Tiempos de cocina de hoy</h2>
          {averageMinutes !== null && (
            <p className="text-sm text-brand-muted">
              {history.length} pedidos · promedio <strong className="text-brand-ink">{formatDuration(averageMinutes)}</strong>
            </p>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-brand-muted">Aún no hay pedidos terminados hoy.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-brand-md)] bg-white shadow-sm">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-brand-border text-left text-brand-muted">
                  <th className="p-2 font-medium">Pedido</th>
                  <th className="p-2 font-medium">Enviado</th>
                  <th className="p-2 font-medium">Terminado</th>
                  <th className="p-2 text-right font-medium">Duración</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-brand-border last:border-0">
                    <td className="p-2">
                      {row.title} <span className="text-brand-muted">#{row.number}</span>
                    </td>
                    <td className="p-2">{formatTime(row.sentAt)}</td>
                    <td className="p-2">{formatTime(row.doneAt)}</td>
                    <td className="p-2 text-right font-medium">{formatDuration(minutesBetween(row.sentAt, row.doneAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
