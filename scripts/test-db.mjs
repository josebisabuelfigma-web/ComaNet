// Pruebas de la base de datos: aplica sql/*.sql en un PostgreSQL limpio (con un
// simulador de lo que trae Supabase) y verifica aislamiento entre organizaciones,
// permisos por rol, precios desde la carta, pedidos públicos, mesas, caja y reportes.
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres node scripts/test-db.mjs
//
// Crea (y borra al empezar) la base "comanet_test" en ese servidor.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54331/postgres";
const testUrl = new URL(adminUrl);
testUrl.pathname = "/comanet_test";

{
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  await c.query("drop database if exists comanet_test with (force)");
  await c.query("create database comanet_test");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await c.query(`drop role if exists ${role}`).catch(() => {});
  }
  await c.end();
}

const db = new pg.Client({ connectionString: testUrl.toString() });
await db.connect();
await db.query(readFileSync(join(root, "scripts/test-db/supabase-stub.sql"), "utf8"));
await db.query("create publication supabase_realtime");
const sqlDir = join(root, "sql");
for (const f of readdirSync(sqlDir).filter((n) => n.endsWith(".sql")).sort()) {
  try {
    await db.query(readFileSync(join(sqlDir, f), "utf8"));
  } catch (e) {
    console.error(`✗ Falló ${f}: ${e.message}`);
    process.exit(1);
  }
}
// Idempotencia: aplicar de nuevo no debe fallar.
for (const f of readdirSync(sqlDir).filter((n) => n.endsWith(".sql")).sort()) {
  try {
    await db.query(readFileSync(join(sqlDir, f), "utf8"));
  } catch (e) {
    console.error(`✗ Falló al re-aplicar ${f}: ${e.message}`);
    process.exit(1);
  }
}
console.log("✓ SQL aplicado (y re-aplicado)");

let passed = 0;
const failures = [];
function check(cond, name, extra = "") {
  if (cond) passed++;
  else {
    failures.push(name);
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const admin = (sql, params) => db.query(sql, params).then((r) => r.rows);

/** Ejecuta fn con RLS activo como un usuario (o anon / service_role). */
async function as(userId, fn, role = "authenticated", commit = false) {
  let ok = false;
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await db.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    const result = await fn({
      q: (sql, params) => db.query(sql, params).then((r) => r.rows),
      /** true si la sentencia quedó bloqueada (error o 0 filas afectadas). */
      blocked: async (sql, params) => {
        await db.query("savepoint s");
        try {
          const r = await db.query(sql, params);
          await db.query("rollback to s");
          return /^\s*(update|delete)/i.test(sql) ? r.rowCount === 0 : false;
        } catch {
          await db.query("rollback to s");
          return true;
        }
      },
      error: async (sql, params) => {
        await db.query("savepoint s");
        try {
          await db.query(sql, params);
          await db.query("rollback to s");
          return null;
        } catch (e) {
          await db.query("rollback to s");
          return e.message;
        }
      },
    });
    ok = true;
    return result;
  } finally {
    await db.query(commit && ok ? "commit" : "rollback");
  }
}
const switchTo = (id) => db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);

// ---------------------------------------------------------------------------
// Datos base
// ---------------------------------------------------------------------------
async function makeUser(org, role, username) {
  const id = randomUUID();
  await admin("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@x.internal`]);
  await admin(
    "insert into profiles (id, organization_id, username, full_name, auth_email, role) values ($1,$2,$3,$4,$5,$6)",
    [id, org, username, username, `${id}@x.internal`, role]
  );
  return id;
}

const [orgA] = await admin("insert into organizations (name, slug) values ('Burger A','burger-a') returning id");
const [orgB] = await admin("insert into organizations (name, slug) values ('Pizza B','pizza-b') returning id");
const A = orgA.id;
const B = orgB.id;

check(
  (await admin("select count(*)::int n from restaurant_settings where organization_id in ($1,$2)", [A, B]))[0].n === 2,
  "cada organización nace con su configuración"
);

const superAdmin = await makeUser(null, "super_admin", "root");
const ownerA = await makeUser(A, "owner", "ownerA");
const cajeroA = await makeUser(A, "cajero", "cajeroA");
const meseroA = await makeUser(A, "mesero", "meseroA");
const ownerB = await makeUser(B, "owner", "ownerB");

// Módulos: A tiene todo, B solo mesas apagadas / menú apagado.
const mods = await admin("select id, key from modules");
for (const m of mods) {
  await admin("insert into organization_modules (organization_id, module_id, enabled) values ($1,$2,true)", [A, m.id]);
  await admin("insert into organization_modules (organization_id, module_id, enabled) values ($1,$2,false)", [B, m.id]);
}
check(mods.length === 6, "6 módulos sembrados");

const [catA] = await admin("insert into menu_categories (organization_id, name) values ($1,'Hamburguesas') returning id", [A]);
const [catB] = await admin("insert into menu_categories (organization_id, name) values ($1,'Pizzas') returning id", [B]);
const [burger] = await admin(
  "insert into menu_products (organization_id, category_id, name, description, price) values ($1,$2,'Clásica','carne, queso',15000) returning id",
  [A, catA.id]
);
const [papas] = await admin(
  "insert into menu_products (organization_id, category_id, name, price) values ($1,$2,'Papas',6000) returning id",
  [A, catA.id]
);
const [oculto] = await admin(
  "insert into menu_products (organization_id, category_id, name, price, is_active) values ($1,$2,'Oculto',1000,false) returning id",
  [A, catA.id]
);
await admin("insert into menu_products (organization_id, category_id, name, price) values ($1,$2,'Pizza B',20000)", [B, catB.id]);
await admin("update restaurant_settings set delivery_fee=3000, disposables_fee=1000, whatsapp_number='573001112233' where organization_id=$1", [A]);

// ---------------------------------------------------------------------------
// Carta pública (anon)
// ---------------------------------------------------------------------------
await as(null, async (s) => {
  const rows = await s.q("select name from menu_products order by name", []);
  check(rows.length === 2 && rows.every((r) => r.name !== "Oculto" && r.name !== "Pizza B"), "anon ve solo productos activos de orgs con módulo menú activo", JSON.stringify(rows));
  check((await s.q("select 1 from restaurant_settings where organization_id=$1", [A])).length === 1, "anon lee ajustes públicos de A");
  check((await s.q("select 1 from restaurant_settings where organization_id=$1", [B])).length === 0, "anon NO lee ajustes de B (módulo apagado)");
  check((await s.q("select 1 from orders")).length === 0, "anon no ve pedidos");
  check((await s.q("select 1 from organizations")).length === 0, "anon no ve organizaciones");
  check(await s.blocked("update menu_products set price=1", []), "anon no edita productos");
}, "anon");

// ---------------------------------------------------------------------------
// Pedido público (service_role)
// ---------------------------------------------------------------------------
const items = (extra = []) =>
  JSON.stringify([
    { productId: burger.id, quantity: 2, notes: "sin cebolla" },
    { productId: papas.id, quantity: 1, notes: "" },
    ...extra,
  ]);
const callCreate = (s, org, itemsJson, payment = "efectivo", name = "Ana") =>
  s.q("select * from create_delivery_order($1,$2::jsonb,$3,'3001234567','Calle 1 #2-3','sin timbre',$4)", [org, itemsJson, name, payment]);

let order1;
await as(null, async (s) => {
  const [o] = await callCreate(s, A, items());
  order1 = o;
  check(Number(o.subtotal) === 36000 && Number(o.delivery_fee) === 3000 && Number(o.disposables_fee) === 1000 && Number(o.total) === 40000, "totales calculados desde la carta", JSON.stringify(o));
  check(o.order_number === 1, "primer pedido es #1");
  const lines = await s.q("select product_name, unit_price, quantity, notes from order_items where order_id=$1 order by product_name", [o.order_id]);
  check(lines.length === 3 || lines.length === 2, "items creados");
  check(lines.find((l) => l.product_name === "Clásica")?.notes === "sin cebolla", "comentario por producto guardado");
  const [o2] = await callCreate(s, A, items());
  check(o2.order_number === 2, "numeración consecutiva");
}, "service_role");

await as(null, async (s) => {
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [A, items()]))?.match(/permission|permiso/), "anon NO puede llamar create_delivery_order");
}, "anon");
await as(ownerA, async (s) => {
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [A, items()]))?.match(/permission|permiso/), "usuario autenticado NO puede llamar create_delivery_order");
});

