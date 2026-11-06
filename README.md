# ComaNet

Software multi-negocio para venta de comidas rápidas (Next.js + Supabase), de
NOVA STUDIO. Parte de la base de Stockia: un solo código y una sola base de
datos sirven a todos los negocios, aislados por organización, con módulos que
el super administrador activa o desactiva por cliente.

## Qué incluye

**Cliente (sin login)** — `/m/<slug>`: carta con precios, ingredientes y
disponibilidad en tiempo real (agotado/disponible), carrito con comentario por
producto (ej. "sin cebolla"), valor por producto y total, dirección, domicilio y
desechables, medio de pago (efectivo/transferencia) y, al continuar, abre
WhatsApp con el pedido completo hacia el número que registró el administrador.
El pedido también queda guardado en el sistema.

**Administrador del negocio (owner)**: carta por categorías (precio, descripción
/ingredientes, foto), agotado/disponible, ajustes (WhatsApp, valor del
domicilio y mensaje tipo "domicilio gratis en el sector", cargo de desechables,
medios de pago, mesas, logo), pedidos a domicilio (pendiente → despachado),
mesas, caja (base, ingresos/egresos, arqueo y cierre), reportes (ventas totales,
domicilios y unidades por producto), usuarios (cajeros y meseros) y registro de
actividad.

**Cajero**: pedidos a domicilio, mesas, caja, marcar agotado.
**Cocina** (rol): solo la pantalla de cocina.
**Mesero**: solo mesas (abre cuenta, agrega productos con comentarios, cobra).

**Super administrador**: crea organizaciones con su administrador, define cuántos
usuarios incluye cada una, la suspende/activa y activa o desactiva módulos:
`menu_online`, `mesas`, `caja`, `reportes` y `cocina` (pantalla de cocina,
independiente del flujo: no bloquea despachar ni cobrar).

**Combos:** la categoría "Combos" se sugiere al admin; un combo se arma solo con
productos ya creados y tiene un precio total. En reportes y cocina se
desglosan producto por producto.

**Recoger en el local:** el cliente elige domicilio o recoger antes de enviar;
queda en el mensaje de WhatsApp y en el pedido (sin costo de domicilio).

Los usuarios y contraseñas viven en la base de datos (Supabase Auth +
`profiles`) y se crean por código desde el panel; no hay credenciales en
variables de entorno (solo las llaves de Supabase).

**Cocina con envío y avisos:** los pedidos (domicilio y mesa) llegan a cocina solo
cuando caja/administrador/mesero les da "Enviar a cocina". Si después se agrega,
quita o cambia algo, cocina recibe un aviso ("tuvo cambios") con sonido hasta que
da "Entendido". Cocina marca cada producto como despachado y el sistema registra
cuánto tardó cada pedido (y el promedio del día).

**Cobro en caja:** el mesero marca "Cuenta entregada" y la mesa queda "Por cobrar";
el domicilio marcado como enviado también queda por cobrar. Solo caja o el
administrador lo cierran: ven el valor, escriben lo recibido, el sistema calcula el
cambio y la venta cuenta en ese momento. Con el módulo de caja activo debe haber un
turno abierto. Sin ese módulo se cobra desde la mesa o desde Pedidos a domicilio.

**Cierre de caja:** efectivo y transferencias cuadran por separado.

**Domicilios editables:** el administrador/cajero puede cambiar productos,
cantidades, comentarios y datos del cliente mientras el pedido esté pendiente (el
total se recalcula). El teléfono abre WhatsApp con un mensaje listo.

**Ingresos, egresos y facturas** (módulo `finanzas`, independiente de caja): registra
movimientos con factura opcional (imagen o PDF) y consúltalos por fecha en
*Ingresos y egresos* (filtro "Solo con factura").

## 1. Crear el proyecto de Supabase

1. Crea un proyecto **nuevo** en [supabase.com](https://supabase.com) (no
   reutilices el de Stockia).
2. En **Project Settings → API** copia `Project URL`, `anon public key` y
   `service_role key`.
3. Copia `.env.example` a `.env.local` y completa esos valores.
4. En el **SQL Editor**, ejecuta en orden los archivos de `sql/`:
   `001_schema.sql`, `002_rls_policies.sql`, `003_functions.sql`,
   `004_storage_realtime.sql`, `005_seed_modules.sql`,
   `006_combos_cocina_recoger.sql`, `007_combo_disponibilidad.sql`, `008_realtime_carta.sql`,
   `009_horario.sql`, `010_cocina_envio_cobro_edicion.sql`, `011_finanzas_facturas.sql`,
   `012_movimientos_tercero.sql`, `013_editar_domicilio_completo.sql`,
   `014_cierre_caja_transferencias.sql`, `015_cobro_en_caja.sql`, `016_cajero_solo_lectura.sql`
   `017_limite_intentos.sql` y `018_endurecer_permisos.sql`.
   (Ejecuta las migraciones nuevas ANTES de publicar el código que las usa.)

## 2. Crear el primer super administrador

Una sola vez, a mano:

```bash
node --env-file=.env.local scripts/bootstrap-super-admin.mjs <usuario> <contraseña> "<Tu nombre>"
```

