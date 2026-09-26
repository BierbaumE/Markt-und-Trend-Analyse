// Creator-Scoring (SPEC 11.11-11.13). Bewertet beobachtbares Verhalten, niemals Merkmale
// einer Person (INV-06). Geschlecht, Alter und Aehnliches existieren im Modell nicht.
import S from "../../config/scoring.js";
import { saturating, clamp01, normalizedEntropy, median } from "./stats.js";

export const EVIDENCE_TYPES = [
  "helps", "asks_creator", "credits", "imitates", "thanks", "collaborates",
  "challenge_participation", "initiated_event", "encourages_beginner", "connects_people",
  "commission_request", "replies_to", "mentions",
];

const HELP_TYPES = ["helps", "encourages_beginner"];
const PEER_TYPES = ["credits", "imitates"];
const INIT_TYPES = ["initiated_event"];

// Reichweite ist hoechstens Zusatzinformation (5 %), nie Hauptkriterium.
export function reachComponent(followers) {
  const c = S.sei.reachCorridor;
  if (!Number.isFinite(followers) || followers < c.zeroBelow) return 0;
  if (followers < c.fullFrom) return clamp01((followers - c.zeroBelow) / (c.fullFrom - c.zeroBelow));
  if (followers <= c.fullTo) return 1;
  if (followers >= c.decayTo) return c.floor;
  const t = (followers - c.fullTo) / (c.decayTo - c.fullTo);
  return clamp01(1 - t * (1 - c.floor));
}

// evidence: [{ type, observed_at, counterpart_hash, confidence, quality }]
// projects: [{ state, techniques[], concept_ids[], observed_at }]
export function socialEnergyIndex({ evidence = [], followers = null, windowDays = S.sei.windowDays, bridges = null, now = Date.now() }) {
  const since = now - windowDays * 86400000;
  const inWindow = evidence.filter((e) => new Date(e.observed_at).getTime() >= since);
  const months = windowDays / 30;

  const helps = inWindow.filter((e) => HELP_TYPES.includes(e.type));
  const helpPerMonth = helps.length / months;
  const initiations = inWindow.filter((e) => INIT_TYPES.includes(e.type)).length
    + 0.5 * inWindow.filter((e) => e.type === "connects_people").length;
  const peers = new Set(inWindow.filter((e) => PEER_TYPES.includes(e.type)).map((e) => e.counterpart_hash || e.id));

  const counterpartCounts = new Map();
  for (const e of inWindow) {
    if (!e.counterpart_hash) continue;
    counterpartCounts.set(e.counterpart_hash, (counterpartCounts.get(e.counterpart_hash) || 0) + 1);
  }
  const interactionsWithCounterpart = [...counterpartCounts.values()].reduce((s, v) => s + v, 0);
  const recurring = [...counterpartCounts.values()].filter((v) => v >= 3).reduce((s, v) => s + v, 0);

  const qualities = helps.map((e) => e.quality).filter(Number.isFinite);

  const components = {
    help: inWindow.length ? saturating(helpPerMonth, S.sei.saturation.helpKappa) : null,
    initiation: saturating(initiations, S.sei.saturation.initiationKappa),
    recurringCommunity: interactionsWithCounterpart ? clamp01(recurring / interactionsWithCounterpart) : null,
    peerActivation: saturating(peers.size, S.sei.saturation.peerActivationKappa),
    experimentation: null, // wird von memoryMakerFit aus Projekten gesetzt
    answerQuality: qualities.length ? clamp01(median(qualities)) : null,
    networkBridges: Number.isFinite(bridges) ? clamp01(bridges) : null,
  };

  return finishSei(components, followers);
}

