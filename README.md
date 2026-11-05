# SubSplit

Selbst gehostete Web-App, um gemeinsame Abos (Streaming, Software, …) auf mehrere Personen aufzuteilen.
Du bezahlst alle Abos und bekommst das Geld der Teilnehmer. Jeder Teilnehmer erhält einen persönlichen
Magic-Link (kein Konto nötig) und sieht dort **eine Gesamtsumme pro Monat**, die Aufschlüsselung pro Abo
und genau einen PayPal-Link bzw. die Bankdaten (am Desktop zusätzlich PayPal-QR und GiroCode).

- Alle Beträge sind Integer-Cent. Anteile werden **auf den vollen Cent abgerundet**, der Rest (höchstens
  Beteiligte − 1 Cent pro Abo und Monat) bleibt beim Admin. Die Summe der Zeilen entspricht immer dem Abo-Preis.
- Transparenz: Mitzahler eines Abos sehen Anzeigenamen, Gewichte, Prozentanteile und Beträge aller Beteiligten
  dieses Abos. Alles andere (E-Mail, Links, Referenz-IDs und Status anderer, fremde Abos) liefert der Server
  gar nicht erst aus.
- Stack: TypeScript, Next.js (App Router), SQLite mit Drizzle, ein Docker-Container.

Entscheidungen und Annahmen: [`docs/decisions.md`](docs/decisions.md).

## Schnellstart

Voraussetzung: Docker mit Compose und ein laufender Reverse Proxy (Caddy) in einem externen Docker-Netzwerk.

```bash
git clone <dieses-repo> subsplit && cd subsplit
cp .env.example .env
```

1. **Passwort-Hash erzeugen** (Eingabe verdeckt; das Passwort landet nicht in der Shell-History):

   ```bash
   docker compose build
   docker run --rm -it subsplit:latest node scripts/hash-password.mjs
   ```

   Die Ausgabe (`scrypt:…`) in `.env` bei `ADMIN_PASSWORD_HASH` eintragen. Das Format enthält bewusst kein `$`,
   damit Docker Compose nichts interpoliert.

2. **`.env` ausfüllen** (siehe Tabelle unten). `SESSION_SECRET` erzeugen mit `openssl rand -hex 32`.

3. **Netzwerk des Proxys** ermitteln und in `.env` setzen:

   ```bash
   docker network inspect proxy --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
   ```

   Das Ergebnis (z. B. `172.18.0.0/16`) kommt in `TRUSTED_PROXY_CIDR`. Heißt dein Netzwerk anders, setze `PROXY_NETWORK`.

4. **Logverzeichnis anlegen** (der Container läuft als Benutzer `node`, UID 1000):

   ```bash
   mkdir -p logs && sudo chown 1000:1000 logs
   ```

5. **Starten:**

   ```bash
   docker compose up -d
   docker compose ps        # Status "healthy" abwarten
   ```

   Die Datenbank-Migration läuft beim Start automatisch. Bei ungültiger Konfiguration (z. B. falsche
   IBAN-Prüfsumme, ungültiger PayPal-Name) bricht der Container mit einer klaren Fehlermeldung ab:
   `docker compose logs subsplit`.

Der Port 3000 ist nur im Docker-Netzwerk erreichbar und nicht auf dem Host veröffentlicht.

## Erste Schritte in der App

1. `https://<BASE_URL>/admin` öffnen und anmelden.
2. **Teilnehmer → Teilnehmer anlegen:** zuerst dich selbst mit „Das bin ich“ (bekommt keine Zahlung und keinen Link,
   trägt aber den Rundungsrest). Dann die Mitzahler. Den Magic-Link siehst du **nur einmal** direkt nach dem Anlegen
   (gespeichert wird nur ein Hash); „Neuer Link“ macht den alten sofort ungültig, „Sperren“ deaktiviert ihn.
3. **Abos:** Abo mit Preis und Startmonat anlegen, dann Beteiligungen mit Gewicht (1 = gleicher Anteil) setzen.
4. **Übersicht:** pro Monat siehst du, wer offen ist, wer „bezahlt“ gemeldet hat, und kannst bestätigen.

Regeln für Änderungen: Preis, Gewicht und Beteiligung gelten **ab einem Monat**; vergangene Monate bleiben unverändert.

- Im **laufenden Monat** lässt sich alles ändern, **solange noch keine Zahlung dieses Monats als „bezahlt“ gemeldet
  oder bestätigt ist**. Noch offene Zahlungen werden dabei automatisch neu berechnet (Referenz-ID und Status bleiben,
  nur der Betrag ändert sich). Teile Teilnehmern also besser erst Beträge mit, wenn die Einrichtung abgeschlossen ist.
