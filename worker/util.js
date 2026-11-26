// Respuestas, validaciones y fechas compartidas.

export const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });

/** Error con mensaje que sí se le puede mostrar a la persona. */
export class Publico extends Error {
  constructor(mensaje, status = 400, codigo = null) { super(mensaje); this.status = status; this.codigo = codigo; }
}

export async function leerJson(request, max = 20_000) {
  if (Number(request.headers.get("Content-Length") || 0) > max) throw new Publico("Datos demasiado grandes.");
  try { return await request.json(); } catch { throw new Publico("Datos inválidos."); }
}

export const limpiar = (v, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function correoValido(v) {
  const c = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) && c.length <= 120 ? c : null;
}

/** WhatsApp de México: deja 10 dígitos (quita 52 / 521 de enfrente). */
export function whatsapp(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  return d.length === 10 ? d : null;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha = async (t) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
export const aleatorio = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();

export async function hmacHex(secreto, texto) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
}

/** Fecha local de Chihuahua (UTC-6 fijo) como YYYY-MM-DD. */
export function hoyLocal(ms = Date.now()) {
  return new Date(ms - 6 * 3600e3).toISOString().slice(0, 10);
}

export function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Suma meses respetando fin de mes (31 ene + 1 mes = 28/29 feb). */
export function sumarMeses(fecha, n) {
  const [y, m, d] = fecha.split("-").map(Number);
  const destino = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0, 12)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimo));
  return destino.toISOString().slice(0, 10);
}

export const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

export const lista = (v) => String(v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
