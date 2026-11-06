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

## Regeln für Änderungen (überarbeitet)
- Zuerst galt: Änderungen ab Monat M nur, wenn für Monate >= M noch keine Zahlungen erzeugt wurden. Das war im Betrieb zu streng, weil Zahlungen schon beim Öffnen der Übersicht entstehen; man konnte danach niemanden mehr hinzufügen (auch den Admin nicht).
- Jetzt: Änderungen sind ab dem aktuellen Monat erlaubt, solange dort keine Zahlung als bezahlt gemeldet oder bestätigt ist (`earliestChangeMonth`). Offene Zahlungen der betroffenen Monate werden neu berechnet (`reconcileOpenPayments`): Betrag wird angepasst, Referenz-ID und Status bleiben, wer nichts mehr schuldet, verliert die offene Zahlung. Bezahlt gemeldete oder bestätigte Zahlungen werden nie angefasst. Vergangene Monate sind fest.
- Risiko bewusst akzeptiert: Hat jemand schon überwiesen, aber noch nicht „bezahlt“ gemeldet, und der Betrag ändert sich danach, weicht die Überweisung vom neuen Betrag ab. Der Admin gleicht das über PayPal/Bank ab.
- Abo **beenden** = archivieren (Beteiligungen enden nach dem gewählten Monat, wieder aktivierbar). Abo **löschen** nur, wenn es in keinem vergangenen Monat und in keiner bezahlt gemeldeten/bestätigten Zahlung vorkommen kann.

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

## PayPal-Link ohne Währungscode (Praxistest)
- Auf einem echten Handy mit PayPal-App öffnete der Link mit `EUR` am Betrag nur das Profil des Empfängers; ohne Währungscode wurde der Betrag übernommen. Standard daher `PAYPAL_APPEND_CURRENCY=false`. Risiko: Ohne Code gilt PayPals Standardwährung; bei Zahlern mit einem Konto in anderer Währung ist nicht geprüft, welche Währung angezeigt wird. In der App kontrollieren, dass Euro dasteht.
- Praxistest ergänzt: Funktionierendes Format beim Betreiber ist `https://paypal.me/<Name>/<Betrag mit Komma>` ohne Währungscode. Das ist jetzt der Standard.

## Admin-Sitzung: Inaktivitäts-Timeout
- Vorher fest 8 Stunden ab Login. Jetzt gleitend: Jede gültige Admin-Anfrage setzt den Ablauf auf `jetzt + Timeout` (nicht `alter Ablauf + Timeout`), Standard 30 Minuten, per `ADMIN_IDLE_TIMEOUT_MINUTES` einstellbar (1-1440). Das Cookie wird bei jeder Admin-Anfrage neu gesetzt (`Max-Age` = Timeout, gleiches CSRF-Token); der Logout setzt es nicht neu.
- Keine absolute Maximaldauer: Wer regelmäßig aktiv ist, bleibt angemeldet.

---

# Mehrbenutzer-Umbau (ersetzt die Einzelnutzer-Entscheidungen oben, wo sie widersprechen)

## Konzept
- **Jeder ist ein Konto** (`users`). Magic-Links entfallen komplett. Der Betreiber legt Konten an und verschickt einmalige Einrichtungslinks (7 Tage gültig, nur als Hash gespeichert), über die die Person ihr Passwort selbst festlegt. Keine offene Registrierung.
- Ein Abo gehört einem **Empfänger** (`subscriptions.owner_user_id`). Mitzahler sind beliebige aktive Konten. Der Empfänger kann selbst Mitglied sein (bekommt den Rundungsrest, schuldet sich nichts); nie eine Zahlung an sich selbst (Constraint).
- Eine Zahlung gilt pro (Zahler, Empfänger, Monat); bei mehreren Empfängern gibt es mehrere Zahlungen, weil die Zahlungsziele verschieden sind. Die Startseite summiert über alle Empfänger.
- Empfängerdaten (Name, PayPal.Me, IBAN) und **Fälligkeitstag** hängen am Konto, nicht mehr an der `.env`. Mindestens IBAN oder PayPal.Me ist nötig, um Abos anzulegen (und solange man Abos hat). Die Beispiel-IBAN aus der Dokumentation wird abgelehnt.
- Der Betreiber sieht in der Oberfläche nur Konto-Stammdaten, Status, Größenklasse der Monatssumme und eine Warnung (fester Schwellenwert, Standard 500 €, oder mehr als das 3-Fache des Durchschnitts der letzten 3 Monate; beides per `.env`). Keine Beträge, Zahlungsdaten, Teilnehmer.
- Teilnehmer werden aus der Liste aller aktiven Konten ausgewählt (Anzeigename + Benutzername), weil das System auf Vertrauen unter Freunden beruht.