- Meldet die erste Person „bezahlt“, ist der Monat gesperrt; Änderungen gelten dann frühestens ab dem Folgemonat
  (die Oberfläche zeigt den frühesten Monat an und füllt die Formulare damit vor).
- **Abo beenden** (normaler Weg bei einer Kündigung): Alle Beteiligungen enden nach dem gewählten Monat, das Abo wird
  archiviert („Beendete Abos anzeigen“) und lässt sich wieder aktivieren. Die Vergangenheit bleibt unverändert.
- **Abo löschen** entfernt es endgültig und geht nur, solange es in keiner abgelaufenen oder bezahlt gemeldeten
  Abrechnung vorkommt; sonst bitte beenden.

## Konfiguration (nur Umgebungsvariablen)

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `BASE_URL` | ja | Öffentliche URL, Basis der Magic-Links (z. B. `https://abos.example.org`). Cookies sind `Secure`, wenn sie mit `https` beginnt. |
| `APP_NAME` | nein | Name im Verwendungszweck `<ID> <App-Name> <JJJJ-MM>` (Standard `SubSplit`). |
| `ADMIN_USERNAME` | nein | Admin-Benutzername (Standard `admin`). |
| `ADMIN_PASSWORD_HASH` | ja | Hash aus `scripts/hash-password.mjs` (scrypt). |
| `SESSION_SECRET` | ja | Mindestens 32 Zeichen, signiert die Admin-Session. |
| `RECIPIENT_NAME` | ja | Empfängername (GiroCode, max. 70 Zeichen). |
| `RECIPIENT_PAYPAL_ME` | ja | Nur der Name nach `paypal.me/` (Buchstaben und Ziffern, max. 20 Zeichen). |
| `RECIPIENT_IBAN` | ja | Wird beim Start auf gültige Prüfsumme geprüft. |
| `DUE_DAY` | nein | Fälligkeitstag im Monat, 1–28 (Standard 1). |
| `TRUSTED_PROXY_CIDR` | empfohlen | Adressbereich(e) des Proxy-Netzwerks, kommagetrennt. Nur von dort wird `X-Forwarded-For` übernommen. |
| `SECURITY_LOG_FILE` | nein | Standard `/logs/security.log`. |
| `DATABASE_PATH` | nein | Standard `/data/subsplit.db` (im Volume). |
| `PROXY_NETWORK` | nein | Name des externen Docker-Netzwerks (Standard `proxy`), nur für `docker-compose.yml`. |
| `SMTP_*` | – | Erst in Phase 2. |

Zeitzone des Containers: `Europe/Berlin`.

## Caddy

Beispiel-Eintrag im Caddyfile des separaten Proxys (beide Container im selben Docker-Netzwerk):

```caddyfile
abos.example.org {
    encode zstd gzip
    reverse_proxy subsplit:3000
}
```

Das HTTPS-Zertifikat übernimmt Caddy.

- **Client-IP:** Caddy verwirft eingehende `X-Forwarded-*`-Header standardmäßig (solange du `trusted_proxies` nicht
  setzt) und trägt die IP der Verbindung ein. Setze **kein** `trusted_proxies` in Caddy, außer vor Caddy hängt
  noch ein weiterer Proxy.
- **Magic-Link im Access-Log:** Der Token steht im URL-Pfad (`/p/<token>`) und landet in Caddys Access-Log,
  falls du eines aktivierst. Du kannst ihn schwärzen, z. B. mit einem Log-Filter auf `request>uri` mit
  `regexp "^/p/[A-Za-z0-9_-]+" "/p/REDACTED"`. **Diese Syntax ist nicht gegen die Caddy-Doku geprüft** –
  teste sie, bevor du dich darauf verlässt. Die App selbst setzt `Referrer-Policy: no-referrer`, damit der Link
  nicht als Referer weitergegeben wird.

## Sicherheits-Log und fail2ban

Bei jedem fehlgeschlagenen Zugriff mit unbekanntem Token und bei jedem fehlgeschlagenen Admin-Login schreibt die App
genau eine Zeile in `SECURITY_LOG_FILE` (und zusätzlich nach stdout):

```
2026-11-04T13:43:12+01:00 SUBSPLIT_AUTHFAIL ip=203.0.113.5 reason=invalid_token
2026-11-04T13:43:13+01:00 SUBSPLIT_AUTHFAIL ip=203.0.113.5 reason=admin_login
```

