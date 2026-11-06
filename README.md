# SubSplit

Selbst gehostete Web-App, um gemeinsame Abos (Streaming, Software, …) unter Freunden aufzuteilen. Jeder hat ein
Konto. Wer ein Abo bezahlt, ist dessen **Empfänger**: Er legt das Abo an, trägt Mitzahler ein und bekommt das Geld.
Dieselbe Person kann bei anderen wiederum **Mitzahler** sein.

- **Konten für alle, per Einladung:** Neue Konten entstehen nur über **Einladungslinks**. Wer einen Link hat, wählt selbst
  Benutzername, Anzeigename und Passwort. Jeder Link ist einmalig und 7 Tage gültig. Wer Links erstellen darf (alle oder
  nur der Betreiber) und wie viele jedes Konto gleichzeitig offen haben darf (Standard 5), stellst du in der `.env` ein.
  Es gibt keine offene Registrierung und keine Magic-Links.
- **Startseite:** Pro Empfänger steht der offene Betrag (laufender Monat **plus Rückstand** aus Vormonaten), dazu der
  Gesamtbetrag über alle Empfänger. Ein Klick führt zur Zahlungsseite mit PayPal-Link, Bankdaten, Referenz-ID und der
  Aufschlüsselung pro Abo (wer zahlt wie viel, damit nachprüfbar ist, dass nicht mehr verlangt wird als nötig).
- **Empfänger-Ansicht:** Übersicht mit Gesamtkosten, bezahlt/offen und Verlauf, Abos mit Preisen und Beteiligten. Neue Mitzahler, die erst im Folgemonat starten würden, lassen sich per Knopf in den laufenden Monat einrechnen (offene Beträge der anderen sinken, bezahlte bleiben unverändert).
- **Betreiber:** sieht alle Konten, setzt Passwörter zurück und sperrt Konten, sieht aber keine Beträge, Zahlungsdaten
  oder Teilnehmer anderer, nur eine grobe Größenklasse der Monatssumme und eine Warnung bei Ungewöhnlichem.
- **E-Mails (optional, aus, solange `SMTP_HOST` fehlt):** Zahlungserinnerung, Info bei Preisänderung, Adress-Bestätigung
  und Test-Mail. Keine IBAN, kein PayPal-Link, keine Antwortmöglichkeit; jede Erinnerung/Preis-Mail hat einen
  Abmelde-Link. Siehe Abschnitt „E-Mail“.
- Alle Beträge sind Integer-Cent. Anteile werden **auf den vollen Cent abgerundet**, der Rest (höchstens Beteiligte − 1
  Cent pro Abo und Monat) bleibt beim Empfänger.
- Stack: TypeScript, Next.js (App Router), SQLite mit Drizzle, **verschlüsselte Datenbankdatei**, ein Docker-Container.

Entscheidungen und Annahmen: [`docs/decisions.md`](docs/decisions.md).

## Schnellstart

Voraussetzung: Docker mit Compose und ein laufender Reverse Proxy (Caddy) in einem externen Docker-Netzwerk.

```bash
git clone <dieses-repo> subsplit && cd subsplit
cp .env.example .env
```

1. **Zwei Geheimnisse erzeugen** und in `.env` eintragen (verschieden, je mindestens 32 Zeichen):

   ```bash
   openssl rand -hex 32   # SESSION_SECRET
   openssl rand -hex 32   # DB_ENCRYPTION_KEY
   ```

   > **Sichere `DB_ENCRYPTION_KEY` getrennt von der Datenbank und den Backups** (z. B. im Passwortmanager) und ändere
   > ihn nie im Betrieb. **Geht er verloren, sind alle Daten unwiederbringlich verloren.**

2. **Netzwerk des Proxys** ermitteln und in `.env` setzen:

   ```bash
   docker network inspect proxy --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
   ```

   Das Ergebnis (z. B. `172.18.0.0/16`) kommt in `TRUSTED_PROXY_CIDR`. Heißt dein Netzwerk anders, setze `PROXY_NETWORK`.

3. **Logverzeichnis anlegen** (der Container läuft als Benutzer `node`, UID 1000):

   ```bash
   mkdir -p logs && sudo chown 1000:1000 logs
   ```

