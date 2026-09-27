import { json, bad } from "../core/router.js";
import { parseJson } from "../core/db.js";
import { uuidv7, nowIso } from "../core/ids.js";
import { FLAG_TEXT, SCORECARD_FIELDS, scorecardTotals, EVIDENCE_TYPES } from "../scoring/creator.js";
import * as B from "../scoring/bridge.js";

const STATUS_LABEL = {
  discovered: "gefunden", scout_check_pending: "Scout-Check offen", shortlisted: "auf Shortlist",
  interview_planned: "Gespräch geplant", promoted_to_crm: "im CRM", rejected: "verworfen",
  suppressed: "Widerspruch", purged: "gelöscht",
};

const ALLOWED_TRANSITIONS = {
  discovered: ["scout_check_pending", "rejected", "suppressed"],
  scout_check_pending: ["shortlisted", "rejected", "suppressed"],
  shortlisted: ["interview_planned", "rejected", "suppressed"],
  interview_planned: ["promoted_to_crm", "rejected", "suppressed"],
  promoted_to_crm: ["suppressed"],
  rejected: ["suppressed"],
};

export function registerCreatorRoutes(router) {
  router.get("/api/v1/creators/meta", async () =>
    json({ evidenceTypes: EVIDENCE_TYPES, scorecardFields: SCORECARD_FIELDS, statusLabels: STATUS_LABEL, flagText: FLAG_TEXT, transitions: ALLOWED_TRANSITIONS }));

  router.get("/api/v1/creators", async (ctx) => {
    const country = ctx.query.country || "DE";
    const status = ctx.query.status;
    const params = [country];
    let sql = `SELECT c.*, s.sei, s.cci, s.mmf, s.coverage, s.exclusion_flags, s.explanations,
                      sc.raw_total, sc.weighted_total, sc.table_test
               FROM creator_candidate c
               LEFT JOIN creator_score_snapshot s ON s.creator_candidate_id = c.id
                 AND s.created_at = (SELECT MAX(created_at) FROM creator_score_snapshot WHERE creator_candidate_id = c.id)
               LEFT JOIN human_scorecard sc ON sc.creator_candidate_id = c.id
               WHERE c.country_code = ?`;
    if (status) { sql += " AND c.status = ?"; params.push(status); }
    sql += " ORDER BY COALESCE(s.mmf, 0) DESC";
    const rows = await ctx.db.all(sql, ...params);
    return json(rows.map(mapCreator));
  });

  router.get("/api/v1/creators/:id", async (ctx) => {
    const row = await ctx.db.first(
      `SELECT c.*, s.sei, s.cci, s.mmf, s.coverage, s.exclusion_flags, s.explanations, s.components,
              sc.raw_total, sc.weighted_total, sc.table_test, sc.notes AS scorecard_notes
       FROM creator_candidate c
       LEFT JOIN creator_score_snapshot s ON s.creator_candidate_id = c.id
         AND s.created_at = (SELECT MAX(created_at) FROM creator_score_snapshot WHERE creator_candidate_id = c.id)
       LEFT JOIN human_scorecard sc ON sc.creator_candidate_id = c.id
       WHERE c.id = ?`, ctx.params.id
    );
    if (!row) return bad("Kandidatin nicht gefunden", 404, "not_found");
    const evidence = await ctx.db.all(
      "SELECT id, type, url, excerpt, observed_at, captured_by, confidence FROM evidence_item WHERE creator_candidate_id = ? ORDER BY observed_at DESC",
      ctx.params.id
    );
    const projects = await ctx.db.all(
      "SELECT state, concept_ids, techniques, url, observed_at FROM creator_project WHERE creator_candidate_id = ? ORDER BY observed_at DESC",
      ctx.params.id
    );
    const scorecard = await ctx.db.first("SELECT * FROM human_scorecard WHERE creator_candidate_id = ?", ctx.params.id);
    const decisions = await ctx.db.all(
      "SELECT decision, reason_code, note, username, created_at FROM review_decision WHERE subject_type='creator' AND subject_id=? ORDER BY created_at DESC",
      ctx.params.id
    );
    return json({
      ...mapCreator(row),
      components: parseJson(row.components, {}),
      evidence,
      projects: projects.map((p) => ({ ...p, concept_ids: parseJson(p.concept_ids, []), techniques: parseJson(p.techniques, []) })),
      scorecard: scorecard || null,
      decisions,
    });
  });

  // Statuswechsel: nur erlaubte Übergänge, immer mit Begründung, immer protokolliert (INV-05).
  router.post("/api/v1/creators/:id/decision", async (ctx) => {
    await ctx.require("creator.decide");
    const body = await ctx.body();
    const cand = await ctx.db.first("SELECT status, platform, handle FROM creator_candidate WHERE id = ?", ctx.params.id);
    if (!cand) return bad("Kandidatin nicht gefunden", 404, "not_found");
    const target = body.status;
    const allowed = ALLOWED_TRANSITIONS[cand.status] || [];
    if (!allowed.includes(target)) {
      return bad(`Übergang ${cand.status} → ${target} ist nicht vorgesehen.`, 409, "invalid_transition");
    }
    if (target === "promoted_to_crm" && !body.legal_basis) {
      return bad("Für die Übernahme ins CRM ist die Rechtsgrundlage anzugeben (Art.-14-Hinweis).", 400, "legal_basis_required");
    }
    await ctx.db.run("UPDATE creator_candidate SET status = ?, updated_at = ? WHERE id = ?", target, nowIso(), ctx.params.id);
    await ctx.db.run(
      "INSERT INTO review_decision (id, subject_type, subject_id, decision, reason_code, note, username, created_at) VALUES (?,'creator',?,?,?,?,?,?)",
      uuidv7(), ctx.params.id, target, body.reason_code || null, body.note || null, ctx.user.username, nowIso()
    );
    if (target === "promoted_to_crm") {
      const full = await ctx.db.first("SELECT * FROM creator_candidate WHERE id = ?", ctx.params.id);
      const existing = await ctx.db.first("SELECT id FROM crm_contact WHERE creator_candidate_id = ?", ctx.params.id);
      if (!existing) {
        const contactId = uuidv7();
        await ctx.db.run(
          `INSERT INTO crm_contact (id, creator_candidate_id, country_code, name, brand_label, contact_channel, legal_basis,
             art14_notice_sent_at, owner_username, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?, 'active', ?, ?)`,
          contactId, ctx.params.id, full.country_code, full.display_name || full.handle, full.handle,
          `${full.platform}:${full.handle}`, body.legal_basis, body.art14_notice_sent_at || null,
          ctx.user.username, nowIso(), nowIso()
        );
        await ctx.db.run(
          "INSERT INTO crm_task (id, subject_type, subject_id, title, due_at, assignee_username, status, origin, created_by, created_at, updated_at) VALUES (?,'contact',?,?,?,?, 'open','system_rule',?,?,?)",
          uuidv7(), contactId, "Art.-14-Hinweis beim Erstkontakt mitschicken",
          new Date(Date.now() + 3 * 86400000).toISOString(), ctx.user.username, ctx.user.username, nowIso(), nowIso()
        );
      }
    }
    if (target === "suppressed") {
      const hash = await hashHandle(ctx.env, cand.platform, cand.handle);
      await ctx.db.run(
        "INSERT OR IGNORE INTO suppression_entry (id, platform, handle_hash, reason_code, created_at) VALUES (?,?,?,?,?)",
        uuidv7(), cand.platform, hash, body.reason_code || "objection", nowIso()
      );
    }
    await ctx.audit({ action: "creator.decision", subjectType: "creator", subjectId: ctx.params.id, detail: { from: cand.status, to: target } });
    return json({ ok: true, status: target });
  });

  router.put("/api/v1/creators/:id/scorecard", async (ctx) => {
    await ctx.require("creator.capture");
    const body = await ctx.body();
    const totals = scorecardTotals(body);
    const values = SCORECARD_FIELDS.map((f) => Math.max(0, Math.min(3, Number(body[f]) || 0)));
    await ctx.db.run(
      `INSERT INTO human_scorecard (creator_candidate_id, makes, shows, tries, helps, connects, encourages, initiates,
         relationship, sales_open, learning_open, raw_total, weighted_total, table_test, notes, scout_username, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(creator_candidate_id) DO UPDATE SET
         makes=excluded.makes, shows=excluded.shows, tries=excluded.tries, helps=excluded.helps,
         connects=excluded.connects, encourages=excluded.encourages, initiates=excluded.initiates,
         relationship=excluded.relationship, sales_open=excluded.sales_open, learning_open=excluded.learning_open,
         raw_total=excluded.raw_total, weighted_total=excluded.weighted_total, table_test=excluded.table_test,
         notes=excluded.notes, scout_username=excluded.scout_username, updated_at=excluded.updated_at`,
      ctx.params.id, ...values, totals.raw, totals.weighted, body.table_test ? 1 : 0,
      body.notes || null, ctx.user.username, nowIso()
    );
    await ctx.audit({ action: "creator.scorecard", subjectType: "creator", subjectId: ctx.params.id, detail: totals });
    return json({ ok: true, ...totals });
  });

  // Scout-Capture: Evidenz erfassen. Pflicht: öffentlich und auf kreative Arbeit bezogen.
  router.post("/api/v1/creators/:id/evidence", async (ctx) => {
    await ctx.require("creator.capture");
    const body = await ctx.body();
    if (!body.type || !EVIDENCE_TYPES.includes(body.type)) return bad("Unbekannter Evidenztyp");
    if (!body.public_professional || !body.creative_work_related) {
      return bad("Evidenz muss öffentlich-professionell und auf kreative Arbeit bezogen sein.", 400, "evidence_scope");
    }
    await ctx.db.run(
      `INSERT INTO evidence_item (id, creator_candidate_id, type, url, excerpt, observed_at, captured_by,
         public_professional, creative_work_related, counterpart_hash, confidence, created_at)
       VALUES (?,?,?,?,?,?,?,1,1,?,?,?)`,
      uuidv7(), ctx.params.id, body.type, body.url || null, (body.excerpt || "").slice(0, 280),
      body.observed_at || nowIso(), `scout:${ctx.user.username}`,
      body.counterpart_hash || null, body.confidence ?? null, nowIso()
    );
    await ctx.audit({ action: "creator.evidence", subjectType: "creator", subjectId: ctx.params.id, detail: { type: body.type } });
    return json({ ok: true });
  });

  // Abgeleitetes Profil, passende Trends und belegte Gesprächsanlässe (SPEC 11.14/11.15).
  router.get("/api/v1/creators/:id/bridges", async (ctx) => {
    const cand = await ctx.db.first("SELECT * FROM creator_candidate WHERE id = ?", ctx.params.id);
    if (!cand) return bad("Kandidatin nicht gefunden", 404, "not_found");
    const score = await ctx.db.first(
      "SELECT sei, mmf FROM creator_score_snapshot WHERE creator_candidate_id = ? ORDER BY created_at DESC LIMIT 1",
      ctx.params.id
    );
    const projectRows = await ctx.db.all(
      "SELECT state, concept_ids, techniques, observed_at FROM creator_project WHERE creator_candidate_id = ?", ctx.params.id
    );
    const projects = projectRows.map((p) => ({
      state: p.state, observed_at: p.observed_at,
      concept_ids: parseJson(p.concept_ids, []), techniques: parseJson(p.techniques, []),
    }));
    const evidence = await ctx.db.all(
      "SELECT id, type, url, observed_at FROM evidence_item WHERE creator_candidate_id = ? ORDER BY observed_at DESC", ctx.params.id
    );

    const conceptRows = await ctx.db.all("SELECT id, dimension, label_de FROM concept");
    const conceptIndex = Object.fromEntries(conceptRows.map((c) => [c.id, c]));
    const profile = B.creatorProfile(projects, conceptIndex);

    const catalogRows = await ctx.db.all("SELECT sku, name, product_type, surfaces, moments FROM catalog_item");
    const catalog = catalogRows.map((c) => ({ ...c, surfaces: parseJson(c.surfaces, []), moments: parseJson(c.moments, []) }));
    const compatibility = await ctx.db.all("SELECT surface, technique, rating FROM technique_compatibility");

    // Trends des Landes mit ihrer jeweils neuesten Bewertung
    const trends = await ctx.db.all(
      `SELECT t.id, t.label_de, t.label_local, t.concept_ids, s.tms, s.mrs, s.priority, s.cli_level,
              s.lifecycle_class, s.confidence, s.opportunity_window
       FROM trend t
       LEFT JOIN trend_snapshot s ON s.id = (
         SELECT id FROM trend_snapshot x WHERE x.trend_id = t.id ORDER BY x.created_at DESC LIMIT 1)
       WHERE t.country_code = ?`, cand.country_code
    );
    const priorities = trends.map((t) => Number(t.priority) || 0);
    const maxPriority = Math.max(...priorities, 1);

    const matches = [];
    for (const tr of trends) {
      const conceptIds = parseJson(tr.concept_ids, []);
      const aff = B.affinity(profile, conceptIds, conceptIndex);
      if (!aff.coveredWeight) continue;
      const tcb = B.bridgeScore({
        affinityValue: aff.value, sei: score && score.sei, mmf: score && score.mmf,
        priorityNorm: (Number(tr.priority) || 0) / maxPriority, lastActivityDays: profile.lastActivityDays,
      });
      const catalogMatch = B.matchCatalogItem(catalog, conceptIds, profile);
      const technique = B.techniqueBridge(profile, catalogMatch && catalogMatch.item, compatibility);
      const hook = B.buildHook({
        creator: cand, profile, trend: tr, snapshot: tr, catalogMatch, technique,
        evidence, country: cand.country_code, conceptIndex,
      });
      matches.push({
        trendId: tr.id, label: tr.label_de, labelLocal: tr.label_local,
        affinity: Math.round(aff.value * 100) / 100,
        overlap: aff.overlap,
        tcb: tcb.value,
        qualifies: B.qualifies({ affinityValue: aff.value, sei: score && score.sei }),
        lifecycle: tr.lifecycle_class,
        opportunityWindow: parseJson(tr.opportunity_window, null),
        hook,
      });
    }
    matches.sort((a, b2) => b2.tcb - a.tcb);

    return json({
      creator: { id: cand.id, name: cand.display_name || cand.handle, handle: cand.handle, country: cand.country_code },
      profile: {
        dimensions: Object.fromEntries(Object.entries(profile.dimensions).map(([k, v]) => [k, v.slice(0, 6)])),
        finished: profile.finished, projects: profile.projects, lastActivityDays: profile.lastActivityDays,
      },
      sei: score && score.sei, mmf: score && score.mmf,
      matches: matches.slice(0, 5),
      note: "Gesprächsanlässe sind Entwürfe. Sie gehen erst nach menschlicher Freigabe hinaus; der Versand erfolgt außerhalb des Systems.",
    });
  });

  router.post("/api/v1/creators", async (ctx) => {
    await ctx.require("creator.capture");
    const body = await ctx.body();
    if (!body.handle || !body.platform || !body.country_code) return bad("handle, platform und country_code sind nötig");
    const hash = await hashHandle(ctx.env, body.platform, body.handle);
    const blocked = await ctx.db.first("SELECT id FROM suppression_entry WHERE platform = ? AND handle_hash = ?", body.platform, hash);
    if (blocked) return bad("Für dieses Profil liegt ein Widerspruch vor. Es darf nicht erneut erfasst werden.", 409, "suppressed");
    const id = uuidv7();
    await ctx.db.run(
      `INSERT INTO creator_candidate (id, country_code, platform, handle, public_url, display_name, region,
         creative_categories, follower_count, discovered_via, discovered_at, purge_after, status, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'scout_check_pending', ?)`,
      id, body.country_code, body.platform, body.handle, body.public_url || null, body.display_name || null,
      body.region || null, JSON.stringify(body.creative_categories || []), body.follower_count ?? null,
      `scout:${ctx.user.username}`, nowIso(), new Date(Date.now() + 90 * 86400000).toISOString(), nowIso()
    );
    await ctx.audit({ action: "creator.create", subjectType: "creator", subjectId: id });
    return json({ ok: true, id });
  });
}

function mapCreator(r) {
  return {
    id: r.id, country: r.country_code, platform: r.platform, handle: r.handle, url: r.public_url,
    name: r.display_name, region: r.region, categories: parseJson(r.creative_categories, []),
    followers: r.follower_count, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status,
    sei: r.sei, cci: r.cci, mmf: r.mmf, coverage: r.coverage,
    flags: parseJson(r.exclusion_flags, []),
    flagTexts: parseJson(r.exclusion_flags, []).map((f) => FLAG_TEXT[f] || f),
    explanations: parseJson(r.explanations, []),
    scorecard: r.raw_total === null || r.raw_total === undefined ? null
      : { raw: r.raw_total, weighted: r.weighted_total, tableTest: Boolean(r.table_test) },
    purgeAfter: r.purge_after,
  };
}

// Widerspruchsliste speichert nur einen gesalzenen Hash, nie das Profil (INV-13).
async function hashHandle(env, platform, handle) {
  const salt = env.HASH_SALT || "radar-dev-salt";
  const data = new TextEncoder().encode(`${salt}:${platform}:${String(handle).toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
