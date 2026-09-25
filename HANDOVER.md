# Übergabe · Fristenradar Rhein-Main (Webapp)

Stand: 24.09.2026 · claim.m GmbH, Technical & Quality Management

Diese Datei erklärt, was gebaut ist, wie du es in Betrieb nimmst (VS Code → GitHub → Homepage, Datenbank Supabase),
was getestet ist und was nicht, und wo die Grenzen liegen. Wer das Projekt später weiterentwickelt, findet hier auch die
Architekturentscheidungen.

---

## 1 · Was die App kann

| Bereich | Funktion |
|---|---|
| **Marktradar (Spur B)** | Akquise-Kandidaten aus öffentlichen Quellen. Fristfenster 4 J./5 J., Priorität P1–P5 (P1 = 90–550 Tage bis zum frühesten Fristende), Briefentwurf als Postbrief |
| **Register (Spur A)** | Nur belegte Abnahmen aus eigenen Unterlagen, fristverbindlich. Sonderfristen (TGA 2 J., Hemmung) als manuelles Fristende |
| **Radar-Karte** | OpenStreetMap im Radarstil: Fähnchen je Objekt in Ampelfarbe (rot ≤ 90 T., gelb ≤ 6 Mon., grün, grau = abgelaufen), grüne Labels an Führungslinien, Entfernungsringe 10/25/50/75 km um das Büro, Radar-Sweep (abschaltbar) |
| **Klick aufs Fähnchen** | Alle Angaben, **Luftlinie + Richtung vom Büro**, Link „Route in OpenStreetMap“ (Fahrstrecke/-zeit), Link zu den Details |
| **Liste** | Unter der Karte, gleiche Filter (Suche, Vertragsart, öffentlich/privat, Status, 6-Monats-Fenster/Alle/Archiv), sortierbar, Entfernungsspalte |
| **Detail** | Alle Felder bearbeiten, Frist live berechnet, Fähnchen per Ziehen korrigieren, Historie aller Änderungen (wer, wann, alt → neu), „Als Mandat ins Register …“ |
| **Import** | CSV aus dem Register, aus den Kandidatenlisten und aus `import_abnahmen.py`. Vorschau mit Dublettenerkennung; bestehende Einträge werden nur **ergänzt**, nie überschrieben; Status bleibt immer |
| **Export** | CSV (Excel-tauglich) inkl. berechneter Fristen, Resttage, Priorität, Entfernung |
| **Austragungen** | Widerspruchsliste (§ 7 UWG). Für passende Bauherren sperrt die App den Brief |
| **Einstellungen** | Büroadresse als Radarzentrum (gilt fürs ganze Team) |
| **Sicherheit** | Login, Freischaltliste, Rechte in der Datenbank (Row Level Security), kein Löschen (nur Archivieren), Spur unveränderlich |

Die Fristlogik ist ein 1:1-Port deiner Python-Skripte. Die Tests vergleichen sie Wert für Wert mit
`build_dashboard.py` und `marktradar.py`. Mit dem echten Register vom 02.09. liefert die App exakt dieselben Zahlen
wie das bisherige Dashboard: 30 im Fenster, 21 kritisch, 7 abgelaufen (Stichtag 02.09.2026). Zum Stichtag 24.09.2026
sind es 24 / 15 / 10.

**Zwei bewusste Abweichungen von den Python-Originalen:**
1. Priorität 5 (beide Fristen abgelaufen) heißt jetzt „abgelaufen“. Das Original schrieb auch dort „nur noch BGB-Fall denkbar“, was bei Prio 5 falsch ist.
2. Ist die Vertragsart bekannt (VOB/B oder BGB), rechnet die Priorität nur mit dieser Frist. `marktradar.py` rechnete immer mit beiden. Bei „unklar“ ist alles identisch.

Der Brieftext ist wortgleich mit dem Original. Der Zeilenumbruch trennt aber nicht mehr an Bindestrichen, weil das Original URLs und Namen zerrissen hat.

---

## 2 · Architektur in einem Satz

Die **Oberfläche** ist eine statische Webseite (React). Sie wird bei jedem Push auf GitHub automatisch gebaut und
veröffentlicht. Die **Daten** liegen in **Supabase** (PostgreSQL, Rechenzentrum Frankfurt): Login und Rechteprüfung
passieren dort, nicht auf der Webseite.

