"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { playBeep, playOrderSound } from "@/lib/sound";

interface RealtimeRefreshProps {
  organizationId: string;
  /** Tablas a escuchar; se refresca la página cuando cambia alguna. */
  tables: ("orders" | "order_items" | "menu_products")[];
  /** Suena un aviso cuando llega un pedido nuevo. */
  beepOnNewOrder?: boolean;
  /** Suena un aviso cuando se inserta una fila en alguna de estas tablas. */
  beepOnInsert?: ("orders" | "order_items")[];
}

/** Refresca los datos del servidor en tiempo real cuando cambian las tablas indicadas. */
export function RealtimeRefresh({
  organizationId,
  tables,
  beepOnNewOrder,
  beepOnInsert,
}: RealtimeRefreshProps) {
  const router = useRouter();
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tablesKey = tables.join(",");
  const beepKey = (beepOnInsert ?? []).join(",");

  React.useEffect(() => {
    const supabase = createClient();
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };

    let channel = supabase.channel(`rt-${organizationId}-${tablesKey}`);
    for (const table of tablesKey.split(",")) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            if (beepOnNewOrder && table === "orders") playOrderSound();
            else if (beepKey.split(",").includes(table)) playBeep();
          }
          schedule();
        }
      );
    }
    channel.subscribe();

    // Respaldo por si la conexión en vivo se corta: refresca cada 60 s.
    const interval = setInterval(() => router.refresh(), 60_000);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [organizationId, tablesKey, beepOnNewOrder, beepKey, router]);

  return null;
}
