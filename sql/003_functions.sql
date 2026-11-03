-- Funciones y triggers de negocio. Ejecutar después de 002. Idempotente.

-- --------------------------------------------------------------------------
-- Numeración de pedidos
-- --------------------------------------------------------------------------
drop trigger if exists orders_assign_number on orders;
create trigger orders_assign_number
  before insert on orders
  for each row execute function assign_order_number();

-- --------------------------------------------------------------------------
-- order_items: el precio y el nombre SIEMPRE se toman de la carta (nadie los
-- manda desde el cliente) y solo se editan items de cuentas de mesa abiertas.
-- La service role (pedidos de domicilio, borrado de organizaciones) no está
-- sujeta a la restricción de "cuenta abierta", pero sí al precio de la carta.
-- --------------------------------------------------------------------------
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

  if not v_is_service then
    select status into v_status from orders where id = new.order_id;
    if v_status is distinct from 'abierta' then
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
    if not v_prod.is_available or not v_prod.is_active then
      raise exception 'El producto "%" está agotado', v_prod.name;
    end if;
    new.product_name := v_prod.name;
    new.unit_price := v_prod.price;
  else
    -- UPDATE: solo se pueden cambiar cantidad y notas.
    new.product_id := old.product_id;
    new.product_name := old.product_name;
    new.unit_price := old.unit_price;
    new.order_id := old.order_id;
    new.organization_id := old.organization_id;
  end if;

  new.notes := nullif(left(trim(coalesce(new.notes, '')), 200), '');
  return new;
end;
$$;

drop trigger if exists order_items_guard on order_items;
create trigger order_items_guard
  before insert or update or delete on order_items
  for each row execute function guard_order_item();

-- --------------------------------------------------------------------------
-- create_delivery_order: pedido público de domicilio. Solo la service role
-- (acción del servidor) puede llamarla. Recalcula todo desde la base de datos.
-- p_items: [{"productId": "...", "quantity": 2, "notes": "sin cebolla"}]
-- --------------------------------------------------------------------------
create or replace function create_delivery_order(
  p_org uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_address text,
  p_notes text,
  p_payment text
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
  v_order_id uuid;
  v_order_number int;
  v_count int := 0;
begin
  if not org_menu_is_public(p_org) then
    raise exception 'Este negocio no está recibiendo pedidos en línea';
  end if;

  select * into v_settings from restaurant_settings where organization_id = p_org;
  if not found or not v_settings.orders_open then
    raise exception 'El negocio no está recibiendo pedidos en este momento';
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

  if coalesce(trim(p_customer_name), '') = '' or coalesce(trim(p_address), '') = '' then
    raise exception 'El nombre y la dirección son obligatorios';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;
  if jsonb_array_length(p_items) > 60 then
    raise exception 'Demasiados productos en un solo pedido';
  end if;

  -- 1) Valida productos y calcula el subtotal con los precios de la carta.
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
    if not v_prod.is_available then
      raise exception 'El producto "%" está agotado, quítalo del carrito', v_prod.name;
    end if;

    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_count := v_count + 1;
  end loop;

  -- 2) Crea el pedido.
  insert into orders (
    organization_id, order_number, channel, status,
    customer_name, customer_phone, address, notes, payment_method,
    subtotal, delivery_fee, disposables_fee, total
  ) values (
    p_org, 0, 'domicilio', 'pendiente',
    left(trim(p_customer_name), 120), left(trim(coalesce(p_customer_phone, '')), 30),
    left(trim(p_address), 250), nullif(left(trim(coalesce(p_notes, '')), 300), ''), p_payment,
    v_subtotal, v_settings.delivery_fee, v_settings.disposables_fee,
    v_subtotal + v_settings.delivery_fee + v_settings.disposables_fee
  )
  returning id, orders.order_number into v_order_id, v_order_number;

  -- 3) Items (el trigger fija nombre y precio desde la carta).
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

revoke all on function create_delivery_order(uuid, jsonb, text, text, text, text, text) from public, anon, authenticated;
grant execute on function create_delivery_order(uuid, jsonb, text, text, text, text, text) to service_role;

-- --------------------------------------------------------------------------
-- Despachar / cancelar / cobrar
-- --------------------------------------------------------------------------
create or replace function dispatch_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;

  select * into v_order from orders
    where id = p_order_id and organization_id = current_profile_org() for update;
  if not found or v_order.channel <> 'domicilio' then
    raise exception 'Pedido no encontrado';
  end if;
  if v_order.status <> 'pendiente' then
    raise exception 'Este pedido ya no está pendiente';
  end if;

  update orders
     set status = 'despachado', completed_at = now(), completed_by = auth.uid()
   where id = p_order_id;
end;
$$;

create or replace function cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;

  select * into v_order from orders
    where id = p_order_id and organization_id = current_profile_org() for update;
  if not found then
    raise exception 'Pedido no encontrado';
  end if;
  if v_order.status not in ('pendiente', 'abierta') then
    raise exception 'Este pedido ya no se puede cancelar';
  end if;

  update orders
     set status = 'cancelado', completed_at = now(), completed_by = auth.uid()
   where id = p_order_id;
end;
$$;