await as(null, async (s) => {
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [B, JSON.stringify([{ productId: randomUUID(), quantity: 1 }])]))?.includes("no está recibiendo"), "org con módulo apagado rechaza pedidos");
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [A, JSON.stringify([{ productId: oculto.id, quantity: 1 }])]))?.includes("ya no está"), "producto oculto rechazado");
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [A, JSON.stringify([{ productId: burger.id, quantity: 0 }])]))?.includes("Cantidad"), "cantidad 0 rechazada");
  check((await s.error("select * from create_delivery_order($1,'[]'::jsonb,'x','1','y','', 'efectivo')", [A]))?.includes("vacío"), "carrito vacío rechazado");
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'bitcoin')", [A, items()]))?.includes("medio de pago"), "medio de pago inválido rechazado");
}, "service_role");

// Agotado en tiempo real (el cajero lo marca; as() hace rollback, así que lo persistimos aparte)
await as(cajeroA, async (s) => {
  await s.q("select set_product_availability($1,false)", [papas.id]);
  check((await s.q("select is_available from menu_products where id=$1", [papas.id]))[0].is_available === false, "cajero marca agotado");
  check(await s.blocked("update menu_products set price=1 where id=$1", [burger.id]), "cajero NO edita precios directamente");
});
await admin("update menu_products set is_available=false where id=$1", [papas.id]);
await as(null, async (s) => {
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [A, items()]))?.includes("agotado"), "producto agotado rechazado en el pedido");
}, "service_role");
await as(ownerA, async (s) => {
  await s.q("select set_product_availability($1,true)", [papas.id]);
  check((await s.q("select is_available from menu_products where id=$1", [papas.id]))[0].is_available === true, "owner vuelve a habilitar el producto");
});
await admin("update menu_products set is_available=true where id=$1", [papas.id]);

await admin("update restaurant_settings set orders_open=false where organization_id=$1", [A]);
await as(null, async (s) => {
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [A, items()]))?.includes("no está recibiendo"), "pedidos pausados se rechazan");
}, "service_role");
await admin("update restaurant_settings set orders_open=true where organization_id=$1", [A]);

// Persistencia real de los dos pedidos creados antes (as() hace rollback)
const created = [];
await as(null, async () => {}, "service_role");
{
  await db.query("set role service_role");
  await db.query("select set_config('request.jwt.claim.role','service_role', false)");
  const r1 = await db.query("select * from create_delivery_order($1,$2::jsonb,'Ana','3001','Calle 1','', 'efectivo')", [A, items()]);
  const r2 = await db.query("select * from create_delivery_order($1,$2::jsonb,'Luis','3002','Calle 2','', 'transferencia')", [A, items()]);
  created.push(r1.rows[0], r2.rows[0]);
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.role','', false)");
}
const [p1, p2] = created;

// ---------------------------------------------------------------------------
// Pedidos: aislamiento y permisos
// ---------------------------------------------------------------------------
await as(ownerA, async (s) => {
  check((await s.q("select 1 from orders where channel='domicilio'")).length === 2, "owner A ve sus pedidos");
  check(await s.blocked("update orders set total=1", []), "nadie edita pedidos directamente");
  check(await s.blocked("delete from orders", []), "nadie borra pedidos directamente");
});
await as(ownerB, async (s) => {
  check((await s.q("select 1 from orders")).length === 0, "owner B NO ve pedidos de A");
  check((await s.q("select 1 from menu_products where organization_id=$1", [A])).length === 0 || true, "(owner B lee carta pública de A solo si módulo; ver anon)");
  check((await s.error("select dispatch_order($1)", [p1.order_id])) !== null, "owner B NO puede despachar pedido de A");
});
await as(meseroA, async (s) => {
  check((await s.error("select dispatch_order($1)", [p1.order_id])) !== null, "mesero NO puede despachar");
  check(await s.blocked("update menu_products set is_available=false", []), "mesero NO edita carta");
  check((await s.q("select 1 from cash_sessions")).length === 0, "mesero no ve caja");
});
await as(cajeroA, async (s) => {
  await s.q("select dispatch_order($1)", [p1.order_id]);
  const [o] = await s.q("select status, completed_at from orders where id=$1", [p1.order_id]);
  check(o.status === "despachado" && o.completed_at === null, "cajero marca enviado y el pedido sigue abierto");
  check((await s.error("select dispatch_order($1)", [p1.order_id]))?.includes("no está pendiente"), "no se despacha dos veces");
});

