// Pruebas de la plataforma con D1 simulado: `node --test test/*.test.js`
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { d1Local } from "../herramientas/d1-local.mjs";
import { _reiniciar, accesoDe } from "../worker/db.js";
import { hoyLocal, sumarDias, sumarMeses, hmacHex } from "../worker/util.js";
import { parsear, sinRespuestas, calificar } from "../public/s/formato.js";

let env;
const fetchReal = globalThis.fetch;
beforeEach(() => {
  _reiniciar();
  globalThis.fetch = fetchReal;
  env = {
    DB: d1Local(), DEV_LOCAL: "1", ADMIN_EMAILS: "diego@demo.mx", PRECIO_NORMAL: "499", PRECIO_VIP: "899", GRACIA_DIAS: "3",
    ASSETS: { fetch: async () => new Response("ok") },
  };
});

async function llamar(ruta, { metodo = "GET", datos, cookie, headers = {} } = {}) {
  const res = await worker.fetch(new Request(`http://localhost${ruta}`, {
    method: metodo,
    headers: { ...(datos ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: datos ? JSON.stringify(datos) : undefined,
  }), env);
  const set = res.headers.get("Set-Cookie");
  return { status: res.status, j: await res.json().catch(() => null), cookie: set ? set.split(";")[0] : null };
}

async function entrar(correo, registro = null) {
  const r = registro
    ? await llamar("/api/registro", { metodo: "POST", datos: { ...registro, correo } })
    : await llamar("/api/codigo", { metodo: "POST", datos: { correo } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const e = await llamar("/api/entrar", { metodo: "POST", datos: { correo, codigo: r.j.dev_codigo } });
  assert.equal(e.status, 200, JSON.stringify(e.j));
  return e.cookie;
}

test("fechas: sumar meses respeta fin de mes", () => {
  assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(sumarMeses("2026-11-25", 1), "2026-12-25");
  assert.equal(sumarMeses("2026-12-15", 1), "2027-01-15");
});

test("acceso: cortesía, al corriente, gracia, vencido, sin pago", () => {
  const hoy = "2026-11-25";
  assert.equal(accesoDe({ cortesia: 1 }, hoy).estado, "cortesia");
  assert.equal(accesoDe({ acceso_hasta: "2026-12-01" }, hoy).estado, "al_corriente");
  assert.equal(accesoDe({ acceso_hasta: "2026-11-23" }, hoy, 3).estado, "gracia");
  assert.equal(accesoDe({ acceso_hasta: "2026-11-20" }, hoy, 3).ok, false);
  assert.equal(accesoDe({}, hoy).estado, "sin_pago");
  assert.equal(accesoDe({ cortesia: 1, baja: 1 }, hoy).ok, false);
});

test("formato: lee la lección, esconde respuestas y califica", () => {
  const b = parsear("# Hola\n= dog = perro\n= cat = gato\n? She ___ happy. | are | *is\n_ I [am|'m] here and you [are].\n> Tell me about you.");
  assert.deepEqual(b.map((x) => x.t), ["h1", "vocab", "opcion", "huecos", "abierta"]);
  assert.equal(b[1].items.length, 2);
  const pub = JSON.stringify(sinRespuestas(b));
  assert.ok(!pub.includes('"ok"') && !pub.includes("'m"), "no debe mandar respuestas");
  const r = calificar(b, { e1: 1, e2: ["’m", "ARE."] });
  assert.equal(r.aciertos, 3); assert.equal(r.total, 3);
  assert.equal(calificar(b, { e1: 0 }).aciertos, 0);
});

test("registro → sin acceso → pago en efectivo → ve sus lecciones y las califica", async () => {
  const c = await entrar("ana@demo.mx", { nombre: "Ana López", whatsapp: "614 111 2233" });
  let yo = await llamar("/api/yo", { cookie: c });
  assert.equal(yo.j.acceso.estado, "sin_pago");
  assert.equal(yo.j.precios.vip, 899);

  let cat = await llamar("/api/catalogo", { cookie: c });
  const lec = cat.j.modulos[0].lecciones[0];
  assert.equal(lec.bloqueado, true);
  assert.equal((await llamar(`/api/leccion/${lec.id}`, { cookie: c })).status, 403);

  // Diego registra un pago en efectivo desde el panel.
  const admin = await entrar("diego@demo.mx");
  const lista = await llamar("/api/admin/alumnos", { cookie: admin });
  assert.equal(lista.j.resumen.sin_pago, 1);
  const ana = lista.j.alumnos.find((a) => a.correo === "ana@demo.mx");
  assert.equal((await llamar(`/api/admin/alumnos/${ana.id}/pago`, { metodo: "POST", cookie: admin, datos: { monto: 499, metodo: "efectivo" } })).status, 200);

  yo = await llamar("/api/yo", { cookie: c });
  assert.equal(yo.j.acceso.estado, "al_corriente");
  assert.equal(yo.j.acceso.hasta, sumarMeses(hoyLocal(), 1));

  cat = await llamar("/api/catalogo", { cookie: c });
  assert.equal(cat.j.modulos[0].lecciones[0].bloqueado, false);
  assert.equal(cat.j.modulos[1].bloqueado, true, "el módulo VIP sigue cerrado para Normal");

  const l = await llamar(`/api/leccion/${lec.id}`, { cookie: c });
  assert.equal(l.status, 200);
  assert.ok(l.j.marca.startsWith("ana@demo.mx"));
  const r = await llamar(`/api/leccion/${lec.id}/respuestas`, { metodo: "POST", cookie: c, datos: { datos: { e1: 1, e2: 0, e3: ["is", "am"], e4: "My name is Ana." } } });
  assert.equal(r.j.resultado.aciertos, 4);
  assert.equal(r.j.resultado.total, 4);
});

test("alumno normal no entra al panel; una sola sesión por cuenta", async () => {
  await entrar("luis@demo.mx", { nombre: "Luis", whatsapp: "6142223344" });
  const c1 = await entrar("luis@demo.mx");
  assert.equal((await llamar("/api/admin/alumnos", { cookie: c1 })).status, 403);
  const c2 = await entrar("luis@demo.mx");
  assert.equal((await llamar("/api/yo", { cookie: c1 })).status, 401, "la sesión anterior se cierra");
  assert.equal((await llamar("/api/yo", { cookie: c2 })).status, 200);
});

test("correo desconocido pide registro; código equivocado no entra", async () => {
  const r = await llamar("/api/codigo", { metodo: "POST", datos: { correo: "nadie@demo.mx" } });
  assert.equal(r.status, 404); assert.equal(r.j.codigo, "no_encontrado");
  await llamar("/api/registro", { metodo: "POST", datos: { nombre: "Pepe", correo: "pepe@demo.mx", whatsapp: "6140000000" } });
  const e = await llamar("/api/entrar", { metodo: "POST", datos: { correo: "pepe@demo.mx", codigo: "000000" } });
  assert.equal(e.status, 400);
});

test("Mercado Pago: aviso con firma prende el acceso, no duplica y rechaza firma falsa", async () => {
  env.MP_ACCESS_TOKEN = "TEST-token";
  env.MP_WEBHOOK_SECRET = "secreto";
  const c = await entrar("ana@demo.mx", { nombre: "Ana", whatsapp: "6141112233" });

  // MP simulado
  const llamadas = [];
  globalThis.fetch = async (url, opts = {}) => {
    llamadas.push(`${opts.method || "GET"} ${url}`);
    const u = String(url);
    if (u.endsWith("/preapproval") && opts.method === "POST") {
      const b = JSON.parse(opts.body);
      assert.equal(b.auto_recurring.transaction_amount, 899);
      assert.equal(b.external_reference, "alumno:1:vip");
      return Response.json({ id: "pre123", status: "pending", init_point: "https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=pre123" });
    }
    if (u.endsWith("/preapproval/pre123")) return Response.json({ id: "pre123", status: "authorized", external_reference: "alumno:1:vip" });
    if (u.endsWith("/authorized_payments/777")) return Response.json({ id: 777, preapproval_id: "pre123", status: "processed", transaction_amount: 899, payment: { id: 1, status: "approved" } });
    return Response.json({}, { status: 404 });
  };

  const s = await llamar("/api/pago/suscribir", { metodo: "POST", cookie: c, datos: { plan: "vip" } });
  assert.ok(s.j.liga.includes("pre123"));

  const firmar = async (id, ts = "1700000000", req = "req-1") => ({ "x-signature": `ts=${ts},v1=${await hmacHex("secreto", `id:${id};request-id:${req};ts:${ts};`)}`, "x-request-id": req });

  const falsa = await llamar("/api/mp/aviso?type=subscription_authorized_payment&data.id=777", { metodo: "POST", datos: { type: "subscription_authorized_payment", data: { id: "777" } }, headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "x" } });
  assert.equal(falsa.status, 401);

  for (let i = 0; i < 2; i++) {
    const ok = await llamar("/api/mp/aviso?type=subscription_authorized_payment&data.id=777", { metodo: "POST", datos: { type: "subscription_authorized_payment", data: { id: "777" } }, headers: await firmar("777") });
    assert.equal(ok.status, 200);
  }
  const yo = await llamar("/api/yo", { cookie: c });
  assert.equal(yo.j.acceso.estado, "al_corriente");
  assert.equal(yo.j.plan, "vip");
  assert.equal(yo.j.suscripcion, "authorized");
  assert.equal(yo.j.acceso.hasta, sumarMeses(hoyLocal(), 1), "el aviso repetido no suma otro mes");

  // Cancelación: conserva el mes pagado.
  globalThis.fetch = async (url, opts = {}) => Response.json({ id: "pre123", status: "cancelled" });
  const can = await llamar("/api/pago/cancelar", { metodo: "POST", cookie: c });
  assert.equal(can.status, 200);
  const yo2 = await llamar("/api/yo", { cookie: c });
  assert.equal(yo2.j.acceso.ok, true);
  assert.equal(yo2.j.suscripcion, "cancelled");
});

test("sin precio o sin Mercado Pago no deja pagar en línea", async () => {
  const c = await entrar("ana@demo.mx", { nombre: "Ana", whatsapp: "6141112233" });
  const r = await llamar("/api/pago/suscribir", { metodo: "POST", cookie: c, datos: { plan: "normal" } });
  assert.equal(r.status, 503); assert.equal(r.j.codigo, "sin_mp");
});

test("vencido después de la gracia pierde acceso", async () => {
  const c = await entrar("carla@demo.mx", { nombre: "Carla", whatsapp: "6143334455" });
  env.DB._db.prepare("UPDATE alumnos SET acceso_hasta = ? WHERE correo = 'carla@demo.mx'").run(sumarDias(hoyLocal(), -5));
  const yo = await llamar("/api/yo", { cookie: c });
  assert.equal(yo.j.acceso.estado, "vencido");
  env.DB._db.prepare("UPDATE alumnos SET acceso_hasta = ? WHERE correo = 'carla@demo.mx'").run(sumarDias(hoyLocal(), -2));
  assert.equal((await llamar("/api/yo", { cookie: c })).j.acceso.estado, "gracia");
});

test("panel: crea módulo, video con liga de Vimeo y lección", async () => {
  const admin = await entrar("diego@demo.mx");
  assert.equal((await llamar("/api/admin/modulos", { metodo: "POST", cookie: admin, datos: { titulo: "Módulo 2", plan_min: "normal", orden: 3 } })).status, 200);
  const v = await llamar("/api/admin/videos", { metodo: "POST", cookie: admin, datos: { modulo_id: 3, titulo: "Clase 3", liga: "https://vimeo.com/123456789/abcdef1234" } });
  assert.equal(v.status, 200, JSON.stringify(v.j));
  const malo = await llamar("/api/admin/videos", { metodo: "POST", cookie: admin, datos: { modulo_id: 3, titulo: "X", liga: "https://youtube.com/watch?v=1" } });
  assert.equal(malo.status, 400);
  const cont = await llamar("/api/admin/contenido", { cookie: admin });
  const m = cont.j.modulos.find((x) => x.titulo === "Módulo 2");
  assert.equal(m.videos[0].vimeo_id, "123456789");
  assert.equal(m.videos[0].vimeo_h, "abcdef1234");
});