```
 VS Code ──push──▶ GitHub (Code, öffentlich) ──Actions──▶ Homepage (GitHub Pages)
                                                             │  Browser
                                                             ▼
                                   Supabase (Daten + Login + Rechte, EU/Frankfurt)
                                   OpenStreetMap (Kartenkacheln) · Nominatim (Adresssuche)
```

Warum so:
- **Kostenlos** (deine Vorgabe): GitHub Pages, GitHub Actions, Supabase Free und OSM kosten nichts.
- **Daten nicht im Repo:** Ein kostenloses GitHub-Pages-Repo muss öffentlich sein. Das Register enthält Ansprechpartner und Akquise-Einschätzungen, deshalb gehört es in eine Datenbank mit Login.
- **Schutz serverseitig:** Wer den Code liest, kommt trotzdem nicht an die Daten. Die Datenbank prüft bei jeder Abfrage, ob die Person mit ihrem Microsoft-Firmenkonto angemeldet ist (freigeschaltete Domain) oder einzeln freigeschaltet wurde.

---

## 3 · Inbetriebnahme Schritt für Schritt

### 3.0 Einmalig installieren (ca. 15 Min.)
1. **VS Code**: https://code.visualstudio.com
2. **Git**: https://git-scm.com (Windows: bei allen Fragen die Voreinstellung lassen)
3. **Node.js LTS** (Version 22 oder neuer): https://nodejs.org. Das brauchst du nur, um lokal zu testen. GitHub baut selbst.
4. Ein **GitHub-Konto**: https://github.com

### 3.1 Projekt öffnen und lokal testen
1. Das ZIP entpacken, z. B. nach `Dokumente\fristenradar`. Der Ordner enthält eine Git-Historie (versteckter Ordner `.git`), die muss mit.
2. VS Code → **Datei → Ordner öffnen…** → `fristenradar` → „Ja, ich vertraue den Autoren“. Rechts unten schlägt VS Code Erweiterungen vor, „Installieren“ ist optional, aber nützlich.
3. Menü **Terminal → Neues Terminal**, dann nacheinander:
   ```
   npm install
   npm test
   npm run dev
   ```
   `npm test` muss mit „42 passed“ enden. Nach `npm run dev` den Link **http://localhost:5173** öffnen. Die App läuft jetzt im **Demo-Modus** mit erfundenen Daten.
4. Beenden mit **Strg + C** im Terminal.

> Falls `npm` „nicht gefunden“ meldet: VS Code einmal komplett schließen und neu öffnen (nach der Node-Installation).

### 3.2 Nach GitHub hochladen (direkt aus VS Code)
1. Links das Symbol **Quellcodeverwaltung** anklicken (drei verbundene Punkte, `Strg+Umschalt+G`).
2. **„Branch veröffentlichen“** (oder „Publish to GitHub“) → im Browser bei GitHub anmelden und VS Code erlauben.
3. **„Publish to GitHub public repository“** wählen, Name `fristenradar`.
   Warum öffentlich: Nur so ist GitHub Pages kostenlos. Im Repo liegen **keine Daten und keine Passwörter**. Siehe aber Abschnitt 6.

### 3.3 Homepage einschalten (GitHub Pages)
1. Auf github.com dein Repo öffnen → **Settings → Pages** → *Build and deployment → Source*: **GitHub Actions**.
2. Reiter **Actions** → „Deploy“ läuft (1–2 Min., grüner Haken). Falls er nicht von selbst startet: „Deploy“ → **Run workflow**.
3. Die Seite ist erreichbar unter `https://<dein-github-name>.github.io/fristenradar/`. Sie zeigt vorerst die **Demo**.

### 3.4 Datenbank anlegen (Supabase, kostenlos)
1. https://supabase.com → **Start your project** → mit GitHub anmelden.
2. **New project**: Name `fristenradar`, Region **Central EU (Frankfurt)**, ein starkes Datenbank-Passwort vergeben (im Passwortmanager ablegen, die App braucht es nicht).
3. Links **SQL Editor** → **New query** → den **kompletten Inhalt** von `supabase/schema.sql` einfügen → **Run**.
   Falls Supabase vor „destructive operations“ warnt: bestätigen. Gemeint sind die `drop policy/trigger if exists`-Zeilen, die das Skript wiederholbar machen. Es werden keine Daten gelöscht.