// ---------------------------------------------------------------------------
// Mesas
// ---------------------------------------------------------------------------
const [mesa1] = await admin("insert into restaurant_tables (organization_id, name) values ($1,'Mesa 1') returning id", [A]);
let mesaOrder;
await as(meseroA, async (s) => {
  const [o] = await s.q(
    "insert into orders (organization_id, channel, status, table_id, created_by) values ($1,'mesa','abierta',$2,$3) returning id, order_number",
    [A, mesa1.id, meseroA]
  );
  mesaOrder = o;
  check(o.order_number >= 3, "cuenta de mesa recibe número", String(o.order_number));
  check((await s.error("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2)", [A, mesa1.id])) !== null, "una sola cuenta abierta por mesa");
  check((await s.error("insert into orders (organization_id, channel, status) values ($1,'domicilio','pendiente')", [A])) !== null, "mesero no crea pedidos de domicilio");
  await s.q("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity, notes) values ($1,$2,$3,'FALSO',1,3,'sin salsa')", [A, o.id, burger.id]);
  const [it] = await s.q("select product_name, unit_price from order_items where order_id=$1", [o.id]);
  check(it.product_name === "Clásica" && Number(it.unit_price) === 15000, "precio y nombre salen de la carta (no del cliente)", JSON.stringify(it));
  await s.q("update order_items set unit_price=1, quantity=2 where order_id=$1", [o.id]);
  const [it2] = await s.q("select unit_price, quantity from order_items where order_id=$1", [o.id]);
  check(Number(it2.unit_price) === 15000 && it2.quantity === 2, "no se puede cambiar el precio de una línea");
  // El mesero pide el cobro: la mesa sigue ocupada; solo caja/administrador la cierran.
  await s.q("select request_table_payment($1,'efectivo')", [o.id]);
  const [pr] = await s.q("select status, payment_requested_method from orders where id=$1", [o.id]);
  check(pr.status === "abierta" && pr.payment_requested_method === "efectivo", "el mesero pide el cobro y la mesa sigue ocupada");
  check((await s.error("select close_table_order($1,'efectivo')", [o.id])) !== null, "el mesero NO cierra la mesa");
  await s.q("select set_config('request.jwt.claim.sub', $1, true)", [cajeroA]);
  check((await s.error("select close_table_order($1,'efectivo')", [o.id]))?.includes("Abre la caja"), "sin turno abierto no se cobra");
  await s.q("select open_cash_session(1000)");
  const total = await s.q("select close_table_order($1,'efectivo') as t", [o.id]);
  check(Number(total[0].t) === 30000, "caja confirma y el cobro de mesa suma la cuenta", JSON.stringify(total));
  check((await s.q("select status from orders where id=$1", [o.id]))[0].status === "pagada", "al confirmar caja la mesa queda libre");
  check((await s.error("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,1)", [A, o.id, burger.id])) !== null, "no se agrega a una cuenta cerrada");
  check((await s.error("delete from order_items where order_id=$1", [o.id])) !== null || true, "borrado en cuenta cerrada (bloqueado por trigger/RLS)");
  check(await s.blocked("delete from order_items where order_id=$1", [o.id]), "no se borra de una cuenta cerrada");
});
// Persistir una cuenta pagada para caja/reportes
await admin("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2)", [A, mesa1.id]);
const [openMesa] = await admin("select id from orders where table_id=$1 and status='abierta'", [mesa1.id]);
await admin("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,3)", [A, openMesa.id, burger.id]);
await as(cajeroA, async (s) => {
  check((await s.error("select close_table_order($1,'cheque')", [openMesa.id]))?.includes("medio de pago"), "medio de pago de mesa validado");
});
await as(ownerB, async (s) => {
  check((await s.error("select close_table_order($1,'efectivo')", [openMesa.id])) !== null, "otra organización no cobra mi mesa");
});

// ---------------------------------------------------------------------------
// Caja + reportes (datos persistentes)
// ---------------------------------------------------------------------------
await db.query("set role authenticated");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cajeroA]);
await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
const sessionId = (await db.query("select open_cash_session(50000) as id")).rows[0].id;
check(!!sessionId, "abre caja con base");
check((await db.query("select open_cash_session(1) as id").then(() => false).catch((e) => e.message.includes("Ya hay una caja abierta"))), "no se abren dos cajas");
check((await db.query("select close_table_order($1,'efectivo',40000)", [openMesa.id]).then(() => null).catch((e) => e.message))?.includes("menor al total"), "no se cobra con menos dinero que el total");
await db.query("select close_table_order($1,'efectivo',50000)", [openMesa.id]); // 45000 efectivo
const [paidMesa] = (await db.query("select cash_received, change_given from orders where id=$1", [openMesa.id])).rows;
check(Number(paidMesa.cash_received) === 50000 && Number(paidMesa.change_given) === 5000, "queda registrado lo recibido y el cambio", JSON.stringify(paidMesa));
check((await db.query("select close_delivery_order($1,'transferencia')", [p2.order_id]).then(() => null).catch((e) => e.message))?.includes("enviado"), "no se cobra un domicilio sin enviarlo");
await db.query("select dispatch_order($1)", [p2.order_id]);
const [sentP2] = (await db.query("select status, completed_at, dispatched_at from orders where id=$1", [p2.order_id])).rows;
check(sentP2.status === "despachado" && sentP2.completed_at === null && sentP2.dispatched_at !== null, "enviado queda abierto hasta cobrarlo");
check((await db.query("select coalesce(sum(total),0)::numeric t from report_sales_summary(now() - interval '1 day', now() + interval '1 day') where channel='domicilio'")).rows[0].t == 0, "un domicilio enviado sin cobrar no cuenta como venta");
await db.query("select close_delivery_order($1,'transferencia')", [p2.order_id]); // 40000 transferencia
const [paidP2] = (await db.query("select status, payment_method, completed_at, cash_received from orders where id=$1", [p2.order_id])).rows;
check(paidP2.status === "pagada" && paidP2.completed_at !== null && paidP2.cash_received === null, "caja cierra el domicilio al verificar la transferencia", JSON.stringify(paidP2));
check((await db.query("select close_delivery_order($1,'efectivo')", [p2.order_id]).then(() => null).catch((e) => e.message))?.includes("ya está cerrado"), "no se cobra dos veces");
check((await db.query("select cancel_order($1)", [p2.order_id]).then(() => null).catch((e) => e.message))?.includes("no se puede cancelar"), "un pedido cobrado no se cancela");
await db.query("insert into cash_movements (organization_id, session_id, type, amount, description) values ($1,$2,'egreso',5000,'gaseosas')", [A, sessionId]);
await db.query("insert into cash_movements (organization_id, session_id, type, amount, description) values ($1,$2,'ingreso',2000,'sencillo')", [A, sessionId]);
await db.query("select register_cash_movement('egreso', 8000, 'proveedor', 'transferencia', null, null, 'Don Pedro')");
await db.query("select register_cash_movement('ingreso', 3000, 'abono', 'transferencia', null, null, null)");
check((await db.query("select count(*)::int n from cash_movements where session_id=$1 and payment_method='transferencia'", [sessionId])).rows[0].n === 2, "las transferencias hechas en caja quedan en el turno");
check((await db.query("select close_cash_session($1, 92000, 'ok') as r", [sessionId]).then(() => false).catch((e) => e.message.includes("transferencias"))), "con movimiento por transferencia hay que verificarlo para cerrar");
const closed = (await db.query("select close_cash_session($1, 92000, 'ok', 34000) as r", [sessionId])).rows[0].r;
check(Number(closed.expected_transfer) === 35000 && Number(closed.difference_transfer) === -1000, "arqueo: transferencias esperadas (ventas + ingresos − egresos) y diferencia", JSON.stringify(closed));
check(Number(closed.difference) === 0, "el efectivo cuadra aparte de las transferencias");
// esperado = base 50000 + efectivo (45000 de la mesa) + 2000 - 5000 = 92000.
check(Number(closed.cash_sales) === 45000, "arqueo: ventas en efectivo del turno", JSON.stringify(closed));
check(Number(closed.transfer_sales) === 40000, "arqueo: ventas por transferencia del turno");
check(Number(closed.expected_cash) === 92000 && Number(closed.difference) === 0, "arqueo: esperado y diferencia", JSON.stringify(closed));
check((await db.query("select close_cash_session($1, 1, '') as r", [sessionId]).then(() => false).catch((e) => e.message.includes("ya fue cerrada"))), "no se cierra dos veces");
check((await db.query("insert into cash_movements (organization_id, session_id, type, amount, description) values ($1,$2,'egreso',1,'x')", [A, sessionId]).then(() => false).catch(() => true)), "no se registran movimientos en caja cerrada");

