import { describe, expect, it } from "vitest";
import { leereDaten, objektAendern, objektAnlegen, pruefeDaten } from "../src/lib/sharepoint";
import { DATEI } from "../src/lib/sharepoint";
import { fakeGraph, store } from "./graph-imitat";
import { leeresObjekt, type ObjektDaten } from "../src/lib/felder";

const kandidat = (p: Partial<ObjektDaten> = {}): ObjektDaten => ({ ...leeresObjekt("B"), projekt: "Kita Test", ort: "Mainz", region: "Rhein-Main", quelle: "https://beispiel.invalid/1", ...p });

describe("SharePoint-Datenlogik", () => {
  it("Spur B ohne Quelle wird abgelehnt, Spur bleibt unveränderlich", () => {
    const d = leereDaten();
    expect(() => objektAnlegen(d, kandidat({ quelle: " " }), "a")).toThrow(/Quelle/);
    const o = objektAnlegen(d, kandidat(), "a");
    objektAendern(d, o.id, { spur: "A" } as Partial<ObjektDaten>, "b");
    expect(d.objekte[0].spur).toBe("B");
    expect(() => objektAendern(d, o.id, { quelle: "" }, "b")).toThrow(/Quelle/);
    expect(d.objekte[0].quelle).toBe("https://beispiel.invalid/1"); // fehlgeschlagene Änderung bleibt ohne Wirkung
  });

  it("Historie: wer, wann, alt → neu; Archivieren statt Löschen", () => {
    const d = leereDaten();
    const o = objektAnlegen(d, kandidat(), "a", "2026-10-25T00:00:00Z");
    objektAendern(d, o.id, { bauherr: "Stadt Mainz" }, "b", "2026-10-26T00:00:00Z");
    objektAendern(d, o.id, { bauherr: "Stadt Mainz" }, "c"); // keine Änderung → kein Eintrag
    objektAendern(d, o.id, { archiviert: true }, "b");
    expect(d.historie.map((h) => h.aktion)).toEqual(["angelegt", "geaendert", "archiviert"]);
    expect(d.historie[1]).toMatchObject({ nutzer: "b", aenderungen: { bauherr: { alt: "", neu: "Stadt Mainz" } } });
    expect(d.objekte[0]).toMatchObject({ archiviert: true, geaendert_von: "b", erstellt_von: "a" });
  });

  it("kaputte Datei wird erkannt", () => {
    expect(() => pruefeDaten({ foo: 1 })).toThrow(/beschädigt/);
    expect(pruefeDaten({ version: 1, objekte: [], historie: [] }).naechsteId).toBe(1);
  });
});

describe("SharePointStore gegen Graph-Imitat", () => {
  it("erste Nutzung: leere Liste, beim ersten Speichern wird die Datei angelegt", async () => {
    const g = fakeGraph();
    const s = store(g);
    expect(await s.freigeschaltet()).toBe(true);
    expect(await s.liste()).toEqual([]);
    const o = await s.anlegen(kandidat());
    expect(o).toMatchObject({ id: 1, erstellt_von: "p.preuss@claimm.de" });
    expect(g.datei().objekte).toHaveLength(1);
    expect(g.anfragen.some((a) => a.includes("conflictBehavior=fail"))).toBe(true);
  });

  it("gleichzeitiges Speichern: Änderung des Kollegen bleibt erhalten, eigene wird nachgezogen", async () => {
    const g = fakeGraph();
    const ich = store(g);
    const kollege = store(g, "kollege@claimm.de");
    await ich.anlegen(kandidat());
    // Während ich speichere, speichert der Kollege dazwischen (→ eTag veraltet → 412 → neu lesen)
    g.setzeDazwischen(() => {
      const it = g.items.get(`Ordner/${DATEI}`)!;
      const d = JSON.parse(it.inhalt);
      d.objekte[0].ansprechpartner = "Frau Muster";
      it.inhalt = JSON.stringify(d);
      it.etag++;
    });
    await ich.aendern(1, { bauherr: "Stadt Mainz" });
    const [o] = await kollege.liste();
    expect(o).toMatchObject({ bauherr: "Stadt Mainz", ansprechpartner: "Frau Muster" });
    expect(g.anfragen.filter((a) => a.startsWith("PUT")).length).toBe(3); // anlegen, Konflikt, Wiederholung
  });

  it("Massenimport und Sammeländerung in je einem Schreibvorgang", async () => {
    const g = fakeGraph();
    const s = store(g);
    await s.anlegenViele([kandidat({ projekt: "A" }), kandidat({ projekt: "B" }), kandidat({ projekt: "C" })]);
    await s.aendernViele([
      { id: 1, patch: { lat: 50, lon: 8 } },
      { id: 3, patch: { bauherr: "X" } },
    ]);
    expect(g.anfragen.filter((a) => a.startsWith("PUT")).length).toBe(2);
    const l = await s.liste();
    expect(l.map((o) => o.projekt)).toEqual(["A", "B", "C"]);
    expect(l[0].lat).toBe(50);
    expect((await s.historie(3)).map((h) => h.aktion)).toEqual(["geaendert", "angelegt"]);
  });

  it("Einstellungen und Austragungen werden gespeichert", async () => {
    const g = fakeGraph();
    const s = store(g);
    await s.einstellungSetzen("buero", { adresse: "X", lat: 1, lon: 2 });
    await s.austragungAnlegen("Muster GmbH", "Widerspruch per Brief");
    expect(await s.einstellung("buero")).toEqual({ adresse: "X", lat: 1, lon: 2 });
    expect((await s.austragungen())[0]).toMatchObject({ id: 1, name: "Muster GmbH", erstellt_von: "p.preuss@claimm.de" });
  });

  it("ohne Recht auf den Ordner: nicht freigeschaltet, keine Daten", async () => {
    const s = store(fakeGraph({ verboten: true }));
    expect(await s.freigeschaltet()).toBe(false);
    await expect(s.liste()).rejects.toThrow(/keine Berechtigung/);
  });

  it("Import-Ordner: CSV-Dateien listen, lesen (BOM entfernt), nach erledigt verschieben", async () => {
    const g = fakeGraph();
    g.neuesItem("Ordner/Import", "", true);
    const csv = g.neuesItem("Ordner/Import/import-marktradar-2026-10-28.csv", "﻿Projekt;Ort\nKita;Mainz\n");
    g.neuesItem("Ordner/Import/notiz.txt", "x");
    const s = store(g);
    const dateien = await s.importDateien();
    expect(dateien.map((d) => d.name)).toEqual(["import-marktradar-2026-10-28.csv"]);
    expect(await s.importDateiLesen(csv.id)).toBe("Projekt;Ort\nKita;Mainz\n");
    await s.importDateiErledigt(csv.id);
    expect(await s.importDateien()).toEqual([]);
    expect(g.items.has("Ordner/Import/erledigt/import-marktradar-2026-10-28.csv")).toBe(true);
  });

  it("kein Import-Ordner vorhanden → leere Liste statt Fehler", async () => {
    expect(await store(fakeGraph()).importDateien()).toEqual([]);
  });
});
