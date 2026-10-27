/**
 * Automatischer Import: CSV-Dateien, die der Wochen-Task in <Ordner>/Import ablegt, werden beim Öffnen der App
 * ohne Klick übernommen – mit genau den Regeln der Import-Seite (planeImport):
 *  - Neues wird angelegt, Bekanntes nur ergänzt (leere Felder), nie überschrieben, Status bleibt.
 *  - Fehlerhafte Zeilen (z. B. ohne Quelle) werden übersprungen und gezählt, der Rest der Datei wird übernommen.
 *  - Danach wandert die Datei nach Import/erledigt.
 *
 * Gegen Doppelimport (zwei Personen öffnen die App gleichzeitig, oder das Verschieben scheitert) wird jede Datei
 * vor dem Einlesen in der Einstellung „autoimport_erledigt“ vorgemerkt. Vorgemerkte Dateien werden nie erneut eingelesen.
 */
import { csvZuDatensaetzen } from "./csv";
import { planeImport } from "./abgleich";
import type { ObjektDaten } from "./felder";
import type { Store } from "./store";

export const VORMERK_SCHLUESSEL = "autoimport_erledigt";
const MAX_VORMERKUNGEN = 500;

export interface DateiBericht {
  name: string;
  neu: number;
  ergaenzt: number;
  unveraendert: number;
  /** fehlerhafte Zeilen (z. B. ohne Quelle) – nicht übernommen */
  fehler: number;
  /** als neu angelegt, aber einem bestehenden Eintrag ähnlich – bitte prüfen */
  zuPruefen: number;
  meldung?: string;
}

export interface AutoImportErgebnis {
  dateien: DateiBericht[];
  fehler: string[];
}

export function kannAutoImport(store: Store): boolean {
  return store.modus !== "demo" && !!store.importDateien && !!store.importDateiLesen && !!store.importDateiErledigt;
}

async function vorgemerkt(store: Store): Promise<string[]> {
  const v = await store.einstellung<string[]>(VORMERK_SCHLUESSEL);
  return Array.isArray(v) ? v : [];
}

async function vormerken(store: Store, id: string): Promise<boolean> {
  const liste = await vorgemerkt(store); // frisch gelesen: eine Kollegin könnte die Datei gerade übernommen haben
  if (liste.includes(id)) return false;
  await store.einstellungSetzen(VORMERK_SCHLUESSEL, [...liste, id].slice(-MAX_VORMERKUNGEN));
  return true;
}

async function freigeben(store: Store, id: string): Promise<void> {
  const liste = await vorgemerkt(store);
  await store.einstellungSetzen(
    VORMERK_SCHLUESSEL,
    liste.filter((x) => x !== id),
  );
}

/** Übernimmt alle offenen Import-Dateien (älteste zuerst). Wirft nicht – Fehler stehen im Ergebnis. */
export async function autoImport(store: Store): Promise<AutoImportErgebnis> {
  const ergebnis: AutoImportErgebnis = { dateien: [], fehler: [] };
  if (!kannAutoImport(store)) return ergebnis;

  let dateien;
  try {
    dateien = await store.importDateien!();
  } catch (e) {
    ergebnis.fehler.push(`Import-Ordner: ${(e as Error).message}`);
    return ergebnis;
  }
  dateien = [...dateien].sort((a, b) => a.name.localeCompare(b.name));
  if (!dateien.length) return ergebnis;

  for (const d of dateien) {
    try {
      if (!(await vormerken(store, d.id))) {
        // schon übernommen, nur das Verschieben hatte nicht geklappt → nachholen, nicht erneut einlesen
        await store.importDateiErledigt!(d.id).catch(() => undefined);
        continue;
      }
    } catch (e) {
      ergebnis.fehler.push(`${d.name}: ${(e as Error).message}`);
      continue;
    }

    try {
      const inhalt = await store.importDateiLesen!(d.id);
      const { kopf, zeilen } = csvZuDatensaetzen(inhalt);
      if (!kopf.includes("Projekt")) {
        await freigeben(store, d.id);
        ergebnis.fehler.push(`${d.name}: keine Spalte „Projekt“ – bitte über die Import-Seite prüfen.`);
        continue;
      }
      const bestand = await store.liste();
      const plan = planeImport(bestand, zeilen, kopf, "B");
      const neu = plan.filter((z) => z.aktion === "neu");
      const erg = plan.filter((z) => z.aktion === "ergaenzen" && z.zielId !== null);
      if (neu.length) await store.anlegenViele(neu.map((z) => z.daten));
      if (erg.length) {
        const liste = erg.map((z) => ({ id: z.zielId!, patch: z.ergaenzungen as Partial<ObjektDaten> }));
        if (store.aendernViele) await store.aendernViele(liste);
        else for (const x of liste) await store.aendern(x.id, x.patch);
      }
      const bericht: DateiBericht = {
        name: d.name,
        neu: neu.length,
        ergaenzt: erg.length,
        unveraendert: plan.filter((z) => z.aktion === "unveraendert").length,
        fehler: plan.filter((z) => z.aktion === "fehler").length,
        zuPruefen: neu.filter((z) => z.treffer === "schwach").length,
      };
      try {
        await store.importDateiErledigt!(d.id);
      } catch (e) {
        bericht.meldung = `übernommen, aber nicht nach „erledigt“ verschoben: ${(e as Error).message}`;
      }
      ergebnis.dateien.push(bericht);
    } catch (e) {
      // nichts (oder nur teilweise) übernommen → Vormerkung lösen, damit die Datei sichtbar bleibt und erneut versucht wird
      await freigeben(store, d.id).catch(() => undefined);
      ergebnis.fehler.push(`${d.name}: ${(e as Error).message}`);
    }
  }
  return ergebnis;
}

/** Kurztext für das Hinweisband */
export function berichtText(e: AutoImportErgebnis): string {
  const teile = e.dateien.map((d) => {
    const z = [`${d.neu} neu`, `${d.ergaenzt} ergänzt`];
    if (d.zuPruefen) z.push(`${d.zuPruefen} ähnlich zu Bestehendem – bitte prüfen`);
    if (d.fehler) z.push(`${d.fehler} Zeile(n) fehlerhaft, nicht übernommen`);
    return `${d.name}: ${z.join(", ")}${d.meldung ? ` (${d.meldung})` : ""}`;
  });
  return [...teile, ...e.fehler.map((f) => `Fehler – ${f}`)].join(" · ");
}
