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
   `014_cierre_caja_transferencias.sql` y `015_cobro_en_caja.sql`.
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
- Roles: `super_admin`, `owner`, `cajero`, `mesero`.
- Pedidos públicos: la acción del servidor `lib/actions/public.ts` llama a la
  función `create_delivery_order`, que recalcula precios, disponibilidad,
  domicilio y desechables desde la base de datos (nunca confía en el cliente).
- Despachar, cobrar mesa, cancelar y caja pasan por funciones SQL con
  validación de rol y organización (`sql/003_functions.sql` y siguientes).
- Una venta cuenta cuando caja **cobra** el pedido o la mesa (`completed_at`); los
  reportes y el arqueo usan ese momento (zona horaria Colombia).
