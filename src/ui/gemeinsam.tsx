import { useState } from "react";
import type { Objekt } from "../lib/felder";
import { ampel, berechne, type Fristen } from "../lib/fristen";
import { entfernungKm } from "../lib/geo";
import type { Buero } from "../lib/store";

const BASIS = import.meta.env.BASE_URL;

/** claim.m-Logo aus public/ (hell = schwarzer Schriftzug, dunkel = weißer Schriftzug); Fallback: Wortmarke */
export function Logo({ variante }: { variante: "hell" | "dunkel" }) {
  const [fehler, setFehler] = useState(false);
  if (fehler)
    return (
      <span className={`wortmarke wortmarke-${variante}`}>
        claim.<span className="wortmarke-m">m</span>
      </span>
    );
  return <img className="logo" src={`${BASIS}logo-${variante}.png`} alt="claim.m" onError={() => setFehler(true)} />;
}

export interface Zeile {
  o: Objekt;
  f: Fristen;
  km: number | null;
}

export function berechneZeilen(objekte: Objekt[], stichtag: string, buero: Buero | null): Zeile[] {
  return objekte.map((o) => ({
    o,
    f: berechne(o, stichtag),
    km: buero && o.lat !== null && o.lon !== null ? entfernungKm(buero, { lat: o.lat, lon: o.lon }) : null,
  }));
}

export const AMPEL_TEXT = { crit: "≤ 90 Tage", warn: "91–182 Tage", ok: "> 6 Monate", past: "abgelaufen / kein Datum" };

export function resttageText(f: Fristen): string {
  if (f.tage === null) return "kein Datum";
  if (f.tage < 0) return `vor ${-f.tage} T. abgelaufen`;
  return `${f.tage} T.`;
}

export function Ampel({ f }: { f: Fristen }) {
  const a = ampel(f.tage);
  return <span className={`pill pill-${a}`}>{resttageText(f)}</span>;
}

export function kmText(km: number | null): string {
  if (km === null) return "–";
  return `${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km`;
}

/** Öffentliche/kommunale Bauherren grob erkennen (für den Filter, wie im alten Dashboard) */
export const OEFF = /stadt|kreis|landes|land hessen|kommun|hochschule|universit|gebäudewirtschaft|eigenbetrieb|gww|abg |nassauische|gewobau|mag |zeg|lbih|landesbetrieb|gemeinde|magistrat/i;
