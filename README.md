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
- Ab 1000 px Breite ist die Woche ein Zeitraster: Stunden links, ein Tag pro Spalte, jede Vorlesung als Block an ihrer Uhrzeit; was sich überschneidet (zwei Gruppen), steht nebeneinander. Das Raster zeigt 8 bis 18 Uhr und dehnt sich, wenn etwas früher anfängt oder später endet. Durch den heutigen Tag läuft eine Linie in der Akzentfarbe an der aktuellen Uhrzeit. Ganztägige Einträge stehen in einer Zeile über dem Raster. Auf Handy und Tablet bleibt es die Liste pro Tag.
- In der Praxisphase zeigt der Plan den nächsten Block, nach dem letzten Block den letzten. Ältere Blöcke stehen nur in der Kalenderdatei.
- Unter dem Kürzel steht der volle Name, z. B. „Wirtschaftsinformatik – Software Engineering 26“. Studiengang aus api.dhbw.app, die Studienrichtung aus den Kürzeln der DHBW Mannheim (`TRACKS` in `src/catalog.js`); unbekannte Kürzel zeigen nur den Studiengang.

## Mensa

- Auf der Startseite und unter jedem Plan: was es in der Mensaria Metropol und bei greenes² gibt, mit Preisen für Studierende.
- Heute und die nächsten Tage mit Speiseplan (fünf insgesamt), geöffnet wird heute. Nach 14:00 steht dabei, dass die Ausgabe schon geschlossen hat.
- Daten vom Studierendenwerk über api.dhbw.app (`/api/mensa`, auf Metropol gekürzt), stündlich neu geladen.

## Freistunden

Unter `?frei=WWI26SEA,TINF25CS1`: zwei Kurse nebeneinander, Woche für Woche, und wann ihr beide frei habt. Erreichbar über „Freistunden finden“ auf der Startseite (mit dem zuletzt geöffneten Kurs vorausgewählt) und „Freistunden mit einem anderen Kurs finden“ auf jeder Kursseite.

- Pro Tag drei Balken über die Stunden der Woche: Kurs 1, Kurs 2, beide frei. Darunter die gemeinsamen Freistunden als Text, und ab wann beide fertig sind.
- Freistunde heißt: beide mindestens 30 Minuten ohne Termin, zwischen der ersten und der letzten Vorlesung des Tages (kürzere Lücken sind nur Pausen). Ganztägige und mehrtägige Einträge zählen als besetzt.
- Oben steht, wann ihr als Nächstes gemeinsam frei habt; die Karte zählt mit der Uhr mit.
- Verglichen wird, was jeder Kurs gerade zeigt (laufende Theoriephase, sonst die nächste). Hat ein Kurs nichts eingetragen (Praxisphase), sagt die Seite das.
- Logik und Markup: `matchDay`, `matchWeeks`, `matchHTML` in `src/render.js` (Tests in `tests/match.test.mjs`); die Ansicht mit den zwei Kurswahlen: `src/match.js`.

## Einstellungen

- Der Knopf rechts oben (Schieberegler) öffnet die Einstellungen: Darstellung „Automatisch“ (wie das Gerät), „Hell“ oder „Dunkel“, und eine Akzentfarbe (Rot, Blau, Grün, Lila, Orange) für heute, was gerade läuft und die Prüfungen. Fehler und Löschen bleiben rot.
- Dazu das **Layout**, ein eigener Look für die ganze Seite auf denselben Inhalten:
  - **Standard**: Karten und das Wochenraster, hell oder dunkel.
  - **Abfahrtstafel**: der Plan als Anzeigetafel am Bahnhof. Jeder Tag eine Tafel mit Zeilen (Zeit · Vorlesung · Raum · Status: „planmäßig“, „läuft · noch 34 Min.“, „abgefahren“), Bernstein auf Schwarz, eine tickende Bahnhofsuhr im Kopf.
  - **Plakat**: wie ein Schweizer Plakat. Riesige Schrift in Versalien, schwarze Linien, eckig, nur Schwarz, Weiß und Rot; Module sind am Namen zu erkennen, nicht an der Farbe. Hell ist das Plakat, dunkel sein Negativ.
  - **Tageslicht**: die Seite nimmt die Farbe der echten Tageszeit an (Morgenblau, Mittag, Abendrot, Nacht) und wechselt jede Minute mit. Unter dem Kurstitel läuft ein Horizont von 6 bis 22 Uhr mit der Sonne (nachts dem Mond) dort, wo die Uhr gerade steht, und den heutigen Vorlesungen als Marken; im Wochenraster ist die Sonne die Jetzt-Linie.