create or replace function close_table_order(p_order_id uuid, p_payment text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_total numeric(12, 2);
begin
  if not current_role_in('owner', 'cajero', 'mesero') then
    raise exception 'No autorizado';
  end if;
  if p_payment not in ('efectivo', 'transferencia') then
    raise exception 'Selecciona un medio de pago válido';
  end if;

  select * into v_order from orders
    where id = p_order_id and organization_id = current_profile_org() for update;
  if not found or v_order.channel <> 'mesa' then
    raise exception 'Cuenta no encontrada';
  end if;
  if v_order.status <> 'abierta' then
    raise exception 'Esta cuenta ya está cerrada';
  end if;

  select coalesce(sum(unit_price * quantity), 0) into v_total
    from order_items where order_id = p_order_id;
  if v_total <= 0 then
    raise exception 'La cuenta no tiene productos. Si no se consumió nada, cancélala.';
  end if;

  update orders
     set status = 'pagada', payment_method = p_payment,
         subtotal = v_total, total = v_total,
         completed_at = now(), completed_by = auth.uid()
   where id = p_order_id;

  return v_total;
end;
$$;

-- Agotar / habilitar un producto lo puede hacer también el cajero.
create or replace function set_product_availability(p_product_id uuid, p_available boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;

  update menu_products
     set is_available = p_available
   where id = p_product_id and organization_id = current_profile_org();
  if not found then
    raise exception 'Producto no encontrado';
  end if;
end;
$$;

grant execute on function dispatch_order(uuid) to authenticated;
grant execute on function cancel_order(uuid) to authenticated;
grant execute on function close_table_order(uuid, text) to authenticated;
grant execute on function set_product_availability(uuid, boolean) to authenticated;

-- --------------------------------------------------------------------------
-- Caja: abrir turno y cerrar con arqueo
-- --------------------------------------------------------------------------
create or replace function open_cash_session(p_opening numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_id uuid;
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;
  if not org_module_enabled(v_org, 'caja') then
    raise exception 'El módulo de caja no está activo';
  end if;
  if p_opening is null or p_opening < 0 then
    raise exception 'La base inicial no es válida';
  end if;
  if exists (select 1 from cash_sessions where organization_id = v_org and closed_at is null) then
    raise exception 'Ya hay una caja abierta';
  end if;

  insert into cash_sessions (organization_id, opening_amount, opened_by)
  values (v_org, p_opening, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function close_cash_session(p_session_id uuid, p_counted numeric, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_session cash_sessions%rowtype;
  v_now timestamptz := now();
  v_cash numeric(12, 2);
  v_transfer numeric(12, 2);
  v_orders int;
  v_ing numeric(12, 2);
  v_egr numeric(12, 2);
  v_expected numeric(12, 2);
  v_summary jsonb;
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'El efectivo contado no es válido';
  end if;

  select * into v_session from cash_sessions
    where id = p_session_id and organization_id = v_org for update;
  if not found then
    raise exception 'Turno de caja no encontrado';
  end if;
  if v_session.closed_at is not null then
    raise exception 'Esta caja ya fue cerrada';
  end if;

  select
    coalesce(sum(total) filter (where payment_method = 'efectivo'), 0),
    coalesce(sum(total) filter (where payment_method = 'transferencia'), 0),
    count(*)
  into v_cash, v_transfer, v_orders
  from orders
  where organization_id = v_org
    and status in ('despachado', 'pagada')
    and completed_at >= v_session.opened_at and completed_at <= v_now;

  select
    coalesce(sum(amount) filter (where type = 'ingreso'), 0),
    coalesce(sum(amount) filter (where type = 'egreso'), 0)
  into v_ing, v_egr
  from cash_movements where session_id = p_session_id;

  v_expected := v_session.opening_amount + v_cash + v_ing - v_egr;

  v_summary := jsonb_build_object(
    'orders', v_orders,
    'cash_sales', v_cash,
    'transfer_sales', v_transfer,
    'ingresos', v_ing,
    'egresos', v_egr
  );

  update cash_sessions
     set closed_at = v_now, closed_by = auth.uid(),
         counted_cash = p_counted, expected_cash = v_expected,
         difference = p_counted - v_expected, summary = v_summary,
         notes = nullif(left(trim(coalesce(p_notes, '')), 500), '')
   where id = p_session_id;

  return v_summary || jsonb_build_object(
    'expected_cash', v_expected,
    'counted_cash', p_counted,
    'difference', p_counted - v_expected
  );
end;
$$;

grant execute on function open_cash_session(numeric) to authenticated;
grant execute on function close_cash_session(uuid, numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- Reportes (security invoker: respetan RLS; filtran por la org del usuario)
-- --------------------------------------------------------------------------
-- (006 cambia las columnas de este reporte; se recrea para que el script sea re-ejecutable)
drop function if exists report_sales_summary(timestamptz, timestamptz);

create or replace function report_sales_summary(p_from timestamptz, p_to timestamptz)
returns table (
  channel text,
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
  select o.channel, coalesce(o.payment_method, 'sin definir'),
         count(*), coalesce(sum(o.subtotal), 0), coalesce(sum(o.delivery_fee), 0),
         coalesce(sum(o.disposables_fee), 0), coalesce(sum(o.total), 0)
  from orders o
  where o.organization_id = current_profile_org()
    and o.status in ('despachado', 'pagada')
    and o.completed_at >= p_from and o.completed_at < p_to
  group by o.channel, o.payment_method
$$;

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
  select i.product_name, o.channel, sum(i.quantity)::bigint,
         coalesce(sum(i.unit_price * i.quantity), 0)
  from order_items i
  join orders o on o.id = i.order_id
  where o.organization_id = current_profile_org()
    and o.status in ('despachado', 'pagada')
    and o.completed_at >= p_from and o.completed_at < p_to
  group by i.product_name, o.channel
$$;

grant execute on function report_sales_summary(timestamptz, timestamptz) to authenticated;
grant execute on function report_sales_by_product(timestamptz, timestamptz) to authenticated;
