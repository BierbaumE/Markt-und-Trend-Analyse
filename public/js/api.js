// Zugriff auf die eigene API. Die Sitzung steckt im HttpOnly-Cookie,
// es werden also keine Token im Browser gespeichert.
async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
  });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("Nicht angemeldet");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { error: "bad_json", message: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Fehler ${res.status}`);
    err.code = data && data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: "POST", body: JSON.stringify(body || {}) }),
  put: (p, body) => request(p, { method: "PUT", body: JSON.stringify(body || {}) }),
  patch: (p, body) => request(p, { method: "PATCH", body: JSON.stringify(body || {}) }),
};

// Ansichtszustand liegt serverseitig pro Konto (ersetzt localStorage).
export async function getState(key, fallback = null) {
  try {
    const r = await api.get(`/api/v1/state/${encodeURIComponent(key)}`);
    return r && r.value !== null && r.value !== undefined ? r.value : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function setState(key, value) {
  try {
    await api.put(`/api/v1/state/${encodeURIComponent(key)}`, { value });
  } catch (e) {
    /* Zustand ist Komfort, kein Muss */
  }
}
