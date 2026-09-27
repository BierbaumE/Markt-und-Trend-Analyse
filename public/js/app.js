import { api, getState, setState } from "./api.js";

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = el("view");

const state = {
  me: null, meta: null, country: "DE", tab: "cockpit",
  countries: [], trends: [], creators: [], companies: [], contacts: [], tasks: [], kpis: null,
  creatorStatus: "", creatorMeta: null, crmMeta: null,
};

// ---------- Start ----------
init();

async function init() {
  try {
    state.meta = await api.get("/api/v1/meta");
    el("topbarVersion").textContent = "v" + state.meta.version;
    el("appVersionLabel").textContent = state.meta.version;
    renderChangelog();
  } catch (e) { /* Version ist nicht kritisch */ }

  try {
    state.me = await api.get("/api/v1/me");
    el("topbarUser").textContent = " · " + state.me.username + " (" + roleLabel(state.me.role) + ")";
    if (state.me.isAdmin) el("adminBtn").style.display = "block";
  } catch (e) {
    banner("danger", "Anmeldung konnte nicht geprüft werden: " + esc(e.message));
  }

  const health = await api.get("/api/v1/health").catch(() => null);
  if (!health || !health.dbConnected) {
    banner("danger",
      "Die Datenbank ist noch nicht verbunden. " +
      (health && health.dbError ? esc(health.dbError) + ". " : "") +
      "Anlegen mit <code>npx wrangler d1 create radar-db --location weur</code>, die <code>database_id</code> in <code>wrangler.toml</code> eintragen und <code>npx wrangler d1 migrations apply radar-db --remote</code> ausführen.");
  } else if (!health.trends) {
    banner("warn", "Noch keine Daten vorhanden. Unter „Verwaltung“ lässt sich der Szenario-Simulator starten (nachvollziehbare Demodaten für Deutschland und Schweden).");
  }

  state.country = await getState("country", "DE");
  state.tab = await getState("tab", "cockpit");
  try { state.countries = await api.get("/api/v1/countries"); } catch (e) { state.countries = []; }

  bindChrome();
  setTab(state.tab, false);
  loadTasks();
  await maybeShowWhatsNew();
}

function bindChrome() {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.view)));
  el("whatsNewBtn").addEventListener("click", () => el("whatsNewOverlay").classList.remove("hidden"));
  el("whatsNewOverlay").addEventListener("click", () => el("whatsNewOverlay").classList.add("hidden"));
  el("tasksBtn").addEventListener("click", () => { renderTasks(); el("tasksOverlay").classList.remove("hidden"); });
  el("tasksOverlay").addEventListener("click", () => el("tasksOverlay").classList.add("hidden"));
  el("adminBtn").addEventListener("click", () => { renderAdmin(); el("adminOverlay").classList.remove("hidden"); });
  el("adminOverlay").addEventListener("click", () => el("adminOverlay").classList.add("hidden"));
  el("settingsBtn").addEventListener("click", () => { renderSettings(); el("settingsOverlay").classList.remove("hidden"); });
  el("settingsOverlay").addEventListener("click", () => el("settingsOverlay").classList.add("hidden"));
  el("detailOverlay").addEventListener("click", () => el("detailOverlay").classList.add("hidden"));
}

// ---------- Version & Changelog (aus der Familien-App übernommen) ----------
function renderChangelog() {
  if (!state.meta) return;
  el("whatsNewContent").innerHTML = state.meta.changelog.map((entry) => `
    <div style="margin-bottom:14px">
      <div style="color:var(--text);font-weight:600;margin-bottom:4px">Version ${esc(entry.version)}</div>
      <ul style="margin:0;padding-left:18px">${entry.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </div>`).join("");
}

// Zeigt den Hinweis automatisch einmal je neuer Version. Der Stand liegt serverseitig
// pro Konto, damit er nicht auf jedem Gerät erneut aufpoppt; localStorage nur als Rückfall.
async function maybeShowWhatsNew() {
  if (!state.meta) return;
  const version = state.meta.version;
  let lastSeen = await getState("lastSeenVersion", null);
  if (lastSeen === null) {
    try { lastSeen = localStorage.getItem("radar-last-seen-version"); } catch (e) {}
  }
  if (lastSeen !== version) el("whatsNewOverlay").classList.remove("hidden");
  setState("lastSeenVersion", version);
  try { localStorage.setItem("radar-last-seen-version", version); } catch (e) {}
}

// ---------- Rahmen ----------
function banner(kind, html) {
  el("banners").insertAdjacentHTML("beforeend", `<div class="banner ${kind === "danger" ? "danger" : ""}">${html}</div>`);
}

function setTab(tab, persist = true) {
  state.tab = tab;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
  if (persist) setState("tab", tab);
  render();
}

function countrySelector() {
  const list = state.countries.length ? state.countries : [{ code: "DE", name: "Deutschland", enabled: true }];
  return `<div class="seg">${list.map((c) => `
    <button data-country="${c.code}" class="${c.code === state.country ? "active" : ""}">${esc(c.name)}${c.enabled ? "" : " ·"}</button>`).join("")}</div>`;
}

function bindCountry() {
  view.querySelectorAll("[data-country]").forEach((b) => b.addEventListener("click", () => {
    state.country = b.dataset.country;
    setState("country", state.country);
    render();
  }));
}

async function render() {
  view.innerHTML = `<div class="loading">Lade …</div>`;
  try {
    if (state.tab === "cockpit") await renderCockpit();
    else if (state.tab === "trends") await renderTrends();
    else if (state.tab === "creators") await renderCreators();
    else if (state.tab === "companies") await renderCompanies();
    else if (state.tab === "crm") await renderCrm();
  } catch (e) {
    view.innerHTML = `<div class="banner danger">${esc(e.message)}</div>`;
  }
}

