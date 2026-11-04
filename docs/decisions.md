# Entscheidungen und Annahmen

## Technik
- **Next.js 16 (App Router), React 19, TypeScript 5, Drizzle ORM + better-sqlite3.** Node >= 22. Build mit `output: "standalone"`.
- **Basis-Image später `node:22-slim`** statt Alpine (Native-Modul better-sqlite3).
- **Tests mit Vitest.** Berechnungs- und Sicherheitslogik liegt in reinen Funktionen unter `src/lib`.
- **Start-Validierung** in `instrumentation.ts`: ungültige Konfiguration -> Fehlermeldung (ohne Secrets) und Exit-Code 1. Migrationen laufen beim Start. SIGTERM/SIGINT schließen die DB sauber (WAL wird zurückgeschrieben).
- **Admin-Passwort-Hash** nutzt Trennzeichen `:` statt `$`, weil `$` in `.env`/docker compose interpoliert wird.

## Daten
- Monate sind Strings `YYYY-MM`; Beträge Integer-Cent.
- Änderungen (Preis, Gewicht, Beteiligung) gelten ab `valid_from_month`; Gewichtsänderung = neue `memberships`-Zeile. Vergangene Monate bleiben dadurch reproduzierbar. `payments.amount_cents` friert den Betrag ein.
- Der Owner ist ein Teilnehmer mit `is_owner = 1` (per Partial-Unique-Index höchstens einer). Für ihn gibt es keine `payments`-Zeile.
- Token nur als SHA-256-Hash gespeichert.

## Fälligkeit
- Monat M wird am `DUE_DAY` von M fällig. `DUE_DAY` ist auf 1-28 begrenzt (gültig in jedem Monat). Nur ganze Monate.

## Teilnehmer-Seite
- Aktueller Monat plus vergangene Monate, keine zukünftigen. "Ich habe bezahlt" kann bis zur Bestätigung zurückgenommen werden.

## Sicherheits-Log / fail2ban
- Es läuft bereits ein fail2ban-Container beim Betreiber. Die App liefert nur das feste Zeilenformat `SUBSPLIT_AUTHFAIL ...` in `SECURITY_LOG_FILE` (Bind-Mount, auch in den fail2ban-Container einzubinden) und auf stdout. Kein eigenes fail2ban-Setup, nur ein kopierbarer Beispiel-`failregex` in der README.

## Offen / noch zu prüfen
- **PayPal.me:** URL-Format, Dezimaltrenner und Währung vor Meilenstein 5 gegen die offizielle Doku prüfen. Die Namensregel (`[A-Za-z0-9]{1,20}`) ist bewusst konservativ und noch nicht gegen PayPal-Regeln belegt.

## Rundung (Änderung gegenüber dem Briefing, auf Wunsch des Admins)
- Statt Largest-Remainder wird **jeder Anteil auf den ganzen Cent abgerundet**; der Rest (< 1 Cent pro Beteiligtem) wird dem Admin zugeschrieben.
  - Ist der Admin Teilnehmer des Abos, wird der Rest auf seinen Anteil gerechnet.
  - Sonst wird er als eigene Zeile "Rundungsrest (Admin)" angezeigt, damit die Summe der Zeilen weiterhin dem Abo-Preis entspricht.
- Folge: Mitzahler zahlen nie mehr als ihren exakten Anteil. Der Rest beträgt höchstens (Beteiligte - 1) Cent pro Abo und Monat.

## Sicherheit
- Client-IP: die Socket-Adresse reicht Next.js nicht an Route-Handler durch. Ein Hook in `instrumentation-node.ts` setzt für jede Anfrage den Header `x-subsplit-peer` selbst und überschreibt dabei Clientwerte. Danach wertet `createIpResolver` den Header `X-Forwarded-For` nur aus, wenn der Peer in `TRUSTED_PROXY_CIDR` liegt (von rechts, erster nicht vertrauenswürdiger Eintrag).
- Proxy ohne X-Forwarded-For oder mit ungültiger Kette -> `ip=unknown` (nie die Proxy-Adresse melden).
- Cookie `Secure` richtet sich nach `BASE_URL` (https), nicht nach Request-Headern.
- Admin-CSRF: Cookie `SameSite=Strict` + Origin-Prüfung + Header `x-csrf-token` gegen Token in der Session.
- Passwort-Hash: scrypt (N=65536, r=8, p=1), `npm run hash-password`.

