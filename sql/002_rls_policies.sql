-- Row Level Security: aísla los datos de cada organización y define qué
-- puede hacer cada rol. Ejecutar después de 001_schema.sql. Idempotente.

-- --------------------------------------------------------------------------
-- Helpers "security definer": leen profiles sin recursión de RLS.
-- --------------------------------------------------------------------------
create or replace function current_profile_org()
returns uuid
language sql security definer set search_path = public stable
as $$ select organization_id from profiles where id = auth.uid() $$;

create or replace function current_profile_role()
returns text
language sql security definer set search_path = public stable
as $$ select role from profiles where id = auth.uid() $$;

create or replace function is_super_admin()
returns boolean
language sql security definer set search_path = public stable
as $$ select coalesce(current_profile_role() = 'super_admin', false) $$;

-- Rol del usuario actual dentro de una lista (owner siempre cuenta aparte).
create or replace function current_role_in(variadic roles text[])
returns boolean
language sql security definer set search_path = public stable
as $$ select coalesce(current_profile_role() = any (roles), false) $$;

-- ¿El módulo (por key) está habilitado para la organización?
create or replace function org_module_enabled(p_org uuid, p_key text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select coalesce(
    (select om.enabled
       from organization_modules om
       join modules m on m.id = om.module_id
      where om.organization_id = p_org and m.key = p_key),
    false)
$$;

-- ¿La carta pública de esta organización está disponible para visitantes
-- sin sesión? (organización activa + módulo de menú en línea habilitado)
create or replace function org_menu_is_public(p_org uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select coalesce((select is_active from organizations where id = p_org), false)
     and org_module_enabled(p_org, 'menu_online')
$$;

grant execute on function org_menu_is_public(uuid) to anon, authenticated;

-- ==========================================================================
-- organizations
-- ==========================================================================
alter table organizations enable row level security;

drop policy if exists organizations_select on organizations;
create policy organizations_select on organizations for select
  using (id = current_profile_org() or is_super_admin());

drop policy if exists organizations_write on organizations;
create policy organizations_write on organizations for all
  using (is_super_admin()) with check (is_super_admin());

-- El owner puede editar los datos de su negocio (impresión de tickets, logo),
-- pero nunca el slug, los límites ni el estado de activación.
-- (Las columnas protegidas las controla la acción del servidor + trigger.)
create or replace function protect_organization_fields()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_super_admin() then
    if new.slug is distinct from old.slug
       or new.max_usuarios is distinct from old.max_usuarios
       or new.is_active is distinct from old.is_active
       or (new.next_order_number is distinct from old.next_order_number
           and coalesce(current_setting('comanet.internal', true), '') <> '1') then
      raise exception 'No autorizado para cambiar esos datos de la organización';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_protect_fields on organizations;
create trigger organizations_protect_fields
  before update on organizations
  for each row execute function protect_organization_fields();

drop policy if exists organizations_update_owner on organizations;
create policy organizations_update_owner on organizations for update
  using (id = current_profile_org() and current_profile_role() = 'owner')
  with check (id = current_profile_org() and current_profile_role() = 'owner');

-- ==========================================================================
-- profiles
-- ==========================================================================
alter table profiles enable row level security;

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or organization_id = current_profile_org() or is_super_admin());

-- Los perfiles se crean/eliminan desde acciones del servidor con la service
-- role key; aquí solo se permite actualizar el propio (p. ej. full_name).
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid() or is_super_admin())
  with check (id = auth.uid() or is_super_admin());

-- ==========================================================================
-- modules / organization_modules
-- ==========================================================================
alter table modules enable row level security;

drop policy if exists modules_select on modules;
create policy modules_select on modules for select
  using (auth.role() = 'authenticated');

alter table organization_modules enable row level security;

drop policy if exists organization_modules_select on organization_modules;
create policy organization_modules_select on organization_modules for select
  using (organization_id = current_profile_org() or is_super_admin());

drop policy if exists organization_modules_write on organization_modules;
create policy organization_modules_write on organization_modules for all
  using (is_super_admin()) with check (is_super_admin());

-- ==========================================================================
-- restaurant_settings (lectura pública si la carta está pública)
-- ==========================================================================
alter table restaurant_settings enable row level security;

drop policy if exists restaurant_settings_select on restaurant_settings;
create policy restaurant_settings_select on restaurant_settings for select
  using (
    org_menu_is_public(organization_id)
    or organization_id = current_profile_org()
    or is_super_admin()
  );

drop policy if exists restaurant_settings_update on restaurant_settings;
create policy restaurant_settings_update on restaurant_settings for update
  using (organization_id = current_profile_org() and current_profile_role() = 'owner')
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

-- ==========================================================================
-- carta: lectura pública; escritura solo owner
-- ==========================================================================
alter table menu_categories enable row level security;

drop policy if exists menu_categories_select on menu_categories;
create policy menu_categories_select on menu_categories for select
  using (
    org_menu_is_public(organization_id)
    or organization_id = current_profile_org()
    or is_super_admin()
  );

