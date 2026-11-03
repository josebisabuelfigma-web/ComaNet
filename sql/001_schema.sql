-- ComaNet — esquema multi-organización para venta de comidas rápidas.
-- Ejecutar en el SQL Editor de Supabase en orden: 001, 002, 003, 004, 005.
-- Idempotente: se puede volver a correr sin romper nada.

create extension if not exists pgcrypto;

-- ==========================================================================
-- organizations: cada negocio de comidas rápidas que compra el software
-- ==========================================================================
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  max_usuarios int not null default 3,
  is_active boolean not null default true,
  legal_name text,
  tax_id text,
  billing_address text,
  billing_phone text,
  billing_email text,
  ticket_footer text,
  currency text not null default 'COP',
  logo_url text,
  next_order_number int not null default 1,
  created_at timestamptz not null default now()
);

-- ==========================================================================
-- profiles: extiende auth.users con rol, organización y username propio.
-- El login es por username; auth_email es un correo sintético interno.
-- Roles: super_admin (proveedor), owner (dueño/admin del negocio),
-- cajero (pedidos, mesas, caja) y mesero (solo mesas).
-- ==========================================================================
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references organizations (id) on delete cascade,
  username text not null unique,
  full_name text not null,
  auth_email text not null unique,
  role text not null check (role in ('super_admin', 'owner', 'cajero', 'mesero')),
  created_at timestamptz not null default now()
);

create index if not exists profiles_organization_id_idx on profiles (organization_id);

-- ==========================================================================
-- modules / organization_modules: módulos que el super admin activa por negocio
-- ==========================================================================
create table if not exists modules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  price numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists organization_modules (
  organization_id uuid not null references organizations (id) on delete cascade,
  module_id uuid not null references modules (id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  primary key (organization_id, module_id)
);

-- ==========================================================================
-- restaurant_settings: configuración del negocio (una fila por organización)
-- ==========================================================================
create table if not exists restaurant_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  whatsapp_number text,
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  delivery_message text,
  disposables_fee numeric(12, 2) not null default 0 check (disposables_fee >= 0),
  disposables_label text not null default 'Desechables',
  accepts_cash boolean not null default true,
  accepts_transfer boolean not null default true,
  transfer_instructions text,
  orders_open boolean not null default true,
  welcome_message text,
  updated_at timestamptz not null default now()
);

-- ==========================================================================
-- carta: categorías y productos
-- ==========================================================================
create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);

create index if not exists menu_categories_org_idx on menu_categories (organization_id);

create table if not exists menu_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  category_id uuid not null,
  name text not null,
  description text,                       -- ingredientes y detalles
  price numeric(12, 2) not null default 0 check (price >= 0),
  image_url text,
  is_available boolean not null default true,  -- false = "agotado hoy"
  is_active boolean not null default true,     -- false = oculto de la carta
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, organization_id)
    references menu_categories (id, organization_id) on delete cascade
);

create index if not exists menu_products_org_idx on menu_products (organization_id);
create index if not exists menu_products_category_idx on menu_products (category_id);

-- ==========================================================================
-- mesas del local
-- ==========================================================================
create table if not exists restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

-- ==========================================================================
-- orders: pedidos de domicilio (canal 'domicilio') y cuentas de mesa
-- (canal 'mesa'). Estados:
--   domicilio: pendiente -> despachado | cancelado
--   mesa:      abierta   -> pagada     | cancelado
-- Una venta "cuenta" cuando está despachada o pagada (completed_at).
-- ==========================================================================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  order_number int not null,
  channel text not null check (channel in ('domicilio', 'mesa')),
  status text not null check (status in ('pendiente', 'despachado', 'abierta', 'pagada', 'cancelado')),
  table_id uuid,
  customer_name text,
  customer_phone text,
  address text,
  notes text,
  payment_method text check (payment_method in ('efectivo', 'transferencia')),
  subtotal numeric(12, 2) not null default 0,
  delivery_fee numeric(12, 2) not null default 0,
  disposables_fee numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references profiles (id) on delete set null,
  unique (id, organization_id),
  unique (organization_id, order_number),
  foreign key (table_id, organization_id)
    references restaurant_tables (id, organization_id) on delete set null (table_id)
);

