// Entrar con código de 6 dígitos por correo (Resend) y sesión en cookie (en la base solo el hash).
// Una sola sesión activa por alumno: al entrar en otro dispositivo se cierra la anterior (frena cuentas prestadas).
import { json, Publico, leerJson, limpiar, correoValido, whatsapp, esc, sha, aleatorio, iso, hoyLocal, lista } from "./util.js";
import { accesoDe, gracia } from "./db.js";

const COOKIE = "td_sesion";
const DIAS_SESION = 30;
const MINUTOS_CODIGO = 15;
const MAX_INTENTOS = 5;
const MAX_CODIGOS_HORA = 5;

export const esAdmin = (env, correo) => lista(env.ADMIN_EMAILS).includes(String(correo || "").toLowerCase());

function leerCookie(request) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`).exec(request.headers.get("Cookie") || "");
  return m ? m[1] : null;
}
function conCookie(resp, valor, maxAge) {
  resp.headers.append("Set-Cookie", `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
  return resp;
}

export async function buscarPorCorreo(env, correo) {
  return env.DB.prepare("SELECT * FROM alumnos WHERE correo = ? COLLATE NOCASE").bind(correo).first();
}

/** Alumno de la sesión (o null). Incluye su acceso calculado y si es admin. */
export async function sesionActual(env, request) {
  const t = leerCookie(request);
  if (!t) return null;
  const s = await env.DB.prepare("SELECT alumno_id FROM sesiones WHERE token_hash = ? AND expira > ?").bind(await sha(t), iso()).first();
  if (!s) return null;
  const a = await env.DB.prepare("SELECT * FROM alumnos WHERE id = ?").bind(s.alumno_id).first();
  if (!a) return null;
  return yo(env, a);
}

export function yo(env, a) {
  const admin = esAdmin(env, a.correo);
  const acceso = admin ? { ok: true, estado: "cortesia" } : accesoDe(a, hoyLocal(), gracia(env));
  return { a, admin, acceso, plan: admin ? "vip" : a.plan };
}

export const publicoYo = (r) => ({
  nombre: String(r.a.nombre || "").split(" ")[0],
  correo: r.a.correo,
  plan: r.plan,
  admin: r.admin,
  acceso: r.acceso,
  suscripcion: r.a.mp_estado || null,
});