4. **Starten:**

   ```bash
   docker compose up -d --build
   docker compose ps        # Status "healthy" abwarten
   ```

   Bei ungültiger Konfiguration bricht der Container mit einer klaren Meldung ab: `docker compose logs subsplit`.
   Der Port 3000 ist nur im Docker-Netzwerk erreichbar und nicht auf dem Host veröffentlicht.

5. **Ersteinrichtung:** Beim allerersten Start legt die App das Betreiber-Konto `admin` an und schreibt einen
   einmaligen Einrichtungslink ins Log (24 Stunden gültig):

   ```bash
   docker compose logs subsplit | grep Ersteinrichtung
   ```

   Link öffnen, Passwort festlegen, fertig. Solange das Passwort nicht gesetzt ist, steht bei jedem Start ein neuer Link im Log.

## Updates

Normales Update (Daten bleiben erhalten, neue Datenbank-Migrationen laufen beim Start automatisch):

```bash
git pull
docker compose up -d --build
```

> **Niemals `docker compose down -v` bei einem Update.** Das `-v` löscht die benannten Volumes und damit die
> **komplette Datenbank**, unwiederbringlich. `docker compose down` ohne `-v` ist ungefährlich. Lege vor größeren
> Updates ein Backup an (siehe „Backup“).
>
> Einzige Ausnahme war der einmalige Umstieg von der allerersten Einzelnutzer-Version (mit Magic-Links): Deren alte,
> unverschlüsselte Datenbank wird nicht übernommen und von der App abgelehnt, dort musste das Volume geleert werden.
> Das gilt **nur** für diesen Umstieg und nie mehr danach.

## Erste Schritte in der App

1. **Einladen:** Reiter „Einladungen“ → „Einladungslink erstellen“. Der Link erscheint **nur einmal**; schicke ihn der
   Person (z. B. per Messenger). Gespeichert wird nur ein Hash. Du siehst, welche Links offen, eingelöst (und von wem)
   oder abgelaufen sind, und kannst offene Links widerrufen. Höchstens 5 Links gleichzeitig offen (einstellbar), je 7 Tage.
2. **Die eingeladene Person** öffnet den Link und wählt Benutzername, Anzeigename (für Mitzahler sichtbar) und
   Passwort (mindestens 12 Zeichen). **Betreiber:** Passwörter setzt du im Reiter „Betreiber“ über „Passwort
   zurücksetzen“ zurück (neuer Link, 7 Tage gültig), Konten sperrst du dort ebenfalls.
3. **Wer Abos anlegen will** (Betreiber eingeschlossen), trägt unter „Einstellungen“ Zahlungsdaten ein: mindestens
   **IBAN oder PayPal.Me**, beides ist möglich, dazu Empfängername und den **Fälligkeitstag** (1–28). Ein Konto ohne
   Zahlungsdaten ist ein reiner Mitzahler. Die Beispiel-IBAN aus der Dokumentation wird abgelehnt.
4. **Verwalten → Abos:** Abo mit Preis und Startmonat anlegen, dann Konten als Mitzahler mit Gewicht (1 = gleicher Anteil)
   auswählen. Die Liste zeigt alle Konten mit Anzeigename und Benutzername (Vertrauensbasis).
5. **Verwalten → Übersicht:** Pro Monat Gesamtkosten, was die Mitzahler schulden, bestätigt/gemeldet/offen, dein eigener
   Anteil und ein Verlauf. Zahlungen bestätigst du mit „Bestätigen“.
6. **Mitzahler** sehen auf ihrer Startseite, was sie schulden, zahlen und melden „Ich habe bezahlt“.

## Regeln

- **Der laufende Monat ist fest.** Alles, was der Empfänger an Bestehendem ändert (Preis, Gewicht, Beteiligung beenden,
  Abo beenden), gilt **erst ab dem Folgemonat**. **Neue Abos und neue Mitzahler** dürfen im laufenden Monat starten, solange
  für diesen Monat bei diesem Empfänger noch keine Zahlungen angelegt wurden (sie entstehen beim ersten Aufruf des
  Monats); danach starten auch sie ab dem Folgemonat. Die Oberfläche zeigt die frühesten Monate an und füllt die
  Formulare damit vor. Die Beträge schon angelegter Zahlungen ändern sich nie nachträglich.
