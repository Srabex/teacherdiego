// Teacher Diego — plataforma de clases de inglés con membresía (Cloudflare Worker + D1, sin compilación).
// Páginas estáticas en public/ (landing, /entrar, /clases, /admin); todo /api/* lo atiende este Worker.
import { json, Publico } from "./util.js";
import { asegurarTablas } from "./db.js";
import { rutasAuth, sesionActual } from "./auth.js";
import { rutasAlumno } from "./contenido.js";
import { rutasAdmin } from "./admin.js";
import { rutasPago, avisoMP, precioDe } from "./mp.js";

const SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin", // Vimeo revisa el dominio de origen: no quitar
  "X-Frame-Options": "DENY",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // www y dominios viejos → dominio principal (cuando DOMINIO esté puesto).
    if (env.DOMINIO && url.hostname !== env.DOMINIO && (url.hostname === `www.${env.DOMINIO}` || String(env.REDIRIGIR || "").split(",").map((x) => x.trim()).includes(url.hostname))) {
      url.hostname = env.DOMINIO;
      return Response.redirect(url.toString(), 301);
    }

    if (!url.pathname.startsWith("/api/")) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(SEGURIDAD)) out.headers.set(k, v);
      if (/^\/(clases|admin|entrar)(\.html)?$/.test(url.pathname)) out.headers.set("Cache-Control", "no-store");
      return out;
    }

    try {
      await asegurarTablas(env);
      if (url.pathname === "/api/mp/aviso" && request.method === "POST") return await avisoMP(request, env, url);
      // Datos públicos de la landing (precios y WhatsApp salen de wrangler.jsonc, un solo lugar).
      if (url.pathname === "/api/publico" && request.method === "GET") {
        return json({ precios: { normal: precioDe(env, "normal"), vip: precioDe(env, "vip") }, whatsapp: env.WHATSAPP || "" }, 200, { "Cache-Control": "public, max-age=300" });
      }

      const auth = await rutasAuth(request, env, url);
      if (auth) return auth;

      const r = await sesionActual(env, request);
      if (!r) throw new Publico("Tu sesión se cerró (entraste en otro dispositivo o ya venció). Entra de nuevo con tu correo.", 401, "sin_sesion");

      if (url.pathname.startsWith("/api/admin/")) return await rutasAdmin(request, env, url, r);
      if (url.pathname.startsWith("/api/pago/")) {
        const p = await rutasPago(request, env, url, r);
        if (p) return p;
      }
      const a = await rutasAlumno(request, env, url, r);
      if (a) return a;
      throw new Publico("No encontrado.", 404);
    } catch (e) {
      if (e instanceof Publico) return json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) }, e.status);
      console.error("api", e);
      return json({ error: "Algo salió mal. Intenta de nuevo en un momento." }, 500);
    }
  },
};
