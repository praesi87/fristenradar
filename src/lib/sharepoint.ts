/**
 * Datenhaltung in SharePoint (Microsoft 365) über Microsoft Graph – Anmeldung bleibt MSAL (src/lib/auth.ts).
 *
 * Alle Daten liegen in EINER JSON-Datei in einer SharePoint-Dokumentbibliothek:
 *   claim.m-Teamsite / Freigegebene Dokumente / General/Akquise/Fristenradar / fristenradar-daten.json
 * Import-Dateien des Wochen-Tasks liegen daneben in <ORDNER>/Import, übernommene wandern nach Import/erledigt.
 *
 * Schutz: Graph prüft bei JEDEM Zugriff serverseitig, ob die angemeldete Person die Datei lesen/schreiben darf.
 * Wer die Teamsite nicht sieht, bekommt keine Daten – egal, was im (öffentlichen) Code steht.
 * Sicherung: SharePoint führt für Dateien eine Versionshistorie; ältere Stände lassen sich dort wiederherstellen.
 *
 * Gleichzeitiges Bearbeiten: Jede Änderung liest die Datei frisch, wendet die Änderung an und schreibt mit
 * If-Match auf das eTag. Hat jemand zwischendurch gespeichert (HTTP 412), wird neu gelesen und die Änderung
 * erneut angewendet. So geht keine Änderung verloren.
 */
import type { Objekt, ObjektDaten } from "./felder";
import type { Austragung, HistorieEintrag, Store } from "./store";

/** Dokumentbibliothek „Freigegebene Dokumente“ der claim.m-Teamsite (claimmgmbh.sharepoint.com/sites/claim.mGmbH).
 *  Adressierung über die feste Laufwerks-ID statt über den Site-Pfad (der Punkt in „claim.mGmbH“ macht Pfade fehleranfällig). */
export const SP_LAUFWERK_STANDARD = "b!upFaF4jIHkWbvJxP-ZEMhnuaCiDdB85JqMhTfA7b7Jh26K9fPmX-TZPaCdFxI0m4";
export const SP_ANZEIGE = "claimmgmbh.sharepoint.com/sites/claim.mGmbH → Freigegebene Dokumente";
export const SP_ORDNER_STANDARD = "General/Akquise/Fristenradar";
export const DATEI = "fristenradar-daten.json";
const GRAPH = "https://graph.microsoft.com/v1.0";
/** Graph erlaubt beim einfachen Hochladen höchstens 4 MB. */
const MAX_BYTES = 4 * 1024 * 1024 - 64 * 1024;

export interface Daten {
  version: 1;
  naechsteId: number;
  naechsteHistId: number;
  objekte: Objekt[];
  historie: HistorieEintrag[];
  austragungen: Austragung[];
  einstellungen: Record<string, unknown>;
}

export function leereDaten(): Daten {
  return { version: 1, naechsteId: 1, naechsteHistId: 1, objekte: [], historie: [], austragungen: [], einstellungen: {} };
}

export interface ImportDatei {
  id: string;
  name: string;
  geaendert: string;
}

export interface SharePointAbhaengigkeiten {
  /** Zugriffstoken für Microsoft Graph (Scope Sites.ReadWrite.All) */
  token(): Promise<string>;
  konto(): Promise<{ email: string; name: string } | null>;
  anmelden(): Promise<{ email: string; name: string }>;
  abmelden(): Promise<void>;
  fetch?: typeof fetch;
  /** Laufwerks-ID der Dokumentbibliothek (Graph driveId) */
  laufwerk?: string;
  ordner?: string;
}

export class GraphFehler extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ reine Datenlogik (getestet)

/** Prüfregeln wie in supabase/schema.sql: Spur B braucht eine Quelle, Spur ist unveränderlich, Löschen gibt es nicht. */
export function objektAnlegen(d: Daten, o: ObjektDaten, nutzer: string, jetzt = new Date().toISOString()): Objekt {
  if (o.spur !== "A" && o.spur !== "B") throw new Error("Anlegen: Spur muss A oder B sein.");
  if (o.spur === "B" && !String(o.quelle ?? "").trim()) throw new Error("Anlegen: Spur B braucht eine Quelle.");
  const neu: Objekt = { ...o, id: d.naechsteId++, archiviert: false, erstellt_am: jetzt, erstellt_von: nutzer, geaendert_am: jetzt, geaendert_von: nutzer };
  d.objekte.push(neu);
  d.historie.push({ id: d.naechsteHistId++, objekt_id: neu.id, zeitpunkt: jetzt, nutzer, aktion: "angelegt", aenderungen: {} });
  return neu;
}

