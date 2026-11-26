// Área del alumno: estado de su membresía, su manual (módulos, videos y lecciones) y su cuenta.
import { $, api, esc, aviso, pesos, fechaCorta, ligaWA, marcaDeAgua, LOGO } from "./comun.js";
import { pintarHoja, leerRespuestas, marcar } from "./hoja.js";

$("#logo").innerHTML = `${LOGO}<span><b>Teacher Diego</b><small>El manual</small></span>`;
let yo = null;
let catalogo = null;

const ESTADOS = {
  al_corriente: ["ok", "Al corriente"], gracia: ["gracia", "Pago pendiente"], cortesia: ["cortesia", "Cortesía"],
  vencido: ["no", "Sin acceso"], sin_pago: ["no", "Sin membresía"], baja: ["no", "Baja"],
};

async function iniciar() {
  try { yo = await api("/api/yo"); }
  catch (e) { if (e.status === 401) { location.replace("/entrar"); return; } throw e; }

  const q = new URLSearchParams(location.search);
  if (q.get("pago") === "listo") await confirmarPago();

  $("#mi-plan").innerHTML = yo.acceso.ok ? `<span class="pill ${yo.plan}">${yo.plan === "vip" ? "VIP" : "Normal"}</span>` : "";
  $("#hola").textContent = `Hi, ${yo.nombre}!`;
  pintarEstado();
  catalogo = await api("/api/catalogo");
  pintarManual();
  $("#cargando").hidden = true;
  ruta();
}

/** Al volver de Mercado Pago: preguntamos a MP unas veces hasta que aparezca el cobro. */
async function confirmarPago() {
  aviso("Estamos confirmando tu pago…", 8000);
  for (let i = 0; i < 5 && !yo.acceso.ok; i++) {
    await api("/api/pago/revisar", { metodo: "POST" }).catch(() => {});
    yo = await api("/api/yo");
    if (!yo.acceso.ok) await new Promise((r) => setTimeout(r, 2500));
  }
  history.replaceState(null, "", "/clases");
  aviso(yo.acceso.ok ? "¡Listo! Tu membresía está activa. Welcome!" : "Tu pago se está procesando. En unos minutos se activa tu acceso.", 6000);
}

function pintarEstado() {
  const e = $("#estado");
  const a = yo.acceso;
  if (a.estado === "gracia") {
    e.innerHTML = `<div class="banda gracia"><p><b>Tu último pago no ha pasado.</b> Sigues entrando unos días más; revisa tu tarjeta en Mercado Pago para no perder el acceso.</p>
      ${yo.whatsapp ? `<a class="btn btn-claro btn-chico" target="_blank" rel="noopener" href="${ligaWA(yo.whatsapp, "Tengo un problema con mi pago.")}">Pedir ayuda</a>` : ""}</div>`;
    return;
  }
  if (a.ok) { e.innerHTML = ""; return; }
  const sugerido = sessionStorage.getItem("td_plan");
  const tarjeta = (plan, titulo, puntos, clase) => `
    <article class="plan ${clase}">
      ${plan === "vip" ? `<span class="etiqueta">Más completo</span>` : ""}
      <h3>${titulo}</h3>
      <div class="precio">${pesos(yo.precios[plan])} <small>/ mes</small></div>
      <div class="nota">Cobro mensual automático · cancelas cuando quieras</div>
      <ul>${puntos.map((p) => `<li>${p}</li>`).join("")}</ul>
      <button class="btn ${plan === "vip" ? "btn-rojo" : "btn-azul"}" data-pagar="${plan}">${sugerido === plan ? "✓ " : ""}Pagar con Mercado Pago</button>
    </article>`;
  e.innerHTML = `<div class="activar">
    <span class="kicker">${a.estado === "vencido" ? "Tu membresía se pausó" : "Último paso"}</span>
    <h2>${a.estado === "vencido" ? "Reactiva tu manual" : "Activa tu membresía"}</h2>
    <p class="ayuda">Ya ves los títulos de tu manual; al activar tu membresía se abren los videos y las lecciones.</p>
    <div class="planes">
      ${tarjeta("normal", "Normal", ["Todas las videoclases del programa", "Lecciones y ejercicios", "Tu avance guardado"], "")}
      ${tarjeta("vip", "VIP", ["Todo lo de Normal", "Material exclusivo VIP", "Más acompañamiento de Diego"], "vip")}
    </div>
    ${!yo.pago_en_linea && yo.whatsapp ? `<p class="ayuda" style="margin-top:16px">¿Prefieres pagar por transferencia? <a target="_blank" rel="noopener" href="${ligaWA(yo.whatsapp, "Quiero activar mi membresía.")}">Escríbenos por WhatsApp</a>.</p>` : ""}
  </div>`;
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-pagar]");
  if (!b) return;
  b.disabled = true;
  try {
    const r = await api("/api/pago/suscribir", { metodo: "POST", datos: { plan: b.dataset.pagar } });
    if (r.liga) location.href = r.liga;
    else { aviso(r.cambio ? "Listo: tu plan cambia desde tu próximo cobro." : "Ya tienes ese plan."); setTimeout(() => location.reload(), 1500); }
  } catch (e) {
    if (e.codigo === "sin_mp" && yo.whatsapp) location.href = ligaWA(yo.whatsapp, `Quiero activar la membresía ${b.dataset.pagar === "vip" ? "VIP" : "Normal"}.`);
    else aviso(e.message);
  } finally { b.disabled = false; }
});

