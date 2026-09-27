// Trend-Scoring (SPEC 11.1-11.6, 11.17). Reine Funktionen: Daten rein, Score + Erklaerung raus.
import S from "../../config/scoring.js";
import { slopeOfSeries, decompose, robustZ, changePoint, percentileRank, clamp01, stddev, betaPdf, median } from "./stats.js";

// --- Merkmale je Quelle -----------------------------------------------------
// series: [{ iso_week, value }] aufsteigend sortiert, eine Quelle, ein Land.
export function featuresForSource(series) {
  const f = S.features;
  const values = series.map((p) => p.value);
  const dec = decompose(series);
  const resid = dec.residual;
  const logSeries = values.map((v) => Math.log1p(Math.max(0, v)));

  const velocity = slopeOfSeries(values.slice(-f.velocityWindowWeeks));
  const recent = slopeOfSeries(values.slice(-f.accelerationWindowWeeks));
  const previous = slopeOfSeries(values.slice(-2 * f.accelerationWindowWeeks, -f.accelerationWindowWeeks));
  const acceleration = recent - previous;

  const history = resid.slice(0, -1);
  let novelty = Math.max(0, robustZ(resid[resid.length - 1], history.length ? history : resid));
  const cp = changePoint(resid.slice(-16));
  if (cp && cp.significant && cp.index >= resid.slice(-16).length - 6) novelty += 0.5;
  novelty = Math.min(8, novelty); // Deckel gegen extreme Werte bei sehr glatten Reihen

  const lastResid = resid.slice(-f.persistenceWindowWeeks);
  const persistence = lastResid.length ? lastResid.filter((r) => r > 0).length / lastResid.length : 0;

  return {
    velocity,
    acceleration,
    novelty,
    persistence,
    level: values.length ? values[values.length - 1] : 0,
    logLevel: logSeries.length ? logSeries[logSeries.length - 1] : 0,
    seasonalityMethod: dec.method,
    points: values.length,
  };
}

// bySource: { sourceKey: featuresForSource(...) }, weights: { sourceKey: reliability }
export function aggregateSources(bySource, weights = {}) {
  const keys = Object.keys(bySource);
  if (!keys.length) return null;
  const w = (k) => (weights[k] === undefined ? 1 : weights[k]);
  const sum = keys.reduce((s, k) => s + w(k), 0) || 1;
  const wavg = (field) => keys.reduce((s, k) => s + w(k) * (bySource[k][field] || 0), 0) / sum;
  return {
    velocity: wavg("velocity"),
    acceleration: wavg("acceleration"),
    novelty: wavg("novelty"),
    persistence: wavg("persistence"),
    level: wavg("level"),
    sourceCount: keys.length,
    seasonalityUnadjusted: keys.every((k) => bySource[k].seasonalityMethod === "none"),
  };
}

// Cross-Source Confirmation: Anteil der Quellen mit deutlich positiver Velocity.
export function crossSourceConfirmation(bySource, velocityZBySource, weights = {}) {
  const keys = Object.keys(bySource);
  if (keys.length < 2) return { value: 0.5, capped: true };
  const w = (k) => (weights[k] === undefined ? 1 : weights[k]);
  const total = keys.reduce((s, k) => s + w(k), 0) || 1;
  const hit = keys.reduce((s, k) => s + (velocityZBySource[k] > S.features.crossSourceZThreshold ? w(k) : 0), 0);
  return { value: clamp01(hit / total), capped: false };
}

// Cultural Lift: lokaler Aufmerksamkeitsanteil gegen den Mittelwert der uebrigen Laender (leave-one-out).
export function culturalLift(shareLocal, sharesOtherCountries) {
  const eps = S.features.cliEpsilon;
  const others = sharesOtherCountries.filter(Number.isFinite);
  const shareEu = others.length ? others.reduce((s, v) => s + v, 0) / others.length : 0;
  return Math.log2((shareLocal + eps) / (shareEu + eps));
}

