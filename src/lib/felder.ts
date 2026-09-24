/**
 * Datenmodell eines Eintrags ("Objekt") – identisch mit der Tabelle public.objekte in supabase/schema.sql.
 *
 * Zwei Spuren, strikt getrennt (siehe README-fristenradar.md, "Zwei Spuren"):
 *   A = Register: nur belegte Abnahmedaten aus EIGENEN Mandatsunterlagen – fristverbindlich.
 *   B = Marktradar: öffentlich belegte Proxys (Übergabe, Eröffnung, Zuschlag) – nur für die Akquise.
 * Die Spur eines Eintrags ist nach dem Anlegen unveränderlich (DB-Trigger).
 */

export type Spur = "A" | "B";

export interface Objekt {
  id: number;
  spur: Spur;
  projekt: string;
  adresse: string;
  plz: string;
  ort: string;
  region: string;
  leistung: string;
  auftragnehmer: string;
  rolle_an: string;
  vertragsart: string; // "VOB/B" | "BGB" | "unklar"
  datum: string; // JJJJ-MM-TT | JJJJ-MM | JJJJ | ""
  datumsart: string;
  bezugsart: string; // "abnahme" | "fertigstellung" | "zuschlag"
  projektgroesse: string; // "" | "klein" | "mittel" | "gross"
  fristende: string; // manuell gepflegtes Fristende (Vorrang)
  bauherr: string;
  ansprechpartner: string;
  property_manager: string;
  sicherheit: string;
  status: string;
  konfidenz: string; // "" | "hoch" | "mittel" | "niedrig"
  quelle: string;
  quelle_titel: string;
  quelle_datum: string;
  anrede: string;
  kontakt_funktion: string;
  bemerkung: string;
  /** Koordinaten (WGS84), per Nominatim ermittelt oder manuell gesetzt */
  lat: number | null;
  lon: number | null;
  /** "" | "adresse" | "ort" | "manuell" */
  geo_genauigkeit: string;
  /** Suchtext, mit dem die Koordinaten ermittelt wurden – ändert sich die Adresse, wird neu gesucht */
  geo_abfrage: string;
  archiviert: boolean;
  erstellt_am: string;
  erstellt_von: string;
  geaendert_am: string;
  geaendert_von: string;
}

export type ObjektDaten = Omit<Objekt, "id" | "archiviert" | "erstellt_am" | "erstellt_von" | "geaendert_am" | "geaendert_von">;
export type Feld = Exclude<keyof ObjektDaten, "lat" | "lon" | "geo_genauigkeit" | "geo_abfrage">;

export interface FeldDef {
  key: Feld;
  label: string;
  /** CSV-Spaltennamen, die beim Import auf dieses Feld abgebildet werden (erster = Exportname) */
  csv: string[];
  gruppe: "Objekt" | "Beteiligte" | "Frist" | "Quelle" | "Akquise" | "Notizen";
  hilfe?: string;
  mehrzeilig?: boolean;
  nurSpur?: Spur;
}