- Gespeichert auf dem Gerät (localStorage), nicht im Konto: Handy und Laptop können verschieden aussehen. Andere offene Tabs ziehen sofort nach. `?layout=tafel` (oder `plakat`, `tageslicht`, `standard`) zeigt ein Layout für diesen Aufruf, ohne es zu speichern, zum Ausprobieren oder Herzeigen.
- Die Layouts stehen in `src/layouts.css` (nach `styles.css` eingebettet, je ein Block pro `data-layout`), was sie an Skript brauchen (Uhr, Himmel, Horizont) in `src/layouts.js`.
- `src/theme.js` setzt die Wahl schon im `<head>` (vor dem ersten Bild, also kein weißes Aufblitzen im Dunkelmodus); `src/settings.js` ist der Knopf mit dem Fenster. Die Farben stehen in `styles.css` als `light-dark()`-Paare, die Akzente unter `[data-accent]`.
- Der Adminbereich folgt der Einstellung nicht, nur dem Gerät.

## App und offline

- Installierbar (PWA): in Chrome und Edge über „App installieren“ (auch der Knopf auf der Startseite), auf dem iPhone über Teilen → „Zum Home-Bildschirm“.
- Als App gestartet öffnet sie den zuletzt geöffneten Kurs.
- `sw.js` (Vorlage `src/sw.js`, vom Build mit Version versehen): Seite und Pläne zuerst aus dem Netz, ohne Netz der zuletzt gespeicherte Stand. Jeder einmal geöffnete Kurs und die Mensa gehen offline; die Seite sagt dann „Keine Verbindung · Stand …“. Ist das Netz zurück, lädt sie sofort neu.
- Icons (`src/icon.mjs`) und `manifest.webmanifest` erzeugt der Build.

## Konten

Anmelden ist freiwillig; der Stundenplan geht ohne. Mit Konto sind Kurs und zuletzt geöffnete Kurse auf allen Geräten gleich, und zu jeder Vorlesung gibt es eine private Notiz.

- Registrieren nur mit Adressen der DHBW Mannheim (`…@student.dhbw-mannheim.de`, `…@dhbw-mannheim.de`), bestätigt per E-Mail-Link. Passwort vergessen: Link per E-Mail.
- Server: `api/account.js` → `api/_account.js` (alle Regeln), mit `api/_password.js` (Passwörter), `api/_mail.js` (E-Mails) und der Datenbank `api/_db.js` (Neon Postgres; Tabellen legt sie beim ersten Aufruf selbst an, oder `npm run db:migrate`).
- Seite: `src/account.js` (Anmelden, Registrieren, Konto, Notizen), Adressen `?konto=anmelden`, `?konto=registrieren`, `?konto=konto`.
- Lokal (`npm start`) ohne `DATABASE_URL`: eine Postgres-Datenbank in `.data/` (PGlite), E-Mails erscheinen in der Konsole.
- `npm test`: 42 Angriffstests gegen frische Server (fremde Domains, schwache Passwörter, CSRF, SQL-Injection, fremde Notizen, Sperren, Chat-Fluten, Adminbereich ohne Anmeldung, …) und 9 Tests für die Freistunden-Berechnung.

## Chat

Unten rechts auf jeder Seite: ein Chat für alle und einer pro Kurs (der offene Kurs und die zuletzt geöffneten stehen zur Wahl).