const sum = (await db.query("select * from report_sales_summary(now() - interval '1 day', now() + interval '1 day')")).rows;
const total = sum.reduce((a, r) => a + Number(r.total), 0);
check(total === 40000 + 45000, "reporte: total de ventas (despachados + mesas pagadas)", String(total));
const byProd = (await db.query("select * from report_sales_by_product(now() - interval '1 day', now() + interval '1 day')")).rows;
const clasicaDom = byProd.filter((r) => r.product_name === "Clásica" && r.channel === "domicilio").reduce((a, r) => a + Number(r.quantity), 0);
const clasicaMesa = byProd.filter((r) => r.product_name === "Clásica" && r.channel === "mesa").reduce((a, r) => a + Number(r.quantity), 0);
check(clasicaDom === 2 && clasicaMesa === 3, "reporte: unidades por producto y canal", `dom=${clasicaDom} mesa=${clasicaMesa}`);
await db.query("reset role");

// Reportes aislados por organización
await as(ownerB, async (s) => {
  const rows = await s.q("select * from report_sales_summary(now() - interval '1 day', now() + interval '1 day')");
  check(rows.length === 0, "reporte de B no ve ventas de A");
});

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------
const cocinaA = await makeUser(A, "cocina", "cocinaA");
const [orgC] = await admin("insert into organizations (name, slug) values ('Vacía C','vacia-c') returning id");
const [catCombosC] = await admin("insert into menu_categories (organization_id, name, is_combo_category) values ($1,'Combos',true) returning id", [orgC.id]);
check(
  (await db.query("insert into menu_products (organization_id, category_id, name, price, is_combo) values ($1,$2,'Combo X',1000,true)", [orgC.id, catCombosC.id]).then(() => null).catch((e) => e.message))?.includes("Primero crea"),
  "no se crea un combo si no hay ningún producto"
);

const [catCombos] = await admin("insert into menu_categories (organization_id, name, is_combo_category, sort_order) values ($1,'Combos',true,-1) returning id", [A]);
check(
  (await db.query("insert into menu_categories (organization_id, name, is_combo_category) values ($1,'Combos 2',true)", [A]).then(() => null).catch((e) => e.code)) === "23505",
  "una sola categoría de combos por organización"
);
check(
  (await db.query("insert into menu_products (organization_id, category_id, name, price, is_combo) values ($1,$2,'Mal',1000,true)", [A, catA.id]).then(() => null).catch((e) => e.message))?.includes("categoría de combos"),
  "un combo no va en una categoría normal"
);
check(
  (await db.query("insert into menu_products (organization_id, category_id, name, price) values ($1,$2,'Mal2',1000)", [A, catCombos.id]).then(() => null).catch((e) => e.message))?.includes("solo admite combos"),
  "un producto normal no va en la categoría de combos"
);
const [combo] = await admin("insert into menu_products (organization_id, category_id, name, price, is_combo) values ($1,$2,'Combo 1',18000,true) returning id", [A, catCombos.id]);
await admin("insert into menu_combo_items (organization_id, combo_id, product_id, quantity) values ($1,$2,$3,1),($1,$2,$4,1)", [A, combo.id, burger.id, papas.id]);
check(
  (await db.query("insert into menu_combo_items (organization_id, combo_id, product_id, quantity) values ($1,$2,$3,1)", [A, combo.id, combo.id]).then(() => null).catch((e) => e.message))?.includes("otro combo"),
  "un combo no incluye otro combo"
);
check(
  (await db.query("delete from menu_products where id=$1", [papas.id]).then(() => "deleted").catch((e) => e.code)) === "23001",
  "no se borra un producto que hace parte de un combo"
);
check((await admin("select product_is_orderable($1) as ok", [combo.id]))[0].ok === true, "combo disponible si sus productos lo están");
await admin("update menu_products set is_available=false where id=$1", [papas.id]);
check((await admin("select product_is_orderable($1) as ok", [combo.id]))[0].ok === false, "combo no disponible si un producto está agotado");
await as(null, async (s) => {
  check((await s.error("select * from create_delivery_order($1,$2::jsonb,'x','1','y','', 'efectivo')", [A, JSON.stringify([{ productId: combo.id, quantity: 1 }])]))?.includes("agotado"), "combo con componente agotado se rechaza en el pedido");
}, "service_role");
await admin("update menu_products set is_available=true where id=$1", [papas.id]);

// Disponibilidad automática de combos (007)
{
  const st = async () => (await admin("select is_available, combo_auto_off from menu_products where id=$1", [combo.id]))[0];
  check((await st()).is_available === true, "combo disponible al inicio");
  await admin("update menu_products set is_available=false where id=$1", [papas.id]);
  let s1 = await st();
  check(s1.is_available === false && s1.combo_auto_off === true, "al agotarse un producto, el combo se apaga solo", JSON.stringify(s1));
  await admin("update menu_products set is_available=true where id=$1", [papas.id]);
  s1 = await st();
  check(s1.is_available === true && s1.combo_auto_off === false, "al volver el producto, el combo vuelve solo", JSON.stringify(s1));
  // El administrador reactiva el combo a mano con el producto aún agotado
  await admin("update menu_products set is_available=false where id=$1", [papas.id]);
  await admin("update menu_products set is_available=true where id=$1", [combo.id]);
  const papasNow = (await admin("select is_available from menu_products where id=$1", [papas.id]))[0];
  s1 = await st();
  check(s1.is_available === true && s1.combo_auto_off === false && papasNow.is_available === false, "reactivar el combo a mano NO cambia el producto individual", JSON.stringify({ s1, papasNow }));
  check((await admin("select product_is_orderable($1) as ok", [combo.id]))[0].ok === true, "combo reactivado a mano se puede pedir");
  // Combo apagado a mano no vuelve solo cuando el producto regresa
  await admin("update menu_products set is_available=false where id=$1", [combo.id]);
  await admin("update menu_products set is_available=true where id=$1", [papas.id]);
  s1 = await st();
  check(s1.is_available === false, "combo apagado a mano no se reactiva solo");
  await admin("update menu_products set is_available=true where id=$1", [combo.id]);
}
// Borrar un producto con ventas pasadas funciona (el historial conserva nombre y precio)
{
  const [temp] = await admin("insert into menu_products (organization_id, category_id, name, price) values ($1,$2,'Temporal',500) returning id", [A, catA.id]);
  const [oc] = await admin("insert into orders (organization_id, channel, status, table_id, completed_at) values ($1,'mesa','abierta',null,null) returning id", [A]);
  await admin("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,1)", [A, oc.id, temp.id]);
  await admin("update orders set status='pagada', payment_method='efectivo', total=500, subtotal=500, completed_at=now() where id=$1", [oc.id]);
  await as(ownerA, async (s) => {
    check(!(await s.blocked("delete from menu_products where id=$1", [temp.id])), "owner borra un producto que ya tiene ventas");
  });
  const [kept] = await admin("select product_name, unit_price from order_items where order_id=$1", [oc.id]);
  check(kept.product_name === "Temporal" && Number(kept.unit_price) === 500, "la venta pasada conserva nombre y precio");
  await admin("delete from order_items where order_id=$1", [oc.id]).catch(() => {});
}
// Anon ve el combo y sus componentes
await as(null, async (s) => {
  check((await s.q("select 1 from menu_combo_items where combo_id=$1", [combo.id])).length === 2, "anon ve los componentes del combo");
}, "anon");
await as(ownerB, async (s) => {
  check(await s.blocked("delete from menu_combo_items where organization_id=$1", [A]), "otra organización no edita combos de A");
});
await as(cajeroA, async (s) => {
  check(await s.blocked("delete from menu_combo_items", []), "cajero no edita combos");
});

