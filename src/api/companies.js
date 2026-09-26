import { json, bad } from "../core/router.js";
import { parseJson } from "../core/db.js";
import { uuidv7, nowIso } from "../core/ids.js";

export function registerCompanyRoutes(router) {
  router.get("/api/v1/companies", async (ctx) => {
    const country = ctx.query.country || "DE";
    const rows = await ctx.db.all(
      `SELECT c.*, s.cos, s.gap_hypothesis, s.recommended_skus, s.reasons, s.components
       FROM company_candidate c
       LEFT JOIN company_score_snapshot s ON s.company_candidate_id = c.id
         AND s.created_at = (SELECT MAX(created_at) FROM company_score_snapshot WHERE company_candidate_id = c.id)
       WHERE c.country_code = ? ORDER BY COALESCE(s.cos, 0) DESC`, country
    );
    return json(rows.map((r) => ({
      id: r.id, name: r.name, website: r.website, category: r.category, region: r.region,
      status: r.status, cos: r.cos, gap: r.gap_hypothesis,
      skus: parseJson(r.recommended_skus, []), reasons: parseJson(r.reasons, []),
      components: parseJson(r.components, {}),
    })));
  });

  // Qualifizierung: aus dem Radar wird ein Unternehmen im CRM (nur durch Menschen).
  router.post("/api/v1/companies/:id/qualify", async (ctx) => {
    await ctx.require("company.decide");
    const cand = await ctx.db.first("SELECT * FROM company_candidate WHERE id = ?", ctx.params.id);
    if (!cand) return bad("Unternehmen nicht gefunden", 404, "not_found");
    const existing = await ctx.db.first("SELECT id FROM crm_company WHERE company_candidate_id = ?", ctx.params.id);
    if (existing) return json({ ok: true, id: existing.id, already: true });
    const id = uuidv7();
    await ctx.db.run(
      `INSERT INTO crm_company (id, company_candidate_id, country_code, name, website, category, stage, owner_username, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'qualified', ?,?,?)`,
      id, cand.id, cand.country_code, cand.name, cand.website, cand.category, ctx.user.username, nowIso(), nowIso()
    );
    await ctx.db.run("UPDATE company_candidate SET status = 'qualified', updated_at = ? WHERE id = ?", nowIso(), cand.id);
    await ctx.audit({ action: "company.qualify", subjectType: "company", subjectId: cand.id });
    return json({ ok: true, id });
  });
}