- Ein **gesperrter (widerrufener) Link** zählt nicht als Fehlversuch: Er erzeugt nur
  `SUBSPLIT_NOTICE … reason=revoked_token`, damit ein Teilnehmer mit altem Link nicht gebannt wird. Für den Client
  sehen unbekannte und gesperrte Links identisch aus (gleiche 404-Antwort).
- Token, Passwörter und andere Geheimnisse stehen nie im Log. Ist keine gültige Client-IP bestimmbar, steht
  `ip=unknown` (kein Ban möglich, dafür nie eine falsche Adresse).
- Die Datei liegt per Bind-Mount unter `./logs/security.log` auf dem Host.

**Dein bestehender fail2ban-Container** muss die Datei lesen können: Binde `./logs` dort (z. B. schreibgeschützt)
ein und verweise im Jail auf den Pfad **im fail2ban-Container**. Eine eigene fail2ban-Installation ist nicht nötig.

Beispiel-Filter `filter.d/subsplit.conf`:

```ini
[Definition]
failregex = SUBSPLIT_AUTHFAIL ip=<ADDR> reason=(?:invalid_token|admin_login)\s*$
ignoreregex =
```

Beispiel-Jail (Aktion/Ports/`ignoreip` nach deiner bestehenden globalen Konfiguration):

```ini
[subsplit]
enabled  = true
filter   = subsplit
logpath  = /pfad/im/fail2ban-container/security.log
maxretry = 5
findtime = 10m
bantime  = 1d
```

Hinweis zu `<ADDR>` statt `<HOST>`: `<HOST>` würde auch Hostnamen akzeptieren, also auch `ip=unknown` als DNS-Namen
behandeln. `<ADDR>` matcht nur IPv4/IPv6. Läuft Caddy in Docker, muss die Ban-Aktion deines fail2ban die Kette
`DOCKER-USER` verwenden (Ports 80/443), sonst greift der Ban nicht, und das Firewall-Backend (iptables oder nftables)
muss zum System passen. Das ist Teil deiner bestehenden fail2ban-Konfiguration und hier nicht getestet.

**Filter gegen die echte Logdatei testen** (auf dem Host, mit installiertem `fail2ban-regex`, oder im fail2ban-Container):

```bash
fail2ban-regex ./logs/security.log /etc/fail2ban/filter.d/subsplit.conf
```

Erwartet: Treffer nur für `SUBSPLIT_AUTHFAIL` mit gültiger IP. `ip=unknown`, `SUBSPLIT_NOTICE` und unbekannte
`reason`-Werte werden nicht gematcht. (Der Filter wurde mit `fail2ban-regex` 1.0.2 gegen eine von der App erzeugte
Logdatei und Beispielzeilen mit IPv4/IPv6 geprüft.)

**Rotation und Aufbewahrung:** Die App rotiert die Datei selbst nach Größe (5 MB, drei Generationen:
`security.log`, `.1`, `.2`, `.3`). Das Log enthält IP-Adressen und dient nur der Sicherheit. Vorschlag: höchstens
30 Tage aufbewahren. Bei wenig Verkehr deckt die Größenrotation das nicht zeitlich ab, deshalb zusätzlich per Cron
auf dem Host:

```bash
find ./logs -name 'security.log.*' -mtime +30 -delete
```

## Backup und Wiederherstellung

Die Datenbank liegt im Docker-Volume `subsplit-data` (`/data/subsplit.db`), **nie im Image**.

**Konsistentes Backup bei laufender App** (nicht einfach die `.db`-Datei kopieren, SQLite läuft im WAL-Modus):

```bash
docker compose exec subsplit node scripts/backup.mjs /data/backups/subsplit-$(date +%F).db
docker compose cp subsplit:/data/backups/subsplit-$(date +%F).db ./backups/
```

Sichere diese Datei außerhalb des Servers. Wiederherstellen: Container stoppen, Backup als `/data/subsplit.db`
ins Volume legen (die Dateien `subsplit.db-wal` und `-shm` löschen), Container starten.
Alternativ kannst du das gesamte Volume bei gestoppter App sichern.

Magic-Links sind nur als Hash gespeichert und lassen sich nach einem Verlust nicht wiederherstellen; dann pro
Teilnehmer „Neuer Link“ erzeugen.

## Datenschutz

