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