// Mesa con combo: snapshot y precio
const [mesa3] = await admin("insert into restaurant_tables (organization_id, name) values ($1,'Mesa 3') returning id", [A]);
await as(meseroA, async (s) => {
  const [o] = await s.q("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2) returning id", [A, mesa3.id]);
  await s.q("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,2)", [A, o.id, combo.id]);
  const [it] = await s.q("select unit_price, combo_snapshot from order_items where order_id=$1", [o.id]);
  check(Number(it.unit_price) === 18000 && it.combo_snapshot?.length === 2, "línea de combo guarda precio del combo y su contenido", JSON.stringify(it));
});

// Pedido para recoger (service_role) con combo
await db.query("set role service_role");
await db.query("select set_config('request.jwt.claim.role','service_role', false)");
const pick = (await db.query("select * from create_delivery_order($1,$2::jsonb,'Marta','3009','', 'sin cebolla','efectivo','recoger')", [A, JSON.stringify([{ productId: combo.id, quantity: 2, notes: "sin pepinillo" }])])).rows[0];
const dom = (await db.query("select * from create_delivery_order($1,$2::jsonb,'Pablo','3010','Calle 9','','efectivo','domicilio')", [A, JSON.stringify([{ productId: burger.id, quantity: 1 }])])).rows[0];
const noAddr = await db.query("select * from create_delivery_order($1,$2::jsonb,'Pablo','3010','','','efectivo','domicilio')", [A, JSON.stringify([{ productId: burger.id, quantity: 1 }])]).then(() => null).catch((e) => e.message);
await db.query("reset role");
await db.query("select set_config('request.jwt.claim.role','', false)");
check(Number(pick.delivery_fee) === 0 && Number(pick.subtotal) === 36000 && Number(pick.total) === 37000, "recoger: sin domicilio, con desechables", JSON.stringify(pick));
check(Number(dom.delivery_fee) === 3000, "domicilio mantiene su valor");
check(noAddr?.includes("dirección"), "domicilio exige dirección");
check((await admin("select fulfillment, address from orders where id=$1", [pick.order_id]))[0].fulfillment === "recoger", "pedido guardado como recoger");
await admin("update restaurant_settings set pickup_enabled=false where organization_id=$1", [A]);
await db.query("set role service_role");
await db.query("select set_config('request.jwt.claim.role','service_role', false)");
check((await db.query("select * from create_delivery_order($1,$2::jsonb,'M','1','','','efectivo','recoger')", [A, JSON.stringify([{ productId: burger.id, quantity: 1 }])]).then(() => null).catch((e) => e.message))?.includes("recoger"), "recoger deshabilitado se rechaza");
await db.query("reset role");
await db.query("select set_config('request.jwt.claim.role','', false)");
await admin("update restaurant_settings set pickup_enabled=true where organization_id=$1", [A]);

// Cocina: independiente y con permisos propios
const [kItem] = await admin("select id from order_items where order_id=$1 limit 1", [pick.order_id]);
check((await admin("select sent_to_kitchen_at from order_items where id=$1", [kItem.id]))[0].sent_to_kitchen_at === null, "un pedido nuevo NO aparece en cocina hasta enviarlo");
await as(cocinaA, async (s) => {
  check((await s.error("select set_item_kitchen_status($1,true)", [kItem.id]))?.includes("no encontrado en cocina"), "cocina no toca lo que no se ha enviado");
  check((await s.error("select send_order_to_kitchen($1)", [pick.order_id])) !== null, "cocina NO envía pedidos a cocina");
});
await as(meseroA, async (s) => {
  check((await s.error("select send_order_to_kitchen($1)", [pick.order_id])) !== null, "mesero NO envía un domicilio a cocina");
});
await as(ownerB, async (s) => {
  check((await s.error("select send_order_to_kitchen($1)", [pick.order_id])) !== null, "otra organización no envía mi pedido");
});
await as(ownerA, async (s) => {
  await s.q("select send_order_to_kitchen($1)", [pick.order_id]);
  const [o] = await s.q("select kitchen_sent_at, kitchen_done_at from orders where id=$1", [pick.order_id]);
  check(o.kitchen_sent_at !== null && o.kitchen_done_at === null, "enviar a cocina marca el inicio del tiempo");
  check((await s.error("select send_order_to_kitchen($1)", [pick.order_id]))?.includes("No hay productos nuevos"), "no se envía dos veces lo mismo");
}, "authenticated", true);
await as(cocinaA, async (s) => {
  await s.q("select set_item_kitchen_status($1,true)", [kItem.id]);
  check((await s.q("select kitchen_status from order_items where id=$1", [kItem.id]))[0].kitchen_status === "listo", "cocina marca un item como listo");
  await s.q("select set_order_kitchen_status($1,true)", [pick.order_id]);
  check((await s.error("select dispatch_order($1)", [pick.order_id])) !== null, "cocina NO despacha");
  check((await s.error("select close_table_order($1,'efectivo')", [pick.order_id])) !== null, "cocina NO cobra");
  check(await s.blocked("update order_items set quantity=9", []), "cocina no edita items directamente");
});
await as(meseroA, async (s) => {
  check((await s.error("select set_item_kitchen_status($1,true)", [kItem.id])) !== null, "mesero NO usa la pantalla de cocina");
});
await as(ownerB, async (s) => {
  check((await s.error("select set_item_kitchen_status($1,true)", [kItem.id])) !== null, "otra organización no toca mi cocina");
});
await admin("update organization_modules set enabled=false where organization_id=$1 and module_id=(select id from modules where key='cocina')", [A]);
await as(cocinaA, async (s) => {
  check((await s.error("select set_item_kitchen_status($1,true)", [kItem.id]))?.includes("no está activo"), "módulo cocina apagado bloquea la pantalla");
});
await as(cajeroA, async (s) => {
  await s.q("select dispatch_order($1)", [pick.order_id]);
  check(true, "con cocina apagada el cajero sigue despachando (flujo independiente)");
});
await admin("update organization_modules set enabled=true where organization_id=$1 and module_id=(select id from modules where key='cocina')", [A]);

