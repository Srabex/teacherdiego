// Panel de Diego: alumnos (quién tiene acceso y quién no), contenido del manual y pagos de Mercado Pago.
import { $, $$, api, esc, aviso, pesos, fechaCorta, LOGO } from "./comun.js";
import { parsear, sinRespuestas } from "./formato.js";
import { pintarHoja } from "./hoja.js";

$("#logo").innerHTML = `${LOGO}<span><b>Teacher Diego</b><small>Panel</small></span>`;

const ESTADOS = {
  al_corriente: ["ok", "Al corriente", "#1E7B4F"], gracia: ["gracia", "En gracia", "#B7791F"], cortesia: ["cortesia", "Cortesía", "#5B3FB5"],
  vencido: ["no", "Vencido", "#C8102E"], sin_pago: ["gris", "Sin pago", "#9AA0AA"], baja: ["gris", "Baja", "#9AA0AA"],
};
const pillEstado = (e) => { const [c, t] = ESTADOS[e] || ["gris", e]; return `<span class="pill ${c}">${t}</span>`; };
const pillPlan = (p) => `<span class="pill ${p}">${p === "vip" ? "VIP" : "Normal"}</span>`;
const dlg = (titulo, html, ancho = false) => { $("#dlg-titulo").textContent = titulo; $("#dlg-cont").innerHTML = html; $("#dlg").classList.toggle("ancho", ancho); if (!$("#dlg").open) $("#dlg").showModal(); };
const cerrar = () => $("#dlg").close();
const wa = (n) => (n ? `https://wa.me/52${n}` : "");

// ---------- Pestañas ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]");
  if (!t) return;
  $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === t)));
  $$("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  ({ alumnos: cargarAlumnos, contenido: cargarContenido, pagos: cargarPagos })[t.dataset.tab]();
});

// ---------- Alumnos ----------
let alumnos = [];
let filtro = "con_acceso";

async function cargarAlumnos() {
  const r = await api("/api/admin/alumnos");
  alumnos = r.alumnos;
  const s = r.resumen;
  const cifras = [
    ["con_acceso", s.con_acceso, "Con acceso"], ["al_corriente", s.al_corriente, "Al corriente"], ["gracia", s.gracia, "En gracia"],
    ["vencido", s.vencido, "Vencidos"], ["sin_pago", s.sin_pago, "Registrados sin pagar"], ["vip", s.vip, "VIP activos"], ["todos", s.total, "Todos"],
  ];
  $("#cifras").innerHTML = cifras.map(([k, n, t]) => `<button class="cifra" data-filtro="${k}" aria-pressed="${filtro === k}"><b>${n}</b><span>${t}</span></button>`).join("");
  pintarAlumnos();
}

function pintarAlumnos() {
  const q = $("#buscar").value.trim().toLowerCase();
  const lista = alumnos.filter((a) => {
    if (filtro === "con_acceso" && !a.acceso.ok) return false;
    if (filtro === "vip" && !(a.acceso.ok && a.plan === "vip")) return false;
    if (!["con_acceso", "vip", "todos"].includes(filtro) && a.acceso.estado !== filtro) return false;
    return !q || `${a.nombre} ${a.correo} ${a.whatsapp || ""}`.toLowerCase().includes(q);
  });
  $("#lista-alumnos").innerHTML = lista.length ? lista.map((a) => `
    <div class="fila" data-alumno="${a.id}">
      <div><div class="nom"><span class="semaforo" style="background:${(ESTADOS[a.acceso.estado] || [])[2] || "#999"}"></span>${esc(a.nombre)}</div>
        <div class="sub">${esc(a.correo)}${a.acceso.hasta ? ` · pagado hasta ${fechaCorta(a.acceso.hasta)}` : ""}</div></div>
      <div class="ocultar-cel">${pillPlan(a.plan)}</div>
      <div>${pillEstado(a.acceso.estado)}</div>
    </div>`).join("") : `<div class="vacio">No hay alumnos en esta vista.</div>`;
}

