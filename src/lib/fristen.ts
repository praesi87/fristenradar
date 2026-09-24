/**
 * Fristenlogik – 1:1-Port von tools/legacy/build_dashboard.py (Register/Dashboard)
 * und tools/legacy/marktradar.py (Priorisierung/Ansprachefenster).
 * Golden-Tests in tests/fristen.test.ts prüfen die Übereinstimmung mit den Python-Originalen.
 *
 * Fristlauf analog §§ 187 I, 188 II BGB: Ablauf am Kalendertag, der dem Abnahmetag entspricht.
 *   4 Jahre = VOB/B § 13 Abs. 4      5 Jahre = BGB § 634a Abs. 1 Nr. 2
 *   Existiert der Tag im Zieljahr nicht (29.02.), gilt der 28.02. (§ 188 III BGB).
 * Vertragsart "VOB/B" -> 4 J.; "BGB" -> 5 J.; "unklar" -> beide Szenarien.
 * Ein manuell gepflegtes Fristende hat Vorrang (Sonderfristen, Hemmung, Verjährungsverzicht).
 * Datum "JJJJ-MM" (nur Monat bekannt) -> 1. des Monats, Genauigkeit "Monat"; "JJJJ" -> nicht berechenbar.
 */

export type Art = "VOB" | "BGB" | "unklar";
export type Genauigkeit = "Tag" | "Monat" | "Jahr" | "–";

export const HORIZONT_MONATE = 6;
export const KRITISCH_TAGE = 90;
export const WARN_TAGE = 182;
/** Zuschlag -> Abnahme, grobe Erfahrungswerte (marktradar.py) */
export const BAUZEIT_MONATE: Record<string, number> = { klein: 12, mittel: 24, gross: 36 };
/** sinnvolles Ansprachefenster in Tagen vor dem frühesten Fristablauf (marktradar.py) */
export const VORLAUF_MIN = 90;
export const VORLAUF_MAX = 550;

// ------------------------------------------------------------------ Datum (ISO-Strings, zeitzonenfrei)

