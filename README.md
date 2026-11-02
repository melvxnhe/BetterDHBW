# DHBW Mannheim Stundenplan

Die Vorlesungspläne aller Kurse der DHBW Mannheim, live aus Rapla (über api.dhbw.app). Ein inoffizielles Projekt; verbindlich bleibt Rapla.

## Starten

Doppelklick auf `start.cmd`. Das holt Kursliste und Plan, baut die Seite und öffnet http://localhost:8137.

Oder im Terminal (Node 20 oder neuer):

```
npm start
```

**Wichtig:** Die Pläne lädt die Seite im Browser nach. api.dhbw.app erlaubt das nicht direkt aus dem Browser, deshalb reicht ein kleiner Server die Abrufe weiter: lokal `serve.mjs`, auf Vercel die Funktionen in `api/`. Kurse öffnen sich also nicht, wenn man `public/index.html` per Doppelklick öffnet.

## Vercel

Das Repo ist fertig für Vercel, `vercel.json` stellt alles ein:

- Build: `node build.mjs` holt Kursliste und Vorschau-Kurs und schreibt die Seite nach `public/`.
- `api/courses.js` und `api/rapla/lectures/[id]/events.js` reichen Abrufe an api.dhbw.app weiter; Vercels Edge-Cache hält Antworten fünf Minuten.
- Die Kursliste und die Vorschau auf der Startseite stammen vom letzten Build. Ist api.dhbw.app beim Build nicht erreichbar, nimmt der Build die gespeicherte Kopie aus `data/`.
- Ein Push auf `main` löst den nächsten Deploy aus. Für eine täglich frische Kursliste in Vercel einen Deploy Hook anlegen und ihn regelmäßig aufrufen.

## Startseite

- Große Suche oben, daneben eine echte, live laufende Vorschau eines Kurses (Standard: WWI26SEA).
- „Alle Kurse“: jeder Mannheimer Kurs nach Fakultät und Studiengang-Kürzel, neueste Jahrgänge zuerst. Ein Klick öffnet den Plan.
- „Von Rapla zu deiner Woche“: kurz, was die Seite tut.
- Das Logo oben links führt von jedem Kurs zurück zur Startseite.

## Suche

- Kurskürzel tippen (`wwi26`, `tinf`, `wib`), Groß- und Kleinschreibung und Bindestriche sind egal.
- Pfeiltasten und Enter, oder klicken. `/` springt von überall in die Suche.
- Ohne Eingabe zeigt die Liste die zuletzt geöffneten Kurse und die Nachbarkurse des offenen.
- Der gewählte Kurs steht in der Adresse (`?kurs=WWI26AWIA`), lässt sich also teilen und als Lesezeichen speichern.
- Rapla liefert nur kommende Termine. Kurse in der Praxisphase oder abgeschlossene Kurse sind deshalb leer.

## Befehle

| Befehl | Was es tut |
| --- | --- |
| `npm run build` | Holt Kursliste und Vorschau-Kurs aus Rapla und schreibt `public/index.html` und `dev.html` neu |
| `npm run build:offline` | Baut aus `data/*.json`, ohne Netz |
| `node build.mjs --course WWI26AWIA` | Ein anderer Kurs für die Vorschau auf der Startseite |
| `npm run serve` | Startet nur den Server auf Port 8137 |
| `npm start` | Bauen und starten |

## Dateien

- `public/index.html`: die fertige Seite (CSS und JS eingebettet): Startseite, und jeder Kurs unter `?kurs=…`. Wird gebaut, nicht eingecheckt.
- `dev.html`: nur zum Testen (lokal unter http://localhost:8137/dev.html), mit Worst-Case-Daten zum Umschalten. Liegt absichtlich nicht in `public/` und wird nicht deployt.
- `api/`: die Weiterleitung zu api.dhbw.app als Vercel-Funktionen; `_dhbw.js` nutzt auch `serve.mjs`.
- `vercel.json`: Build-Befehl und Ausgabeordner für Vercel.
- `src/render.js`: baut aus Rapla-Daten das HTML (Startseite, Kursplan, Kalenderdatei), beim Build und im Browser.
- `src/app.js`: Verhalten (Startseite, Kurssuche, Wochen, Filter, „läuft gerade“).
- `src/styles.css`: Aussehen.
- `build.mjs`: holt die Daten und baut alles. Nach Änderungen in `src/` neu ausführen.
- `serve.mjs`: kleiner Server ohne Abhängigkeiten, mit Weiterleitung zu api.dhbw.app.
