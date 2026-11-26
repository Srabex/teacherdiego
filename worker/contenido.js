// Lo que ve el alumno: catálogo por módulos, videos (Vimeo) y lecciones con ejercicios.
// Solo se manda el id del video o el texto de la lección si tiene acceso y su plan lo incluye.
import { json, Publico, leerJson, iso } from "./util.js";
import { puedeVer } from "./db.js";
import { publicoYo } from "./auth.js";
import { precioDe } from "./mp.js";
import { parsear, sinRespuestas, calificar, limpiarDatos } from "../public/s/formato.js";

const permiso = (r, planMin) => r.acceso.ok && puedeVer(r.plan, planMin);

export async function rutasAlumno(request, env, url, r) {
  const { pathname } = url;
  const m = request.method;

  if (pathname === "/api/yo" && m === "GET") {
    return json({
      ...publicoYo(r),
      precios: { normal: precioDe(env, "normal"), vip: precioDe(env, "vip") },
      whatsapp: env.WHATSAPP || "",
      pago_en_linea: !!env.MP_ACCESS_TOKEN,
    });
  }

  if (pathname === "/api/catalogo" && m === "GET") {
    const [mods, vids, lecs, resp] = await Promise.all([
      env.DB.prepare("SELECT id, titulo, descripcion, nivel, plan_min FROM modulos WHERE publicado = 1 ORDER BY orden, id").all(),
      env.DB.prepare("SELECT id, modulo_id, titulo, descripcion, minutos, plan_min FROM videos WHERE publicado = 1 ORDER BY orden, id").all(),
      env.DB.prepare("SELECT id, modulo_id, titulo, plan_min FROM lecciones WHERE publicado = 1 ORDER BY orden, id").all(),
      env.DB.prepare("SELECT leccion_id, aciertos, total FROM respuestas WHERE alumno_id = ?").bind(r.a.id).all(),
    ]);
    const hechas = new Map(resp.results.map((x) => [x.leccion_id, x]));
    const modulos = mods.results.map((mo) => {
      const planMin = mo.plan_min;
      return {
        ...mo,
        bloqueado: !permiso(r, planMin),
        videos: vids.results.filter((v) => v.modulo_id === mo.id)
          .map((v) => ({ ...v, plan_min: maxPlan(planMin, v.plan_min), bloqueado: !permiso(r, maxPlan(planMin, v.plan_min)) })),
        lecciones: lecs.results.filter((l) => l.modulo_id === mo.id)
          .map((l) => ({ ...l, plan_min: maxPlan(planMin, l.plan_min), bloqueado: !permiso(r, maxPlan(planMin, l.plan_min)), avance: hechas.get(l.id) || null })),
      };
    });
    return json({ modulos });
  }

  let mm;
  if ((mm = /^\/api\/video\/(\d+)$/.exec(pathname)) && m === "GET") {
    const v = await env.DB.prepare("SELECT v.*, mo.plan_min AS plan_mod FROM videos v JOIN modulos mo ON mo.id = v.modulo_id WHERE v.id = ? AND v.publicado = 1").bind(mm[1]).first();
    if (!v) throw new Publico("Ese video no existe.", 404);
    if (!permiso(r, maxPlan(v.plan_mod, v.plan_min))) throw new Publico(r.acceso.ok ? "Este video es parte de la membresía VIP." : "Activa tu membresía para ver este video.", 403, r.acceso.ok ? "solo_vip" : "sin_acceso");
    return json({ id: v.id, titulo: v.titulo, descripcion: v.descripcion, vimeo_id: v.vimeo_id, vimeo_h: v.vimeo_h || "" });
  }

  if ((mm = /^\/api\/leccion\/(\d+)$/.exec(pathname)) && m === "GET") {
    const l = await leccionPermitida(env, r, mm[1]);
    const guardado = await env.DB.prepare("SELECT datos, aciertos, total, actualizado FROM respuestas WHERE alumno_id = ? AND leccion_id = ?").bind(r.a.id, l.id).first();
    const bloques = parsear(l.texto);
    const datos = guardado ? JSON.parse(guardado.datos) : {};
    return json({
      id: l.id,
      titulo: l.titulo,
      bloques: sinRespuestas(bloques),
      datos,
      resultado: guardado ? calificar(bloques, datos) : null,
      marca: `${r.a.correo} · ${new Date().toISOString().slice(0, 10)}`,
    });
  }

  if ((mm = /^\/api\/leccion\/(\d+)\/respuestas$/.exec(pathname)) && m === "POST") {
    const l = await leccionPermitida(env, r, mm[1]);
    const b = await leerJson(request, 60_000);
    const bloques = parsear(l.texto);
    const datos = limpiarDatos(bloques, b.datos);
    const res = calificar(bloques, datos);
    await env.DB.prepare(
      `INSERT INTO respuestas (alumno_id, leccion_id, datos, aciertos, total, actualizado) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(alumno_id, leccion_id) DO UPDATE SET datos = ?3, aciertos = ?4, total = ?5, actualizado = ?6`,
    ).bind(r.a.id, l.id, JSON.stringify(datos), res.aciertos, res.total, iso()).run();
    return json({ ok: true, resultado: res });
  }

  return null;
}

const maxPlan = (a, b) => (a === "vip" || b === "vip" ? "vip" : "normal");

async function leccionPermitida(env, r, id) {
  const l = await env.DB.prepare("SELECT l.*, mo.plan_min AS plan_mod FROM lecciones l JOIN modulos mo ON mo.id = l.modulo_id WHERE l.id = ? AND l.publicado = 1").bind(id).first();
  if (!l) throw new Publico("Esa lección no existe.", 404);
  if (!permiso(r, maxPlan(l.plan_mod, l.plan_min))) throw new Publico(r.acceso.ok ? "Esta lección es parte de la membresía VIP." : "Activa tu membresía para ver esta lección.", 403, r.acceso.ok ? "solo_vip" : "sin_acceso");
  return l;
}

/** Saca id y hash de una liga de Vimeo (vimeo.com/123/abc, player.vimeo.com/video/123?h=abc, /manage/videos/123/abc). */
export function vimeoDeLiga(liga) {
  const s = String(liga ?? "").trim();
  if (/^\d{6,12}$/.test(s)) return { id: s, h: "" };
  let m = /player\.vimeo\.com\/video\/(\d+)(?:\?[^#]*\bh=([a-f0-9]+))?/i.exec(s);
  if (m) return { id: m[1], h: m[2] || "" };
  m = /vimeo\.com\/(?:manage\/videos\/|video\/)?(\d+)(?:\/([a-f0-9]{6,}))?/i.exec(s);
  if (m) return { id: m[1], h: m[2] || (/[?&]h=([a-f0-9]+)/i.exec(s)?.[1] ?? "") };
  return null;
}