4. Direkt danach im SQL Editor die **Firmen-Domain** freischalten. Damit hat jede Person mit claim.m-Adresse Zugriff, **sofern sie sich mit Microsoft anmeldet** (3.4b). Die Domain bitte genau so eintragen, wie sie hinter dem @ der Firmen-Adressen steht, klein geschrieben:
   ```sql
   insert into public.erlaubte_domains (domain) values ('<firmen-domain>');   -- z. B. die Domain eurer Outlook-Adressen
   ```
   Optional einzelne Externe mit Passwort-Login: `insert into public.erlaubte_nutzer (email) values ('name@extern.de');`
5. **Authentication → Sign In / Providers**:
   - **„Allow new users to sign up“ EINschalten.** Das ist nötig, damit Kollegen beim ersten Microsoft-Login automatisch angelegt werden. Sicher ist das trotzdem: Ohne Microsoft-Firmenkonto bzw. Freischaltung sieht ein neues Konto keine Daten (Row Level Security).
   - **Email**-Anbieter: **ausschalten**, wenn es keine Externen gibt (dann gibt es nur noch den Microsoft-Login). Wenn er an bleibt, muss „Confirm email“ aktiv sein.
6. Nur für Externe/Notfall-Zugang: **Authentication → Users → Add user → Create new user**, E-Mail + Passwort, **„Auto Confirm User“** anhaken, und die Adresse in `erlaubte_nutzer` eintragen.
7. **Authentication → URL Configuration**: **Site URL** = die Adresse aus 3.3 (z. B. `https://<name>.github.io/fristenradar/`). Dieselbe Adresse auch unter **Redirect URLs** eintragen, sonst leitet der Microsoft-Login nicht zur App zurück.
8. **Project Settings → API Keys** (je nach Oberfläche auch „API“): die **Project URL** und den **publishable key** kopieren. Der publishable key beginnt mit `sb_publishable_…`; bei älteren Projekten heißt er „anon public“.
   **Niemals** den `service_role`/secret key verwenden, der hebelt alle Rechte aus.

### 3.4b Anmeldung mit dem Microsoft-Firmenkonto (Entra ID)
Das braucht **Admin-Rechte im Microsoft-365-Konto von claim.m** und dauert ca. 15 Minuten. Das Ergebnis: Auf der Login-Seite steht „Mit Microsoft anmelden“, Kollegen melden sich mit ihrem normalen Firmenkonto an, und für die App gibt es kein eigenes Passwort mehr.

1. https://entra.microsoft.com → **Identität → Anwendungen → App-Registrierungen → Neue Registrierung**
   - Name: `Fristenradar`
   - Unterstützte Kontotypen: **„Nur Konten in diesem Organisationsverzeichnis“**
   - Umleitungs-URI: Plattform **Web**, Adresse `https://<projekt-ref>.supabase.co/auth/v1/callback` (die Project URL aus 3.4 Schritt 8 plus `/auth/v1/callback`)
   - **Registrieren**
2. Auf der Übersichtsseite notieren: **Anwendungs-ID (Client-ID)** und **Verzeichnis-ID (Mandanten-ID)**.
3. **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel** → Ablauf z. B. 24 Monate → den **Wert** sofort kopieren (er wird nur einmal angezeigt). **Ablaufdatum in den Kalender eintragen**, einige Wochen vorher erinnern lassen: An diesem Tag funktioniert der Login sonst nicht mehr, dann einen neuen Schlüssel erzeugen und in Supabase ersetzen.
4. **Tokenkonfiguration → Optionalen Anspruch hinzufügen → ID** → **email** anhaken. Supabase braucht die E-Mail-Adresse. Falls die Supabase-Doku zusätzliche Ansprüche nennt (z. B. zur E-Mail-Verifizierung), diese ebenfalls hinzufügen: https://supabase.com/docs/guides/auth/social-login/auth-azure
5. In **Supabase → Authentication → Sign In / Providers → Azure**: aktivieren, **Client ID** und **Secret** (den *Wert* aus Schritt 3) eintragen, **Azure Tenant URL** = `https://login.microsoftonline.com/<Mandanten-ID>` → **Save**.
   Die Tenant URL beschränkt den Login auf Konten eures Microsoft-Mandanten. Private Microsoft-Konten kommen nicht hinein.
6. Test: App öffnen → **Mit Microsoft anmelden** → Microsoft-Fenster → zurück in der App, die Daten sind sichtbar.
   Wenn „Nicht freigeschaltet“ erscheint: Die Domain in Schritt 3.4/4 stimmt nicht mit der Adresse überein, die Microsoft liefert (die App zeigt die angemeldete Adresse an).

