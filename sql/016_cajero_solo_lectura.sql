-- El cajero solo VE la cocina y las mesas; no las edita. Cobra desde Caja.
--   Mesas:  abrir, agregar/quitar, enviar a cocina, "cuenta entregada" y cancelar
--           -> administrador (y mesero, salvo cancelar).
--   Cocina: despachar productos y ver avisos -> administrador y cocina.
--   Cajero: ve todo, envía domicilios a cocina (Pedidos) y cobra en Caja.
-- Ejecutar después de 001-015. Idempotente.

-- ==========================================================================
-- 1) Políticas (RLS): mesas solo owner y mesero
-- ==========================================================================
drop policy if exists orders_insert_mesa on orders;
create policy orders_insert_mesa on orders for insert
  with check (
    organization_id = current_profile_org()
    and channel = 'mesa'
    and status = 'abierta'
    and current_role_in('owner', 'mesero')
    and org_module_enabled(organization_id, 'mesas')
  );

drop policy if exists order_items_insert on order_items;
create policy order_items_insert on order_items for insert
  with check (
    organization_id = current_profile_org()
    and (
      (
        current_role_in('owner', 'mesero')
        and org_module_enabled(organization_id, 'mesas')
        and exists (select 1 from orders o where o.id = order_id and o.channel = 'mesa')
      )
      or (
        current_role_in('owner', 'cajero')
        and org_module_enabled(organization_id, 'menu_online')
        and exists (select 1 from orders o where o.id = order_id and o.channel = 'domicilio')
      )
    )
  );

drop policy if exists order_items_update on order_items;
create policy order_items_update on order_items for update
  using (
    organization_id = current_profile_org()
    and exists (
      select 1 from orders o where o.id = order_id and (
        (o.channel = 'mesa' and current_role_in('owner', 'mesero'))
        or (o.channel = 'domicilio' and current_role_in('owner', 'cajero'))
      )
    )
  )
  with check (organization_id = current_profile_org());

drop policy if exists order_items_delete on order_items;
create policy order_items_delete on order_items for delete
  using (
    organization_id = current_profile_org()
    and exists (
      select 1 from orders o where o.id = order_id and (
        (o.channel = 'mesa' and current_role_in('owner', 'mesero'))
        or (o.channel = 'domicilio' and current_role_in('owner', 'cajero'))
      )
    )
  );

