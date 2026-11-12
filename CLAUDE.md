# Arbeiten an diesem Repo

Stundenpläne aller Kurse der DHBW Mannheim aus Rapla (über api.dhbw.app), mit Mensa, Konten, Chat und Adminbereich. Was die Seite tut und welche Datei wofür da ist, steht im `README.md` (Abschnitt „Dateien“). Hier steht nur, was man beim Ändern wissen muss.

## Befehle

| Befehl | Wann |
| --- | --- |
| `npm test` | nach jeder Änderung an `api/`, `serve.mjs`, Konten/Chat/Admin oder der Freistunden-Logik in `render.js`. 42 End-to-End-Tests (eigener Server mit In-Memory-Datenbank) plus 9 Unit-Tests (`tests/match.test.mjs`), ca. 6 s, kein Netz nötig |
| `npm run build:offline` | nach jeder Änderung in `src/`: baut aus `data/*.json` und bricht ab, wenn das zusammengesetzte Seitenskript nicht parst |
| `npm start` | bauen (mit Netz) und Server auf http://localhost:8137 |
| Vorschau | `.claude/launch.json`: `timetable` (Port 8137), `timetable-test` (Port 8138). `dev.html` hat Worst-Case-Daten zum Umschalten |

`public/` und `dev.html` sind Build-Ausgabe (nicht eingecheckt). Ohne Build zeigt der Server den alten Stand.

## Wie der Code zusammenhängt

- **Browser-Skript = ein Scope.** `build.mjs` hängt `render.js, timetable.js, search.js, mensa.js, pwa.js, match.js, chat.js, settings.js, layouts.js, account.js, app.js` (in dieser Reihenfolge) zu einem Skript zusammen und entfernt `export `. Folgen:
  - Keine `import`s zwischen diesen Dateien; alles Top-Level teilt sich einen Namensraum (Namen nur einmal vergeben).
  - Jede Datei außer `render.js` definiert genau eine `setupX(...)`-Funktion; `app.js` (zuletzt) ruft sie auf. Neues Browser-Feature: eigene Datei mit `setupX`, in `SCRIPTS` in `build.mjs` eintragen, in `app.js` einrichten.
  - `render.js` läuft im Build (Node) **und** im Browser: keine Node-APIs, keine DOM-Abhängigkeit beim Laden.
  - Nur für den Build (nicht im Browser): `catalog.js`, `home.js`, `page.js`, `dev.js`, `icon.mjs`.
  - Ausnahme `theme.js`: läuft als eigenes Skript im `<head>` (Theme vor dem ersten Bild). Seine Funktionen (`readTheme`, `applyTheme`, `THEME_*`) sind global und werden von `settings.js` benutzt.
- **CSP mit Hashes:** `src/page.js` hasht jedes eingebettete `<script>`/`<style>` (ohne Attribute, sonst greift der Hash nicht). Keine `on…=`-Attribute (werden blockiert); Logik gehört ins Seitenskript, nur `theme.js` steht wegen des ersten Bildes im `<head>`. `style="…"`-Attribute sind erlaubt (für CSS-Variablen wie `--cols`).
- **Server: ein Kern, zwei Adapter.** Die Logik steckt in `api/_*.js` (Unterstrich = geteilter Code). `api/<name>.js` macht daraus per `vercel()` eine Vercel-Funktion, `serve.mjs` ruft dieselben Handler lokal auf. Neue API: Routen mit `api(name, methods, routes)` aus `_http.js`, Adapter in `api/`, Rewrite in `vercel.json` **und** Eintrag in `APIS` in `serve.mjs`.
- **Die Woche als Zeitraster** (ab 1000 px, `styles.css` „week panels“): `toWeeks()` in `render.js` gibt jedem Tag eine `layout`-Map (Event → `{ s, e, lane, lanes }`, Stunden des Tages und Überschneidungs-Spuren) und jeder Woche `lo`/`hi`; die Map hängt am Tag, nicht am Event, weil `app.js` die Events als JSON vergleicht. `sessionHTML()` schreibt die Werte als `--s/--e/--lane/--lanes` ins `style`, die Woche `--lo/--hi`; das CSS positioniert die Blöcke absolut, Container-Queries kürzen kurze Blöcke. Ganztägige Einträge (00:00–00:00) gehen in die `.allday`-Zeile statt in die Spalte. `timetable.js` setzt `--now` auf den heutigen Tag (nur innerhalb `lo..hi`). Unter 1000 px gelten die Variablen nicht und alles ist die Liste. Testen: `dev.html?data=Worst%20case&kurs=WOW23B---VERSORGUNGSWIRTSCHAFT` (07:00–22:00, 15 Minuten, drei parallel, ganztägig, mehrtägig, Wochenende).
- **Ansichten:** `body[data-view]` ist `home`, `course`, `match` (Freistunden, `?frei=A,B`) oder `account` (`?konto=…`). `app.js` wechselt sie mit `swap()`; danach baut `start()` (`timetable.js`) Wochen-Tabs und „heute“ für alles, was `tabsHTML()`-Tabs und `.day[data-date]` hat, auch im Matcher.
- **Proxy zu api.dhbw.app:** nur `api/_dhbw.js` entscheidet, welcher Pfad was abruft.
- **Datenbank:** `api/_db.js`. Schemaänderung = neues `CREATE TABLE/ALTER … IF NOT EXISTS` in `SCHEMA`. `migrate()` prüft nur, ob die Tabelle `LAST` existiert: neue Tabelle ans Ende und `LAST` darauf setzen, sonst läuft die Migration auf bestehenden Datenbanken nicht. Lokal ohne `DATABASE_URL`: PGlite in `.data/`.

- **Layouts:** `styles.css` ist der Standard; `layouts.css` (vom Build dahinter eingebettet) hält je einen Block unter `:root[data-layout="tafel"|"plakat"|"tageslicht"]`, der zuerst die Tokens (`--bg`, `--surface`, `--text`, `--accent`, `--m*`, `--radius`) und dann Formen und wenige Strukturen überschreibt; die Komponenten folgen den Tokens. Neues Markup für ein Layout nur per `layouts.js` (Uhr, Himmel, Horizont), nie in `render.js`. Ein neues Layout: Eintrag in `THEME_LAYOUTS` (`theme.js`), `LAYOUTS` (`settings.js`), ein CSS-Block; `data-layout` fehlt beim Standard. `settings.js` feuert `layoutchange`, `layouts.js` hört darauf. Die Regeln unter „Gestaltung“ gelten für den Standard; Abfahrtstafel und Plakat haben bewusst Versalien, Tageslicht bewusst Farbverlauf und Blur.
- **Gestaltung:** eine Schrift (system-ui), Größen aus wenigen Stufen (0.75/0.8125/0.875/0.9375/1/1.125/1.25 rem und die Titel), Flächen durch Tonstufen statt Linien, kein Glas/Blur, Schatten nur auf Schwebendem (Menü, Dialog, Chat). Chrome ohne Farbe; Farbe liegt auf den Daten (Module, heute, „läuft gerade“) und Fehlern (`--danger`).
- **Farben:** nur über die Tokens in `:root` (`styles.css`), jeder als `light-dark(hell, dunkel)`. Keine `prefers-color-scheme`-Regeln mehr: Hell/Dunkel stellt man in den Einstellungen um (`data-theme`), das würde eine Media-Query übergehen. `--accent` ist wählbar (`data-accent`); für Fehler und Löschen `--danger`.

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
