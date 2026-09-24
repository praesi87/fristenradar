import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { berechne, plusJahre, plusMonate, tageZwischen, parseDatum, istGueltigeDatumsangabe, ampel } from "../src/lib/fristen";
import { csvZuDatensaetzen } from "../src/lib/csv";

/** Erwartungswerte aus den Python-Originalen (tools/golden.py) */
const golden = JSON.parse(readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf-8"));
const register = csvZuDatensaetzen(readFileSync(new URL("./fixtures/golden-register.csv", import.meta.url), "utf-8")).zeilen;

describe("Fristlogik = build_dashboard.py", () => {
  for (const [stichtag, erwartet] of Object.entries(golden.dashboard as Record<string, Record<string, unknown>[]>)) {
    it(`Stichtag ${stichtag}`, () => {
      for (const soll of erwartet) {
        const z = register.find((r) => r.Projekt === soll.Projekt)!;
        const f = berechne({ vertragsart: z.Vertragsart, datum: z["Abnahme/Fertigstellung"], fristende: z.Fristende, region: z.Region }, stichtag);
        const ist = {
          Projekt: soll.Projekt,
          abnahme: f.abnahme ?? "",
          genauigkeit: f.genauigkeit,
          art: f.art,
          fest: f.fest ?? "",
          f4: f.f4 ?? "",
          f5: f.f5 ?? "",
          fristende: f.fristende ?? "",
          tage: f.tage,
          im_fenster: f.imFenster,
          abgelaufen: f.abgelaufen,
          teilweise_abgelaufen: f.teilweiseAbgelaufen,
          rheinmain: f.rheinMain,
        };
        expect(ist).toEqual(soll);
      }
    });
  }
});

describe("Priorisierung = marktradar.py (Vertragsart unklar)", () => {
  for (const [stichtag, erwartet] of Object.entries(golden.marktradar as Record<string, Record<string, unknown>[]>)) {
    it(`Stichtag ${stichtag}`, () => {
      for (const soll of erwartet) {
        const f = berechne({ vertragsart: "unklar", datum: soll.datum as string, bezugsart: soll.bezugsart as string, projektgroesse: soll.projektgroesse as string }, stichtag);
        expect({
          Abnahme_geschaetzt: f.abnahme,
          Fristende_frueh: f.frueh,
          Fristende_spaet: f.spaet,
          Tage_bis_frueh: f.tageBisFrueh,
          Ansprachefenster: f.ansprachefenster,
          Prioritaet: f.prioritaet,
        }).toEqual({
          Abnahme_geschaetzt: soll.Abnahme_geschaetzt,
          Fristende_frueh: soll.Fristende_frueh,
          Fristende_spaet: soll.Fristende_spaet,
          Tage_bis_frueh: soll.Tage_bis_frueh,
          // Bewusste Korrektur: marktradar.py nennt auch bei Prio 5 (beide Fristen abgelaufen)
          // „nur noch BGB-Fall denkbar“ – das ist dann falsch. Hier heißt es schlicht „abgelaufen“.
          Ansprachefenster: soll.Prioritaet === 5 ? "abgelaufen" : soll.Ansprachefenster,
          Prioritaet: soll.Prioritaet,
        });
      }
    });
  }
});

describe("Datumsarithmetik", () => {
  it("29.02. + 4 J. = 29.02., + 5 J. = 28.02. (§ 188 III BGB)", () => {
    expect(plusJahre("2020-02-29", 4)).toBe("2024-02-29");
    expect(plusJahre("2020-02-29", 5)).toBe("2025-02-28");
  });
  it("Monatsaddition klemmt auf Monatsende", () => {
    expect(plusMonate("2026-08-31", 6)).toBe("2027-02-28");
    expect(plusMonate("2026-01-31", 1)).toBe("2026-02-28");
    expect(plusMonate("2026-11-15", -12)).toBe("2025-11-15");
  });
  it("Tagesdifferenz über Zeitumstellung", () => {
    expect(tageZwischen("2026-03-28", "2026-03-30")).toBe(2);
    expect(tageZwischen("2026-10-24", "2026-10-26")).toBe(2);
  });
  it("Formate", () => {
    expect(parseDatum("2022-12")).toEqual({ datum: "2022-12-01", genauigkeit: "Monat" });
    expect(parseDatum("2022")).toEqual({ datum: null, genauigkeit: "Jahr" });
    expect(parseDatum("2022-02-30").datum).toBeNull();
    expect(istGueltigeDatumsangabe("2022-13")).toBe(false);
    expect(istGueltigeDatumsangabe("")).toBe(true);
  });
  it("Ampel", () => {
    expect([ampel(-1), ampel(0), ampel(90), ampel(91), ampel(182), ampel(183), ampel(null)]).toEqual(["past", "crit", "crit", "warn", "warn", "ok", "past"]);
  });
});

describe("Priorisierung bei bekannter Vertragsart (bewusste Erweiterung ggü. marktradar.py)", () => {
  it("BGB belegt: VOB-Fall spielt keine Rolle", () => {
    const f = berechne({ vertragsart: "BGB", datum: "2021-12-01" }, "2026-09-24");
    expect(f.frueh).toBe("2026-12-01");
    expect(f.prioritaet).toBe(3);
  });
  it("VOB abgelaufen, BGB offen → Prio 4 nur bei unklarer Vertragsart", () => {
    expect(berechne({ vertragsart: "unklar", datum: "2022-01-17" }, "2026-09-24").prioritaet).toBe(4);
    expect(berechne({ vertragsart: "VOB/B", datum: "2022-01-17" }, "2026-09-24").prioritaet).toBe(5);
  });
});
