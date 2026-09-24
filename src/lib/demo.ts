/**
 * ERFUNDENE Beispieldaten für den Demo-Modus. Keine realen Projekte, Firmen oder Personen.
 * Datumsangaben relativ zum heutigen Tag, damit die Demo immer alle Ampelfarben zeigt.
 */
import { type ObjektDaten, leeresObjekt } from "./felder";
import { heute, plusJahre, plusMonate } from "./fristen";

function vor(monate: number, jahre: number, genau = true): string {
  const d = plusMonate(plusJahre(heute(), -jahre), monate);
  return genau ? d : d.slice(0, 7);
}

/** ungefähre Ortsmittelpunkte (nur Demo) */
const ORT: Record<string, [number, number]> = {
  "Frankfurt am Main": [50.1109, 8.6821],
  "Offenbach am Main": [50.0956, 8.7761],
  Wiesbaden: [50.0782, 8.2398],
  Darmstadt: [49.8728, 8.6512],
  Mainz: [49.9929, 8.2473],
  Hanau: [50.1328, 8.9169],
  "Bad Homburg v. d. Höhe": [50.2268, 8.6182],
};

let versatz = 0;
function b(p: Partial<ObjektDaten>): ObjektDaten {
  const o = { ...leeresObjekt(p.spur ?? "B"), ...p };
  const c = ORT[o.ort];
  if (c && o.lat === null) {
    versatz++;
    o.lat = c[0] + ((versatz % 3) - 1) * 0.012;
    o.lon = c[1] + ((versatz % 4) - 1.5) * 0.015;
    o.geo_genauigkeit = "ort";
    o.geo_abfrage = o.ort;
  }
  return o;
}

export const DEMO_DATEN: ObjektDaten[] = [
  b({ spur: "B", projekt: "BEISPIEL Grundschule Musterfeld – Neubau", ort: "Frankfurt am Main", plz: "60000", adresse: "Musterweg 1", leistung: "Neubau Grundschule mit Sporthalle", bauherr: "BEISPIEL Stadt Musterstadt – Amt für Bau", auftragnehmer: "BEISPIEL Hochbau GmbH", rolle_an: "GU", vertragsart: "VOB/B", datum: vor(1, 4), datumsart: "Einweihung", konfidenz: "hoch", quelle: "https://beispiel.invalid/presse/einweihung", quelle_titel: "BEISPIEL: Einweihung (erfunden)", bemerkung: "Demo – öffentlicher AG, VOB/B angenommen." }),
  b({ spur: "B", projekt: "BEISPIEL Wohnquartier Am Musterpark", ort: "Offenbach am Main", leistung: "120 Mietwohnungen, Tiefgarage", bauherr: "BEISPIEL Wohnbau AG", vertragsart: "unklar", datum: vor(4, 4, false), datumsart: "Fertigstellung", konfidenz: "mittel", quelle: "https://beispiel.invalid/referenz/musterpark", quelle_titel: "BEISPIEL: Projektreferenz", status: "neu - noch nicht angeschrieben", anrede: "Sehr geehrte Frau Beispiel,", bemerkung: "Demo – nur Monat bekannt." }),
  b({ spur: "B", projekt: "BEISPIEL Pflegeheim Sonnenhang", ort: "Wiesbaden", leistung: "Pflegeheim 90 Plätze", bauherr: "BEISPIEL Pflege gGmbH", vertragsart: "unklar", datum: vor(2, 5), datumsart: "Eröffnung", konfidenz: "mittel", quelle: "https://beispiel.invalid/pflege", quelle_titel: "BEISPIEL: Eröffnung" }),
  b({ spur: "B", projekt: "BEISPIEL Kita Regenbogen", ort: "Darmstadt", leistung: "Neubau Kita, 5 Gruppen", bauherr: "BEISPIEL Widerspruch GmbH", vertragsart: "unklar", datum: vor(5, 4), datumsart: "Übergabe", konfidenz: "niedrig", quelle: "https://beispiel.invalid/kita", quelle_titel: "BEISPIEL: Übergabe", bemerkung: "Demo – Bauherr steht auf der Austragungsliste, Brief ist gesperrt." }),
  b({ spur: "B", projekt: "BEISPIEL Verwaltungsgebäude Nord", ort: "Mainz", leistung: "Bürogebäude 8.000 m² BGF", bauherr: "BEISPIEL Landesbetrieb Bau", auftragnehmer: "BEISPIEL Bau AG", bezugsart: "zuschlag", projektgroesse: "gross", datum: vor(0, 6), datumsart: "Zuschlag (Vergabebekanntmachung)", konfidenz: "mittel", quelle: "https://beispiel.invalid/ted/123", quelle_titel: "BEISPIEL: Vergabebekanntmachung" }),
  b({ spur: "B", projekt: "BEISPIEL Sporthalle Talstraße", ort: "Hanau", leistung: "Dreifeldhalle", bauherr: "BEISPIEL Kreis Musterkreis", vertragsart: "VOB/B", datum: vor(-3, 4), datumsart: "Einweihung", konfidenz: "hoch", quelle: "https://beispiel.invalid/halle", quelle_titel: "BEISPIEL: Einweihung", status: "abgelaufen prüfen" }),
  b({ spur: "A", projekt: "BEISPIEL Mandat – Bürohaus Hafenkante, Los Rohbau", ort: "Frankfurt am Main", leistung: "Rohbau", bauherr: "BEISPIEL Mandant GmbH", auftragnehmer: "BEISPIEL Rohbau GmbH", rolle_an: "Einzelgewerk", vertragsart: "VOB/B", datum: vor(2, 4), datumsart: "förmliche Abnahme", sicherheit: "Gewährleistungsbürgschaft 5 %", quelle: "Abnahmeprotokoll BEISPIEL-AZ 001", status: "Begehung geplant" }),
  b({ spur: "A", projekt: "BEISPIEL Mandat – Bürohaus Hafenkante, Los TGA (ohne Wartungsvertrag)", ort: "Frankfurt am Main", leistung: "Lüftung/Kälte", bauherr: "BEISPIEL Mandant GmbH", auftragnehmer: "BEISPIEL Haustechnik GmbH", rolle_an: "Einzelgewerk", vertragsart: "VOB/B", datum: vor(2, 4), fristende: plusJahre(vor(2, 4), -2), datumsart: "förmliche Abnahme", quelle: "Abnahmeprotokoll BEISPIEL-AZ 002", bemerkung: "Demo – Sonderfrist 2 J. nach § 13 Abs. 4 Nr. 2 VOB/B manuell gepflegt.", status: "abgelaufen prüfen" }),
  b({ spur: "A", projekt: "BEISPIEL Mandat – Wohnanlage Lindenhof", ort: "Bad Homburg v. d. Höhe", leistung: "Schlüsselfertig, 40 WE", bauherr: "BEISPIEL WEG Lindenhof", auftragnehmer: "BEISPIEL Bauträger GmbH", rolle_an: "Bauträger", vertragsart: "BGB", datum: vor(5, 5), datumsart: "Abnahme Gemeinschaftseigentum", quelle: "Abnahmeprotokoll BEISPIEL-AZ 003", status: "offen" }),
];