async function enviarCodigo(env, correo, nombre, codigo) {
  if (!env.RESEND_API_KEY) throw new Publico("El acceso por correo todavía no está listo. Escríbenos por WhatsApp.", 503, "sin_correo");
  const n = esc(String(nombre || "").split(" ")[0]);
  const html = `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;color:#14254A">
    <h2 style="color:#14254A;margin:0 0 4px">Teacher Diego</h2>
    <p style="margin:0 0 16px;color:#C8102E;font-size:13px;letter-spacing:2px">EL MANUAL</p>
    <p>Hi ${n}! Este es tu código para entrar:</p>
    <p style="font-size:34px;letter-spacing:8px;font-weight:bold;color:#1F4FA8;margin:18px 0">${codigo}</p>
    <p>Vence en ${MINUTOS_CODIGO} minutos. Si tú no lo pediste, ignora este correo.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.REMITENTE || "Teacher Diego <teacherdiego@asesorsebas.com>",
      to: [correo],
      subject: `${codigo} es tu código de Teacher Diego`,
      html,
      text: `Hi ${String(nombre || "").split(" ")[0]}! Tu código para entrar a Teacher Diego es ${codigo}. Vence en ${MINUTOS_CODIGO} minutos.`,
    }),
  });
  if (!res.ok) {
    console.error("resend", res.status, await res.text().catch(() => ""));
    throw new Publico("No pudimos mandar el correo. Intenta de nuevo en un momento.", 502);
  }
}

async function mandarCodigo(env, url, correo, nombre) {
  const hace1h = iso(-3600e3);
  const previo = await env.DB.prepare("SELECT enviados, ventana FROM codigos WHERE correo = ?").bind(correo).first();
  if (previo && previo.ventana > hace1h && previo.enviados >= MAX_CODIGOS_HORA) {
    throw new Publico("Ya te mandamos varios códigos. Revisa tu correo (también en spam) o espera un rato.", 429, "muchos");
  }
  const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, "0");
  await env.DB.prepare(
    `INSERT INTO codigos (correo, codigo_hash, expira, intentos, enviados, ventana) VALUES (?1, ?2, ?3, 0, 1, ?4)
     ON CONFLICT(correo) DO UPDATE SET codigo_hash = ?2, expira = ?3, intentos = 0,
       enviados = CASE WHEN codigos.ventana > ?5 THEN codigos.enviados + 1 ELSE 1 END,
       ventana = CASE WHEN codigos.ventana > ?5 THEN codigos.ventana ELSE ?4 END`,
  ).bind(correo, await sha(`${correo}:${codigo}`), iso(MINUTOS_CODIGO * 60e3), iso(), hace1h).run();
  // En local (herramientas/dev.mjs) sin Resend el código se devuelve para poder probar.
  const dev = env.DEV_LOCAL === "1" && url.hostname === "localhost" && !env.RESEND_API_KEY;
  if (!dev) await enviarCodigo(env, correo, nombre, codigo);
  return json({ ok: true, minutos: MINUTOS_CODIGO, ...(dev ? { dev_codigo: codigo } : {}) });
}

export async function rutasAuth(request, env, url) {
  const { pathname } = url;
  const m = request.method;

  // Pedir código: si el correo no existe, el front muestra el registro.
  if (pathname === "/api/codigo" && m === "POST") {
    const b = await leerJson(request, 2000);
    const correo = correoValido(b.correo);
    if (!correo) throw new Publico("Escribe tu correo.");
    let a = await buscarPorCorreo(env, correo);
    if (!a && esAdmin(env, correo)) {
      await env.DB.prepare("INSERT INTO alumnos (nombre, correo, plan, cortesia, creado) VALUES (?, ?, 'vip', 1, ?)").bind("Admin", correo, iso()).run();
      a = await buscarPorCorreo(env, correo);
    }
    if (!a) throw new Publico("Todavía no tienes cuenta. Regístrate en un minuto.", 404, "no_encontrado");
    return mandarCodigo(env, url, correo, a.nombre);
  }

  // Registro: nombre, correo y WhatsApp. Queda sin acceso hasta que pague (o Diego le dé cortesía).
  if (pathname === "/api/registro" && m === "POST") {
    const b = await leerJson(request, 2000);
    const nombre = limpiar(b.nombre, 80);
    const correo = correoValido(b.correo);
    const wa = whatsapp(b.whatsapp);
    if (nombre.length < 2) throw new Publico("Escribe tu nombre.");
    if (!correo) throw new Publico("Revisa tu correo.");
    if (!wa) throw new Publico("Escribe tu WhatsApp a 10 dígitos.");
    const existe = await buscarPorCorreo(env, correo);
    if (!existe) {
      await env.DB.prepare("INSERT INTO alumnos (nombre, correo, whatsapp, plan, creado) VALUES (?, ?, ?, 'normal', ?)")
        .bind(nombre, correo, wa, iso()).run();
    }
    return mandarCodigo(env, url, correo, existe?.nombre || nombre);
  }

  if (pathname === "/api/entrar" && m === "POST") {
    const b = await leerJson(request, 2000);
    const correo = correoValido(b.correo);
    const codigo = String(b.codigo ?? "").replace(/\D/g, "");
    if (!correo || codigo.length !== 6) throw new Publico("Escribe el código de 6 números que te llegó.");
    const c = await env.DB.prepare("SELECT * FROM codigos WHERE correo = ?").bind(correo).first();
    if (!c || c.expira < iso() || c.intentos >= MAX_INTENTOS) throw new Publico("Ese código ya no sirve. Pide uno nuevo.", 400, "vencido");
    if (c.codigo_hash !== await sha(`${correo}:${codigo}`)) {
      await env.DB.prepare("UPDATE codigos SET intentos = intentos + 1 WHERE correo = ?").bind(correo).run();
      const agotado = c.intentos + 1 >= MAX_INTENTOS;
      throw new Publico(agotado ? "Demasiados intentos. Pide un código nuevo." : "Ese código no coincide. Revísalo.", 400, agotado ? "vencido" : "incorrecto");
    }
    const a = await buscarPorCorreo(env, correo);
    if (!a) throw new Publico("No encontramos ese correo.", 404, "no_encontrado");
    const t = aleatorio(32);
    const admin = esAdmin(env, correo);
    const dispositivo = limpiar(request.headers.get("User-Agent"), 160);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM codigos WHERE correo = ?").bind(correo),
      env.DB.prepare("DELETE FROM sesiones WHERE expira < ?").bind(iso()),
      // Alumnos: una sola sesión. Admins (Diego, Sebas) pueden tener celular y compu a la vez.
      ...(admin ? [] : [env.DB.prepare("DELETE FROM sesiones WHERE alumno_id = ?").bind(a.id)]),
      env.DB.prepare("INSERT INTO sesiones (token_hash, alumno_id, expira, creado, dispositivo) VALUES (?, ?, ?, ?, ?)")
        .bind(await sha(t), a.id, iso(DIAS_SESION * 864e5), iso(), dispositivo),
      env.DB.prepare("UPDATE alumnos SET ultimo_acceso = ? WHERE id = ?").bind(iso(), a.id),
    ]);
    return conCookie(json(publicoYo(yo(env, a))), t, DIAS_SESION * 86400);
  }

  if (pathname === "/api/salir" && m === "POST") {
    const t = leerCookie(request);
    if (t) await env.DB.prepare("DELETE FROM sesiones WHERE token_hash = ?").bind(await sha(t)).run();
    return conCookie(json({ ok: true }), "", 0);
  }

  return null;
}