- **Rückstand:** Hat jemand einen Monat nicht bezahlt, wird der offene Betrag im nächsten Monat aufgeschlagen. Die
  Zahlungsseite zeigt den Gesamtbetrag (mit Aufschlüsselung der Vormonate) und die Referenz-ID der neuesten Zahlung;
  der Verwendungszweck enthält „inkl. Rückstand“. „Ich habe bezahlt“ gilt für alles Offene bei diesem Empfänger, und
  „Bestätigen“ der neuesten Zahlung bestätigt auch die früheren gemeldeten Monate. Die App legt die Zahlungen für alle
  Monate seit der ersten Beteiligung an, auch wenn in einem Monat niemand die App geöffnet hat.
- **Austragen (durch den Mitzahler, bei jedem Abo)** gilt **immer ab dem Folgemonat**: Der laufende Monat bleibt zu
  zahlen, ebenso Rückstände. Die Beträge der anderen im laufenden Monat ändern sich nicht.
- **Dauerauftrag:** Zahler **und** Empfänger können pro Zahler einen Dauerauftrag einschalten (Vertrauensbasis, es wird
  nichts geprüft). Beim Einschalten wählt man den Startmonat (laufender Monat oder später). Ab diesem Monat wird die
  Zahlung am **Fälligkeitstag** automatisch **bestätigt** (in der Übersicht als „Per Dauerauftrag bestätigt“). Vor dem
  Fälligkeitstag bleibt sie offen, ist aber für den Zahler nichts zu Überweisendes. Rückstände aus Monaten **vor** dem
  Startmonat bleiben offen. Ausschalten wirkt ab dann; bereits automatisch bestätigte Monate bleiben bestätigt. Setzt der
  Empfänger eine automatisch bestätigte Zahlung zurück, wird genau diese nicht erneut automatisch bestätigt. Ändert sich
  der Monatsbetrag (Preiserhöhung), gilt die Zahlung weiterhin als bezahlt; eine Benachrichtigung dazu kommt erst mit den
  E-Mails (Phase 2).
- **Abo beenden** (normaler Weg bei Kündigung): Beteiligungen enden nach dem gewählten Monat (frühestens dem laufenden),
  das Abo wird archiviert und lässt sich wieder aktivieren. **Abo löschen** geht nur, solange für das Abo noch keine
  Zahlungen angelegt wurden.

## Konfiguration (nur Systemwerte in der `.env`)

