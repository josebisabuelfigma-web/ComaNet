// Resetea la contraseña de un usuario existente (por username).
// Se ejecuta UNA sola vez, a mano, desde tu máquina:
//
//   node scripts/reset-password.mjs <username> <nueva_password>
//
// Requiere las variables de entorno NEXT_PUBLIC_SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY (las mismas que usará la app, ver .env.example).

import { createClient } from "@supabase/supabase-js";

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.error("Uso: node scripts/reset-password.mjs <username> <nueva_password>");
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

const { data: profile, error: profileError } = await supabase
  .from("profiles")
  .select("id, username")
  .eq("username", username)
  .maybeSingle();

if (profileError || !profile) {
  console.error(`No se encontró el usuario "${username}".`, profileError ?? "");
  process.exit(1);
}

const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
  password: newPassword,
});

if (updateError) {
  console.error("Error actualizando la contraseña:", updateError);
  process.exit(1);
}

console.log(`Contraseña de "${username}" actualizada correctamente.`);
