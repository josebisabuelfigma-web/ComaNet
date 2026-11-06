import { NextResponse } from "next/server";
import { z } from "zod";

import { clientIp, rateLimitCount, rateLimitHit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  username: z.string().trim().min(1, "El usuario es obligatorio"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

// Solo cuentan los intentos FALLIDOS, en ventanas de 15 minutos.
const WINDOW_SECONDS = 15 * 60;
const MAX_FAILS_PER_USER = 8;
const MAX_FAILS_PER_IP = 25;

const BAD_CREDENTIALS = { error: "Usuario o contraseña incorrectos" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { username, password } = parsed.data;

  const ip = await clientIp();
  const userKey = `login:user:${username.toLowerCase()}`;
  const ipKey = `login:ip:${ip}`;

  const [userFails, ipFails] = await Promise.all([
    rateLimitCount(userKey, WINDOW_SECONDS),
    rateLimitCount(ipKey, WINDOW_SECONDS),
  ]);
  if (userFails >= MAX_FAILS_PER_USER || ipFails >= MAX_FAILS_PER_IP) {
    return NextResponse.json(
      { error: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo." },
      { status: 429, headers: { "Retry-After": String(WINDOW_SECONDS) } }
    );
  }

  const fail = async () => {
    await Promise.all([rateLimitHit(userKey, WINDOW_SECONDS), rateLimitHit(ipKey, WINDOW_SECONDS)]);
    return NextResponse.json(BAD_CREDENTIALS, { status: 401 });
  };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("auth_email, organization_id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) return fail();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: profile.auth_email,
    password,
  });

  if (error) return fail();

  // El aviso de negocio suspendido solo se muestra con la contraseña correcta,
  // para que no sirva para descubrir qué usuarios existen.
  if (profile.organization_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("is_active")
      .eq("id", profile.organization_id)
      .maybeSingle();

    if (org && !org.is_active) {
      await supabase.auth.signOut();
      return NextResponse.json(
        { error: "Este negocio no tiene acceso activo. Contacta al proveedor del sistema." },
        { status: 403 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
