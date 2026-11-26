// Mercado Pago: suscripción mensual domiciliada (API de Suscripciones, /preapproval).
// Flujo: el alumno elige Normal o VIP → creamos su suscripción → lo mandamos al checkout de MP (init_point) →
// MP nos avisa (webhook /api/mp/aviso) cada cambio y cada cobro → aquí se prende o se extiende el acceso.
// Si cancela o deja de pagar, el acceso dura hasta el fin del mes pagado + GRACIA_DIAS y se apaga solo.
// Secrets: MP_ACCESS_TOKEN (Access Token de producción de la app de Diego) y MP_WEBHOOK_SECRET (clave secreta de Webhooks).
import { json, Publico, leerJson, iso, hoyLocal, sumarMeses, sumarDias, hmacHex } from "./util.js";
import { PLANES, gracia } from "./db.js";

const API = "https://api.mercadopago.com";

export const precioDe = (env, plan) => Number(plan === "vip" ? env.PRECIO_VIP : env.PRECIO_NORMAL) || 0;
export const nombrePlan = (p) => (p === "vip" ? "VIP" : "Normal");

async function mp(env, path, opts = {}) {
  if (!env.MP_ACCESS_TOKEN) throw new Publico("El pago en línea todavía no está listo. Escríbenos por WhatsApp.", 503, "sin_mp");
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("mercadopago", path, res.status, JSON.stringify(datos).slice(0, 500));
    throw new Publico("Mercado Pago no respondió bien. Intenta de nuevo en un momento.", 502, "mp_error");
  }
  return datos;
}

/** external_reference = "alumno:<id>:<plan>" */
const referencia = (id, plan) => `alumno:${id}:${plan}`;
function leerReferencia(ref) {
  const m = /^alumno:(\d+):(normal|vip)$/.exec(String(ref || ""));
  return m ? { id: Number(m[1]), plan: m[2] } : null;
}

/** Crea la suscripción (o cambia el monto si ya tiene una activa) y regresa la liga de pago. */
export async function suscribir(env, r, plan, origen) {
  if (!PLANES.includes(plan)) throw new Publico("Elige Normal o VIP.");
  const monto = precioDe(env, plan);
  if (!monto) throw new Publico("Todavía no hay precio para esa membresía.", 503, "sin_precio");
  const a = r.a;

  // Ya tiene suscripción autorizada: solo se cambia el plan y el monto (el cambio aplica desde el siguiente cobro).
  if (a.mp_suscripcion && a.mp_estado === "authorized") {
    if (a.plan === plan) return { ok: true, ya: true };
    await mp(env, `/preapproval/${encodeURIComponent(a.mp_suscripcion)}`, {
      method: "PUT",
      body: JSON.stringify({
        reason: `Teacher Diego · Membresía ${nombrePlan(plan)}`,
        external_reference: referencia(a.id, plan),
        auto_recurring: { transaction_amount: monto, currency_id: "MXN" },
      }),
    });
    await env.DB.prepare("UPDATE alumnos SET plan = ? WHERE id = ?").bind(plan, a.id).run();
    return { ok: true, cambio: true };
  }

  const pre = await mp(env, "/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `Teacher Diego · Membresía ${nombrePlan(plan)}`,
      external_reference: referencia(a.id, plan),
      payer_email: a.correo,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: monto, currency_id: "MXN" },
      back_url: `${origen}/clases?pago=listo`,
      status: "pending",
    }),
  });
  await env.DB.prepare("UPDATE alumnos SET mp_suscripcion = ?, mp_estado = ? WHERE id = ?").bind(String(pre.id), pre.status || "pending", a.id).run();
  return { ok: true, liga: pre.init_point };
}

