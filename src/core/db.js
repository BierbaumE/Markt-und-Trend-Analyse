// Schmale Hilfsschicht um D1. Kein ORM.
export class DbMissing extends Error {
  constructor() {
    super("D1-Datenbank ist nicht verbunden (Binding RADAR_DB fehlt oder database_id ist leer).");
    this.code = "db_missing";
  }
}

export class Db {
  constructor(env) {
    if (!env.RADAR_DB) throw new DbMissing();
    this.d1 = env.RADAR_DB;
  }
  async all(sql, ...params) {
    const { results } = await this.d1.prepare(sql).bind(...params).all();
    return results || [];
  }
  async first(sql, ...params) {
    const row = await this.d1.prepare(sql).bind(...params).first();
    return row || null;
  }
  async run(sql, ...params) {
    return this.d1.prepare(sql).bind(...params).run();
  }
  async batch(statements) {
    return this.d1.batch(statements.map(([sql, params]) => this.d1.prepare(sql).bind(...(params || []))));
  }
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}
