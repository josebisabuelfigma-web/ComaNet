-- Catálogo de módulos que el super admin activa o desactiva por organización.
-- El "key" es el identificador estable usado por el código (lib/modules.ts).
-- La carta (categorías y productos), Ajustes, Personal y Mi cuenta son núcleo
-- y siempre están disponibles.

insert into modules (key, name, description, price)
values
  ('menu_online', 'Menú en línea y domicilios',
   'Carta pública con carrito, pedidos por WhatsApp y bandeja de pedidos pendientes / despachados.', 0),
  ('mesas', 'Mesas y meseros',
   'Atención en el local: los meseros abren cuentas por mesa, agregan pedidos y cobran.', 0),
  ('caja', 'Caja y arqueo',
   'Apertura con base, ingresos y egresos, y cierre de caja con arqueo de efectivo.', 0),
  ('reportes', 'Reportes de ventas',
   'Ventas totales, ventas de domicilios y unidades vendidas por producto.', 0)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description;
