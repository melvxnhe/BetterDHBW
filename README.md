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

- Build: `node build.mjs` holt Kursliste, Studiengänge und Vorschau-Kurs und schreibt die Seite nach `public/`.
- `api/courses.js`, `api/rapla/lectures/[id]/events.js` und `api/mensa.js` reichen Abrufe an api.dhbw.app weiter; Vercels Edge-Cache hält Antworten fünf Minuten.
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
- Auch der volle Name passt: `software engineering`, `imbit`, `bank` finden die Kurse dazu.

## Kursplan

- Die ganze laufende Theoriephase, auch die schon vergangenen Wochen (grau im Wochenwähler). Geöffnet wird die aktuelle Woche.
- In der Praxisphase zeigt der Plan den nächsten Block, nach dem letzten Block den letzten. Ältere Blöcke stehen nur in der Kalenderdatei.
- Unter dem Kürzel steht der volle Name, z. B. „Wirtschaftsinformatik – Software Engineering 26“. Studiengang aus api.dhbw.app, die Studienrichtung aus den Kürzeln der DHBW Mannheim (`TRACKS` in `src/render.js`); unbekannte Kürzel zeigen nur den Studiengang.

## Mensa

- Auf der Startseite und unter jedem Plan: was es in der Mensaria Metropol und bei greenes² gibt, mit Preisen für Studierende.
- Heute und die nächsten Tage mit Speiseplan (fünf insgesamt), geöffnet wird heute. Nach 14:00 steht dabei, dass die Ausgabe schon geschlossen hat.
- Daten vom Studierendenwerk über api.dhbw.app (`/api/mensa`, auf Metropol gekürzt), stündlich neu geladen.

## App und offline

- Installierbar (PWA): in Chrome und Edge über „App installieren“ (auch der Knopf auf der Startseite), auf dem iPhone über Teilen → „Zum Home-Bildschirm“.
- Als App gestartet öffnet sie den zuletzt geöffneten Kurs.
- `sw.js` (Vorlage `src/sw.js`, vom Build mit Version versehen): Seite und Pläne zuerst aus dem Netz, ohne Netz der zuletzt gespeicherte Stand. Jeder einmal geöffnete Kurs und die Mensa gehen offline; die Seite sagt dann „Keine Verbindung · Stand …“. Ist das Netz zurück, lädt sie sofort neu.
- Icons (`src/icon.mjs`) und `manifest.webmanifest` erzeugt der Build.

## Konten

Anmelden ist freiwillig; der Stundenplan geht ohne. Mit Konto sind Kurs und zuletzt geöffnete Kurse auf allen Geräten gleich, und zu jeder Vorlesung gibt es eine private Notiz.

- Registrieren nur mit Adressen der DHBW Mannheim (`…@student.dhbw-mannheim.de`, `…@dhbw-mannheim.de`), bestätigt per E-Mail-Link. Passwort vergessen: Link per E-Mail.
- Server: `api/account.js` → `api/_account.js` (alle Regeln), Datenbank `api/_db.js` (Neon Postgres; Tabellen legt sie beim ersten Aufruf selbst an, oder `npm run db:migrate`).
- Seite: `src/account.js` (Anmelden, Registrieren, Konto, Notizen), Adressen `?konto=anmelden`, `?konto=registrieren`, `?konto=konto`.
- Lokal (`npm start`) ohne `DATABASE_URL`: eine Postgres-Datenbank in `.data/` (PGlite), E-Mails erscheinen in der Konsole.
- `npm test`: 18 Angriffstests gegen einen frischen Server (fremde Domains, schwache Passwörter, CSRF, SQL-Injection, fremde Notizen, Sperren, …).

### Einrichten auf Vercel

1. Vercel → Projekt → **Storage** → **Neon** → Datenbank anlegen und mit dem Projekt verbinden. Das setzt `DATABASE_URL`.
2. Bei [resend.com](https://resend.com) ein Konto anlegen, eine eigene Domain bestätigen und einen API-Key erzeugen. In Vercel unter **Settings → Environment Variables** `RESEND_API_KEY` und `MAIL_FROM` (z. B. `Stundenplan <noreply@deine-domain.de>`) setzen. Ohne eigene Domain stellt Resend nur an die eigene Adresse zu.
3. Neu deployen. Bis beides gesetzt ist, bleibt „Anmelden“ ausgeblendet bzw. Registrieren meldet, dass der Mail-Versand fehlt.

### Sicherheit

- Passwörter: scrypt mit Salt, Vergleich in konstanter Zeit, mindestens 10 Zeichen, Abgleich mit bekannten Datenlecks (Have I Been Pwned, nur die ersten 5 Zeichen des SHA-1-Hashes verlassen den Server).
- Sitzungen: zufälliger Token im Cookie `__Host-sid` (HttpOnly, Secure, SameSite=Lax), in der Datenbank nur dessen SHA-256. 30 Tage, Abmelden auf allen Geräten möglich, Passwort-Reset beendet alle Sitzungen.
- Links in E-Mails: einmalig, 24 h bzw. 1 h, Token im `#`-Teil der Adresse (erreicht keinen Server-Log); Linkziel aus `APP_URL`, nie aus dem Host-Header.
- Keine Konto-Aufzählung: Registrieren, Login und Reset antworten gleich, egal ob es die Adresse gibt; Sperre nach 5 Fehlversuchen pro Adresse, Limits pro IP.
- CSRF: Änderungen nur als JSON mit eigener Herkunft. SQL nur mit Parametern.
- Content-Security-Policy mit Hashes für das eingebettete CSS/JS, `frame-ancestors 'none'`, `nosniff`, Referrer-Policy, Permissions-Policy.
- „Meine Daten herunterladen“ und „Konto löschen“ auf der Kontoseite.

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
