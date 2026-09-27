// Trend x Creator Bridge und Connection Hook (SPEC 11.14, 11.15).
// Grundsatz: Der Hook ist eine belegbare Gesprächsbrücke, kein Werbetext. Jede Aussage
// stammt aus Belegen oder aus berechneten Zahlen; nichts wird frei formuliert erfunden.
import S from "../../config/scoring.js";
import { clamp01 } from "./stats.js";

// Ontologie-Dimension -> Gewichtungsschlüssel der Affinität
const DIM_KEY = { A: "moment", B: "product_type", C: "style", D: "motif", E: "technique" };

export function dimensionKey(conceptId, dimension) {
  if (dimension === "C" && String(conceptId).startsWith("material.")) return "material";
  return DIM_KEY[dimension] || null;
}

// Leitet aus den beobachteten Projekten ein Profil ab: Was gestaltet dieser Mensch,
// mit welchen Motiven, Techniken und für welche Lebensmomente?
export function creatorProfile(projects, conceptIndex) {
  const buckets = {};
  let latest = null;
  for (const p of projects) {
    if (p.observed_at && (!latest || p.observed_at > latest)) latest = p.observed_at;
    const ids = [...(p.concept_ids || []), ...(p.techniques || [])];
    for (const id of ids) {
      const c = conceptIndex[id];
      if (!c) continue;
      const key = dimensionKey(id, c.dimension);
      if (!key) continue;
      if (!buckets[key]) buckets[key] = new Map();
      buckets[key].set(id, (buckets[key].get(id) || 0) + 1);
    }
  }
  const profile = {};
  for (const [key, map] of Object.entries(buckets)) {
    const total = [...map.values()].reduce((s, v) => s + v, 0) || 1;
    profile[key] = [...map.entries()]
      .map(([id, n]) => ({ id, label: (conceptIndex[id] || {}).label_de || id, share: n / total, count: n }))
      .sort((a, b) => b.share - a.share);
  }
  const finished = projects.filter((p) => p.state === "finished").length;
  const daysSince = latest ? Math.round((Date.now() - new Date(latest).getTime()) / 86400000) : null;
  return { dimensions: profile, finished, projects: projects.length, lastActivityDays: daysSince };
}

// Affinität: Anteil der Profilausprägungen, die der Trend ebenfalls enthält,
// je Dimension gewichtet. Kein Embedding nötig, dafür vollständig nachvollziehbar.
export function affinity(profile, trendConceptIds, conceptIndex) {
  const w = S.bridge.affinity_dimension_weights || {
    style: 0.25, motif: 0.20, technique: 0.20, moment: 0.20, product_type: 0.10, material: 0.05,
  };
  const trendByKey = {};
  for (const id of trendConceptIds) {
    const c = conceptIndex[id];
    if (!c) continue;
    const key = dimensionKey(id, c.dimension);
    if (!key) continue;
    if (!trendByKey[key]) trendByKey[key] = new Set();
    trendByKey[key].add(id);
  }
  let score = 0;
  let used = 0;
  const overlap = [];
  for (const [key, weight] of Object.entries(w)) {
    const mine = profile.dimensions[key];
    const theirs = trendByKey[key];
    if (!mine || !theirs) continue;
    used += weight;
    let matched = 0;
    for (const item of mine) {
      if (theirs.has(item.id)) {
        matched += item.share;
        overlap.push({ key, id: item.id, label: item.label });
      }
    }
    score += weight * clamp01(matched);
  }
  return { value: used ? clamp01(score / used) : 0, coveredWeight: used, overlap };
}

export function bridgeScore({ affinityValue, sei, priorityNorm, mmf, lastActivityDays }) {
  const w = S.bridge.weights;
  const recency = lastActivityDays === null ? 0.4 : lastActivityDays <= 30 ? 1 : lastActivityDays <= 90 ? 0.7 : 0.4;
  const readiness = clamp01(recency * ((Number.isFinite(mmf) ? mmf : 40) / 100));
  const parts = {
    affinity: w.affinity * clamp01(affinityValue),
    sei: w.sei * clamp01((Number.isFinite(sei) ? sei : 0) / 100),
    priority: w.priority * clamp01(priorityNorm),
    readiness: w.readiness * readiness,
  };
  const value = Math.round(Object.values(parts).reduce((s, v) => s + v, 0) * 1000) / 10;
  return { value, parts, readiness };
}

export function qualifies({ affinityValue, sei }) {
  return affinityValue >= S.bridge.min_affinity && (Number.isFinite(sei) ? sei : 0) >= S.bridge.min_sei;
}

