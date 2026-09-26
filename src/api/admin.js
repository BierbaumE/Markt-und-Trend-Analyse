import { json, bad } from "../core/router.js";
import { ROLES } from "../core/rbac.js";
import { nowIso } from "../core/ids.js";
import { seedDemo } from "../simulator/seed.js";
import { runCycle } from "../scoring/pipeline.js";
import RUNTIME from "../../config/runtime.js";

export function registerAdminRoutes(router) {
  router.get("/api/v1/admin/users", async (ctx) => {
    await ctx.require("admin.manage");
    const rows = await ctx.db.all("SELECT username, role, updated_at FROM radar_user_role ORDER BY username");
    return json({ users: rows, roles: ROLES, adminUsers: (ctx.env.ADMIN_USERS || "").split(",").map((s) => s.trim()).filter(Boolean) });
  });

  router.put("/api/v1/admin/users/:username", async (ctx) => {
    await ctx.require("admin.manage");
    const body = await ctx.body();
    if (!ROLES.includes(body.role)) return bad("Unbekannte Rolle");
    await ctx.db.run(
      "INSERT INTO radar_user_role (username, role, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(username) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at",
      ctx.params.username, body.role, nowIso(), nowIso()
    );
    await ctx.audit({ action: "admin.role", subjectType: "user", subjectId: ctx.params.username, detail: { role: body.role } });
    return json({ ok: true });
  });

  router.get("/api/v1/admin/sources", async (ctx) => {
    const rows = await ctx.db.all("SELECT * FROM source ORDER BY sensor, key");
    return json(rows);
  });

  // Szenario-Simulator: erzeugt nachvollziehbare Demodaten (SPEC 18.1).
  router.post("/api/v1/admin/seed", async (ctx) => {
    await ctx.require("admin.manage");
    const body = await ctx.body();
    const result = await seedDemo(ctx.env, { countries: body.countries || ["DE", "SE"] });
    await ctx.audit({ action: "admin.seed", detail: result });
    return json({ ok: true, ...result });
  });

  // Zyklus berechnen: Merkmale, TMS, SDI, Lebenszyklus, MRS, Creator-Scores.
  router.post("/api/v1/admin/recompute", async (ctx) => {
    await ctx.require("admin.manage");
    const body = await ctx.body();
    const result = await runCycle(ctx.env, { countries: body.countries || null });
    await ctx.audit({ action: "admin.recompute", detail: { countries: Object.keys(result.countries || {}) } });
    return json({ ok: true, ...result });
  });

  router.get("/api/v1/admin/audit", async (ctx) => {
    await ctx.require("admin.manage");
    const rows = await ctx.db.all("SELECT username, action, subject_type, subject_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT 100");
    return json(rows);
  });

  router.get("/api/v1/admin/runtime", async (ctx) => {
    await ctx.require("admin.manage");
    return json(RUNTIME);
  });
}
