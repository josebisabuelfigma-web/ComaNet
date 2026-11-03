"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellRing, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import { isAudioUnlocked, playOrderSound, unlockAudio } from "@/lib/sound";

interface OrderNotifierProps {
  organizationId: string;
  currency: string;
}

type Toast = {
  id: string;
  number: number;
  customer: string | null;
  fulfillment: string | null;
  total: number;
};

/**
 * Aviso global de pedidos nuevos: suena, muestra una tarjeta y actualiza el
 * contador del menú desde CUALQUIER pantalla del panel (no solo Pedidos).
 */
export function OrderNotifier({ organizationId, currency }: OrderNotifierProps) {
  const router = useRouter();
  const [soundOn, setSoundOn] = React.useState(false);
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const originalTitle = React.useRef<string>("");
  const titleTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // El primer clic o toque en cualquier parte desbloquea el sonido.
  React.useEffect(() => {
    originalTitle.current = document.title;
    setSoundOn(isAudioUnlocked());

    const unlock = async () => {
      if (await unlockAudio()) {
        setSoundOn(true);
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const stopTitleFlash = React.useCallback(() => {
    if (titleTimer.current) {
      clearInterval(titleTimer.current);
      titleTimer.current = null;
    }
    if (originalTitle.current) document.title = originalTitle.current;
  }, []);

  React.useEffect(() => {
    window.addEventListener("focus", stopTitleFlash);
    return () => window.removeEventListener("focus", stopTitleFlash);
  }, [stopTitleFlash]);

  React.useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`order-notifier-${organizationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `organization_id=eq.${organizationId}` },
        (payload) => {
          const row = payload.new as {
            id: string;
            order_number: number;
            channel: string;
            customer_name: string | null;
            fulfillment: string | null;
            total: number;
          };
          // Solo pedidos de clientes; las cuentas de mesa no hacen sonar la campana.
          if (row.channel !== "domicilio") return;

          playOrderSound();
          setToasts((current) => [
            ...current,
            {
              id: row.id,
              number: row.order_number,
              customer: row.customer_name,
              fulfillment: row.fulfillment,
              total: Number(row.total),
            },
          ]);
          setTimeout(() => setToasts((current) => current.filter((t) => t.id !== row.id)), 20_000);

          if (document.hidden && !titleTimer.current) {
            let on = false;
            titleTimer.current = setInterval(() => {
              document.title = on ? originalTitle.current : `🔔 Nuevo pedido #${row.order_number}`;
              on = !on;
            }, 1000);
          }
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
            new Notification(`Nuevo pedido #${row.order_number}`, {
              body: `${row.customer_name ?? "Cliente"} · ${formatMoney(Number(row.total), currency)}`,
            });
          }
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopTitleFlash();
    };
  }, [organizationId, currency, router, stopTitleFlash]);

  async function enableSound() {
    if (await unlockAudio()) {
      setSoundOn(true);
      playOrderSound(); // vista previa
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  return (
    <>
      {!soundOn && (
        <button
          onClick={enableSound}
          className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-brand-ink px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-brand-ink-soft"
        >
          <Bell className="h-4 w-4" />
          Activar sonido de pedidos
        </button>
      )}

      <div className="pointer-events-none fixed right-3 top-3 z-[60] flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-[var(--radius-brand-md)] border border-brand bg-white p-3 shadow-xl"
          >
            <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-brand-dark" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-brand-ink">Nuevo pedido #{toast.number}</p>
              <p className="truncate text-sm text-brand-muted">
                {toast.customer ?? "Cliente"} · {toast.fulfillment === "recoger" ? "Recoger" : "Domicilio"} ·{" "}
                {formatMoney(toast.total, currency)}
              </p>
              <Link
                href="/dashboard/pedidos"
                onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
                className="mt-1 inline-block text-sm font-medium text-brand-dark underline"
              >
                Ver pedido
              </Link>
            </div>
            <button
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              aria-label="Cerrar aviso"
            >
              <X className="h-4 w-4 text-brand-muted" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}