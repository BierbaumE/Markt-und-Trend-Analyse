import { json, bad } from "../core/router.js";
import { parseJson } from "../core/db.js";
import { uuidv7, nowIso } from "../core/ids.js";
import RUNTIME from "../../config/runtime.js";
import S from "../../config/scoring.js";

export const ACTIVATION_TYPES = [
  "CONTACTED", "REPLIED", "CONVERSATION_HELD", "BLANK_SENT", "BLANK_RECEIVED",
  "FIRST_CREATION_DONE", "CREATION_SHOWN", "REAL_PEOPLE_FEEDBACK", "CUSTOMER_WISH",
  "SECOND_CREATION_STARTED", "SECOND_CREATION_DONE", "PRODUCT_CALCULATED",
  "FIRST_SALE_OR_COMMISSION", "GIFTED_WITH_FEEDBACK", "TAUGHT_SOMEONE", "GUEST_BROUGHT",
  "HOSTED_SESSION", "NEXT_STEP_AGREED", "KNOWLEDGE_CONTRIBUTED", "CO_CREATION_PARTICIPATED",
  "ROLE_CHOSEN", "FOUNDING_MEMORY_MAKER_GRANTED", "OPTED_OUT",
];

const ACTIVATION_LABEL = {
  CONTACTED: "Kontakt aufgenommen", REPLIED: "hat geantwortet", CONVERSATION_HELD: "Gespräch geführt",
  BLANK_SENT: "Rohling verschickt", BLANK_RECEIVED: "Rohling angekommen",
  FIRST_CREATION_DONE: "erste Kreation fertig", CREATION_SHOWN: "Ergebnis gezeigt",
  REAL_PEOPLE_FEEDBACK: "drei Menschen gezeigt", CUSTOMER_WISH: "erster Kundenwunsch",
  SECOND_CREATION_STARTED: "zweite Kreation begonnen", SECOND_CREATION_DONE: "zweite Kreation fertig",
  PRODUCT_CALCULATED: "Produkt kalkuliert", FIRST_SALE_OR_COMMISSION: "erster Verkauf/Auftrag",
  GIFTED_WITH_FEEDBACK: "verschenkt mit Rückmeldung", TAUGHT_SOMEONE: "hat jemandem etwas beigebracht",
  GUEST_BROUGHT: "hat jemanden mitgebracht", HOSTED_SESSION: "hat selbst eingeladen",
  NEXT_STEP_AGREED: "nächster Schritt vereinbart", KNOWLEDGE_CONTRIBUTED: "Wissen beigetragen",
  CO_CREATION_PARTICIPATED: "an Co-Creation beteiligt", ROLE_CHOSEN: "Rolle gewählt",
  FOUNDING_MEMORY_MAKER_GRANTED: "Founding Memory Maker", OPTED_OUT: "Widerspruch",
};

const STAGES = ["qualified", "contacted", "in_conversation", "samples_sent", "first_order", "active_partner", "creator_hub", "paused", "lost"];
const STAGE_LABEL = {
  qualified: "qualifiziert", contacted: "kontaktiert", in_conversation: "im Gespräch",
  samples_sent: "Muster verschickt", first_order: "Erstbestellung", active_partner: "aktiver Partner",
  creator_hub: "Creator Hub", paused: "pausiert", lost: "verloren",
};

