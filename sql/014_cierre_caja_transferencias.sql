-- Cierre de caja que cuadra efectivo Y transferencias por separado.
--   Efectivo esperado        = base + ventas efectivo + ingresos efectivo − egresos efectivo
--   Transferencias esperadas = ventas transferencia + ingresos transf. − egresos transf. (del turno)
-- Ejecutar después de 001-013. Idempotente.

alter table cash_sessions add column if not exists expected_transfer numeric(12, 2);
alter table cash_sessions add column if not exists counted_transfer numeric(12, 2);
alter table cash_sessions add column if not exists difference_transfer numeric(12, 2);

-- Los movimientos del turno (efectivo O transferencia) quedan ligados al turno
-- abierto; el cierre los separa por medio de pago.
create or replace function register_cash_movement(
  p_type text,
  p_amount numeric,
  p_description text,
  p_payment text,
  p_invoice_path text,
  p_invoice_name text,
  p_counterparty text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := current_profile_org();
  v_fin boolean;
  v_caja boolean;
  v_session uuid;
  v_id uuid;
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;
  if p_type not in ('ingreso', 'egreso') then
    raise exception 'Tipo inválido';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Escribe un valor mayor a 0';
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'Escribe una descripción';
  end if;
  if p_payment not in ('efectivo', 'transferencia') then
    raise exception 'Selecciona un medio de pago válido';
  end if;

  v_fin := org_module_enabled(v_org, 'finanzas');
  v_caja := org_module_enabled(v_org, 'caja');
  if not v_fin and not v_caja then
    raise exception 'El módulo de ingresos y egresos no está activo';
  end if;

  select id into v_session from cash_sessions where organization_id = v_org and closed_at is null;
  if v_session is null and not v_fin then
    raise exception 'Abre la caja para registrar movimientos';
  end if;

  if p_invoice_path is not null then
    if not v_fin then
      raise exception 'Adjuntar facturas requiere el módulo de ingresos, egresos y facturas';
    end if;
    if p_invoice_path not like v_org::text || '/%' then
      raise exception 'Archivo de factura inválido';
    end if;
  end if;

  insert into cash_movements (
    organization_id, session_id, type, amount, description, payment_method,
    invoice_path, invoice_name, counterparty, created_by
  ) values (
    v_org,
    case when v_caja then v_session else null end,
    p_type, p_amount, left(trim(p_description), 200), p_payment,
    p_invoice_path, left(p_invoice_name, 200),
    nullif(left(trim(coalesce(p_counterparty, '')), 120), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Transferencias hechas desde Caja con el turno ya abierto (antes quedaban sueltas).
update cash_movements m
   set session_id = s.id
  from cash_sessions s
 where m.session_id is null
   and m.payment_method = 'transferencia'
   and s.organization_id = m.organization_id
   and s.closed_at is null
   and m.created_at >= s.opened_at
   and org_module_enabled(m.organization_id, 'caja');

-- Cierre: dos cuentas separadas (efectivo y transferencias).
drop function if exists close_cash_session(uuid, numeric, text);

create or replace function close_cash_session(
  p_session_id uuid,
  p_counted numeric,
  p_notes text,
  p_counted_transfer numeric default null
)
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
  v_ing_t numeric(12, 2);
  v_egr_t numeric(12, 2);
  v_expected numeric(12, 2);
  v_expected_t numeric(12, 2);
  v_counted_t numeric(12, 2);
  v_summary jsonb;
begin
  if not current_role_in('owner', 'cajero') then
    raise exception 'No autorizado';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'El efectivo contado no es válido';
  end if;
  if p_counted_transfer is not null and p_counted_transfer < 0 then
    raise exception 'El valor de transferencias no es válido';
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
    coalesce(sum(amount) filter (where type = 'ingreso' and payment_method = 'efectivo'), 0),
    coalesce(sum(amount) filter (where type = 'egreso' and payment_method = 'efectivo'), 0),
    coalesce(sum(amount) filter (where type = 'ingreso' and payment_method = 'transferencia'), 0),
    coalesce(sum(amount) filter (where type = 'egreso' and payment_method = 'transferencia'), 0)
  into v_ing, v_egr, v_ing_t, v_egr_t
  from cash_movements where session_id = p_session_id;

  v_expected := v_session.opening_amount + v_cash + v_ing - v_egr;
  v_expected_t := v_transfer + v_ing_t - v_egr_t;

  -- Si hubo movimiento por transferencia, hay que verificarlo en la cuenta.
  if p_counted_transfer is null and v_expected_t <> 0 then
    raise exception 'Escribe cuánto muestran las transferencias en la cuenta (esperado %)', v_expected_t;
  end if;
  v_counted_t := coalesce(p_counted_transfer, 0);

  v_summary := jsonb_build_object(
    'orders', v_orders,
    'cash_sales', v_cash,
    'transfer_sales', v_transfer,
    'ingresos', v_ing,
    'egresos', v_egr,
    'transfer_ingresos', v_ing_t,
    'transfer_egresos', v_egr_t
  );

  update cash_sessions
     set closed_at = v_now, closed_by = auth.uid(),
         counted_cash = p_counted, expected_cash = v_expected,
         difference = p_counted - v_expected,
         counted_transfer = v_counted_t, expected_transfer = v_expected_t,
         difference_transfer = v_counted_t - v_expected_t,
         summary = v_summary,
         notes = nullif(left(trim(coalesce(p_notes, '')), 500), '')
   where id = p_session_id;

  return v_summary || jsonb_build_object(
    'expected_cash', v_expected,
    'counted_cash', p_counted,
    'difference', p_counted - v_expected,
    'expected_transfer', v_expected_t,
    'counted_transfer', v_counted_t,
    'difference_transfer', v_counted_t - v_expected_t
  );
end;
$$;

revoke all on function close_cash_session(uuid, numeric, text, numeric) from public, anon;
grant execute on function close_cash_session(uuid, numeric, text, numeric) to authenticated;
revoke all on function register_cash_movement(text, numeric, text, text, text, text, text) from public, anon;
grant execute on function register_cash_movement(text, numeric, text, text, text, text, text) to authenticated;