export function finishSei(components, followers) {
  const w = S.sei.weights;
  let weighted = 0;
  let coverage = 0;
  for (const [key, weight] of Object.entries(w)) {
    const v = components[key];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    weighted += weight * clamp01(v);
    coverage += weight;
  }
  const core = coverage ? weighted / coverage : null;
  const reach = reachComponent(followers);
  const value = core === null ? null : Math.round((0.95 * core + S.sei.reachMaxShare * reach) * 1000) / 10;
  return {
    value,
    coverage: Math.round(coverage * 100) / 100,
    needsScoutCheck: coverage < S.sei.minCoverage,
    components: { ...components, reach },
  };
}

// Creator Completion Index: ausprobiert -> fertiggestellt -> gezeigt -> erklaert
export function completionIndex(projects = [], { sequenceDays = S.cci.sequenceDays } = {}) {
  if (projects.length < S.cci.minProjects) return { value: null, coverage: 0 };
  const finished = projects.filter((p) => p.state === "finished").length;
  const started = projects.filter((p) => p.state !== "finished").length;
  const completion = finished + started ? finished / (finished + started) : 0;
  const shown = projects.filter((p) => p.state === "finished" && p.shown).length;
  const sequenceRate = finished ? clamp01(shown / finished) : 0;
  const processShare = projects.length ? projects.filter((p) => p.process_content).length / projects.length : 0;
  const w = S.cci.weights;
  return {
    value: Math.round((w.completion * completion + w.sequence * sequenceRate + w.process * processShare) * 1000) / 10,
    coverage: 1,
    detail: { completion, sequenceRate, processShare, finished, started },
  };
}

export function memoryMakerFit({ sei, projects = [], catalogProductTypes = [], momentConcepts = [], techniqueRatings = [], localEvents = 0, commercial = 0 }) {
  const finished = projects.filter((p) => p.state === "finished");
  const perMonth = finished.length / 3; // 90-Tage-Fenster
  const makerActivity = perMonth <= 0 ? 0 : perMonth >= 4 ? 1 : perMonth < 1 ? perMonth * 0.4 : perMonth < 2 ? 0.4 + (perMonth - 1) * 0.3 : 0.7 + ((perMonth - 2) / 2) * 0.3;

  const withMoment = projects.filter((p) => (p.concept_ids || []).some((c) => momentConcepts.includes(c))).length;
  const momentProximity = projects.length ? withMoment / projects.length : null;

  const theirTypes = new Set(projects.flatMap((p) => p.product_types || []));
  const overlap = [...theirTypes].filter((t) => catalogProductTypes.includes(t)).length;
  const blankCompatibility = theirTypes.size ? clamp01(overlap / theirTypes.size) : null;

  const techniques = new Set(projects.flatMap((p) => p.techniques || []));
  const breadth = techniques.size === 0 ? 0 : techniques.size === 1 ? 0.3 : techniques.size === 2 ? 0.6 : 1;
  const compat = techniqueRatings.length ? median(techniqueRatings) / 3 : 1;
  const finishingCompetence = clamp01(breadth * compat);

  const experimentation = normalizedEntropy([
    techniques.size,
    new Set(projects.flatMap((p) => p.concept_ids || [])).size,
    theirTypes.size || 1,
  ]);

  const components = {
    sei: Number.isFinite(sei) ? sei / 100 : null,
    makerActivity: clamp01(makerActivity),
    momentProximity,
    blankCompatibility,
    finishingCompetence,
    learningExperimenting: experimentation,
    localNetworking: saturating(localEvents, 2),
    commercialExperience: clamp01(commercial),
  };

  const w = S.mmf.weights;
  let weighted = 0;
  let coverage = 0;
  for (const [key, weight] of Object.entries(w)) {
    const v = components[key];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    weighted += weight * clamp01(v);
    coverage += weight;
  }
  return {
    value: coverage ? Math.round((weighted / coverage) * 1000) / 10 : null,
    coverage: Math.round(coverage * 100) / 100,
    components,
  };
}

// Ausschlussprofile: senken den Rang und erzwingen menschliche Pruefung, loeschen nie.
const RECRUITER_PATTERNS = [
  /join my team/i, /business opportunity/i, /finanzielle freiheit/i, /financial freedom/i,
  /schreib mir start/i, /dm me start/i, /passives einkommen/i, /work from home income/i,
  /bli med i teamet/i, /unisciti al mio team/i, /rejoins mon équipe/i, /dołącz do mojego zespołu/i,
];

