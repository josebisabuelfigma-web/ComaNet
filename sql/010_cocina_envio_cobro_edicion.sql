-- Cocina con "Enviar a cocina", avisos de cambios, tiempos de cocina, cobro de
-- mesas en dos pasos (mesero pide cobro, caja confirma) y edición de pedidos
-- a domicilio. Ejecutar después de 001-009. Idempotente.

-- ==========================================================================
-- 1) Columnas nuevas
-- ==========================================================================
-- Un producto solo aparece en cocina cuando alguien lo envía (sent_to_kitchen_at).
alter table order_items add column if not exists sent_to_kitchen_at timestamptz;
-- Tiempos de cocina por pedido: primer envío y momento en que todo quedó despachado.
alter table orders add column if not exists kitchen_sent_at timestamptz;
alter table orders add column if not exists kitchen_done_at timestamptz;
-- Cobro de mesa en dos pasos: el mesero lo pide, caja/administrador lo confirma.
alter table orders add column if not exists payment_requested_at timestamptz;
alter table orders add column if not exists payment_requested_method text
  check (payment_requested_method in ('efectivo', 'transferencia'));

-- Lo que ya existe se considera enviado (así nada desaparece de cocina al migrar).
do $$
begin
  perform set_config('comanet.internal', '1', true);
  update order_items set sent_to_kitchen_at = created_at where sent_to_kitchen_at is null;
  update orders o
     set kitchen_sent_at = s.first_sent,
         kitchen_done_at = case when s.pending = 0 then s.last_done else null end
    from (
      select order_id,
             min(sent_to_kitchen_at) as first_sent,
             count(*) filter (where kitchen_status = 'pendiente') as pending,
             max(kitchen_done_at) as last_done
        from order_items group by order_id
    ) s
   where s.order_id = o.id and o.kitchen_sent_at is null;
  perform set_config('comanet.internal', '', true);
end $$;

-- ==========================================================================
-- 2) Avisos para cocina (envíos y cambios) — solo las funciones escriben aquí
-- ==========================================================================
create table if not exists kitchen_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  order_id uuid not null,
  kind text not null check (kind in ('envio', 'agregado', 'modificado')),
  description text not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  acked_at timestamptz,
  foreign key (order_id, organization_id)
    references orders (id, organization_id) on delete cascade
);
create index if not exists kitchen_changes_order_idx on kitchen_changes (order_id);
create index if not exists kitchen_changes_org_idx on kitchen_changes (organization_id, created_at desc);

alter table kitchen_changes enable row level security;
drop policy if exists kitchen_changes_select on kitchen_changes;
create policy kitchen_changes_select on kitchen_changes for select
  using (organization_id = current_profile_org() or is_super_admin());

alter table kitchen_changes replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kitchen_changes'
  ) then
    alter publication supabase_realtime add table public.kitchen_changes;
  end if;
end $$;

-- ==========================================================================
-- 3) order_items: protecciones (ahora también se editan pedidos 'pendiente')
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

  if not v_is_service then
    select status into v_status from orders where id = new.order_id;
    if v_status is null or v_status not in ('abierta', 'pendiente') then
      -- Borrar un producto del menú desvincula (product_id = null) sus ventas
      -- pasadas: ese único cambio se permite; el nombre y el precio quedan.
      if tg_op = 'UPDATE' and new.product_id is null and old.product_id is not null
         and new.quantity = old.quantity and new.notes is not distinct from old.notes then
        return new;
      end if;
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

-- Recalcula cuándo terminó cocina un pedido (todo lo enviado ya despachado).
create or replace function refresh_order_kitchen(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent int;
  v_pending int;
  v_last timestamptz;
  v_done timestamptz;
begin
  select count(*) filter (where sent_to_kitchen_at is not null),
         count(*) filter (where sent_to_kitchen_at is not null and kitchen_status = 'pendiente'),
         max(kitchen_done_at) filter (where sent_to_kitchen_at is not null)
    into v_sent, v_pending, v_last
    from order_items where order_id = p_order_id;

  v_done := case when v_sent > 0 and v_pending = 0 then coalesce(v_last, now()) else null end;

  update orders set kitchen_done_at = v_done
   where id = p_order_id and kitchen_done_at is distinct from v_done;
end;
$$;

-- Después de cada cambio en los productos: avisa a cocina, recalcula el total
-- de los domicilios, anula un cobro ya pedido y actualiza el tiempo de cocina.
create or replace function order_items_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_internal boolean := coalesce(current_setting('comanet.internal', true), '') = '1';
  v_order_id uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_status text;
  v_channel text;
  v_desc text;
  v_subtotal numeric(12, 2);
begin
  select status, channel into v_status, v_channel from orders where id = v_order_id;
  if v_status is null or v_status not in ('pendiente', 'abierta') then
    return null;
  end if;

  if not v_internal then
    -- Aviso a cocina de lo que cambió en un producto que ya estaba enviado.
    if tg_op = 'DELETE' and old.sent_to_kitchen_at is not null then
      v_desc := 'Se quitó ' || old.quantity || '× ' || old.product_name;
    elsif tg_op = 'UPDATE' and old.sent_to_kitchen_at is not null then
      if new.quantity <> old.quantity then
        v_desc := old.product_name || ': cantidad ' || old.quantity || ' → ' || new.quantity;
      end if;
      if new.notes is distinct from old.notes then
        v_desc := concat_ws('. ', v_desc,
          old.product_name || ': nota "' || coalesce(new.notes, 'sin nota') || '"');
      end if;
    end if;
    if v_desc is not null then
      insert into kitchen_changes (organization_id, order_id, kind, description, created_by)
      values (v_org, v_order_id, 'modificado', v_desc, auth.uid());
    end if;

    -- Domicilio editado: el total sigue al subtotal (domicilio y desechables no cambian).
    if v_channel = 'domicilio' then
      select coalesce(sum(unit_price * quantity), 0) into v_subtotal
        from order_items where order_id = v_order_id;
      update orders
         set subtotal = v_subtotal, total = v_subtotal + delivery_fee + disposables_fee
       where id = v_order_id and subtotal is distinct from v_subtotal;
    end if;

    -- Mesa con cobro pedido que vuelve a cambiar: el cobro se anula.
    if v_channel = 'mesa' then
      update orders set payment_requested_at = null, payment_requested_method = null
       where id = v_order_id and payment_requested_at is not null;
    end if;
  end if;

  perform refresh_order_kitchen(v_order_id);
  return null;
end;
$$;

drop trigger if exists order_items_after_trg on order_items;
create trigger order_items_after_trg
  after insert or update or delete on order_items
  for each row execute function order_items_after();

-- Políticas: los domicilios pendientes los edita solo owner/cajero (módulo menú en línea);
-- las cuentas de mesa, owner/cajero/mesero (módulo mesas).
drop policy if exists order_items_insert on order_items;
create policy order_items_insert on order_items for insert
  with check (
    organization_id = current_profile_org()
    and (
      (
        current_role_in('owner', 'cajero', 'mesero')
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
        (o.channel = 'mesa' and current_role_in('owner', 'cajero', 'mesero'))
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
        (o.channel = 'mesa' and current_role_in('owner', 'cajero', 'mesero'))
        or (o.channel = 'domicilio' and current_role_in('owner', 'cajero'))
      )
    )
  );

-- ==========================================================================
-- 4) Enviar a cocina / avisos / marcar despachado
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