Die Freischaltung ist bewusst an den Microsoft-Login gebunden. Eine E-Mail-Adresse allein beweist nichts, ein Konto aus dem eigenen Microsoft-Mandanten schon. Wer die Firma verlässt und dessen Microsoft-Konto die IT sperrt, kommt auch hier nicht mehr hinein.

### 3.5 GitHub mit der Datenbank verbinden
1. Repo → **Settings → Secrets and variables → Actions** → Reiter **Variables** → **New repository variable**:
   - `SUPABASE_URL` = Project URL (z. B. `https://abcd1234.supabase.co`)
   - `SUPABASE_ANON_KEY` = publishable/anon key
   Das sind bewusst *Variables*, keine *Secrets*: Beide Werte landen im Browser jedes Nutzers und sind laut Supabase dafür gedacht. Geschützt wird über Login + Freischaltliste + Row Level Security.
2. **Actions → Deploy → Run workflow**, grüner Haken abwarten, Seite neu laden. Jetzt erscheint die **Anmeldung**.

### 3.6 Erste Einrichtung in der App
1. Anmelden → **Einstellungen** → Büroadresse eintragen → „Koordinaten suchen“ → **Speichern**. Die genaue Büroadresse kenne ich nicht sicher, bitte selbst eintragen.
2. **Import** → Ziel **B · Marktradar** → `gewaehrleistungsregister.csv` aus dem Claude-Projekt (Ordner `gewaehrleistung/`) hochladen → Vorschau prüfen → **übernehmen**.
   Das bisherige Register besteht aus öffentlichen Rechercheergebnissen (Proxy-Daten). Es gehört deshalb in Spur B, **nicht** ins Register.
3. Danach `radar-kandidaten-2026-08-25.csv` und `radar-kandidaten-2026-08-31.csv` ebenso als Spur B importieren. Die App erkennt z. B., dass „Kita am Forum“ und „varisano“ schon da sind, und ergänzt nur fehlende Felder.
4. **Marktradar** → unter der Karte **„Koordinaten über OpenStreetMap ermitteln“** anklicken. Das dauert ca. 1–2 Sekunden pro Objekt, weil Nominatim max. 1 Anfrage/Sekunde erlaubt. Einträge ohne Hausnummer landen auf der Ortsmitte (≈) und lassen sich in den Details per Ziehen korrigieren.

### 3.7 Später etwas ändern
In VS Code ändern → Quellcodeverwaltung → Nachricht eintippen → **Commit** → **Sync Changes**.
GitHub testet und baut die Seite neu (1–2 Min.). Die Daten in Supabase bleiben davon unberührt.
Schlagen die Tests fehl, geht nichts online und die alte Version bleibt stehen.

---

## 4 · Checkliste für den ersten echten Test

Kartenkacheln, Adresssuche und Supabase waren aus meiner Umgebung **nicht erreichbar** (siehe 5). Diese Punkte
bitte beim ersten Mal im Browser prüfen:

- [ ] Karte zeigt echte Straßen im dunklen Radar-Look. Falls der Look nicht passt (zu dunkel/hell): Tabelle `RADAR_KURVE` in `src/ui/RadarKarte.tsx` anpassen. Ich habe sie an synthetischen Kacheln in OSM-Farben kalibriert, nicht an echten.
- [ ] „Mit Microsoft anmelden“ klappt und führt zurück in die App. Ein Konto ohne freigeschaltete Domain sieht „Nicht freigeschaltet“ und keine Daten.
- [ ] Import des Registers: 41 Zeilen „neu“. Danach KPIs zum Stichtag 24.09.2026: 24 im Fenster / 15 ≤ 90 Tage / 10 abgelaufen.
- [ ] „Koordinaten ermitteln“ läuft durch, Fähnchen erscheinen, Entfernungen sind plausibel (z. B. Mainz ≈ 30–40 km Luftlinie).
- [ ] Fähnchen anklicken → Popup mit allen Angaben, „Route in OpenStreetMap“ öffnet die Routenplanung.
- [ ] Einen Eintrag ändern → in den Details erscheint die Historie mit deiner E-Mail.
- [ ] Brief bei einem P1-Kandidaten erzeugen. Mit einem Bauherrn auf der Austragungsliste ist er gesperrt.
- [ ] Ein Kollege meldet sich mit Microsoft an und sieht ohne weiteres Zutun dieselben Daten.