export async function cancelar(env, a) {
  if (!a.mp_suscripcion) throw new Publico("No tienes una suscripción activa.");
  await mp(env, `/preapproval/${encodeURIComponent(a.mp_suscripcion)}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
  await env.DB.prepare("UPDATE alumnos SET mp_estado = 'cancelled' WHERE id = ?").bind(a.id).run();
  return { ok: true, hasta: a.acceso_hasta };
}

async function alumnoDeSuscripcion(env, pre) {
  const ref = leerReferencia(pre.external_reference);
  return env.DB.prepare("SELECT * FROM alumnos WHERE mp_suscripcion = ? OR id = ? ORDER BY (mp_suscripcion = ?) DESC LIMIT 1")
    .bind(String(pre.id), ref?.id ?? -1, String(pre.id)).first();
}

/** Copia el estado de la suscripción de MP a la ficha del alumno. */
export async function sincronizarSuscripcion(env, pre) {
  const a = await alumnoDeSuscripcion(env, pre);
  if (!a) return "sin_alumno";
  const ref = leerReferencia(pre.external_reference);
  const plan = pre.status === "authorized" && ref ? ref.plan : a.plan;
  await env.DB.prepare("UPDATE alumnos SET mp_suscripcion = ?, mp_estado = ?, plan = ? WHERE id = ?")
    .bind(String(pre.id), pre.status || null, plan, a.id).run();
  return `alumno ${a.id}: ${pre.status}`;
}

/**
 * Registra un cobro aprobado (una sola vez por id de MP) y extiende el acceso un mes.
 * Si estaba al corriente o en gracia, el mes se suma a su fecha; si ya había vencido, cuenta desde hoy.
 */
export async function registrarPago(env, alumnoId, mpId, monto, fecha = iso()) {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO pagos (alumno_id, mp_id, monto, estado, fecha) VALUES (?, ?, ?, 'aprobado', ?)")
    .bind(alumnoId, String(mpId), monto ?? null, fecha).run();
  if (!(r?.meta?.changes ?? r?.changes)) return false;
  const a = await env.DB.prepare("SELECT acceso_hasta FROM alumnos WHERE id = ?").bind(alumnoId).first();
  const hoy = hoyLocal();
  const vigente = a?.acceso_hasta && sumarDias(a.acceso_hasta, gracia(env)) >= hoy;
  const base = vigente && a.acceso_hasta > hoy ? a.acceso_hasta : hoy;
  await env.DB.prepare("UPDATE alumnos SET acceso_hasta = ? WHERE id = ?").bind(sumarMeses(base, 1), alumnoId).run();
  return true;
}

/** Revisa en MP la suscripción y sus cobros (por si un aviso no llegó). Lo usan el regreso del checkout y el panel. */
export async function revisarAlumno(env, a) {
  if (!a.mp_suscripcion) return { ok: true, sin: true };
  const pre = await mp(env, `/preapproval/${encodeURIComponent(a.mp_suscripcion)}`);
  await sincronizarSuscripcion(env, pre);
  const lista = await mp(env, `/authorized_payments/search?preapproval_id=${encodeURIComponent(a.mp_suscripcion)}`).catch(() => ({ results: [] }));
  let nuevos = 0;
  for (const ap of lista.results || []) {
    if (ap?.payment?.status === "approved") {
      if (await registrarPago(env, a.id, `ap:${ap.id}`, ap.transaction_amount, ap.debit_date || ap.date_created || iso())) nuevos++;
    }
  }
  return { ok: true, estado: pre.status, nuevos };
}

/** Firma de Mercado Pago: x-signature "ts=…,v1=…" sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". */
export async function firmaValida(env, request, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true; // sin clave configurada no se valida (solo mientras se prueba)
  const partes = Object.fromEntries(String(request.headers.get("x-signature") || "").split(",").map((p) => p.split("=").map((x) => x.trim())));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;
  let manifiesto = "";
  if (id) manifiesto += `id:${id};`;
  const req = request.headers.get("x-request-id");
  if (req) manifiesto += `request-id:${req};`;
  manifiesto += `ts:${partes.ts};`;
  return (await hmacHex(env.MP_WEBHOOK_SECRET, manifiesto)) === partes.v1;
}

/** Webhook de MP. Siempre contesta 200 rápido (si no, MP reintenta); lo que pasó queda en mp_avisos. */
export async function avisoMP(request, env, url) {
  const cuerpo = await leerJson(request, 20_000).catch(() => ({}));
  const tipo = cuerpo.type || url.searchParams.get("type") || url.searchParams.get("topic") || "";
  const dataId = String(url.searchParams.get("data.id") || cuerpo?.data?.id || url.searchParams.get("id") || "");
  if (!(await firmaValida(env, request, dataId))) {
    await log(env, tipo, dataId, "firma inválida");
    return json({ ok: false }, 401);
  }
  let resultado = "ignorado";
  try {
    if (tipo === "subscription_preapproval" && dataId) {
      resultado = await sincronizarSuscripcion(env, await mp(env, `/preapproval/${encodeURIComponent(dataId)}`));
    } else if (tipo === "subscription_authorized_payment" && dataId) {
      const ap = await mp(env, `/authorized_payments/${encodeURIComponent(dataId)}`);
      const pre = await mp(env, `/preapproval/${encodeURIComponent(ap.preapproval_id)}`);
      await sincronizarSuscripcion(env, pre);
      const a = await alumnoDeSuscripcion(env, pre);
      if (a && ap?.payment?.status === "approved") {
        resultado = (await registrarPago(env, a.id, `ap:${ap.id}`, ap.transaction_amount, ap.debit_date || iso())) ? `pago alumno ${a.id}` : "pago repetido";
      } else resultado = `cobro ${ap?.status || "?"} / ${ap?.payment?.status || "sin pago"}`;
    }
  } catch (e) {
    resultado = `error: ${e.message}`;
  }
  await log(env, tipo, dataId, resultado);
  return json({ ok: true });
}

const log = (env, tipo, id, resultado) =>
  env.DB.prepare("INSERT INTO mp_avisos (recibido, tipo, data_id, resultado) VALUES (?, ?, ?, ?)").bind(iso(), tipo, id, String(resultado).slice(0, 300)).run().catch(() => {});

/** Rutas del alumno para pagar: /api/pago/* */
export async function rutasPago(request, env, url, r) {
  const { pathname } = url;
  const m = request.method;
  if (pathname === "/api/pago/suscribir" && m === "POST") {
    const b = await leerJson(request, 1000);
    return json(await suscribir(env, r, String(b.plan || ""), url.origin));
  }
  if (pathname === "/api/pago/revisar" && m === "POST") return json(await revisarAlumno(env, r.a));
  if (pathname === "/api/pago/cancelar" && m === "POST") return json(await cancelar(env, r.a));
  return null;
}