// Passenden Rohling wählen: erst über den Lebensmoment des Trends, dann über die
// Produkttypen, die dieser Mensch ohnehin gestaltet.
export function matchCatalogItem(catalog, trendConceptIds, profile) {
  const trendMoments = trendConceptIds.filter((id) => id.startsWith("moment."));
  const myTypes = new Set((profile.dimensions.product_type || []).map((p) => p.id));
  let best = null;
  for (const item of catalog) {
    let score = 0;
    const reasons = [];
    const moments = item.moments || [];
    const hit = moments.filter((m) => trendMoments.includes(m));
    if (hit.length) { score += 2; reasons.push(`passt zum Moment ${hit.join(", ")}`); }
    if (myTypes.has(item.product_type)) { score += 1.5; reasons.push("entspricht dem, was sie ohnehin gestaltet"); }
    if (!best || score > best.score) best = { item, score, reasons };
  }
  return best && best.score > 0 ? best : null;
}

// Welche ihrer Techniken passt auf welche Oberfläche unseres Rohlings?
// Quelle ist die Kompatibilitätsmatrix der Anwendungstechnik, keine Vermutung.
export function techniqueBridge(profile, item, compatibility) {
  const mine = (profile.dimensions.technique || []).map((t) => t.id);
  const surfaces = (item && item.surfaces) || [];
  const hits = compatibility
    .filter((c) => mine.includes(c.technique) && surfaces.includes(c.surface) && c.rating >= 2)
    .sort((a, b) => b.rating - a.rating);
  return hits.length ? hits[0] : null;
}

// Zahlen im Text kommen ausschließlich aus dem Snapshot (INV-03).
export function trendStatement(trend, snapshot) {
  if (!snapshot || snapshot.tms === null) return null;
  const bits = [`„${trend.label_de}“ erreicht ein Momentum von ${Math.round(snapshot.tms)} von 100 im Land`];
  if (Number.isFinite(snapshot.cli_level) && snapshot.cli_level > 0.3) {
    bits.push(`überdurchschnittlich lokal ausgeprägt (Faktor ${Math.pow(2, snapshot.cli_level).toFixed(1)} gegenüber den übrigen Ländern)`);
  }
  if (snapshot.lifecycle_class && snapshot.lifecycle_class !== "noise") {
    bits.push(`Einordnung: ${LIFECYCLE_TEXT[snapshot.lifecycle_class] || snapshot.lifecycle_class}`);
  }
  return `${bits.join(", ")}.`;
}

const LIFECYCLE_TEXT = {
  emerging_signal: "frühes Signal", corroborated_signal: "bestätigtes Signal",
  emerging_trend: "entstehender Trend", established: "etabliert",
  saturating: "sättigt sich", declining: "rückläufig",
};

