// Base D1: las tablas se crean solas la primera vez (no hay que correr SQL a mano en la Console).
// Columnas nuevas: agregar un ALTER en MIGRACIONES con su nombre; se corre una vez y queda marcado en `meta`.
import { hoyLocal, sumarDias } from "./util.js";

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT)`,
  `CREATE TABLE IF NOT EXISTS alumnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    correo TEXT NOT NULL UNIQUE COLLATE NOCASE,
    whatsapp TEXT,
    plan TEXT NOT NULL DEFAULT 'normal',
    cortesia INTEGER NOT NULL DEFAULT 0,
    acceso_hasta TEXT,
    mp_suscripcion TEXT,
    mp_estado TEXT,
    notas TEXT,
    baja INTEGER NOT NULL DEFAULT 0,
    creado TEXT NOT NULL,
    ultimo_acceso TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS codigos (
    correo TEXT PRIMARY KEY, codigo_hash TEXT NOT NULL, expira TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0, enviados INTEGER NOT NULL DEFAULT 1, ventana TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    token_hash TEXT PRIMARY KEY, alumno_id INTEGER NOT NULL, expira TEXT NOT NULL, creado TEXT NOT NULL, dispositivo TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS modulos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, descripcion TEXT, nivel TEXT,
    plan_min TEXT NOT NULL DEFAULT 'normal', orden INTEGER NOT NULL DEFAULT 0, publicado INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, modulo_id INTEGER NOT NULL, titulo TEXT NOT NULL, descripcion TEXT,
    vimeo_id TEXT NOT NULL, vimeo_h TEXT, minutos INTEGER, plan_min TEXT NOT NULL DEFAULT 'normal',
    orden INTEGER NOT NULL DEFAULT 0, publicado INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS lecciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, modulo_id INTEGER NOT NULL, titulo TEXT NOT NULL, texto TEXT NOT NULL DEFAULT '',
    plan_min TEXT NOT NULL DEFAULT 'normal', orden INTEGER NOT NULL DEFAULT 0, publicado INTEGER NOT NULL DEFAULT 1, actualizado TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS respuestas (
    alumno_id INTEGER NOT NULL, leccion_id INTEGER NOT NULL, datos TEXT NOT NULL, aciertos INTEGER, total INTEGER,
    actualizado TEXT NOT NULL, PRIMARY KEY (alumno_id, leccion_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, alumno_id INTEGER, mp_id TEXT UNIQUE, monto REAL, estado TEXT,
    fecha TEXT NOT NULL, detalle TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS mp_avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, recibido TEXT NOT NULL, tipo TEXT, data_id TEXT, resultado TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sesiones_alumno ON sesiones (alumno_id)`,
  `CREATE INDEX IF NOT EXISTS idx_videos_modulo ON videos (modulo_id, orden)`,
  `CREATE INDEX IF NOT EXISTS idx_lecciones_modulo ON lecciones (modulo_id, orden)`,
];

/** Columnas nuevas en el futuro: { nombre: "mig_xxx", sql: "ALTER TABLE ..." } */
const MIGRACIONES = [];

const LECCION_EJEMPLO = `# Bienvenido a tu manual
Esta es una lección de ejemplo. Así se ve el material dentro de la plataforma: se lee aquí, se contesta aquí y tus respuestas se guardan solas.

## Vocabulario
= teacher = maestro
= homework = tarea
= to learn = aprender

## Elige la opción correcta
? She ___ a teacher. | are | *is | am
? I ___ English every day. | *study | studies | studying

## Completa
_ My name [is] Diego and I [am] your teacher.

## Escribe
> Preséntate en inglés en 3 líneas: tu nombre, a qué te dedicas y por qué quieres aprender inglés.`;

let lista = false;

export async function asegurarTablas(env) {
  if (lista) return;
  const listo = await env.DB.prepare("SELECT valor FROM meta WHERE clave = 'tablas'").first().catch(() => null);
  if (!listo) {
    await env.DB.batch(TABLAS.map((s) => env.DB.prepare(s)));
    await sembrar(env);
    await env.DB.prepare("INSERT OR REPLACE INTO meta (clave, valor) VALUES ('tablas', ?)").bind(new Date().toISOString()).run();
  }
  for (const m of MIGRACIONES) {
    const hecho = await env.DB.prepare("SELECT 1 FROM meta WHERE clave = ?").bind(m.nombre).first();
    if (hecho) continue;
    try { await env.DB.prepare(m.sql).run(); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
    await env.DB.prepare("INSERT OR REPLACE INTO meta (clave, valor) VALUES (?, ?)").bind(m.nombre, new Date().toISOString()).run();
  }
  lista = true;
}

/** Contenido de ejemplo para que la plataforma no arranque vacía (Diego lo borra o edita desde el panel). */
async function sembrar(env) {
  const hay = await env.DB.prepare("SELECT COUNT(*) AS n FROM modulos").first();
  if (hay?.n) return;
  const ahora = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO modulos (titulo, descripcion, nivel, plan_min, orden) VALUES (?, ?, ?, 'normal', 1)")
      .bind("Módulo 1 · Primeros pasos", "Empieza aquí: cómo funciona tu manual.", "Nivel 1"),
    env.DB.prepare("INSERT INTO modulos (titulo, descripcion, nivel, plan_min, orden) VALUES (?, ?, ?, 'vip', 2)")
      .bind("Módulo VIP · Conversación", "Material exclusivo para VIP (ejemplo).", "VIP"),
    env.DB.prepare("INSERT INTO lecciones (modulo_id, titulo, texto, plan_min, orden, actualizado) VALUES (1, ?, ?, 'normal', 1, ?)")
      .bind("Lección de ejemplo", LECCION_EJEMPLO, ahora),
  ]);
}

/** Solo para pruebas: olvidar que las tablas ya se revisaron. */
export function _reiniciar() { lista = false; }

// ---------- Acceso ----------

export const gracia = (env) => Math.min(Math.max(parseInt(env.GRACIA_DIAS ?? "3", 10) || 0, 0), 15);

/**
 * ¿Puede entrar? Cortesía siempre; si no, mientras `acceso_hasta` (pagado hasta) no tenga más de N días de vencido.
 * estado: cortesia | al_corriente | gracia | vencido | sin_pago | baja
 */
export function accesoDe(a, hoy = hoyLocal(), diasGracia = 3) {
  if (!a) return { ok: false, estado: "sin_pago" };
  if (a.baja) return { ok: false, estado: "baja" };
  if (a.cortesia) return { ok: true, estado: "cortesia" };
  if (!a.acceso_hasta) return { ok: false, estado: "sin_pago" };
  if (a.acceso_hasta >= hoy) return { ok: true, estado: "al_corriente", hasta: a.acceso_hasta };
  if (sumarDias(a.acceso_hasta, diasGracia) >= hoy) return { ok: true, estado: "gracia", hasta: a.acceso_hasta };
  return { ok: false, estado: "vencido", hasta: a.acceso_hasta };
}

export const PLANES = ["normal", "vip"];
export const nivelPlan = (p) => (p === "vip" ? 2 : 1);
/** VIP ve todo; Normal solo lo marcado como Normal. */
export const puedeVer = (planAlumno, planMin) => nivelPlan(planAlumno) >= nivelPlan(planMin);
