// Landing: precios y WhatsApp salen del Worker (/api/publico), que los lee de wrangler.jsonc.
import { $, $$, api, pesos, ligaWA } from "./comun.js";

$("#anio").textContent = new Date().getFullYear();

api("/api/publico").then(({ precios, whatsapp }) => {
  for (const el of $$("[data-precio]")) {
    const p = precios[el.dataset.precio];
    if (p) {
      el.innerHTML = `${pesos(p)} <small>/ mes</small>`;
      el.nextElementSibling?.classList.contains("nota") && (el.nextElementSibling.textContent = "Cobro mensual automático");
    }
  }
  for (const a of $$("[data-wa]")) {
    if (whatsapp) { a.href = ligaWA(whatsapp, a.dataset.msg); a.target = "_blank"; a.rel = "noopener"; }
    else a.hidden = true;
  }
}).catch(() => {});
