/**
 * Automatische Positionen (Fähnchen): Objekte ohne Koordinaten werden über Nominatim gesucht und gespeichert.
 * Läuft nach jedem Import und beim Öffnen der App im Hintergrund – für ALLE nicht archivierten Objekte,
 * unabhängig von Filter oder 6-Monats-Fenster.
 *
 * Nominatim-Regeln: max. 1 Anfrage/s (geo.ts taktet). Damit nicht bei jedem Öffnen dieselben erfolglosen Suchen
 * wiederholt werden, wird auch ein Fehlschlag gespeichert (geo_abfrage = Suchtext, lat/lon leer). Ändert sich die
 * Adresse, ändert sich der Suchtext – dann wird automatisch neu gesucht.
 */
import type { Objekt, ObjektDaten } from "./felder";
import { geoAbfrage, geokodiere, type GeoTreffer } from "./geo";
import type { Store } from "./store";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Muss für dieses Objekt (noch) eine Position gesucht werden? */
export function brauchtPosition(o: Objekt): boolean {
  if (o.archiviert) return false;
  if (o.lat !== null && o.lon !== null) return false;
  const q = geoAbfrage(o);
  if (!q) return false;
  return o.geo_abfrage !== q; // gleicher Suchtext schon erfolglos versucht → nicht erneut
}

export interface GeoErgebnis {
  gefunden: number;
  nichtGefunden: number;
  fehler: string | null;
}

export interface GeoOptionen {
  fetch?: Fetch;
  /** Fortschritt für die Anzeige */
  beiFortschritt?(nr: number, von: number, projekt: string): void;
  /** nach jedem gespeicherten Block (z. B. Karte neu laden, damit Fähnchen nach und nach erscheinen) */
  nachBlock?(): void | Promise<void>;
  /** Abbruch, z. B. beim Abmelden */
  abgebrochen?(): boolean;
  /** wie viele Ergebnisse je Schreibvorgang gespeichert werden */
  block?: number;
  /** auch Objekte erneut suchen, deren gleicher Suchtext schon erfolglos war (manueller Knopf) */
  erneut?: boolean;
}

export async function positionenErmitteln(store: Store, objekte: Objekt[], opt: GeoOptionen = {}): Promise<GeoErgebnis> {
  const offen = objekte.filter((o) => (opt.erneut ? !o.archiviert && o.lat === null && !!geoAbfrage(o) : brauchtPosition(o)));
  const block = opt.block ?? 10;
  const erg: GeoErgebnis = { gefunden: 0, nichtGefunden: 0, fehler: null };
  let puffer: { id: number; patch: Partial<ObjektDaten> }[] = [];

  const speichern = async () => {
    if (!puffer.length) return;
    const liste = puffer;
    puffer = [];
    if (store.aendernViele) await store.aendernViele(liste);
    else for (const x of liste) await store.aendern(x.id, x.patch);
    await opt.nachBlock?.();
  };

  for (let i = 0; i < offen.length; i++) {
    if (opt.abgebrochen?.()) break;
    const o = offen[i];
    opt.beiFortschritt?.(i + 1, offen.length, o.projekt);
    let t: GeoTreffer | null;
    try {
      t = await geokodiere(o, opt.fetch);
    } catch (e) {
      // Nominatim nicht erreichbar oder Takt überschritten: abbrechen, beim nächsten Öffnen geht es weiter
      erg.fehler = (e as Error).message;
      break;
    }
    const q = geoAbfrage(o);
    if (t) {
      puffer.push({ id: o.id, patch: { lat: t.lat, lon: t.lon, geo_genauigkeit: t.genauigkeit, geo_abfrage: q } });
      erg.gefunden++;
    } else {
      puffer.push({ id: o.id, patch: { geo_abfrage: q } });
      erg.nichtGefunden++;
    }
    if (puffer.length >= block) await speichern();
  }
  await speichern();
  return erg;
}
