import { json, bad } from "../core/router.js";
import { parseJson } from "../core/db.js";
import { uuidv7, nowIso } from "../core/ids.js";
import { DIVERGENCE_TEXT } from "../scoring/trend.js";

const LIFECYCLE_LABEL = {
  noise: "verworfen", emerging_signal: "frühes Signal", corroborated_signal: "bestätigtes Signal",
  emerging_trend: "entstehender Trend", established: "etabliert", saturating: "sättigt", declining: "rückläufig",
};

export function registerTrendRoutes(router) {
  router.get("/api/v1/trends", async (ctx) => {
    const country = ctx.query.country || "DE";
    const rows = await ctx.db.all(
      `SELECT t.id, t.label_de, t.label_local, t.concept_ids, t.first_flagged_at,
              s.tms, s.mrs, s.priority, s.sdi, s.divergence_pattern, s.lifecycle_class, s.confidence,
              s.coverage, s.weak_signal, s.geo_confidence, s.opportunity_window, s.explanations, s.cli_level,
              s.velocity, s.acceleration, s.cycle_id
       FROM trend t
       LEFT JOIN trend_snapshot s ON s.trend_id = t.id
         AND s.cycle_id = (SELECT id FROM cycle ORDER BY start_date DESC LIMIT 1)
       WHERE t.country_code = ?
       ORDER BY COALESCE(s.priority, -1) DESC`,
      country
    );
    const decisions = await ctx.db.all(
      `SELECT subject_id, decision, reason_code, note, username, created_at FROM review_decision
       WHERE subject_type = 'trend' ORDER BY created_at DESC`
    );
    const latest = new Map();
    for (const d of decisions) if (!latest.has(d.subject_id)) latest.set(d.subject_id, d);

    return json(rows.map((r) => ({
      id: r.id,
      label: r.label_de,
      labelLocal: r.label_local,
      concepts: parseJson(r.concept_ids, []),
      tms: r.tms, mrs: r.mrs, priority: r.priority, sdi: r.sdi,
      divergence: r.divergence_pattern,
      divergenceText: r.divergence_pattern ? DIVERGENCE_TEXT[r.divergence_pattern] : null,
      lifecycle: r.lifecycle_class,
      lifecycleLabel: LIFECYCLE_LABEL[r.lifecycle_class] || r.lifecycle_class,
      confidence: r.confidence, coverage: r.coverage,
      weakSignal: Boolean(r.weak_signal),
      geoConfidence: r.geo_confidence,
      cliLevel: r.cli_level,
      opportunityWindow: parseJson(r.opportunity_window, null),
      explanations: parseJson(r.explanations, []),
      firstFlaggedAt: r.first_flagged_at,
      review: latest.get(r.id) || null,
      scored: r.tms !== null && r.tms !== undefined,
    })));
  });

  router.get("/api/v1/trends/:id", async (ctx) => {
    const trend = await ctx.db.first("SELECT * FROM trend WHERE id = ?", ctx.params.id);
    if (!trend) return bad("Trend nicht gefunden", 404, "not_found");
    const snapshot = await ctx.db.first(
      "SELECT * FROM trend_snapshot WHERE trend_id = ? ORDER BY created_at DESC LIMIT 1", trend.id
    );
    const concepts = parseJson(trend.concept_ids, []);
    const series = await ctx.db.all(
      `SELECT source_key, iso_week, COALESCE(value_scaled, value_raw) AS value FROM ts_point
       WHERE country_code = ? AND concept_id = ? ORDER BY iso_week`,
      trend.country_code, concepts[0] || ""
    );
    const bySource = {};
    for (const r of series) {
      if (!bySource[r.source_key]) bySource[r.source_key] = [];
      bySource[r.source_key].push({ week: r.iso_week, value: Math.round(Number(r.value) * 10) / 10 });
    }
    const conceptRows = concepts.length
      ? await ctx.db.all(`SELECT id, dimension, label_de FROM concept WHERE id IN (${concepts.map(() => "?").join(",")})`, ...concepts)
      : [];
    const bridges = await ctx.db.all(
      `SELECT c.id, c.handle, c.display_name, c.region, s.mmf, s.sei
       FROM creator_candidate c
       LEFT JOIN creator_score_snapshot s ON s.creator_candidate_id = c.id
       WHERE c.country_code = ? AND c.status NOT IN ('rejected','purged','suppressed')
       ORDER BY COALESCE(s.mmf, 0) DESC LIMIT 5`,
      trend.country_code
    );
    const decisions = await ctx.db.all(
      "SELECT decision, reason_code, note, username, created_at FROM review_decision WHERE subject_type='trend' AND subject_id=? ORDER BY created_at DESC",
      trend.id
    );

    return json({
      id: trend.id, country: trend.country_code, label: trend.label_de, labelLocal: trend.label_local,
      concepts: conceptRows, series: bySource,
      snapshot: snapshot ? {
        ...snapshot,
        lifecycleLabel: LIFECYCLE_LABEL[snapshot.lifecycle_class] || snapshot.lifecycle_class,
        divergenceText: snapshot.divergence_pattern ? DIVERGENCE_TEXT[snapshot.divergence_pattern] : null,
        explanations: parseJson(snapshot.explanations, []),
        mrsComponents: parseJson(snapshot.mrs_components, {}),
        posterior: parseJson(snapshot.lifecycle_posterior, {}),
        opportunityWindow: parseJson(snapshot.opportunity_window, null),
      } : null,
      creators: bridges,
      decisions,
    });
  });

  router.post("/api/v1/trends/:id/review", async (ctx) => {
    await ctx.require("trend.label");
    const body = await ctx.body();
    if (!body.decision) return bad("decision fehlt");
    await ctx.db.run(
      "INSERT INTO review_decision (id, subject_type, subject_id, decision, reason_code, note, username, created_at) VALUES (?,'trend',?,?,?,?,?,?)",
      uuidv7(), ctx.params.id, body.decision, body.reason_code || null, body.note || null, ctx.user.username, nowIso()
    );
    await ctx.audit({ action: "trend.review", subjectType: "trend", subjectId: ctx.params.id, detail: { decision: body.decision } });
    return json({ ok: true });
  });
}
