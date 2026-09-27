// ---------- Version & Changelog ----------
// ERINNERUNG FÜR CLAUDE (jede künftige Sitzung an diesem Projekt): Wenn du eine Änderung
// machst, die deployt wird, erhöhe APP_VERSION (semver-artig: Patch für kleine Fixes,
// Minor für neue Funktionen) und trage oben in CHANGELOG einen neuen Eintrag im gleichen
// Stil ein (kurze, nutzerseitige Stichpunkte auf Deutsch, bei Fehlerbehebungen mit dem
// Warum). Nicht überspringen, auch wenn die Änderung klein scheint.
export const APP_VERSION = "0.4.1";

export const CHANGELOG = [
  { version: "0.4.1", notes: [
    "Fast alle Trends landeten auf „verworfen“: Die Einordnung stützte sich auf Rangplätze innerhalb eines Landes, was bei wenigen Trends zu grob ist. Der Lebenszyklus rechnet jetzt mit absoluten Maßen (Steigung, Quellenbestätigung, Persistenz) und liefert plausible Klassen",
    "Divergenzmuster wurden nie angezeigt, weil die Richtungserkennung Schwellen nutzte, die bei kleinen Vergleichsmengen nie erreicht werden. Sie arbeitet jetzt mit Rangplätzen je Quelle — Hinweise wie „Inspiration ohne Kommerz“ oder „stille Kaufintention“ erscheinen wieder",
    "Szenario „stille Kaufintention“ im Simulator geschärft, damit das Muster eindeutig erkennbar ist",
  ]},
  { version: "0.4.0", notes: [
    "Creator-Detail zeigt jetzt ein abgeleitetes Profil: mit welchen Motiven, Stilen, Lebensmomenten, Veredelungen und Produkttypen jemand tatsächlich arbeitet — errechnet aus den beobachteten Arbeiten, nicht aus Eigenschaften der Person",
    "Neu: Anknüpfungspunkte. Je passendem Trend erscheinen Passung, Brückenwert, empfohlener Rohling, erprobte Veredelung auf unserer Oberfläche, eine Sortimentsidee und ein fertiger Nachrichtenentwurf zum Kopieren",
    "Der Entwurf enthält nur Zahlen aus der Bewertung und Aussagen aus Belegen; eine Prüfung blockiert Alter, Familienplanung, Gesundheit, Reichweiten-Erwähnungen und Einkommensversprechen",
  ]},
  { version: "0.3.2", notes: [
    "Trends und Händler erschienen mehrfach in der Liste, weil frühere Simulatorläufe bei jedem Start neue Zeilen mit gleichem Namen angelegt hatten. Der Simulator räumt diese Dubletten jetzt beim Start auf und meldet, wie viele entfernt wurden",
    "Die Trendliste zeigt je Trend nur noch die neueste Bewertung, auch wenn mehrere im selben Zyklus entstanden sind",
  ]},
  { version: "0.3.1", notes: [
    "Szenario-Simulator ließ sich nicht zweimal starten: beim erneuten Lauf brach er mit einem Datenbankfehler ab, weil bestehende Profile übersprungen wurden, die zugehörigen Belege aber auf neue Kennungen verwiesen. Er arbeitet jetzt wiederholbar und aktualisiert vorhandene Demodaten statt sie doppelt anzulegen",
  ]},
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
