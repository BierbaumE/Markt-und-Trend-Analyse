// Szenario-Simulator (SPEC 18.1): erzeugt Laender, Ontologie, Quellen, Katalog und
// synthetische Maerkte mit bekannter Wahrheit. Damit ist die App ohne echte
// Datenquellen vollstaendig bedienbar und pruefbar.
import { COUNTRIES } from "../../config/countries/index.js";
import { CONCEPTS } from "../../ontology/core.js";
import { Db } from "../core/db.js";
import { uuidv7, nowIso, isoWeek } from "../core/ids.js";
import { mulberry32 } from "../scoring/stats.js";

const SOURCES = [
  ["google_trends", "A", 3, 1.0, "country"],
  ["pinterest_trends", "B", 3, 1.0, "country"],
  ["tiktok_creative_center", "C", 3, 0.8, "uk_proxy"],
  ["etsy", "D", 1, 0.9, "country"],
  ["instagram_public", "E", 3, 0.8, "subregion"],
  ["web_public", "F", 4, 0.7, "subregion"],
];

const CATALOG = [
  ["GB-ALB-001", "Leinenalbum „Linea“", "product.album", ["material.linen"], ["linen"], ["moment.wedding", "moment.baptism"]],
  ["GB-BOX-002", "Erinnerungsbox „Memoria“", "product.box", ["material.wood"], ["wood", "linen"], ["moment.birth", "moment.baptism"]],
  ["GB-GB-003", "Gästebuch „Convivio“", "product.guestbook", ["material.kraft_paper"], ["paper"], ["moment.wedding"]],
  ["GB-MB-004", "Erinnerungsbuch „Schwelle“", "product.memory_book", ["material.linen"], ["linen", "paper"], ["moment.school_start", "moment.confirmation", "moment.first_communion"]],
];

const TECHNIQUE_COMPAT = [
  ["linen", "technique.hot_foil", 3], ["linen", "technique.debossing", 3], ["linen", "technique.embroidery", 2],
  ["linen", "technique.uv_dtf", 2], ["linen", "technique.vinyl", 1],
  ["wood", "technique.laser_engraving", 3], ["wood", "technique.uv_dtf", 2], ["wood", "technique.vinyl", 2],
  ["paper", "technique.hot_foil", 3], ["paper", "technique.hand_lettering", 3], ["paper", "technique.debossing", 2],
  ["paper", "technique.laser_cut", 2], ["paper", "technique.sublimation", 0],
];

// Szenarien: label, Land, Konzepte, Verlauf je Sensor, erwartetes Ergebnis (Dokumentation)
const SCENARIOS = [
  { label: "Leinen-Konfirmation in Naturtönen", local: "linne konfirmation naturtoner", country: "SE",
    concepts: ["moment.confirmation", "material.linen", "style.minimalist", "technique.debossing"],
    shape: { google_trends: "rise", pinterest_trends: "rise_strong", tiktok_creative_center: "rise", etsy: "rise", instagram_public: "rise" },
    expect: "echter lokaler Emerging Trend" },
  { label: "Studenten-Erinnerungsbuch", local: "studentbok minnesbok", country: "SE",
    concepts: ["moment.graduation", "product.memory_book", "style.graphic"],
    shape: { google_trends: "seasonal", pinterest_trends: "seasonal", etsy: "seasonal" },
    expect: "saisonale Welle – kein neuer Trend" },
  { label: "Gepresste Wildblumen auf Alben", local: "pressade blommor album", country: "SE",
    concepts: ["motif.wildflowers", "product.album", "technique.scrapbooking"],
    shape: { pinterest_trends: "rise_strong", tiktok_creative_center: "rise_strong", google_trends: "flat", etsy: "flat" },
    expect: "Inspiration ohne Kommerz" },
  { label: "Schleifen-Monogramm zur Taufe", local: "Schleife Monogramm Taufe", country: "DE",
    concepts: ["motif.bow", "moment.baptism", "technique.hot_foil"],
    shape: { google_trends: "rise", pinterest_trends: "rise", etsy: "rise_strong", tiktok_creative_center: "flat" },
    expect: "stille Kaufintention" },
  { label: "Kinderzeichnung als Gravur", local: "Kinderzeichnung Gravur", country: "DE",
    concepts: ["motif.child_drawing", "technique.laser_engraving", "product.box"],
    shape: { tiktok_creative_center: "rise_strong", pinterest_trends: "rise", google_trends: "rise", etsy: "rise" },
    expect: "Emerging Trend mit Produktbezug" },
  { label: "Glitzer-Trendtanz #sparkletrend", local: "sparkletrend", country: "DE",
    concepts: ["style.playful", "technique.vinyl"],
    shape: { tiktok_creative_center: "spike", pinterest_trends: "flat", google_trends: "flat", etsy: "decline" },
    expect: "kulturelle Dynamik ohne Memory-Bezug – What not to do" },
  { label: "Einschulungs-Erinnerungsbuch", local: "Einschulung Erinnerungsbuch", country: "DE",
    concepts: ["moment.school_start", "product.memory_book", "style.nostalgic"],
    shape: { google_trends: "seasonal", pinterest_trends: "rise", etsy: "rise" },
    expect: "Planungsphase vor dem Moment" },
];

