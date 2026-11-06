-- Endurecimiento de permisos (no cambia ninguna funcionalidad).
--   1) Las funciones de acción solo las llama un usuario con sesión (authenticated)
--      o el servidor (service_role). Se les quita el acceso a anon / PUBLIC.
--      Ya se rechazaban por dentro ("No autorizado"); esto es una segunda barrera.
--   2) El registro de actividad solo acepta filas a nombre del usuario que escribe
--      (nadie puede inventar una acción a nombre de otro).
-- Ejecutar después de 001-017. Idempotente.

-- ==========================================================================
-- 1) Funciones de acción: sin acceso para anon / PUBLIC
-- ==========================================================================
revoke all on function dispatch_order(uuid) from public, anon;
revoke all on function cancel_order(uuid) from public, anon;
revoke all on function set_product_availability(uuid, boolean) from public, anon;
revoke all on function open_cash_session(numeric) from public, anon;
revoke all on function report_sales_summary(timestamptz, timestamptz) from public, anon;
revoke all on function report_sales_by_product(timestamptz, timestamptz) from public, anon;

grant execute on function dispatch_order(uuid) to authenticated, service_role;
grant execute on function cancel_order(uuid) to authenticated, service_role;
grant execute on function set_product_availability(uuid, boolean) to authenticated, service_role;
grant execute on function open_cash_session(numeric) to authenticated, service_role;
grant execute on function report_sales_summary(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function report_sales_by_product(timestamptz, timestamptz) to authenticated, service_role;

-- ==========================================================================
-- 2) Registro de actividad: solo a nombre de quien lo escribe
-- ==========================================================================
drop policy if exists activity_log_insert on activity_log;
create policy activity_log_insert on activity_log for insert
  with check (
    user_id = auth.uid()
    and (organization_id = current_profile_org() or is_super_admin())
  );