export function registerCrmRoutes(router) {
  router.get("/api/v1/crm/meta", async () =>
    json({ activationTypes: ACTIVATION_TYPES, activationLabels: ACTIVATION_LABEL, stages: STAGES, stageLabels: STAGE_LABEL }));

  router.get("/api/v1/crm/contacts", async (ctx) => {
    const rows = await ctx.db.all(
      `SELECT c.*, (SELECT COUNT(*) FROM activation_event e WHERE e.crm_contact_id = c.id) AS events
       FROM crm_contact c ORDER BY c.updated_at DESC`
    );
    const out = [];
    for (const r of rows) {
      const events = await ctx.db.all("SELECT type, occurred_at, count FROM activation_event WHERE crm_contact_id = ? ORDER BY occurred_at", r.id);
      out.push({
        id: r.id, name: r.name, brand: r.brand_label, country: r.country_code, channel: r.contact_channel,
        owner: r.owner_username, legalBasis: r.legal_basis, art14: r.art14_notice_sent_at,
        roles: parseJson(r.roles_chosen, []), eventCount: Number(r.events) || 0,
        derived: derivedStatus(events),
        lastEvent: events.length ? events[events.length - 1] : null,
      });
    }
    return json(out);
  });

  router.get("/api/v1/crm/contacts/:id", async (ctx) => {
    const c = await ctx.db.first("SELECT * FROM crm_contact WHERE id = ?", ctx.params.id);
    if (!c) return bad("Kontakt nicht gefunden", 404, "not_found");
    const events = await ctx.db.all("SELECT * FROM activation_event WHERE crm_contact_id = ? ORDER BY occurred_at", ctx.params.id);
    const interactions = await ctx.db.all(
      "SELECT * FROM crm_interaction WHERE subject_type='contact' AND subject_id=? ORDER BY occurred_at DESC", ctx.params.id
    );
    const tasks = await ctx.db.all(
      "SELECT * FROM crm_task WHERE subject_type='contact' AND subject_id=? ORDER BY due_at", ctx.params.id
    );
    return json({
      id: c.id, name: c.name, brand: c.brand_label, country: c.country_code, channel: c.contact_channel,
      legalBasis: c.legal_basis, art14: c.art14_notice_sent_at, owner: c.owner_username,
      roles: parseJson(c.roles_chosen, []),
      creatorCandidateId: c.creator_candidate_id,
      events: events.map((e) => ({ ...e, label: ACTIVATION_LABEL[e.type] || e.type })),
      interactions, tasks,
      derived: derivedStatus(events),
    });
  });

  // Activation Event erfassen. Erzeugt bei Bedarf automatisch eine Wiedervorlage.
  router.post("/api/v1/crm/contacts/:id/events", async (ctx) => {
    await ctx.require("crm.write");
    const body = await ctx.body();
    if (!ACTIVATION_TYPES.includes(body.type)) return bad("Unbekannter Ereignistyp");
    const occurred = body.occurred_at || nowIso();
    await ctx.db.run(
      "INSERT INTO activation_event (id, crm_contact_id, type, occurred_at, count, notes, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      uuidv7(), ctx.params.id, body.type, occurred, body.count ?? null, body.notes || null, ctx.user.username, nowIso()
    );
    const rule = RUNTIME.taskRules;
    const followUps = {
      BLANK_SENT: ["Ankunft des Rohlings prüfen", rule.blankSentNoArrivalDays],
      BLANK_RECEIVED: ["Ermutigend nachfragen oder gemeinsame Session anbieten", rule.blankReceivedNoCreationDays],
      CUSTOMER_WISH: ["Bei der Kalkulation unterstützen", 3],
      FIRST_CREATION_DONE: ["Nach dem Ergebnis fragen und Rückmeldung geben", 3],
    };
    const fu = followUps[body.type];
    if (fu) {
      await ctx.db.run(
        "INSERT INTO crm_task (id, subject_type, subject_id, title, due_at, assignee_username, status, origin, created_by, created_at, updated_at) VALUES (?,'contact',?,?,?,?, 'open','system_rule',?,?,?)",
        uuidv7(), ctx.params.id, fu[0], new Date(Date.now() + fu[1] * 86400000).toISOString(),
        ctx.user.username, ctx.user.username, nowIso(), nowIso()
      );
    }
    await ctx.audit({ action: "crm.event", subjectType: "contact", subjectId: ctx.params.id, detail: { type: body.type } });
    return json({ ok: true });
  });

  router.post("/api/v1/crm/interactions", async (ctx) => {
    await ctx.require("crm.write");
    const body = await ctx.body();
    if (!body.subject_type || !body.subject_id) return bad("subject_type und subject_id fehlen");
    await ctx.db.run(
      "INSERT INTO crm_interaction (id, subject_type, subject_id, channel, direction, occurred_at, summary, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      uuidv7(), body.subject_type, body.subject_id, body.channel || "other", body.direction || "out",
      body.occurred_at || nowIso(), body.summary || null, ctx.user.username, nowIso()
    );
    return json({ ok: true });
  });

  router.get("/api/v1/crm/companies", async (ctx) => {
    const rows = await ctx.db.all("SELECT * FROM crm_company ORDER BY updated_at DESC");
    return json(rows.map((r) => ({ ...r, stageLabel: STAGE_LABEL[r.stage] || r.stage })));
  });

  router.patch("/api/v1/crm/companies/:id", async (ctx) => {
    await ctx.require("crm.write");
    const body = await ctx.body();
    if (body.stage && !STAGES.includes(body.stage)) return bad("Unbekannte Stufe");
    if (body.stage === "lost" && !body.lost_reason) return bad("Für „verloren“ ist ein Grund nötig.");
    await ctx.db.run("UPDATE crm_company SET stage = COALESCE(?, stage), lost_reason = COALESCE(?, lost_reason), updated_at = ? WHERE id = ?",
      body.stage || null, body.lost_reason || null, nowIso(), ctx.params.id);
    if (body.summary) {
      await ctx.db.run(
        "INSERT INTO crm_interaction (id, subject_type, subject_id, channel, direction, occurred_at, summary, recorded_by, created_at) VALUES (?,'company',?,?,?,?,?,?,?)",
        uuidv7(), ctx.params.id, body.channel || "other", "out", nowIso(), body.summary, ctx.user.username, nowIso()
      );
    }
    await ctx.audit({ action: "crm.company.stage", subjectType: "company", subjectId: ctx.params.id, detail: { stage: body.stage } });
    return json({ ok: true });
  });

  router.get("/api/v1/crm/tasks", async (ctx) => {
    const mine = ctx.query.mine === "1";
    const rows = mine
      ? await ctx.db.all("SELECT * FROM crm_task WHERE status = 'open' AND (assignee_username = ? OR assignee_username IS NULL) ORDER BY due_at", ctx.user.username)
      : await ctx.db.all("SELECT * FROM crm_task WHERE status = 'open' ORDER BY due_at");
    const now = Date.now();
    return json(rows.map((r) => ({
      ...r,
      overdue: r.due_at ? new Date(r.due_at).getTime() < now : false,
      dueToday: r.due_at ? new Date(r.due_at).toDateString() === new Date().toDateString() : false,
    })));
  });

  router.post("/api/v1/crm/tasks", async (ctx) => {
    await ctx.require("crm.write");
    const body = await ctx.body();
    if (!body.title) return bad("title fehlt");
    await ctx.db.run(
      "INSERT INTO crm_task (id, subject_type, subject_id, title, due_at, assignee_username, status, origin, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?, 'open', ?,?,?,?)",
      uuidv7(), body.subject_type || null, body.subject_id || null, body.title, body.due_at || null,
      body.assignee_username || ctx.user.username, body.origin || "manual", ctx.user.username, nowIso(), nowIso()
    );
    return json({ ok: true });
  });

  router.patch("/api/v1/crm/tasks/:id", async (ctx) => {
    await ctx.require("crm.write");
    const body = await ctx.body();
    await ctx.db.run("UPDATE crm_task SET status = COALESCE(?, status), updated_at = ? WHERE id = ?",
      body.status || null, nowIso(), ctx.params.id);
    return json({ ok: true });
  });

  // Nordstern: Memory Maker Activation Rate (SPEC 17)
  router.get("/api/v1/kpis", async (ctx) => {
    const contacts = await ctx.db.all("SELECT id, country_code FROM crm_contact");
    const windowMs = S.kpi.mmarWindowDays * 86400000;
    let contacted = 0;
    let activated = 0;
    let multipliers = 0;
    const funnel = { CONTACTED: 0, BLANK_RECEIVED: 0, FIRST_CREATION_DONE: 0, CREATION_SHOWN: 0, TAUGHT_SOMEONE: 0, GUEST_BROUGHT: 0, FIRST_SALE_OR_COMMISSION: 0 };
    for (const c of contacts) {
      const events = await ctx.db.all("SELECT type, occurred_at, count FROM activation_event WHERE crm_contact_id = ? ORDER BY occurred_at", c.id);
      for (const key of Object.keys(funnel)) if (events.some((e) => e.type === key)) funnel[key]++;
      const first = events.find((e) => e.type === "CONTACTED");
      if (!first) continue;
      contacted++;
      const deadline = new Date(first.occurred_at).getTime() + windowMs;
      const has = (type) => events.some((e) => e.type === type && new Date(e.occurred_at).getTime() <= deadline);
      if (has("BLANK_RECEIVED") && has("FIRST_CREATION_DONE") && has("CREATION_SHOWN") &&
          (has("SECOND_CREATION_STARTED") || has("TAUGHT_SOMEONE") || has("GUEST_BROUGHT"))) activated++;
      if (derivedStatus(events).multiplierVerified) multipliers++;
    }
    return json({
      mmar: contacted ? Math.round((activated / contacted) * 1000) / 10 : null,
      contacted, activated, multipliers, funnel,
      windowDays: S.kpi.mmarWindowDays,
    });
  });
}