- **Mitzahler sehen sich gegenseitig** mit Anzeigenamen, Gewichten, Anteilen und Beträgen **innerhalb der
  gemeinsamen Abos**. Wähle Anzeigenamen entsprechend (Vorname oder Spitzname). Teilnehmer erfahren das auf ihrer Seite.
- Die App speichert **E-Mail-Adressen** (optional, nur für den Admin sichtbar; für Phase 2 vorgesehen) und
  im **Sicherheits-Log IP-Adressen** (nur für Sicherheitszwecke, nicht ewig aufbewahren, siehe oben).
- Sonst keine personenbezogenen Daten in Logs. Keine Tracker, keine externen Schriften oder Skripte.

## Bekannte Unsicherheiten

Bitte vor dem Livebetrieb prüfen:

1. **PayPal-Link:** Belegt (PayPal-Hilfe): Der Name darf nur Buchstaben/Ziffern enthalten (max. 20 Zeichen), und
   der Betrag steht am Linkende mit dem Währungscode direkt dahinter (Beispiel der Hilfe: `PayPal.Me/DiaRusso/25AUD`).
   **Nicht belegt** sind der Dezimaltrenner (Punkt), `EUR` im Link und die Domain-Variante `paypal.com/paypalme`
   statt `paypal.me`. Die Link-Erzeugung ist an **einer Stelle** konfigurierbar
   ([`src/lib/pay/paypal.ts`](src/lib/pay/paypal.ts), mit Tests). **Mache einen Test mit einem Kleinstbetrag**
   (z. B. 0,01 € an dich selbst), bevor du Links verschickst. Die Notiz lässt sich über den Link nicht vorausfüllen,
   deshalb steht die Referenz-ID mit Kopieren-Button daneben.
2. **GiroCode (EPC069-12):** Das Original-PDF war bei der Entwicklung nicht abrufbar. Das Payload-Layout
   (BCD, Version 002, UTF-8, SCT, BIC leer, Name, IBAN, `EURx.xx`, Verwendungszweck ≤ 140 Zeichen, Fehlerkorrektur M)
   folgt der Spezifikation nach bestem Wissen und Sekundärquellen. **Prüfe die BIC-Regel von Version 002 gegen die
   Spezifikation und scanne einen Test-GiroCode mit deiner Banking-App.**
3. **Banking-App per Link öffnen** gibt es nach meinem Kenntnisstand nicht (EPC definiert nur ein QR-Textformat).
   Mobil gibt es deshalb den PayPal-Button und aufklappbare, kopierbare Bankdaten.
4. **Docker-Image:** Bei der Entwicklung stand kein Docker-Daemon zur Verfügung. Geprüft wurden das
   Compose-File (`docker compose config`) und das Laufzeit-Layout des Images (Start, Migration, `/healthz`,
   Security-Header). Der erste `docker compose build` auf deinem Server ist der eigentliche Test.
5. **Client-IP hinter Docker:** Der Ban greift nur, wenn Caddy die echte Client-IP sieht. Bei IPv6 oder NAT durch
   Docker (Userland-Proxy) kann stattdessen eine interne Adresse ankommen. Prüfe nach dem Start mit einem absichtlich
   falschen Link, welche IP im Sicherheits-Log steht.
6. **Content-Security-Policy** erlaubt vorläufig `unsafe-inline` für Skripte/Styles (Next.js-Hydration); Umstellung
   auf Nonces ist offen.
7. **Rate-Limit** liegt im Arbeitsspeicher (eine Instanz) und wird beim Neustart zurückgesetzt. Die App ist durch
   SQLite für **genau eine Instanz** ausgelegt.
8. Das Anmelden verbraucht bewusst Rechenzeit/Speicher (scrypt, ca. 64 MB je Versuch); begrenzt durch das Rate-Limit.

## Entwicklung

```bash
npm install
npm test            # Vitest: Berechnung, Zahlungslinks, Sicherheit, Sichtbarkeit
npm run typecheck
npm run dev         # benötigt die Umgebungsvariablen aus .env.example
```

Wichtige Stellen: Berechnung `src/lib/billing`, Zahlungslinks `src/lib/pay`, Sicherheit `src/lib/security`,
serverseitige Sichtbarkeit `src/lib/services/participant-view.ts`.

## Phase 2 (noch nicht umgesetzt)

E-Mail-Erinnerungen per SMTP (Tabelle `reminder_log`, Feld „Erinnerungen erhalten“ und E-Mail-Feld sind im
Datenmodell vorbereitet) kommen erst nach deiner Freigabe.
