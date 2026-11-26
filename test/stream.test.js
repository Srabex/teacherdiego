// Cloudflare Stream simulado: subida, procesamiento, permiso firmado y borrado.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { d1Local } from "../herramientas/d1-local.mjs";
import { _reiniciar } from "../worker/db.js";

let env, llamadas, publica, estado;
const UID = "a".repeat(32);

beforeEach(async () => {
  _reiniciar();
  llamadas = [];
  estado = { readyToStream: false, duration: -1, status: { state: "inprogress", pctComplete: "40" } };
  const par = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  publica = par.publicKey;
  const jwk = await crypto.subtle.exportKey("jwk", par.privateKey);
  env = {
    DB: d1Local(), DEV_LOCAL: "1", ADMIN_EMAILS: "diego@demo.mx", CF_ACCOUNT_ID: "cuenta", CF_STREAM_TOKEN: "tok",
    ASSETS: { fetch: async () => new Response("ok") },
  };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    llamadas.push({ m, u, h: opts.headers || {} });
    if (u.includes("/stream?direct_user=true")) return new Response(null, { status: 201, headers: { Location: "https://upload.videodelivery.net/tus/xyz", "stream-media-id": UID } });
    if (u.endsWith("/stream/keys")) return Response.json({ success: true, result: { id: "llave1", jwk: btoa(JSON.stringify(jwk)) } });
    if (u.endsWith(`/stream/${UID}`) && m === "GET") return Response.json({ success: true, result: estado });
    if (u.endsWith(`/stream/${UID}`) && m === "DELETE") return Response.json({ success: true });
    return Response.json({ success: false }, { status: 404 });
  };
});

async function llamar(ruta, { metodo = "GET", datos, cookie } = {}) {
  const res = await worker.fetch(new Request(`http://localhost${ruta}`, {
    method: metodo, headers: { ...(datos ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: datos ? JSON.stringify(datos) : undefined,
  }), env);
  const set = res.headers.get("Set-Cookie");
  return { status: res.status, j: await res.json().catch(() => null), cookie: set ? set.split(";")[0] : null };
}
async function entrar(correo, registro) {
  const r = registro ? await llamar("/api/registro", { metodo: "POST", datos: { ...registro, correo } }) : await llamar("/api/codigo", { metodo: "POST", datos: { correo } });
  return (await llamar("/api/entrar", { metodo: "POST", datos: { correo, codigo: r.j.dev_codigo } })).cookie;
}

test("Diego sube un video a Stream; aparece hasta que está listo y se ve con permiso firmado", async () => {
  const admin = await entrar("diego@demo.mx");
  const s = await llamar("/api/admin/stream/subir", { metodo: "POST", cookie: admin, datos: { nombre: "Clase 1", tamano: 900 * 1024 ** 2 } });
  assert.equal(s.status, 200, JSON.stringify(s.j));
  assert.equal(s.j.uid, UID);
  const pre = llamadas.find((c) => c.u.includes("direct_user"));
  assert.equal(pre.h["Upload-Length"], String(900 * 1024 ** 2));
  assert.ok(pre.h["Upload-Metadata"].includes("requiresignedurls"), "los videos exigen permiso firmado");

  assert.equal((await llamar("/api/admin/videos", { metodo: "POST", cookie: admin, datos: { modulo_id: 1, titulo: "Clase 1", stream_uid: UID } })).status, 200);

  // Alumno con cortesía: mientras se procesa no aparece.
  const c = await entrar("ana@demo.mx", { nombre: "Ana", whatsapp: "6141112233" });
  env.DB._db.prepare("UPDATE alumnos SET cortesia = 1 WHERE correo = 'ana@demo.mx'").run();
  let cat = await llamar("/api/catalogo", { cookie: c });
  assert.equal(cat.j.modulos[0].videos.length, 0);

  let e = await llamar("/api/admin/videos/1/estado", { metodo: "POST", cookie: admin });
  assert.equal(e.j.listo, false); assert.equal(e.j.avance, 40);

  estado = { readyToStream: true, duration: 3540, status: { state: "ready" } };
  e = await llamar("/api/admin/videos/1/estado", { metodo: "POST", cookie: admin });
  assert.equal(e.j.listo, true);
  cat = await llamar("/api/catalogo", { cookie: c });
  assert.equal(cat.j.modulos[0].videos[0].minutos, 59);

  const v = await llamar("/api/video/1", { cookie: c });
  assert.equal(v.status, 200, JSON.stringify(v.j));
  const token = /videodelivery\.net\/([^?]+)/.exec(v.j.src)[1];
  const [h, p, firma] = token.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString());
  assert.equal(dec(h).kid, "llave1");
  assert.equal(dec(p).sub, UID);
  assert.ok(dec(p).exp - Date.now() / 1000 <= 4 * 3600 + 5, "el permiso caduca en horas");
  const valida = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publica, Buffer.from(firma, "base64url"), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(valida, "firma válida");
  // La llave se crea una sola vez.
  await llamar("/api/video/1", { cookie: c });
  assert.equal(llamadas.filter((x) => x.u.endsWith("/stream/keys")).length, 1);

  // Sin acceso, no hay permiso.
  env.DB._db.prepare("UPDATE alumnos SET cortesia = 0 WHERE correo = 'ana@demo.mx'").run();
  assert.equal((await llamar("/api/video/1", { cookie: c })).status, 403);

  // Borrar también lo quita de Stream.
  assert.equal((await llamar("/api/admin/videos/1", { metodo: "DELETE", cookie: admin })).status, 200);
  assert.ok(llamadas.some((x) => x.m === "DELETE" && x.u.endsWith(`/stream/${UID}`)));
});

test("sin token de Stream el panel avisa en vez de tronar", async () => {
  delete env.CF_STREAM_TOKEN;
  const admin = await entrar("diego@demo.mx");
  const s = await llamar("/api/admin/stream/subir", { metodo: "POST", cookie: admin, datos: { nombre: "x", tamano: 10 } });
  assert.equal(s.status, 503); assert.equal(s.j.codigo, "sin_stream");
});
