-- Editar todos los datos de un domicilio pendiente: nombre, teléfono, dirección
-- (puede quedar vacía y completarse después), tipo de entrega, valor del
-- domicilio, desechables, observaciones y medio de pago. Ejecutar después de
-- 001-012. Idempotente.

drop function if exists update_delivery_order_info(uuid, text, text, text, text, text);

create or replace function update_delivery_order_info(
  p_order_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_address text,
  p_notes text,
  p_payment text,
  p_fulfillment text default null,
  p_delivery_fee numeric default null,
  p_disposables_fee numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_fulfillment text;
  v_delivery numeric(12, 2);
  v_disposables numeric(12, 2);
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

  v_fulfillment := coalesce(p_fulfillment, v_order.fulfillment);
  if v_fulfillment not in ('domicilio', 'recoger') then
    raise exception 'Tipo de entrega inválido';
  end if;

  v_delivery := case
    when v_fulfillment = 'recoger' then 0
    else coalesce(p_delivery_fee, v_order.delivery_fee)
  end;
  v_disposables := coalesce(p_disposables_fee, v_order.disposables_fee);
  if v_delivery < 0 or v_delivery > 10000000 or v_disposables < 0 or v_disposables > 10000000 then
    raise exception 'Los valores de domicilio y desechables no son válidos';
  end if;

  -- La dirección puede quedar vacía: se pide al cliente y se completa después.
  update orders
     set customer_name = left(trim(p_customer_name), 120),
         customer_phone = left(trim(coalesce(p_customer_phone, '')), 30),
         address = nullif(left(trim(coalesce(p_address, '')), 250), ''),
         notes = nullif(left(trim(coalesce(p_notes, '')), 300), ''),
         payment_method = p_payment,
         fulfillment = v_fulfillment,
         delivery_fee = v_delivery,
         disposables_fee = v_disposables,
         total = subtotal + v_delivery + v_disposables
   where id = p_order_id;
end;
$$;

revoke all on function update_delivery_order_info(uuid, text, text, text, text, text, text, numeric, numeric) from public, anon;
grant execute on function update_delivery_order_info(uuid, text, text, text, text, text, text, numeric, numeric) to authenticated;
