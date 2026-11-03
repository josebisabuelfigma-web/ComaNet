-- Horario de atención. Ejecutar después de 001-008. Idempotente.
-- Fuera de horario la carta sigue recibiendo pedidos (con un aviso al cliente:
-- "se gestionará en cuanto entremos en operación"); "orders_open" sigue siendo
-- la pausa total que rechaza pedidos.
-- opens_at / closes_at nulos = sin horario (siempre abierto). Si closes_at es
-- menor que opens_at el horario cruza la medianoche. Zona horaria: Colombia.
-- open_days: 0 = domingo ... 6 = sábado.

alter table restaurant_settings add column if not exists opens_at time;
alter table restaurant_settings add column if not exists closes_at time;
alter table restaurant_settings add column if not exists open_days smallint[] not null default '{0,1,2,3,4,5,6}';