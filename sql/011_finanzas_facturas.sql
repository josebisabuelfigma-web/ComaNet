-- Módulo "Ingresos, egresos y facturas": independiente de caja (se vende por
-- separado). Ejecutar después de 001-010. Idempotente.

insert into modules (key, name, description, price)
values (
  'finanzas', 'Ingresos, egresos y facturas',
  'Registra ingresos y egresos con su factura (imagen o PDF), consúltalos por fecha y descarga el soporte. Funciona solo, sin necesitar el módulo de caja.',
  0
)
on conflict (key) do update set name = excluded.name, description = excluded.description;

-- Los movimientos pueden existir sin un turno de caja abierto.
alter table cash_movements alter column session_id drop not null;
alter table cash_movements add column if not exists payment_method text not null default 'efectivo'
  check (payment_method in ('efectivo', 'transferencia'));
alter table cash_movements add column if not exists invoice_path text;
alter table cash_movements add column if not exists invoice_name text;
create index if not exists cash_movements_org_created_idx on cash_movements (organization_id, created_at desc);

-- Registrar un movimiento. Funciona con el módulo de finanzas, o con el de caja
-- (y turno abierto). Si hay turno abierto, caja activa y se pagó en efectivo,
-- el movimiento entra al arqueo; las transferencias no tocan el efectivo.
create or replace function register_cash_movement(
  p_type text,
  p_amount numeric,
  p_description text,
  p_payment text,
  p_invoice_path text,
  p_invoice_name text
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
    invoice_path, invoice_name, created_by
  ) values (
    v_org,
    case when v_caja and p_payment = 'efectivo' then v_session else null end,
    p_type, p_amount, left(trim(p_description), 200), p_payment,
    p_invoice_path, left(p_invoice_name, 200), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function register_cash_movement(text, numeric, text, text, text, text) from public, anon;
grant execute on function register_cash_movement(text, numeric, text, text, text, text) to authenticated;

-- Bucket privado para las facturas: <organization_id>/<archivo>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'facturas', 'facturas', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists facturas_bucket_select on storage.objects;
create policy facturas_bucket_select on storage.objects for select
  using (
    bucket_id = 'facturas'
    and (storage.foldername(name))[1] = current_profile_org()::text
    and current_profile_role() in ('owner', 'cajero')
  );

drop policy if exists facturas_bucket_insert on storage.objects;
create policy facturas_bucket_insert on storage.objects for insert
  with check (
    bucket_id = 'facturas'
    and (storage.foldername(name))[1] = current_profile_org()::text
    and current_profile_role() in ('owner', 'cajero')
    and org_module_enabled(current_profile_org(), 'finanzas')
  );
