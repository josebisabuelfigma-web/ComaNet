-- Combos, pantalla de cocina (módulo) y "recoger en el local".
-- Ejecutar después de 001-005. Idempotente.

-- ==========================================================================
-- 1) Rol "cocina" y módulo "cocina" (apagado por defecto, independiente)
-- ==========================================================================
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('super_admin', 'owner', 'cajero', 'mesero', 'cocina'));

insert into modules (key, name, description, price)
values (
  'cocina', 'Pantalla de cocina',
  'Cocina ve los pedidos (domicilios y mesas) con sus comentarios y marca cada uno como listo. Es independiente: no bloquea despachar ni cobrar.',
  0
)
on conflict (key) do update set name = excluded.name, description = excluded.description;

-- ==========================================================================
-- 2) Combos
-- ==========================================================================
alter table menu_categories add column if not exists is_combo_category boolean not null default false;
create unique index if not exists menu_categories_one_combo
  on menu_categories (organization_id) where is_combo_category;

alter table menu_products add column if not exists is_combo boolean not null default false;
create unique index if not exists menu_products_id_org_key on menu_products (id, organization_id);

create table if not exists menu_combo_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  combo_id uuid not null,
  product_id uuid not null,
  quantity int not null default 1 check (quantity between 1 and 20),
  foreign key (combo_id, organization_id)
    references menu_products (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id)
    references menu_products (id, organization_id) on delete restrict,
  unique (combo_id, product_id)
);

create index if not exists menu_combo_items_combo_idx on menu_combo_items (combo_id);

-- Un combo vive en la categoría de combos y solo se crea si ya existe al
-- menos un producto normal. Los productos normales no van en esa categoría.
create or replace function guard_menu_product_combo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_combo_cat boolean;
begin
  select is_combo_category into v_is_combo_cat
    from menu_categories where id = new.category_id and organization_id = new.organization_id;

  if coalesce(v_is_combo_cat, false) <> new.is_combo then
    if new.is_combo then
      raise exception 'Los combos solo se crean en la categoría de combos';
    else
      raise exception 'La categoría de combos solo admite combos';
    end if;
  end if;

  if new.is_combo and tg_op = 'INSERT' and not exists (
    select 1 from menu_products
    where organization_id = new.organization_id and not is_combo
  ) then
    raise exception 'Primero crea al menos un producto para poder armar combos';
  end if;

  return new;
end;
$$;

drop trigger if exists menu_products_guard_combo on menu_products;
create trigger menu_products_guard_combo
  before insert or update of category_id, is_combo on menu_products
  for each row execute function guard_menu_product_combo();

create or replace function guard_combo_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from menu_products where id = new.combo_id and organization_id = new.organization_id and is_combo
  ) then
    raise exception 'El combo no existe';
  end if;
  if exists (
    select 1 from menu_products where id = new.product_id and organization_id = new.organization_id and is_combo
  ) then
    raise exception 'Un combo no puede incluir otro combo';
  end if;
  return new;
end;
$$;

drop trigger if exists menu_combo_items_guard on menu_combo_items;
create trigger menu_combo_items_guard
  before insert or update on menu_combo_items
  for each row execute function guard_combo_item();

alter table menu_combo_items enable row level security;

drop policy if exists menu_combo_items_select on menu_combo_items;
create policy menu_combo_items_select on menu_combo_items for select
  using (
    org_menu_is_public(organization_id)
    or organization_id = current_profile_org()
    or is_super_admin()
  );

drop policy if exists menu_combo_items_insert on menu_combo_items;
create policy menu_combo_items_insert on menu_combo_items for insert
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists menu_combo_items_update on menu_combo_items;
create policy menu_combo_items_update on menu_combo_items for update
  using (organization_id = current_profile_org() and current_profile_role() = 'owner')
  with check (organization_id = current_profile_org() and current_profile_role() = 'owner');

drop policy if exists menu_combo_items_delete on menu_combo_items;
create policy menu_combo_items_delete on menu_combo_items for delete
  using (organization_id = current_profile_org() and current_profile_role() = 'owner');