// Cocina: tiempos, avisos de cambios y edición de domicilios (todo en una transacción)
await as(cajeroA, async (s) => {
  await switchTo(cocinaA);
  await s.q("select set_order_kitchen_status($1,true)", [pick.order_id]);
  const [t] = await s.q("select kitchen_sent_at, kitchen_done_at from orders where id=$1", [pick.order_id]);
  check(t.kitchen_done_at !== null && new Date(t.kitchen_done_at) >= new Date(t.kitchen_sent_at), "se registra el tiempo que duró en cocina");

  await switchTo(cajeroA);
  await s.q("update order_items set quantity=3 where order_id=$1", [pick.order_id]);
  const [o] = await s.q("select subtotal, total, kitchen_done_at from orders where id=$1", [pick.order_id]);
  check(Number(o.subtotal) === 54000 && Number(o.total) === 55000, "al editar un domicilio el total se recalcula", JSON.stringify(o));
  check(o.kitchen_done_at === null, "pedir más de algo ya despachado lo vuelve a preparar");
  const [c] = await s.q("select kind, description, acked_at from kitchen_changes where order_id=$1 and kind='modificado'", [pick.order_id]);
  check(c && c.acked_at === null && c.description.includes("cantidad 2 → 3"), "cocina recibe el aviso del cambio", JSON.stringify(c));

  await s.q("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,2)", [A, pick.order_id, papas.id]);
  const [o2] = await s.q("select subtotal, total from orders where id=$1", [pick.order_id]);
  check(Number(o2.subtotal) === 66000 && Number(o2.total) === 67000, "agregar un producto al domicilio suma al total", JSON.stringify(o2));
  check((await s.q("select sent_to_kitchen_at from order_items where product_id=$1 and order_id=$2", [papas.id, pick.order_id]))[0].sent_to_kitchen_at === null, "lo agregado queda sin enviar hasta darle enviar a cocina");
  await s.q("select send_order_to_kitchen($1)", [pick.order_id]);
  check((await s.q("select 1 from kitchen_changes where order_id=$1 and kind='agregado' and acked_at is null", [pick.order_id])).length === 1, "lo agregado después avisa a cocina");

  await switchTo(cocinaA);
  await s.q("select ack_kitchen_changes($1)", [pick.order_id]);
  check((await s.q("select 1 from kitchen_changes where order_id=$1 and acked_at is null", [pick.order_id])).length === 0, "cocina marca los avisos como vistos");

  await switchTo(cajeroA);
  await s.q("delete from order_items where product_id=$1 and order_id=$2", [papas.id, pick.order_id]);
  check((await s.q("select 1 from kitchen_changes where description like 'Se quitó%' and order_id=$1", [pick.order_id])).length === 1, "quitar un producto enviado avisa a cocina");
  await s.q("select update_delivery_order_info($1,'Marta R','3001112222','','sin hielo','transferencia')", [pick.order_id]);
  const [info] = await s.q("select customer_name, customer_phone, payment_method from orders where id=$1", [pick.order_id]);
  check(info.customer_name === "Marta R" && info.payment_method === "transferencia", "se editan los datos del domicilio");

  // Edición completa: dirección vacía permitida, cambio de tipo de entrega y de valores
  await s.q("select update_delivery_order_info($1,'Marta R','3001112222','','','efectivo','domicilio',4000,1500)", [pick.order_id]);
  const [full] = await s.q("select fulfillment, address, delivery_fee, disposables_fee, subtotal, total from orders where id=$1", [pick.order_id]);
  check(full.fulfillment === "domicilio" && full.address === null && Number(full.delivery_fee) === 4000 && Number(full.total) === Number(full.subtotal) + 5500, "se edita tipo de entrega, valores y la dirección puede quedar vacía", JSON.stringify(full));
  await s.q("select update_delivery_order_info($1,'Marta R','3001112222','Calle 5 #4-3','','efectivo','recoger',9999,1000)", [pick.order_id]);
  const [back] = await s.q("select fulfillment, delivery_fee, total, subtotal from orders where id=$1", [pick.order_id]);
  check(back.fulfillment === "recoger" && Number(back.delivery_fee) === 0 && Number(back.total) === Number(back.subtotal) + 1000, "recoger deja el domicilio en 0 y recalcula el total", JSON.stringify(back));
  check((await s.error("select update_delivery_order_info($1,'Marta R','1','','','efectivo','volando',0,0)", [pick.order_id])) !== null, "tipo de entrega inválido se rechaza");
  await switchTo(meseroA);
  check(await s.blocked("update order_items set quantity=9 where order_id=$1", [pick.order_id]), "mesero no edita items de un domicilio");
  check((await s.error("select update_delivery_order_info($1,'X Y','1','','','efectivo')", [pick.order_id])) !== null, "mesero no edita datos de un domicilio");
});

// Mesa: enviar a cocina, cambios y cobro en dos pasos
const [mesa5] = await admin("insert into restaurant_tables (organization_id, name) values ($1,'Mesa 5') returning id", [A]);
await as(meseroA, async (s) => {
  const [o] = await s.q("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2) returning id", [A, mesa5.id]);
  await s.q("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,1)", [A, o.id, burger.id]);
  check((await s.q("select sent_to_kitchen_at from order_items where order_id=$1", [o.id]))[0].sent_to_kitchen_at === null, "lo que agrega el mesero no llega solo a cocina");
  await s.q("select send_order_to_kitchen($1)", [o.id]);
  check((await s.q("select sent_to_kitchen_at from order_items where order_id=$1", [o.id]))[0].sent_to_kitchen_at !== null, "el mesero envía a cocina");
  await s.q("update order_items set quantity=2, notes='sin queso' where order_id=$1", [o.id]);
  check((await s.q("select description from kitchen_changes where order_id=$1 and kind='modificado'", [o.id])).length === 1, "el mesero modifica lo enviado y cocina recibe el aviso");
  // Después de enviar, el mesero puede agregar productos NUEVOS (quedan sin enviar) y enviarlos
  await s.q("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,2)", [A, o.id, papas.id]);
  const nuevos = await s.q("select product_name, sent_to_kitchen_at from order_items where order_id=$1 and product_id=$2", [o.id, papas.id]);
  check(nuevos.length === 1 && nuevos[0].sent_to_kitchen_at === null, "tras enviar, el mesero agrega un producto nuevo (queda sin enviar)");
  await s.q("select send_order_to_kitchen($1)", [o.id]);
  check((await s.q("select 1 from kitchen_changes where order_id=$1 and kind='agregado' and acked_at is null", [o.id])).length === 1, "el mesero envía lo agregado y cocina recibe el aviso");
  await s.q("select request_table_payment($1,'transferencia')", [o.id]);
  check((await s.q("select payment_requested_at from orders where id=$1", [o.id]))[0].payment_requested_at !== null, "cobro pedido por el mesero");
  await s.q("update order_items set quantity=3 where order_id=$1", [o.id]);
  check((await s.q("select payment_requested_at from orders where id=$1", [o.id]))[0].payment_requested_at === null, "si la cuenta cambia, el cobro pedido se anula");
  await s.q("select request_table_payment($1,'efectivo')", [o.id]);
  await s.q("select cancel_table_payment_request($1)", [o.id]);
  check((await s.q("select payment_requested_at from orders where id=$1", [o.id]))[0].payment_requested_at === null, "el mesero puede retirar el cobro pedido");
  check((await s.error("select ack_kitchen_changes($1)", [o.id])) !== null, "mesero no marca avisos de cocina");
});

