-- Límite de intentos (anti fuerza bruta en el login y antispam en pedidos públicos).
-- Contadores por ventana fija de tiempo. Solo el servidor (service_role) los usa.
-- Ejecutar después de 001-016. Idempotente.

create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

alter table rate_limits enable row level security;
-- Sin políticas: ni anon ni authenticated pueden leer ni escribir directamente.
revoke all on table rate_limits from public, anon, authenticated;

-- Suma un intento a la clave y devuelve cuántos lleva en la ventana actual.
create or replace function rate_limit_hit(p_key text, p_window_seconds int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits int;
begin
  if p_window_seconds < 1 then
    raise exception 'Ventana inválida';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limits (key, window_start, hits)
  values (left(p_key, 200), v_start, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;

  -- Limpieza ocasional de ventanas viejas (1 de cada ~50 llamadas).
  if random() < 0.02 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits;
end;
$$;

-- Cuántos intentos lleva la clave en la ventana actual, sin sumar uno.
create or replace function rate_limit_count(p_key text, p_window_seconds int)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select hits from rate_limits
      where key = left(p_key, 200)
        and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)),
    0
  );
$$;

revoke all on function rate_limit_hit(text, int) from public, anon, authenticated;
revoke all on function rate_limit_count(text, int) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, int) to service_role;
grant execute on function rate_limit_count(text, int) to service_role;