export function objektAendern(d: Daten, id: number, patch: Partial<ObjektDaten> & { archiviert?: boolean }, nutzer: string, jetzt = new Date().toISOString()): Objekt {
  const o = d.objekte.find((x) => x.id === id);
  if (!o) throw new Error("Speichern: Eintrag nicht gefunden (evtl. von jemand anderem geändert – bitte neu laden).");
  const rec = o as unknown as Record<string, unknown>;
  const vorher = { ...rec };
  const diff: Record<string, { alt: unknown; neu: unknown }> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "spur" || k === "id" || k === "erstellt_am" || k === "erstellt_von") continue;
    if (v === undefined) continue;
    if (rec[k] !== v) diff[k] = { alt: rec[k], neu: v };
    rec[k] = v;
  }
  if (o.spur === "B" && !String(o.quelle ?? "").trim()) {
    Object.assign(rec, vorher);
    throw new Error("Speichern: Spur B braucht eine Quelle.");
  }
  if (Object.keys(diff).length) {
    o.geaendert_am = jetzt;
    o.geaendert_von = nutzer;
    const aktion = "archiviert" in diff ? (o.archiviert ? "archiviert" : "wiederhergestellt") : "geaendert";
    d.historie.push({ id: d.naechsteHistId++, objekt_id: id, zeitpunkt: jetzt, nutzer, aktion, aenderungen: diff });
  }
  return o;
}

export function pruefeDaten(roh: unknown): Daten {
  const d = roh as Partial<Daten> | null;
  if (!d || typeof d !== "object" || d.version !== 1 || !Array.isArray(d.objekte) || !Array.isArray(d.historie)) {
    throw new Error(`${DATEI} ist beschädigt oder hat ein unbekanntes Format. In SharePoint über „Versionsverlauf“ einen älteren Stand wiederherstellen.`);
  }
  return {
    version: 1,
    naechsteId: d.naechsteId ?? Math.max(0, ...d.objekte.map((o) => o.id)) + 1,
    naechsteHistId: d.naechsteHistId ?? Math.max(0, ...d.historie.map((h) => h.id)) + 1,
    objekte: d.objekte,
    historie: d.historie,
    austragungen: Array.isArray(d.austragungen) ? d.austragungen : [],
    einstellungen: d.einstellungen && typeof d.einstellungen === "object" ? d.einstellungen : {},
  };
}

// ------------------------------------------------------------------ Store

function pfadKodieren(p: string): string {
  return p
    .split("/")
    .filter(Boolean)
    .map((t) => encodeURIComponent(t))
    .join("/");
}

export class SharePointStore implements Store {
  modus = "sharepoint" as const;
  private f: typeof fetch;
  private laufwerk: string;
  private ordner: string;
  private user: string | null = null;
  private name: string | null = null;

  constructor(private dep: SharePointAbhaengigkeiten) {
    this.f = dep.fetch ?? ((...a) => fetch(...a));
    this.laufwerk = dep.laufwerk || SP_LAUFWERK_STANDARD;
    this.ordner = (dep.ordner || SP_ORDNER_STANDARD).replace(/^\/+|\/+$/g, "");
  }

  /** Ablageort für die Anzeige in den Einstellungen */
  ablageort(): string {
    return `${this.laufwerk === SP_LAUFWERK_STANDARD ? SP_ANZEIGE : `Laufwerk ${this.laufwerk}`}/${this.ordner}/${DATEI}`;
  }

  // ---------- Graph-Grundfunktionen

  private async graph(pfad: string, init: RequestInit = {}): Promise<Response> {
    const t = await this.dep.token();
    const r = await this.f(pfad.startsWith("http") ? pfad : `${GRAPH}${pfad}`, {
      ...init,
      headers: { Authorization: `Bearer ${t}`, ...(init.headers as Record<string, string> | undefined) },
    });
    return r;
  }

