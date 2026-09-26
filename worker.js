// Login-Schutz für die Markt- und Trend-Analyse.
// Nutzt dieselben Zugangsdaten wie die Familien-App "Zuhause" (Backend bierbaum01):
// Anmeldung per POST /auth/login, Prüfung der Sitzung per GET /auth/me.
// Der Sitzungs-Token liegt als HttpOnly-Cookie im Browser — ohne gültige Sitzung wird
// KEINE Datei der App ausgeliefert (auch nicht die index.html).

const COOKIE = "mta_session";
const MAX_AGE = 30 * 24 * 60 * 60; // 30 Tage, wie die Sitzung in der Familien-App
const VERIFY_CACHE_MS = 5 * 60 * 1000;
const verifyCache = new Map(); // token -> { user, until }

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Aufruf des Familien-App-Backends. Bevorzugt über die interne Service Binding "AUTH"
// (Worker → Worker im selben Account; der öffentliche workers.dev-Weg wird von Cloudflare
// mit Fehler 1042 geblockt). Fallback auf AUTH_BASE nur, falls keine Binding existiert.
function authFetch(env, path, init) {
  if (env.AUTH) return env.AUTH.fetch(new Request("https://bierbaum01" + path, init));
  return fetch(String(env.AUTH_BASE || "").replace(/\/+$/, "") + path, init);
}

function allowedUsers(env) {
  return (env.ALLOWED_USERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function verify(env, token) {
  if (!token) return null;
  const hit = verifyCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  try {
    const res = await authFetch(env, "/auth/me", { headers: { "X-Session-Token": token } });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !user.username) return null;
    verifyCache.set(token, { user, until: Date.now() + VERIFY_CACHE_MS });
    return user;
  } catch (e) {
    return null;
  }
}

function isPermitted(env, user) {
  if (!user) return false;
  if (user.role === "child") return false; // Kind-Konten haben hier keinen Zugriff
  const list = allowedUsers(env);
  return list.length === 0 || list.includes(user.username.toLowerCase());
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loginPage(error, username) {
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anmelden · Markt- und Trend-Analyse</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #eee;
         background: radial-gradient(circle at 20% 0%, #1d2a3a 0%, #0f1115 55%); }
  form { width: 100%; max-width: 340px; background: #171a21; border: 1px solid #2a2f3a; border-radius: 18px; padding: 28px 24px; box-shadow: 0 20px 50px #0008; }
  .logo { font-size: 30px; margin-bottom: 6px; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #9aa0a6; margin: 0 0 20px; }
  label { display: block; font-size: 12px; color: #9aa0a6; margin: 14px 0 5px; }
  input { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid #2f3542; background: #0f1115; color: #eee; font-size: 15px; }
  input:focus { outline: none; border-color: #4FD1C5; box-shadow: 0 0 0 3px #4FD1C533; }
  button { width: 100%; margin-top: 20px; padding: 12px; border: none; border-radius: 10px; background: #4FD1C5; color: #0f1115; font-weight: 700; font-size: 15px; cursor: pointer; }
  button:active { transform: scale(0.99); }
  .err { background: #3a1c22; border: 1px solid #6b2a36; color: #ffb3bf; font-size: 13px; padding: 9px 11px; border-radius: 10px; margin-bottom: 4px; }
  .hint { font-size: 12px; color: #6f7680; margin-top: 16px; text-align: center; }
</style></head><body>
<form method="POST" action="/login">
  <div class="logo">📈</div>
  <h1>Markt- und Trend-Analyse</h1>
  <p class="sub">Bitte mit deinem Konto der Familien-App anmelden.</p>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <label for="u">Benutzername</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" required value="${esc(username || "")}">
  <label for="p">Passwort</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Anmelden</button>
  <div class="hint">Gleiche Zugangsdaten wie „Zuhause“</div>
</form></body></html>`, {
    status: error ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" },
  });
}

function redirect(location, cookie) {
  const headers = { Location: location, "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/logout") {
      const t = getCookie(request, COOKIE);
      if (t) verifyCache.delete(t);
      return redirect("/login", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    }

    if (url.pathname === "/login") {
      if (request.method === "GET") {
        const user = await verify(env, getCookie(request, COOKIE));
        if (isPermitted(env, user)) return redirect("/");
        return loginPage();
      }
      if (request.method === "POST") {
        const form = await request.formData();
        const username = String(form.get("username") || "").trim();
        const password = String(form.get("password") || "");
        let data = {};
        let res;
        try {
          res = await authFetch(env, "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
        } catch (e) {
          return loginPage("Anmeldeserver nicht erreichbar (" + (e && e.message || e) + ").", username);
        }
        const text = await res.text();
        try { data = JSON.parse(text); } catch (e) {
          return loginPage(`Anmeldeserver antwortet unerwartet (HTTP ${res.status}). ${env.AUTH ? "" : "Service Binding AUTH fehlt."}`, username);
        }
        if (!data.token) return loginPage(data.error || "Anmeldung fehlgeschlagen.", username);
        const user = await verify(env, data.token);
        if (!isPermitted(env, user)) return loginPage("Dieses Konto hat keinen Zugriff auf die Markt- und Trend-Analyse.", username);
        return redirect("/", `${COOKIE}=${encodeURIComponent(data.token)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // Alles andere nur mit gültiger Sitzung
    const user = await verify(env, getCookie(request, COOKIE));
    if (!isPermitted(env, user)) return redirect("/login");

    const res = await env.ASSETS.fetch(request);
    const type = res.headers.get("Content-Type") || "";
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-store");
    if (!type.includes("text/html")) return out;
    // Kleiner Abmelde-Knopf unten links in die App einblenden
    return new HTMLRewriter().on("body", {
      element(el) {
        el.append(`<a href="/logout" title="Angemeldet als ${esc(user.username)} — abmelden"
          style="position:fixed;left:10px;bottom:10px;z-index:99999;font:12px system-ui,sans-serif;color:#9aa0a6;background:#171a21cc;border:1px solid #2a2f3a;border-radius:999px;padding:5px 10px;text-decoration:none;backdrop-filter:blur(6px)">👤 ${esc(user.username)} · Abmelden</a>`, { html: true });
      },
    }).transform(out);
  },
};
