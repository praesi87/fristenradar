import { describe, expect, it } from "vitest";
import { SharePointStore, DATEI, leereDaten, objektAendern, objektAnlegen, pruefeDaten } from "../src/lib/sharepoint";
import { leeresObjekt, type ObjektDaten } from "../src/lib/felder";

/** Minimales Graph-Imitat: eine Site, ein Laufwerk, Dateien per Pfad, eTags, If-Match, 403 auf Wunsch. */
function fakeGraph(opt: { verboten?: boolean } = {}) {
  type Item = { id: string; name: string; pfad: string; inhalt: string; etag: number; ordner?: boolean; geaendert: string };
  const items = new Map<string, Item>();
  let n = 0;
  const neuesItem = (pfad: string, inhalt: string, ordner = false): Item => {
    const it: Item = { id: `i${++n}`, name: pfad.split("/").pop()!, pfad, inhalt, etag: 1, ordner, geaendert: new Date().toISOString() };
    items.set(pfad, it);
    return it;
  };
  const anfragen: string[] = [];
  /** wird vor dem nächsten PUT einmal ausgeführt (simuliert gleichzeitiges Speichern eines Kollegen) */
  let dazwischen: (() => void) | null = null;
  const antwort = (status: number, body?: unknown) => new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url).replace("https://graph.microsoft.com/v1.0", ""));
    const methode = init.method ?? "GET";
    anfragen.push(`${methode} ${u}`);
    const h = (init.headers ?? {}) as Record<string, string>;
    if (h.Authorization !== "Bearer TOKEN") return antwort(401);
    if (opt.verboten) return antwort(403, { error: { code: "accessDenied" } });
    const pfadM = u.match(/^\/drives\/DRIVE\/root:\/([^:?]+)(:\/(content|children))?/);
    const itemM = u.match(/^\/drives\/DRIVE\/items\/([^/?]+)(\/(content|children))?/);
    if (pfadM) {
      const pfad = pfadM[1];
      const teil = pfadM[3];
      if (teil === "content" && methode === "PUT") {
        if (dazwischen) {
          const d = dazwischen;
          dazwischen = null;
          d();
        }
        const vorh = items.get(pfad);
        if (u.includes("conflictBehavior=fail") && vorh) return antwort(409);
        if (h["If-Match"] && (!vorh || h["If-Match"] !== `"e${vorh.etag}"`)) return antwort(412);
        if (vorh) {
          vorh.inhalt = String(init.body);
          vorh.etag++;
          return antwort(200, { id: vorh.id });
        }
        return antwort(201, { id: neuesItem(pfad, String(init.body)).id });
      }
      if (teil === "children") {
        if (!items.has(pfad)) return antwort(404);
        const kinder = [...items.values()].filter((i) => i.pfad.startsWith(pfad + "/") && !i.pfad.slice(pfad.length + 1).includes("/"));
        return antwort(200, { value: kinder.map((i) => ({ id: i.id, name: i.name, lastModifiedDateTime: i.geaendert, ...(i.ordner ? { folder: {} } : { file: {} }) })) });
      }
      const it = items.get(pfad);
      return it ? antwort(200, { id: it.id, eTag: `"e${it.etag}"` }) : antwort(404);
    }
    if (itemM) {
      const it = [...items.values()].find((i) => i.id === itemM[1]);
      if (!it) return antwort(404);
      if (itemM[3] === "content") return antwort(200, it.inhalt);
      if (itemM[3] === "children" && methode === "POST") {
        const name = JSON.parse(String(init.body)).name;
        return antwort(201, { id: neuesItem(`${it.pfad}/${name}`, "", true).id });
      }
      if (methode === "PATCH") {
        const ziel = [...items.values()].find((i) => i.id === JSON.parse(String(init.body)).parentReference.id)!;
        items.delete(it.pfad);
        it.pfad = `${ziel.pfad}/${it.name}`;
        items.set(it.pfad, it);
        return antwort(200, { id: it.id });
      }
    }
    return antwort(400, { error: { message: `unerwartet: ${methode} ${u}` } });
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    items,
    anfragen,
    neuesItem,
    datei: () => JSON.parse(items.get(`Ordner/${DATEI}`)!.inhalt),
    setzeDazwischen: (f: () => void) => (dazwischen = f),
  };
}

function store(g: ReturnType<typeof fakeGraph>, email = "p.preuss@claimm.de") {
  return new SharePointStore({
    token: async () => "TOKEN",
    konto: async () => ({ email, name: "Philipp" }),
    anmelden: async () => ({ email, name: "Philipp" }),
    abmelden: async () => {},
    fetch: g.fetch,
    laufwerk: "DRIVE",
    ordner: "/Ordner/",
  });
}

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