const pad = (n: number, l = 2) => String(n).padStart(l, "0");
export const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function istSchaltjahr(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function tageImMonat(y: number, m: number) {
  return [31, istSchaltjahr(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
function teile(s: string): [number, number, number] {
  return [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
}

export function istGueltigesDatum(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = teile(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= tageImMonat(y, m);
}

/** Erlaubte Eingabeformate: "", "JJJJ", "JJJJ-MM", "JJJJ-MM-TT" */
export function istGueltigeDatumsangabe(s: string): boolean {
  const t = (s ?? "").trim();
  if (t === "" || /^\d{4}$/.test(t)) return true;
  if (/^\d{4}-\d{2}$/.test(t)) {
    const m = Number(t.slice(5, 7));
    return m >= 1 && m <= 12;
  }
  return istGueltigesDatum(t);
}

export function parseDatum(s: string | null | undefined): { datum: string | null; genauigkeit: Genauigkeit } {
  const t = (s ?? "").trim();
  if (t.length === 10 && istGueltigesDatum(t)) return { datum: t, genauigkeit: "Tag" };
  if (t.length === 7 && istGueltigeDatumsangabe(t)) return { datum: `${t}-01`, genauigkeit: "Monat" };
  if (t.length === 4 && /^\d{4}$/.test(t)) return { datum: null, genauigkeit: "Jahr" };
  return { datum: null, genauigkeit: "–" };
}

export function plusJahre(s: string, j: number): string {
  const [y, m, d] = teile(s);
  const zy = y + j;
  return iso(zy, m, Math.min(d, tageImMonat(zy, m)));
}

export function plusMonate(s: string, n: number): string {
  const [y, m, d] = teile(s);
  const idx = m - 1 + n;
  const zy = y + Math.floor(idx / 12);
  const zm = (((idx % 12) + 12) % 12) + 1;
  return iso(zy, zm, Math.min(d, tageImMonat(zy, zm)));
}

function tagNummer(s: string): number {
  const [y, m, d] = teile(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Tage von a bis b (b − a) */
export function tageZwischen(a: string, b: string): number {
  return tagNummer(b) - tagNummer(a);
}

/** Heutiges Datum in Europe/Berlin als JJJJ-MM-TT */
export function heute(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function deDatum(s: string | null | undefined): string {
  if (!s) return "–";
  const [y, m, d] = s.split("-");
  return d ? `${d}.${m}.${y}` : m ? `${m}/${y}` : y;
}

export const MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export function monJahr(s: string): string {
  const [y, m] = s.split("-");
  return `${MONATSNAMEN[Number(m) - 1]} ${y}`;
}

// ------------------------------------------------------------------ Berechnung

export interface FristEingabe {
  vertragsart?: string;
  datum?: string;
  fristende?: string;
  bezugsart?: string; // "abnahme" | "fertigstellung" | "zuschlag"
  projektgroesse?: string;
  region?: string;
}

export interface Fristen {
  /** Fristbeginn (bei Zuschlag: geschätzt) */
  abnahme: string | null;
  abnahmeGeschaetzt: boolean;
  genauigkeit: Genauigkeit;
  art: Art;
  fest: string | null;
  f4: string | null;
  f5: string | null;
  /** alle in Betracht kommenden Fristenden */
  kandidaten: string[];
  /** maßgebliches Fristende für Sortierung/Resttage */
  fristende: string | null;
  tage: number | null;
  imFenster: boolean;
  abgelaufen: boolean;
  teilweiseAbgelaufen: boolean;
  rheinMain: boolean;
  /** Akquise-Sicht (marktradar.py) */
  frueh: string | null;
  spaet: string | null;
  tageBisFrueh: number | null;
  prioritaet: 1 | 2 | 3 | 4 | 5 | null;
  ansprachefenster: string;
}

export function artAus(vertragsart: string | undefined): Art {
  const v = (vertragsart ?? "").toUpperCase();
  return v.includes("VOB") ? "VOB" : v.includes("BGB") ? "BGB" : "unklar";
}

export function istRheinMain(region: string | undefined): boolean {
  return (region ?? "").toLowerCase().replace(/[-\s]/g, "") === "rheinmain";
}

export function fensterEnde(stichtag: string, monate = HORIZONT_MONATE): string {
  return plusMonate(stichtag, monate);
}

export function berechne(e: FristEingabe, stichtag: string, horizontMonate = HORIZONT_MONATE): Fristen {
  const bezug = parseDatum(e.datum);
  let abnahme = bezug.datum;
  let abnahmeGeschaetzt = false;
  if (abnahme && (e.bezugsart ?? "").toLowerCase() === "zuschlag") {
    const g = (e.projektgroesse ?? "").toLowerCase();
    abnahme = plusMonate(abnahme, BAUZEIT_MONATE[g] ?? BAUZEIT_MONATE.mittel);
    abnahmeGeschaetzt = true;
  }
  const art = artAus(e.vertragsart);
  const fest = parseDatum(e.fristende).datum;
  const f4 = abnahme ? plusJahre(abnahme, 4) : null;
  const f5 = abnahme ? plusJahre(abnahme, 5) : null;

  let kandidaten: string[];
  let massg: string | null;
  if (fest) {
    kandidaten = [fest];
    massg = fest;
  } else if (art === "VOB") {
    kandidaten = f4 ? [f4] : [];
    massg = f4;
  } else if (art === "BGB") {
    kandidaten = f5 ? [f5] : [];
    massg = f5;
  } else {
    kandidaten = [f4, f5].filter((x): x is string => !!x);
    massg = null;
  }
  if (massg === null && kandidaten.length) {
    const offen = kandidaten.filter((k) => k >= stichtag);
    massg = offen.length ? offen.reduce((a, b) => (a < b ? a : b)) : kandidaten.reduce((a, b) => (a > b ? a : b));
  }
  const tage = massg ? tageZwischen(stichtag, massg) : null;
  const ende = fensterEnde(stichtag, horizontMonate);

  const imFenster = kandidaten.some((k) => stichtag <= k && k <= ende);
  const abgelaufen = kandidaten.length > 0 && kandidaten.every((k) => k < stichtag);
  const teilweiseAbgelaufen = art === "unklar" && kandidaten.length > 0 && kandidaten.some((k) => k < stichtag) && !abgelaufen;

  // Akquise-Sicht: frühestes/spätestes in Betracht kommendes Fristende
  const frueh = kandidaten.length ? kandidaten.reduce((a, b) => (a < b ? a : b)) : null;
  const spaet = kandidaten.length ? kandidaten.reduce((a, b) => (a > b ? a : b)) : null;
  let prioritaet: Fristen["prioritaet"] = null;
  let ansprachefenster = "kein berechenbares Datum";
  let tageBisFrueh: number | null = null;
  if (frueh && spaet) {
    tageBisFrueh = tageZwischen(stichtag, frueh);
    if (tageBisFrueh < 0) {
      const spaetOffen = tageZwischen(stichtag, spaet) > 0;
      prioritaet = spaetOffen ? 4 : 5;
      ansprachefenster = spaetOffen
        ? art === "unklar" && !fest
          ? "abgelaufen (VOB-Fall) – nur noch BGB-Fall denkbar"
          : "abgelaufen"
        : "abgelaufen";
    } else if (tageBisFrueh < VORLAUF_MIN) {
      prioritaet = 3;
      ansprachefenster = "zu knapp für seriöse Begehung";
    } else if (tageBisFrueh <= VORLAUF_MAX) {
      prioritaet = 1;
      ansprachefenster = "jetzt ansprechen";
    } else {
      prioritaet = 2;
      ansprachefenster = "später vormerken";
    }
  }

  return {
    abnahme,
    abnahmeGeschaetzt,
    genauigkeit: bezug.genauigkeit,
    art,
    fest,
    f4,
    f5,
    kandidaten,
    fristende: massg,
    tage,
    imFenster,
    abgelaufen,
    teilweiseAbgelaufen,
    rheinMain: istRheinMain(e.region),
    frueh,
    spaet,
    tageBisFrueh,
    prioritaet,
    ansprachefenster,
  };
}

export type Ampel = "crit" | "warn" | "ok" | "past";
export function ampel(tage: number | null): Ampel {
  if (tage === null || tage < 0) return "past";
  if (tage <= KRITISCH_TAGE) return "crit";
  if (tage <= WARN_TAGE) return "warn";
  return "ok";
}
