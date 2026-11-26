// Servidor local: `node herramientas/dev.mjs` → http://localhost:8787
// Base en memoria con alumnos de prueba. Entra con diego@demo.mx (admin) o ana@demo.mx (VIP); el código sale en pantalla.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import worker from "../worker/index.js";
import { d1Local } from "./d1-local.mjs";
import { asegurarTablas } from "../worker/db.js";
import { hoyLocal, sumarDias } from "../worker/util.js";

const RAIZ = new URL("../public/", import.meta.url).pathname;
const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".woff": "font/woff" };

const DB = d1Local();
const ASSETS = {
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.endsWith("/")) p += "index.html";
    let f = join(RAIZ, p);
    if (!extname(f) && existsSync(`${f}.html`)) f = `${f}.html`;
    if (!f.startsWith(RAIZ) || !existsSync(f) || statSync(f).isDirectory()) {
      return new Response(readFileSync(join(RAIZ, "404.html")), { status: 404, headers: { "Content-Type": TIPOS[".html"] } });
    }
    return new Response(readFileSync(f), { headers: { "Content-Type": TIPOS[extname(f)] || "application/octet-stream" } });
  },
};
const env = {
  DB, ASSETS, DEV_LOCAL: "1", ADMIN_EMAILS: "diego@demo.mx", WHATSAPP: "526142355166",
  PRECIO_NORMAL: process.env.PRECIO_NORMAL ?? "", PRECIO_VIP: process.env.PRECIO_VIP ?? "", GRACIA_DIAS: "3",
};

await asegurarTablas(env);
const hoy = hoyLocal();
const ahora = new Date().toISOString();
const alta = DB._db.prepare("INSERT INTO alumnos (nombre, correo, whatsapp, plan, cortesia, acceso_hasta, mp_estado, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
alta.run("Ana López", "ana@demo.mx", "6141112233", "vip", 0, sumarDias(hoy, 20), "authorized", ahora);
alta.run("Luis Pérez", "luis@demo.mx", "6142223344", "normal", 0, sumarDias(hoy, -1), "authorized", ahora);
alta.run("Carla Ruiz", "carla@demo.mx", "6143334455", "normal", 0, sumarDias(hoy, -12), "cancelled", ahora);
alta.run("Pedro Gómez", "pedro@demo.mx", "6144445566", "normal", 0, null, "pending", ahora);
alta.run("María Torres", "maria@demo.mx", "6145556677", "normal", 1, null, null, ahora);
const vid = DB._db.prepare("INSERT INTO videos (modulo_id, titulo, vimeo_id, minutos, plan_min, orden) VALUES (?, ?, ?, ?, ?, ?)");
vid.run(1, "Clase 1 · Greetings & introductions", "76979871", 45, "normal", 1);
vid.run(1, "Clase 2 · The verb to be", "76979871", 50, "normal", 2);
vid.run(2, "Conversación · Ordering food", "76979871", 60, "vip", 1);
DB._db.prepare("INSERT INTO pagos (alumno_id, mp_id, monto, estado, fecha) VALUES (1, 'ap:demo1', 0, 'aprobado', ?)").run(ahora);

http.createServer(async (req, res) => {
  const cuerpo = await new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
  const r = new Request(`http://localhost:8787${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : cuerpo });
  const out = await worker.fetch(r, env);
  const h = Object.fromEntries(out.headers);
  // Local es http: la cookie Secure no se guardaría.
  const cookies = out.headers.getSetCookie?.() || [];
  if (cookies.length) h["set-cookie"] = cookies.map((c) => c.replace("; Secure", ""));
  res.writeHead(out.status, h);
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8787, () => console.log("http://localhost:8787"));