Benutzer, Empfängerdaten und Fälligkeitstag liegen **nicht** in der `.env`, sondern pro Konto in der App.

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `BASE_URL` | ja | Öffentliche URL, Basis der Einrichtungslinks (z. B. `https://abos.example.org`). Cookies sind `Secure`, wenn sie mit `https` beginnt. |
| `SESSION_SECRET` | ja | Mindestens 32 Zeichen, signiert die Sitzungen. |
| `DB_ENCRYPTION_KEY` | ja | Mindestens 32 Zeichen, verschlüsselt die gesamte Datenbankdatei. **Getrennt sichern; Verlust = Datenverlust.** Muss sich von `SESSION_SECRET` unterscheiden. |
| `APP_NAME` | nein | Name im Verwendungszweck `<ID> <App-Name> <JJJJ-MM>` (Standard `SubSplit`). |
| `INVITATIONS_CREATORS` | nein | Wer Einladungslinks erstellen darf: `all` (jedes Konto, Standard) oder `operator` (nur der Betreiber). Wirkt sofort, auch auf bereits erstellte Links anderer. |
| `INVITATIONS_MAX_ACTIVE` | nein | Wie viele Einladungslinks jedes Konto gleichzeitig offen haben darf (0–100, Standard 5; für alle gleich, auch den Betreiber). `0` schaltet Einladungen ganz ab. |
| `ADMIN_IDLE_TIMEOUT_MINUTES` | nein | Abmeldung nach so vielen Minuten ohne Aktion (1–1440, Standard 30). Jede Aktion setzt den Timer auf den vollen Wert zurück; es gibt keine absolute Obergrenze. |
| `TRUSTED_PROXY_CIDR` | empfohlen | Adressbereich(e) des Proxy-Netzwerks, kommagetrennt. Nur von dort wird `X-Forwarded-For` übernommen. |
| `SECURITY_LOG_FILE` | nein | Standard `/logs/security.log`. |
| `DATABASE_PATH` | nein | Standard `/data/subsplit.db` (im Volume). |
| `PROXY_NETWORK` | nein | Name des externen Docker-Netzwerks (Standard `proxy`), nur für `docker-compose.yml`. |
| `UNUSUAL_MONTHLY_TOTAL_EUR`, `UNUSUAL_FACTOR` | nein | Warnung beim Betreiber, wenn die Monatssumme eines Empfängers den festen Wert (Standard 500 €) erreicht oder das X-Fache (Standard 3) des Durchschnitts der letzten 3 Monate übersteigt. |
| `PAYPAL_LINK_BASE`, `PAYPAL_APPEND_CURRENCY`, `PAYPAL_DECIMAL` | nein | Linkformat von PayPal, siehe „Bekannte Unsicherheiten“. |
| `SMTP_HOST` | nein | SMTP-Server. **Ohne diesen Wert sind alle E-Mails aus.** Mit dem mitgelieferten Mail-Container: `mail`. |
| `SMTP_PORT` | nein | Standard 587 (465 bei `SMTP_SECURITY=tls`). |
| `SMTP_SECURITY` | nein | `starttls` (Standard, TLS erzwungen), `tls` (Port 465) oder `internal` (nur für den eigenen Mail-Container im Docker-Netz: TLS opportunistisch, ohne Zertifikatsprüfung, keine Zugangsdaten). |
| `SMTP_USER`, `SMTP_PASSWORD` | nein | Zugangsdaten, nur zusammen. |
| `MAIL_FROM` | ja, wenn `SMTP_HOST` | Absender, z. B. `SubSplit <noreply@anfall.net>`. |
| `MAIL_DOMAIN`, `MAIL_HOSTNAME` | nur Mail-Container | Absender-Domain (`anfall.net`) und Hostname des Mail-Containers (`mail.anfall.net`). |
| `REMINDER_FIRST_DAYS_AFTER_DUE` | nein | Erste Erinnerung so viele Tage nach dem Fälligkeitstag (0–28, Standard 3). |
| `REMINDER_REPEAT_DAYS` | nein | Abstand weiterer Erinnerungen (1–60, Standard 7). |
| `REMINDER_MAX_PER_PAYMENT` | nein | Höchstzahl Erinnerungen je offener Zahlung (1–10, Standard 3). |

Zeitzone des Containers: `Europe/Berlin`.

## E-Mail

**Was verschickt wird (und nichts anderes):**

1. **Adress-Bestätigung** (Double-Opt-in): Nach Eintragen/Ändern der Adresse in den Einstellungen kommt ein Link
   (48 Stunden gültig, einmalig). Erst bestätigte Adressen bekommen weitere Mails. Ändert man die Adresse, entfällt die Bestätigung.
2. **Zahlungserinnerung** an Mitzahler: erste Mail 3 Tage nach dem Fälligkeitstag, danach wöchentlich, höchstens 3 Mails
   pro offener Zahlung (alles per `.env` einstellbar). Eine Mail pro Empfänger mit Gesamtbetrag und Aufschlüsselung.
   Monate, die ein Dauerauftrag abdeckt, werden nicht erinnert. Versand nur zwischen 8 und 20 Uhr (Berlin).
3. **Preisänderung:** Mitzahler eines Abos erfahren, was sich für sie ändert; wer per Dauerauftrag zahlt, bekommt den Hinweis,
   den Dauerauftrag anzupassen. Der Empfänger selbst bekommt keine Mail.
4. **Test-Mail** (Einstellungen, nur mit bestätigter Adresse, max. 3 pro Stunde).

In den Mails stehen **weder IBAN noch PayPal-Link** (nur Betrag und ein Link zur App); man kann nicht antworten. Erinnerungs-
und Preis-Mails haben einen **Abmelde-Link** und die Header `List-Unsubscribe` / `List-Unsubscribe-Post`. Beides lässt sich
auch in den Einstellungen ein- und ausschalten. Fehlgeschlagene Mails werden mit wachsendem Abstand bis zu 5-mal wiederholt.

### Eigener Mail-Server (Postfix-Container, keine Fremdanbieter, keine Zusatzkosten)

Der Container `mail` (Image `boky/postfix`) liegt im Compose-File hinter dem Profil `mail` und ist nur für die App im
internen Netz `mailnet` erreichbar (kein veröffentlichter Port). Er verschickt direkt von deinem Server.