document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-filtro]");
  if (c) { filtro = c.dataset.filtro; $$("[data-filtro]").forEach((b) => b.setAttribute("aria-pressed", String(b === c))); pintarAlumnos(); }
  const f = e.target.closest("[data-alumno]");
  if (f) fichaAlumno(f.dataset.alumno);
});
$("#buscar").addEventListener("input", pintarAlumnos);

$("#nuevo-alumno").addEventListener("click", () => {
  dlg("Nuevo alumno", `<form id="f-nuevo">
    <label>Nombre</label><input name="nombre" required>
    <label>Correo (con este entra)</label><input name="correo" type="email" required>
    <label>WhatsApp</label><input name="whatsapp" inputmode="tel">
    <div class="dos"><div><label>Membresía</label><select name="plan"><option value="normal">Normal</option><option value="vip">VIP</option></select></div></div>
    <label class="check"><input type="checkbox" name="cortesia"> Cortesía (entra sin pagar)</label>
    <p class="ayuda">Si va a pagar por Mercado Pago, mejor que se registre él mismo en la página. Aquí das de alta a quien paga en efectivo o a cortesías.</p>
    <div class="fila-btns"><button class="btn btn-rojo btn-chico">Guardar</button></div></form>`);
  $("#f-nuevo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/api/admin/alumnos", { metodo: "POST", datos: { ...Object.fromEntries(f), cortesia: f.get("cortesia") === "on" } }); cerrar(); aviso("Alumno agregado"); filtro = "todos"; cargarAlumnos(); }
    catch (err) { aviso(err.message); }
  });
});

async function fichaAlumno(id) {
  const d = await api(`/api/admin/alumnos/${id}/detalle`);
  const a = d.alumno;
  const sus = { authorized: "Activa ✓", pending: "Pendiente (no terminó de pagar)", paused: "Pausada", cancelled: "Cancelada" }[a.mp_estado] || "Sin suscripción";
  dlg(a.nombre, `
    <dl class="datos">
      <dt>Acceso</dt><dd>${pillEstado(a.acceso.estado)} ${a.acceso.hasta ? `hasta ${fechaCorta(a.acceso.hasta)}` : ""}</dd>
      <dt>Mercado Pago</dt><dd>${sus}</dd>
      <dt>Lecciones</dt><dd>${d.lecciones.length} contestadas</dd>
      <dt>Sesión</dt><dd>${d.sesiones.length ? `Abierta (${esc((d.sesiones[0].dispositivo || "").slice(0, 40))}…)` : "Sin sesión"}</dd>
    </dl>
    <div class="fila-btns">
      ${a.whatsapp ? `<a class="btn btn-wa btn-chico" target="_blank" rel="noopener" href="${wa(a.whatsapp)}">WhatsApp</a>` : ""}
      <button class="btn btn-claro btn-chico" data-acc="pago">Registrar pago en efectivo</button>
      ${a.mp_suscripcion ? `<button class="btn btn-claro btn-chico" data-acc="revisar">Revisar en Mercado Pago</button>` : ""}
      ${d.sesiones.length ? `<button class="btn btn-claro btn-chico" data-acc="sesion">Cerrar su sesión</button>` : ""}
    </div>
    <form id="f-alumno" style="margin-top:10px">
      <label>Nombre</label><input name="nombre" value="${esc(a.nombre)}" required>
      <div class="dos">
        <div><label>WhatsApp</label><input name="whatsapp" value="${esc(a.whatsapp || "")}" inputmode="tel"></div>
        <div><label>Membresía</label><select name="plan"><option value="normal" ${a.plan === "normal" ? "selected" : ""}>Normal</option><option value="vip" ${a.plan === "vip" ? "selected" : ""}>VIP</option></select></div>
      </div>
      <label>Pagado hasta (se llena solo con cada pago)</label><input type="date" name="acceso_hasta" value="${a.acceso_hasta || ""}">
      <label class="check"><input type="checkbox" name="cortesia" ${a.cortesia ? "checked" : ""}> Cortesía (entra sin pagar)</label>
      <label class="check"><input type="checkbox" name="baja" ${a.baja ? "checked" : ""}> Dar de baja (ya no entra)</label>
      <label>Notas</label><textarea name="notas" rows="3">${esc(a.notas || "")}</textarea>
      <div class="fila-btns"><button class="btn btn-rojo btn-chico">Guardar cambios</button></div>
    </form>
    ${d.pagos.length ? `<h3 style="margin-top:22px">Pagos</h3><div class="lista">${d.pagos.map((p) => `<div class="fila" style="cursor:default"><div>${fechaCorta(p.fecha)}</div><div>${pesos(p.monto)}</div><div class="sub">${String(p.mp_id).startsWith("manual") ? esc(p.detalle || "manual") : "Mercado Pago"}</div></div>`).join("")}</div>` : ""}
    ${d.lecciones.length ? `<h3 style="margin-top:22px">Lecciones</h3><div class="lista">${d.lecciones.map((l) => `<div class="fila" style="cursor:default"><div>${esc(l.titulo)}</div><div>${l.total ? `${l.aciertos}/${l.total}` : "—"}</div><div class="sub">${fechaCorta(l.actualizado)}</div></div>`).join("")}</div>` : ""}
  `);
  $("#f-alumno").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api(`/api/admin/alumnos/${id}`, { metodo: "PUT", datos: { ...Object.fromEntries(f), cortesia: f.get("cortesia") === "on", baja: f.get("baja") === "on" } });
      cerrar(); aviso("Guardado"); cargarAlumnos();
    } catch (err) { aviso(err.message); }
  });
  $("#dlg-cont").onclick = async (e) => {
    const acc = e.target.closest("[data-acc]")?.dataset.acc;
    if (!acc) return;
    try {
      if (acc === "pago") {
        const monto = prompt("¿Cuánto pagó? (suma un mes de acceso)", "");
        if (monto === null) return;
        const metodo = prompt("¿Cómo pagó? (efectivo, transferencia…)", "efectivo") || "efectivo";
        await api(`/api/admin/alumnos/${id}/pago`, { metodo: "POST", datos: { monto, metodo } });
        aviso("Pago registrado: +1 mes de acceso");
      }
      if (acc === "revisar") { const r = await api(`/api/admin/alumnos/${id}/revisar`, { metodo: "POST" }); aviso(`Mercado Pago: ${r.estado || "sin suscripción"}${r.nuevos ? ` · ${r.nuevos} pago(s) nuevos` : ""}`); }
      if (acc === "sesion") { await api(`/api/admin/alumnos/${id}/cerrar-sesion`, { metodo: "POST" }); aviso("Sesión cerrada"); }
      fichaAlumno(id); cargarAlumnos();
    } catch (err) { aviso(err.message); }
  };
}

