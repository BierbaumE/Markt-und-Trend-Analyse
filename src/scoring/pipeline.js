// Berechnet einen Zyklus: Merkmale -> Perzentile je Land -> TMS/SDI/Lebenszyklus/MRS -> Snapshots.
// Alle Perzentile entstehen innerhalb eines Landes (INV-01).
import S from "../../config/scoring.js";
import { COUNTRIES } from "../../config/countries/index.js";
import { Db, parseJson } from "../core/db.js";
import { uuidv7, nowIso } from "../core/ids.js";
import * as T from "./trend.js";
import * as C from "./creator.js";
import { percentileRank, winsorize, clamp01, stddev, median } from "./stats.js";

const SENSOR_OF_SOURCE = {}; // wird aus der Tabelle source gefuellt

export async function runCycle(env, { countries = null, runId = uuidv7() } = {}) {
  const db = new Db(env);
  const cycle = await ensureCycle(db);
  const sources = await db.all("SELECT key, sensor, reliability_weight FROM source WHERE enabled = 1");
  for (const s of sources) SENSOR_OF_SOURCE[s.key] = s;

  const codes = countries || (await db.all("SELECT code FROM country WHERE enabled = 1")).map((r) => r.code);
  const result = { cycleId: cycle.id, runId, countries: {} };

  // Aufmerksamkeitsanteile je Land fuer den Cultural Lift (leave-one-out)
  const shares = {};
  for (const code of codes) shares[code] = await conceptShares(db, code);

  for (const code of codes) {
    const trends = await db.all("SELECT * FROM trend WHERE country_code = ?", code);
    const computed = [];
    for (const trend of trends) {
      const conceptIds = parseJson(trend.concept_ids, []);
      const primary = conceptIds[0];
      if (!primary) continue;
      const series = await seriesBySource(db, code, primary);
      if (!Object.keys(series).length) continue;

      const bySource = {};
      for (const [sourceKey, points] of Object.entries(series)) bySource[sourceKey] = T.featuresForSource(points);
      const weights = countryWeights(code);
      const agg = T.aggregateSources(bySource, weights);

      // z-Werte der Velocity je Quelle innerhalb Land+Quelle
      const velocityZ = {};
      const sensorZ = {};
      for (const [sourceKey, f] of Object.entries(bySource)) {
        const population = await velocityPopulation(db, code, sourceKey);
        const sd = stddev(population) || 1;
        const m = median(population) || 0;
        const z = (f.velocity - m) / sd;
        velocityZ[sourceKey] = z;
        const sensor = (SENSOR_OF_SOURCE[sourceKey] || {}).sensor;
        if (sensor) sensorZ[sensor] = Math.max(sensorZ[sensor] ?? -Infinity, z);
      }

      const cross = T.crossSourceConfirmation(bySource, velocityZ, weights);
      const shareLocal = (shares[code] || {})[primary] ?? 0;
      const others = codes.filter((c) => c !== code).map((c) => (shares[c] || {})[primary] ?? 0);
      const cliLevel = T.culturalLift(shareLocal, others);

      computed.push({ trend, conceptIds, primary, bySource, agg, velocityZ, sensorZ, cross, cliLevel });
    }

    // Perzentile innerhalb des Landes
    const pop = (field) => winsorize(computed.map((c) => c.agg[field]), S.features.winsor);
    const velocities = pop("velocity");
    const accelerations = pop("acceleration");
    const novelties = pop("novelty");
    const levels = pop("level");
    const clis = winsorize(computed.map((c) => c.cliLevel), S.features.winsor);

    const rows = [];
    for (let i = 0; i < computed.length; i++) {
      const c = computed[i];
      const velocityPct = percentileRank(velocities[i], velocities);
      const accelerationPct = percentileRank(accelerations[i], accelerations);
      const noveltyPct = percentileRank(novelties[i], novelties);
      const levelPct = percentileRank(levels[i], levels);
      const cliDeltaPct = percentileRank(clis[i], clis);
      const commercialPct = await commercialSignal(db, code, c.primary);

      const scoreT = T.tms({ velocityPct, accelerationPct, crossSource: c.cross.value, noveltyPct, cliDeltaPct, persistence: c.agg.persistence, commercialPct });
      const dis = T.sdi(c.velocityZ);
      const pattern = T.divergencePattern(c.sensorZ);

      // Lebenszyklus: Filter ueber die letzten Wochen, damit sich eine Historie bildet
      let post = null;
      for (let step = 0; step < 6; step++) {
        post = T.lifecycleStep(post ? Object.values(post.posterior) : null, {
          level: levelPct, velocity: velocityPct, acceleration: accelerationPct,
          crossSource: c.cross.value, persistence: c.agg.persistence,
        }, {
          seasonalityUnadjusted: c.agg.seasonalityUnadjusted,
          lowCoverage: scoreT.coverage < S.tms.minCoverageForTrendClasses,
          ukProxy: code === "GB-ENG",
        });
      }

      const rel = await relevanceComponents(db, code, c.conceptIds, commercialPct);
      const scoreM = T.mrs(rel);
      const prio = T.priority(scoreT.value, scoreM.value, post.confidence);
      const weak = T.weakSignal({ accelerationPct, noveltyPct, levelPct, persistence: c.agg.persistence });

      const explanations = T.explainTrend({
        velocityPct, accelerationPct, crossSource: c.cross.value, cliLevel: c.cliLevel,
        weakSignal: weak, coverage: scoreT.coverage, seasonalityUnadjusted: c.agg.seasonalityUnadjusted,
      });
      if (pattern) explanations.push(`! ${T.DIVERGENCE_TEXT[pattern]}`);
      if (T.whatNotToDo(scoreT.value, scoreM.value)) explanations.push("! Hoher Momentum-Wert, aber geringer Memory-Bezug – Kandidat für „What not to do“.");

      rows.push([
        `INSERT INTO trend_snapshot (id, trend_id, cycle_id, country_code, velocity, acceleration, novelty, persistence,
          cross_source, cli_level, cli_delta, commercial, tms, sdi, divergence_pattern, lifecycle_class, lifecycle_posterior,
          confidence, mrs, mrs_components, priority, coverage, weak_signal, is_exploration, geo_confidence,
          opportunity_window, explanations, config_version, run_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uuidv7(), c.trend.id, cycle.id, code, c.agg.velocity, c.agg.acceleration, c.agg.novelty, c.agg.persistence,
          c.cross.value, c.cliLevel, cliDeltaPct, commercialPct, scoreT.value, dis.value, pattern,
          post.lifecycleClass, JSON.stringify(post.posterior), post.confidence, scoreM.value,
          JSON.stringify(scoreM.detail), prio, scoreT.coverage, weak ? 1 : 0, 0,
          code === "GB-ENG" ? "uk_proxy" : "high",
          JSON.stringify(T.opportunityWindow(post.lifecycleClass)), JSON.stringify(explanations),
          S.version, runId, nowIso()],
      ]);

      if (!c.trend.first_flagged_at && post.lifecycleClass !== "noise" && post.confidence >= 0.5) {
        rows.push(["UPDATE trend SET first_flagged_at = ? WHERE id = ?", [nowIso(), c.trend.id]]);
      }
    }

    // alte Snapshots dieses Zyklus ersetzen (idempotent)
    await db.run("DELETE FROM trend_snapshot WHERE country_code = ? AND cycle_id = ?", code, cycle.id);
    for (let i = 0; i < rows.length; i += 20) await db.batch(rows.slice(i, i + 20));
    result.countries[code] = { trends: rows.length };
  }

  const creators = await scoreCreators(env, db, cycle.id);
  result.creators = creators;
  return result;
}

async function ensureCycle(db) {
  const existing = await db.first("SELECT * FROM cycle ORDER BY start_date DESC LIMIT 1");
  const today = new Date();
  if (existing && new Date(existing.end_date) >= today) return existing;
  const start = new Date(today.getTime());
  const end = new Date(today.getTime() + 13 * 86400000);
  const row = { id: uuidv7(), start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) };
  await db.run("INSERT INTO cycle (id, start_date, end_date, status, created_at) VALUES (?,?,?,'computed',?)",
    row.id, row.start_date, row.end_date, nowIso());
  return row;
}

function countryWeights(code) {
  return (COUNTRIES[code] || {}).platformWeights || {};
}

async function seriesBySource(db, code, conceptId) {
  const rows = await db.all(
    "SELECT source_key, iso_week, COALESCE(value_scaled, value_raw) AS value FROM ts_point WHERE country_code = ? AND concept_id = ? ORDER BY iso_week",
    code, conceptId
  );
  const out = {};
  for (const r of rows) {
    if (!out[r.source_key]) out[r.source_key] = [];
    out[r.source_key].push({ iso_week: r.iso_week, value: Number(r.value) || 0 });
  }
  return out;
}

async function velocityPopulation(db, code, sourceKey) {
  const rows = await db.all(
    `SELECT concept_id, COALESCE(value_scaled, value_raw) AS value, iso_week
     FROM ts_point WHERE country_code = ? AND source_key = ? ORDER BY concept_id, iso_week`,
    code, sourceKey
  );
  const byConcept = new Map();
  for (const r of rows) {
    if (!byConcept.has(r.concept_id)) byConcept.set(r.concept_id, []);
    byConcept.get(r.concept_id).push(Number(r.value) || 0);
  }
  const out = [];
  for (const values of byConcept.values()) {
    if (values.length >= 6) out.push(T.featuresForSource(values.map((v, i) => ({ iso_week: String(i), value: v }))).velocity);
  }
  return out.length ? out : [0];
}

// Aufmerksamkeitsanteil je Konzept innerhalb einer Dimension (fuer Cultural Lift).
async function conceptShares(db, code) {
  const rows = await db.all(
    `SELECT t.concept_id, c.dimension, SUM(COALESCE(t.value_scaled, t.value_raw)) AS total
     FROM ts_point t JOIN concept c ON c.id = t.concept_id
     WHERE t.country_code = ? AND t.iso_week >= ?
     GROUP BY t.concept_id, c.dimension`,
    code, weekKeyOffset(-8)
  );
  const byDim = {};
  for (const r of rows) byDim[r.dimension] = (byDim[r.dimension] || 0) + Number(r.total || 0);
  const shares = {};
  for (const r of rows) {
    const denom = byDim[r.dimension] || 1;
    shares[r.concept_id] = Number(r.total || 0) / denom;
  }
  return shares;
}

function weekKeyOffset(weeks) {
  const d = new Date(Date.now() + weeks * 7 * 86400000);
  const year = d.getUTCFullYear();
  const jan = new Date(Date.UTC(year, 0, 1));
  const week = Math.max(1, Math.ceil(((d - jan) / 86400000 + 1) / 7));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

async function commercialSignal(db, code, conceptId) {
  const rows = await db.all(
    `SELECT iso_week, COALESCE(value_scaled, value_raw) AS value FROM ts_point
     WHERE country_code = ? AND concept_id = ? AND source_key IN (SELECT key FROM source WHERE sensor = 'D')
     ORDER BY iso_week`, code, conceptId
  );
  if (rows.length < 6) return null;
  const f = T.featuresForSource(rows.map((r) => ({ iso_week: r.iso_week, value: Number(r.value) || 0 })));
  return clamp01(0.5 + f.velocity * 2); // Steigung in [0,1] abgebildet
}

async function relevanceComponents(db, code, conceptIds, commercialPct) {
  const concepts = await db.all(
    `SELECT id, dimension FROM concept WHERE id IN (${conceptIds.map(() => "?").join(",") || "''"})`, ...conceptIds
  );
  const hasMoment = concepts.some((c) => c.dimension === "A");
  const techniques = concepts.filter((c) => c.dimension === "E").map((c) => c.id);

  const catalog = await db.all("SELECT product_type, moments, surfaces FROM catalog_item");
  const catalogMoments = new Set(catalog.flatMap((c) => parseJson(c.moments, [])));
  const momentIds = concepts.filter((c) => c.dimension === "A").map((c) => c.id);
  const blankFit = catalog.length ? (momentIds.some((m) => catalogMoments.has(m)) ? 0.85 : 0.35) : null;

  let finishability = null;
  if (techniques.length) {
    const ratings = await db.all(
      `SELECT rating FROM technique_compatibility WHERE technique IN (${techniques.map(() => "?").join(",")})`, ...techniques
    );
    finishability = ratings.length ? median(ratings.map((r) => r.rating)) / 3 : null;
  }

  // Personalisierung und emotionaler Zweck aus den Annotationen der Rohsignale
  const ann = await db.first(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN json_extract(payload,'$.personalization') = 1 THEN 1 ELSE 0 END) AS pers,
            SUM(CASE WHEN json_extract(payload,'$.purpose') IS NOT NULL THEN 1 ELSE 0 END) AS purp
     FROM raw_signal WHERE country_code = ? AND json_extract(payload,'$.concept_id') IN (${conceptIds.map(() => "?").join(",") || "''"})`,
    code, ...conceptIds
  );
  const n = Number(ann && ann.n) || 0;
  return {
    momentProximity: hasMoment ? 1 : 0.35,
    personalizationPotential: n ? clamp01(Number(ann.pers) / n) : null,
    emotionalMeaning: n ? clamp01(Number(ann.purp) / n) : null,
    blankFit,
    finishability,
    commercialPotential: commercialPct,
  };
}

// --- Creator-Scores ---------------------------------------------------------
export async function scoreCreators(env, db, cycleId) {
  const candidates = await db.all(
    "SELECT * FROM creator_candidate WHERE status NOT IN ('purged','suppressed','rejected')"
  );
  const catalogTypes = (await db.all("SELECT DISTINCT product_type FROM catalog_item")).map((r) => r.product_type);
  const moments = (await db.all("SELECT id FROM concept WHERE dimension = 'A'")).map((r) => r.id);
  let count = 0;

  for (const cand of candidates) {
    const evidence = await db.all(
      "SELECT id, type, observed_at, counterpart_hash, confidence, excerpt FROM evidence_item WHERE creator_candidate_id = ?",
      cand.id
    );
    const projectRows = await db.all(
      "SELECT state, concept_ids, techniques, url FROM creator_project WHERE creator_candidate_id = ?", cand.id
    );
    const projects = projectRows.map((p) => ({
      state: p.state,
      concept_ids: parseJson(p.concept_ids, []),
      techniques: parseJson(p.techniques, []),
      product_types: parseJson(p.concept_ids, []).filter((c) => String(c).startsWith("product.")),
      shown: Boolean(p.url),
      process_content: p.state === "in_progress",
    }));

    const sei = C.socialEnergyIndex({
      evidence: evidence.map((e) => ({ ...e, quality: e.confidence })),
      followers: cand.follower_count,
      bridges: null,
    });
    const cci = C.completionIndex(projects);
    const techniqueRatings = (await db.all(
      `SELECT rating FROM technique_compatibility WHERE technique IN (${
        [...new Set(projects.flatMap((p) => p.techniques))].map(() => "?").join(",") || "''"
      })`, ...[...new Set(projects.flatMap((p) => p.techniques))]
    )).map((r) => r.rating);

    const mmf = C.memoryMakerFit({
      sei: sei.value, projects, catalogProductTypes: catalogTypes, momentConcepts: moments,
      techniqueRatings, localEvents: evidence.filter((e) => e.type === "initiated_event").length,
      commercial: evidence.some((e) => e.type === "commission_request") ? 0.6 : 0.2,
    });
    const flags = C.exclusionFlags({
      bio: cand.display_name || "", posts: evidence.map((e) => e.excerpt || ""),
      followers: cand.follower_count, sei: sei.value, cci: cci.value, projects,
      commercial: evidence.some((e) => e.type === "commission_request") ? 0.6 : 0.2,
    });
    const momentShare = projects.length
      ? projects.filter((p) => p.concept_ids.some((c) => moments.includes(c))).length / projects.length
      : null;
    const explanations = C.explainCreator({
      mmf: mmf.value, sei: sei.value, cci: cci.value, components: sei.components, flags,
      momentShare, techniques: new Set(projects.flatMap((p) => p.techniques)).size,
    });

    await db.run("DELETE FROM creator_score_snapshot WHERE creator_candidate_id = ? AND cycle_id = ?", cand.id, cycleId);
    await db.run(
      `INSERT INTO creator_score_snapshot (id, creator_candidate_id, cycle_id, sei, cci, mmf, components, coverage,
        exclusion_flags, explanations, config_version, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      uuidv7(), cand.id, cycleId, sei.value, cci.value, mmf.value,
      JSON.stringify({ sei: sei.components, mmf: mmf.components, cci: cci.detail || null }),
      Math.min(sei.coverage, mmf.coverage), JSON.stringify(flags), JSON.stringify(explanations),
      S.version, nowIso()
    );

    if (cand.status === "discovered" && sei.value !== null && mmf.value !== null && mmf.value >= 55 && !flags.includes("mlm_recruiter_signal")) {
      await db.run("UPDATE creator_candidate SET status = 'scout_check_pending', updated_at = ? WHERE id = ?", nowIso(), cand.id);
    }
    count++;
  }
  return { scored: count };
}
