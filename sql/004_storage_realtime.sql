-- Storage (fotos de productos y logos) y Realtime. Ejecutar después de 003.

-- --------------------------------------------------------------------------
-- Buckets públicos: "menu" (fotos de productos) y "branding" (logos).
-- Los archivos viven en "<organization_id>/<archivo>".
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('menu', 'menu', true), ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists menu_bucket_public_read on storage.objects;
create policy menu_bucket_public_read on storage.objects for select
  using (bucket_id in ('menu', 'branding'));

drop policy if exists menu_bucket_insert on storage.objects;
create policy menu_bucket_insert on storage.objects for insert
  with check (
    bucket_id in ('menu', 'branding')
    and (
      is_super_admin()
      or (
        (storage.foldername(name))[1] = current_profile_org()::text
        and current_profile_role() = 'owner'
      )
    )
  );

drop policy if exists menu_bucket_update on storage.objects;
create policy menu_bucket_update on storage.objects for update
  using (
    bucket_id in ('menu', 'branding')
    and (
      is_super_admin()
      or (
        (storage.foldername(name))[1] = current_profile_org()::text
        and current_profile_role() = 'owner'
      )
    )
  );

drop policy if exists menu_bucket_delete on storage.objects;
create policy menu_bucket_delete on storage.objects for delete
  using (
    bucket_id in ('menu', 'branding')
    and (
      is_super_admin()
      or (
        (storage.foldername(name))[1] = current_profile_org()::text
        and current_profile_role() = 'owner'
      )
    )
  );

-- --------------------------------------------------------------------------
-- Realtime: la carta pública (agotado/disponible) y los pedidos/cuentas.
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['menu_products', 'orders', 'order_items', 'restaurant_settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
