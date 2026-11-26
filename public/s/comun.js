// Ayudas compartidas del front (sin dependencias).

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function api(ruta, { metodo = "GET", datos } = {}) {
  const res = await fetch(ruta, {
    method: metodo,
    headers: datos ? { "Content-Type": "application/json" } : {},
    body: datos ? JSON.stringify(datos) : undefined,
    credentials: "same-origin",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.error || "No se pudo completar. Intenta de nuevo.");
    e.codigo = j.codigo; e.status = res.status;
    throw e;
  }
  return j;
}

let t;
export function aviso(texto, ms = 3200) {
  let el = $(".aviso");
  if (!el) { el = document.createElement("div"); el.className = "aviso"; el.setAttribute("role", "status"); document.body.append(el); }
  el.textContent = texto; el.hidden = false;
  clearTimeout(t); t = setTimeout(() => { el.hidden = true; }, ms);
}

export const pesos = (n) => (Number(n) ? `$${Number(n).toLocaleString("es-MX")}` : "$—");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fechaCorta(f) {
  if (!f) return "—";
  const [y, m, d] = String(f).slice(0, 10).split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}

/** Liga de WhatsApp con el origen del mensaje (modelo Luigi's Clean). */
export function ligaWA(numero, msg) {
  const ref = new URLSearchParams(location.search).get("utm_source");
  const base = ref ? `Hola Teacher Diego, vi tu anuncio y vengo de ${location.hostname}.` : `Hola Teacher Diego, vengo de ${location.hostname}.`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(`${base} ${msg || ""}`.trim())}`;
}

/** Marca de agua en mosaico con el correo del alumno (fondo SVG). */
export function marcaDeAgua(texto) {
  const t = esc(texto);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="20" y="120" transform="rotate(-24 180 100)" font-family="Poppins, sans-serif" font-size="15" font-weight="600" fill="#13233F">${t}</text></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="4" width="52" height="56" rx="8" fill="#13233F"/><rect x="6" y="4" width="9" height="56" rx="4" fill="#2148A0"/><path d="M40 4h11v20l-5.5-4.5L40 24z" fill="#C8102E"/><text x="36" y="47" text-anchor="middle" font-family="Lora, Georgia, serif" font-weight="700" font-size="25" fill="#F6F2EA" letter-spacing="-1">TD</text><rect x="22" y="51" width="28" height="2" rx="1" fill="#C8102E"/></svg>`;