1. **`.env`** ergänzen:
   ```
   SMTP_HOST=mail
   SMTP_PORT=587
   SMTP_SECURITY=internal
   MAIL_FROM=SubSplit <noreply@anfall.net>
   MAIL_DOMAIN=anfall.net
   MAIL_HOSTNAME=mail.anfall.net
   ```
2. **Starten** (niemals `-v`):
   ```bash
   docker compose --profile mail up -d --build
   ```
   Beim ersten Start erzeugt der Container (mit `DKIM_BACKEND=opendkim`; das Image nutzt sonst rspamd und legt die Schlüssel woanders ab, das Backend gilt laut Image-Doku als veraltet) einen DKIM-Schlüssel in `./dkim/` (`anfall.net.txt` enthält den DNS-Wert).
   Den Ordner `dkim` sichern; ohne ihn gibt es einen neuen Schlüssel und der DNS-Eintrag muss erneuert werden.
3. **DNS bei Hetzner** (Domain `anfall.net`, `<IP>` = öffentliche IPv4 des Servers):

   | Typ | Name | Wert |
   |---|---|---|
   | A | `mail` | `<IP>` |
   | TXT (SPF) | `@` | `v=spf1 ip4:<IP> -all` (es darf nur **einen** SPF-Eintrag für `anfall.net` geben; gibt es schon einen, `ip4:<IP>` dort ergänzen) |
   | TXT (DKIM) | `mail._domainkey` | Inhalt aus `./dkim/anfall.net.txt` (die Teile in Anführungszeichen zu einem String zusammenfügen) |
   | TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none;` (nach einigen erfolgreichen Wochen ggf. auf `quarantine` verschärfen) |

   Dazu der **Reverse-DNS (PTR)** der Server-IP auf `mail.anfall.net` (Hetzner Cloud Console, Server/Primary IP,
   Reverse DNS). Passen PTR, A-Eintrag und `MAIL_HOSTNAME` nicht zusammen, nehmen viele Anbieter die Mails nicht an.
4. **Port 25 ausgehend** muss offen sein (bei Hetzner Cloud standardmäßig gesperrt, du hast ihn laut deiner Angabe
   freigeschaltet; prüfe auch eine eventuelle Cloud-Firewall).
5. **Testen:** Einstellungen -> Adresse eintragen -> bestätigen -> „Test-Mail senden“, an Gmail/Outlook und die
   Kopfzeilen prüfen (`SPF: pass`, `DKIM: pass`, `DMARC: pass`). Logs: `docker compose logs mail`.

Du kannst stattdessen **jeden anderen SMTP-Server** eintragen (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY=starttls|tls`,
`SMTP_USER`, `SMTP_PASSWORD`); dann den Mail-Container nicht starten.

**Grenzen (ehrlich):** Ob Mails von einer neuen Server-IP im Posteingang landen oder im Spam, entscheiden die
Empfänger (Reputation); das kann ich nicht garantieren. Die App sieht Rückläufer (Bounces) nicht; eine „gesendet“-Markierung
heißt nur, dass Postfix die Mail angenommen hat. Wird der Mail-Container neu erzeugt, geht seine interne Warteschlange
verloren (die App wiederholt aber nur, was sie selbst als fehlgeschlagen kennt).

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
  setzt) und trägt die IP der Verbindung ein. Setze **kein** `trusted_proxies` in Caddy, außer vor Caddy hängt noch ein
  weiterer Proxy. (Aus Suchergebnissen und dem Caddy-Quellcode belegt, nicht aus der offiziellen Doku.)
- **Links im Access-Log:** Der Token steht im URL-Pfad (`/invite/<token>` bzw. `/setup/<token>`) und landet in Caddys Access-Log,
  falls du eines aktivierst. Du kannst ihn z. B. mit einem Log-Filter auf `request>uri` schwärzen
  (`regexp "^/(setup|invite)/[A-Za-z0-9_-]+" "/$1/REDACTED"`). **Diese Syntax ist nicht gegen die Caddy-Doku geprüft.** Die
  Links sind einmalig und befristet; die App setzt `Referrer-Policy: no-referrer`.

## Sicherheits-Log und fail2ban