## Verschlüsselung
- Die gesamte SQLite-Datei (inkl. WAL) ist verschlüsselt, per Alias auf eine verschlüsselbare better-sqlite3-Variante (`better-sqlite3-multiple-ciphers`), Schlüssel in `DB_ENCRYPTION_KEY`. Vorab geprüft: Datei und WAL enthalten keinen Klartext, ohne/mit falschem Schlüssel nicht lesbar, Backup per `VACUUM INTO` bleibt verschlüsselt (`db.backup()` ging nicht), Prebuilds für Linux x64/arm64 sind enthalten.
- Gewählt statt Feldverschlüsselung, weil sie alles abdeckt (auch Namen, Benutzernamen, E-Mail) und ohne Such-Hashes auskommt.
- Schutzziel: gestohlene Datenbankdatei/Backup. Nicht: Übernahme des laufenden Servers samt Schlüssel. Passwörter werden gehasht (scrypt), nicht verschlüsselt.
- Eine alte Klartext-Datenbank wird abgelehnt (keine Übernahme; Entwicklungsphase, vom Betreiber so gewünscht).

## Anmeldung
- Login mit Benutzername und Passwort (mindestens 12 Zeichen). Sitzung: signiertes Cookie mit Konto-ID und Sitzungsversion; Passwortwechsel und Sperre erhöhen die Version und beenden alle Sitzungen. Gleitender Inaktivitäts-Timeout (Standard 30 Minuten); ein kleiner Keep-Alive im Browser verlängert die Sitzung bei echter Aktivität auf reinen Server-Seiten.
- Sicherheits-Log unverändert im Format: `admin_login` für fehlgeschlagene Anmeldungen, `invalid_token` für unbekannte/verbrauchte Einrichtungslinks, `NOTICE revoked_token` für abgelaufene. Der bestehende fail2ban-Filter bleibt gültig.
- Erster Betreiber: Beim ersten Start entsteht das Konto `admin` ohne Passwort, ein einmaliger Einrichtungslink steht im Startlog.

## Zahlungen
- **Rückstand:** Offene Zahlungen aus Vormonaten werden zum Gesamtbetrag des Empfängers addiert. Die Referenz-ID der neuesten offenen Zahlung steht im Verwendungszweck (Zusatz „inkl. Rückstand“). „Ich habe bezahlt“ markiert alles Offene bei diesem Empfänger; „Bestätigen“ der neuesten Zahlung bestätigt auch frühere gemeldete Monate desselben Zahlers. Zahlungen werden für alle Monate seit der ersten Beteiligung angelegt (`ensureOwnerPayments`), damit kein Vormonat verloren geht.
- **Austragen:** Gilt ab dem laufenden Monat, wenn der Fälligkeitstag des Empfängers noch nicht erreicht ist und für den Monat noch nichts gemeldet/bestätigt ist; sonst ab dem Folgemonat. Ist der Monat beim Empfänger durch eine fremde gemeldete Zahlung gesperrt, gilt frühestens der Folgemonat. Rückstände bleiben.
- **Gesamtkosten:** Übersicht pro Monat mit Gesamtkosten, Soll der Mitzahler, bestätigt/gemeldet/offen, eigenem Anteil (inkl. Rundungsrest) und 12-Monats-Verlauf. Es gilt: Gesamtkosten = Soll + eigener Anteil.