---

## 5 · Was getestet ist und was nicht

**Getestet (42 automatische Tests, laufen bei jedem Push auf GitHub):**
- Fristlogik gegen die Python-Originale (4 Stichtage × 18 Grenzfälle, u. a. 29.02., Monatsangaben, manuelles Fristende, Fenstergrenzen) plus Priorisierung (48 Fälle) und Brieftexte.
- CSV-Parser (Semikolon, Anführungszeichen, Umbrüche, BOM), Spaltenzuordnung aller drei CSV-Formate, Dublettenerkennung mit echten Namensvarianten aus deinem Bestand, Merge-Regeln.
- **Datenbankschema in echtem PostgreSQL** (PGlite): anonym kein Zugriff; angemeldet, aber nicht freigeschaltet keine Daten; freigeschaltet anlegen/ändern mit Historie; Löschen verboten; Spur unveränderlich; Quellenzwang; Datumsformat; Domain-Freischaltung nur mit Microsoft-Login und nur für exakt diese Domain (keine Subdomains oder ähnlich klingende Domains).
- Oberfläche im Browser (Chromium) durchgeklickt, mit Demo-Daten und deinem echten Register. Kartenkacheln und Adresssuche waren dabei durch Attrappen ersetzt. Keine JavaScript-Fehler, mobil ohne horizontales Scrollen.

**Nicht getestet (aus meiner Umgebung nicht erreichbar):**
- Echte OSM-Kacheln und echte Nominatim-Antworten (der Proxy sperrt beide Server).
- Der Microsoft-Login gegen einen echten Entra-Mandanten. Die Login-Seite und die Fehlermeldungen sind getestet, die Weiterleitung selbst nicht.
- Echte Supabase-Verbindung (Login, Speichern über das Netz). Die Aufrufe sind Standard-`supabase-js`, das SQL ist getestet, aber der End-to-End-Weg nicht.
- Der GitHub-Actions-Workflow selbst. Die Action-Versionen stammen aus der GitHub-Doku (Stand 09/2026). Bei `actions/setup-node@v5` bin ich mir nicht zu 100 % sicher. Falls der Build daran scheitert: auf `@v4` ändern.

---

## 6 · Grenzen, Risiken, offene Entscheidungen

1. **GitHub Pages und Login.** GitHub schreibt in den Nutzungsbedingungen für Pages, die Seiten sollten nicht für sensible Vorgänge wie das Senden von Passwörtern genutzt werden, und Pages sei nicht als kostenloses Hosting für ein Online-Geschäft/SaaS gedacht ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). Mit dem **Microsoft-Login** (3.4b) wird das Passwort bei Microsoft eingegeben und nicht auf der Seite. Damit ist der Passwort-Punkt weitgehend erledigt, solange der Email-Anbieter in Supabase aus ist. Ein internes Werkzeug ist außerdem kein Shop oder SaaS. Die abschließende Bewertung bleibt bei dir.
   **Saubere kostenlose Alternative: Cloudflare Pages.** Der Code bleibt auf GitHub (dann auch als **privates** Repo), Cloudflare baut bei jedem Push automatisch. Dazu gibt es optional „Cloudflare Access“, das die ganze Seite hinter einen Login legt. Einrichtung: dash.cloudflare.com → *Workers & Pages → Create → Pages → Connect to Git* → Repo wählen → Build command `npm run build`, Output `dist`, Umgebungsvariablen `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`. Am Code ist nichts zu ändern. Kostenloser Tarif laut Cloudflare: 500 Builds/Monat. Ob private Repos im Free-Tarif gehen, steht nicht auf der Limits-Seite, bitte beim Einrichten prüfen.