Bei jedem fehlgeschlagenen Anmeldeversuch und bei jedem ungültigen Einrichtungslink schreibt die App genau eine Zeile in
`SECURITY_LOG_FILE` (und zusätzlich nach stdout):

```
2026-11-04T13:43:12+01:00 SUBSPLIT_AUTHFAIL ip=203.0.113.5 reason=admin_login
2026-11-04T13:43:13+01:00 SUBSPLIT_AUTHFAIL ip=203.0.113.5 reason=invalid_token
```

- `admin_login` = falscher Benutzername/Passwort (auch bei gesperrten Konten), `invalid_token` = unbekannter oder
  kaputter Einrichtungs- bzw. Einladungslink.
- Ein **abgelaufener, bereits eingelöster oder widerrufener** Link zählt nicht als Fehlversuch (jemand mit einem alten
  Link soll nicht gebannt werden): `SUBSPLIT_NOTICE … reason=revoked_token`.
- Token, Passwörter und andere Geheimnisse stehen nie im Log. Ist keine gültige Client-IP bestimmbar, steht
  `ip=unknown` (kein Ban möglich, dafür nie eine falsche Adresse).
- Die Datei liegt per Bind-Mount unter `./logs/security.log` auf dem Host.

**Dein bestehender fail2ban-Container** muss die Datei lesen können: Binde `./logs` dort (z. B. schreibgeschützt) ein
und verweise im Jail auf den Pfad **im fail2ban-Container**. Eine eigene fail2ban-Installation ist nicht nötig.

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

`<ADDR>` statt `<HOST>`: `<HOST>` würde auch Hostnamen akzeptieren, also `ip=unknown` als DNS-Namen behandeln. Läuft Caddy
in Docker, muss die Ban-Aktion deines fail2ban die Kette `DOCKER-USER` verwenden (Ports 80/443), sonst greift der Ban
nicht, und das Firewall-Backend (iptables oder nftables) muss zum System passen. Das ist Teil deiner bestehenden
fail2ban-Konfiguration und hier nicht getestet.

**Filter gegen die echte Logdatei testen:**

```bash
fail2ban-regex ./logs/security.log /etc/fail2ban/filter.d/subsplit.conf
```

Erwartet: Treffer nur für `SUBSPLIT_AUTHFAIL` mit gültiger IP; `ip=unknown`, `SUBSPLIT_NOTICE` und unbekannte
`reason`-Werte werden nicht gematcht. (Der Filter wurde mit `fail2ban-regex` 1.0.2 gegen eine von der App erzeugte
Logdatei und Beispielzeilen mit IPv4/IPv6 geprüft.)

**Rotation und Aufbewahrung:** Die App rotiert die Datei selbst nach Größe (5 MB, drei Generationen). Das Log enthält
IP-Adressen und dient nur der Sicherheit; Vorschlag: höchstens 30 Tage aufbewahren, z. B. per Cron auf dem Host:

```bash
find ./logs -name 'security.log.*' -mtime +30 -delete
```

## Backup, Wiederherstellung und Schlüssel

Die Datenbank liegt im Docker-Volume `subsplit-data` (`/data/subsplit.db`), **nie im Image**, und ist **als ganze Datei
verschlüsselt** (inklusive der WAL-Datei). Ohne `DB_ENCRYPTION_KEY` ist weder die Datei noch ein Backup lesbar.

**Konsistentes Backup bei laufender App** (nicht einfach die `.db`-Datei kopieren, SQLite läuft im WAL-Modus). Das
Backup bleibt mit demselben Schlüssel verschlüsselt:

```bash
docker compose exec subsplit node scripts/backup.mjs /data/backups/subsplit-$(date +%F).db
docker compose cp subsplit:/data/backups/subsplit-$(date +%F).db ./backups/
```

Wiederherstellen: Container stoppen, Backup als `/data/subsplit.db` ins Volume legen (die Dateien `subsplit.db-wal`
und `-shm` löschen), mit **demselben** `DB_ENCRYPTION_KEY` starten.

**Den Schlüssel sicherst du getrennt** (Passwortmanager). Wer Backup und Schlüssel zusammen aufbewahrt, hebt den
Schutz der Verschlüsselung auf; ohne Schlüssel ist ein Backup wertlos.

## Abrechnung zurücksetzen (Konten bleiben)