function pintarManual() {
  const mods = catalogo.modulos;
  $("#modulos").innerHTML = mods.length ? mods.map((m, i) => `
    <article class="modulo">
      <div class="modulo-cab">
        <div class="modulo-num">${i + 1}</div>
        <div><h2>${esc(m.titulo)} ${m.plan_min === "vip" ? `<span class="pill vip">VIP</span>` : ""}</h2>${m.descripcion ? `<p>${esc(m.descripcion)}</p>` : ""}</div>
      </div>
      <ul class="items">
        ${m.videos.map((v) => `<li><button class="item ${v.bloqueado ? "bloqueado" : ""}" data-ir="#/video/${v.id}" data-bloq="${v.bloqueado ? v.plan_min : ""}">
          <span class="ico video">${v.bloqueado ? "🔒" : "▶"}</span><span class="titulo">${esc(v.titulo)}</span><span class="meta">${v.minutos ? `${v.minutos} min` : "Video"}</span></button></li>`).join("")}
        ${m.lecciones.map((l) => `<li><button class="item ${l.bloqueado ? "bloqueado" : ""}" data-ir="#/leccion/${l.id}" data-bloq="${l.bloqueado ? l.plan_min : ""}">
          <span class="ico leccion">${l.bloqueado ? "🔒" : "✍"}</span><span class="titulo">${esc(l.titulo)}</span>
          <span class="meta">${l.avance ? (l.avance.total ? `${l.avance.aciertos}/${l.avance.total} ✓` : "Guardada") : "Lección"}</span></button></li>`).join("")}
        ${!m.videos.length && !m.lecciones.length ? `<li class="vacio">Muy pronto.</li>` : ""}
      </ul>
    </article>`).join("") : `<div class="vacio">Tu manual se está preparando. Muy pronto verás aquí tus módulos.</div>`;
  $("#manual").hidden = false;
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-ir]");
  if (!b) return;
  if (b.dataset.bloq) {
    aviso(yo.acceso.ok ? "Esto es parte de la membresía VIP. Puedes cambiarte desde Mi cuenta." : "Activa tu membresía para abrirlo.");
    if (!yo.acceso.ok) $("#estado").scrollIntoView({ behavior: "smooth" });
    return;
  }
  location.hash = b.dataset.ir;
});

$("#volver").addEventListener("click", () => { location.hash = ""; });
window.addEventListener("hashchange", ruta);

let moverMarca = null;
async function ruta() {
  clearInterval(moverMarca);
  const m = /^#\/(video|leccion)\/(\d+)$/.exec(location.hash);
  $("#manual").hidden = !!m; $("#vista").hidden = !m; $("#estado").hidden = !!m;
  if (!m) { $("#vista-cont").innerHTML = ""; return; }
  const cont = $("#vista-cont");
  cont.innerHTML = `<p class="ayuda" style="margin-top:16px">Cargando…</p>`;
  window.scrollTo(0, 0);
  try {
    if (m[1] === "video") await verVideo(cont, m[2]);
    else await verLeccion(cont, m[2]);
  } catch (e) {
    cont.innerHTML = `<div class="tarjeta" style="margin-top:18px"><p>${esc(e.message)}</p></div>`;
  }
}

async function verVideo(cont, id) {
  const v = await api(`/api/video/${id}`);
  // Stream: el Worker manda la URL con permiso firmado. Vimeo (respaldo): id + hash.
  const src = v.src || `https://player.vimeo.com/video/${encodeURIComponent(v.vimeo_id)}?${v.vimeo_h ? `h=${encodeURIComponent(v.vimeo_h)}&` : ""}dnt=1&title=0&byline=0&portrait=0&badge=0`;
  cont.innerHTML = `
    <h1 style="margin-top:18px;font-size:1.8rem">${esc(v.titulo)}</h1>
    <div class="reproductor protegido" oncontextmenu="return false">
      <iframe src="${src}" allow="accelerometer; gyroscope; autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen title="${esc(v.titulo)}"></iframe>
      <div class="marca-video" aria-hidden="true">${esc(yo.correo)}</div>
    </div>
    ${v.descripcion ? `<p>${esc(v.descripcion)}</p>` : ""}`;
  // El correo del alumno se mueve sobre el video: si alguien graba la pantalla, se sabe de qué cuenta salió.
  const marca = cont.querySelector(".marca-video");
  const mover = () => { marca.style.top = `${8 + Math.random() * 70}%`; marca.style.left = `${4 + Math.random() * 60}%`; };
  mover(); moverMarca = setInterval(mover, 9000);
}

