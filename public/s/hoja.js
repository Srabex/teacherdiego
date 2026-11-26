// Pinta una lección (bloques de formato.js) como hoja de manual, lee y marca las respuestas.
import { esc } from "./comun.js";

const enLinea = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

export function pintarHoja(titulo, bloques, datos = {}) {
  let html = `<h1>${esc(titulo)}</h1>`;
  for (const b of bloques) {
    if (b.t === "h1") html += `<h2 style="font-size:1.6rem;color:var(--marino)">${enLinea(b.texto)}</h2>`;
    else if (b.t === "h2") html += `<h2>${enLinea(b.texto)}</h2>`;
    else if (b.t === "p") html += `<p>${enLinea(b.texto)}</p>`;
    else if (b.t === "nota") html += `<div class="nota">${enLinea(b.texto)}</div>`;
    else if (b.t === "lista") html += `<ul>${b.items.map((i) => `<li>${enLinea(i)}</li>`).join("")}</ul>`;
    else if (b.t === "vocab") html += `<table>${b.items.map(([a, c]) => `<tr><td>${esc(a)}</td><td>${esc(c)}</td></tr>`).join("")}</table>`;
    else if (b.t === "opcion") {
      html += `<div class="ej" data-id="${b.id}" data-t="opcion"><div class="q">${enLinea(b.q)}</div><div class="ops">${b.ops.map((o, i) =>
        `<label><input type="radio" name="${b.id}" value="${i}" ${Number(datos[b.id]) === i && datos[b.id] !== undefined ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div></div>`;
    } else if (b.t === "huecos") {
      let k = 0;
      const prev = Array.isArray(datos[b.id]) ? datos[b.id] : [];
      html += `<div class="ej huecos" data-id="${b.id}" data-t="huecos">${b.partes.map((p) =>
        typeof p === "string" ? esc(p) : `<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(prev[k++] ?? "")}" aria-label="Espacio para completar">`).join("")}</div>`;
    } else if (b.t === "abierta") {
      html += `<div class="ej" data-id="${b.id}" data-t="abierta"><div class="q">${enLinea(b.q)}</div><textarea rows="4" placeholder="Write your answer here…">${esc(datos[b.id] ?? "")}</textarea></div>`;
    }
  }
  return html;
}

export function leerRespuestas(cont) {
  const datos = {};
  for (const ej of cont.querySelectorAll(".ej[data-id]")) {
    const id = ej.dataset.id;
    if (ej.dataset.t === "opcion") { const c = ej.querySelector("input:checked"); if (c) datos[id] = Number(c.value); }
    if (ej.dataset.t === "huecos") datos[id] = [...ej.querySelectorAll("input")].map((i) => i.value);
    if (ej.dataset.t === "abierta") { const v = ej.querySelector("textarea").value.trim(); if (v) datos[id] = v; }
  }
  return datos;
}

export function marcar(cont, detalle = {}) {
  for (const ej of cont.querySelectorAll(".ej[data-id]")) {
    const d = detalle[ej.dataset.id];
    ej.classList.remove("bien", "mal");
    if (ej.dataset.t === "opcion" && typeof d === "boolean") ej.classList.add(d ? "bien" : "mal");
    if (ej.dataset.t === "huecos" && Array.isArray(d)) {
      ej.querySelectorAll("input").forEach((inp, i) => { inp.classList.remove("bien", "mal"); inp.classList.add(d[i] ? "bien" : "mal"); });
    }
  }
}