## Einladungslinks statt Konto-Anlage durch den Betreiber
- Konten entstehen nur noch über **Einladungslinks** (`invitations`): Jedes Konto kann sie erstellen, die eingeladene Person wählt Benutzername, Anzeigename und Passwort selbst. Einmalig, 7 Tage gültig, nur als Hash gespeichert (der Ersteller sieht den Link nur beim Erzeugen; verloren = widerrufen und neu erstellen). Das Anlegen von Konten durch den Betreiber entfällt; er behält Konten-Übersicht, Passwort-Reset (Einrichtungslink für bestehende Konten), Sperren und die Größenklassen/Warnungen.
- **Limit:** Standard höchstens 5 offene (nicht eingelöste, nicht abgelaufene, nicht widerrufene) Links pro Konto gleichzeitig. Per `.env`: `INVITATIONS_MAX_ACTIVE` (0-100, gilt für alle Konten gleich, auch den Betreiber; 0 = abgeschaltet) und `INVITATIONS_CREATORS` (`all` oder `operator`).
- Das Entziehen der Erlaubnis wirkt **sofort**, auch auf bereits erstellte Links anderer Konten (geprüft beim Öffnen und Einlösen). Ein gesperrter Ersteller macht seine offenen Links ungültig. Ein abgesenktes Limit sperrt nur neue Links, nicht bestehende.
- Einlösen ist atomar (Konto anlegen + Link verbrauchen in einer Transaktion): scheitert etwas, z. B. vergebener Benutzername, bleibt der Link gültig. Unbekannter/kaputter Link -> `AUTHFAIL invalid_token`; eingelöst, abgelaufen oder widerrufen -> nur `NOTICE revoked_token` (kein Ban). Der bestehende fail2ban-Filter bleibt gültig.
- Die Tabelle kam als zusätzliche Migration (keine Datenlöschung).

## Änderungsregeln vereinfacht und Dauerauftrag (ersetzt die Regeln zu Sperre und Neuberechnung weiter oben)
- **Der laufende Monat ist fest.** Die frühere Sperre ("bezahlt gemeldet sperrt den Monat") und das automatische Neuberechnen offener Zahlungen (`reconcileOpenPayments`) entfallen komplett. Bestehendes (Preis, Gewicht, Beteiligung beenden, Abo beenden) gilt frühestens ab dem Folgemonat. **Neue Abos und neue Mitzahler** dürfen im laufenden Monat starten, solange bei diesem Empfänger für den Monat noch keine Zahlung angelegt ist (`firstStartMonthForNew`); sonst ab dem Folgemonat. Streng gefasst (Monat statt "für sie"), weil ein neuer Mitzahler in einem bestehenden Abo die Anteile der anderen verschieben würde.
- **Austragen:** immer ab dem Folgemonat; die frühere Ausnahme "vor dem Fälligkeitstag entfällt der laufende Monat" ist gestrichen. Der laufende Monat bleibt zu zahlen, damit sich die Beträge der anderen nicht verschieben.
- **Abo löschen** nur, wenn für das Abo (ab seinem ersten Monat) noch keine Zahlung des Empfängers angelegt ist; sonst beenden.
- **Dauerauftrag** (`standing_orders`, pro Zahler und Empfänger, Startmonat): von Zahler UND Empfänger setz- und löschbar, Dritte bekommen 404. Gilt ab dem Startmonat (nicht in der Vergangenheit). Offene Zahlungen werden am Fälligkeitstag automatisch bestätigt (`payments.standing_order_state = 'auto'`, Anzeige "Per Dauerauftrag bestätigt"). Monate vor dem Startmonat (Rückstand) bleiben offen. Vom Empfänger zurückgesetzte Zahlungen werden `skipped` und nicht erneut automatisch bestätigt. Ausschalten löscht nur die Regel; automatisch bestätigte Monate bleiben bestätigt. Vom Dauerauftrag abgedeckte offene Beträge zählen nicht als "zu überweisen" (Startseite und Zahlungsseite zeigen sie getrennt als erwartet).
- **Bewusst offen (kommt mit den E-Mails, Phase 2):** Betragsänderungen bei bestehendem Dauerauftrag (Info-Mail bei Preisänderung) und Zahlungserinnerungen 2-3 Tage nach dem Fälligkeitstag. Bis dahin gilt die Zahlung bei geändertem Betrag weiterhin als bezahlt.
- Die Datenbank-Migration (0002) ist additiv: neue Tabelle `standing_orders` und neue Spalte `payments.standing_order_state`; der Upgrade-Test prüft, dass bestehende Daten erhalten bleiben.

