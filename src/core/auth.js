// Login gegen das Backend der Familien-App ("bierbaum01") — Logik unveraendert,
// nur aus worker.js in ein Modul verschoben.
import { esc } from "./html.js";

export const COOKIE = "mta_session";
export const MAX_AGE = 30 * 24 * 60 * 60; // 30 Tage
const VERIFY_CACHE_MS = 5 * 60 * 1000;
const verifyCache = new Map(); // token -> { user, until }

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Worker → Worker im selben Account nur ueber die interne Service Binding;
// der oeffentliche workers.dev-Weg wird von Cloudflare geblockt (Fehler 1042).
export function authFetch(env, path, init) {
  if (env.AUTH) return env.AUTH.fetch(new Request("https://bierbaum01" + path, init));
  return fetch(String(env.AUTH_BASE || "").replace(/\/+$/, "") + path, init);
}

function allowedUsers(env) {
  return (env.ALLOWED_USERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function forgetToken(token) {
  if (token) verifyCache.delete(token);
}

export async function verify(env, token) {
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

export function isPermitted(env, user) {
  if (!user) return false;
  if (user.role === "child") return false; // Kind-Konten haben hier keinen Zugriff
  const list = allowedUsers(env);
  return list.length === 0 || list.includes(user.username.toLowerCase());
}

export function redirect(location, cookie) {
  const headers = { Location: location, "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

export function loginPage(error, username) {
  return new Response(
    `<!doctype html><html lang="de"><head><meta charset="utf-8">
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
</form></body></html>`,
    {
      status: error ? 401 : 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" },
    }
  );
}
