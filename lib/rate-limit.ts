import "server-only";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Límite de intentos guardado en la base (sirve aunque el servidor sea
 * "serverless" y no comparta memoria). Si la tabla aún no existe (migración 017
 * sin correr) o la base falla, NO bloquea: deja pasar y registra el error.
 */

/** IP del visitante (Netlify la entrega en x-nf-client-connection-ip). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return h.get("x-nf-client-connection-ip") ?? forwarded ?? h.get("x-real-ip") ?? "desconocida";
}

/** Cuántos intentos lleva la clave en la ventana actual (sin sumar). */
export async function rateLimitCount(key: string, windowSeconds: number): Promise<number> {
  const { data, error } = await createAdminClient().rpc("rate_limit_count", {
    p_key: key,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rateLimitCount", error.message);
    return 0;
  }
  return data ?? 0;
}

/** Suma un intento y devuelve cuántos lleva en la ventana actual. */
export async function rateLimitHit(key: string, windowSeconds: number): Promise<number> {
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_key: key,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rateLimitHit", error.message);
    return 0;
  }
  return data ?? 0;
}