## E-Mail (Phase 2)
- **Umfang:** nur Adress-Bestätigung (Double-Opt-in, 48 h), Zahlungserinnerung, Preisänderungs-Info (mit Dauerauftrag-Hinweis) und Test-Mail. Keine IBAN/PayPal-Links in Mails, keine Antwortmöglichkeit, Absender `noreply@anfall.net`. Kein Pausieren pro Zahler (Entscheidung des Betreibers).
- **Aus ohne `SMTP_HOST`.** Kein Fremdanbieter, keine Kosten: optionaler Postfix-Container (`boky/postfix`, Compose-Profil `mail`, nur im internen Netz `mailnet`), die App spricht beliebiges SMTP (`starttls|tls|internal`).
- **Warteschlange** (`mail_outbox`, additive Migration 0003): eindeutiger `dedupe_key` verhindert Doppelversand auch nach Neustart; Vorab-Prüfung vor dem Senden (Konto aktiv, Adresse unverändert und bestätigt, Einstellung an); nach Erfolg werden Adresse und Text gelöscht; 5 Versuche mit Backoff; Bereinigung nach 60 Tagen.
- **Erinnerungen:** Trigger ist die neueste offene, nicht per Dauerauftrag gedeckte Zahlung; erste Mail ab Fälligkeit + 3 Tage, dann alle 7 Tage, höchstens 3 je Zahlung (konfigurierbar); Versandfenster 8–20 Uhr Berlin; ein Scheduler im Prozess (15-Minuten-Takt), der fehlende Zahlungen selbst anlegt (`ensureAllOwnerPayments`).
- **Abmelden:** zustandslose HMAC-Tokens (SESSION_SECRET), POST ohne Login, ungültig = 404 ohne Sicherheits-Log-Eintrag; Bestätigungslink: unbekannt = `AUTHFAIL invalid_token`, benutzt/abgelaufen = `NOTICE revoked_token`.
- **Datenschutz:** keine Adressen oder Inhalte in Logs; Fehlertexte werden von Adressen bereinigt und gekürzt.

## Neue Mitzahler in den laufenden Monat einrechnen (Knopf beim Empfänger)
- Sind für den laufenden Monat schon Zahlungen angelegt, starten neue Mitzahler normalerweise erst im Folgemonat. Der Empfänger kann sie per Knopf („Im laufenden Monat einrechnen“) vorziehen (`includeNewMembersInCurrentMonth`): voller Monatsanteil, egal an welchem Tag.
- Betroffen sind nur **neue** Mitzahler (kein Gewichtswechsel eines schon beteiligten Kontos) in aktiven Abos mit Preis für den laufenden Monat. Danach werden nur **offene** Zahlungen neu berechnet (Betrag sinkt, fehlende Zahlung des Neuen wird angelegt). Als bezahlt gemeldete oder bestätigte Zahlungen bleiben unverändert, ein Unterschied wird **nicht** verrechnet (Entscheidung des Betreibers; der Empfänger klärt es bei Bedarf selbst).
- Die Änderung wird den anderen Zahlern nicht per Mail mitgeteilt; sie sehen den neuen Betrag in der App.
