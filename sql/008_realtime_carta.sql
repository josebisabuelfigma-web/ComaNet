-- Realtime fiable para la carta pública. Ejecutar después de 001-007. Idempotente.
--
-- 1) Las categorías también se publican en tiempo real (antes solo productos).
-- 2) REPLICA IDENTITY FULL: sin esto, Supabase no entrega los eventos de
--    BORRADO cuando se filtra por organization_id (un producto o categoría
--    eliminado seguiría viéndose hasta recargar).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_categories'
  ) then
    alter publication supabase_realtime add table public.menu_categories;
  end if;
end $$;

alter table menu_products replica identity full;
alter table menu_categories replica identity full;
alter table menu_combo_items replica identity full;
alter table restaurant_settings replica identity full;