-- ¿Se puede pedir este producto ahora? Un combo solo si todos sus productos
-- están activos y disponibles (y tiene al menos uno).
create or replace function product_is_orderable(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_active and p.is_available and (
      not p.is_combo or (
        exists (select 1 from menu_combo_items ci where ci.combo_id = p.id)
        and not exists (
          select 1 from menu_combo_items ci
          join menu_products c on c.id = ci.product_id
          where ci.combo_id = p.id and (not c.is_available or not c.is_active)
        )
      )
    )
    from menu_products p where p.id = p_id
  ), false)
$$;

-- ==========================================================================
-- 3) order_items: contenido del combo al momento de la venta + estado de cocina
-- ==========================================================================
alter table order_items add column if not exists combo_snapshot jsonb;
alter table order_items add column if not exists kitchen_status text not null default 'pendiente'
  check (kitchen_status in ('pendiente', 'listo'));
alter table order_items add column if not exists kitchen_done_at timestamptz;

create or replace function guard_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_prod menu_products%rowtype;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_internal boolean := coalesce(current_setting('comanet.internal', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if not v_is_service then
      select status into v_status from orders where id = old.order_id;
      if v_status is not null and v_status <> 'abierta' then
        raise exception 'La cuenta ya está cerrada y no se puede modificar';
      end if;
    end if;
    return old;
  end if;

  -- Cambios internos de cocina (set_item_kitchen_status): solo tocan el estado.
  if tg_op = 'UPDATE' and v_internal then
    return new;
  end if;

  if not v_is_service then
    select status into v_status from orders where id = new.order_id;
    if v_status is distinct from 'abierta' then
      -- Borrar un producto del menú desvincula (product_id = null) sus ventas
      -- pasadas: ese único cambio se permite; el nombre y el precio quedan.
      if tg_op = 'UPDATE' and new.product_id is null and old.product_id is not null
         and new.quantity = old.quantity and new.notes is not distinct from old.notes then
        return new;
      end if;
      raise exception 'La cuenta ya está cerrada y no se puede modificar';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.product_id is null then
      raise exception 'Falta el producto';
    end if;
    select * into v_prod from menu_products
      where id = new.product_id and organization_id = new.organization_id;
    if not found then
      raise exception 'Producto no encontrado';
    end if;
    if not product_is_orderable(v_prod.id) then
      raise exception 'El producto "%" está agotado', v_prod.name;
    end if;
    new.product_name := v_prod.name;
    new.unit_price := v_prod.price;
    new.kitchen_status := 'pendiente';
    new.kitchen_done_at := null;

    if v_prod.is_combo then
      select jsonb_agg(jsonb_build_object(
               'product_id', c.id, 'name', c.name,
               'quantity', ci.quantity, 'unit_price', c.price)
             order by c.name)
        into new.combo_snapshot
        from menu_combo_items ci
        join menu_products c on c.id = ci.product_id
        where ci.combo_id = v_prod.id;
    else
      new.combo_snapshot := null;
    end if;
  else
    -- UPDATE: solo cantidad y notas.
    new.product_id := old.product_id;
    new.product_name := old.product_name;
    new.unit_price := old.unit_price;
    new.combo_snapshot := old.combo_snapshot;
    new.order_id := old.order_id;
    new.organization_id := old.organization_id;
    new.kitchen_status := old.kitchen_status;
    new.kitchen_done_at := old.kitchen_done_at;
  end if;

  new.notes := nullif(left(trim(coalesce(new.notes, '')), 200), '');
  return new;
end;
$$;

-- Cocina marca items (o un pedido completo) como listos. No afecta el flujo
-- de despachar / cobrar: es solo información para el equipo.
create or replace function set_item_kitchen_status(p_item_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_order_status text;
begin
  if not current_role_in('owner', 'cajero', 'cocina') then
    raise exception 'No autorizado';
  end if;
  if not org_module_enabled(v_org, 'cocina') then
    raise exception 'El módulo de cocina no está activo';
  end if;

  select o.status into v_order_status
    from order_items i join orders o on o.id = i.order_id
    where i.id = p_item_id and i.organization_id = v_org;
  if v_order_status is null then
    raise exception 'Producto no encontrado';
  end if;
  if v_order_status not in ('pendiente', 'abierta') then
    raise exception 'El pedido ya no está activo';
  end if;

  perform set_config('comanet.internal', '1', true);
  update order_items
     set kitchen_status = case when p_ready then 'listo' else 'pendiente' end,
         kitchen_done_at = case when p_ready then now() else null end
   where id = p_item_id;
  perform set_config('comanet.internal', '', true);
end;
$$;

create or replace function set_order_kitchen_status(p_order_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_order_status text;
begin
  if not current_role_in('owner', 'cajero', 'cocina') then
    raise exception 'No autorizado';
  end if;
  if not org_module_enabled(v_org, 'cocina') then
    raise exception 'El módulo de cocina no está activo';
  end if;

  select status into v_order_status from orders where id = p_order_id and organization_id = v_org;
  if v_order_status is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_order_status not in ('pendiente', 'abierta') then
    raise exception 'El pedido ya no está activo';
  end if;

  perform set_config('comanet.internal', '1', true);
  update order_items
     set kitchen_status = case when p_ready then 'listo' else 'pendiente' end,
         kitchen_done_at = case when p_ready then now() else null end
   where order_id = p_order_id and organization_id = v_org;
  perform set_config('comanet.internal', '', true);
end;
$$;

grant execute on function set_item_kitchen_status(uuid, boolean) to authenticated;
grant execute on function set_order_kitchen_status(uuid, boolean) to authenticated;

-- ==========================================================================
-- 4) Recoger en el local
-- ==========================================================================
alter table restaurant_settings add column if not exists pickup_enabled boolean not null default true;
alter table orders add column if not exists fulfillment text check (fulfillment in ('domicilio', 'recoger'));

drop function if exists create_delivery_order(uuid, jsonb, text, text, text, text, text);

create or replace function create_delivery_order(
  p_org uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_address text,
  p_notes text,
  p_payment text,
  p_fulfillment text default 'domicilio'
)
returns table (
  order_id uuid,
  order_number int,
  subtotal numeric,
  delivery_fee numeric,
  disposables_fee numeric,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_settings restaurant_settings%rowtype;
  v_item jsonb;
  v_prod menu_products%rowtype;
  v_qty int;
  v_subtotal numeric(12, 2) := 0;
  v_delivery numeric(12, 2);
  v_order_id uuid;
  v_order_number int;
begin
  if not org_menu_is_public(p_org) then
    raise exception 'Este negocio no está recibiendo pedidos en línea';
  end if;

  select * into v_settings from restaurant_settings where organization_id = p_org;
  if not found or not v_settings.orders_open then
    raise exception 'El negocio no está recibiendo pedidos en este momento';
  end if;

  if p_fulfillment not in ('domicilio', 'recoger') then
    raise exception 'Selecciona si es domicilio o recoger en el local';
  end if;
  if p_fulfillment = 'recoger' and not v_settings.pickup_enabled then
    raise exception 'Este negocio no tiene la opción de recoger en el local';
  end if;

  if p_payment not in ('efectivo', 'transferencia') then
    raise exception 'Selecciona un medio de pago válido';
  end if;
  if p_payment = 'efectivo' and not v_settings.accepts_cash then
    raise exception 'Este negocio no acepta pago en efectivo';
  end if;
  if p_payment = 'transferencia' and not v_settings.accepts_transfer then
    raise exception 'Este negocio no acepta pago por transferencia';
  end if;

  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'El nombre es obligatorio';
  end if;
  if p_fulfillment = 'domicilio' and coalesce(trim(p_address), '') = '' then
    raise exception 'La dirección es obligatoria para domicilio';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;
  if jsonb_array_length(p_items) > 60 then
    raise exception 'Demasiados productos en un solo pedido';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 50 then
      raise exception 'Cantidad inválida';
    end if;

    select * into v_prod from menu_products
      where id = (v_item->>'productId')::uuid and organization_id = p_org;
    if not found or not v_prod.is_active then
      raise exception 'Uno de los productos ya no está en la carta';
    end if;
    if not product_is_orderable(v_prod.id) then
      raise exception 'El producto "%" está agotado, quítalo del carrito', v_prod.name;
    end if;

    v_subtotal := v_subtotal + v_prod.price * v_qty;
  end loop;

  v_delivery := case when p_fulfillment = 'domicilio' then v_settings.delivery_fee else 0 end;

  insert into orders (
    organization_id, order_number, channel, status, fulfillment,
    customer_name, customer_phone, address, notes, payment_method,
    subtotal, delivery_fee, disposables_fee, total
  ) values (
    p_org, 0, 'domicilio', 'pendiente', p_fulfillment,
    left(trim(p_customer_name), 120), left(trim(coalesce(p_customer_phone, '')), 30),
    case when p_fulfillment = 'domicilio' then left(trim(p_address), 250) else null end,
    nullif(left(trim(coalesce(p_notes, '')), 300), ''), p_payment,
    v_subtotal, v_delivery, v_settings.disposables_fee,
    v_subtotal + v_delivery + v_settings.disposables_fee
  )
  returning id, orders.order_number into v_order_id, v_order_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity, notes)
    values (
      p_org, v_order_id, (v_item->>'productId')::uuid, '', 0,
      (v_item->>'quantity')::int, v_item->>'notes'
    );
  end loop;

  return query
    select o.id, o.order_number, o.subtotal, o.delivery_fee, o.disposables_fee, o.total
    from orders o where o.id = v_order_id;
end;
$$;

revoke all on function create_delivery_order(uuid, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function create_delivery_order(uuid, jsonb, text, text, text, text, text, text) to service_role;

-- ==========================================================================
-- 5) Reportes: los combos se desglosan producto por producto
-- ==========================================================================
drop function if exists report_sales_summary(timestamptz, timestamptz);

create or replace function report_sales_summary(p_from timestamptz, p_to timestamptz)
returns table (
  channel text,
  fulfillment text,
  payment_method text,
  orders_count bigint,
  subtotal numeric,
  delivery_fees numeric,
  disposables numeric,
  total numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select o.channel, coalesce(o.fulfillment, 'mesa'), coalesce(o.payment_method, 'sin definir'),
         count(*), coalesce(sum(o.subtotal), 0), coalesce(sum(o.delivery_fee), 0),
         coalesce(sum(o.disposables_fee), 0), coalesce(sum(o.total), 0)
  from orders o
  where o.organization_id = current_profile_org()
    and o.status in ('despachado', 'pagada')
    and o.completed_at >= p_from and o.completed_at < p_to
  group by o.channel, o.fulfillment, o.payment_method
$$;

-- Productos sueltos tal cual; los combos se expanden con su contenido de la
-- venta y el valor del combo se reparte según el precio de lista de cada parte.
create or replace function report_sales_by_product(p_from timestamptz, p_to timestamptz)
returns table (
  product_name text,
  channel text,
  quantity bigint,
  revenue numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with sold as (
    select i.*, o.channel as order_channel
    from order_items i
    join orders o on o.id = i.order_id
    where o.organization_id = current_profile_org()
      and o.status in ('despachado', 'pagada')
      and o.completed_at >= p_from and o.completed_at < p_to
  ),
  plain as (
    select s.product_name as name, s.order_channel as ch,
           s.quantity::bigint as qty, s.unit_price * s.quantity as rev
    from sold s
    where s.combo_snapshot is null
  ),
  expanded as (
    select c.value->>'name' as name, s.order_channel as ch,
           (s.quantity * (c.value->>'quantity')::int)::bigint as qty,
           s.unit_price * s.quantity *
             coalesce(
               ((c.value->>'unit_price')::numeric * (c.value->>'quantity')::numeric)
                 / nullif((select sum((x.value->>'unit_price')::numeric * (x.value->>'quantity')::numeric)
                           from jsonb_array_elements(s.combo_snapshot) x), 0),
               1.0 / jsonb_array_length(s.combo_snapshot)
             ) as rev
    from sold s
    cross join lateral jsonb_array_elements(s.combo_snapshot) c
    where s.combo_snapshot is not null
  )
  select name, ch, sum(qty)::bigint, coalesce(sum(rev), 0)
  from (select * from plain union all select * from expanded) t
  group by name, ch
$$;

grant execute on function report_sales_summary(timestamptz, timestamptz) to authenticated;
grant execute on function report_sales_by_product(timestamptz, timestamptz) to authenticated;

-- ==========================================================================
-- 6) Realtime de los componentes del combo
-- ==========================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_combo_items'
  ) then
    alter publication supabase_realtime add table public.menu_combo_items;
  end if;
end $$;