## 3. Desarrollo local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>, entra con el super admin y crea tu primera
organización en **Super Admin → Nueva organización**. Activa sus módulos desde
el detalle de la organización.

## Flujo de un negocio nuevo

1. Super admin crea la organización (nombre, slug, administrador y contraseña) y
   activa los módulos contratados.
2. El administrador entra, sube su logo y en **Ajustes** configura WhatsApp,
   domicilio, desechables y medios de pago; en **Carta y productos** carga
   categorías y productos; crea mesas y usuarios (cajeros/meseros).
3. Comparte el enlace `/m/<slug>` con sus clientes.

## Arquitectura

- Next.js (App Router) + TypeScript + Tailwind; Supabase (Postgres con RLS,
  Auth por usuario, Storage y Realtime).
- Roles: `super_admin`, `owner`, `cajero`, `mesero`, `cocina`.
- Límite de intentos (`lib/rate-limit.ts`, tabla `rate_limits`): el login bloquea 15 min
  tras 8 fallos por usuario o 25 por IP; los pedidos públicos admiten 6 por IP y 3 por
  teléfono cada 10 min. Si la migración 017 no está, no bloquea (solo registra el error).
- Pedidos públicos: la acción del servidor `lib/actions/public.ts` llama a la
  función `create_delivery_order`, que recalcula precios, disponibilidad,
  domicilio y desechables desde la base de datos (nunca confía en el cliente).
- Despachar, cobrar mesa, cancelar y caja pasan por funciones SQL con
  validación de rol y organización (`sql/003_functions.sql` y siguientes).
- Una venta cuenta cuando caja **cobra** el pedido o la mesa (`completed_at`); los
  reportes y el arqueo usan ese momento (zona horaria Colombia).

## Reglas de seguridad y base de datos (OBLIGATORIAS para quien programe, incluida la IA)

El software está en producción y se vende a negocios reales. Estas reglas no son
opcionales; si un cambio las rompe, no se publica.

### Migraciones SQL
1. Cada cambio de base de datos va en un archivo nuevo `sql/NNN_nombre.sql` (el siguiente
   número libre). Nunca se edita una migración ya aplicada.
2. Deben ser **idempotentes** (`if not exists`, `create or replace`, `drop policy if exists`):
   `npm run test:db` las aplica dos veces.
3. Quien usa el proyecto las corre **a mano en el SQL Editor de Supabase**, siempre
   **ANTES** del push si el código depende de ellas. Antes de desplegar, confirmar con una
   consulta de solo lectura (con `.env.local`) que la migración ya está, y avisar qué SQL falta.
4. Después de cada cambio de base: `npm run test:db` debe terminar con 0 fallidas
   (necesita PostgreSQL sin contraseña en el puerto 54331).
5. Agregar a `scripts/test-db.mjs` una prueba por cada regla nueva de seguridad.
6. Listar la migración nueva en la sección 1 de este README.

### RLS (políticas por fila)
7. Toda tabla nueva en `public` lleva `alter table ... enable row level security` en la misma
   migración. Sin RLS, cualquiera con la llave pública podría leerla.
8. Toda política filtra por organización (`organization_id = current_profile_org()`) y por rol
   (`current_role_in(...)`), y cuando aplica por módulo (`org_module_enabled(...)`).
   **Prohibido** `using (true)` o `with check (true)`.
9. No crear dos políticas permisivas para la misma tabla y operación: se suman con OR y la más
   abierta gana. Para cambiar una, `drop policy if exists` y volver a crearla.
10. Una tabla solo para el servidor (como `rate_limits`) lleva RLS sin políticas y
    `revoke all ... from public, anon, authenticated`.
11. Los escritos de actividad deben ir a nombre de quien escribe (`user_id = auth.uid()`).

### Funciones SQL
12. Las funciones que cambian datos van con `security definer` **y** `set search_path = public`,
    y validan dentro rol y organización (nunca confiar en el cliente).
13. **Cada función nueva** lleva en su migración `revoke all ... from public, anon` y un
    `grant execute ... to authenticated` (o solo `service_role` si la llama el servidor).
    Si se recrea con `drop function` + `create function`, los permisos se pierden y vuelve a
    quedar abierta a todos: repetir siempre el `revoke` y el `grant`.
14. Precios, totales, disponibilidad y cargos se calculan en la base, nunca se aceptan del navegador.

### Código de la aplicación
15. Toda acción del servidor (`lib/actions/*.ts`) empieza con `requireOrgRole(...)` o
    `requireRole(...)`, y si es de un módulo, con `requireModule(...)`.
16. La llave `service_role` (`createAdminClient`) solo se usa en el servidor y solo donde es
    imprescindible (crear usuarios, pedidos públicos, límite de intentos). Nunca al navegador.
17. Todo punto sin login (login, pedido público) debe tener límite de intentos con
    `lib/rate-limit.ts`. No revelar si un usuario existe (mismo mensaje de error siempre).
18. `.env.local` nunca se sube a git. No poner contraseñas ni llaves en el código.

### Antes de dar algo por terminado
`npx tsc --noEmit`, `npx eslint` y `npm run test:db` sin errores. Los cambios de seguridad no
deben alterar el comportamiento que ya funciona: verificar con pruebas, no suponer.