  private async fehlerAus(r: Response, kontext: string): Promise<GraphFehler> {
    let text = "";
    try {
      const j = (await r.json()) as { error?: { code?: string; message?: string } };
      text = j.error?.message || j.error?.code || "";
    } catch {
      /* kein JSON */
    }
    if (r.status === 401) return new GraphFehler(401, `${kontext}: Anmeldung abgelaufen. Bitte abmelden und neu anmelden.`);
    if (r.status === 403) return new GraphFehler(403, `${kontext}: keine Berechtigung auf den SharePoint-Ordner. Zugriff hat, wer Mitglied der claim.m-Teamsite ist.`);
    return new GraphFehler(r.status, `${kontext}: SharePoint antwortet mit HTTP ${r.status}${text ? ` (${text})` : ""}.`);
  }

  private get dr(): string {
    return `/drives/${encodeURIComponent(this.laufwerk)}`;
  }

  private async item(rel: string): Promise<string> {
    return `${this.dr}/root:/${pfadKodieren(`${this.ordner}/${rel}`)}`;
  }

  /** Datei lesen. null, wenn es sie noch nicht gibt. */
  private async lesen(): Promise<{ daten: Daten; etag: string } | null> {
    const basis = await this.item(DATEI);
    const m = await this.graph(`${basis}?$select=id,eTag`);
    if (m.status === 404) return null;
    if (!m.ok) throw await this.fehlerAus(m, "Laden");
    const { id, eTag } = (await m.json()) as { id: string; eTag: string };
    const c = await this.graph(`${this.dr}/items/${id}/content`, { cache: "no-store" });
    if (!c.ok) throw await this.fehlerAus(c, "Laden");
    return { daten: pruefeDaten(JSON.parse(await c.text())), etag: eTag };
  }

  /** Datei schreiben. etag = null: neu anlegen (schlägt fehl, wenn sie inzwischen existiert). */
  private async schreiben(d: Daten, etag: string | null): Promise<"ok" | "konflikt"> {
    const body = JSON.stringify(d);
    if (new TextEncoder().encode(body).length > MAX_BYTES) {
      throw new Error("Speichern: Die Datendatei nähert sich 4 MB. Bitte Historie archivieren lassen (siehe HANDOVER.md, Abschnitt SharePoint).");
    }
    const basis = await this.item(DATEI);
    const url = etag ? `${basis}:/content` : `${basis}:/content?@microsoft.graph.conflictBehavior=fail`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (etag) headers["If-Match"] = etag;
    const r = await this.graph(url, { method: "PUT", headers, body });
    if (r.status === 412 || r.status === 409) return "konflikt";
    if (!r.ok) throw await this.fehlerAus(r, "Speichern");
    return "ok";
  }

  /** Frisch lesen → ändern → mit eTag schreiben; bei Konflikt bis zu 5 Versuche. */
  private async aendere<T>(fn: (d: Daten, nutzer: string) => T): Promise<T> {
    const nutzer = (await this.nutzer()) ?? "";
    for (let versuch = 0; versuch < 5; versuch++) {
      const stand = await this.lesen();
      const d = stand ? stand.daten : leereDaten();
      const ergebnis = fn(d, nutzer);
      if ((await this.schreiben(d, stand?.etag ?? null)) === "ok") return ergebnis;
      await new Promise((ok) => setTimeout(ok, 200 + Math.random() * 400));
    }
    throw new Error("Speichern: Die Daten wurden gleichzeitig von jemand anderem geändert. Bitte erneut versuchen.");
  }

  private async daten(): Promise<Daten> {
    return (await this.lesen())?.daten ?? leereDaten();
  }

  // ---------- Anmeldung

  async nutzer() {
    if (!this.user) {
      const k = await this.dep.konto();
      this.user = k?.email ?? null;
      this.name = k?.name ?? null;
    }
    return this.user;
  }
  async anzeigename() {
    return this.name;
  }
  async anmelden(): Promise<void> {
    throw new Error("Anmeldung mit Passwort gibt es nicht. Bitte mit dem Microsoft-Firmenkonto anmelden.");
  }
  async anmeldenMicrosoft() {
    const k = await this.dep.anmelden();
    this.user = k.email;
    this.name = k.name;
  }
  async abmelden() {
    this.user = null;
    this.name = null;
    await this.dep.abmelden();
  }
  /** Zugriff = SharePoint lässt lesen. Eine fehlende Datei ist kein Hindernis (wird beim ersten Speichern angelegt). */
  async freigeschaltet() {
    try {
      await this.lesen();
      return true;
    } catch (e) {
      if (e instanceof GraphFehler && (e.status === 403 || e.status === 404)) return false;
      throw e;
    }
  }