2. **Öffentliches Repo = öffentlicher Code.** Fristlogik, Brieftexte und Import-Regeln sind für jeden lesbar, die Daten nicht. Wer das nicht will: privates Repo + Cloudflare Pages (Punkt 1) oder GitHub Pro (kostenpflichtig).
3. **Supabase Free pausiert nach 7 Tagen ohne Aktivität.** Die Action `keepalive.yml` fragt alle 3 Tage an. GitHub schaltet geplante Actions in öffentlichen Repos aber **nach 60 Tagen ohne Commit** ab. Dann im Reiter Actions wieder aktivieren. Ein pausiertes Projekt lässt sich im Supabase-Dashboard mit „Restore“ wieder starten, die Daten bleiben erhalten. Datenbank-Limit im Free-Tarif: 500 MB, für dieses Register mehr als genug.
4. **Backups:** Der kostenlose Supabase-Tarif hat nach meinem Kenntnisstand keine zugesicherten Backups. Bitte prüfen, bevor echte Mandatsdaten (Spur A) hineinkommen. Minimal: regelmäßig **CSV exportieren** und ablegen.
5. **OSM-Nutzungsbedingungen:** Kacheln und Nominatim sind für geringe Last kostenlos. Für ein kleines Team ist das unkritisch; bei starker Nutzung wäre ein Kachelanbieter nötig. Quellenangabe ist eingebaut.
6. **Entfernung = Luftlinie.** Eine echte Fahrstrecke bräuchte einen Routing-Dienst, und die kostenlosen sind nicht für Dauerbetrieb freigegeben. Fahrzeit liefert der Link „Route in OpenStreetMap“.
7. **Datenschutz:** Namen von Ansprechpartnern stammen aus öffentlichen Quellen. Für die Ansprache gilt Art. 14 DSGVO (Informationspflicht). Briefe nur per Post, E-Mail-Werbung ohne Einwilligung ist auch B2B unzulässig (§ 7 Abs. 2 Nr. 2 UWG). Keine Rechtsberatung.
---

## 7 · Wöchentliche Recherche

Der bisherige Claude-Task (mittwochs) baut ein Artifact-Dashboard. Mit der App soll er stattdessen eine
**Import-Datei** ins Claude-Projekt schreiben, die du unter Import → Spur B hochlädst. Der fertige Prompt steht in
`docs/wochen-task-prompt.md`. Den Task auf diesen Prompt umzustellen ist ein Handgriff. Sag Bescheid, dann ändere ich
ihn.

---

## 8 · Für Entwickler

| Datei | Inhalt |
|---|---|
| `src/lib/fristen.ts` | Fristlogik. Änderungen nur mit Golden-Tests (`python3 tools/golden.py`, dann `npm test`) |
| `src/lib/felder.ts` | Datenmodell, Feldliste, CSV-Spaltennamen (Aliase), Status-Listen, Prüfregeln |
| `src/lib/abgleich.ts` | Import-Abgleich: `planeImport()`, `merge()`, Ähnlichkeit |
| `src/lib/store.ts` | Datenzugriff (Supabase/Demo), gleiche Schnittstelle |
| `src/ui/RadarKarte.tsx` | Leaflet-Karte, Radar-Filter (`RADAR_KURVE`), Label-Platzierung mit Kollisionsvermeidung, Popup |
| `src/styles.css` | Alle Farben zentral oben (claim.m: Rot #ED1C24, Anthrazit #151515, Weiß, Arial) |
| `supabase/schema.sql` | Idempotent. Neue Spalten: `alter table … add column if not exists …` anhängen und erneut ausführen |
| `public/logo-*.png` | claim.m-Logos (hell/dunkel), `favicon.png` aus dem m-Block |
| `tools/import_abnahmen.py` | Spur A aus eigenen PDFs/DOCX, unverändert übernommen (`pip install pdfplumber python-docx`) |
| `tools/legacy/` | Python-Originale als Referenz für die Golden-Tests. Nicht mehr produktiv |

Lokal gegen die echte Datenbank testen: `.env.example` nach `.env.local` kopieren, Werte eintragen, `npm run dev`.
`.env.local` wird nicht committet.

Routing läuft über `#/…` (Hash), weil GitHub Pages keine SPA-Routen kennt: `#/radar`, `#/register`,
`#/objekt/<id>`, `#/objekt/neu?spur=A`, `#/import`, `#/austragungen`, `#/einstellungen`.

---

## 9 · Nächste sinnvolle Schritte

1. Checkliste Abschnitt 4 abarbeiten, Radar-Look ggf. nachjustieren.
2. Hosting-Entscheidung GitHub Pages vs. Cloudflare Pages (Abschnitt 6.1/6.2).
3. Wochen-Task auf Import-Datei umstellen (Abschnitt 7).
4. Erste echte Mandate ins Register (Spur A): Abnahmeprotokolle → `tools/import_abnahmen.py` → Prüfbedarf abarbeiten → Import Spur A.