Löscht alle Abos, Preise, Beteiligungen, Zahlungen, Daueraufträge und wartende Erinnerungs-/Preis-Mails. Konten
(Passwörter, Zahlungsdaten, E-Mail), Einladungen und Bestätigungen bleiben. Vorher legt das Skript automatisch ein
Backup unter `/data/backups/vor-reset-<Zeit>.db` an.

```bash
docker compose stop subsplit
docker compose run --rm --no-deps subsplit node scripts/reset-billing.mjs --yes
docker compose up -d
```

## Datenschutz

- **Mitzahler sehen sich gegenseitig** mit Anzeigenamen, Gewichten, Anteilen und Beträgen **innerhalb der gemeinsamen
  Abos**. Wähle Anzeigenamen entsprechend (Vorname oder Spitzname). Das steht auch auf der Zahlungsseite.
- **Empfänger sehen** in der Kontenliste beim Eintragen von Mitzahlern die Anzeigenamen und Benutzernamen aller aktiven
  Konten (das System beruht auf Vertrauen unter Freunden). Mitzahler sehen die Zahlungsdaten (IBAN, PayPal.Me,
  Empfängername) des Empfängers, bei dem sie zahlen.
- **Betreiber:** Die Oberfläche zeigt dem Betreiber nur Konto-Stammdaten, Status, eine Größenklasse der Monatssumme und
  eine Warnung. **Technisch** hat der Betreiber mit Serverzugriff und `DB_ENCRYPTION_KEY` aber Zugriff auf alle Daten.
- **Verschlüsselung:** Die gesamte Datenbankdatei ist verschlüsselt, also auch Namen, IBAN, PayPal.Me-Name, E-Mail,
  Benutzernamen und alle Zahlungen. Sie schützt vor dem **Diebstahl der Datenbankdatei oder eines Backups**, nicht vor
  jemandem, der den laufenden Server samt Schlüssel in der `.env` übernimmt. **Passwörter werden nicht verschlüsselt,
  sondern mit scrypt gehasht** (nicht zurückrechenbar).
- **E-Mail:** Adressen liegen in der verschlüsselten Datenbank. Die Warteschlange (`mail_outbox`) löscht Adresse und Text
  nach erfolgreichem Versand und wird nach 60 Tagen bereinigt. In Logs stehen keine Adressen oder Mail-Inhalte. Mails gehen
  nur über deinen eigenen Server (oder den SMTP-Server, den du einträgst), nie über einen Dienst, den die App selbst wählt.
- Gespeichert werden außerdem E-Mail-Adressen (optional) und im **Sicherheits-Log IP-Adressen** (nur für
  Sicherheitszwecke, nicht ewig aufbewahren, siehe oben). Sonst keine personenbezogenen Daten in Logs. Keine Tracker,
  keine externen Schriften oder Skripte.
- Sobald du die App für andere betreibst, bist du Verantwortlicher für deren Daten. Das ist keine Rechtsberatung.

## Bekannte Unsicherheiten

Bitte vor dem Livebetrieb prüfen:

1. **PayPal-Link:** Belegt (PayPal-Hilfe): Der Name darf nur Buchstaben/Ziffern enthalten (max. 20 Zeichen), und der Betrag
   steht am Linkende, optional mit Währungscode dahinter (Beispiel der Hilfe: `PayPal.Me/DiaRusso/25AUD`). **Praxistest
   des Betreibers:** Mit angehängtem Währungscode (`…/12.34EUR`) öffnete die App nur das Profil, **ohne** Währungscode
   wurde der Betrag übernommen. Der Standard ist deshalb `https://paypal.me/Name/12,34` (Basis `paypal.me`, Komma, ohne
   Währung). Ohne Code gilt PayPals Standardwährung; prüfe in der App, dass Euro angezeigt wird. Ob die App sich öffnet
   und den Betrag übernimmt, entscheidet PayPal; ein `paypal://`-Schema zum Vorausfüllen ist mir nicht bekannt. Die
   Notiz bzw. Referenz-ID lässt sich nicht vorausfüllen. Varianten per `.env` (danach nur `docker compose up -d`):

   | Variable | Werte | Standard |
   |---|---|---|
   | `PAYPAL_APPEND_CURRENCY` | `true` / `false` | `false` |
   | `PAYPAL_LINK_BASE` | `https://paypal.me` oder `https://www.paypal.com/paypalme` | `https://paypal.me` |
   | `PAYPAL_DECIMAL` | `dot` / `comma` | `comma` |

   Die Link-Erzeugung liegt an einer Stelle ([`src/lib/pay/paypal.ts`](src/lib/pay/paypal.ts)).
