// Markt- und Trend-Analyse — Einstiegspunkt.
//
// 1. Login-Schutz gegen das Backend der Familien-App (Worker "bierbaum01").
// 2. API unter /api/v1/* (nur mit gueltiger Sitzung).
// 3. Auslieferung der Oberflaeche aus ./public.
//
// Wichtig: Der Login-Pfad darf nicht von der Datenbank abhaengen. Faellt D1 aus,
// muss man sich weiterhin anmelden koennen und eine Fehlermeldung sehen.

import { getCookie, verify, isPermitted, loginPage, redirect, COOKIE, MAX_AGE, authFetch, forgetToken } from "./src/core/auth.js";
import { handleApi } from "./src/api/index.js";
import { esc } from "./src/core/html.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/logout") {
      forgetToken(getCookie(request, COOKIE));
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
        let res;
        try {
          res = await authFetch(env, "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
        } catch (e) {
          return loginPage("Anmeldeserver nicht erreichbar (" + ((e && e.message) || e) + ").", username);
        }
        const text = await res.text();
        let data = {};
        try {
          data = JSON.parse(text);
        } catch (e) {
          return loginPage(
            `Anmeldeserver antwortet unerwartet (HTTP ${res.status}). ${env.AUTH ? "" : "Service Binding AUTH fehlt."}`,
            username
          );
        }
        if (!data.token) return loginPage(data.error || "Anmeldung fehlgeschlagen.", username);
        const user = await verify(env, data.token);
        if (!isPermitted(env, user)) return loginPage("Dieses Konto hat keinen Zugriff auf die Markt- und Trend-Analyse.", username);
        return redirect("/", `${COOKIE}=${encodeURIComponent(data.token)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // Ab hier: nur mit gueltiger Sitzung
    const user = await verify(env, getCookie(request, COOKIE));
    if (!isPermitted(env, user)) {
      if (url.pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "not_authenticated" }), {
          status: 401,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      return redirect("/login");
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx, user);
    }

    const res = await env.ASSETS.fetch(request);
    const type = res.headers.get("Content-Type") || "";
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-store");
    out.headers.set("X-Content-Type-Options", "nosniff");
    if (!type.includes("text/html")) return out;
    return new HTMLRewriter()
      .on("body", {
        element(el) {
          el.append(
            `<a href="/logout" title="Angemeldet als ${esc(user.username)} — abmelden"
          style="position:fixed;left:10px;bottom:10px;z-index:99999;font:12px system-ui,sans-serif;color:#9aa0a6;background:#171a21cc;border:1px solid #2a2f3a;border-radius:999px;padding:5px 10px;text-decoration:none;backdrop-filter:blur(6px)">👤 ${esc(
              user.username
            )} · Abmelden</a>`,
            { html: true }
          );
        },
      })
      .transform(out);
  },

  // Platzhalter fuer M3+: taegliche Aufnahme, Zyklusberechnung.
  async scheduled(event, env, ctx) {
    console.log("scheduled", event.cron);
  },
};
