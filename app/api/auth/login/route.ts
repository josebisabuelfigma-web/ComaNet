import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  username: z.string().trim().min(1, "El usuario es obligatorio"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { username, password } = parsed.data;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("auth_email, organization_id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json(
      { error: "Usuario o contraseña incorrectos" },
      { status: 401 }
    );
  }

  if (profile.organization_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("is_active")
      .eq("id", profile.organization_id)
      .maybeSingle();

    if (org && !org.is_active) {
      return NextResponse.json(
        { error: "Este negocio no tiene acceso activo. Contacta al proveedor del sistema." },
        { status: 403 }
      );
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: profile.auth_email,
    password,
  });

  if (error) {
    return NextResponse.json(
      { error: "Usuario o contraseña incorrectos" },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true });
}