// --- Trend Momentum Score ---------------------------------------------------
// input: Perzentilwerte bzw. 0..1-Werte; null = keine Daten (wird renormiert, nie als 0 gewertet)
export function tms(parts) {
  const w = S.tms.weights;
  const map = {
    velocity: parts.velocityPct, acceleration: parts.accelerationPct, crossSource: parts.crossSource,
    novelty: parts.noveltyPct, culturalLift: parts.cliDeltaPct, persistence: parts.persistence, commercial: parts.commercialPct,
  };
  let weighted = 0;
  let coverage = 0;
  const contributions = {};
  for (const [key, weight] of Object.entries(w)) {
    const v = map[key];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    weighted += weight * clamp01(v);
    coverage += weight;
    contributions[key] = Math.round(weight * clamp01(v) * 1000) / 10;
  }
  if (!coverage) return { value: null, coverage: 0, contributions };
  return { value: Math.round((weighted / coverage) * 1000) / 10, coverage: Math.round(coverage * 100) / 100, contributions };
}

export function weakSignal({ accelerationPct, noveltyPct, levelPct, persistence }) {
  const c = S.weakSignal;
  return accelerationPct >= c.accelerationPct && noveltyPct >= c.noveltyPct && levelPct <= c.maxLevelPct && persistence >= c.minPersistence;
}

// --- Signal Disagreement ----------------------------------------------------
export function sdi(velocityZBySource) {
  const zs = Object.values(velocityZBySource).filter(Number.isFinite);
  if (zs.length < 2) return { value: null, pattern: null };
  const value = Math.round(Math.min(1, stddev(zs) / 2) * 1000) / 10;
  return { value, pattern: divergencePattern(velocityZBySource) };
}

// Sensorrollen bleiben getrennt: Pinterest = Planung, Google = Nachfrage,
// TikTok = kulturelle Dynamik, Etsy = Kaufnaehe (SPEC 9.2).
// Die Richtung kommt aus dem Perzentilrang innerhalb der Quelle. Das ist bei wenigen
// Vergleichswerten belastbarer als ein z-Wert, der dort kaum je eine Schwelle reisst.
export function divergencePattern(pctBySensor) {
  const p = S.sdi.directionPct;
  const dir = (v) => (v === undefined || v === null ? null : v >= p.strongUp ? 2 : v >= p.up ? 1 : v <= p.down ? -1 : 0);
  const a = dir(pctBySensor.A), b = dir(pctBySensor.B), c = dir(pctBySensor.C), e = dir(pctBySensor.D);
  if (b >= 2 && c >= 1 && (a ?? 0) <= 0 && (e ?? 0) <= 0) return "inspiration_without_commerce";
  if ((b ?? 0) <= 0 && (c ?? 0) <= 0 && a >= 1 && e >= 2) return "quiet_purchase_intent";
  if (c >= 2 && (a ?? 0) <= 0 && (b ?? 0) <= 0 && (e ?? 0) <= 0) return "cultural_hype_unconfirmed";
  if (b >= 1 && (a ?? 0) === 0) return "planning_ahead";
  return null;
}

export const DIVERGENCE_TEXT = {
  inspiration_without_commerce: "Hohe Inspirationsdynamik, bislang keine erkennbare kommerzielle Umsetzung.",
  quiet_purchase_intent: "Visuell unauffällig, aber deutlich steigende konkrete Kaufintention.",
  cultural_hype_unconfirmed: "Kulturelle Dynamik, noch ohne Bestätigung durch Planung oder Nachfrage.",
  planning_ahead: "Frühe Planungsphase vor einem Schwellenmoment.",
};

// --- Lebenszyklus (Bayes-Filter) -------------------------------------------
export function lifecycleStep(prior, observation, penalties = {}) {
  const states = S.lifecycle.states;
  const T = S.lifecycle.transition;
  const E = S.lifecycle.emissions;
  const noisePrior = S.lifecycle.noisePrior ?? 0.2;
  const start = prior && prior.length === states.length
    ? prior
    : states.map((s) => (s === "noise" ? noisePrior : (1 - noisePrior) / (states.length - 1)));

  // Vorhersage
  const predicted = states.map((to, j) =>
    states.reduce((sum, from, i) => sum + start[i] * (T[from] ? T[from][j] : 0), 0)
  );

  // Beobachtung
  const likelihood = states.map((state) => {
    const params = E[state];
    if (!params) return 1;
    let p = 1;
    for (const [feature, ab] of Object.entries(params)) {
      const x = observation[feature];
      if (x === null || x === undefined || !Number.isFinite(x)) continue;
      p *= Math.max(1e-9, betaPdf(clamp01(x), ab[0], ab[1]));
    }
    return p;
  });

  const unnormalized = predicted.map((p, i) => p * likelihood[i]);
  const total = unnormalized.reduce((s, v) => s + v, 0) || 1;
  const posterior = unnormalized.map((v) => v / total);

  let best = 0;
  posterior.forEach((v, i) => { if (v > posterior[best]) best = i; });
  let confidence = posterior[best];
  const pen = S.lifecycle.confidencePenalties;
  if (penalties.seasonalityUnadjusted) confidence *= pen.seasonalityUnadjusted;
  if (penalties.lowCoverage) confidence *= pen.lowCoverage;
  if (penalties.ukProxy) confidence *= pen.ukProxy;

  return {
    posterior: Object.fromEntries(states.map((s, i) => [s, Math.round(posterior[i] * 1000) / 1000])),
    lifecycleClass: states[best],
    confidence: Math.round(clamp01(confidence) * 1000) / 1000,
  };
}