- Angemeldete schreiben unter ihrem Anzeigenamen (Kontoseite → „Name im Chat“; jeder Name nur einmal), ohne Namen als „Nutzer 1234“. Die E-Mail-Adresse sieht niemand.
- Solange `CHAT_GUESTS` nicht `off` ist, schreiben auch Besucher ohne Konto, als „Gast 1234“. Die Nummer hängt an einem Cookie. Namen, die mit „Gast“ oder „Nutzer“ anfangen, kann niemand wählen. Zum Testen ist das an; für den echten Betrieb `CHAT_GUESTS=off` setzen, dann schreibt nur, wer angemeldet ist.
- Nachrichten sind reiner Text (höchstens 500 Zeichen) und werden als Text angezeigt, nie als HTML. Limits: 10 Nachrichten pro Minute und Person, 30 pro Minute und IP.
- Neue Nachrichten holt die Seite alle paar Sekunden ab, solange der Chat offen ist (Vercel-Funktionen können nichts von sich aus schicken). Ist er zu, zeigt ein Punkt am Knopf, dass etwas Neues da ist.
- Nachrichten werden nach 30 Tagen gelöscht, die eines Kontos mit dem Konto. Löschen und Sperren geht im Adminbereich (siehe unten); melden können Nutzer noch nichts.
- Server: `api/chat.js` → `api/_chat.js`. Seite: `src/chat.js`. Tests: `tests/chat.test.mjs`.

## Adminbereich

Unter `/admin`, für den Betreiber: Zahlen auf einen Blick, Chat-Nachrichten löschen (einzeln oder alles von einem Absender), Absender sperren, Konten suchen, Anzeigenamen entfernen, Konten löschen.

- Es gibt ihn nur, wo `ADMIN_PASSWORD_HASH` gesetzt ist. Ohne die Variable antwortet `/admin` mit 404. Auf der Seite führt kein Link dorthin, und Suchmaschinen sollen ihn nicht aufnehmen (`noindex`).
- Das Passwort steht nirgends: nicht im Code, nicht auf GitHub, nicht bei Vercel. Gespeichert ist nur sein scrypt-Hash. `npm run admin:hash` fragt das Passwort ab und gibt den Hash aus; `npm run admin:hash -- --env` schreibt ihn in `.env` (wird nicht eingecheckt).
- Auf Vercel: **Settings → Environment Variables** → `ADMIN_PASSWORD_HASH` mit dem Wert hinter dem `=`, als „Sensitive“ markieren, neu deployen. Neues Passwort: neuen Hash erzeugen, Variable ersetzen, neu deployen.
- Anmelden: höchstens 8 Versuche in 15 Minuten pro IP, 40 pro Stunde insgesamt. Die Sitzung ist ein eigenes Cookie (HttpOnly, Secure, SameSite=Strict) und gilt 12 Stunden.
- Wer nicht angemeldet ist, bekommt nur das Anmeldeformular. Aufbau und Skript des Panels schickt der Server erst nach der Anmeldung. Der Code dazu liegt allerdings in diesem Repository: Ist es öffentlich, kann ihn jeder lesen (das Passwort nicht).
- Jede Änderung braucht eine Anfrage von der eigenen Seite (CSRF) und steht im Server-Log (Aktion und Kennung, keine Inhalte).
- Eine Sperre hält bei Konten. Ein Gast ist nur ein Cookie und bekommt eine neue Nummer, wenn er es löscht; dagegen helfen die Limits pro IP und `CHAT_GUESTS=off`.
- Server: `api/admin.js` → `api/_admin.js`, die Seiten in `api/_admin_page.js`. Tests: `tests/admin.test.mjs`.

### Einrichten auf Vercel

