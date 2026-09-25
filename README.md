# Fristenradar Rhein-Main · claim.m

Webapp für das Gewährleistungsmanagement von claim.m (Technical & Quality Management). Sie hat zwei strikt getrennte Spuren:

- **Register (Spur A):** fristverbindlich, nur belegte Abnahmen aus eigenen Mandatsunterlagen.
- **Marktradar (Spur B):** Akquise aus öffentlichen Quellen (Übergabe, Eröffnung, Zuschlag), mit Priorisierung und Briefentwurf.

Die Oberfläche besteht aus einer Radar-Karte (OpenStreetMap) mit Fähnchen je Objekt, einem Popup mit allen Angaben
und der Entfernung vom Büro, darunter der Liste. Außerdem gibt es CSV-Import mit Dublettenabgleich, CSV-Export,
Historie jeder Änderung und eine Austragungsliste nach § 7 UWG.

**Einrichtung und Bedienung Schritt für Schritt: [HANDOVER.md](HANDOVER.md).**

## Technik

| Teil | Lösung | Kosten |
|---|---|---|
| Oberfläche | React + TypeScript + Vite, statisch | – |
| Hosting | GitHub Pages (öffentliches Repo) | kostenlos |
| Daten, Login, Rechte | Supabase (PostgreSQL, Frankfurt), Row Level Security, Freischaltliste | kostenloser Tarif |
| Karte | Leaflet + OpenStreetMap-Kacheln, Adresssuche Nominatim | kostenlos, Nutzungsbedingungen beachten |
| Build/Deploy | GitHub Actions (Tests → Build → Pages) | kostenlos bei öffentlichem Repo |

Ohne Supabase-Verbindung startet die App im **Demo-Modus** mit erfundenen Beispieldaten.

## Befehle

```bash
npm install        # einmalig
npm run dev        # lokal starten → http://localhost:5173
npm test           # Fristlogik (Golden-Tests gegen die Python-Originale), Import-Abgleich, Brief, Geo, DB-Schema
npm run build      # wie auf GitHub
python3 tools/golden.py                    # Erwartungswerte aus tools/legacy neu erzeugen
python3 tools/import_abnahmen.py --selftest
```

## Aufbau

```
src/lib/fristen.ts    Fristlogik (§§ 187/188 BGB, 4/5 J., Fenster, Ampel, Priorität) – Port von build_dashboard.py/marktradar.py
src/lib/abgleich.ts   CSV-Import: Spaltenzuordnung, Dublettenerkennung, Ergänzen statt Überschreiben
src/lib/brief.ts      Brieftext (Postbrief, nur Monat/Jahr, Sperre bei Austragung/ohne Quelle)
src/lib/geo.ts        Nominatim-Geokodierung (1 Anfrage/s), Luftlinie, Richtung, Routenlink
src/lib/store.ts      Datenzugriff: Supabase oder Demo
src/ui/               Oberfläche (RadarKarte, Liste, Objekt, Import, Austragungen, Einstellungen, Login)
supabase/schema.sql   Datenbank: Tabellen, Constraints, RLS, Audit-Trigger – im Supabase-SQL-Editor ausführen
tests/                Vitest; schema.test.ts prüft das SQL in echtem PostgreSQL (PGlite)
tools/                import_abnahmen.py (Spur A aus eigenen PDFs/DOCX), legacy/ = Python-Originale als Referenz
docs/                 Prompt für den wöchentlichen Recherche-Task
```

## Wichtig

- **Keine echten Daten ins Repo.** Das Repo ist öffentlich. Echte CSVs gehören in die App (Import) oder ins Claude-Projekt, der Ordner `daten/` ist per `.gitignore` ausgeschlossen.
- Keine Rechtsberatung: Fristen vor jeder Handlung am Vertrag prüfen. Briefe nur per Post (§ 7 Abs. 2 Nr. 2 UWG), Art. 14 DSGVO beachten.

© claim.m GmbH. Alle Rechte vorbehalten.