// --- Memory Relevance Score -------------------------------------------------
export function mrs(components) {
  const w = S.mrs.weights;
  let weighted = 0;
  let coverage = 0;
  const detail = {};
  for (const [key, weight] of Object.entries(w)) {
    const v = components[key];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    weighted += weight * clamp01(v);
    coverage += weight;
    detail[key] = Math.round(clamp01(v) * 100);
  }
  if (!coverage) return { value: null, coverage: 0, detail };
  return { value: Math.round((weighted / coverage) * 1000) / 10, coverage, detail };
}

export function priority(tmsValue, mrsValue, confidence) {
  if (!Number.isFinite(tmsValue) || !Number.isFinite(mrsValue)) return null;
  return Math.round(Math.sqrt(tmsValue * mrsValue) * (Number.isFinite(confidence) ? confidence : 1) * 10) / 10;
}

export function whatNotToDo(tmsValue, mrsValue) {
  const r = S.mrs.whatNotToDoRule;
  return Number.isFinite(tmsValue) && Number.isFinite(mrsValue) && tmsValue >= r.minTms && mrsValue < r.maxMrs;
}

export function opportunityWindow(lifecycleClass) {
  const w = S.opportunityWindowWeeks[lifecycleClass] || [0, 0];
  return { minWeeks: w[0], maxWeeks: w[1], estimate: true };
}

// Erklaerungen sind Templates aus Daten, nie LLM-Text (INV-03).
export function explainTrend(snapshot) {
  const out = [];
  const pct = (v) => `${Math.round((v || 0) * 100)}. Perzentil`;
  if (Number.isFinite(snapshot.velocityPct)) out.push(`+ Wachstum im ${pct(snapshot.velocityPct)} des Landes`);
  if (Number.isFinite(snapshot.accelerationPct) && snapshot.accelerationPct > 0.6) out.push(`+ Beschleunigung im ${pct(snapshot.accelerationPct)}`);
  if (Number.isFinite(snapshot.crossSource)) out.push(`${snapshot.crossSource >= 0.5 ? "+" : "–"} Quellenbestätigung ${Math.round(snapshot.crossSource * 100)} %`);
  if (Number.isFinite(snapshot.cliLevel)) out.push(`${snapshot.cliLevel > 0.3 ? "+" : "–"} kultureller Lift ${snapshot.cliLevel > 0 ? "+" : ""}${snapshot.cliLevel.toFixed(2)} (log2 gegen übrige Länder)`);
  if (snapshot.weakSignal) out.push("+ früh, leise, beschleunigend (Weak Signal)");
  if (snapshot.coverage < S.tms.minCoverageForTrendClasses) out.push(`– Datenabdeckung nur ${Math.round(snapshot.coverage * 100)} %`);
  if (snapshot.seasonalityUnadjusted) out.push("– Saisonalität nicht bereinigt (zu kurze Historie)");
  return out;
}

// Fuehrt den Filter ueber mehrere Wochen, damit sich eine Historie bilden kann.
export function lifecycleRun(observation, penalties = {}, steps = S.lifecycle.filterSteps || 12) {
  let post = null;
  for (let i = 0; i < steps; i++) {
    post = lifecycleStep(post ? Object.values(post.posterior) : null, observation, penalties);
  }
  return post;
}

// Bildet einen z-Wert auf 0..1 ab, ohne von der Groesse der Vergleichsgruppe abzuhaengen.
export function sigmoid01(z, slope = 1.1) {
  if (!Number.isFinite(z)) return null;
  return 1 / (1 + Math.exp(-slope * z));
}