// ---------- Cockpit ----------
async function renderCockpit() {
  const [trends, creators, kpis] = await Promise.all([
    api.get(`/api/v1/trends?country=${state.country}`),
    api.get(`/api/v1/creators?country=${state.country}`),
    api.get("/api/v1/kpis").catch(() => null),
  ]);
  state.trends = trends; state.creators = creators; state.kpis = kpis;
  const scored = trends.filter((t) => t.scored);
  const top = scored.slice(0, 3);
  const weak = scored.filter((t) => t.weakSignal);
  const disagree = scored.filter((t) => t.sdi !== null && t.sdi >= 60);
  const notToDo = scored.filter((t) => t.tms >= 70 && t.mrs !== null && t.mrs < 40);
  const shortlist = creators.filter((c) => ["scout_check_pending", "shortlisted"].includes(c.status));

  view.innerHTML = countrySelector() + `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Nordstern</div><div class="card-sub">Memory Maker Activation Rate, ${kpis ? kpis.windowDays : 45} Tage</div></div>
        <div class="score">${kpis && kpis.mmar !== null ? kpis.mmar + "<small> %</small>" : "–"}</div>
      </div>
      <div class="metric-row">
        <div class="metric"><div class="metric-label">Kontaktiert</div><div class="metric-value">${kpis ? kpis.contacted : 0}</div></div>
        <div class="metric"><div class="metric-label">Aktiviert</div><div class="metric-value">${kpis ? kpis.activated : 0}</div></div>
        <div class="metric"><div class="metric-label">Multiplikatorinnen</div><div class="metric-value">${kpis ? kpis.multipliers : 0}</div></div>
      </div>
      <div class="hint">Gemessen wird, ob Menschen selbst gestalten und andere anstecken — nicht Antwortquote, nicht Reichweite.</div>
    </div>

    <h2>Was hat sich verändert?</h2>
    ${top.length ? top.map(trendCard).join("") : `<div class="empty">Noch keine bewerteten Trends für dieses Land.</div>`}

    ${weak.length ? `<h2>Früh, leise, beschleunigend</h2>${weak.slice(0, 3).map(trendCard).join("")}` : ""}
    ${disagree.length ? `<h2>Quellen widersprechen sich — bitte ansehen</h2>${disagree.slice(0, 3).map(trendCard).join("")}` : ""}
    ${notToDo.length ? `<h2>Eher nicht investieren</h2>${notToDo.slice(0, 2).map(trendCard).join("")}` : ""}

    <h2>Kandidatinnen zur Prüfung</h2>
    ${shortlist.length ? shortlist.slice(0, 3).map(creatorCard).join("") : `<div class="empty">Keine offenen Prüfungen.</div>`}
  `;
  bindCountry();
  bindCards();
}

// ---------- Trends ----------
async function renderTrends() {
  state.trends = await api.get(`/api/v1/trends?country=${state.country}`);
  view.innerHTML = countrySelector() +
    (state.trends.length ? state.trends.map(trendCard).join("") : `<div class="empty">Keine Trends. Demodaten lassen sich in der Verwaltung erzeugen.</div>`);
  bindCountry();
  bindCards();
}

function trendCard(t) {
  return `
  <div class="card clickable" data-trend="${t.id}">
    <div class="card-head">
      <div>
        <div class="card-title">${esc(t.label)}</div>
        <div class="card-sub">${esc(t.labelLocal || "")}${t.opportunityWindow ? ` · Zeitfenster ${t.opportunityWindow.minWeeks}–${t.opportunityWindow.maxWeeks} Wochen (Schätzung)` : ""}</div>
      </div>
      <div class="score">${t.priority !== null && t.priority !== undefined ? Math.round(t.priority) : "–"}<small> Prio</small></div>
    </div>
    <div class="metric-row">
      <div class="metric"><div class="metric-label">Momentum</div><div class="metric-value">${fmt(t.tms)}</div></div>
      <div class="metric"><div class="metric-label">Memory-Bezug</div><div class="metric-value">${fmt(t.mrs)}</div></div>
      <div class="metric"><div class="metric-label">Uneinigkeit</div><div class="metric-value">${fmt(t.sdi)}</div></div>
      <div class="metric"><div class="metric-label">Sicherheit</div><div class="metric-value">${t.confidence !== null ? Math.round(t.confidence * 100) + " %" : "–"}</div></div>
    </div>
    <div class="pill-row">
      <span class="pill ${["emerging_trend", "corroborated_signal"].includes(t.lifecycle) ? "accent" : ""}">${esc(t.lifecycleLabel || "unbewertet")}</span>
      ${t.weakSignal ? `<span class="pill accent">Weak Signal</span>` : ""}
      ${t.geoConfidence === "uk_proxy" ? `<span class="pill warn">UK-Signal</span>` : ""}
      ${t.coverage !== null && t.coverage < 0.6 ? `<span class="pill warn">Abdeckung ${Math.round(t.coverage * 100)} %</span>` : ""}
      ${t.review ? `<span class="pill ok">geprüft: ${esc(t.review.decision)}</span>` : ""}
    </div>
    ${t.divergenceText ? `<div class="hint">⚠︎ ${esc(t.divergenceText)}</div>` : ""}
  </div>`;
}