export const FELDER: FeldDef[] = [
  { key: "projekt", label: "Projekt", csv: ["Projekt"], gruppe: "Objekt" },
  { key: "adresse", label: "Adresse", csv: ["Adresse"], gruppe: "Objekt" },
  { key: "plz", label: "PLZ", csv: ["PLZ"], gruppe: "Objekt" },
  { key: "ort", label: "Ort", csv: ["Ort"], gruppe: "Objekt" },
  { key: "region", label: "Region", csv: ["Region"], gruppe: "Objekt", hilfe: "Genau „Rhein-Main“ schreiben, sonst erscheint der Eintrag nicht im Radar." },
  { key: "leistung", label: "Leistung / Gewerk", csv: ["Leistung/Gewerk", "Leistung", "Gewerk"], gruppe: "Objekt", mehrzeilig: true },
  { key: "bauherr", label: "Bauherr", csv: ["Bauherr", "Auftraggeber"], gruppe: "Beteiligte" },
  { key: "ansprechpartner", label: "Ansprechpartner Bauherr", csv: ["Ansprechpartner Bauherr", "Ansprechpartner"], gruppe: "Beteiligte" },
  { key: "property_manager", label: "Property Manager / Betreiber", csv: ["Property Manager", "Betreiber"], gruppe: "Beteiligte" },
  { key: "auftragnehmer", label: "Auftragnehmer", csv: ["Auftragnehmer"], gruppe: "Beteiligte" },
  { key: "rolle_an", label: "Rolle AN", csv: ["Rolle AN"], gruppe: "Beteiligte", hilfe: "GU, GÜ, Einzelgewerk, Planer, Bauträger …" },
  { key: "vertragsart", label: "Vertragsart", csv: ["Vertragsart"], gruppe: "Frist", hilfe: "VOB/B = 4 Jahre, BGB = 5 Jahre, unklar = beide Szenarien" },
  { key: "bezugsart", label: "Datum bezeichnet", csv: ["Bezugsart"], gruppe: "Frist", hilfe: "Abnahme (nur Spur A, belegt) · Fertigstellung/Übergabe · Zuschlag (Abnahme wird geschätzt)" },
  { key: "datum", label: "Datum", csv: ["Abnahme/Fertigstellung", "Abnahmedatum", "Bezugsdatum"], gruppe: "Frist", hilfe: "JJJJ-MM-TT oder JJJJ-MM (nur Monat bekannt)" },
  { key: "datumsart", label: "Datumsart (wörtlich)", csv: ["Datumsart"], gruppe: "Frist", hilfe: "z. B. „Einweihung“, „Schlüsselübergabe“, „förmliche Abnahme“" },
  { key: "projektgroesse", label: "Projektgröße (nur bei Zuschlag)", csv: ["Projektgroesse", "Projektgröße"], gruppe: "Frist" },
  { key: "fristende", label: "Fristende manuell", csv: ["Fristende"], gruppe: "Frist", hilfe: "Nur bei vertraglich bekannter Sonderfrist (TGA 2 J., Hemmung, Verzicht). Leer = berechnet." },
  { key: "sicherheit", label: "Sicherheit", csv: ["Sicherheit"], gruppe: "Frist", hilfe: "Bürgschaft, Einbehalt …" },
  { key: "status", label: "Status", csv: ["Status"], gruppe: "Notizen" },
  { key: "konfidenz", label: "Konfidenz", csv: ["Konfidenz"], gruppe: "Quelle" },
  { key: "quelle", label: "Quelle (URL / Aktenzeichen)", csv: ["Quelle", "Quelle-URL"], gruppe: "Quelle", hilfe: "Spur B: Pflicht. Spur A: Dokument/Aktenzeichen des Abnahmeprotokolls." },
  { key: "quelle_titel", label: "Quelle Titel", csv: ["Quelle Titel", "Quelle_Titel"], gruppe: "Quelle" },
  { key: "quelle_datum", label: "Quelle abgerufen/belegt am", csv: ["Quelle_Datum", "Quelle Datum"], gruppe: "Quelle" },
  { key: "anrede", label: "Anrede für Brief", csv: ["Anrede"], gruppe: "Akquise", nurSpur: "B" },
  { key: "kontakt_funktion", label: "Funktion Kontakt", csv: ["Kontakt_Funktion", "Kontakt Funktion"], gruppe: "Akquise", nurSpur: "B" },
  { key: "bemerkung", label: "Bemerkung", csv: ["Bemerkung", "Hinweis"], gruppe: "Notizen", mehrzeilig: true },
];

export const FELD_KEYS = FELDER.map((f) => f.key);

export const STATUS: Record<Spur, string[]> = {
  A: ["offen", "Begehung geplant", "Mängelrüge läuft", "abgelaufen prüfen", "erledigt"],
  B: ["Kandidat", "neu - noch nicht angeschrieben", "angeschrieben", "Gespräch", "Mandat", "kein Interesse", "verworfen", "abgelaufen prüfen"],
};

