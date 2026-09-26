// Winziger Router fuer Muster wie "/api/v1/trends/:id".
export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp(
      "^" +
        pattern
          .split("/")
          .map((part) => {
            if (part.startsWith(":")) {
              keys.push(part.slice(1));
              return "([^/]+)";
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("/") +
        "/?$"
    );
    this.routes.push({ method, rx, keys, handler });
    return this;
  }
  get(p, h) { return this.add("GET", p, h); }
  post(p, h) { return this.add("POST", p, h); }
  put(p, h) { return this.add("PUT", p, h); }
  patch(p, h) { return this.add("PATCH", p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.rx);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return null;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export function bad(message, status = 400, code) {
  return json({ error: code || "bad_request", message }, status);
}
