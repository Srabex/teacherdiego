// Cloudflare Stream: Diego sube sus videos desde el panel (subida directa por tus, sin pasar por el Worker)
// y cada reproducción lleva un permiso firmado (JWT RS256) que caduca solo. Los videos exigen ese permiso
// (requiresignedurls), así que la liga del reproductor no sirve fuera de la plataforma ni después de unas horas.
// Configuración: var CF_ACCOUNT_ID (wrangler.jsonc) + Secret CF_STREAM_TOKEN (token de API con permiso Stream: Edit).
// La llave para firmar se crea sola la primera vez y queda guardada en `meta` (o se puede poner como Secret STREAM_KEY).
import { Publico } from "./util.js";

const API = "https://api.cloudflare.com/client/v4";
const HORAS_PERMISO = 4; // una clase de 1.5 h con pausas cabe de sobra
const MAX_SEGUNDOS = 4 * 3600;

export const streamListo = (env) => !!(env.CF_ACCOUNT_ID && env.CF_STREAM_TOKEN);

async function cf(env, path, opts = {}) {
  if (!streamListo(env)) throw new Publico("La subida de videos todavía no está configurada (falta CF_STREAM_TOKEN).", 503, "sin_stream");
  const res = await fetch(`${API}/accounts/${env.CF_ACCOUNT_ID}/stream${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}`, ...(opts.headers || {}) },
  });
  return res;
}

async function cfJson(env, path, opts) {
  const res = await cf(env, path, opts);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    console.error("stream", path, res.status, JSON.stringify(j.errors || j).slice(0, 400));
    throw new Publico(`Cloudflare Stream no respondió bien (${res.status}).`, 502, "stream_error");
  }
  return j.result;
}

const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlTexto = (t) => b64url(new TextEncoder().encode(t));

/** Crea la subida (protocolo tus) y regresa la URL a la que el navegador de Diego manda el archivo. */
export async function crearSubida(env, nombre, tamano) {
  const bytes = Math.trunc(Number(tamano));
  if (!(bytes > 0)) throw new Publico("Elige un archivo de video.");
  if (bytes > 30 * 1024 ** 3) throw new Publico("El video pesa más de 30 GB. Expórtalo en 1080p.");
  const res = await cf(env, "?direct_user=true", {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(bytes),
      "Upload-Metadata": `name ${b64(String(nombre || "video").slice(0, 120))},requiresignedurls,maxdurationseconds ${b64(String(MAX_SEGUNDOS))}`,
    },
  });
  const url = res.headers.get("Location");
  const uid = res.headers.get("stream-media-id");
  if (!res.ok || !url || !uid) {
    console.error("stream subida", res.status, await res.text().catch(() => ""));
    throw new Publico("No se pudo preparar la subida. Revisa que Stream esté activo en Cloudflare.", 502, "stream_error");
  }
  return { url, uid };
}

/** Estado del video en Stream: listo para verse y duración en minutos. */
export async function estadoVideo(env, uid) {
  const r = await cfJson(env, `/${encodeURIComponent(uid)}`);
  return {
    listo: !!r.readyToStream,
    estado: r.status?.state || null,
    avance: r.status?.pctComplete ? Number(r.status.pctComplete) : null,
    minutos: r.duration > 0 ? Math.round(r.duration / 60) : null,
    error: r.status?.errorReasonText || null,
  };
}

export async function borrarVideo(env, uid) {
  if (!uid || !streamListo(env)) return;
  const res = await cf(env, `/${encodeURIComponent(uid)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) console.error("stream borrar", uid, res.status);
}

/** Llave para firmar: Secret STREAM_KEY ({"id","jwk"}) o la que se crea y guarda sola en `meta`. */
async function llave(env) {
  if (env.STREAM_KEY) return JSON.parse(env.STREAM_KEY);
  const g = await env.DB.prepare("SELECT valor FROM meta WHERE clave = 'stream_llave'").first();
  if (g?.valor) return JSON.parse(g.valor);
  const r = await cfJson(env, "/keys", { method: "POST" });
  const jwkTexto = String(r.jwk || "");
  const jwk = JSON.parse(jwkTexto.trim().startsWith("{") ? jwkTexto : atob(jwkTexto));
  const k = { id: r.id, jwk };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (clave, valor) VALUES ('stream_llave', ?)").bind(JSON.stringify(k)).run();
  return k;
}

/** Permiso firmado para ver un video por unas horas. */
export async function permiso(env, uid, ahora = Date.now()) {
  const k = await llave(env);
  const encabezado = { alg: "RS256", kid: k.id };
  const datos = { sub: uid, kid: k.id, exp: Math.floor(ahora / 1000) + HORAS_PERMISO * 3600, nbf: Math.floor(ahora / 1000) - 60 };
  const clave = await crypto.subtle.importKey("jwk", { ...k.jwk, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const cuerpo = `${b64urlTexto(JSON.stringify(encabezado))}.${b64urlTexto(JSON.stringify(datos))}`;
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", clave, new TextEncoder().encode(cuerpo));
  return `${cuerpo}.${b64url(firma)}`;
}

/** URL del reproductor de Stream (iframe) con el permiso firmado. */
export async function reproductor(env, uid) {
  const t = await permiso(env, uid);
  const base = env.STREAM_SUBDOMINIO ? `https://${env.STREAM_SUBDOMINIO}` : "https://iframe.videodelivery.net";
  return `${base}/${t}${env.STREAM_SUBDOMINIO ? "/iframe" : ""}?letterboxColor=transparent&primaryColor=%23C8102E`;
}