2. **GiroCode (EPC069-12):** Das Original-PDF war bei der Entwicklung nicht abrufbar. Das Payload-Layout (BCD, Version
   002, UTF-8, SCT, BIC leer, Name, IBAN, `EURx.xx`, Verwendungszweck ≤ 140 Zeichen, Fehlerkorrektur M) folgt der
   Spezifikation nach bestem Wissen und Sekundärquellen. **Prüfe die BIC-Regel von Version 002 gegen die Spezifikation
   und scanne einen Test-GiroCode mit deiner Banking-App.** Ein Link, der eine Banking-App mit vorausgefülltem GiroCode
   öffnet, ist mir nicht bekannt; mobil gibt es deshalb aufklappbare, kopierbare Bankdaten statt QR-Codes.
3. **Docker-Image:** Bei der Entwicklung stand kein Docker-Daemon zur Verfügung. Geprüft wurden das Compose-File
   (`docker compose config`) und das Laufzeit-Layout (Start, Migration, Verschlüsselung, `/healthz`, Security-Header,
   mehrere Konten im Browser-Test). Die verschlüsselte SQLite-Variante bringt fertige Binärdateien für Linux x64 und
   arm64 (glibc und musl) mit. Der erste `docker compose build` auf deinem Server ist der eigentliche Test.
4. **Client-IP hinter Docker:** Der Ban greift nur, wenn Caddy die echte Client-IP sieht. Bei IPv6 oder NAT durch Docker
   (Userland-Proxy) kann stattdessen eine interne Adresse ankommen. Prüfe nach dem Start mit falschen Anmeldedaten, welche
   IP im Sicherheits-Log steht.
5. **Content-Security-Policy** erlaubt vorläufig `unsafe-inline` für Skripte/Styles (Next.js-Hydration); Umstellung auf
   Nonces ist offen.
6. **Rate-Limit** liegt im Arbeitsspeicher (eine Instanz) und wird beim Neustart zurückgesetzt. Die App ist durch SQLite
   für **genau eine Instanz** ausgelegt. Das Anmelden verbraucht bewusst Rechenzeit/Speicher (scrypt, ca. 64 MB je Versuch).
7. **Verschlüsselung:** Verlust von `DB_ENCRYPTION_KEY` ist nicht behebbar. Ein Schlüsselwechsel ist nicht vorgesehen.
8. **E-Mail:** Getestet mit einem lokalen SMTP-Testserver (Transport, Header, STARTTLS-Modi, Wiederholung). **Nicht getestet**
   ist der echte Versand über `boky/postfix` im Betrieb (kein Docker-Daemon verfügbar): insbesondere der Modus `internal`
   (opportunistisches TLS ohne Zertifikatsprüfung im Docker-Netz), die automatische DKIM-Erzeugung und die Zustellung an
   Gmail/Outlook. Die Hetzner-Angaben (Port 25/465 gesperrt, Reverse-DNS änderbar) stammen aus Foren/Drittquellen, nicht aus
   der offiziellen Dokumentation. Der erste Test-Mail-Lauf auf deinem Server ist der eigentliche Test.

## Entwicklung

```bash
npm install
npm test            # Vitest: Berechnung, Zahlungslinks, Sicherheit, Konten, Mandantentrennung, Verschlüsselung
npm run typecheck
npm run dev         # benötigt die Umgebungsvariablen aus .env.example
```

Wichtige Stellen: Berechnung `src/lib/billing`, Zahlungslinks `src/lib/pay`, Sicherheit `src/lib/security`,
Konten und Login `src/lib/services/users.ts`, Verwaltung pro Empfänger `src/lib/services/manage.ts`, Zahlungen und
Rückstand `src/lib/services/payments.ts`, Sichten mit serverseitiger Sichtbarkeit `src/lib/services/views.ts`.

## Offen

Nicht umgesetzt: Bounce-Auswertung, Einstellungen pro Zahler zum Pausieren einzelner Erinnerungen (bewusst gestrichen),
automatische Host-Backups.
