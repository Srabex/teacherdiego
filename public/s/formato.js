// Formato de las lecciones (lo usan el Worker y el panel para la vista previa).
// Diego escribe texto sencillo, una cosa por línea:
//   # Título            ## Subtítulo
//   Texto normal (las líneas seguidas forman un párrafo; **negritas**)
//   - punto de una lista
//   ! nota o tip (recuadro)
//   = word = palabra    (vocabulario; varias líneas seguidas forman una tabla)
//   ? Pregunta | opción | *opción correcta | opción     (opción múltiple)
//   _ I [am] a teacher. She [is|'s] happy.             (completar; [respuesta] o [respuesta|otra válida])
//   > Pregunta abierta                                 (el alumno escribe; Diego la revisa)

export function parsear(texto) {
  const bloques = [];
  let parrafo = [];
  let n = 0;
  const cerrar = () => {
    if (parrafo.length) bloques.push({ t: "p", texto: parrafo.join(" ") });
    parrafo = [];
  };
  for (const cruda of String(texto ?? "").replace(/\r/g, "").split("\n")) {
    const l = cruda.trim();
    if (!l) { cerrar(); continue; }
    let m;
    if ((m = /^##\s+(.+)/.exec(l))) { cerrar(); bloques.push({ t: "h2", texto: m[1] }); continue; }
    if ((m = /^#\s+(.+)/.exec(l))) { cerrar(); bloques.push({ t: "h1", texto: m[1] }); continue; }
    if ((m = /^-\s+(.+)/.exec(l))) {
      cerrar();
      const prev = bloques[bloques.length - 1];
      if (prev?.t === "lista") prev.items.push(m[1]); else bloques.push({ t: "lista", items: [m[1]] });
      continue;
    }
    if ((m = /^!\s*(.+)/.exec(l))) { cerrar(); bloques.push({ t: "nota", texto: m[1] }); continue; }
    if ((m = /^=\s*(.+?)\s*=\s*(.+)$/.exec(l))) {
      cerrar();
      const prev = bloques[bloques.length - 1];
      if (prev?.t === "vocab") prev.items.push([m[1], m[2]]); else bloques.push({ t: "vocab", items: [[m[1], m[2]]] });
      continue;
    }
    if ((m = /^\?\s*(.+)/.exec(l))) {
      cerrar();
      const [q, ...ops] = m[1].split("|").map((x) => x.trim());
      const ok = ops.findIndex((o) => o.startsWith("*"));
      bloques.push({ t: "opcion", id: `e${++n}`, q, ops: ops.map((o) => o.replace(/^\*/, "").trim()).filter(Boolean), ok });
      continue;
    }
    if ((m = /^_\s*(.+)/.exec(l))) {
      cerrar();
      const partes = [];
      const re = /\[([^\]]+)\]/g;
      let i = 0, h;
      while ((h = re.exec(m[1]))) {
        if (h.index > i) partes.push(m[1].slice(i, h.index));
        partes.push({ r: h[1].split("|").map((x) => x.trim()).filter(Boolean) });
        i = re.lastIndex;
      }
      if (i < m[1].length) partes.push(m[1].slice(i));
      bloques.push({ t: "huecos", id: `e${++n}`, partes });
      continue;
    }
    if ((m = /^>\s*(.+)/.exec(l))) { cerrar(); bloques.push({ t: "abierta", id: `e${++n}`, q: m[1] }); continue; }
    parrafo.push(l);
  }
  cerrar();
  return bloques;
}

/** Lo que ve el alumno: sin las respuestas correctas (se califican en el servidor). */
export function sinRespuestas(bloques) {
  return bloques.map((b) => {
    if (b.t === "opcion") return { t: b.t, id: b.id, q: b.q, ops: b.ops };
    if (b.t === "huecos") return { t: b.t, id: b.id, partes: b.partes.map((p) => (typeof p === "string" ? p : { hueco: true })) };
    return b;
  });
}

const normal = (s) => String(s ?? "").toLowerCase().replace(/[’‘`´]/g, "'").replace(/[.!?¿¡,;:]+$/g, "").replace(/\s+/g, " ").trim();

/** Califica opción múltiple y completar. Las abiertas no cuentan (las revisa Diego). */
export function calificar(bloques, datos) {
  let aciertos = 0, total = 0;
  const detalle = {};
  for (const b of bloques) {
    const r = datos?.[b.id];
    if (b.t === "opcion" && b.ok >= 0) {
      total++;
      const bien = Number(r) === b.ok;
      if (bien) aciertos++;
      detalle[b.id] = bien;
    } else if (b.t === "huecos") {
      const huecos = b.partes.filter((p) => typeof p !== "string");
      const res = huecos.map((h, i) => {
        total++;
        const bien = h.r.some((x) => normal(x) === normal(Array.isArray(r) ? r[i] : ""));
        if (bien) aciertos++;
        return bien;
      });
      detalle[b.id] = res;
    }
  }
  return { aciertos, total, detalle };
}

/** Limpia lo que manda el alumno: solo ids de ejercicios de esta lección y textos cortos. */
export function limpiarDatos(bloques, datos) {
  const out = {};
  for (const b of bloques) {
    const v = datos?.[b.id];
    if (v == null) continue;
    if (b.t === "opcion") { const i = Number(v); if (Number.isInteger(i) && i >= 0 && i < b.ops.length) out[b.id] = i; }
    if (b.t === "huecos" && Array.isArray(v)) out[b.id] = v.slice(0, 30).map((x) => String(x ?? "").slice(0, 80));
    if (b.t === "abierta") out[b.id] = String(v).slice(0, 4000);
  }
  return out;
}