export function exclusionFlags({ bio = "", posts = [], followers = null, sei, cci, projects = [], commercial = 0 }) {
  const flags = [];
  const text = [bio, ...posts].join(" \n ");
  if (RECRUITER_PATTERNS.some((rx) => rx.test(text))) flags.push("mlm_recruiter_signal");
  const finished = projects.filter((p) => p.state === "finished").length;
  if (Number.isFinite(followers) && followers > 20000 && finished <= 1) flags.push("pure_influencer");
  if (posts.length && posts.filter((p) => /rabatt|code|deal|sale|%/i.test(p)).length / posts.length > 0.5) flags.push("discount_hunter");
  if (Number.isFinite(sei) && sei < 25 && finished >= 3) flags.push("perfectionist_low_energy");
  if (Number.isFinite(cci) && cci < 25 && projects.length >= 8) flags.push("chronic_starter");
  if (commercial >= 0.8 && finished <= 1) flags.push("seller_without_maker_drive");
  return flags;
}

export const FLAG_TEXT = {
  mlm_recruiter_signal: "Hinweise auf Strukturvertrieb/Rekrutierung – menschliche Prüfung nötig",
  pure_influencer: "Hohe Reichweite, kaum eigene fertige Projekte",
  discount_hunter: "Überwiegend Rabatt- und Deal-Inhalte",
  perfectionist_low_energy: "Gute Arbeiten, aber kaum Hilfe oder Austausch",
  chronic_starter: "Viele Anfänge, wenige fertige Ergebnisse",
  seller_without_maker_drive: "Verkauf im Vordergrund, eigene Gestaltung gering",
};

// Menschliche Scorecard (10 Kriterien 0-3). Sie ueberstimmt den MMF, nie umgekehrt.
export const SCORECARD_FIELDS = ["makes", "shows", "tries", "helps", "connects", "encourages", "initiates", "relationship", "sales_open", "learning_open"];

export function scorecardTotals(values = {}) {
  let raw = 0;
  let weighted = 0;
  for (const f of SCORECARD_FIELDS) {
    const v = Number(values[f]) || 0;
    raw += v;
    weighted += S.scorecard.doubleWeight.includes(f) ? v * 2 : v;
  }
  return {
    raw,
    weighted,
    prioritize: raw >= S.scorecard.prioritizeFromRaw,
    closeLook: raw >= S.scorecard.closeLookFromRaw,
  };
}

export function explainCreator({ mmf, sei, cci, components = {}, flags = [], momentShare = null, techniques = 0 }) {
  const out = [];
  if (Number.isFinite(components.peerActivation) && components.peerActivation > 0.4) out.push("+ andere Menschen handeln nach ihren Beiträgen (Peer Activation)");
  if (Number.isFinite(components.help) && components.help > 0.4) out.push("+ erklärt und hilft regelmäßig");
  if (Number.isFinite(components.initiation) && components.initiation > 0.3) out.push("+ organisiert eigene Treffen oder Aktionen");
  if (Number.isFinite(momentShare) && momentShare > 0.4) out.push(`+ arbeitet häufig an Erinnerungsmomenten (${Math.round(momentShare * 100)} % der Projekte)`);
  if (techniques >= 3) out.push(`+ beherrscht ${techniques} Veredelungsverfahren`);
  if (Number.isFinite(cci) && cci >= 70) out.push("+ stellt Begonnenes zuverlässig fertig");
  if (Number.isFinite(cci) && cci < 40) out.push("– viele Projekte bleiben unfertig");
  if (Number.isFinite(components.reach) && components.reach < 0.2) out.push("– kleine Reichweite (zählt nur 5 %)");
  for (const f of flags) out.push(`– ${FLAG_TEXT[f] || f}`);
  return out;
}