create index if not exists orders_org_status_idx on orders (organization_id, status);
create index if not exists orders_org_completed_idx on orders (organization_id, completed_at);
-- Una sola cuenta abierta por mesa.
create unique index if not exists orders_one_open_per_table
  on orders (table_id) where status = 'abierta';

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  order_id uuid not null,
  product_id uuid references menu_products (id) on delete set null,
  product_name text not null,
  unit_price numeric(12, 2) not null default 0,
  quantity int not null check (quantity > 0),
  notes text,                              -- ej: "sin cebolla"
  created_at timestamptz not null default now(),
  foreign key (order_id, organization_id)
    references orders (id, organization_id) on delete cascade
);

create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_org_idx on order_items (organization_id);

-- ==========================================================================
-- caja: turnos (arqueo / cierre de caja) y movimientos manuales
-- ==========================================================================
create table if not exists cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  opening_amount numeric(12, 2) not null default 0 check (opening_amount >= 0),
  opened_by uuid references profiles (id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references profiles (id) on delete set null,
  counted_cash numeric(12, 2),
  expected_cash numeric(12, 2),
  difference numeric(12, 2),
  summary jsonb,
  notes text,
  unique (id, organization_id)
);

-- Un solo turno abierto por organización.
create unique index if not exists cash_sessions_one_open
  on cash_sessions (organization_id) where closed_at is null;

create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  session_id uuid not null,
  type text not null check (type in ('ingreso', 'egreso')),
  amount numeric(12, 2) not null check (amount > 0),
  description text not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (session_id, organization_id)
    references cash_sessions (id, organization_id) on delete cascade
);

create index if not exists cash_movements_session_idx on cash_movements (session_id);

-- ==========================================================================
-- activity_log
-- ==========================================================================
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete cascade,
  user_id uuid references profiles (id) on delete set null,
  username text not null,
  role text not null,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_organization_id_idx on activity_log (organization_id);

-- ==========================================================================
-- triggers utilitarios
-- ==========================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists menu_products_set_updated_at on menu_products;
create trigger menu_products_set_updated_at
  before update on menu_products
  for each row execute function set_updated_at();

drop trigger if exists restaurant_settings_set_updated_at on restaurant_settings;
create trigger restaurant_settings_set_updated_at
  before update on restaurant_settings
  for each row execute function set_updated_at();

-- Cada organización nueva nace con su fila de configuración.
create or replace function create_default_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into restaurant_settings (organization_id) values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_create_settings on organizations;
create trigger organizations_create_settings
  after insert on organizations
  for each row execute function create_default_settings();

-- El username es la credencial pública de login y no se puede cambiar.
create or replace function prevent_username_change()
returns trigger as $$
begin
  if new.username <> old.username then
    raise exception 'El nombre de usuario no se puede modificar';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_prevent_username_change on profiles;
create trigger profiles_prevent_username_change
  before update on profiles
  for each row execute function prevent_username_change();

-- Solo la service role puede cambiar rol u organización de un perfil.
create or replace function prevent_privileged_field_change()
returns trigger as $$
begin
  if new.role <> old.role and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autorizado para cambiar el rol de un usuario';
  end if;
  if new.organization_id is distinct from old.organization_id
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autorizado para cambiar la organización de un usuario';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_prevent_privileged_field_change on profiles;
create trigger profiles_prevent_privileged_field_change
  before update on profiles
  for each row execute function prevent_privileged_field_change();

-- Numeración consecutiva de pedidos por organización.
create or replace function assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_number is null or new.order_number <= 0 then
    -- Marca interna: permite a protect_organization_fields aceptar este cambio.
    perform set_config('comanet.internal', '1', true);
    update organizations
      set next_order_number = next_order_number + 1
      where id = new.organization_id
      returning next_order_number - 1 into new.order_number;
    perform set_config('comanet.internal', '', true);
  end if;
  return new;
end;
$$;