export const SPUR_NAME: Record<Spur, string> = { A: "Register", B: "Marktradar" };

export function leeresObjekt(spur: Spur): ObjektDaten {
  const o = Object.fromEntries(FELD_KEYS.map((k) => [k, ""])) as unknown as ObjektDaten;
  o.spur = spur;
  o.lat = null;
  o.lon = null;
  o.geo_genauigkeit = "";
  o.geo_abfrage = "";
  o.region = "Rhein-Main";
  o.vertragsart = "unklar";
  o.bezugsart = spur === "A" ? "abnahme" : "fertigstellung";
  o.status = spur === "A" ? "offen" : "Kandidat";
  return o;
}

// ------------------------------------------------------------------ Normalisierung

export function normVertragsart(v: string): string {
  const u = (v ?? "").toUpperCase();
  if (u.includes("VOB")) return "VOB/B";
  if (u.includes("BGB")) return "BGB";
  return "unklar";
}

export function normBezugsart(v: string, spur: Spur): string {
  const l = (v ?? "").trim().toLowerCase();
  if (l.startsWith("zuschlag")) return "zuschlag";
  if (l.startsWith("abnahme")) return "abnahme";
  if (l.startsWith("fertig")) return "fertigstellung";
  return spur === "A" ? "abnahme" : "fertigstellung";
}

export function normGroesse(v: string): string {
  const l = (v ?? "").trim().toLowerCase().replace("ß", "ss");
  return ["klein", "mittel", "gross"].includes(l) ? l : "";
}

export function normKonfidenz(v: string): string {
  const l = (v ?? "").trim().toLowerCase();
  return ["hoch", "mittel", "niedrig"].includes(l) ? l : "";
}

/** Prüft einen Datensatz vor dem Speichern. Liefert Fehler (blockierend) und Hinweise. */
export function pruefe(o: ObjektDaten): { fehler: string[]; hinweise: string[] } {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  if (!o.projekt.trim()) fehler.push("Projekt fehlt.");
  if (o.spur === "B" && !o.quelle.trim()) fehler.push("Spur B braucht eine Quelle – ohne zitierfähige Fundstelle kein Eintrag.");
  if (o.spur === "B" && o.bezugsart === "abnahme") fehler.push("„Abnahme“ ist Spur A vorbehalten: öffentliche Quellen belegen keine förmliche Abnahme.");
  if (o.spur === "A" && !o.quelle.trim()) hinweise.push("Kein Beleg angegeben – bitte Abnahmeprotokoll/Aktenzeichen eintragen.");
  if (o.spur === "A" && o.datum && o.datum.length !== 10) hinweise.push("Im Register sollte das Abnahmedatum taggenau sein.");
  if (o.spur === "A" && o.vertragsart === "unklar") hinweise.push("Vertragsart unklar – entscheidet über 4 oder 5 Jahre.");
  if (o.spur === "A" && o.vertragsart === "VOB/B") hinweise.push("VOB/B: 2-Jahres-Frist für maschinelle/elektrotechnische Anlagen ohne Wartungsvertrag prüfen (§ 13 Abs. 4 Nr. 2 VOB/B) – ggf. eigene Zeile mit manuellem Fristende.");
  for (const k of ["datum", "fristende"] as const) {
    const v = (o[k] ?? "").trim();
    if (v && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)) fehler.push(`${k === "datum" ? "Datum" : "Fristende"} „${v}“ ist kein gültiges Format (JJJJ-MM-TT oder JJJJ-MM).`);
  }
  if (o.bezugsart === "zuschlag" && !o.projektgroesse) hinweise.push("Bei Zuschlag bitte Projektgröße angeben (sonst 24 Monate Bauzeit angesetzt).");
  if (o.region && o.region !== "Rhein-Main" && o.region.toLowerCase().replace(/[-\s]/g, "") !== "rheinmain") hinweise.push("Region ist nicht „Rhein-Main“ – der Eintrag erscheint nicht im Radar.");
  return { fehler, hinweise };
}