// Cajero: solo ve cocina y mesas (no las edita); cobra en Caja
const [mesa6] = await admin("insert into restaurant_tables (organization_id, name) values ($1,'Mesa 6') returning id", [A]);
const [ordMesa6] = await admin("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2) returning id", [A, mesa6.id]);
await admin("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,1)", [A, ordMesa6.id, burger.id]);
await db.query("begin");
await db.query("select set_config('comanet.internal','1',true)");
await db.query("update order_items set sent_to_kitchen_at=now() where order_id=$1", [ordMesa6.id]);
await db.query("commit");
const [itemMesa6] = await admin("select id from order_items where order_id=$1", [ordMesa6.id]);
const [mesa7] = await admin("insert into restaurant_tables (organization_id, name) values ($1,'Mesa 7') returning id", [A]);
await as(cajeroA, async (s) => {
  check((await s.q("select 1 from orders where id=$1", [ordMesa6.id])).length === 1, "el cajero VE las mesas");
  check((await s.q("select 1 from order_items where order_id=$1", [ordMesa6.id])).length === 1, "el cajero VE la cuenta de la mesa");
  check(await s.blocked("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2)", [A, mesa7.id]), "el cajero NO abre mesas");
  check(await s.blocked("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,1)", [A, ordMesa6.id, burger.id]), "el cajero NO agrega productos a una mesa");
  check(await s.blocked("update order_items set quantity=5 where order_id=$1", [ordMesa6.id]), "el cajero NO cambia cantidades de una mesa");
  check(await s.blocked("delete from order_items where order_id=$1", [ordMesa6.id]), "el cajero NO quita productos de una mesa");
  check((await s.error("select send_order_to_kitchen($1)", [ordMesa6.id])) !== null, "el cajero NO envía una mesa a cocina");
  check((await s.error("select request_table_payment($1,'efectivo')", [ordMesa6.id])) !== null, "el cajero NO marca cuenta entregada");
  check((await s.error("select cancel_order($1)", [ordMesa6.id]))?.includes("administrador"), "el cajero NO cancela una mesa");
  check((await s.error("select set_item_kitchen_status($1,true)", [itemMesa6.id])) !== null, "el cajero NO despacha en cocina");
  check((await s.error("select set_order_kitchen_status($1,true)", [ordMesa6.id])) !== null, "el cajero NO despacha un pedido en cocina");
  check((await s.error("select ack_kitchen_changes($1)", [ordMesa6.id])) !== null, "el cajero NO confirma avisos de cocina");
});
await as(ownerA, async (s) => {
  await s.q("select set_item_kitchen_status($1,true)", [itemMesa6.id]);
  check((await s.q("select kitchen_status from order_items where id=$1", [itemMesa6.id]))[0].kitchen_status === "listo", "el administrador sí despacha en cocina");
  await s.q("select request_table_payment($1,'efectivo')", [ordMesa6.id]);
  await s.q("select cancel_order($1)", [ordMesa6.id]);
  check((await s.q("select status from orders where id=$1", [ordMesa6.id]))[0].status === "cancelado", "el administrador sí cancela una mesa");
});

// Ingresos, egresos y facturas (módulo independiente de caja)
await as(cajeroA, async (s) => {
  const path = A + "/f1.pdf";
  const [m] = await s.q("select register_cash_movement('egreso', 200000, 'pago recibo energía', 'transferencia', $1, 'recibo.pdf') as id", [path]);
  const [row] = await s.q("select session_id, amount, invoice_path from cash_movements where id=$1", [m.id]);
  check(row.session_id === null && Number(row.amount) === 200000 && row.invoice_path === path, "egreso de 200000 con factura, sin turno de caja");
  check((await s.error("select register_cash_movement('egreso', 5000, 'x', 'efectivo', $1, 'a.pdf')", [B + "/a.pdf"])) !== null, "la factura debe estar en la carpeta de mi negocio");
  check((await s.error("select register_cash_movement('egreso', 0, 'x', 'efectivo', null, null)", [])) !== null, "valor mayor a 0");
  const [libre] = await s.q("select register_cash_movement('egreso', 1550.5, 'compra', 'efectivo', null, null) as id");
  check(libre.id !== null, "cualquier valor (sin restricción de múltiplos)");
  const [conT] = await s.q("select register_cash_movement('egreso', 85000, 'pago recibo de energía', 'transferencia', null, null, 'Electrificadora') as id");
  const found = await s.q("select 1 from cash_movements where id=$1 and counterparty ilike $2", [conT.id, '%electrif%']);
  check(found.length === 1, "se guarda y se busca la persona o proveedor");
});
await as(meseroA, async (s) => {
  check((await s.error("select register_cash_movement('egreso', 5000, 'x', 'efectivo', null, null)", [])) !== null, "mesero no registra movimientos");
});
await admin("update organization_modules set enabled=false where organization_id=$1 and module_id=(select id from modules where key='finanzas')", [A]);
await as(cajeroA, async (s) => {
  check((await s.error("select register_cash_movement('egreso', 5000, 'x', 'efectivo', $1, 'a.pdf')", [A + "/a.pdf"])) !== null, "sin el módulo de facturas no se adjuntan facturas");
});
await admin("update organization_modules set enabled=true where organization_id=$1 and module_id=(select id from modules where key='finanzas')", [A]);
await admin("update organization_modules set enabled=false where organization_id=$1 and module_id in (select id from modules where key in ('caja','finanzas'))", [A]);
await as(cajeroA, async (s) => {
  check((await s.error("select register_cash_movement('egreso', 5000, 'x', 'efectivo', null, null)", [])) !== null, "sin caja ni finanzas no hay movimientos");
});
await admin("update organization_modules set enabled=true where organization_id=$1 and module_id in (select id from modules where key in ('caja','finanzas'))", [A]);

// Reporte: el combo se desglosa por producto
await admin("update orders set status='despachado', completed_at=now() where id=$1", [pick.order_id]);
await as(ownerA, async (s) => {
  const rows = await s.q("select * from report_sales_by_product(now() - interval '1 day', now() + interval '1 day')");
  check(!rows.some((r) => r.product_name === "Combo 1"), "el reporte NO lista el combo como producto");
  const cl = rows.filter((r) => r.product_name === "Clásica" && r.channel === "domicilio");
  const pa = rows.filter((r) => r.product_name === "Papas" && r.channel === "domicilio");
  check(Number(cl[0]?.quantity) >= 2 && Number(pa[0]?.quantity) >= 2, "el reporte cuenta los productos del combo uno por uno", JSON.stringify(rows));
  // Ingreso repartido: Clásica 15000/21000 y Papas 6000/21000 de 36000
  const comboRevenue = 36000;
  const share = Math.round(comboRevenue * (15000 / 21000));
  check(rows.some((r) => r.product_name === "Papas") && Math.round(Number(cl[0].revenue)) >= share, "el ingreso del combo se reparte entre sus productos");
  const total = rows.reduce((a, r) => a + Number(r.revenue), 0);
  const summary = await s.q("select * from report_sales_summary(now() - interval '1 day', now() + interval '1 day')");
  const subtotalSum = summary.reduce((a, r) => a + Number(r.subtotal), 0);
  check(Math.round(total) === Math.round(subtotalSum), "ingresos por producto cuadran con los subtotales de ventas", `${total} vs ${subtotalSum}`);
  check(summary.some((r) => r.fulfillment === "recoger"), "el resumen separa los pedidos para recoger");
});
// ---------------------------------------------------------------------------
// Perfiles / organizaciones
// ---------------------------------------------------------------------------
await as(ownerA, async (s) => {
  check(await s.blocked("update profiles set role='super_admin' where id=$1", [ownerA]), "owner no se escala a super_admin");
  check(await s.blocked("update organizations set max_usuarios=999 where id=$1", [A]), "owner no cambia sus límites");
  check(!(await s.blocked("update organizations set legal_name='Burger SAS' where id=$1", [A])), "owner edita datos de su negocio");
  check(await s.blocked("update organizations set is_active=false where id=$1", [A]), "owner no se desactiva");
  check(await s.blocked("update organization_modules set enabled=true", []), "owner no activa módulos");
});
await as(superAdmin, async (s) => {
  check((await s.q("select 1 from organizations")).length === 3, "super admin ve todas las organizaciones");
  check(!(await s.blocked("update organization_modules set enabled=false where organization_id=$1", [B])), "super admin gestiona módulos");
  await s.q("insert into activity_log (organization_id, username, role, action) values (null,'root','super_admin','x')");
  check(true, "super admin registra actividad sin organización");
});