// ---------- Contenido ----------
let modulos = [];
let streamActivo = false;
let revisando = null;

async function cargarContenido() {
  const r = await api("/api/admin/contenido");
  modulos = r.modulos; streamActivo = r.stream_listo;
  $("#lista-modulos").innerHTML = modulos.length ? modulos.map((m, i) => `
    <section class="mod-admin">
      <header>
        <div><h3>${i + 1}. ${esc(m.titulo)} ${pillPlan(m.plan_min)} ${m.publicado ? "" : `<span class="pill gris">Oculto</span>`}</h3>
          <div class="ayuda">${m.videos.length} videos · ${m.lecciones.length} lecciones${m.nivel ? ` · ${esc(m.nivel)}` : ""}</div></div>
        <div class="fila-btns" style="margin:0">
          <button class="btn btn-claro btn-chico" data-mod="${m.id}">Editar</button>
          <button class="btn btn-azul btn-chico" data-nuevo-video="${m.id}">+ Video</button>
          <button class="btn btn-rojo btn-chico" data-nueva-leccion="${m.id}">+ Lección</button>
        </div>
      </header>
      ${m.videos.map((v) => `<div class="fila" data-video="${v.id}"><span>▶</span><div><div class="nom">${esc(v.titulo)}</div><div class="sub">${v.stream_uid ? "Video subido" : `Vimeo ${esc(v.vimeo_id)}`}${v.minutos ? ` · ${v.minutos} min` : ""}</div></div><div>${v.stream_uid && !v.stream_listo ? `<span class="pill gracia" data-procesando="${v.id}">Procesando…</span>` : ""} ${v.plan_min === "vip" ? pillPlan("vip") : ""} ${v.publicado ? "" : `<span class="pill gris">Oculto</span>`}</div></div>`).join("")}
      ${m.lecciones.map((l) => `<div class="fila" data-leccion="${l.id}"><span>✍</span><div><div class="nom">${esc(l.titulo)}</div><div class="sub">Lección · ${fechaCorta(l.actualizado)}</div></div><div>${l.plan_min === "vip" ? pillPlan("vip") : ""} ${l.publicado ? "" : `<span class="pill gris">Oculta</span>`}</div></div>`).join("")}
    </section>`).join("") : `<div class="vacio">Crea tu primer módulo.</div>`;
  revisarProcesando();
}

