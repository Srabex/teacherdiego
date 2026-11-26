// D1 simulado con SQLite de Node (node:sqlite) para probar sin Cloudflare.
import { DatabaseSync } from "node:sqlite";

export function d1Local() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    _run: () => db.prepare(sql).run(...args),
  });
  return {
    _db: db,
    prepare: (sql) => stmt(sql),
    batch: async (lista) => { db.exec("BEGIN"); try { lista.forEach((x) => x._run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
}
