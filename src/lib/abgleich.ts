/**
 * Import-Abgleich: CSV-Zeilen → Aktionen (neu / ergänzen / unverändert / prüfen / Fehler).
 *
 * Regeln (aus dem Wochen-Task übernommen):
 *  - Bestehende Einträge werden nur ERGÄNZT (leere Felder füllen), nie überschrieben.
 *  - Status wird nie überschrieben (Nutzer-Statusänderungen haben Vorrang).
 *  - Abweichende Werte in bereits gefüllten Feldern → „Konflikt“, wird angezeigt, nicht übernommen.
 *  - Bemerkungen werden angehängt, wenn der Text noch nicht enthalten ist.
 *  - Abgleich nur innerhalb derselben Spur. Ein Marktradar-Eintrag wird nie in ein Register-Objekt gemischt.
 *  - Spur B ohne Quelle wird abgelehnt (Quellenzwang).
 */
import { FELDER, type Feld, type Objekt, type ObjektDaten, type Spur, leeresObjekt, normBezugsart, normGroesse, normKonfidenz, normVertragsart, pruefe } from "./felder";
import { istGueltigeDatumsangabe } from "./fristen";

export type Aktion = "neu" | "ergaenzen" | "unveraendert" | "ueberspringen" | "fehler";

export interface ImportZeile {
  nr: number;
  daten: ObjektDaten;
  vorschlag: Aktion;
  aktion: Aktion;
  zielId: number | null;
  /** starke Übereinstimmung (automatisch zugeordnet) oder nur Ähnlichkeit (bitte prüfen) */
  treffer: "stark" | "schwach" | null;
  kandidaten: { id: number; projekt: string; ort: string; score: number }[];
  ergaenzungen: Partial<Record<Feld, string>>;
  konflikte: Partial<Record<Feld, { alt: string; neu: string }>>;
  meldungen: string[];
}

// ------------------------------------------------------------------ Spaltenzuordnung

const ALIAS = new Map<string, Feld>();
for (const f of FELDER) for (const c of f.csv) ALIAS.set(c.toLowerCase(), f.key);

export function feldFuerSpalte(spalte: string): Feld | null {
  return ALIAS.get(spalte.trim().toLowerCase()) ?? null;
}

/** Wandelt eine CSV-Zeile (Register-, Marktradar- oder Rohimport-Schema) in ObjektDaten um. */
export function zeileZuObjekt(z: Record<string, string>, spur: Spur, kopf: string[]): { daten: ObjektDaten; meldungen: string[] } {
  const o = leeresObjekt(spur);
  const meldungen: string[] = [];
  o.status = "";
  o.region = "";
  const extras: string[] = [];
  for (const [spalte, wert] of Object.entries(z)) {
    const v = (wert ?? "").trim();
    if (!v) continue;
    const f = feldFuerSpalte(spalte);
    if (f) {
      if (f === "bemerkung" && o.bemerkung) o.bemerkung += ` | ${v}`;
      else (o as unknown as Record<string, string>)[f] = v;
    } else if (spalte === "_Quelldatei") extras.push(`Import aus ${v}`);
    else if (spalte === "_Fundstellen") extras.push(`Fundstellen: ${v}`);
    else if (spalte === "_Pruefbedarf") extras.push(`Prüfbedarf: ${v}`);
  }
  if (extras.length) o.bemerkung = [o.bemerkung, ...extras].filter(Boolean).join(" | ");

  // Region: Marktradar-CSVs haben keine Region-Spalte, sind aber per Definition Rhein-Main.
  if (!kopf.some((h) => feldFuerSpalte(h) === "region")) o.region = "Rhein-Main";
  if (!o.status) o.status = spur === "A" ? "offen" : "Kandidat";

  o.vertragsart = normVertragsart(o.vertragsart);
  o.bezugsart = normBezugsart(o.bezugsart, spur);
  o.projektgroesse = normGroesse(o.projektgroesse);
  const konf = normKonfidenz(o.konfidenz);
  if (o.konfidenz && !konf) meldungen.push(`Konfidenz „${o.konfidenz}“ unbekannt – leer gelassen.`);
  o.konfidenz = konf;
  if (spur === "B" && o.bezugsart === "abnahme") {
    o.bezugsart = "fertigstellung";
    meldungen.push("„Abnahme“ in Spur B nicht zulässig – als Fertigstellung übernommen.");
  }
  for (const k of ["datum", "fristende"] as const) {
    if (o[k] && !istGueltigeDatumsangabe(o[k])) {
      meldungen.push(`${k === "datum" ? "Datum" : "Fristende"} „${o[k]}“ unlesbar – leer gelassen und in Bemerkung vermerkt.`);
      o.bemerkung = [o.bemerkung, `${k === "datum" ? "Datum" : "Fristende"} im Import unlesbar: ${o[k]}`].filter(Boolean).join(" | ");
      o[k] = "";
    }
  }
  return { daten: o, meldungen };
}