const CREATORS = [
  { handle: "annas.papierwerk", name: "Anna", country: "DE", platform: "instagram", followers: 240, region: "Franken",
    categories: ["Papeterie", "Album"], archetype: "activator" },
  { handle: "linnea.minnen", name: "Linnéa", country: "SE", platform: "instagram", followers: 1800, region: "Göteborg",
    categories: ["Scrapbooking", "Kalligrafie"], archetype: "activator" },
  { handle: "craft.queen.official", name: "CraftQueen", country: "DE", platform: "instagram", followers: 84000, region: "Berlin",
    categories: ["DIY"], archetype: "influencer" },
  { handle: "startbutneverdone", name: "Mira", country: "DE", platform: "instagram", followers: 900, region: "Hamburg",
    categories: ["Basteln"], archetype: "starter" },
  { handle: "team.freedom.life", name: "FreedomTeam", country: "SE", platform: "instagram", followers: 5200, region: "Malmö",
    categories: ["Lifestyle"], archetype: "recruiter" },
  { handle: "holz.und.faden", name: "Katrin", country: "DE", platform: "instagram", followers: 3100, region: "Allgäu",
    categories: ["Holz", "Gravur"], archetype: "quiet_pro" },
];

const COMPANIES = [
  { name: "Papeterie Lindgren", country: "SE", category: "Papeterie", region: "Göteborg", gap: true },
  { name: "Concept Store Nord", country: "SE", category: "Concept Store", region: "Stockholm", gap: true },
  { name: "Hochzeitsatelier Rosenblatt", country: "DE", category: "Hochzeit", region: "München", gap: true },
  { name: "Fotostudio Lichtblick", country: "DE", category: "Fotostudio", region: "Nürnberg", gap: false },
  { name: "Plotterwelt Sommer", country: "DE", category: "Plottershop", region: "Köln", gap: false },
];

function curve(shape, i, n, rng) {
  const t = i / (n - 1);
  const noise = () => (rng() - 0.5) * 4;
  const season = Math.max(0, Math.sin(((i % 52) / 52) * Math.PI * 2 - 1.2)) * 45;
  switch (shape) {
    case "rise": return 20 + (t > 0.62 ? (t - 0.62) * 150 : 0) + noise();
    case "rise_strong": return 18 + (t > 0.58 ? Math.pow((t - 0.58) * 2.6, 2) * 70 : 0) + noise();
    case "seasonal": return 15 + season + noise();
    case "spike": return 12 + (t > 0.88 ? (t - 0.88) * 600 : 0) + noise();
    case "decline": return 45 - t * 25 + noise();
    case "flat":
    default: return 22 + noise();
  }
}