// ---------- Creator ----------
async function renderCreators() {
  if (!state.creatorMeta) state.creatorMeta = await api.get("/api/v1/creators/meta");
  const q = state.creatorStatus ? `&status=${state.creatorStatus}` : "";
  state.creators = await api.get(`/api/v1/creators?country=${state.country}${q}`);
  const statuses = ["", "discovered", "scout_check_pending", "shortlisted", "interview_planned", "promoted_to_crm", "rejected"];
  view.innerHTML = countrySelector() + `
    <div class="seg">${statuses.map((s) => `<button data-status="${s}" class="${s === state.creatorStatus ? "active" : ""}">${s ? esc(state.creatorMeta.statusLabels[s] || s) : "alle"}</button>`).join("")}</div>
    ${state.creators.length ? state.creators.map(creatorCard).join("") : `<div class="empty">Keine Kandidatinnen in diesem Status.</div>`}
    <div class="hint">Bewertet wird beobachtbares Verhalten: macht, zeigt, hilft, probiert, verbindet, ermutigt, initiiert. Reichweite zählt höchstens 5 %.</div>`;
  bindCountry();
  view.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => {
    state.creatorStatus = b.dataset.status;
    render();
  }));
  bindCards();
}

function creatorCard(c) {
  return `
  <div class="card clickable" data-creator="${c.id}">
    <div class="card-head">
      <div>
        <div class="card-title">${esc(c.name || c.handle)}</div>
        <div class="card-sub">@${esc(c.handle)} · ${esc(c.region || c.country)} · ${esc((c.categories || []).join(", "))}</div>
      </div>
      <div class="score">${fmt(c.mmf)}<small> MMF</small></div>
    </div>
    <div class="metric-row">
      <div class="metric"><div class="metric-label">Soziale Energie</div><div class="metric-value">${fmt(c.sei)}</div></div>
      <div class="metric"><div class="metric-label">Fertigstellung</div><div class="metric-value">${fmt(c.cci)}</div></div>
      <div class="metric"><div class="metric-label">Scorecard</div><div class="metric-value">${c.scorecard ? c.scorecard.raw + "/30" : "–"}</div></div>
      <div class="metric"><div class="metric-label">Follower</div><div class="metric-value">${c.followers ?? "–"}</div></div>
    </div>
    <div class="pill-row">
      <span class="pill">${esc(c.statusLabel)}</span>
      ${(c.flagTexts || []).map((f) => `<span class="pill danger">${esc(f)}</span>`).join("")}
      ${c.coverage !== null && c.coverage < 0.5 ? `<span class="pill warn">Scout-Check nötig</span>` : ""}
    </div>
    ${(c.explanations || []).length ? `<ul class="explain">${c.explanations.slice(0, 4).map((x) => `<li class="${x.startsWith("+") ? "plus" : x.startsWith("–") ? "minus" : "note"}">${esc(x)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

// ---------- Händler ----------
async function renderCompanies() {
  state.companies = await api.get(`/api/v1/companies?country=${state.country}`);
  view.innerHTML = countrySelector() + (state.companies.length ? state.companies.map((c) => `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">${esc(c.name)}</div><div class="card-sub">${esc(c.category || "")} · ${esc(c.region || "")}</div></div>
        <div class="score">${fmt(c.cos)}<small> COS</small></div>
      </div>
      ${c.gap ? `<div class="hint">${esc(c.gap)}</div>` : ""}
      ${(c.reasons || []).length ? `<ul class="explain">${c.reasons.map((r) => `<li class="plus">+ ${esc(r.text)} <span class="small-muted">(${esc(r.source)})</span></li>`).join("")}</ul>` : ""}
      ${(c.skus || []).length ? `<div class="pill-row">${c.skus.map((s) => `<span class="pill accent">${esc(s)}</span>`).join("")}</div>` : ""}
      <div class="btn-row">
        <button class="btn small" data-qualify="${c.id}">Ins CRM übernehmen</button>
        ${c.website ? `<a class="btn small ghost" href="${esc(c.website)}" target="_blank" rel="noreferrer">Website</a>` : ""}
      </div>
    </div>`).join("") : `<div class="empty">Keine Händler-Kandidaten.</div>`);
  bindCountry();
  view.querySelectorAll("[data-qualify]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await api.post(`/api/v1/companies/${b.dataset.qualify}/qualify`);
      setTab("crm");
    } catch (e) { alert(e.message); b.disabled = false; }
  }));
}

// ---------- CRM ----------
async function renderCrm() {
  if (!state.crmMeta) state.crmMeta = await api.get("/api/v1/crm/meta");
  const [contacts, companies] = await Promise.all([
    api.get("/api/v1/crm/contacts"),
    api.get("/api/v1/crm/companies"),
  ]);
  state.contacts = contacts;
  view.innerHTML = `
    <h2>Gestalterinnen (${contacts.length})</h2>
    ${contacts.length ? contacts.map((c) => `
      <div class="card clickable" data-contact="${c.id}">
        <div class="card-head">
          <div><div class="card-title">${esc(c.name)}</div><div class="card-sub">${esc(c.channel || "")} · ${esc(c.country)} · ${c.eventCount} Ereignisse</div></div>
          <div>${c.derived.multiplierVerified ? `<span class="pill ok">Multiplikatorin bestätigt</span>` : c.derived.foundingEligible ? `<span class="pill accent">Founding berechtigt</span>` : ""}</div>
        </div>
        ${c.derived.milestones.length ? `<div class="pill-row">${c.derived.milestones.slice(-4).map((m) => `<span class="pill">${esc(state.crmMeta.activationLabels[m.type] || m.type)}</span>`).join("")}</div>` : `<div class="hint">Noch keine Entwicklungsschritte erfasst.</div>`}
      </div>`).join("") : `<div class="empty">Noch keine Kontakte. Kandidatinnen werden unter „Creator“ übernommen.</div>`}

    <h2>Handelspartner (${companies.length})</h2>
    ${companies.length ? companies.map((c) => `
      <div class="card">
        <div class="card-head">
          <div><div class="card-title">${esc(c.name)}</div><div class="card-sub">${esc(c.category || "")} · ${esc(c.country_code)}</div></div>
          <span class="pill accent">${esc(c.stageLabel)}</span>
        </div>
        <label>Stufe ändern</label>
        <select data-stage="${c.id}">
          ${state.crmMeta.stages.map((s) => `<option value="${s}" ${s === c.stage ? "selected" : ""}>${esc(state.crmMeta.stageLabels[s])}</option>`).join("")}
        </select>
      </div>`).join("") : `<div class="empty">Noch keine Handelspartner. Übernahme erfolgt unter „Händler“.</div>`}`;

  view.querySelectorAll("[data-contact]").forEach((c) => c.addEventListener("click", () => openContact(c.dataset.contact)));
  view.querySelectorAll("[data-stage]").forEach((sel) => sel.addEventListener("change", async () => {
    const body = { stage: sel.value };
    if (sel.value === "lost") body.lost_reason = prompt("Grund für „verloren“?") || "";
    if (sel.value === "lost" && !body.lost_reason) return render();
    try { await api.patch(`/api/v1/crm/companies/${sel.dataset.stage}`, body); render(); }
    catch (e) { alert(e.message); render(); }
  }));
}

// ---------- Detailansichten ----------
function bindCards() {
  view.querySelectorAll("[data-trend]").forEach((c) => c.addEventListener("click", () => openTrend(c.dataset.trend)));
  view.querySelectorAll("[data-creator]").forEach((c) => c.addEventListener("click", () => openCreator(c.dataset.creator)));
}

function openSheet(title, html) {
  el("detailTitle").textContent = title;
  el("detailContent").innerHTML = html;
  el("detailOverlay").classList.remove("hidden");
}

async function openTrend(id) {
  openSheet("Trend", `<div class="loading">Lade …</div>`);
  const t = await api.get(`/api/v1/trends/${id}`);
  const s = t.snapshot;
  const series = Object.entries(t.series || {});
  openSheet(t.label, `
    <div class="small-muted">${esc(t.labelLocal || "")}</div>
    ${s ? `
      <div class="metric-row">
        <div class="metric"><div class="metric-label">Momentum</div><div class="metric-value">${fmt(s.tms)}</div></div>
        <div class="metric"><div class="metric-label">Memory-Bezug</div><div class="metric-value">${fmt(s.mrs)}</div></div>
        <div class="metric"><div class="metric-label">Priorität</div><div class="metric-value">${fmt(s.priority)}</div></div>
        <div class="metric"><div class="metric-label">Lebenszyklus</div><div class="metric-value" style="font-size:12.5px">${esc(s.lifecycleLabel)}</div></div>
      </div>
      <ul class="explain">${(s.explanations || []).map((x) => `<li class="${x.startsWith("+") ? "plus" : x.startsWith("–") ? "minus" : "note"}">${esc(x)}</li>`).join("")}</ul>
      <h2>Quellen getrennt betrachtet</h2>
      ${series.map(([key, points]) => sparkline(key, points)).join("") || `<div class="empty">Keine Zeitreihen.</div>`}
      <h2>Memory-Bezug im Detail</h2>
      <div class="pill-row">${Object.entries(s.mrsComponents || {}).map(([k, v]) => `<span class="pill">${esc(mrsLabel(k))}: ${v}</span>`).join("")}</div>
    ` : `<div class="empty">Noch nicht bewertet. In der Verwaltung „Bewertung neu rechnen“ starten.</div>`}
    <h2>Deine Einschätzung</h2>
    <label>Entscheidung</label>
    <select id="trendDecision">
      <option value="relevant">relevant – weiterverfolgen</option>
      <option value="not_relevant">nicht relevant</option>
      <option value="culturally_implausible">kulturell unplausibel</option>
      <option value="watch">beobachten</option>
    </select>
    <label>Notiz (optional)</label>
    <textarea id="trendNote" rows="2" placeholder="Was spricht dafür oder dagegen?"></textarea>
    <div class="btn-row"><button class="btn" id="trendSave">Speichern</button></div>
    ${t.decisions.length ? `<h2>Bisherige Einschätzungen</h2>${t.decisions.map((d) => `<div class="row"><div><div class="row-title">${esc(d.decision)}</div><div class="row-sub">${esc(d.username)} · ${fmtDate(d.created_at)}${d.note ? " · " + esc(d.note) : ""}</div></div></div>`).join("")}` : ""}
  `);
  const btn = el("trendSave");
  if (btn) btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await api.post(`/api/v1/trends/${id}/review`, { decision: el("trendDecision").value, note: el("trendNote").value });
      el("detailOverlay").classList.add("hidden");
      render();
    } catch (e) { alert(e.message); btn.disabled = false; }
  });
}

async function openCreator(id) {
  openSheet("Kandidatin", `<div class="loading">Lade …</div>`);
  const c = await api.get(`/api/v1/creators/${id}`);
  const meta = state.creatorMeta || (state.creatorMeta = await api.get("/api/v1/creators/meta"));
  const next = meta.transitions[c.status] || [];
  openSheet(c.name || c.handle, `
    <div class="small-muted">@${esc(c.handle)} · ${esc(c.region || c.country)} · ${esc(c.url || "")}</div>
    <div class="metric-row">
      <div class="metric"><div class="metric-label">MMF</div><div class="metric-value">${fmt(c.mmf)}</div></div>
      <div class="metric"><div class="metric-label">SEI</div><div class="metric-value">${fmt(c.sei)}</div></div>
      <div class="metric"><div class="metric-label">CCI</div><div class="metric-value">${fmt(c.cci)}</div></div>
      <div class="metric"><div class="metric-label">Status</div><div class="metric-value" style="font-size:12.5px">${esc(c.statusLabel)}</div></div>
    </div>
    <ul class="explain">${(c.explanations || []).map((x) => `<li class="${x.startsWith("+") ? "plus" : x.startsWith("–") ? "minus" : "note"}">${esc(x)}</li>`).join("")}</ul>

    <div id="bridgeBox"><div class="loading">Profil und Anknüpfungspunkte werden berechnet …</div></div>

    <h2>Belege (${c.evidence.length})</h2>
    ${c.evidence.slice(0, 8).map((e) => `<div class="row"><div><div class="row-title">${esc(evidenceLabel(e.type))}</div><div class="row-sub">${fmtDate(e.observed_at)} · ${esc(e.captured_by)}${e.excerpt ? ` · „${esc(e.excerpt)}“` : ""}</div></div>${e.url ? `<a class="link-btn" href="${esc(e.url)}" target="_blank" rel="noreferrer">öffnen</a>` : ""}</div>`).join("") || `<div class="empty">Keine Belege erfasst.</div>`}

    <h2>5-Minuten-Check und Scorecard</h2>
    <div class="hint">Je Kriterium 0–3. Priorisieren ab 20, sehr genau hinschauen ab 24. „Hilft“ und „Initiiert“ zählen doppelt in der gewichteten Summe. Die Scorecard überstimmt den Algorithmus, nie umgekehrt.</div>
    ${meta.scorecardFields.map((f) => `
      <label>${esc(scorecardLabel(f))}</label>
      <select data-sc="${f}">${[0, 1, 2, 3].map((v) => `<option value="${v}" ${c.scorecard && c.scorecard[f] === v ? "selected" : ""}>${v}</option>`).join("")}</select>`).join("")}
    <label>Tisch-Test: Drei Stunden gemeinsam gestalten – danach mehr Lust aufs Gestalten?</label>
    <select data-sc-table><option value="1" ${c.scorecard && c.scorecard.table_test ? "selected" : ""}>ja</option><option value="0" ${c.scorecard && !c.scorecard.table_test ? "selected" : ""}>nein</option></select>
    <label>Notiz</label>
    <textarea id="scNotes" rows="2">${esc((c.scorecard && c.scorecard.notes) || "")}</textarea>
    <div class="btn-row"><button class="btn" id="scSave">Scorecard speichern</button></div>

    <h2>Entscheidung</h2>
    ${next.length ? `
      <label>Nächster Status</label>
      <select id="crStatus">${next.map((s) => `<option value="${s}">${esc(meta.statusLabels[s] || s)}</option>`).join("")}</select>
      <label>Begründung</label>
      <select id="crReason">
        <option value="behavior_fits">Verhalten passt</option>
        <option value="culturally_implausible">kulturell unplausibel</option>
        <option value="knows_community">kenne ihre Community persönlich</option>
        <option value="no_maker_activity">keine eigene Gestaltung</option>
        <option value="recruiting_signals">Rekrutierungsmuster</option>
        <option value="objection">Widerspruch der Person</option>
      </select>
      <label>Notiz</label>
      <textarea id="crNote" rows="2"></textarea>
      <div id="legalBox" class="hidden">
        <label>Rechtsgrundlage für die CRM-Übernahme (Pflicht)</label>
        <input id="crLegal" placeholder="z. B. berechtigtes Interesse, Art.-14-Hinweis beim Erstkontakt" />
      </div>
      <div class="btn-row"><button class="btn" id="crSave">Status setzen</button></div>
    ` : `<div class="hint">In diesem Status ist kein weiterer Schritt vorgesehen.</div>`}
  `);

  loadBridges(id);

  const statusSel = el("crStatus");
  if (statusSel) {
    const toggleLegal = () => el("legalBox").classList.toggle("hidden", statusSel.value !== "promoted_to_crm");
    statusSel.addEventListener("change", toggleLegal);
    toggleLegal();
    el("crSave").addEventListener("click", async () => {
      const body = { status: statusSel.value, reason_code: el("crReason").value, note: el("crNote").value };
      if (statusSel.value === "promoted_to_crm") body.legal_basis = el("crLegal").value;
      try {
        await api.post(`/api/v1/creators/${id}/decision`, body);
        el("detailOverlay").classList.add("hidden");
        render();
      } catch (e) { alert(e.message); }
    });
  }
  const scSave = el("scSave");
  if (scSave) scSave.addEventListener("click", async () => {
    const body = { notes: el("scNotes").value, table_test: document.querySelector("[data-sc-table]").value === "1" };
    document.querySelectorAll("[data-sc]").forEach((s) => { body[s.dataset.sc] = Number(s.value); });
    try {
      const r = await api.put(`/api/v1/creators/${id}/scorecard`, body);
      alert(`Gespeichert: ${r.raw}/30 (gewichtet ${r.weighted}/36)${r.closeLook ? " – sehr genau hinschauen" : r.prioritize ? " – priorisieren" : ""}`);
      render();
    } catch (e) { alert(e.message); }
  });
}

async function openContact(id) {
  openSheet("Kontakt", `<div class="loading">Lade …</div>`);
  const c = await api.get(`/api/v1/crm/contacts/${id}`);
  const meta = state.crmMeta;
  openSheet(c.name, `
    <div class="small-muted">${esc(c.channel || "")} · ${esc(c.country)} · Betreuung: ${esc(c.owner || "–")}</div>
    <div class="pill-row">
      ${c.derived.multiplierVerified ? `<span class="pill ok">Multiplikatorin bestätigt</span>` : ""}
      ${c.derived.foundingEligible ? `<span class="pill accent">Founding Memory Maker berechtigt</span>` : ""}
      <span class="pill">${c.derived.creations} Kreationen</span>
      <span class="pill">${c.derived.guests} mitgebracht</span>
    </div>
    <div class="hint">Rechtsgrundlage: ${esc(c.legalBasis || "nicht erfasst")} · Art.-14-Hinweis: ${c.art14 ? fmtDate(c.art14) : "offen"}</div>

    <h2>Entwicklungsweg</h2>
    ${c.events.length ? c.events.map((e) => `<div class="task-row"><span class="task-ico">•</span><div><div class="row-title">${esc(e.label)}</div><div class="row-sub">${fmtDate(e.occurred_at)}${e.notes ? " · " + esc(e.notes) : ""}</div></div></div>`).join("") : `<div class="empty">Noch keine Ereignisse.</div>`}

    <h2>Ereignis erfassen</h2>
    <label>Was ist passiert?</label>
    <select id="evType">${meta.activationTypes.map((t) => `<option value="${t}">${esc(meta.activationLabels[t] || t)}</option>`).join("")}</select>
    <label>Anzahl (nur bei „mitgebracht“ / „eingeladen“)</label>
    <input id="evCount" type="number" min="1" placeholder="optional" />
    <label>Notiz</label>
    <textarea id="evNote" rows="2"></textarea>
    <div class="btn-row"><button class="btn" id="evSave">Speichern</button></div>

    ${c.tasks.length ? `<h2>Wiedervorlagen</h2>${c.tasks.map((t) => `<div class="row"><div><div class="row-title">${esc(t.title)}</div><div class="row-sub">${t.due_at ? fmtDate(t.due_at) : ""} · ${esc(t.status)}</div></div></div>`).join("")}` : ""}
  `);
  el("evSave").addEventListener("click", async () => {
    const body = { type: el("evType").value, notes: el("evNote").value };
    const n = Number(el("evCount").value);
    if (n) body.count = n;
    try { await api.post(`/api/v1/crm/contacts/${id}/events`, body); openContact(id); loadTasks(); }
    catch (e) { alert(e.message); }
  });
}

// ---------- Profil und Anknüpfungspunkte ----------
const DIM_LABEL = {
  motif: "Motive", style: "Stil", moment: "Lebensmomente", technique: "Veredelung",
  product_type: "Produkttypen", material: "Material",
};

async function loadBridges(creatorId) {
  const box = el("bridgeBox");
  if (!box) return;
  let data;
  try {
    data = await api.get(`/api/v1/creators/${creatorId}/bridges`);
  } catch (e) {
    box.innerHTML = `<div class="hint">Anknüpfungspunkte nicht verfügbar: ${esc(e.message)}</div>`;
    return;
  }
  const dims = Object.entries(data.profile.dimensions || {});
  box.innerHTML = `
    <h2>Abgeleitetes Profil</h2>
    ${dims.length ? dims.map(([key, items]) => `
      <div style="margin-bottom:8px">
        <div class="metric-label">${esc(DIM_LABEL[key] || key)}</div>
        <div class="pill-row">${items.map((i) => `<span class="pill ${i.share >= 0.4 ? "accent" : ""}">${esc(i.label)} · ${Math.round(i.share * 100)} %</span>`).join("")}</div>
      </div>`).join("") : `<div class="hint">Noch keine Projekte erfasst, daher kein Profil ableitbar.</div>`}
    <div class="hint">${data.profile.finished} fertige von ${data.profile.projects} beobachteten Projekten${data.profile.lastActivityDays !== null ? ` · letzte Aktivität vor ${data.profile.lastActivityDays} Tagen` : ""}. Abgeleitet aus beobachteten Arbeiten, nicht aus Eigenschaften der Person.</div>

    <h2>Anknüpfungspunkte</h2>
    ${data.matches.length ? data.matches.map((m, i) => bridgeCard(m, i)).join("") : `<div class="empty">Keine Überschneidung mit den bewerteten Trends dieses Landes.</div>`}
    <div class="hint">${esc(data.note)}</div>`;

  box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const text = decodeURIComponent(b.dataset.copy);
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "kopiert ✓";
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      b.textContent = "kopiert ✓";
    }
  }));
  box.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const target = el(b.dataset.toggle);
    target.classList.toggle("hidden");
    b.textContent = target.classList.contains("hidden") ? "Nachrichtenentwurf zeigen" : "Entwurf ausblenden";
  }));
}

function bridgeCard(m, i) {
  const h = m.hook;
  return `
  <div class="card">
    <div class="card-head">
      <div>
        <div class="card-title">${esc(m.label)}</div>
        <div class="card-sub">Passung ${Math.round(m.affinity * 100)} %${m.overlap.length ? " über " + esc(m.overlap.map((o) => o.label).join(", ")) : ""}</div>
      </div>
      <div class="score">${Math.round(m.tcb)}<small> Brücke</small></div>
    </div>
    <div class="pill-row">
      ${m.qualifies ? `<span class="pill ok">für Ansprache qualifiziert</span>` : `<span class="pill warn">unter der Schwelle — erst prüfen</span>`}
      ${h.productSku ? `<span class="pill accent">${esc(h.productSku)}</span>` : ""}
      ${m.opportunityWindow ? `<span class="pill">Zeitfenster ${m.opportunityWindow.minWeeks}–${m.opportunityWindow.maxWeeks} Wo.</span>` : ""}
      ${h.guard.passed ? "" : `<span class="pill danger">Prüfung: ${esc(h.guard.findings.join(", "))}</span>`}
    </div>
    <ul class="explain">
      <li class="plus">Beobachtung: ${esc(h.observation)}</li>
      ${h.trendStatement ? `<li class="plus">Lokaler Trend: ${esc(h.trendStatement)}</li>` : ""}
      ${h.product ? `<li class="plus">Produktbrücke: ${esc(h.product)}${h.productReasons.length ? " — " + esc(h.productReasons.join("; ")) : ""}</li>` : ""}
      ${h.techniqueNote ? `<li class="plus">${esc(h.techniqueNote)}</li>` : ""}
      ${h.assortmentIdea ? `<li class="note">${esc(h.assortmentIdea)}</li>` : ""}
      <li class="minus">${esc(h.conversationIdea)}</li>
    </ul>
    <div class="btn-row">
      <button class="btn small ghost" data-toggle="draft${i}">Nachrichtenentwurf zeigen</button>
      <button class="btn small" data-copy="${encodeURIComponent(h.draft)}">Entwurf kopieren</button>
    </div>
    <div id="draft${i}" class="hidden">
      <textarea rows="14" readonly style="margin-top:8px">${esc(h.draft)}</textarea>
      <div class="hint">Entwurf, keine fertige Nachricht. Vor dem Versand lesen, anpassen und selbst verschicken — das System versendet nichts.</div>
    </div>
  </div>`;
}

// ---------- Aufgaben ----------
async function loadTasks() {
  try {
    state.tasks = await api.get("/api/v1/crm/tasks?mine=1");
  } catch (e) { state.tasks = []; }
  const due = state.tasks.filter((t) => t.overdue || t.dueToday).length;
  const badge = el("tasksBadge");
  badge.textContent = due;
  badge.classList.toggle("hidden", due === 0);
}

function renderTasks() {
  const groups = [
    ["Überfällig", state.tasks.filter((t) => t.overdue)],
    ["Heute", state.tasks.filter((t) => !t.overdue && t.dueToday)],
    ["Später", state.tasks.filter((t) => !t.overdue && !t.dueToday)],
  ];
  el("tasksContent").innerHTML = groups.map(([title, items]) => items.length ? `
    <h2>${title}</h2>
    ${items.map((t) => `
      <div class="task-row">
        <span class="task-ico">${t.overdue ? "⏰" : "•"}</span>
        <div style="flex:1">
          <div class="row-title">${esc(t.title)}</div>
          <div class="row-sub">${t.due_at ? fmtDate(t.due_at) : "ohne Termin"} · ${esc(t.origin === "system_rule" ? "automatisch" : "manuell")}</div>
        </div>
        <button class="link-btn" data-done="${t.id}">erledigt</button>
      </div>`).join("")}` : "").join("") || `<div class="empty">Keine offenen Aufgaben.</div>`;
  el("tasksContent").querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", async () => {
    await api.patch(`/api/v1/crm/tasks/${b.dataset.done}`, { status: "done" });
    await loadTasks();
    renderTasks();
  }));
}

// ---------- Verwaltung & Einstellungen ----------
async function renderAdmin() {
  const box = el("adminContent");
  box.innerHTML = `<div class="loading">Lade …</div>`;
  const [users, sources, audit] = await Promise.all([
    api.get("/api/v1/admin/users").catch(() => null),
    api.get("/api/v1/admin/sources").catch(() => []),
    api.get("/api/v1/admin/audit").catch(() => []),
  ]);
  box.innerHTML = `
    <h2>Daten</h2>
    <div class="hint">Der Szenario-Simulator erzeugt sieben nachvollziehbare Marktlagen (echter lokaler Trend, saisonale Welle, TikTok-Hype ohne Memory-Bezug, stille Kaufintention …) sowie Creator- und Händler-Archetypen. Danach die Bewertung rechnen lassen.</div>
    <div class="btn-row">
      <button class="btn" id="seedBtn">Demodaten erzeugen</button>
      <button class="btn ghost" id="recomputeBtn">Bewertung neu rechnen</button>
    </div>
    <div id="adminResult" class="hint"></div>

    <h2>Rollen</h2>
    ${users ? `${users.users.map((u) => `
      <div class="row">
        <div><div class="row-title">${esc(u.username)}</div><div class="row-sub">${fmtDate(u.updated_at)}</div></div>
        <select data-role="${esc(u.username)}" style="width:auto">${users.roles.map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${esc(roleLabel(r))}</option>`).join("")}</select>
      </div>`).join("") || `<div class="empty">Noch keine Nutzer erfasst. Wer sich anmeldet, erscheint hier automatisch.</div>`}
      <div class="hint">Feste Admins aus der Konfiguration: ${esc((users.adminUsers || []).join(", ") || "keine")}. Anmeldung und Passwörter verwaltet weiterhin die Familien-App.</div>` : `<div class="empty">Keine Berechtigung.</div>`}

    <h2>Quellen</h2>
    ${sources.map((s) => `<div class="row"><div><div class="row-title">${esc(s.key)}</div><div class="row-sub">Sensor ${esc(s.sensor)} · Tier ${s.tier} · ${esc(s.tos_status)}</div></div><span class="pill ${s.tos_status === "ok" ? "ok" : "warn"}">${s.enabled ? "aktiv" : "aus"}</span></div>`).join("") || `<div class="empty">Keine Quellen.</div>`}

    <h2>Protokoll</h2>
    ${audit.slice(0, 12).map((a) => `<div class="row"><div><div class="row-title">${esc(a.action)}</div><div class="row-sub">${esc(a.username || "")} · ${fmtDate(a.created_at)}</div></div></div>`).join("") || `<div class="empty">Kein Protokoll.</div>`}`;

  el("seedBtn").addEventListener("click", async () => {
    const btn = el("seedBtn"); btn.disabled = true; btn.textContent = "Erzeuge …";
    try {
      const r = await api.post("/api/v1/admin/seed", { countries: ["DE", "SE"] });
      const cleaned = r.removed && (r.removed.trends || r.removed.companies)
        ? ` Aufgeräumt: ${r.removed.trends} doppelte Trends, ${r.removed.companies} doppelte Händler entfernt.`
        : "";
      el("adminResult").textContent = `${r.scenarios} Szenarien über ${r.weeks} Wochen erzeugt.${cleaned} Jetzt Bewertung rechnen.`;
    } catch (e) { el("adminResult").textContent = e.message; }
    btn.disabled = false; btn.textContent = "Demodaten erzeugen";
  });
  el("recomputeBtn").addEventListener("click", async () => {
    const btn = el("recomputeBtn"); btn.disabled = true; btn.textContent = "Rechne …";
    try {
      const r = await api.post("/api/v1/admin/recompute", {});
      const parts = Object.entries(r.countries || {}).map(([k, v]) => `${k}: ${v.trends}`);
      el("adminResult").textContent = `Bewertet – ${parts.join(", ")}; Creator: ${r.creators ? r.creators.scored : 0}.`;
      render();
    } catch (e) { el("adminResult").textContent = e.message; }
    btn.disabled = false; btn.textContent = "Bewertung neu rechnen";
  });
  box.querySelectorAll("[data-role]").forEach((sel) => sel.addEventListener("change", async () => {
    try { await api.put(`/api/v1/admin/users/${encodeURIComponent(sel.dataset.role)}`, { role: sel.value }); }
    catch (e) { alert(e.message); }
  }));
}

function renderSettings() {
  el("settingsContent").innerHTML = `
    <div class="row"><div><div class="row-title">Angemeldet</div><div class="row-sub">${esc(state.me ? state.me.username : "?")} · Rolle ${esc(state.me ? roleLabel(state.me.role) : "?")}</div></div></div>
    <div class="row"><div><div class="row-title">Version</div><div class="row-sub">v${esc(state.meta ? state.meta.version : "?")}</div></div><button class="link-btn" id="settingsWhatsNew">Was ist neu</button></div>
    <div class="row"><div><div class="row-title">Land</div><div class="row-sub">Auswahl gilt für alle Ansichten</div></div>
      <select id="settingsCountry" style="width:auto">${(state.countries || []).map((c) => `<option value="${c.code}" ${c.code === state.country ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    <div class="row"><div><div class="row-title">Abmelden</div><div class="row-sub">Beendet die Sitzung auf diesem Gerät</div></div><a class="link-btn" href="/logout">abmelden</a></div>
    <div class="hint">Anmeldung, Passwörter und Konten verwaltet die Familien-App „Zuhause“. Prüfentscheidungen, Notizen und Scorecards liegen in der Radar-Datenbank und sind auf allen Geräten gleich.</div>`;
  el("settingsWhatsNew").addEventListener("click", () => {
    el("settingsOverlay").classList.add("hidden");
    el("whatsNewOverlay").classList.remove("hidden");
  });
  el("settingsCountry").addEventListener("change", (e) => {
    state.country = e.target.value;
    setState("country", state.country);
    render();
  });
}

// ---------- Hilfsfunktionen ----------
function sparkline(sourceKey, points) {
  const recent = points.slice(-26);
  const max = Math.max(...recent.map((p) => p.value), 1);
  return `
    <div style="margin-bottom:10px">
      <div class="small-muted">${esc(sourceLabel(sourceKey))}</div>
      <div class="spark">${recent.map((p, i) => `<i class="${i === recent.length - 1 ? "last" : ""}" style="height:${Math.max(2, (p.value / max) * 100)}%"></i>`).join("")}</div>
      <div class="series-label"><span>${esc(recent[0] ? recent[0].week : "")}</span><span>${esc(recent.length ? recent[recent.length - 1].week : "")}</span></div>
    </div>`;
}

const SOURCE_LABEL = {
  google_trends: "Google Trends (Suchintention)",
  pinterest_trends: "Pinterest (Planung)",
  tiktok_creative_center: "TikTok (kulturelle Dynamik)",
  etsy: "Etsy (Kaufnähe)",
  instagram_public: "Instagram (Creator-Verhalten)",
  web_public: "Web (Marktstruktur)",
};
const ROLE_LABEL = {
  admin: "Admin", product_owner: "Product Owner", country_analyst: "Länderanalyse", creator_scout: "Scout",
  creator_intelligence_lead: "Creator Intelligence", creator_success_manager: "Creator Success",
  sales: "Vertrieb", product_dev: "Produktentwicklung", native_reviewer: "Native Review", viewer: "Lesen",
};
const EVIDENCE_LABEL = {
  helps: "hat erklärt/geholfen", asks_creator: "wurde um Anleitung gebeten", credits: "wurde genannt („danke für den Tipp“)",
  imitates: "andere zeigen Nachbau", thanks: "Dank erhalten", collaborates: "Zusammenarbeit",
  challenge_participation: "bei Challenge mitgemacht", initiated_event: "hat etwas organisiert",
  encourages_beginner: "hat Anfängerin ermutigt", connects_people: "hat Menschen verbunden",
  commission_request: "Auftragsanfrage", replies_to: "Antwort", mentions: "Erwähnung",
};
const SCORECARD_LABEL = {
  makes: "Macht (gestaltet selbst)", shows: "Zeigt (macht Arbeit sichtbar)", tries: "Probiert (experimentiert)",
  helps: "Hilft (erklärt, zählt doppelt)", connects: "Verbindet (bringt Menschen zusammen)",
  encourages: "Ermutigt", initiates: "Initiiert (zählt doppelt)", relationship: "Beziehungsnähe",
  sales_open: "Verkaufsoffenheit", learning_open: "Lernoffenheit",
};
const MRS_LABEL = {
  momentProximity: "Lebensmoment", personalizationPotential: "Personalisierung", emotionalMeaning: "Emotion",
  blankFit: "Rohling-Passung", finishability: "Veredelbarkeit", commercialPotential: "Kaufnähe",
};

const sourceLabel = (k) => SOURCE_LABEL[k] || k;
const roleLabel = (r) => ROLE_LABEL[r] || r;
const evidenceLabel = (t) => EVIDENCE_LABEL[t] || t;
const scorecardLabel = (f) => SCORECARD_LABEL[f] || f;
const mrsLabel = (k) => MRS_LABEL[k] || k;
const fmt = (v) => (v === null || v === undefined ? "–" : Math.round(v));
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
};