// Abgeleitete Status werden berechnet, nie manuell gesetzt (SPEC 12.4).
export function derivedStatus(events) {
  const has = (type) => events.some((e) => e.type === type);
  const guests = events.filter((e) => e.type === "GUEST_BROUGHT").reduce((s, e) => s + (Number(e.count) || 1), 0);
  const creations = events.filter((e) => e.type === "FIRST_CREATION_DONE" || e.type === "SECOND_CREATION_DONE").length;
  const resonance = has("FIRST_SALE_OR_COMMISSION") || has("GIFTED_WITH_FEEDBACK");
  const multiplierVerified = creations >= 2 && resonance && has("TAUGHT_SOMEONE") && guests >= 2 && has("NEXT_STEP_AGREED");
  const foundingEligible = creations >= 2 && resonance && has("KNOWLEDGE_CONTRIBUTED") && has("HOSTED_SESSION");
  return {
    multiplierVerified,
    foundingEligible,
    foundingGranted: has("FOUNDING_MEMORY_MAKER_GRANTED"),
    creations, guests, resonance,
    // Kompetenzbiografie statt Punkte (SPEC 12.3)
    milestones: events.filter((e) => [
      "FIRST_CREATION_DONE", "CREATION_SHOWN", "CUSTOMER_WISH", "PRODUCT_CALCULATED",
      "FIRST_SALE_OR_COMMISSION", "TAUGHT_SOMEONE", "HOSTED_SESSION", "FOUNDING_MEMORY_MAKER_GRANTED",
    ].includes(e.type)).map((e) => ({ type: e.type, at: e.occurred_at })),
  };
}