## Freigaben für Fälligkeit/Änderungen
- Änderungen (Preis, Gewicht, Beteiligung) sind ab Monat M nur erlaubt, wenn M >= aktueller Monat und für Monate >= M noch keine Zahlungen erzeugt wurden. Dadurch bleiben erzeugte Zahlungen unverändert.

## Verifikation externer Formate (Stand dieser Session)
- **PayPal.Me** (Recherche, PayPal-Hilfeseite): Name nur Buchstaben/Ziffern, max. 20 Zeichen, nicht case-sensitiv. Betrag steht am Linkende, Währung direkt dahinter (Beispiel der Hilfe: `PayPal.Me/DiaRusso/25AUD`). Dezimaltrenner und `EUR` sind **nicht** ausdrücklich belegt, die Domain `paypal.com/paypalme` statt `paypal.me` ebenfalls nicht. Die Doku-Seiten waren in der Session nicht abrufbar (Netzwerk-Allowlist).
- **EPC069-12:** Das Original-PDF war in der Session nicht abrufbar (`europeanpaymentscouncil.eu` nicht in der Allowlist). Das Payload-Layout stützt sich auf die Suchergebnisse (IBAN Pflicht, Betrag optional max. 12 Zeichen, Zweck 4 Zeichen, Verwendungszweck max. 140 Zeichen) und auf die Feldreihenfolge der Spezifikation; BIC-Regel von Version 002 bitte vor dem Livebetrieb gegen die Spezifikation prüfen.

## HTTP-Schicht (ohne Oberfläche)
- Teilnehmer: `GET /api/p/[token]?month=`, `POST /api/p/[token]/paid`. Unbekannte und widerrufene Tokens liefern identisch `404 {"error":"not_found"}`. Rate-Limit 120 Anfragen/Minute je IP.
- Admin: `POST /api/admin/login` (10 Versuche/15 min je IP), danach Session-Cookie (`HttpOnly`, `SameSite=Strict`, `Secure` bei https-`BASE_URL`). Schreibende Admin-Routen verlangen Origin-Prüfung und `x-csrf-token`.
- Magic-Links werden nur bei Erzeugung bzw. Neuerzeugung im Klartext zurückgegeben; gespeichert ist nur der SHA-256-Hash.
- Security-Header (CSP, nosniff, DENY, `Referrer-Policy: no-referrer`, HSTS) via `next.config.ts`. CSP erlaubt vorläufig `unsafe-inline` und wird beim Bau der Oberfläche auf Nonces umgestellt.
- Turbopack: dynamische Dateizugriffe im Sicherheits-Log sind mit `turbopackIgnore` markiert, sonst würde das ganze Projekt ins Standalone-Bundle getraced.

## Oberfläche
- Stil nach Vorlage des Admins: flach, keine Rundungen, Haarlinien, Mono-Großbuchstaben-Labels, ein Signalrot. **Dunkel ist Standard**, Hell per Umschalter (`localStorage`, wird vor dem ersten Paint gesetzt).
- Schriften: Archivo und IBM Plex Mono, lokal über `@fontsource` ausgeliefert (kein Google-Fonts-Aufruf: CSP und Datenschutz).
- Rot in Flächen `#e0300f` (weißer Text), roter Text auf dunklem Grund `#ff6a4d`, damit der Kontrast reicht.
- QR-Codes bleiben immer schwarz auf weiß (Scanbarkeit) und stehen mobil nebeneinander; sie sind nachrangig gegenüber dem PayPal-Button und den kopierbaren Bankdaten.
- Teilnehmer-Seite ruft die Services direkt (Server Component), nicht die API; gleiche Token-Prüfung, gleiche Logzeilen, gleiche 404-Seite für unbekannte und widerrufene Links.
- Admin-Oberfläche ist eine Client-App gegen die Admin-API (Übersicht, Abos, Teilnehmer).
- **Mobil keine QR-Codes** (Breite <= 640 px): PayPal-Button öffnet den Link, "Per Überweisung bezahlen" klappt die Bankdaten mit Kopieren-Buttons auf. QR-Codes (PayPal und GiroCode) erscheinen nur am Desktop. Einen Link, der eine Banking-App mit vorausgefülltem GiroCode öffnet, gibt es nach meinem Kenntnisstand nicht (EPC definiert nur das QR-Textformat, keine URL); eine Spezifikation dafür habe ich nicht gefunden.
