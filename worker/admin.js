// Panel de Diego (/admin): alumnos y su acceso, contenido (módulos, videos, lecciones), pagos y avisos de Mercado Pago.
// Solo correos de ADMIN_EMAILS (entran con el mismo código por correo).
import { json, Publico, leerJson, limpiar, correoValido, whatsapp, iso, hoyLocal, esFecha } from "./util.js";
import { accesoDe, gracia, PLANES } from "./db.js";
import { esAdmin } from "./auth.js";
import { revisarAlumno, registrarPago } from "./mp.js";
import { vimeoDeLiga } from "./contenido.js";
import { crearSubida, estadoVideo, borrarVideo, streamListo } from "./stream.js";
import { parsear } from "../public/s/formato.js";

const plan = (v) => (PLANES.includes(v) ? v : "normal");
const bit = (v) => (v ? 1 : 0);
const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : def);

export async function rutasAdmin(request, env, url, r) {
  if (!r.admin) throw new Publico("Esta sección es solo para el administrador.", 403, "no_admin");
  const { pathname } = url;
  const m = request.method;
  const hoy = hoyLocal();
  let mm;

  // ---------- Alumnos ----------
  if (pathname === "/api/admin/alumnos" && m === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM pagos p WHERE p.alumno_id = a.id) AS pagos,
              (SELECT COUNT(*) FROM respuestas x WHERE x.alumno_id = a.id) AS lecciones_hechas
       FROM alumnos a ORDER BY a.baja, a.nombre COLLATE NOCASE`,
    ).all();
    const alumnos = results
      .filter((a) => !esAdmin(env, a.correo))
      .map((a) => ({ ...a, acceso: accesoDe(a, hoy, gracia(env)) }));
    const cuenta = (e) => alumnos.filter((a) => a.acceso.estado === e).length;
    return json({
      alumnos,
      resumen: {
        total: alumnos.length,
        con_acceso: alumnos.filter((a) => a.acceso.ok).length,
        al_corriente: cuenta("al_corriente"), gracia: cuenta("gracia"), cortesia: cuenta("cortesia"),
        vencido: cuenta("vencido"), sin_pago: cuenta("sin_pago"),
        vip: alumnos.filter((a) => a.acceso.ok && a.plan === "vip").length,
      },
      hoy,
    });
  }

  if (pathname === "/api/admin/alumnos" && m === "POST") {
    const b = await leerJson(request);
    const nombre = limpiar(b.nombre, 80);
    const correo = correoValido(b.correo);
    if (nombre.length < 2 || !correo) throw new Publico("Nombre y correo son obligatorios.");
    const existe = await env.DB.prepare("SELECT id FROM alumnos WHERE correo = ? COLLATE NOCASE").bind(correo).first();
    if (existe) throw new Publico("Ya hay un alumno con ese correo.", 409, "duplicado");
    await env.DB.prepare("INSERT INTO alumnos (nombre, correo, whatsapp, plan, cortesia, notas, creado) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(nombre, correo, whatsapp(b.whatsapp), plan(b.plan), bit(b.cortesia), limpiar(b.notas, 1000) || null, iso()).run();
    return json({ ok: true });
  }

  if ((mm = /^\/api\/admin\/alumnos\/(\d+)$/.exec(pathname)) && m === "PUT") {
    const b = await leerJson(request);
    const nombre = limpiar(b.nombre, 80);
    if (nombre.length < 2) throw new Publico("Escribe el nombre.");
    if (b.acceso_hasta && !esFecha(b.acceso_hasta)) throw new Publico("Revisa la fecha de acceso.");
    await env.DB.prepare("UPDATE alumnos SET nombre = ?, whatsapp = ?, plan = ?, cortesia = ?, acceso_hasta = ?, notas = ?, baja = ? WHERE id = ?")
      .bind(nombre, whatsapp(b.whatsapp), plan(b.plan), bit(b.cortesia), b.acceso_hasta || null, limpiar(b.notas, 1000) || null, bit(b.baja), mm[1]).run();
    if (b.baja) await env.DB.prepare("DELETE FROM sesiones WHERE alumno_id = ?").bind(mm[1]).run();
    return json({ ok: true });
  }

  if ((mm = /^\/api\/admin\/alumnos\/(\d+)\/revisar$/.exec(pathname)) && m === "POST") {
    const a = await alumno(env, mm[1]);
    return json(await revisarAlumno(env, a));
  }

  // Pago fuera de Mercado Pago (efectivo o transferencia): suma un mes de acceso.
  if ((mm = /^\/api\/admin\/alumnos\/(\d+)\/pago$/.exec(pathname)) && m === "POST") {
    const a = await alumno(env, mm[1]);
    const b = await leerJson(request);
    const monto = Number(b.monto) || null;
    await registrarPago(env, a.id, `manual:${Date.now()}`, monto, iso());
    await env.DB.prepare("UPDATE pagos SET detalle = ? WHERE mp_id LIKE 'manual:%' AND alumno_id = ? AND detalle IS NULL")
      .bind(limpiar(b.metodo, 40) || "manual", a.id).run();
    return json({ ok: true });
  }

  if ((mm = /^\/api\/admin\/alumnos\/(\d+)\/cerrar-sesion$/.exec(pathname)) && m === "POST") {
    await env.DB.prepare("DELETE FROM sesiones WHERE alumno_id = ?").bind(mm[1]).run();
    return json({ ok: true });
  }

  if ((mm = /^\/api\/admin\/alumnos\/(\d+)\/detalle$/.exec(pathname)) && m === "GET") {
    const a = await alumno(env, mm[1]);
    const [pagos, resp, ses] = await Promise.all([
      env.DB.prepare("SELECT * FROM pagos WHERE alumno_id = ? ORDER BY fecha DESC LIMIT 24").bind(a.id).all(),
      env.DB.prepare("SELECT r.leccion_id, r.aciertos, r.total, r.actualizado, l.titulo FROM respuestas r JOIN lecciones l ON l.id = r.leccion_id WHERE r.alumno_id = ? ORDER BY r.actualizado DESC").bind(a.id).all(),
      env.DB.prepare("SELECT creado, dispositivo FROM sesiones WHERE alumno_id = ? AND expira > ?").bind(a.id, iso()).all(),
    ]);
    return json({ alumno: { ...a, acceso: accesoDe(a, hoy, gracia(env)) }, pagos: pagos.results, lecciones: resp.results, sesiones: ses.results });
  }

  // ---------- Contenido ----------
  if (pathname === "/api/admin/contenido" && m === "GET") {
    const [mods, vids, lecs] = await Promise.all([
      env.DB.prepare("SELECT * FROM modulos ORDER BY orden, id").all(),
      env.DB.prepare("SELECT * FROM videos ORDER BY orden, id").all(),
      env.DB.prepare("SELECT id, modulo_id, titulo, plan_min, orden, publicado, actualizado FROM lecciones ORDER BY orden, id").all(),
    ]);
    return json({
      stream_listo: streamListo(env),
      modulos: mods.results.map((mo) => ({
        ...mo,
        videos: vids.results.filter((v) => v.modulo_id === mo.id),
        lecciones: lecs.results.filter((l) => l.modulo_id === mo.id),
      })),
    });
  }

  if ((pathname === "/api/admin/modulos" && m === "POST") || ((mm = /^\/api\/admin\/modulos\/(\d+)$/.exec(pathname)) && m === "PUT")) {
    const b = await leerJson(request);
    const titulo = limpiar(b.titulo, 120);
    if (!titulo) throw new Publico("Escribe el título del módulo.");
    const vals = [titulo, limpiar(b.descripcion, 400) || null, limpiar(b.nivel, 40) || null, plan(b.plan_min), num(b.orden), bit(b.publicado ?? 1)];
    if (m === "POST") await env.DB.prepare("INSERT INTO modulos (titulo, descripcion, nivel, plan_min, orden, publicado) VALUES (?, ?, ?, ?, ?, ?)").bind(...vals).run();
    else await env.DB.prepare("UPDATE modulos SET titulo = ?, descripcion = ?, nivel = ?, plan_min = ?, orden = ?, publicado = ? WHERE id = ?").bind(...vals, mm[1]).run();
    return json({ ok: true });
  }
  if ((mm = /^\/api\/admin\/modulos\/(\d+)$/.exec(pathname)) && m === "DELETE") {
    const n = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM videos WHERE modulo_id = ?1) + (SELECT COUNT(*) FROM lecciones WHERE modulo_id = ?1) AS n").bind(mm[1]).first();
    if (n?.n) throw new Publico("Primero mueve o borra los videos y lecciones de este módulo.");
    await env.DB.prepare("DELETE FROM modulos WHERE id = ?").bind(mm[1]).run();
    return json({ ok: true });
  }

  // Subir a Cloudflare Stream: el Worker solo prepara la subida; el archivo va del navegador directo a Stream.
  if (pathname === "/api/admin/stream/subir" && m === "POST") {
    const b = await leerJson(request);
    return json(await crearSubida(env, limpiar(b.nombre, 120), b.tamano));
  }
  // Revisa si Stream ya terminó de procesar (y guarda la duración).
  if ((mm = /^\/api\/admin\/videos\/(\d+)\/estado$/.exec(pathname)) && m === "POST") {
    const v = await env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(mm[1]).first();
    if (!v?.stream_uid) throw new Publico("Ese video no está en Stream.", 404);
    const e = await estadoVideo(env, v.stream_uid);
    if (e.listo) await env.DB.prepare("UPDATE videos SET stream_listo = 1, minutos = COALESCE(minutos, ?) WHERE id = ?").bind(e.minutos, v.id).run();
    return json(e);
  }

  if ((pathname === "/api/admin/videos" && m === "POST") || ((mm = /^\/api\/admin\/videos\/(\d+)$/.exec(pathname)) && m === "PUT")) {
    const b = await leerJson(request);
    const titulo = limpiar(b.titulo, 160);
    if (!titulo) throw new Publico("Escribe el título del video.");
    const previo = mm ? await env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(mm[1]).first() : null;
    const uid = /^[a-f0-9]{32}$/i.test(String(b.stream_uid || "")) ? String(b.stream_uid) : previo?.stream_uid || null;
    const v = uid ? null : vimeoDeLiga(b.liga);
    if (!uid && !v) throw new Publico("Sube el archivo del video (o pega una liga de Vimeo).");
    const listo = uid ? (uid === previo?.stream_uid ? previo.stream_listo : 0) : 0;
    const vals = [num(b.modulo_id), titulo, limpiar(b.descripcion, 600) || null, v?.id || "", v?.h || null, uid, listo, num(b.minutos) || null, plan(b.plan_min), num(b.orden), bit(b.publicado ?? 1)];
    if (m === "POST") await env.DB.prepare("INSERT INTO videos (modulo_id, titulo, descripcion, vimeo_id, vimeo_h, stream_uid, stream_listo, minutos, plan_min, orden, publicado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(...vals).run();
    else await env.DB.prepare("UPDATE videos SET modulo_id = ?, titulo = ?, descripcion = ?, vimeo_id = ?, vimeo_h = ?, stream_uid = ?, stream_listo = ?, minutos = ?, plan_min = ?, orden = ?, publicado = ? WHERE id = ?").bind(...vals, mm[1]).run();
    // Si se reemplazó el archivo, el viejo se borra de Stream (para no pagar por guardarlo).
    if (previo?.stream_uid && previo.stream_uid !== uid) await borrarVideo(env, previo.stream_uid);
    return json({ ok: true });
  }
  if ((mm = /^\/api\/admin\/videos\/(\d+)$/.exec(pathname)) && m === "DELETE") {
    const v = await env.DB.prepare("SELECT stream_uid FROM videos WHERE id = ?").bind(mm[1]).first();
    await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(mm[1]).run();
    if (v?.stream_uid) await borrarVideo(env, v.stream_uid);
    return json({ ok: true });
  }

  if ((mm = /^\/api\/admin\/lecciones\/(\d+)$/.exec(pathname)) && m === "GET") {
    const l = await env.DB.prepare("SELECT * FROM lecciones WHERE id = ?").bind(mm[1]).first();
    if (!l) throw new Publico("No existe.", 404);
    return json(l);
  }
  if ((pathname === "/api/admin/lecciones" && m === "POST") || ((mm = /^\/api\/admin\/lecciones\/(\d+)$/.exec(pathname)) && m === "PUT")) {
    const b = await leerJson(request, 120_000);
    const titulo = limpiar(b.titulo, 160);
    const texto = String(b.texto ?? "").slice(0, 60_000);
    if (!titulo) throw new Publico("Escribe el título de la lección.");
    parsear(texto); // valida que se pueda leer
    const vals = [num(b.modulo_id), titulo, texto, plan(b.plan_min), num(b.orden), bit(b.publicado ?? 1), iso()];
    if (m === "POST") await env.DB.prepare("INSERT INTO lecciones (modulo_id, titulo, texto, plan_min, orden, publicado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(...vals).run();
    else await env.DB.prepare("UPDATE lecciones SET modulo_id = ?, titulo = ?, texto = ?, plan_min = ?, orden = ?, publicado = ?, actualizado = ? WHERE id = ?").bind(...vals, mm[1]).run();
    return json({ ok: true });
  }
  if ((mm = /^\/api\/admin\/lecciones\/(\d+)$/.exec(pathname)) && m === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM respuestas WHERE leccion_id = ?").bind(mm[1]),
      env.DB.prepare("DELETE FROM lecciones WHERE id = ?").bind(mm[1]),
    ]);
    return json({ ok: true });
  }

  // Respuestas de una lección (para revisar las abiertas).
  if ((mm = /^\/api\/admin\/lecciones\/(\d+)\/respuestas$/.exec(pathname)) && m === "GET") {
    const l = await env.DB.prepare("SELECT * FROM lecciones WHERE id = ?").bind(mm[1]).first();
    if (!l) throw new Publico("No existe.", 404);
    const { results } = await env.DB.prepare(
      "SELECT r.*, a.nombre, a.correo FROM respuestas r JOIN alumnos a ON a.id = r.alumno_id WHERE r.leccion_id = ? ORDER BY r.actualizado DESC",
    ).bind(l.id).all();
    return json({ leccion: { id: l.id, titulo: l.titulo }, bloques: parsear(l.texto), respuestas: results.map((x) => ({ ...x, datos: JSON.parse(x.datos) })) });
  }

  // ---------- Pagos ----------
  if (pathname === "/api/admin/pagos" && m === "GET") {
    const [pagos, avisos] = await Promise.all([
      env.DB.prepare("SELECT p.*, a.nombre FROM pagos p LEFT JOIN alumnos a ON a.id = p.alumno_id ORDER BY p.fecha DESC LIMIT 100").all(),
      env.DB.prepare("SELECT * FROM mp_avisos ORDER BY id DESC LIMIT 30").all(),
    ]);
    const mes = hoy.slice(0, 7);
    const delMes = pagos.results.filter((p) => String(p.fecha).slice(0, 7) === mes);
    return json({
      pagos: pagos.results, avisos: avisos.results,
      mes: { cobros: delMes.length, total: delMes.reduce((s, p) => s + (Number(p.monto) || 0), 0) },
      mp_listo: !!env.MP_ACCESS_TOKEN, firma_lista: !!env.MP_WEBHOOK_SECRET,
    });
  }

  throw new Publico("No encontrado.", 404);
}

async function alumno(env, id) {
  const a = await env.DB.prepare("SELECT * FROM alumnos WHERE id = ?").bind(id).first();
  if (!a) throw new Publico("Ese alumno no existe.", 404);
  return a;
}
