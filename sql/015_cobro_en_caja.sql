-- Cobro en caja: mesas y domicilios se cierran solo cuando caja (o el
-- administrador) recibe el dinero.
--   Domicilio: pendiente -> despachado (enviado, por cobrar) -> pagada | cancelado
--   Mesa:      abierta (cuenta entregada) -> pagada | cancelado
-- La venta cuenta al cobrarse (completed_at). Los domicilios despachados antes
-- de esta migración ya tienen completed_at: siguen contando como vendidos.
-- Ejecutar después de 001-014. Idempotente.

-- ==========================================================================
-- 1) Columnas
-- ==========================================================================
alter table orders add column if not exists dispatched_at timestamptz;
alter table orders add column if not exists dispatched_by uuid references profiles (id) on delete set null;
-- Efectivo que entregó el cliente y cambio devuelto (null si fue transferencia).
alter table orders add column if not exists cash_received numeric(12, 2);
alter table orders add column if not exists change_given numeric(12, 2);

update orders set dispatched_at = completed_at
 where channel = 'domicilio' and status = 'despachado' and dispatched_at is null;

create index if not exists orders_por_cobrar_idx on orders (organization_id)
  where status = 'despachado' and completed_at is null;

-- ==========================================================================
-- 2) Corrección: borrar un producto debe desvincular sus líneas también en
--    pedidos activos (antes la línea quedaba apuntando a un producto borrado).
-- ==========================================================================
create or replace function guard_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_prod menu_products%rowtype;
  v_notes text;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_internal boolean := coalesce(current_setting('comanet.internal', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if not v_is_service then
      select status into v_status from orders where id = old.order_id;
      if v_status is not null and v_status not in ('abierta', 'pendiente') then
        raise exception 'La cuenta ya está cerrada y no se puede modificar';
      end if;
    end if;
    return old;
  end if;

  -- Cambios internos (cocina, envío a cocina): solo tocan el estado.
  if tg_op = 'UPDATE' and v_internal then
    return new;
  end if;

  -- Borrar un producto de la carta desvincula (product_id = null) sus líneas,
  -- estén activas o cerradas: el nombre y el precio quedan en la línea.
  if tg_op = 'UPDATE' and new.product_id is null and old.product_id is not null
     and new.quantity = old.quantity and new.notes is not distinct from old.notes then
    return new;
  end if;

  if not v_is_service then
    select status into v_status from orders where id = new.order_id;
    if v_status is null or v_status not in ('abierta', 'pendiente') then
      raise exception 'La cuenta ya está cerrada y no se puede modificar';
    end if;
  end if;

  v_notes := nullif(left(trim(coalesce(new.notes, '')), 200), '');

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
    new.sent_to_kitchen_at := null;

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
    new.sent_to_kitchen_at := old.sent_to_kitchen_at;
    -- Si ya estaba en cocina y piden más o cambian la nota, hay que prepararlo de nuevo.
    if old.sent_to_kitchen_at is not null
       and (new.quantity > old.quantity or v_notes is distinct from old.notes) then
      new.kitchen_status := 'pendiente';
      new.kitchen_done_at := null;
    else
      new.kitchen_status := old.kitchen_status;
      new.kitchen_done_at := old.kitchen_done_at;
    end if;
  end if;

  new.notes := v_notes;
  return new;
end;
$$;

-- Repara las líneas que ya quedaron apuntando a un producto borrado.
do $$
begin
  perform set_config('comanet.internal', '1', true);
  update order_items i set product_id = null
   where i.product_id is not null
     and not exists (select 1 from menu_products p where p.id = i.product_id);
  perform set_config('comanet.internal', '', true);
end $$;

-- ==========================================================================
-- 3) Enviar el domicilio: sale, pero sigue abierto hasta que caja lo cobre
-- ==========================================================================
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
     set status = 'despachado', dispatched_at = now(), dispatched_by = auth.uid()
   where id = p_order_id;
end;
$$;

-- También se puede cancelar un domicilio enviado que aún no se ha cobrado.
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
  if not (
    v_order.status in ('pendiente', 'abierta')
    or (v_order.status = 'despachado' and v_order.completed_at is null)
  ) then
    raise exception 'Este pedido ya no se puede cancelar';
  end if;

  update orders
     set status = 'cancelado', completed_at = now(), completed_by = auth.uid()
   where id = p_order_id;
end;
$$;

-- ==========================================================================
-- 4) Cobrar: con el módulo de caja activo debe haber un turno abierto, para
--    que toda venta entre a un cierre.
-- ==========================================================================
create or replace function assert_cash_open(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if org_module_enabled(p_org, 'caja') and not exists (
    select 1 from cash_sessions where organization_id = p_org and closed_at is null
  ) then
    raise exception 'Abre la caja antes de cobrar';
  end if;
end;
$$;

drop function if exists close_table_order(uuid, text);

create or replace function close_table_order(
  p_order_id uuid,
  p_payment text,
  p_cash_received numeric default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_order orders%rowtype;
  v_total numeric(12, 2);
  v_received numeric(12, 2);
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;
  if p_payment not in ('efectivo', 'transferencia') then
    raise exception 'Selecciona un medio de pago válido';
  end if;

  select * into v_order from orders
    where id = p_order_id and organization_id = v_org for update;
  if not found or v_order.channel <> 'mesa' then
    raise exception 'Cuenta no encontrada';
  end if;
  if v_order.status <> 'abierta' then
    raise exception 'Esta cuenta ya está cerrada';
  end if;
  perform assert_cash_open(v_org);

  select coalesce(sum(unit_price * quantity), 0) into v_total
    from order_items where order_id = p_order_id;
  if v_total <= 0 then
    raise exception 'La cuenta no tiene productos. Si no se consumió nada, cancélala.';
  end if;

  if p_payment = 'efectivo' then
    v_received := coalesce(p_cash_received, v_total);
    if v_received < v_total then
      raise exception 'El dinero recibido es menor al total';
    end if;
  end if;

  update orders
     set status = 'pagada', payment_method = p_payment,
         subtotal = v_total, total = v_total,
         cash_received = v_received,
         change_given = case when v_received is null then null else v_received - v_total end,
         payment_requested_at = null, payment_requested_method = null,
         completed_at = now(), completed_by = auth.uid()
   where id = p_order_id;

  return v_total;
end;
$$;

create or replace function close_delivery_order(
  p_order_id uuid,
  p_payment text,
  p_cash_received numeric default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_order orders%rowtype;
  v_received numeric(12, 2);
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;
  if p_payment not in ('efectivo', 'transferencia') then
    raise exception 'Selecciona un medio de pago válido';
  end if;

  select * into v_order from orders
    where id = p_order_id and organization_id = v_org for update;
  if not found or v_order.channel <> 'domicilio' then
    raise exception 'Pedido no encontrado';
  end if;
  if v_order.status = 'pendiente' then
    raise exception 'Primero marca el pedido como enviado';
  end if;
  if v_order.status <> 'despachado' or v_order.completed_at is not null then
    raise exception 'Este pedido ya está cerrado';
  end if;
  perform assert_cash_open(v_org);

  if p_payment = 'efectivo' then
    v_received := coalesce(p_cash_received, v_order.total);
    if v_received < v_order.total then
      raise exception 'El dinero recibido es menor al total';
    end if;
  end if;

  update orders
     set status = 'pagada', payment_method = p_payment,
         cash_received = v_received,
         change_given = case when v_received is null then null else v_received - v_order.total end,
         completed_at = now(), completed_by = auth.uid()
   where id = p_order_id;

  return v_order.total;
end;
$$;

revoke all on function assert_cash_open(uuid) from public, anon, authenticated;
revoke all on function close_table_order(uuid, text, numeric) from public, anon;
revoke all on function close_delivery_order(uuid, text, numeric) from public, anon;
grant execute on function close_table_order(uuid, text, numeric) to authenticated;
grant execute on function close_delivery_order(uuid, text, numeric) to authenticated;