create or replace function ack_kitchen_changes(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
begin
  if not current_role_in('owner', 'cajero', 'cocina') then
    raise exception 'No autorizado';
  end if;
  update kitchen_changes set acked_at = now()
   where order_id = p_order_id and organization_id = v_org and acked_at is null;
end;
$$;

-- Cocina marca productos como despachados (kitchen_status = 'listo'); solo los ya enviados.
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
  if not current_role_in('owner', 'cajero', 'cocina') then
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
         kitchen_done_at = case when p_ready then coalesce(kitchen_done_at, now()) else null end
   where order_id = p_order_id and organization_id = v_org and sent_to_kitchen_at is not null;
  perform set_config('comanet.internal', '', true);
  perform refresh_order_kitchen(p_order_id);
end;
$$;

-- ==========================================================================
-- 5) Cobro de mesa en dos pasos
-- ==========================================================================
-- El mesero recibe el dinero y lo avisa: la mesa sigue ocupada ("por cobrar").
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
  if not current_role_in('owner', 'cajero', 'mesero') then
    raise exception 'No autorizado';
  end if;
  update orders set payment_requested_at = null, payment_requested_method = null
   where id = p_order_id and organization_id = current_profile_org()
     and channel = 'mesa' and status = 'abierta';
end;
$$;

-- Solo caja o administrador confirman el dinero y liberan la mesa.
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
  if not current_role_in('owner', 'cajero') then
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
         payment_requested_at = null, payment_requested_method = null,
         completed_at = now(), completed_by = auth.uid()
   where id = p_order_id;

  return v_total;
end;
$$;

-- ==========================================================================
-- 6) Editar los datos de un domicilio pendiente
-- ==========================================================================
create or replace function update_delivery_order_info(
  p_order_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_address text,
  p_notes text,
  p_payment text
)
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
  if p_payment not in ('efectivo', 'transferencia') then
    raise exception 'Selecciona un medio de pago válido';
  end if;
  if p_customer_name is null or length(trim(p_customer_name)) < 2 then
    raise exception 'El nombre del cliente es obligatorio';
  end if;

  select * into v_order from orders
    where id = p_order_id and organization_id = current_profile_org() for update;
  if not found or v_order.channel <> 'domicilio' then
    raise exception 'Pedido no encontrado';
  end if;
  if v_order.status <> 'pendiente' then
    raise exception 'Este pedido ya no está pendiente';
  end if;
  if v_order.fulfillment = 'domicilio' and length(trim(coalesce(p_address, ''))) < 3 then
    raise exception 'La dirección es obligatoria para domicilio';
  end if;

  update orders
     set customer_name = left(trim(p_customer_name), 120),
         customer_phone = left(trim(coalesce(p_customer_phone, '')), 30),
         address = case when v_order.fulfillment = 'domicilio' then left(trim(p_address), 250) else address end,
         notes = nullif(left(trim(coalesce(p_notes, '')), 300), ''),
         payment_method = p_payment
   where id = p_order_id;
end;
$$;

revoke all on function send_order_to_kitchen(uuid) from public, anon;
revoke all on function ack_kitchen_changes(uuid) from public, anon;
revoke all on function request_table_payment(uuid, text) from public, anon;
revoke all on function cancel_table_payment_request(uuid) from public, anon;
revoke all on function update_delivery_order_info(uuid, text, text, text, text, text) from public, anon;
grant execute on function send_order_to_kitchen(uuid) to authenticated;
grant execute on function ack_kitchen_changes(uuid) to authenticated;
grant execute on function request_table_payment(uuid, text) to authenticated;
grant execute on function cancel_table_payment_request(uuid) to authenticated;
grant execute on function update_delivery_order_info(uuid, text, text, text, text, text) to authenticated;
grant execute on function set_item_kitchen_status(uuid, boolean) to authenticated;
grant execute on function set_order_kitchen_status(uuid, boolean) to authenticated;
