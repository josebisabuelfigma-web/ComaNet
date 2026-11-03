-- Disponibilidad de combos. Ejecutar después de 001-006. Idempotente.
--
-- Regla:
--  * Si un producto se marca agotado, los combos que lo incluyen se marcan
--    agotados automáticamente (combo_auto_off = true).
--  * Cuando ese producto vuelve a estar disponible, esos combos vuelven solos
--    (solo los que se apagaron automáticamente y si no les queda otro producto
--    agotado).
--  * El administrador puede volver a activar un combo a mano aunque un
--    producto esté agotado: el combo queda vendible y el producto individual
--    NO cambia.

alter table menu_products add column if not exists combo_auto_off boolean not null default false;

-- Un combo se puede pedir si está activo, disponible (automático o manual),
-- tiene productos y ninguno de ellos fue ocultado o eliminado de la carta.
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
          where ci.combo_id = p.id and not c.is_active
        )
      )
    )
    from menu_products p where p.id = p_id
  ), false)
$$;

-- Si el administrador cambia a mano la disponibilidad de un combo, deja de
-- considerarse "apagado automáticamente".
create or replace function menu_products_manual_combo_flag()
returns trigger
language plpgsql
as $$
begin
  if new.is_combo
     and new.is_available is distinct from old.is_available
     and coalesce(current_setting('comanet.internal', true), '') <> '1' then
    new.combo_auto_off := false;
  end if;
  return new;
end;
$$;

drop trigger if exists menu_products_manual_flag on menu_products;
create trigger menu_products_manual_flag
  before update of is_available on menu_products
  for each row execute function menu_products_manual_combo_flag();

-- Un producto cambia de disponibilidad: ajusta los combos que lo incluyen.
create or replace function menu_products_sync_combos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_combo or new.is_available is not distinct from old.is_available then
    return new;
  end if;

  perform set_config('comanet.internal', '1', true);

  if not new.is_available then
    update menu_products c
       set is_available = false, combo_auto_off = true
      from menu_combo_items ci
     where ci.product_id = new.id and ci.combo_id = c.id and c.is_available;
  else
    update menu_products c
       set is_available = true, combo_auto_off = false
      from menu_combo_items ci
     where ci.product_id = new.id and ci.combo_id = c.id and c.combo_auto_off
       and not exists (
         select 1
         from menu_combo_items ci2
         join menu_products p2 on p2.id = ci2.product_id
         where ci2.combo_id = c.id and not p2.is_available
       );
  end if;

  perform set_config('comanet.internal', '', true);
  return new;
end;
$$;

drop trigger if exists menu_products_sync_combos_trg on menu_products;
create trigger menu_products_sync_combos_trg
  after update of is_available on menu_products
  for each row execute function menu_products_sync_combos();

-- Al agregar a un combo un producto que ya está agotado, el combo nace apagado.
create or replace function menu_combo_items_sync_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from menu_products where id = new.product_id and not is_available) then
    perform set_config('comanet.internal', '1', true);
    update menu_products
       set is_available = false, combo_auto_off = true
     where id = new.combo_id and is_available;
    perform set_config('comanet.internal', '', true);
  end if;
  return new;
end;
$$;

drop trigger if exists menu_combo_items_sync_trg on menu_combo_items;
create trigger menu_combo_items_sync_trg
  after insert on menu_combo_items
  for each row execute function menu_combo_items_sync_availability();