-- ==========================================================================
-- 2) Enviar a cocina: mesas (owner, mesero) / domicilios (owner, cajero)
-- ==========================================================================
create or replace function send_order_to_kitchen(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_order orders%rowtype;
  v_had_sent boolean;
  v_desc text;
begin
  if not current_role_in('owner', 'cajero', 'mesero') then
    raise exception 'No autorizado';
  end if;
  if not org_module_enabled(v_org, 'cocina') then
    raise exception 'El módulo de cocina no está activo';
  end if;

  select * into v_order from orders where id = p_order_id and organization_id = v_org for update;
  if not found then
    raise exception 'Pedido no encontrado';
  end if;
  if v_order.status not in ('pendiente', 'abierta') then
    raise exception 'El pedido ya no está activo';
  end if;
  if v_order.channel = 'domicilio' and not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;
  if v_order.channel = 'mesa' and not current_role_in('owner', 'mesero') then
    raise exception 'No autorizado';
  end if;

  select string_agg(quantity || '× ' || product_name, ', ' order by created_at)
    into v_desc
    from order_items where order_id = p_order_id and sent_to_kitchen_at is null;
  if v_desc is null then
    raise exception 'No hay productos nuevos para enviar a cocina';
  end if;

  v_had_sent := exists (
    select 1 from order_items where order_id = p_order_id and sent_to_kitchen_at is not null
  );

  perform set_config('comanet.internal', '1', true);
  update order_items
     set sent_to_kitchen_at = now(), kitchen_status = 'pendiente', kitchen_done_at = null
   where order_id = p_order_id and sent_to_kitchen_at is null;
  perform set_config('comanet.internal', '', true);

  update orders
     set kitchen_sent_at = coalesce(kitchen_sent_at, now()), kitchen_done_at = null
   where id = p_order_id;

  insert into kitchen_changes (organization_id, order_id, kind, description, created_by, acked_at)
  values (
    v_org, p_order_id,
    case when v_had_sent then 'agregado' else 'envio' end,
    v_desc, auth.uid(),
    case when v_had_sent then null else now() end
  );
end;
$$;

-- ==========================================================================
-- 3) Pantalla de cocina: solo administrador y cocina
-- ==========================================================================
create or replace function ack_kitchen_changes(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
begin
  if not current_role_in('owner', 'cocina') then
    raise exception 'No autorizado';
  end if;
  update kitchen_changes set acked_at = now()
   where order_id = p_order_id and organization_id = v_org and acked_at is null;
end;
$$;

create or replace function set_item_kitchen_status(p_item_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_order_status text;
  v_order_id uuid;
begin
  if not current_role_in('owner', 'cocina') then
    raise exception 'No autorizado';
  end if;
  if not org_module_enabled(v_org, 'cocina') then
    raise exception 'El módulo de cocina no está activo';
  end if;

  select o.status, o.id into v_order_status, v_order_id
    from order_items i join orders o on o.id = i.order_id
    where i.id = p_item_id and i.organization_id = v_org and i.sent_to_kitchen_at is not null;
  if v_order_status is null then
    raise exception 'Producto no encontrado en cocina';
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
  perform refresh_order_kitchen(v_order_id);
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
  if not current_role_in('owner', 'cocina') then
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
         kitchen_done_at = case when p_ready then coalesce(kitchen_done_at, now()) else null end
   where order_id = p_order_id and organization_id = v_org and sent_to_kitchen_at is not null;
  perform set_config('comanet.internal', '', true);
  perform refresh_order_kitchen(p_order_id);
end;
$$;

-- ==========================================================================
-- 4) Cuenta entregada y cancelación de mesas
-- ==========================================================================
create or replace function request_table_payment(p_order_id uuid, p_payment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_total numeric(12, 2);
begin
  if not current_role_in('owner', 'mesero') then
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

  select coalesce(sum(unit_price * quantity), 0) into v_total from order_items where order_id = p_order_id;
  if v_total <= 0 then
    raise exception 'La cuenta no tiene productos';
  end if;

  update orders set payment_requested_at = now(), payment_requested_method = p_payment
   where id = p_order_id;
end;
$$;

create or replace function cancel_table_payment_request(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not current_role_in('owner', 'mesero') then
    raise exception 'No autorizado';
  end if;
  update orders set payment_requested_at = null, payment_requested_method = null
   where id = p_order_id and organization_id = current_profile_org()
     and channel = 'mesa' and status = 'abierta';
end;
$$;

-- Cancelar una mesa lo hace el administrador; el cajero cancela domicilios.
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
  if v_order.channel = 'mesa' and not current_role_in('owner') then
    raise exception 'Solo el administrador cancela una mesa';
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

revoke all on function send_order_to_kitchen(uuid) from public, anon;
revoke all on function ack_kitchen_changes(uuid) from public, anon;
revoke all on function set_item_kitchen_status(uuid, boolean) from public, anon;
revoke all on function set_order_kitchen_status(uuid, boolean) from public, anon;
revoke all on function request_table_payment(uuid, text) from public, anon;
revoke all on function cancel_table_payment_request(uuid) from public, anon;
grant execute on function send_order_to_kitchen(uuid) to authenticated;
grant execute on function ack_kitchen_changes(uuid) to authenticated;
grant execute on function set_item_kitchen_status(uuid, boolean) to authenticated;
grant execute on function set_order_kitchen_status(uuid, boolean) to authenticated;
grant execute on function request_table_payment(uuid, text) to authenticated;
grant execute on function cancel_table_payment_request(uuid) to authenticated;
