/**
 * Geokodierung über Nominatim (OpenStreetMap) und Entfernungsberechnung.
 *
 * Nominatim-Nutzungsbedingungen (https://operations.osmfoundation.org/policies/nominatim/):
 * max. 1 Anfrage pro Sekunde, Ergebnisse zwischenspeichern, keine Massenabfragen, Quellenangabe.
 * Deshalb: Koordinaten werden in der Datenbank gespeichert und nur neu gesucht, wenn sich die Adresse ändert.
 */

export interface GeoTreffer {
  lat: number;
  lon: number;
  genauigkeit: "adresse" | "ort";
  anzeige: string;
}

export const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** Luftlinie in km (Haversine, Erdradius 6371 km) */
export function entfernungKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Richtung von a nach b in Grad (0 = Nord, im Uhrzeigersinn) */
export function peilung(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const y = Math.sin(r(b.lon - a.lon)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function himmelsrichtung(grad: number): string {
  return ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(grad / 45) % 8];
}

export function routenLink(von: { lat: number; lon: number }, nach: { lat: number; lon: number }): string {
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${von.lat.toFixed(5)}%2C${von.lon.toFixed(5)}%3B${nach.lat.toFixed(5)}%2C${nach.lon.toFixed(5)}`;
}

/** Adresstexte wie „(Straße nicht genannt)“ oder „ehem. …“ taugen nicht als Straße. */
export function brauchbareStrasse(adresse: string): string {
  const a = (adresse ?? "").trim();
  if (!a || a.startsWith("(") || /nicht (in quelle )?genannt|ehem\.|gelände|werksgelände/i.test(a)) return "";
  // „Thaerstraße 6–12 / Jonas-Schmidt-Straße 1–5“ → erster Teil; „17–21“ → „17“
  return a.split(/\s*[/;]\s*/)[0].replace(/(\d+)\s*[–-]\s*\d+/, "$1").replace(/\s*\+\s*\d+/, "");
}

export function ortOhneZusatz(ort: string): string {
  return (ort ?? "").replace(/\s*\(.*?\)\s*/g, " ").trim();
}

/** Suchtext, der die Koordinaten eindeutig bestimmt (für den Änderungsvergleich) */
export function geoAbfrage(o: { adresse: string; plz: string; ort: string }): string {
  return [brauchbareStrasse(o.adresse), o.plz.trim(), ortOhneZusatz(o.ort)].filter(Boolean).join(", ");
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

let letzteAnfrage = 0;
async function warteTakt() {
  const warten = letzteAnfrage + 1100 - Date.now();
  if (warten > 0) await new Promise((r) => setTimeout(r, warten));
  letzteAnfrage = Date.now();
}

async function suche(params: Record<string, string>, f: Fetch): Promise<Record<string, string>[]> {
  await warteTakt();
  const q = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "de", "accept-language": "de", ...params });
  const res = await f(`${NOMINATIM}?${q}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Adresssuche fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as Record<string, string>[];
}

/** Sucht erst die genaue Adresse, dann PLZ + Ort, dann nur den Ort. */
export async function geokodiere(o: { adresse: string; plz: string; ort: string }, f: Fetch = fetch): Promise<GeoTreffer | null> {
  const strasse = brauchbareStrasse(o.adresse);
  const ort = ortOhneZusatz(o.ort);
  if (!ort && !o.plz.trim()) return null;
  const versuche: { p: Record<string, string>; g: GeoTreffer["genauigkeit"] }[] = [];
  if (strasse && /\d/.test(strasse)) versuche.push({ p: { street: strasse, postalcode: o.plz.trim(), city: ort }, g: "adresse" });
  if (strasse) versuche.push({ p: { street: strasse, city: ort }, g: "adresse" });
  if (o.plz.trim()) versuche.push({ p: { postalcode: o.plz.trim(), city: ort }, g: "ort" });
  if (ort) versuche.push({ p: { city: ort }, g: "ort" });
  for (const v of versuche) {
    const p = Object.fromEntries(Object.entries(v.p).filter(([, x]) => x));
    const t = await suche(p, f);
    if (t.length) return { lat: Number(t[0].lat), lon: Number(t[0].lon), genauigkeit: v.g, anzeige: t[0].display_name ?? "" };
  }
  return null;
}

/** Freitextsuche (z. B. für die Büroadresse) */
export async function geokodiereText(text: string, f: Fetch = fetch): Promise<GeoTreffer | null> {
  const t = await suche({ q: text }, f);
  return t.length ? { lat: Number(t[0].lat), lon: Number(t[0].lon), genauigkeit: "adresse", anzeige: t[0].display_name ?? "" } : null;
}
