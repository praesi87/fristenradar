import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoImport, berichtText, kannAutoImport, VORMERK_SCHLUESSEL } from "../src/lib/autoimport";
import { brauchtPosition, positionenErmitteln } from "../src/lib/autogeo";
import { leeresObjekt, type ObjektDaten } from "../src/lib/felder";
import type { Store } from "../src/lib/store";
import { fakeGraph, store } from "./graph-imitat";

const KOPF =
  "Projekt;Adresse;PLZ;Ort;Region;Leistung/Gewerk;Auftragnehmer;Rolle AN;Vertragsart;Abnahme/Fertigstellung;Datumsart;Bezugsart;Projektgroesse;Fristende;Bauherr;Ansprechpartner Bauherr;Property Manager;Sicherheit;Status;Konfidenz;Quelle;Quelle Titel;Quelle_Datum;Bemerkung";
const zeile = (projekt: string, ort: string, quelle: string, bauherr = "", adresse = "") =>
  `${projekt};${adresse};;${ort};Rhein-Main;;;;unklar;2023-03;Fertigstellung;fertigstellung;mittel;;${bauherr};;;;Kandidat;hoch;${quelle};Titel;2026-10-28;Zitat`;

const kandidat = (p: Partial<ObjektDaten> = {}): ObjektDaten => ({ ...leeresObjekt("B"), projekt: "Kita Test", ort: "Mainz", region: "Rhein-Main", quelle: "https://beispiel.invalid/1", ...p });

function mitImportOrdner() {
  const g = fakeGraph();
  g.neuesItem("Ordner/Import", "", true);
  return g;
}

describe("Auto-Import", () => {
  it("übernimmt neue Zeilen, ergänzt nur leere Felder, lässt Status stehen und verschiebt die Datei", async () => {
    const g = mitImportOrdner();
    const s = store(g);
    const alt = await s.anlegen(kandidat({ projekt: "Kita Jakob-Laubach-Straße", ort: "Mainz", quelle: "https://beispiel.invalid/kita", status: "Brief raus" }));
    const csv = [
      KOPF,
      zeile("Kita Jakob-Laubach-Straße", "Mainz", "https://beispiel.invalid/kita", "Landeshauptstadt Mainz"),
      zeile("Stadtschule Bad Vilbel – Erweiterung", "Bad Vilbel", "https://beispiel.invalid/vilbel", "Wetteraukreis"),
      zeile("Ohne Quelle", "Hanau", ""),
    ].join("\n");
    const datei = g.neuesItem("Ordner/Import/import-marktradar-2026-10-28.csv", csv);

    const e = await autoImport(s);
    expect(e.fehler).toEqual([]);
    expect(e.dateien).toEqual([expect.objectContaining({ name: "import-marktradar-2026-10-28.csv", neu: 1, ergaenzt: 1, fehler: 1 })]);

    const liste = await s.liste();
    expect(liste).toHaveLength(2);
    const ergaenzt = liste.find((o) => o.id === alt.id)!;
    expect(ergaenzt.bauherr).toBe("Landeshauptstadt Mainz");
    expect(ergaenzt.status).toBe("Brief raus");
    expect(liste.find((o) => o.ort === "Bad Vilbel")).toMatchObject({ spur: "B", status: "Kandidat", bauherr: "Wetteraukreis" });

    expect(g.items.has("Ordner/Import/erledigt/import-marktradar-2026-10-28.csv")).toBe(true);
    expect(await s.einstellung<string[]>(VORMERK_SCHLUESSEL)).toEqual([datei.id]);
    expect(berichtText(e)).toMatch(/1 neu, 1 ergänzt, 1 Zeile\(n\) fehlerhaft/);

    // zweiter Lauf: nichts mehr zu tun, keine Dubletten
    expect((await autoImport(s)).dateien).toEqual([]);
    expect(await s.liste()).toHaveLength(2);
  });

  it("schon übernommene Datei, die nicht verschoben werden konnte, wird nicht erneut eingelesen", async () => {
    const g = mitImportOrdner();
    const s = store(g);
    const datei = g.neuesItem("Ordner/Import/import-marktradar-2026-10-21.csv", [KOPF, zeile("Kita X", "Hanau", "https://beispiel.invalid/x")].join("\n"));
    await s.einstellungSetzen(VORMERK_SCHLUESSEL, [datei.id]);
    const e = await autoImport(s);
    expect(e.dateien).toEqual([]);
    expect(await s.liste()).toEqual([]);
    expect(g.items.has("Ordner/Import/erledigt/import-marktradar-2026-10-21.csv")).toBe(true);
  });

  it("Datei ohne Spalte „Projekt“ bleibt liegen und wird gemeldet", async () => {
    const g = mitImportOrdner();
    const s = store(g);
    g.neuesItem("Ordner/Import/kaputt.csv", "Name;Ort\nX;Y\n");
    const e = await autoImport(s);
    expect(e.dateien).toEqual([]);
    expect(e.fehler[0]).toMatch(/kaputt\.csv.*Projekt/);
    expect(g.items.has("Ordner/Import/kaputt.csv")).toBe(true);
    expect(await s.einstellung<string[]>(VORMERK_SCHLUESSEL)).toEqual([]);
  });

  it("mehrere Dateien: älteste zuerst; ohne Import-Ordner kein Fehler", async () => {
    expect(await autoImport(store(fakeGraph()))).toEqual({ dateien: [], fehler: [] });
    const g = mitImportOrdner();
    const s = store(g);
    g.neuesItem("Ordner/Import/import-marktradar-2026-10-28.csv", [KOPF, zeile("Feuerwache Nord", "Hanau", "https://beispiel.invalid/b")].join("\n"));
    g.neuesItem("Ordner/Import/import-marktradar-2026-10-21.csv", [KOPF, zeile("Kita Lamboy", "Hanau", "https://beispiel.invalid/a")].join("\n"));
    const e = await autoImport(s);
    expect(e.dateien.map((d) => d.name)).toEqual(["import-marktradar-2026-10-21.csv", "import-marktradar-2026-10-28.csv"]);
    expect((await s.liste()).map((o) => o.projekt)).toEqual(["Kita Lamboy", "Feuerwache Nord"]);
  });

  it("Demo-Modus importiert nicht", () => {
    expect(kannAutoImport({ modus: "demo" } as Store)).toBe(false);
  });
});

