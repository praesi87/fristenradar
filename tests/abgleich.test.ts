import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { csvZuDatensaetzen, parseCsv, schreibeCsv } from "../src/lib/csv";
import { planeImport, merge, vergleiche, zeileZuObjekt } from "../src/lib/abgleich";
import { leeresObjekt, type Objekt, type ObjektDaten } from "../src/lib/felder";
import { brief } from "../src/lib/brief";
import { berechne } from "../src/lib/fristen";
import { brauchbareStrasse, entfernungKm, geokodiere, geoAbfrage } from "../src/lib/geo";

const golden = JSON.parse(readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf-8"));

function obj(id: number, p: Partial<ObjektDaten>): Objekt {
  return { ...leeresObjekt(p.spur ?? "B"), ...p, id, archiviert: false, erstellt_am: "", erstellt_von: "", geaendert_am: "", geaendert_von: "" } as Objekt;
}

describe("CSV", () => {
  it("Semikolon, Anführungszeichen, Zeilenumbruch im Feld, BOM, CRLF", () => {
    const t = '﻿A;B;C\r\n1;"x; y";"mit ""Zitat"""\r\n2;"zwei\nZeilen";\r\n';
    expect(parseCsv(t)).toEqual([["A", "B", "C"], ["1", "x; y", 'mit "Zitat"'], ["2", "zwei\nZeilen", ""]]);
  });
  it("Rundreise", () => {
    const kopf = ["Projekt", "Bemerkung"];
    const zeilen = [{ Projekt: "A; B", Bemerkung: 'Er sagte "ja"\nund ging' }];
    expect(csvZuDatensaetzen(schreibeCsv(kopf, zeilen)).zeilen).toEqual(zeilen);
  });
  it("Komma-CSV wird erkannt", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("Spaltenzuordnung", () => {
  it("Marktradar-Schema: Bezugsdatum, Hinweis, keine Region-Spalte", () => {
    const kopf = ["Projekt", "Ort", "Bezugsdatum", "Bezugsart", "Quelle", "Hinweis", "Prioritaet"];
    const { daten } = zeileZuObjekt({ Projekt: "X", Ort: "Mainz", Bezugsdatum: "2023-05-04", Bezugsart: "fertigstellung", Quelle: "u", Hinweis: "h", Prioritaet: "1" }, "B", kopf);
    expect(daten.datum).toBe("2023-05-04");
    expect(daten.bemerkung).toBe("h");
    expect(daten.region).toBe("Rhein-Main");
    expect(daten.status).toBe("Kandidat");
  });
  it("Rohimport aus import_abnahmen.py: Prüfbedarf landet in der Bemerkung", () => {
    const kopf = ["Projekt", "Abnahmedatum", "Vertragsart", "Region", "_Quelldatei", "_Pruefbedarf"];
    const { daten } = zeileZuObjekt({ Projekt: "P", Abnahmedatum: "2024-03-12", Vertragsart: "VOB/B", Region: "", _Quelldatei: "a.pdf", _Pruefbedarf: "Teilabnahme erwähnt" }, "A", kopf);
    expect(daten.bezugsart).toBe("abnahme");
    expect(daten.region).toBe("");
    expect(daten.bemerkung).toContain("Prüfbedarf: Teilabnahme erwähnt");
  });
  it("unlesbares Datum wird nicht geraten", () => {
    const { daten, meldungen } = zeileZuObjekt({ Projekt: "P", Quelle: "u", "Abnahme/Fertigstellung": "Frühjahr 2023" }, "B", ["Projekt", "Quelle", "Abnahme/Fertigstellung"]);
    expect(daten.datum).toBe("");
    expect(meldungen.join()).toContain("unlesbar");
  });
});

describe("Abgleich mit Bestand", () => {
  const bestand = [
    obj(1, { projekt: "Kita am Forum – Interims-Kita Frankfurt", ort: "Frankfurt am Main", quelle: "https://www.ochs.eu/holzbauprojekte/kita-am-forum-frankfurt-am-main/", auftragnehmer: "Ochs GmbH, Kirchberg (Hunsrück)", status: "angeschrieben", datum: "2023-02" }),
    obj(2, { projekt: "varisano Klinikum Frankfurt Höchst – Neubau", ort: "Frankfurt am Main", quelle: "https://www.varisano.de/x", auftragnehmer: "" }),
    obj(3, { projekt: "Grimmbogen Hanau – 190 Mietwohnungen", ort: "Hanau", quelle: "https://www.nhw.de/newsroom/news/schluesseluebergabe-fuer-den-grimmbogen" }),
    obj(4, { projekt: "PhilippsTor Hanau – 156 Mietwohnungen", ort: "Hanau", quelle: "https://www.nhw.de/newsroom/news/endspurt-in-hanau-bald-zieht-leben-in-das-philippstor-und-den-grimmbogen" }),
    obj(5, { spur: "A", projekt: "Sporthalle Feldbergschule Mainz – Neubau", ort: "Mainz", quelle: "AZ 1" }),
  ];
  const kopf = ["Projekt", "Ort", "Bauherr", "Auftragnehmer", "Bezugsdatum", "Quelle", "Status"];

  it("gleiche URL + gleicher Ort + gemeinsames Wort → stark, Status bleibt, Ergänzung nur leerer Felder", () => {
    const plan = planeImport(bestand, [{ Projekt: "Kita am Forum", Ort: "Frankfurt am Main", Bauherr: "Kita Frankfurt", Auftragnehmer: "Ochs GmbH", Bezugsdatum: "2023-02-01", Quelle: "https://www.ochs.eu/holzbauprojekte/kita-am-forum-frankfurt-am-main/", Status: "neu - noch nicht angeschrieben" }], kopf, "B");
    expect(plan[0].treffer).toBe("stark");
    expect(plan[0].zielId).toBe(1);
    expect(plan[0].aktion).toBe("ergaenzen");
    expect(plan[0].ergaenzungen.bauherr).toBe("Kita Frankfurt");
    expect(plan[0].ergaenzungen.status).toBeUndefined();
    expect(plan[0].konflikte.auftragnehmer).toBeDefined();
    expect(plan[0].konflikte.datum).toEqual({ alt: "2023-02", neu: "2023-02-01" });
  });
  it("Wortstellung egal (Neubau vorne/hinten)", () => {
    expect(vergleiche({ ...leeresObjekt("B"), projekt: "Neubau varisano Klinikum Frankfurt Höchst", ort: "Frankfurt am Main" }, bestand[1]).stark).toBe(true);
  });
  it("URL, die mehrere Projekte nennt, führt nicht zur falschen Zuordnung", () => {
    const plan = planeImport(bestand, [{ Projekt: "Grimmbogen - Wohnpark Brüder-Grimm-Straße", Ort: "Hanau", Quelle: "https://www.nhw.de/newsroom/news/schluesseluebergabe-fuer-den-grimmbogen", Bauherr: "NHW", Auftragnehmer: "", Bezugsdatum: "2023-06-23", Status: "" }], kopf, "B");
    expect(plan[0].zielId).toBe(3);
  });
  it("keine Vermischung der Spuren", () => {
    const plan = planeImport(bestand, [{ Projekt: "Sporthalle Feldbergschule", Ort: "Mainz", Quelle: "https://x", Bauherr: "", Auftragnehmer: "", Bezugsdatum: "2023-05-15", Status: "" }], kopf, "B");
    expect(plan[0].aktion).toBe("neu");
    expect(plan[0].meldungen.join()).toContain("Register (#5)");
  });
  it("Quellenzwang in Spur B", () => {
    const plan = planeImport([], [{ Projekt: "Ohne Quelle", Ort: "Mainz", Quelle: "", Bauherr: "", Auftragnehmer: "", Bezugsdatum: "", Status: "" }], kopf, "B");
    expect(plan[0].aktion).toBe("fehler");
  });
  it("Dublette innerhalb der Datei", () => {
    const z = { Projekt: "Neue Schule Musterstadt", Ort: "Mainz", Quelle: "https://x", Bauherr: "", Auftragnehmer: "", Bezugsdatum: "", Status: "" };
    const plan = planeImport([], [z, { ...z }], kopf, "B");
    expect(plan.map((p) => p.aktion)).toEqual(["neu", "ueberspringen"]);
  });
  it("Merge: zweite Quelle landet in der Bemerkung, Namensvariante ist kein Konflikt", () => {
    const alt = { ...leeresObjekt("B"), projekt: "A – Neubau", quelle: "https://a.invalid/x", bemerkung: "alt" };
    const neu = { ...leeresObjekt("B"), projekt: "Neubau A", quelle: "https://b.invalid/y" };
    const m = merge(alt, neu);
    expect(m.konflikte).toEqual({});
    expect(m.ergaenzungen.bemerkung).toBe("alt | Weitere Quelle: https://b.invalid/y");
    expect(merge({ ...alt, bemerkung: m.ergaenzungen.bemerkung! }, neu).ergaenzungen.bemerkung).toBeUndefined();
  });
  it("Merge: Bemerkung wird angehängt, unklar füllt keine Vertragsart", () => {
    const alt = { ...leeresObjekt("B"), bemerkung: "alt", vertragsart: "VOB/B" };
    const neu = { ...leeresObjekt("B"), bemerkung: "neu", vertragsart: "unklar" };
    const m = merge(alt, neu);
    expect(m.ergaenzungen.bemerkung).toBe("alt | neu");
    expect(m.ergaenzungen.vertragsart).toBeUndefined();
    expect(m.konflikte.vertragsart).toBeUndefined();
  });
});

describe("Brief = marktradar.py brieftext()", () => {
  for (const g of golden.briefe as { eingabe: Record<string, string>; betreff: string; text: string }[]) {
    it(g.eingabe.Projekt, () => {
      const o: ObjektDaten = { ...leeresObjekt("B"), projekt: g.eingabe.Projekt, ort: g.eingabe.Ort, datum: g.eingabe.Bezugsdatum, bezugsart: g.eingabe.Bezugsart, projektgroesse: g.eingabe.Projektgroesse ?? "", quelle: g.eingabe.Quelle, anrede: g.eingabe.Anrede, leistung: g.eingabe.Leistung, auftragnehmer: g.eingabe.Auftragnehmer, bauherr: "Test" };
      const b = brief(o, "Max Test\nBereichsleitung\nclaim.m GmbH", [], 1);
      expect(b.sperren).toEqual([]);
      expect(b.betreff).toBe(g.betreff);
      // Inhalt wortgleich; Zeilenumbruch bewusst ohne Trennung an Bindestrichen (Python textwrap trennt URLs und Namen)
      const flach = (t: string) => t.replace(/-\n/g, "-").replace(/\s+/g, " ").trim();
      expect(flach(b.text)).toBe(flach(g.text));
      expect(b.text.split("\n\n").length).toBe(g.text.split("\n\n").length);
    });
  }
  it("Sperren: Austragungsliste, fehlende Quelle, Spur A", () => {
    const o: ObjektDaten = { ...leeresObjekt("B"), projekt: "P", ort: "O", datum: "2023-01-01", quelle: "", bauherr: "Muster Wohnbau GmbH" };
    const b = brief(o, "x", [{ name: "Muster Wohnbau" }], berechne(o, "2026-09-24").prioritaet);
    expect(b.sperren.length).toBe(2);
    expect(brief({ ...o, spur: "A", quelle: "q" }, "x", [], 1).sperren.join()).toContain("Spur B");
  });
});

describe("Geo", () => {
  it("Entfernung Frankfurt–Mainz ≈ 36 km Luftlinie", () => {
    const d = entfernungKm({ lat: 50.1109, lon: 8.6821 }, { lat: 49.9929, lon: 8.2473 });
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(38);
  });
  it("Adressbereinigung", () => {
    expect(brauchbareStrasse("(Straße nicht genannt)")).toBe("");
    expect(brauchbareStrasse("Thaerstraße 6–12 / Jonas-Schmidt-Straße 1–5")).toBe("Thaerstraße 6");
    expect(brauchbareStrasse("Gref-Völsing-Straße 17 + 21")).toBe("Gref-Völsing-Straße 17");
    expect(geoAbfrage({ adresse: "Nibelungenplatz 1", plz: "60318", ort: "Wiesbaden (Mainz-Kastel)" })).toBe("Nibelungenplatz 1, 60318, Wiesbaden");
  });
  it("Nominatim: fällt von Adresse auf Ort zurück und hält den Takt", async () => {
    const aufrufe: string[] = [];
    const f = async (url: string) => {
      aufrufe.push(url);
      const leer = url.includes("street=");
      return new Response(JSON.stringify(leer ? [] : [{ lat: "50.1", lon: "8.6", display_name: "Frankfurt" }]), { status: 200 });
    };
    const t0 = Date.now();
    const r = await geokodiere({ adresse: "Gateway Gardens", plz: "60549", ort: "Frankfurt am Main" }, f);
    expect(r).toEqual({ lat: 50.1, lon: 8.6, genauigkeit: "ort", anzeige: "Frankfurt" });
    expect(aufrufe.length).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
  });
});