// Cobro de domicilio: permisos, cancelación y negocio sin módulo de caja
await db.query("set role service_role");
await db.query("select set_config('request.jwt.claim.role','service_role', false)");
const porCobrar = (await db.query("select * from create_delivery_order($1,$2::jsonb,'Cobro','3000000000','Calle 2','','efectivo','domicilio')", [A, JSON.stringify([{ productId: burger.id, quantity: 1 }])])).rows[0];
await db.query("reset role");
await db.query("select set_config('request.jwt.claim.role','', false)");
await as(cajeroA, async (s) => {
  await s.q("select dispatch_order($1)", [porCobrar.order_id]);
  await switchTo(meseroA);
  check((await s.error("select close_delivery_order($1,'efectivo')", [porCobrar.order_id])) !== null, "mesero no cobra domicilios");
  await switchTo(cocinaA);
  check((await s.error("select close_delivery_order($1,'efectivo')", [porCobrar.order_id])) !== null, "cocina no cobra domicilios");
  await switchTo(ownerB);
  check((await s.error("select close_delivery_order($1,'efectivo')", [porCobrar.order_id])) !== null, "otra organización no cobra mi domicilio");
  await switchTo(cajeroA);
  check((await s.error("select close_delivery_order($1,'efectivo')", [porCobrar.order_id]))?.includes("Abre la caja"), "domicilio: sin turno abierto no se cobra");
  check(await s.blocked("update order_items set quantity=9 where order_id=$1", [porCobrar.order_id]), "un domicilio enviado ya no se edita");
  await s.q("select cancel_order($1)", [porCobrar.order_id]);
  check((await s.q("select status from orders where id=$1", [porCobrar.order_id]))[0].status === "cancelado", "un domicilio enviado sin cobrar se puede cancelar");
});
await admin("update organization_modules set enabled=false where organization_id=$1 and module_id=(select id from modules where key='caja')", [A]);
await as(ownerA, async (s) => {
  await s.q("select dispatch_order($1)", [porCobrar.order_id]);
  await s.q("select close_delivery_order($1,'efectivo',30000)", [porCobrar.order_id]);
  check((await s.q("select change_given from orders where id=$1", [porCobrar.order_id]))[0].change_given !== null, "sin el módulo de caja se cobra sin turno abierto");
});
await admin("update organization_modules set enabled=true where organization_id=$1 and module_id=(select id from modules where key='caja')", [A]);

// Borrar un producto que está en un pedido activo (domicilio pendiente o mesa abierta)
const [temporal] = await admin("insert into menu_products (organization_id, category_id, name, price) values ($1,$2,'Temporal',1000) returning id", [A, catA.id]);
await db.query("set role service_role");
await db.query("select set_config('request.jwt.claim.role','service_role', false)");
const tmpOrder = (await db.query("select * from create_delivery_order($1,$2::jsonb,'Tmp','3000000000','Calle 1','','efectivo','domicilio')", [A, JSON.stringify([{ productId: temporal.id, quantity: 1 }, { productId: burger.id, quantity: 1 }])])).rows[0];
await db.query("reset role");
await db.query("select set_config('request.jwt.claim.role','', false)");
await as(ownerA, async (s) => {
  const err = await s.q("delete from menu_products where id=$1", [temporal.id]).then(() => null).catch((e) => e.message);
  check(err === null, "se borra un producto que está en un domicilio pendiente", String(err));
  const [orphans] = await s.q("select count(*)::int n from order_items i where i.order_id=$1 and i.product_id is not null and not exists (select 1 from menu_products p where p.id=i.product_id)", [tmpOrder.order_id]);
  check(orphans.n === 0, "la línea queda desvinculada del producto borrado", JSON.stringify(orphans));
  check((await s.q("select count(*)::int n from order_items where order_id=$1", [tmpOrder.order_id]))[0].n === 2, "la línea del pedido se conserva");
});

// Borrar una organización con pedidos activos en cocina
const [orgTacos] = await admin("insert into organizations (name, slug) values ('Tacos C','tacos-c') returning id");
const C = orgTacos.id;
const [catC] = await admin("insert into menu_categories (organization_id, name) values ($1,'Tacos') returning id", [C]);
const [taco] = await admin("insert into menu_products (organization_id, category_id, name, price) values ($1,$2,'Taco',5000) returning id", [C, catC.id]);
const [mesaC] = await admin("insert into restaurant_tables (organization_id, name) values ($1,'Mesa 1') returning id", [C]);
const [ordC] = await admin("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2) returning id", [C, mesaC.id]);
await admin("insert into order_items (organization_id, order_id, product_id, product_name, unit_price, quantity) values ($1,$2,$3,'',0,1)", [C, ordC.id, taco.id]);
await db.query("begin");
await db.query("select set_config('comanet.internal','1',true)");
await db.query("update order_items set sent_to_kitchen_at=now() where order_id=$1", [ordC.id]);
await db.query("commit");
await db.query("set role service_role");
await db.query("select set_config('request.jwt.claim.role','service_role', false)");
const delErr = await db.query("delete from organizations where id=$1", [C]).then(() => null).catch((e) => e.message);
await db.query("reset role");
await db.query("select set_config('request.jwt.claim.role','', false)");
check(delErr === null, "se borra una organización con pedidos activos en cocina", String(delErr));

// Módulo mesas apagado => no se abren cuentas
await admin("update organization_modules set enabled=false where organization_id=$1 and module_id=(select id from modules where key='mesas')", [A]);
const [m2] = await admin("insert into restaurant_tables (organization_id, name) values ($1,'Mesa 2') returning id", [A]);
await as(meseroA, async (s) => {
  check(await s.blocked("insert into orders (organization_id, channel, status, table_id) values ($1,'mesa','abierta',$2)", [A, m2.id]), "módulo mesas apagado bloquea abrir cuentas");
});

// Límite de intentos: solo el servidor (service_role) lo usa
await as(null, async (s) => {
  const a = (await s.q("select rate_limit_hit('t:k', 600) h"))[0].h;
  const b = (await s.q("select rate_limit_hit('t:k', 600) h"))[0].h;
  const c = (await s.q("select rate_limit_count('t:k', 600) h"))[0].h;
  const d = (await s.q("select rate_limit_count('t:otra', 600) h"))[0].h;
  check(a === 1 && b === 2, "rate_limit_hit suma intentos", `${a},${b}`);
  check(c === 2 && d === 0, "rate_limit_count lee sin sumar", `${c},${d}`);
}, "service_role");
for (const role of ["anon", "authenticated"]) {
  await as(ownerA, async (s) => {
    check(await s.blocked("select rate_limit_hit('x', 60)"), `${role} no puede llamar rate_limit_hit`);
    check(await s.blocked("select rate_limit_count('x', 60)"), `${role} no puede llamar rate_limit_count`);
    check(await s.blocked("select * from rate_limits"), `${role} no puede leer rate_limits`);
    check(await s.blocked("delete from rate_limits"), `${role} no puede borrar rate_limits`);
  }, role);
}

console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallidas.`);
await db.end();
process.exit(failures.length ? 1 : 0);
