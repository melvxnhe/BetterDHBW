# Arbeiten an diesem Repo

Stundenpläne aller Kurse der DHBW Mannheim aus Rapla (über api.dhbw.app), mit Mensa, Konten, Chat und Adminbereich. Was die Seite tut und welche Datei wofür da ist, steht im `README.md` (Abschnitt „Dateien“). Hier steht nur, was man beim Ändern wissen muss.

## Befehle

| Befehl | Wann |
| --- | --- |
| `npm test` | nach jeder Änderung an `api/`, `serve.mjs` oder Konten/Chat/Admin. 42 End-to-End-Tests, ca. 6 s, eigener Server mit In-Memory-Datenbank, kein Netz nötig |
| `npm run build:offline` | nach jeder Änderung in `src/`: baut aus `data/*.json` und bricht ab, wenn das zusammengesetzte Seitenskript nicht parst |
| `npm start` | bauen (mit Netz) und Server auf http://localhost:8137 |
| Vorschau | `.claude/launch.json`: `timetable` (Port 8137), `timetable-test` (Port 8138). `dev.html` hat Worst-Case-Daten zum Umschalten |

`public/` und `dev.html` sind Build-Ausgabe (nicht eingecheckt). Ohne Build zeigt der Server den alten Stand.

## Wie der Code zusammenhängt

- **Browser-Skript = ein Scope.** `build.mjs` hängt `render.js, timetable.js, search.js, mensa.js, pwa.js, chat.js, account.js, app.js` (in dieser Reihenfolge) zu einem Skript zusammen und entfernt `export `. Folgen:
  - Keine `import`s zwischen diesen Dateien; alles Top-Level teilt sich einen Namensraum (Namen nur einmal vergeben).
  - Jede Datei außer `render.js` definiert genau eine `setupX(...)`-Funktion; `app.js` (zuletzt) ruft sie auf. Neues Browser-Feature: eigene Datei mit `setupX`, in `SCRIPTS` in `build.mjs` eintragen, in `app.js` einrichten.
  - `render.js` läuft im Build (Node) **und** im Browser: keine Node-APIs, keine DOM-Abhängigkeit beim Laden.
  - Nur für den Build (nicht im Browser): `catalog.js`, `home.js`, `page.js`, `dev.js`, `icon.mjs`.
- **CSP mit Hashes:** `src/page.js` hasht jedes eingebettete `<script>`/`<style>`. Kein zusätzliches Inline-Skript und keine `on…=`-Attribute (werden blockiert); Logik gehört ins Seitenskript. `style="…"`-Attribute sind erlaubt (für CSS-Variablen wie `--cols`).
- **Server: ein Kern, zwei Adapter.** Die Logik steckt in `api/_*.js` (Unterstrich = geteilter Code). `api/<name>.js` macht daraus per `vercel()` eine Vercel-Funktion, `serve.mjs` ruft dieselben Handler lokal auf. Neue API: Routen mit `api(name, methods, routes)` aus `_http.js`, Adapter in `api/`, Rewrite in `vercel.json` **und** Eintrag in `APIS` in `serve.mjs`.
- **Proxy zu api.dhbw.app:** nur `api/_dhbw.js` entscheidet, welcher Pfad was abruft.
- **Datenbank:** `api/_db.js`. Schemaänderung = neues `CREATE TABLE/ALTER … IF NOT EXISTS` in `SCHEMA`. `migrate()` prüft nur, ob die Tabelle `LAST` existiert: neue Tabelle ans Ende und `LAST` darauf setzen, sonst läuft die Migration auf bestehenden Datenbanken nicht. Lokal ohne `DATABASE_URL`: PGlite in `.data/`.

## Regeln, die die Tests (und die Sicherheit) erwarten

- Ausgabe von Nutzer- oder API-Text ins HTML immer durch `esc()` (aus `render.js`) oder als `textContent`. Chat und Notizen sind reiner Text.
- Ändernde Anfragen: JSON mit eigener Herkunft (CSRF-Prüfung in `_http.js`); SQL nur mit Parametern (`q(text, params)`).
- Fehler aus tiefen Funktionen: `throw new Problem(status, code, deutscheMeldung)`; Antworten mit `reply()`/`fail()`.
- Neue Limits über `limit()` aus `_limits.js`. Keine Inhalte, E-Mail-Adressen oder Tokens ins Log.
- Secrets nur als Umgebungsvariablen (siehe `.env.example`); `.env` und `.data/` sind ignoriert. Admin-Passwort nur als Hash (`npm run admin:hash`).
- Neue Server-Funktion = neue Tests in `tests/*.test.mjs` (Helfer: `startServer`, `person` aus `tests/_server.mjs`).

## Stil

- Oberfläche und README: Deutsch, „du“, kurz. Code-Kommentare: Englisch, erklären das Warum; jede Datei beginnt mit einem Kommentar, was sie tut.
- Keine neuen Abhängigkeiten ohne guten Grund; Versionen fest (ohne `^`). Node 22, ES-Module.
- Commits: Englisch, Betreff im Imperativ („Add …“, „Keep …“), Text mit Stichpunkten zu Verhalten, Sicherheit und Tests. README mitpflegen, wenn sich Verhalten oder Dateien ändern.
- Deploy: Push auf `main` → Vercel baut (`node build.mjs`). Ist api.dhbw.app beim Build weg, nimmt er `data/`.
