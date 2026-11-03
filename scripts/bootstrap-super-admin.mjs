// Crea el primer super_admin. Se ejecuta UNA sola vez, a mano, desde tu
// máquina (nunca desde la app en producción):
//
//   node scripts/bootstrap-super-admin.mjs <username> <password> "<Nombre completo>"
//
// Requiere las variables de entorno NEXT_PUBLIC_SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY (las mismas que usará la app, ver .env.example).

import { createClient } from "@supabase/supabase-js";

const [, , username, password, fullName] = process.argv;

if (!username || !password || !fullName) {
  console.error(
    'Uso: node scripts/bootstrap-super-admin.mjs <username> <password> "<Nombre completo>"'
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const authEmail = `${crypto.randomUUID()}@comanet.internal`;

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: authEmail,
  password,
  email_confirm: true,
});

if (createError || !created.user) {
  console.error("Error creando el usuario de Supabase Auth:", createError);
  process.exit(1);
}

const { error: profileError } = await supabase.from("profiles").insert({
  id: created.user.id,
  organization_id: null,
  username,
  full_name: fullName,
  auth_email: authEmail,
  role: "super_admin",
});

if (profileError) {
  console.error("Error creando el perfil de super_admin:", profileError);
  // Revertimos el usuario de auth para no dejar estado a medias.
  await supabase.auth.admin.deleteUser(created.user.id);
  process.exit(1);
}

console.log(`Super admin "${username}" creado correctamente.`);