drop policy if exists menu_categories_insert on menu_categories;
create policy menu_categories_insert on menu_categories for insert
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists menu_categories_update on menu_categories;
create policy menu_categories_update on menu_categories for update
  using (organization_id = current_profile_org() and current_profile_role() = 'owner')
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists menu_categories_delete on menu_categories;
create policy menu_categories_delete on menu_categories for delete
  using (organization_id = current_profile_org() and current_profile_role() = 'owner');

alter table menu_products enable row level security;

drop policy if exists menu_products_select on menu_products;
create policy menu_products_select on menu_products for select
  using (
    (org_menu_is_public(organization_id) and is_active)
    or organization_id = current_profile_org()
    or is_super_admin()
  );

drop policy if exists menu_products_insert on menu_products;
create policy menu_products_insert on menu_products for insert
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists menu_products_update on menu_products;
create policy menu_products_update on menu_products for update
  using (organization_id = current_profile_org() and current_profile_role() = 'owner')
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists menu_products_delete on menu_products;
create policy menu_products_delete on menu_products for delete
  using (organization_id = current_profile_org() and current_profile_role() = 'owner');

-- ==========================================================================
-- mesas
-- ==========================================================================
alter table restaurant_tables enable row level security;

drop policy if exists restaurant_tables_select on restaurant_tables;
create policy restaurant_tables_select on restaurant_tables for select
  using (organization_id = current_profile_org() or is_super_admin());

drop policy if exists restaurant_tables_insert on restaurant_tables;
create policy restaurant_tables_insert on restaurant_tables for insert
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists restaurant_tables_update on restaurant_tables;
create policy restaurant_tables_update on restaurant_tables for update
  using (organization_id = current_profile_org() and current_profile_role() = 'owner')
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists restaurant_tables_delete on restaurant_tables;
create policy restaurant_tables_delete on restaurant_tables for delete
  using (organization_id = current_profile_org() and current_profile_role() = 'owner');

-- ==========================================================================
-- pedidos
-- Los pedidos de domicilio los crea la función create_delivery_order (service
-- role). Las cuentas de mesa se abren con insert; despachar / cobrar /
-- cancelar pasan por funciones (003_functions.sql). Nadie actualiza ni borra
-- pedidos directamente.
-- ==========================================================================
alter table orders enable row level security;

drop policy if exists orders_select on orders;
create policy orders_select on orders for select
  using (organization_id = current_profile_org() or is_super_admin());

drop policy if exists orders_insert_mesa on orders;
create policy orders_insert_mesa on orders for insert
  with check (
    organization_id = current_profile_org()
    and channel = 'mesa'
    and status = 'abierta'
    and current_role_in('owner', 'cajero', 'mesero')
    and org_module_enabled(organization_id, 'mesas')
  );

alter table order_items enable row level security;

drop policy if exists order_items_select on order_items;
create policy order_items_select on order_items for select
  using (organization_id = current_profile_org() or is_super_admin());

drop policy if exists order_items_insert on order_items;
create policy order_items_insert on order_items for insert
  with check (
    organization_id = current_profile_org()
    and current_role_in('owner', 'cajero', 'mesero')
    and org_module_enabled(organization_id, 'mesas')
  );

drop policy if exists order_items_update on order_items;
create policy order_items_update on order_items for update
  using (organization_id = current_profile_org() and current_role_in('owner', 'cajero', 'mesero'))
  with check (organization_id = current_profile_org());

drop policy if exists order_items_delete on order_items;
create policy order_items_delete on order_items for delete
  using (organization_id = current_profile_org() and current_role_in('owner', 'cajero', 'mesero'));

-- ==========================================================================
-- caja
-- ==========================================================================
alter table cash_sessions enable row level security;

drop policy if exists cash_sessions_select on cash_sessions;
create policy cash_sessions_select on cash_sessions for select
  using (
    (organization_id = current_profile_org() and current_role_in('owner', 'cajero'))
    or is_super_admin()
  );
-- Abrir y cerrar turnos solo vía open_cash_session / close_cash_session.

alter table cash_movements enable row level security;

drop policy if exists cash_movements_select on cash_movements;
create policy cash_movements_select on cash_movements for select
  using (
    (organization_id = current_profile_org() and current_role_in('owner', 'cajero'))
    or is_super_admin()
  );

drop policy if exists cash_movements_insert on cash_movements;
create policy cash_movements_insert on cash_movements for insert
  with check (
    organization_id = current_profile_org()
    and current_role_in('owner', 'cajero')
    and org_module_enabled(organization_id, 'caja')
    and exists (
      select 1 from cash_sessions s
      where s.id = session_id and s.organization_id = cash_movements.organization_id
        and s.closed_at is null
    )
  );

-- ==========================================================================
-- activity_log
-- ==========================================================================
alter table activity_log enable row level security;

drop policy if exists activity_log_select on activity_log;
create policy activity_log_select on activity_log for select
  using (
    (organization_id = current_profile_org() and current_profile_role() = 'owner')
    or is_super_admin()
  );

drop policy if exists activity_log_insert on activity_log;
create policy activity_log_insert on activity_log for insert
  with check (organization_id = current_profile_org() or is_super_admin());
