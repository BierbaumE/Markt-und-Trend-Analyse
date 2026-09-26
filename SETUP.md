# Einrichtung — Markt- und Trend-Analyse (Cloudflare)

Reihenfolge einhalten. Nach Schritt 4 ist die App mit echten Daten in D1 lauffähig.

## 1. Datenbank anlegen (einmalig, EU-Standort — später nicht änderbar)

```
npx wrangler d1 create radar-db --location weur
```

Die ausgegebene `database_id` in `wrangler.toml` bei `[[d1_databases]]` eintragen
(Platzhalter `HIER_DIE_DATABASE_ID_EINTRAGEN` ersetzen).

## 2. Dateien committen

Alle Dateien dieses Pakets ins Repo `BierbaumE/Markt-und-Trend-Analyse`, Branch `main`.
`worker.js` und `wrangler.toml` **zusammen in einem Commit**, sonst läuft kurz eine Mischversion.

Neue Ordner: `src/`, `config/`, `ontology/`, `migrations/`, `public/css/`, `public/js/`.
Die alte `public/index.html` wird durch die neue ersetzt. Den Prototyp vorher sichern,
falls du einzelne Ansichten später übernehmen willst.

## 3. Schema einspielen

```
npx wrangler d1 migrations apply radar-db --remote
```

## 4. In der App

Anmelden → oben rechts 👤 Verwaltung → **Demodaten erzeugen** → **Bewertung neu rechnen**.
Danach zeigen Cockpit, Trends, Creator und Händler bewertete Daten.

## Was wo liegt

| Datei | Zweck |
|---|---|
| `worker.js` | Einstieg: Login, API, Auslieferung, Cron-Platzhalter |
| `src/core/*` | Login, Router, Datenbankzugriff, Rollen, Protokoll, IDs |
| `src/api/*` | Endpunkte je Bereich |
| `src/scoring/*` | Statistik und Bewertung (Momentum, Lebenszyklus, Memory-Bezug, soziale Energie) |
| `src/simulator/seed.js` | Szenario-Simulator mit bekannter Wahrheit |
| `src/version.js` | **APP_VERSION und CHANGELOG** — bei jeder Änderung pflegen |
| `config/*` | Gewichte, Laufzeit, Länderpakete |
| `migrations/*` | D1-Schema |
| `public/*` | Oberfläche ohne Build-Schritt |

## Später (nicht jetzt nötig)

KV, R2, Queues, Workflows, Vectorize und Cron sind in `wrangler.toml` als Kommentar
vorbereitet. Sie setzen den Workers-Paid-Tarif voraus und kommen mit den Meilensteinen M3+.