export async function seedDemo(env, { weeks = 78, countries = ["DE", "SE"] } = {}) {
  const db = new Db(env);
  const rng = mulberry32(42);
  const now = nowIso();
  const stmts = [];

  for (const code of Object.keys(COUNTRIES)) {
    const c = COUNTRIES[code];
    stmts.push(["INSERT OR REPLACE INTO country (code, name_de, languages, active_since, enabled) VALUES (?,?,?,?,?)",
      [code, c.nameDe, JSON.stringify(c.languages), countries.includes(code) ? now : null, countries.includes(code) ? 1 : 0]]);
  }
  for (const [id, dim, label] of CONCEPTS) {
    stmts.push(["INSERT OR REPLACE INTO concept (id, dimension, label_de, status, created_at) VALUES (?,?,?, 'active', ?)", [id, dim, label, now]]);
  }
  for (const code of countries) {
    const seeds = (COUNTRIES[code] || {}).momentSeeds || {};
    for (const [conceptId, terms] of Object.entries(seeds)) {
      for (const term of terms) {
        stmts.push(["INSERT OR IGNORE INTO lexeme (id, concept_id, lang, country_code, term, is_commercial_modifier) VALUES (?,?,?,?,?,0)",
          [uuidv7(), conceptId, (COUNTRIES[code].languages || ["de"])[0], code, term]]);
      }
    }
  }
  for (const [key, sensor, tier, weight, geo] of SOURCES) {
    stmts.push(["INSERT OR REPLACE INTO source (key, sensor, tier, legal_basis, tos_status, reliability_weight, geo_granularity, enabled) VALUES (?,?,?,?,?,?,?,1)",
      [key, sensor, tier, "berechtigtes Interesse (zu prüfen)", tier === 1 ? "ok" : "review_pending", weight, geo]]);
  }
  for (const [sku, name, type, materials, surfaces, moments] of CATALOG) {
    stmts.push(["INSERT OR REPLACE INTO catalog_item (id, sku, name, product_type, materials, surfaces, moments, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [uuidv7(), sku, name, type, JSON.stringify(materials), JSON.stringify(surfaces), JSON.stringify(moments), now]]);
  }
  for (const [surface, technique, rating] of TECHNIQUE_COMPAT) {
    stmts.push(["INSERT OR REPLACE INTO technique_compatibility (surface, technique, rating, notes, tested_at) VALUES (?,?,?,?,?)",
      [surface, technique, rating, "Startwert der Anwendungstechnik", now]]);
  }
  await flush(db, stmts);

  // Zeitreihen und Trends
  const tsRows = [];
  const signalRows = [];
  for (const sc of SCENARIOS) {
    if (!countries.includes(sc.country)) continue;
    const trendId = uuidv7();
    tsRows.push(["INSERT OR REPLACE INTO trend (id, country_code, label_de, label_local, concept_ids, origin, created_at) VALUES (?,?,?,?,?,?,?)",
      [trendId, sc.country, sc.label, sc.local, JSON.stringify(sc.concepts), "timeseries", now]]);
    for (const conceptId of sc.concepts) {
      tsRows.push(["INSERT OR IGNORE INTO trend_concept (trend_id, concept_id) VALUES (?,?)", [trendId, conceptId]]);
    }
    for (const [sourceKey, shape] of Object.entries(sc.shape)) {
      for (let i = 0; i < weeks; i++) {
        const week = isoWeek(new Date(Date.now() - (weeks - 1 - i) * 7 * 86400000));
        const value = Math.max(0, curve(shape, i, weeks, rng));
        // Die Reihe haengt am ersten Konzept des Trends (dem Leitkonzept).
        tsRows.push(["INSERT OR REPLACE INTO ts_point (country_code, source_key, concept_id, iso_week, value_raw, value_scaled, seasonality_method) VALUES (?,?,?,?,?,?,?)",
          [sc.country, sourceKey, sc.concepts[0], week, value, value, null]]);
        // und zusaetzlich als Kontext an den weiteren Konzepten
        if (sc.concepts[1] && i % 2 === 0) {
          tsRows.push(["INSERT OR REPLACE INTO ts_point (country_code, source_key, concept_id, iso_week, value_raw, value_scaled, seasonality_method) VALUES (?,?,?,?,?,?,?)",
            [sc.country, sourceKey, sc.concepts[1], week, value * 0.7, value * 0.7, null]]);
        }
      }
    }
    // Rohsignale als Belege (Personalisierung/Zweck fuer den MRS)
    for (let i = 0; i < 6; i++) {
      const hasMoment = sc.concepts.some((c) => c.startsWith("moment."));
      signalRows.push(["INSERT OR IGNORE INTO raw_signal (id, source_key, sensor, country_code, geo_level, lang, signal_type, url, observed_at, fetched_at, payload, license_status, dedupe_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [uuidv7(), "pinterest_trends", "B", sc.country, sc.country === "GB-ENG" ? "uk_proxy" : "country",
          (COUNTRIES[sc.country].languages || ["de"])[0], "pin_trend", null, now, now,
          JSON.stringify({ concept_id: sc.concepts[0], personalization: hasMoment ? 1 : 0, purpose: hasMoment ? "purpose.ritual" : null, demo: true }),
          "demo", `${sc.label}-${i}`]]);
    }
  }
  await flush(db, tsRows);
  await flush(db, signalRows);

  await seedCreators(db, countries, now);
  await seedCompanies(db, countries, now);
  return { scenarios: SCENARIOS.filter((s) => countries.includes(s.country)).length, weeks };
}

async function seedCreators(db, countries, now) {
  const rows = [];
  const d = (days) => new Date(Date.now() - days * 86400000).toISOString();
  for (const c of CREATORS) {
    if (!countries.includes(c.country)) continue;
    const id = uuidv7();
    rows.push(["INSERT OR IGNORE INTO creator_candidate (id, country_code, platform, handle, public_url, display_name, region, creative_categories, follower_count, discovered_via, discovered_at, purge_after, status, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, c.country, c.platform, c.handle, `https://example.invalid/${c.handle}`, c.name, c.region,
        JSON.stringify(c.categories), c.followers, "simulator", now,
        new Date(Date.now() + 90 * 86400000).toISOString(), "discovered", now]]);

    const ev = [];
    const proj = [];
    if (c.archetype === "activator") {
      for (let i = 0; i < 8; i++) ev.push(["helps", d(i * 5 + 2), `peer${i % 3}`, 0.85, "Erklärt Folienauftrag Schritt für Schritt"]);
      ev.push(["initiated_event", d(12), null, 0.9, "Bastelabend im Laden organisiert"]);
      ev.push(["initiated_event", d(45), null, 0.9, "Sammelbestellung für Leinen"]);
      for (let i = 0; i < 4; i++) ev.push(["credits", d(6 + i * 7), `fan${i}`, 0.8, "Nachbau mit Nennung"]);
      ev.push(["imitates", d(20), "fan9", 0.7, "zeigt Nachbau der Technik"]);
      ev.push(["commission_request", d(9), "kund1", 0.8, "Kundin fragt nach Auftrag"]);
      proj.push(["finished", ["moment.wedding", "product.album"], ["technique.hot_foil"], true]);
      proj.push(["finished", ["moment.baptism", "product.box"], ["technique.debossing"], true]);
      proj.push(["finished", ["moment.school_start", "product.memory_book"], ["technique.hand_lettering"], true]);
      proj.push(["in_progress", ["moment.confirmation"], ["technique.laser_engraving"], false]);
    } else if (c.archetype === "influencer") {
      for (let i = 0; i < 3; i++) ev.push(["mentions", d(i * 9 + 3), `brand${i}`, 0.6, "Kooperationspost mit Rabattcode -20%"]);
      ev.push(["thanks", d(15), "fan1", 0.4, "danke!"]);
      proj.push(["finished", ["product.card"], ["technique.vinyl"], true]);
    } else if (c.archetype === "starter") {
      for (let i = 0; i < 10; i++) proj.push(["started", ["style.playful"], ["technique.vinyl"], false]);
      proj.push(["finished", ["product.card"], ["technique.vinyl"], true]);
      ev.push(["asks_creator", d(4), "peer1", 0.7, "Wie macht man das?"]);
    } else if (c.archetype === "recruiter") {
      ev.push(["mentions", d(3), null, 0.9, "Join my team und starte in die finanzielle Freiheit"]);
      ev.push(["mentions", d(10), null, 0.9, "Schreib mir START für dein eigenes Business"]);
      proj.push(["finished", ["product.card"], ["technique.vinyl"], true]);
    } else if (c.archetype === "quiet_pro") {
      for (let i = 0; i < 6; i++) proj.push(["finished", ["moment.wedding", "product.box"], ["technique.laser_engraving"], true]);
      ev.push(["thanks", d(8), "kund2", 0.5, "Vielen Dank, wunderschön"]);
      ev.push(["commission_request", d(11), "kund3", 0.8, "Auftrag angefragt"]);
    }

    for (const [type, at, hash, conf, excerpt] of ev) {
      rows.push(["INSERT INTO evidence_item (id, creator_candidate_id, type, url, excerpt, observed_at, captured_by, public_professional, creative_work_related, counterpart_hash, confidence, created_at) VALUES (?,?,?,?,?,?,?,1,1,?,?,?)",
        [uuidv7(), id, type, `https://example.invalid/${c.handle}/p/${uuidv7().slice(0, 8)}`, excerpt, at, "connector:simulator", hash, conf, now]]);
    }
    for (const [state, concepts, techniques, shown] of proj) {
      rows.push(["INSERT INTO creator_project (id, creator_candidate_id, url, state, concept_ids, techniques, observed_at) VALUES (?,?,?,?,?,?,?)",
        [uuidv7(), id, shown ? `https://example.invalid/${c.handle}/w/${uuidv7().slice(0, 6)}` : null, state,
          JSON.stringify(concepts), JSON.stringify(techniques), d(Math.floor(Math.random() * 80) + 1)]]);
    }
  }
  await flush(db, rows);
}