/** Stream tarda unos minutos en procesar cada video: se revisa solo cada 20 s mientras el panel esté abierto. */
function revisarProcesando() {
  clearTimeout(revisando);
  const pend = $$("[data-procesando]");
  if (!pend.length) return;
  revisando = setTimeout(async () => {
    let cambio = false;
    for (const el of pend) {
      const e = await api(`/api/admin/videos/${el.dataset.procesando}/estado`, { metodo: "POST" }).catch(() => null);
      if (e?.listo) cambio = true;
      else if (e?.error) el.textContent = `Error: ${e.error}`;
      else if (e?.avance) el.textContent = `Procesando… ${Math.round(e.avance)}%`;
    }
    if (cambio) { aviso("Video listo para tus alumnos ✓"); cargarContenido(); } else revisarProcesando();
  }, 20000);
}

const opcionesModulo = (sel) => modulos.map((m) => `<option value="${m.id}" ${String(m.id) === String(sel) ? "selected" : ""}>${esc(m.titulo)}</option>`).join("");
const selPlan = (p) => `<select name="plan_min"><option value="normal" ${p !== "vip" ? "selected" : ""}>Normal y VIP</option><option value="vip" ${p === "vip" ? "selected" : ""}>Solo VIP</option></select>`;

function formModulo(m = {}) {
  dlg(m.id ? "Editar módulo" : "Nuevo módulo", `<form id="f-mod">
    <label>Título</label><input name="titulo" value="${esc(m.titulo || "")}" required placeholder="Módulo 2 · Present simple">
    <label>Descripción corta</label><input name="descripcion" value="${esc(m.descripcion || "")}">
    <div class="dos"><div><label>Nivel</label><input name="nivel" value="${esc(m.nivel || "")}" placeholder="A1, Básico…"></div>
      <div><label>¿Quién lo ve?</label>${selPlan(m.plan_min)}</div></div>
    <div class="dos"><div><label>Orden</label><input name="orden" type="number" value="${m.orden ?? modulos.length + 1}"></div></div>
    <label class="check"><input type="checkbox" name="publicado" ${m.publicado === 0 ? "" : "checked"}> Publicado</label>
    <div class="fila-btns"><button class="btn btn-rojo btn-chico">Guardar</button>${m.id ? `<button type="button" class="btn btn-claro btn-chico" id="borrar">Borrar módulo</button>` : ""}</div></form>`);
  $("#f-mod").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api(m.id ? `/api/admin/modulos/${m.id}` : "/api/admin/modulos", { metodo: m.id ? "PUT" : "POST", datos: { ...Object.fromEntries(f), publicado: f.get("publicado") === "on" } }); cerrar(); cargarContenido(); }
    catch (err) { aviso(err.message); }
  });
  $("#borrar")?.addEventListener("click", async () => {
    if (!confirm("¿Borrar este módulo?")) return;
    try { await api(`/api/admin/modulos/${m.id}`, { metodo: "DELETE" }); cerrar(); cargarContenido(); } catch (err) { aviso(err.message); }
  });
}