describe("Auto-Fähnchen", () => {
  // Nominatim-Takt (1 Anfrage/s) im Test überspringen: jede Abfrage der Uhr springt 5 s weiter.
  // Die Uhr läuft über alle Tests weiter, weil geo.ts sich die letzte Anfrage modulweit merkt.
  let jetzt = Date.UTC(2026, 9, 28);
  beforeEach(() => {
    vi.spyOn(Date, "now").mockImplementation(() => (jetzt += 5000));
  });
  afterEach(() => vi.restoreAllMocks());

  /** Nominatim-Imitat: findet alles außer Ort „Nirgendwo“ */
  function nominatim() {
    const anfragen: string[] = [];
    const f = async (url: string) => {
      anfragen.push(url);
      const q = new URL(url).searchParams;
      if (q.get("city") === "Nirgendwo") return new Response("[]", { status: 200 });
      return new Response(JSON.stringify([{ lat: "50.1", lon: "8.7", display_name: q.get("city") }]), { status: 200 });
    };
    return { f, anfragen };
  }

  it("setzt Positionen für alle offenen Objekte, merkt sich Fehlschläge und fragt sie nicht erneut", async () => {
    const g = fakeGraph();
    const s = store(g);
    await s.anlegenViele([
      kandidat({ projekt: "Mit Adresse", adresse: "Moltkestraße 3–19", ort: "Darmstadt" }),
      kandidat({ projekt: "Unbekannt", ort: "Nirgendwo" }),
      kandidat({ projekt: "Ohne Ort", ort: "", plz: "" }),
    ]);
    const archiviert = await s.anlegen(kandidat({ projekt: "Archiviert", ort: "Hanau" }));
    await s.aendern(archiviert.id, { archiviert: true });

    const n = nominatim();
    const r = await positionenErmitteln(s, await s.liste(), { fetch: n.f, block: 2 });
    expect(r).toEqual({ gefunden: 1, nichtGefunden: 1, fehler: null });

    const liste = await s.liste();
    expect(liste.find((o) => o.projekt === "Mit Adresse")).toMatchObject({ lat: 50.1, lon: 8.7, geo_genauigkeit: "adresse", geo_abfrage: "Moltkestraße 3, Darmstadt" });
    const unbekannt = liste.find((o) => o.projekt === "Unbekannt")!;
    expect(unbekannt).toMatchObject({ lat: null, geo_abfrage: "Nirgendwo" });
    expect(liste.find((o) => o.projekt === "Archiviert")!.lat).toBeNull();
    expect(liste.filter(brauchtPosition)).toEqual([]);

    // nächster Start: keine neuen Anfragen
    const vorher = n.anfragen.length;
    expect(await positionenErmitteln(s, liste, { fetch: n.f })).toEqual({ gefunden: 0, nichtGefunden: 0, fehler: null });
    expect(n.anfragen.length).toBe(vorher);

    // „erneut suchen“ versucht Fehlschläge noch einmal; geänderte Adresse wird automatisch neu gesucht
    expect((await positionenErmitteln(s, liste, { fetch: n.f, erneut: true })).nichtGefunden).toBe(1);
    await s.aendern(unbekannt.id, { ort: "Hanau" });
    expect(brauchtPosition((await s.liste()).find((o) => o.id === unbekannt.id)!)).toBe(true);
  });

  it("Nominatim nicht erreichbar: bricht ab, speichert bis dahin Gefundenes", async () => {
    const g = fakeGraph();
    const s = store(g);
    await s.anlegenViele([kandidat({ projekt: "Eins", ort: "Hanau" }), kandidat({ projekt: "Zwei", ort: "Mainz" })]);
    let i = 0;
    const f = async () => (++i === 1 ? new Response(JSON.stringify([{ lat: "50", lon: "8" }]), { status: 200 }) : new Response("", { status: 503 }));
    const r = await positionenErmitteln(s, await s.liste(), { fetch: f });
    expect(r.gefunden).toBe(1);
    expect(r.fehler).toMatch(/503/);
    const liste = await s.liste();
    expect(liste.find((o) => o.projekt === "Eins")!.lat).toBe(50);
    expect(brauchtPosition(liste.find((o) => o.projekt === "Zwei")!)).toBe(true);
  });
});
