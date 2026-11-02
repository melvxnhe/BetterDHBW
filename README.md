# DHBW Mannheim Stundenplan

Die Vorlesungspläne aller Kurse der DHBW Mannheim, live aus Rapla (über api.dhbw.app). Ein inoffizielles Projekt; verbindlich bleibt Rapla.

## Starten

Doppelklick auf `start.cmd`. Das holt Kursliste und Plan, baut die Seite und öffnet http://localhost:8137.

Oder im Terminal (Node 20 oder neuer):

```
npm start
```

**Wichtig:** Die Pläne lädt die Seite im Browser nach. api.dhbw.app erlaubt das nicht direkt aus dem Browser, deshalb reicht `serve.mjs` die Abrufe weiter. Kurse öffnen sich also nur, wenn die Seite über `start.cmd` / `npm start` läuft, nicht beim Öffnen von `index.html` per Doppelklick.

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
| `npm run build` | Holt Kursliste und Vorschau-Kurs aus Rapla und schreibt `index.html` und `dev.html` neu |
| `npm run build:offline` | Baut aus `data/*.json`, ohne Netz |
| `node build.mjs --course WWI26AWIA` | Ein anderer Kurs für die Vorschau auf der Startseite |
| `npm run serve` | Startet nur den Server auf Port 8137 |
| `npm start` | Bauen und starten |

## Dateien

- `index.html`: die fertige Seite (CSS und JS eingebettet): Startseite, und jeder Kurs unter `?kurs=…`.
- `dev.html`: nur zum Testen, mit Worst-Case-Daten zum Umschalten. Nicht veröffentlichen.
- `src/render.js`: baut aus Rapla-Daten das HTML (Startseite, Kursplan, Kalenderdatei), beim Build und im Browser.
- `src/app.js`: Verhalten (Startseite, Kurssuche, Wochen, Filter, „läuft gerade“).
- `src/styles.css`: Aussehen.
- `build.mjs`: holt die Daten und baut alles. Nach Änderungen in `src/` neu ausführen.
- `serve.mjs`: kleiner Server ohne Abhängigkeiten, mit Weiterleitung zu api.dhbw.app.