function formVideo(v = {}) {
  const conVimeo = !!v.vimeo_id && !v.stream_uid;
  dlg(v.id ? "Editar video" : "Nuevo video", `<form id="f-video">
    <label>Título</label><input name="titulo" value="${esc(v.titulo || "")}" required placeholder="Clase 3 · Present simple">
    ${streamActivo || !conVimeo ? `
      <label>${v.stream_uid ? "Reemplazar archivo (opcional)" : "Archivo del video"}</label>
      <input type="file" name="archivo" accept="video/*" ${v.id ? "" : "required"}>
      <p class="ayuda">MP4 o MOV, idealmente en 1080p. Puedes subirlo desde el celular; no cierres esta ventana hasta que termine.</p>
      <div id="progreso" hidden><div style="height:10px;background:var(--perla2);border-radius:99px;overflow:hidden"><div id="barra" style="height:100%;width:0;background:var(--rojo);transition:width .3s"></div></div><p class="ayuda" id="progreso-txt"></p></div>` : ""}
    <details ${conVimeo ? "open" : ""} style="margin-top:8px"><summary class="ayuda" style="cursor:pointer">O pega una liga de Vimeo</summary>
      <input name="liga" value="${conVimeo ? `https://vimeo.com/${v.vimeo_id}${v.vimeo_h ? `/${v.vimeo_h}` : ""}` : ""}" placeholder="https://vimeo.com/123456789/abc123"></details>
    <label>Descripción (opcional)</label><textarea name="descripcion" rows="3">${esc(v.descripcion || "")}</textarea>
    <div class="dos"><div><label>Módulo</label><select name="modulo_id">${opcionesModulo(v.modulo_id)}</select></div>
      <div><label>¿Quién lo ve?</label>${selPlan(v.plan_min)}</div></div>
    <div class="dos"><div><label>Orden</label><input name="orden" type="number" value="${v.orden ?? 1}"></div><div><label>Minutos (se llena solo)</label><input name="minutos" type="number" value="${v.minutos ?? ""}"></div></div>
    <label class="check"><input type="checkbox" name="publicado" ${v.publicado === 0 ? "" : "checked"}> Publicado</label>
    <div class="fila-btns"><button class="btn btn-rojo btn-chico" id="guardar-video">Guardar</button>${v.id ? `<button type="button" class="btn btn-claro btn-chico" id="borrar">Borrar</button>` : ""}</div></form>`);
  $("#f-video").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const archivo = f.get("archivo");
    const datos = { ...Object.fromEntries(f), publicado: f.get("publicado") === "on" };
    delete datos.archivo;
    const btn = $("#guardar-video");
    btn.disabled = true;
    try {
      if (archivo && archivo.size) {
        $("#progreso").hidden = false;
        datos.stream_uid = await subirAStream(archivo, f.get("titulo"), (pct) => {
          $("#barra").style.width = `${pct}%`;
          $("#progreso-txt").textContent = `Subiendo… ${pct}% (${(archivo.size / 1024 ** 2).toFixed(0)} MB)`;
        });
        $("#progreso-txt").textContent = "Subido ✓ Stream lo está procesando (unos minutos).";
      }
      await api(v.id ? `/api/admin/videos/${v.id}` : "/api/admin/videos", { metodo: v.id ? "PUT" : "POST", datos });
      cerrar(); aviso(datos.stream_uid ? "Video subido. En unos minutos queda listo." : "Guardado"); cargarContenido();
    } catch (err) { aviso(err.message, 6000); } finally { btn.disabled = false; }
  });
  $("#borrar")?.addEventListener("click", async () => {
    if (!confirm("¿Borrar este video? Se quita de la plataforma y del almacenamiento.")) return;
    await api(`/api/admin/videos/${v.id}`, { metodo: "DELETE" }); cerrar(); cargarContenido();
  });
}

/** Subida por partes (protocolo tus) directo del navegador a Cloudflare Stream; reintenta cada parte si falla la red. */
async function subirAStream(archivo, nombre, alAvanzar) {
  const { url, uid } = await api("/api/admin/stream/subir", { metodo: "POST", datos: { nombre: nombre || archivo.name, tamano: archivo.size } });
  const PARTE = 50 * 1024 * 1024; // múltiplo de 256 KiB, como pide Stream
  let offset = 0;
  while (offset < archivo.size) {
    const trozo = archivo.slice(offset, offset + PARTE);
    let ok = false;
    for (let intento = 0; intento < 4 && !ok; intento++) {
      try {
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
          body: trozo,
        });
        if (res.status === 204 || res.ok) { offset = Number(res.headers.get("Upload-Offset")) || offset + trozo.size; ok = true; }
        else if (res.status === 409) {
          // El servidor tiene otro avance: preguntamos dónde quedó y seguimos desde ahí.
          const h = await fetch(url, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0" } });
          offset = Number(h.headers.get("Upload-Offset")) || offset; ok = true;
        } else throw new Error(`Stream ${res.status}`);
      } catch (e) {
        if (intento === 3) throw new Error("Se cortó la subida. Revisa tu internet y vuelve a intentar.");
        await new Promise((r) => setTimeout(r, 2000 * (intento + 1)));
      }
    }
    alAvanzar(Math.min(100, Math.round((offset / archivo.size) * 100)));
  }
  return uid;
}

const PLANTILLA = `# Título de la lección
Explicación corta del tema. Puedes usar **negritas**.

! Tip: una nota que se ve en recuadro.

## Vocabulario
= word = palabra

## Elige la opción correcta
? She ___ my friend. | are | *is | am

## Completa
_ I [am] from Mexico.

## Escribe
> Describe tu rutina en 3 oraciones.`;

async function formLeccion(id, moduloId) {
  const l = id ? await api(`/api/admin/lecciones/${id}`) : { modulo_id: moduloId, texto: PLANTILLA, publicado: 1 };
  dlg(id ? "Editar lección" : "Nueva lección", `<form id="f-lec">
    <div class="dos"><div><label>Título</label><input name="titulo" value="${esc(l.titulo || "")}" required></div>
      <div class="dos"><div><label>Módulo</label><select name="modulo_id">${opcionesModulo(l.modulo_id)}</select></div><div><label>¿Quién la ve?</label>${selPlan(l.plan_min)}</div></div></div>
    <div class="editor" style="margin-top:14px">
      <div><label>Contenido</label><textarea name="texto" id="texto">${esc(l.texto)}</textarea>
        <div class="chuleta"><b>Cómo se escribe:</b> <code># Título</code> <code>## Subtítulo</code> <code>! nota</code> <code>- lista</code> <code>= word = palabra</code>
        <code>? Pregunta | opción | *correcta</code> <code>_ I [am] here.</code> (completar; varias válidas: <code>[is|'s]</code>) <code>> Pregunta abierta</code></div></div>
      <div><label>Así lo ve el alumno</label><div class="previa"><div class="hoja" id="previa"></div></div></div>
    </div>
    <div class="dos"><div><label>Orden</label><input name="orden" type="number" value="${l.orden ?? 1}"></div><div><label class="check"><input type="checkbox" name="publicado" ${l.publicado === 0 ? "" : "checked"}> Publicada</label></div></div>
    <div class="fila-btns"><button class="btn btn-rojo btn-chico">Guardar lección</button>
      ${id ? `<button type="button" class="btn btn-claro btn-chico" id="ver-resp">Ver respuestas de alumnos</button><button type="button" class="btn btn-claro btn-chico" id="borrar">Borrar</button>` : ""}</div>
  </form>`, true);
  const previa = () => { $("#previa").innerHTML = pintarHoja($("#f-lec [name=titulo]").value || "Sin título", sinRespuestas(parsear($("#texto").value))); };
  $("#texto").addEventListener("input", previa); $("#f-lec [name=titulo]").addEventListener("input", previa); previa();
  $("#f-lec").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api(id ? `/api/admin/lecciones/${id}` : "/api/admin/lecciones", { metodo: id ? "PUT" : "POST", datos: { ...Object.fromEntries(f), publicado: f.get("publicado") === "on" } }); cerrar(); aviso("Lección guardada"); cargarContenido(); }
    catch (err) { aviso(err.message); }
  });
  $("#borrar")?.addEventListener("click", async () => {
    if (!confirm("¿Borrar esta lección y las respuestas de los alumnos?")) return;
    await api(`/api/admin/lecciones/${id}`, { metodo: "DELETE" }); cerrar(); cargarContenido();
  });
  $("#ver-resp")?.addEventListener("click", () => respuestas(id));
}

async function respuestas(id) {
  const r = await api(`/api/admin/lecciones/${id}/respuestas`);
  const abiertas = r.bloques.filter((b) => b.t === "abierta");
  dlg(`Respuestas · ${r.leccion.titulo}`, r.respuestas.length ? r.respuestas.map((x) => `
    <div class="tarjeta" style="margin-bottom:12px;box-shadow:none">
      <div class="nom"><b>${esc(x.nombre)}</b> <span class="ayuda">${x.total ? `${x.aciertos}/${x.total} correctas` : ""} · ${fechaCorta(x.actualizado)}</span></div>
      ${abiertas.map((b) => `<p class="ayuda" style="margin:10px 0 2px">${esc(b.q)}</p><p>${esc(x.datos[b.id] || "—")}</p>`).join("")}
    </div>`).join("") : `<div class="vacio">Nadie ha contestado esta lección todavía.</div>`, true);
}

document.addEventListener("click", (e) => {
  let el;
  if ((el = e.target.closest("[data-mod]"))) formModulo(modulos.find((m) => String(m.id) === el.dataset.mod));
  else if ((el = e.target.closest("[data-nuevo-video]"))) formVideo({ modulo_id: el.dataset.nuevoVideo });
  else if ((el = e.target.closest("[data-nueva-leccion]"))) formLeccion(null, el.dataset.nuevaLeccion);
  else if ((el = e.target.closest("[data-video]"))) formVideo(modulos.flatMap((m) => m.videos).find((v) => String(v.id) === el.dataset.video));
  else if ((el = e.target.closest("[data-leccion]"))) formLeccion(el.dataset.leccion);
});
$("#nuevo-modulo").addEventListener("click", () => formModulo());

// ---------- Pagos ----------
async function cargarPagos() {
  const r = await api("/api/admin/pagos");
  $("#pagos").innerHTML = `
    ${!r.mp_listo ? `<div class="banda gracia"><p><b>Mercado Pago aún no está conectado.</b> Falta el Access Token de la cuenta de Diego (Secret <code>MP_ACCESS_TOKEN</code>). Mientras, los pagos se registran a mano desde la ficha del alumno.</p></div>` : ""}
    ${r.mp_listo && !r.firma_lista ? `<div class="banda gracia"><p>Falta la clave secreta de webhooks (<code>MP_WEBHOOK_SECRET</code>) para validar los avisos de Mercado Pago.</p></div>` : ""}
    <div class="cifras">
      <div class="cifra"><b>${pesos(r.mes.total)}</b><span>Cobrado este mes</span></div>
      <div class="cifra"><b>${r.mes.cobros}</b><span>Cobros este mes</span></div>
    </div>
    <h3>Últimos pagos</h3>
    <div class="lista">${r.pagos.length ? r.pagos.map((p) => `<div class="fila" style="cursor:default"><div><div class="nom">${esc(p.nombre || "—")}</div><div class="sub">${fechaCorta(p.fecha)} · ${String(p.mp_id).startsWith("manual") ? esc(p.detalle || "manual") : "Mercado Pago"}</div></div><div>${pesos(p.monto)}</div><div></div></div>`).join("") : `<div class="vacio">Aún no hay pagos.</div>`}</div>
    <h3 style="margin-top:26px">Avisos de Mercado Pago</h3>
    <p class="ayuda">Cada vez que Mercado Pago cobra, falla un cobro o alguien cancela, llega un aviso y el acceso se ajusta solo.</p>
    <div class="lista">${r.avisos.length ? r.avisos.map((a) => `<div class="fila" style="cursor:default"><div><div class="nom">${esc(a.tipo || "—")}</div><div class="sub">${esc(a.recibido.slice(0, 16).replace("T", " "))} UTC</div></div><div class="sub">${esc(a.resultado || "")}</div><div></div></div>`).join("") : `<div class="vacio">Sin avisos todavía.</div>`}</div>`;
}

$("#salir").addEventListener("click", async () => { await api("/api/salir", { metodo: "POST" }).catch(() => {}); location.href = "/"; });

api("/api/yo").then((yo) => {
  if (!yo.admin) { location.replace("/clases"); return; }
  cargarAlumnos();
}).catch((e) => { if (e.status === 401) location.replace("/entrar"); else aviso(e.message); });