async function verLeccion(cont, id) {
  const l = await api(`/api/leccion/${id}`);
  cont.innerHTML = `
    <article class="hoja protegido" oncontextmenu="return false" oncopy="return false">
      <div class="marca-agua" style="background-image:${marcaDeAgua(l.marca)}"></div>
      <div class="cuerpo">${pintarHoja(l.titulo, l.bloques, l.datos)}</div>
      <div class="resultado">
        <span id="calif">${l.resultado ? calif(l.resultado) : "Contesta y guarda: tus respuestas se califican solas."}</span>
        <button class="btn btn-rojo btn-chico" id="guardar">Guardar y calificar</button>
      </div>
    </article>`;
  if (l.resultado) marcar(cont, l.resultado.detalle);
  $("#guardar").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const r = await api(`/api/leccion/${id}/respuestas`, { metodo: "POST", datos: { datos: leerRespuestas(cont) } });
      marcar(cont, r.resultado.detalle);
      $("#calif").innerHTML = calif(r.resultado);
      aviso("Respuestas guardadas ✓");
      const it = catalogo.modulos.flatMap((m) => m.lecciones).find((x) => String(x.id) === String(id));
      if (it) { it.avance = r.resultado; pintarManual(); $("#manual").hidden = true; }
    } catch (err) { aviso(err.message); } finally { e.target.disabled = false; }
  });
}

const calif = (r) => (r.total ? `<b>${r.aciertos}/${r.total}</b> correctas${r.aciertos === r.total ? " · Excellent! 🎉" : ""}` : "Respuestas guardadas ✓");

// ---------- Mi cuenta ----------
$("#btn-cuenta").addEventListener("click", () => {
  const [cls, txt] = ESTADOS[yo.acceso.estado] || ["gris", yo.acceso.estado];
  const sus = { authorized: "Activa", pending: "Pendiente", paused: "Pausada", cancelled: "Cancelada" }[yo.suscripcion] || "—";
  const otro = yo.plan === "vip" ? "normal" : "vip";
  $("#cuenta-cont").innerHTML = `
    <dl class="datos">
      <dt>Correo</dt><dd>${esc(yo.correo)}</dd>
      <dt>Membresía</dt><dd>${yo.acceso.ok ? (yo.plan === "vip" ? "VIP" : "Normal") : "—"}</dd>
      <dt>Estado</dt><dd><span class="pill ${cls}">${txt}</span></dd>
      ${yo.acceso.hasta ? `<dt>Pagado hasta</dt><dd>${fechaCorta(yo.acceso.hasta)}</dd>` : ""}
      <dt>Cobro automático</dt><dd>${sus}</dd>
    </dl>
    <div class="fila-btns">
      ${yo.suscripcion === "authorized" && !yo.admin ? `<button class="btn btn-azul btn-chico" data-pagar="${otro}">Cambiar a ${otro === "vip" ? "VIP" : "Normal"}</button>
        <button class="btn btn-claro btn-chico" id="cancelar">Cancelar suscripción</button>` : ""}
      ${yo.admin ? `<a class="btn btn-marino btn-chico" href="/admin">Ir al panel</a>` : ""}
      ${yo.whatsapp ? `<a class="btn btn-wa btn-chico" target="_blank" rel="noopener" href="${ligaWA(yo.whatsapp, "Tengo una duda con mi cuenta.")}">WhatsApp</a>` : ""}
      <button class="btn btn-claro btn-chico" id="salir">Salir</button>
    </div>`;
  $("#cuenta").showModal();
});

document.addEventListener("click", async (e) => {
  if (e.target.id === "salir") { await api("/api/salir", { metodo: "POST" }).catch(() => {}); location.href = "/"; }
  if (e.target.id === "cancelar") {
    if (!confirm("¿Cancelar tu suscripción? Sigues entrando hasta el fin del mes que ya pagaste.")) return;
    try { const r = await api("/api/pago/cancelar", { metodo: "POST" }); aviso(`Cancelada. Tienes acceso hasta el ${fechaCorta(r.hasta)}.`, 6000); setTimeout(() => location.reload(), 2500); }
    catch (err) { aviso(err.message); }
  }
});

iniciar().catch((e) => { $("#cargando").textContent = e.message; });
