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
  const keys =
