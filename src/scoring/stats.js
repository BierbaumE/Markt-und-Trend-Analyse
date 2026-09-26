// Statistik in reinem JavaScript (SPEC 5.5). Keine Abhaengigkeiten.

export function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function mad(values) {
  const m = median(values);
  if (m === null) return null;
  const dev = values.filter(Number.isFinite).map((v) => Math.abs(v - m));
  const raw = median(dev);
  return raw === null ? null : raw * 1.4826; // auf Standardabweichung skaliert
}

export function robustZ(value, history) {
  const m = median(history);
  const s = mad(history);
  if (m === null || !s) return 0;
  return (value - m) / s;
}

// Theil-Sen: Median aller Paar-Steigungen. Robust gegen Ausreisser.
export function theilSen(points) {
  const pts = points.filter((p) => Number.isFinite(p.y));
  if (pts.length < 3) return 0;
  const slopes = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x;
      if (dx !== 0) slopes.push((pts[j].y - pts[i].y) / dx);
    }
  }
  return median(slopes) || 0;
}

export function slopeOfSeries(values) {
  return theilSen(values.map((y, x) => ({ x, y: Math.log1p(Math.max(0, y)) })));
}

// Klassische Zerlegung als STL-Ersatz: gleitender Median als Trend,
// Saisonindex je ISO-Woche als Median der Residuen der Vorjahre.
export function decompose(series, { period = 52, windowSize = 52 } = {}) {
  const values = series.map((p) => p.value);
  const n = values.length;
  const trend = values.map((_, i) => {
    const from = Math.max(0, i - Math.floor(windowSize / 2));
    const to = Math.min(n, i + Math.floor(windowSize / 2) + 1);
    return median(values.slice(from, to)) ?? values[i];
  });
  let method = "none";
  const residual = values.map((v, i) => v - trend[i]);
  if (n >= 2 * period) {
    const bucket = new Map();
    residual.forEach((r, i) => {
      const k = i % period;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(r);
    });
    const seasonal = residual.map((_, i) => median(bucket.get(i % period)) ?? 0);
    method = "classical";
    return { trend, seasonal, residual: values.map((v, i) => v - trend[i] - seasonal[i]), method };
  }
  if (n >= period + 4) {
    method = "yoy";
    return {
      trend,
      seasonal: values.map(() => 0),
      residual: values.map((v, i) => (i >= period ? v - values[i - period] : v - trend[i])),
      method,
    };
  }
  return { trend, seasonal: values.map(() => 0), residual, method };
}

// Change Point: groesste Mittelwertverschiebung (CUSUM-Idee) + Permutationstest.
export function changePoint(values, { minSegment = 4, permutations = 200, seed = 42 } = {}) {
  const n = values.length;
  if (n < 2 * minSegment) return null;
  const score = (arr) => {
    let best = { index: -1, stat: 0 };
    for (let i = minSegment; i <= arr.length - minSegment; i++) {
      const left = arr.slice(0, i);
      const right = arr.slice(i);
      const diff = Math.abs(mean(right) - mean(left));
      const stat = diff * Math.sqrt((left.length * right.length) / arr.length);
      if (stat > best.stat) best = { index: i, stat };
    }
    return best;
  };
  const observed = score(values);
  if (observed.index < 0) return null;
  const rng = mulberry32(seed);
  let greater = 0;
  for (let p = 0; p < permutations; p++) {
    const shuffled = shuffle(values, rng);
    if (score(shuffled).stat >= observed.stat) greater++;
  }
  const pValue = (greater + 1) / (permutations + 1);
  return { index: observed.index, stat: observed.stat, pValue, significant: pValue < 0.05 };
}

export function mean(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

export function stddev(values) {
  const a = values.filter(Number.isFinite);
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

// Perzentilrang innerhalb einer Vergleichsgruppe (immer innerhalb eines Landes, INV-01).
export function percentileRank(value, population) {
  const a = population.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return 0.5;
  let below = 0;
  for (const v of a) if (v < value) below++;
  return Math.min(1, Math.max(0, below / a.length));
}

export function winsorize(values, [lo, hi] = [0.02, 0.98]) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return values;
  const q = (p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  const min = q(lo);
  const max = q(hi);
  return values.map((v) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : v));
}

export function saturating(x, kappa) {
  return 1 - Math.exp(-Math.max(0, x) / kappa);
}

export function clamp01(x) {
  return Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
}

export function normalizedEntropy(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total <= 0 || counts.length < 2) return 0;
  const h = -counts.filter((c) => c > 0).reduce((s, c) => {
    const p = c / total;
    return s + p * Math.log(p);
  }, 0);
  return clamp01(h / Math.log(counts.length));
}

// Beta-Dichte fuer das Emissionsmodell des Lebenszyklusfilters.
export function betaPdf(x, alpha, beta) {
  const e = Math.min(1 - 1e-6, Math.max(1e-6, x));
  const lnB = logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
  const ln = (alpha - 1) * Math.log(e) + (beta - 1) * Math.log(1 - e) - lnB;
  return Math.exp(ln);
}

function logGamma(z) {
  // Lanczos-Approximation
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, rng) {
  const a = values.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
