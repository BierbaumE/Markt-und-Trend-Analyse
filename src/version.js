// ---------- Version & Changelog ----------
// ERINNERUNG FÜR CLAUDE (jede künftige Sitzung an diesem Projekt): Wenn du eine Änderung
// machst, die deployt wird, erhöhe APP_VERSION (semver-artig: Patch für kleine Fixes,
// Minor für neue Funktionen) und trage oben in CHANGELOG einen neuen Eintrag im gleichen
// Stil ein (kurze, nutzerseitige Stichpunkte auf Deutsch, bei Fehlerbehebungen mit dem
// Warum). Nicht überspringen, auch wenn die Änderung klein scheint.
export const APP_VERSION = "0.3.0";

export const CHANGELOG = [
  { version: "0.3.0", notes: [
    "Versionsanzeige, Änderungsprotokoll und „Was ist neu“ übernommen aus der Familien-App — der Hinweis erscheint automatisch einmal pro neuer Version",
    "„Was ist neu“ merkt sich den Stand jetzt serverseitig pro Konto statt im Browser: auf dem zweiten Gerät erscheint der Hinweis nicht erneut",
    "Rollenverwaltung im Einstellungen-Menü: Admins vergeben Radar-Rollen (Analyst, Scout, Vertrieb, …)",
  ]},
  { version: "0.2.0", notes: [
    "Daten liegen jetzt in der Datenbank statt im Browser: Prüfentscheidungen, Notizen und Scorecards sind auf allen Geräten gleich und bleiben nach dem Browser-Aufräumen erhalten",
    "Trend-, Creator- und Händlerbewertung rechnen mit echten Verfahren (Momentum, Quellenuneinigkeit, Lebenszyklus, Memory-Bezug, soziale Energie)",
    "Szenario-Simulator: erzeugt sieben nachvollziehbare Marktlagen für Deutschland und Schweden, damit die Bewertung ohne echte Datenquellen prüfbar ist",
  ]},
  { version: "0.1.0", notes: [
    "Erste Version: Prototyp mit Demodaten, Anmeldung über das Konto der Familien-App",
  ]},
];