// ------------------------------------------------------------------ Ähnlichkeit

const STOPP = new Set(
  "neubau umbau sanierung erweiterung erweiterungsbau der die das und in im am an des den dem mit fuer von zu zur zum ba bauabschnitt gmbh co kg ag mbh e v vorm".split(" "),
);

export function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(projekt: string, ort: string): Set<string> {
  const ortTok = new Set(norm(ort).split(" "));
  return new Set(norm(projekt).split(" ").filter((t) => t.length > 1 && !STOPP.has(t) && !ortTok.has(t)));
}

export function normUrl(u: string): string {
  return (u ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[#?].*$/, "").replace(/\/+$/, "");
}

function ortKern(ort: string): string {
  return norm(ort).split(" ")[0] ?? "";
}

export function aehnlichkeit(a: { projekt: string; ort: string }, b: { projekt: string; ort: string }): number {
  const ta = tokens(a.projekt, a.ort);
  const tb = tokens(b.projekt, b.ort);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function vergleiche(neu: ObjektDaten, alt: Pick<Objekt, "projekt" | "ort" | "quelle">): { score: number; stark: boolean } {
  const gleicherOrt = ortKern(neu.ort) !== "" && ortKern(neu.ort) === ortKern(alt.ort);
  const exakt = norm(neu.projekt) === norm(alt.projekt) || [...tokens(neu.projekt, neu.ort)].sort().join(" ") === [...tokens(alt.projekt, alt.ort)].sort().join(" ");
  const score = aehnlichkeit(neu, alt);
  const gleicheUrl = normUrl(neu.quelle) !== "" && normUrl(neu.quelle) === normUrl(alt.quelle);
  const stark = (exakt && (gleicherOrt || !neu.ort || !alt.ort)) || (gleicherOrt && score >= 0.6) || (gleicheUrl && gleicherOrt && score > 0);
  return { score: exakt ? 1 : score, stark };
}

// ------------------------------------------------------------------ Merge

const NIE_UEBERSCHREIBEN: Feld[] = ["spur", "status"];

function gleich(a: string, b: string) {
  return norm(a) === norm(b);
}

export function merge(alt: ObjektDaten, neu: ObjektDaten): { ergaenzungen: Partial<Record<Feld, string>>; konflikte: Partial<Record<Feld, { alt: string; neu: string }>> } {
  const ergaenzungen: Partial<Record<Feld, string>> = {};
  const konflikte: Partial<Record<Feld, { alt: string; neu: string }>> = {};
  for (const f of FELDER) {
    const k = f.key;
    if (NIE_UEBERSCHREIBEN.includes(k)) continue;
    const a = String(alt[k] ?? "").trim();
    const n = String(neu[k] ?? "").trim();
    if (!n) continue;
    // Standardwerte des Imports ("unklar", Default-Bezugsart) füllen keine Lücken und erzeugen keine Konflikte
    if (k === "vertragsart" && n === "unklar") continue;
    if (k === "bezugsart" && a) {
      if (a !== n) konflikte[k] = { alt: a, neu: n };
      continue;
    }
    if (k === "bemerkung") {
      if (!a) ergaenzungen[k] = n;
      else if (!norm(a).includes(norm(n))) ergaenzungen[k] = `${a} | ${n}`;
      continue;
    }
    if (!a || (k === "vertragsart" && a === "unklar")) ergaenzungen[k] = n;
    else if (!gleich(a, n)) konflikte[k] = { alt: a, neu: n };
  }
  return { ergaenzungen, konflikte };
}

// ------------------------------------------------------------------ Plan

export function planeImport(bestand: Objekt[], zeilen: Record<string, string>[], kopf: string[], spur: Spur): ImportZeile[] {
  const plan: ImportZeile[] = [];
  const gleicheSpur = bestand.filter((b) => b.spur === spur && !b.archiviert);
  const andereSpur = bestand.filter((b) => b.spur !== spur && !b.archiviert);

  zeilen.forEach((z, i) => {
    const { daten, meldungen } = zeileZuObjekt(z, spur, kopf);
    const zeile: ImportZeile = { nr: i + 2, daten, vorschlag: "neu", aktion: "neu", zielId: null, treffer: null, kandidaten: [], ergaenzungen: {}, konflikte: {}, meldungen };

    const { fehler, hinweise } = pruefe(daten);
    if (daten.projekt.startsWith("BEISPIELZEILE")) fehler.push("Vorlagenzeile – nicht importiert.");
    if (fehler.length) {
      zeile.vorschlag = zeile.aktion = "fehler";
      zeile.meldungen.push(...fehler);
      plan.push(zeile);
      return;
    }
    zeile.meldungen.push(...hinweise);

    // Dublette innerhalb der Datei?
    const frueher = plan.find((p) => p.aktion !== "fehler" && vergleiche(daten, p.daten).stark);
    if (frueher) {
      zeile.vorschlag = zeile.aktion = "ueberspringen";
      zeile.meldungen.push(`Doppelt in der Datei (wie Zeile ${frueher.nr}).`);
      plan.push(zeile);
      return;
    }

    const bewertet = gleicheSpur
      .map((b) => ({ b, ...vergleiche(daten, b) }))
      .filter((x) => x.stark || x.score >= 0.34)
      .sort((x, y) => Number(y.stark) - Number(x.stark) || y.score - x.score);
    zeile.kandidaten = bewertet.slice(0, 3).map((x) => ({ id: x.b.id, projekt: x.b.projekt, ort: x.b.ort, score: Math.round(x.score * 100) / 100 }));

    const stark = bewertet.find((x) => x.stark);
    if (stark) {
      zeile.treffer = "stark";
      zeile.zielId = stark.b.id;
      const m = merge(stark.b, daten);
      zeile.ergaenzungen = m.ergaenzungen;
      zeile.konflikte = m.konflikte;
      zeile.vorschlag = zeile.aktion = Object.keys(m.ergaenzungen).length ? "ergaenzen" : "unveraendert";
      if (Object.keys(m.konflikte).length) zeile.meldungen.push(`${Object.keys(m.konflikte).length} abweichende Werte – bestehende Werte bleiben, bitte prüfen.`);
    } else if (bewertet.length) {
      zeile.treffer = "schwach";
      zeile.meldungen.push(`Ähnlich zu „${bewertet[0].b.projekt}“ – als neu vorgeschlagen, bitte prüfen.`);
    }

    const quer = andereSpur.find((b) => vergleiche(daten, b).stark);
    if (quer) zeile.meldungen.push(`Hinweis: existiert auch im ${spur === "A" ? "Marktradar" : "Register"} (#${quer.id}). Wird nicht vermischt.`);
    plan.push(zeile);
  });
  return plan;
}

/** Ergänzungen für eine manuell gewählte Zuordnung neu berechnen */
export function planeZuordnung(zeile: ImportZeile, ziel: Objekt | null): ImportZeile {
  if (!ziel) return { ...zeile, zielId: null, aktion: "neu", ergaenzungen: {}, konflikte: {} };
  const m = merge(ziel, zeile.daten);
  return { ...zeile, zielId: ziel.id, aktion: Object.keys(m.ergaenzungen).length ? "ergaenzen" : "unveraendert", ergaenzungen: m.ergaenzungen, konflikte: m.konflikte };
}