// Der Hook selbst: Beobachtung, lokaler Trend, Produktbrücke, Gesprächsidee, Entwurf.
export function buildHook({ creator, profile, trend, snapshot, catalogMatch, technique, evidence, country, conceptIndex = {} }) {
  const strongest = topLabels(profile, 3);
  const helpfulEvidence = evidence
    .filter((e) => ["helps", "encourages_beginner", "initiated_event", "credits", "imitates", "commission_request"].includes(e.type))
    .slice(0, 3);

  const worksLabel = profile.finished === 1 ? "eine fertige Arbeit" : `${profile.finished} fertige Arbeiten`;

  // Interne Sicht (dritte Person) – für die Prüfung durch Menschen
  const observation = strongest.length
    ? `Arbeitet sichtbar mit ${strongest.join(", ")}${profile.finished ? `; ${worksLabel} beobachtet` : ""}.`
    : "Gestaltet sichtbar eigene Arbeiten.";

  const statement = trendStatement(trend, snapshot);
  const product = catalogMatch ? `${catalogMatch.item.name} (${catalogMatch.item.sku})` : null;
  const techniqueLabel = technique ? conceptLabel(technique.technique, conceptIndex) : null;
  const surfaceLabel = technique ? surfaceName(technique.surface) : null;
  const techniqueNote = technique
    ? `Technik ${techniqueLabel} ist auf der Oberfläche ${surfaceLabel} erprobt (Bewertung ${technique.rating} von 3).`
    : null;

  const conversationIdea = product
    ? `Vorschlag: zeigen lassen, wie sie diese Bildsprache auf ${product} überträgt, und erfassen, was ihr am Rohling auffällt.`
    : `Vorschlag: zeigen lassen, wie sie diese Bildsprache auf einen hochwertigen Erinnerungsträger überträgt.`;

  const assortmentIdea = product
    ? `Sortimentsidee: ${product}${strongest.length ? ` mit ${strongest[0]}` : ""}${techniqueLabel ? `, veredelt per ${techniqueLabel}` : ""} — ein Angebot, das sie bisher nicht führt und mit ihren eigenen Mitteln umsetzen kann.`
    : null;

  // Entwurf an die Person selbst, durchgehend in der Du-Form
  const draft = [
    `Hallo ${creator.display_name || creator.handle},`,
    ``,
    strongest.length
      ? `uns ist aufgefallen, wie du mit ${strongest.join(", ")} arbeitest.`
      : `uns ist deine gestalterische Arbeit aufgefallen.`,
    statement ? `In ${countryName(country)} entwickelt sich gerade etwas, das dazu passt: ${statement}` : null,
    product ? `Wir stellen unveredelte Erinnerungsträger her, unter anderem ${product}.` : null,
    technique
      ? `${techniqueLabel} ist auf unserer Oberfläche ${surfaceLabel} gut erprobt — das würde also direkt zu deiner Arbeitsweise passen.`
      : null,
    product
      ? `Wir würden gern sehen, wie du deine Bildsprache auf ${product} überträgst — und was dir dabei am Rohling auffällt.`
      : `Wir würden gern sehen, wie du deine Bildsprache auf einen hochwertigen Erinnerungsträger überträgst.`,
    ``,
    `Kein Affiliateprogramm, keine Postingpflicht, keine fertige Designvorgabe. Wir suchen keine Influencerinnen, sondern Menschen, die gern gestalten und andere dazu anstecken.`,
    `Deine Kontaktdaten haben wir deinem öffentlichen Profil entnommen; auf Wunsch löschen wir sie sofort wieder. Unsere Datenschutzinformation schicken wir gern mit.`,
    ``,
    `Magst du dir einen Rohling ansehen?`,
  ].filter((l) => l !== null).join("\n");

  return {
    observation,
    observationEvidence: helpfulEvidence.map((e) => ({ id: e.id, type: e.type, url: e.url, at: e.observed_at })),
    trendStatement: statement,
    product,
    productSku: catalogMatch ? catalogMatch.item.sku : null,
    productReasons: catalogMatch ? catalogMatch.reasons : [],
    techniqueNote,
    conversationIdea,
    assortmentIdea,
    draft,
    guard: guardCheck(draft),
  };
}

const SURFACE_NAME = { linen: "Leinen", wood: "Holz", paper: "Papier" };
const surfaceName = (s) => SURFACE_NAME[s] || s;
const conceptLabel = (id, index) => ((index && index[id] && index[id].label_de) || String(id).split(".").pop());

function topLabels(profile, n) {
  const order = ["motif", "style", "moment", "technique", "product_type", "material"];
  const out = [];
  for (const key of order) {
    const items = profile.dimensions[key];
    if (items && items.length) out.push(items[0].label);
    if (out.length >= n) break;
  }
  return out;
}

const COUNTRY_NAME = { DE: "Deutschland", SE: "Schweden", IT: "Italien", FR: "Frankreich", PL: "Polen", "GB-ENG": "England", NO: "Norwegen" };
const countryName = (c) => COUNTRY_NAME[c] || c;
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

// Authenticity Guard (SPEC 11.15): verbotene Themen und Überwachungssprache.
const FORBIDDEN = [
  [/\b\d{1,2}\s*Jahre alt\b/i, "Altersangabe"],
  [/schwanger/i, "Schwangerschaft"],
  [/heirat|verlobt/i, "Heiratsplanung"],
  [/\bkinder\b(?!.*zeichnung)/i, "Kinder der Person"],
  [/gesundheit|krank/i, "Gesundheit"],
  [/religion|gläubig/i, "Weltanschauung"],
  [/\bfollower\b|\breichweite\b/i, "Reichweite erwähnt"],
  [/analysiert|ausgewertet|score|bewertung deiner/i, "Überwachungssprache"],
  [/verdien|einkommen|passives/i, "Einkommensversprechen"],
  [/perfekt|profi-ergebnis/i, "Leistungssprache"],
];

export function guardCheck(text) {
  const hits = FORBIDDEN.filter(([rx]) => rx.test(text)).map(([, label]) => label);
  return { passed: hits.length === 0, findings: hits };
}