async function seedCompanies(db, countries, now) {
  const rows = [];
  for (const co of COMPANIES) {
    if (!countries.includes(co.country)) continue;
    const id = uuidv7();
    rows.push(["INSERT OR IGNORE INTO company_candidate (id, country_code, name, website, category, region, is_sole_trader, status, discovered_at, updated_at) VALUES (?,?,?,?,?,?,0,'identified',?,?)",
      [id, co.country, co.name, `https://example.invalid/${encodeURIComponent(co.name.toLowerCase().replace(/\s+/g, "-"))}`, co.category, co.region, now, now]]);
    const components = {
      audienceFit: co.gap ? 0.8 : 0.45, assortmentFit: co.gap ? 0.6 : 0.5, momentProximity: co.gap ? 0.8 : 0.4,
      personalizationDiyAffinity: 0.6, regionalRelevance: 0.6, onlineActivity: 0.7,
      assortmentGap: co.gap ? 0.9 : 0.2, contactability: 0.8,
    };
    const cos = Math.round(Object.entries({ audienceFit: 0.2, assortmentFit: 0.15, momentProximity: 0.15, personalizationDiyAffinity: 0.15, regionalRelevance: 0.1, onlineActivity: 0.1, assortmentGap: 0.1, contactability: 0.05 })
      .reduce((s, [k, w]) => s + w * components[k], 0) * 1000) / 10;
    rows.push(["INSERT INTO company_score_snapshot (id, company_candidate_id, cycle_id, cos, components, gap_hypothesis, recommended_skus, reasons, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [uuidv7(), id, null, cos, JSON.stringify(components),
        co.gap ? "Bedient die passende Zielgruppe, führt aber keinen hochwertigen Erinnerungsträger." : "Sortiment deckt Erinnerungsträger bereits ab.",
        JSON.stringify(co.gap ? ["GB-ALB-001", "GB-GB-003"] : []),
        JSON.stringify([
          { text: `Kategorie ${co.category} mit Bezug zu Schwellenmomenten`, source: "Website" },
          { text: co.gap ? "Kein Premium-Erinnerungsträger im Sortiment erkennbar" : "Erinnerungsträger vorhanden", source: "Sortimentsseite" },
          { text: `Region ${co.region}`, source: "Impressum" },
        ]), now]]);
  }
  await flush(db, rows);
}

async function flush(db, stmts) {
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
}