1. Vercel → Projekt → **Storage** → **Neon** → Datenbank anlegen und mit dem Projekt verbinden. Das setzt `DATABASE_URL`.
2. E-Mail über Gmail: im Google-Konto die Bestätigung in zwei Schritten einschalten, unter [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) ein App-Passwort erzeugen. In Vercel unter **Settings → Environment Variables** `SMTP_USER` (die Gmail-Adresse) und `SMTP_PASS` (das App-Passwort) setzen. Gmail verschickt bis etwa 500 Mails am Tag. Alternativ Resend mit eigener Domain (`RESEND_API_KEY`, `MAIL_FROM`), siehe `.env.example`.
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
- `dev.html`: nur zum Testen (lokal unter http://localhost:8137/dev.html). Die echte Seite gegen eine Fake-API mit vier Datensätzen zum Umschalten (Demo, Worst case, Leer, Ein Termin): Termine, Mensa, Konto mit Notizen und Chat. Die Leiste unten wechselt Datensatz und Ansicht (Start, Kurs, Konto, Registrieren); `__overflow()` in der Konsole listet, was seitlich herausragt. Liegt absichtlich nicht in `public/` und wird nicht deployt.
- `build.mjs`: holt die Daten und baut alles. Nach Änderungen in `src/` neu ausführen.
- `serve.mjs`: kleiner lokaler Server: die gebaute Seite, die Weiterleitung zu api.dhbw.app und die Konten.
- `vercel.json`: Build-Befehl, Ausgabeordner und Sicherheits-Header für Vercel.

Der Server (`api/`, als Vercel-Funktionen; Dateien mit `_` sind geteilter Code, den auch `serve.mjs` nutzt):

- `_dhbw.js`: die Weiterleitung zu api.dhbw.app; `courses.js`, `mensa.js`, `rapla/lectures/[id]/events.js` sind ihre drei Adressen.
- `account.js` → `_account.js`: die Konten (Registrieren, Anmelden, Einstellungen, Notizen, Anzeigename).
- `chat.js` → `_chat.js`: der Chat.
- `admin.js` → `_admin.js`: der Adminbereich; `_admin_page.js`: seine zwei Seiten (Anmelden, Panel).
- `_session.js`: wer fragt (Sitzung oder Gast). `_limits.js`: Limits gegen Fluten und Raten. `_password.js`: Passwörter hashen und prüfen. `_mail.js`: die E-Mails und ihr Versand. `_db.js`: Datenbank und Tabellen.
- `_http.js`: Antworten, CSRF-Prüfung und Grenzen für beide Server. `_vercel.js`: macht aus Konten und Chat je eine Vercel-Funktion.

Die Seite (`src/`). Im Browser läuft ein Skript, das der Build aus diesen Dateien zusammensetzt:

- `render.js`: baut aus Rapla-Daten das HTML (Kursplan, Freistunden, Kalenderdatei, Mensa), beim Build und im Browser.
- `app.js`: welche Ansicht zu sehen ist, Kurse laden und aktuell halten. Richtet die anderen ein:
- `timetable.js`: der Plan auf dem Bildschirm (Wochen, Modulfilter, „läuft gerade“).
- `search.js`: die Kurssuche. `mensa.js`: die Mensa-Karte. `pwa.js`: Installieren und Offline. `match.js`: der Freistunden-Matcher. `chat.js`: der Chat. `settings.js`: die Einstellungen. `layouts.js`: Bahnhofsuhr und Himmel der anderen Layouts. `account.js`: Konten und Notizen.
- `theme.js`: setzt Hell/Dunkel und Akzent vor dem ersten Bild (eigenes Skript im `<head>`, nicht Teil des Seitenskripts).
- `sw.js`: der Service Worker (eigene Datei, nicht Teil des Skripts).
- `styles.css`: Aussehen (Standard). `layouts.css`: die Layouts Abfahrtstafel, Plakat und Tageslicht darüber.

Nur für den Build:

- `catalog.js`: die Kursliste (Kürzel, Studiengang, Studienrichtung). `home.js`: die Startseite. `page.js`: der Rahmen jeder Seite und die Content-Security-Policy. `dev.js`: die Testdaten und die Fake-API für `dev.html`. `icon.mjs`: die App-Icons.
