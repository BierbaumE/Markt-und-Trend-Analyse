import { Router, json, bad } from "../core/router.js";
import { Db, DbMissing, parseJson } from "../core/db.js";
import { roleFor, can, ROLES } from "../core/rbac.js";
import { audit } from "../core/audit.js";
import { uuidv7, nowIso } from "../core/ids.js";
import { APP_VERSION, CHANGELOG } from "../version.js";
import { registerTrendRoutes } from "./trends.js";
import { registerCreatorRoutes } from "./creators.js";
import { registerCompanyRoutes } from "./companies.js";
import { registerCrmRoutes } from "./crm.js";
import { registerAdminRoutes } from "./admin.js";

const router = new Router();

// Version und Changelog kommen vom Server, damit die Oberflaeche nach einem Deploy
// nicht mit einem alten Stand weiterlaeuft.
router.get("/api/v1/meta", async () => json({ version: APP_VERSION, changelog: CHANGELOG }));

router.get("/api/v1/me", async (ctx) => {
  let role = "viewer";
  let dbOk = true;
  try {
    role = await roleFor(ctx.db, ctx.env, ctx.user.username);
  } catch (e) {
    dbOk = false;
  }
  return json({
    username: ctx.user.username,
    role,
    isAdmin: role === "admin",
    roles: ROLES,
    version: APP_VERSION,
    dbConnected: dbOk,
  });
});

router.get("/api/v1/health", async (ctx) => {
  const out = { version: APP_VERSION, bindings: { auth: Boolean(ctx.env.AUTH), db: Boolean(ctx.env.RADAR_DB), kv: Boolean(ctx.env.RADAR_CACHE), r2: Boolean(ctx.env.RADAR_ARCHIVE), ai: Boolean(ctx.env.AI) } };
  try {
    const row = await ctx.db.first("SELECT COUNT(*) AS n FROM country");
    out.countries = Number(row.n) || 0;
    const t = await ctx.db.first("SELECT COUNT(*) AS n FROM trend");
    out.trends = Number(t.n) || 0;
    const c = await ctx.db.first("SELECT COUNT(*) AS n FROM creator_candidate");
    out.creators = Number(c.n) || 0;
    out.dbConnected = true;
  } catch (e) {
    out.dbConnected = false;
    out.dbError = e.code === "db_missing" ? "Binding RADAR_DB fehlt" : "Migration noch nicht ausgeführt?";
  }
  return json(out);
});

// Ersetzt den localStorage: Ansichtszustand und „zuletzt gesehene Version“ pro Konto.
router.get("/api/v1/state/:key", async (ctx) => {
  const row = await ctx.db.first("SELECT value FROM app_state WHERE username = ? AND key = ?", ctx.user.username, ctx.params.key);
  return json({ key: ctx.params.key, value: row ? parseJson(row.value, null) : null });
});

router.put("/api/v1/state/:key", async (ctx) => {
  const body = await ctx.body();
  await ctx.db.run(
    "INSERT INTO app_state (username, key, value, updated_at) VALUES (?,?,?,?) ON CONFLICT(username, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ctx.user.username, ctx.params.key, JSON.stringify(body.value ?? null), nowIso()
  );
  return json({ ok: true });
});

router.get("/api/v1/countries", async (ctx) => {
  const rows = await ctx.db.all("SELECT code, name_de, languages, enabled FROM country ORDER BY enabled DESC, code");
  return json(rows.map((r) => ({ code: r.code, name: r.name_de, languages: parseJson(r.languages, []), enabled: Boolean(r.enabled) })));
});

registerTrendRoutes(router);
registerCreatorRoutes(router);
registerCompanyRoutes(router);
registerCrmRoutes(router);
registerAdminRoutes(router);

export async function handleApi(request, env, execCtx, user) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // Einfacher CSRF-Schutz fuer schreibende Aufrufe
  if (method !== "GET") {
    const origin = request.headers.get("Origin");
    if (origin && new URL(origin).host !== url.host) return bad("Fremde Herkunft", 403, "bad_origin");
  }

  const route = router.match(method, url.pathname);
  if (!route) return bad("Unbekannter Endpunkt", 404, "not_found");

  let db = null;
  try {
    db = new Db(env);
  } catch (e) {
    if (!url.pathname.endsWith("/health") && !url.pathname.endsWith("/meta")) {
      return bad("Die Datenbank ist noch nicht verbunden. Bitte die D1-Datenbank anlegen und die database_id in wrangler.toml eintragen.", 503, "db_missing");
    }
  }

  const ctx = {
    request, env, execCtx, user, db, params: route.params, url,
    query: Object.fromEntries(url.searchParams),
    body: async () => {
      try { return await request.json(); } catch (e) { return {}; }
    },
    role: async () => roleFor(db, env, user.username),
    require: async (action) => {
      const role = await roleFor(db, env, user.username);
      if (!can(role, action)) throw new Forbidden(action, role);
      return role;
    },
    audit: (entry) => audit(db, { username: user.username, ...entry }),
  };

  try {
    return await route.handler(ctx);
  } catch (e) {
    if (e instanceof Forbidden) return bad(`Für „${e.action}“ fehlt die Berechtigung (Rolle: ${e.role}).`, 403, "forbidden");
    if (e instanceof DbMissing) return bad(e.message, 503, "db_missing");
    console.log("api_error", url.pathname, e && e.message, e && e.stack);
    return bad(`Serverfehler: ${(e && e.message) || e}`, 500, "server_error");
  }
}

class Forbidden extends Error {
  constructor(action, role) {
    super("forbidden");
    this.action = action;
    this.role = role;
  }
}

export { uuidv7 };
