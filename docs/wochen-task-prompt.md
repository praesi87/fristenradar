# Neuer Prompt für den wöchentlichen Claude-Task (Web-Recherche → Import-Datei)

Mit der Webapp braucht der Wochen-Task kein Dashboard-Artifact mehr zu bauen. Er liefert nur noch eine
Import-Datei ins Claude-Projekt. Du lädst sie in der App unter **Import → Spur B** hoch, prüfst die Vorschau
und übernimmst die Zeilen. Dubletten und Ergänzungen erkennt die App, Nutzer-Status wird nie überschrieben.

Damit der Task weiß, was schon bekannt ist, exportierst du vorher in der App unter **Marktradar → CSV exportieren**
den aktuellen Stand und legst ihn im Claude-Projekt als `gewaehrleistung/app-export.csv` ab. Das ist optional,
verhindert aber doppelte Recherche.

---

```
Du bist im Claude-Projekt „claim.m - Allgemein & core“. Aufgabe: wöchentliche Web-Recherche für den
Fristenradar Rhein-Main (Webapp). Arbeite ohne Rückfragen, antworte auf Deutsch, erfinde niemals Projekte,
Daten, Personen oder Quellen.

1. Lies mit dem Projects-Tool: gewaehrleistung/README-fristenradar.md (Regeln) und – falls vorhanden –
   gewaehrleistung/app-export.csv (aktueller Stand aus der App; nicht erneut recherchieren, was dort steht,
   außer um leere Felder zu füllen).

2. Recherche (WebSearch/WebFetch, gern parallele Agents nach Teilregionen Frankfurt / Wiesbaden-Mainz-Taunus /
   Darmstadt-Offenbach-Hanau-Kreis Groß-Gerau): Bauprojekte im Rhein-Main-Gebiet, deren Gewährleistung im
   Zeitraum [heute, heute + 6 Monate] abläuft, also Fertigstellung/Übergabe/Eröffnung ca. 4 Jahre (VOB/B) bzw.
   5 Jahre (BGB) vor diesem Zeitraum. Schwerpunkt: der Monat, der seit dem letzten Lauf neu ins Fenster gerückt ist.
   Ergiebigste Quellen: Referenzseiten von Architekten und Baufirmen (heinze.de-Objektdatenblätter,
   „Bauzeit: … – …“), Hochschul-/Kreis-Pressestellen, idw-online.de. Mindestens Monat + Jahr müssen wörtlich belegt
   sein („Anfang 2023“ reicht nicht). Jede URL per WebFetch prüfen, Datum wörtlich zitieren.
   Ziel: mindestens 5 neue belegte Projekte pro Lauf, wenn vorhanden.

3. Schreibe das Ergebnis als CSV (UTF-8, Semikolon) mit genau dieser Kopfzeile:
   Projekt;Adresse;PLZ;Ort;Region;Leistung/Gewerk;Auftragnehmer;Rolle AN;Vertragsart;Abnahme/Fertigstellung;Datumsart;Bezugsart;Fristende;Bauherr;Ansprechpartner Bauherr;Property Manager;Sicherheit;Status;Konfidenz;Quelle;Quelle Titel;Quelle_Datum;Bemerkung
   Regeln: Region „Rhein-Main“; Vertragsart „VOB/B“, „BGB“ oder „unklar“ nach Quellenlage; Datum JJJJ-MM-TT oder
   JJJJ-MM; Bezugsart „fertigstellung“ (oder „zuschlag“ bei Vergabedaten); Status „Kandidat“; Quelle = URL (Pflicht);
   Quelle_Datum = heutiges Datum; wörtliches Datumszitat und Unsicherheiten in die Bemerkung.
   Für Nachrecherche zu bestehenden Einträgen: eine Zeile mit gleichem Projektnamen, Ort und Quelle wie im Export,
   in der NUR die neu gefundenen Felder gefüllt sind – die App ergänzt dann nur leere Felder.
   Ablage mit project_write unter gewaehrleistung/import-marktradar-JJJJ-MM-TT.csv.

4. Per SendUserMessage und Push-Benachrichtigung kurz berichten: Anzahl neue Projekte (Ort, Bauherr,
   Auftragnehmer, Fertigstellung, Quelle), welche bestehenden ergänzt wurden, Unsicherheiten (nur Monat,
   Vertragsart unklar, Fertigstellung ≠ Abnahme) und der Hinweis: „In der App unter Import → Spur B hochladen“.

5. Bei Fehlern nichts überschreiben, Fehler klar melden.
```