  // ---------- Daten

  async liste() {
    return (await this.daten()).objekte.map((o) => ({ ...o }));
  }
  async anlegen(o: ObjektDaten) {
    return { ...(await this.aendere((d, n) => objektAnlegen(d, o, n))) };
  }
  async anlegenViele(os: ObjektDaten[]) {
    return this.aendere((d, n) => {
      for (const o of os) objektAnlegen(d, o, n);
      return os.length;
    });
  }
  async aendern(id: number, patch: Partial<ObjektDaten> & { archiviert?: boolean }) {
    return { ...(await this.aendere((d, n) => objektAendern(d, id, patch, n))) };
  }
  /** Mehrere Änderungen in EINEM Schreibvorgang (Import, Geokodierung) */
  async aendernViele(liste: { id: number; patch: Partial<ObjektDaten> & { archiviert?: boolean } }[]) {
    return this.aendere((d, n) => {
      for (const { id, patch } of liste) objektAendern(d, id, patch, n);
      return liste.length;
    });
  }
  async historie(id: number) {
    return (await this.daten()).historie.filter((h) => h.objekt_id === id).reverse();
  }
  async austragungen() {
    return [...(await this.daten()).austragungen].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
  async austragungAnlegen(name: string, notiz: string) {
    await this.aendere((d, n) => {
      const id = Math.max(0, ...d.austragungen.map((a) => a.id)) + 1;
      d.austragungen.push({ id, name, notiz, erstellt_am: new Date().toISOString(), erstellt_von: n });
    });
  }
  async einstellung<T>(schluessel: string) {
    return ((await this.daten()).einstellungen[schluessel] ?? null) as T | null;
  }
  async einstellungSetzen(schluessel: string, wert: unknown) {
    await this.aendere((d) => {
      d.einstellungen[schluessel] = wert;
    });
  }

  // ---------- Import-Ordner (Wochen-Task legt dort CSV-Dateien ab)

  async importDateien(): Promise<ImportDatei[]> {
    const r = await this.graph(`${await this.item("Import")}:/children?$select=id,name,lastModifiedDateTime,file&$top=200`);
    if (r.status === 404) return [];
    if (!r.ok) throw await this.fehlerAus(r, "Import-Ordner");
    const j = (await r.json()) as { value: { id: string; name: string; lastModifiedDateTime: string; file?: unknown }[] };
    return j.value
      .filter((x) => x.file && /\.csv$/i.test(x.name))
      .map((x) => ({ id: x.id, name: x.name, geaendert: x.lastModifiedDateTime }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }
  async importDateiLesen(id: string): Promise<string> {
    const r = await this.graph(`${this.dr}/items/${id}/content`, { cache: "no-store" });
    if (!r.ok) throw await this.fehlerAus(r, "Import-Datei");
    return new TextDecoder("utf-8").decode(await r.arrayBuffer()).replace(/^﻿/, "");
  }
  /** Übernommene Datei nach Import/erledigt verschieben (Ordner wird bei Bedarf angelegt). */
  async importDateiErledigt(id: string): Promise<void> {
    let ziel = await this.graph(`${await this.item("Import/erledigt")}?$select=id`);
    if (ziel.status === 404) {
      const eltern = await this.graph(`${await this.item("Import")}?$select=id`);
      if (!eltern.ok) throw await this.fehlerAus(eltern, "Import-Ordner");
      const eid = ((await eltern.json()) as { id: string }).id;
      ziel = await this.graph(`${this.dr}/items/${eid}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "erledigt", folder: {}, "@microsoft.graph.conflictBehavior": "replace" }),
      });
    }
    if (!ziel.ok) throw await this.fehlerAus(ziel, "Import-Ordner");
    const zid = ((await ziel.json()) as { id: string }).id;
    const r = await this.graph(`${this.dr}/items/${id}?@microsoft.graph.conflictBehavior=rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentReference: { id: zid } }),
    });
    if (!r.ok) throw await this.fehlerAus(r, "Verschieben");
  }
}
