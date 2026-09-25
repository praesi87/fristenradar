/**
 * Datenzugriff. Zwei Implementierungen mit derselben Schnittstelle:
 *   - SupabaseStore: echte Daten, Login, Rechte über Row Level Security (supabase/schema.sql)
 *   - DemoStore: erfundene Beispieldaten im Speicher (für die öffentliche Seite ohne Login und lokale Tests)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Objekt, ObjektDaten } from "./felder";
import { DEMO_DATEN } from "./demo";

export interface HistorieEintrag {
  id: number;
  objekt_id: number;
  zeitpunkt: string;
  nutzer: string;
  aktion: string;
  aenderungen: Record<string, { alt: unknown; neu: unknown }> | Record<string, unknown>;
}

export interface Austragung {
  id: number;
  name: string;
  notiz: string;
  erstellt_am: string;
  erstellt_von: string;
}

export interface Store {
  modus: "demo" | "supabase";
  nutzer(): Promise<string | null>;
  anmelden(email: string, passwort: string): Promise<void>;
  /** Weiterleitung zum Microsoft-Login (Entra ID). Kehrt nach erfolgreicher Anmeldung zur App zurück. */
  anmeldenMicrosoft(): Promise<void>;
  abmelden(): Promise<void>;
  freigeschaltet(): Promise<boolean>;
  liste(): Promise<Objekt[]>;
  anlegen(o: ObjektDaten): Promise<Objekt>;
  anlegenViele(os: ObjektDaten[]): Promise<number>;
  aendern(id: number, patch: Partial<ObjektDaten> & { archiviert?: boolean }): Promise<Objekt>;
  historie(id: number): Promise<HistorieEintrag[]>;
  austragungen(): Promise<Austragung[]>;
  austragungAnlegen(name: string, notiz: string): Promise<void>;
  einstellung<T = unknown>(schluessel: string): Promise<T | null>;
  einstellungSetzen(schluessel: string, wert: unknown): Promise<void>;
}

export interface Buero {
  adresse: string;
  lat: number;
  lon: number;
}

// ------------------------------------------------------------------ Supabase

function fehler(e: { message: string; code?: string } | null, kontext: string): void {
  if (!e) return;
  const m = e.message || String(e);
  if (/row-level security|permission denied/i.test(m)) throw new Error(`${kontext}: keine Berechtigung. Ist deine E-Mail in „erlaubte_nutzer“ eingetragen?`);
  if (/quelle_spur_b/.test(m)) throw new Error(`${kontext}: Spur B braucht eine Quelle.`);
  throw new Error(`${kontext}: ${m}`);
}

export class SupabaseStore implements Store {
  modus = "supabase" as const;
  sb: SupabaseClient;
  /** server = true: Einsatz in der GitHub Action (kein Browser, keine Sitzung) */
  constructor(url: string, key: string, server = false) {
    // PKCE: Microsoft liefert den Anmelde-Code als ?code=… zurück, nicht im #-Teil der Adresse – der gehört dem Hash-Routing der App.
    this.sb = createClient(url, key, {
      auth: server ? { persistSession: false, autoRefreshToken: false } : { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    });
  }
  async nutzer() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.email ?? null;
  }
  async anmelden(email: string, passwort: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password: passwort });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch." : error.message);
  }
  async anmeldenMicrosoft() {
    const zurueck = `${window.location.origin}${window.location.pathname}`;
    const { error } = await this.sb.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email openid profile", redirectTo: zurueck } });
    if (error) throw new Error(/provider is not enabled|unsupported provider/i.test(error.message) ? "Microsoft-Anmeldung ist in Supabase noch nicht eingerichtet (Authentication → Providers → Azure)." : error.message);
  }
  async abmelden() {
    await this.sb.auth.signOut();
  }
  async freigeschaltet() {
    const { data, error } = await this.sb.rpc("ist_freigeschaltet");
    if (error) return false;
    return data === true;
  }
  async liste() {
    const alle: Objekt[] = [];
    for (let von = 0; ; von += 1000) {
      const { data, error } = await this.sb.from("objekte").select("*").order("id").range(von, von + 999);
      fehler(error, "Laden");
      alle.push(...((data ?? []) as Objekt[]));
      if (!data || data.length < 1000) break;
    }
    return alle;
  }
  async anlegen(o: ObjektDaten) {
    const { data, error } = await this.sb.from("objekte").insert(o).select().single();
    fehler(error, "Anlegen");
    return data as Objekt;
  }
  async anlegenViele(os: ObjektDaten[]) {
    let n = 0;
    for (let i = 0; i < os.length; i += 200) {
      const teil = os.slice(i, i + 200);
      const { error } = await this.sb.from("objekte").insert(teil);
      fehler(error, "Import");
      n += teil.length;
    }
    return n;
  }
  async aendern(id: number, patch: Partial<ObjektDaten> & { archiviert?: boolean }) {
    const { spur: _s, ...rest } = patch as Partial<ObjektDaten>;
    void _s;
    const { data, error } = await this.sb.from("objekte").update(rest).eq("id", id).select().single();
    fehler(error, "Speichern");
    return data as Objekt;
  }
  async historie(id: number) {
    const { data, error } = await this.sb.from("historie").select("*").eq("objekt_id", id).order("zeitpunkt", { ascending: false });
    fehler(error, "Historie");
    return (data ?? []) as HistorieEintrag[];
  }
  async austragungen() {
    const { data, error } = await this.sb.from("austragungen").select("*").order("name");
    fehler(error, "Austragungen");
    return (data ?? []) as Austragung[];
  }
  async austragungAnlegen(name: string, notiz: string) {
    const { error } = await this.sb.from("austragungen").insert({ name, notiz });
    fehler(error, "Austragung");
  }
  async einstellung<T>(schluessel: string) {
    const { data, error } = await this.sb.from("einstellungen").select("wert").eq("schluessel", schluessel).maybeSingle();
    fehler(error, "Einstellungen");
    return (data?.wert ?? null) as T | null;
  }
  async einstellungSetzen(schluessel: string, wert: unknown) {
    const { error } = await this.sb.from("einstellungen").upsert({ schluessel, wert });
    fehler(error, "Einstellungen");
  }
}

// ------------------------------------------------------------------ Demo

export class DemoStore implements Store {
  modus = "demo" as const;
  private objekte: Objekt[];
  private hist: HistorieEintrag[] = [];
  private aus: Austragung[] = [{ id: 1, name: "BEISPIEL Widerspruch GmbH", notiz: "Demo-Eintrag", erstellt_am: new Date().toISOString(), erstellt_von: "demo" }];
  private naechsteId: number;
  private user: string | null = "demo@beispiel.invalid";
  private einst: Record<string, unknown> = { buero: { adresse: "BEISPIEL-Büro Frankfurt am Main (Innenstadt) – in den Einstellungen ändern", lat: 50.1109, lon: 8.6821 } };
  constructor(start: ObjektDaten[] = DEMO_DATEN) {
    const jetzt = new Date().toISOString();
    this.objekte = start.map((o, i) => ({ ...o, id: i + 1, archiviert: false, erstellt_am: jetzt, erstellt_von: "demo", geaendert_am: jetzt, geaendert_von: "demo" }));
    this.naechsteId = this.objekte.length + 1;
  }
  async nutzer() {
    return this.user;
  }
  async anmelden(email: string) {
    this.user = email;
  }
  async anmeldenMicrosoft() {
    this.user = "demo.microsoft@beispiel.invalid";
  }
  async abmelden() {
    this.user = null;
  }
  async freigeschaltet() {
    return true;
  }
  async liste() {
    return this.objekte.map((o) => ({ ...o }));
  }
  async anlegen(o: ObjektDaten) {
    if (o.spur === "B" && !o.quelle.trim()) throw new Error("Anlegen: Spur B braucht eine Quelle.");
    const jetzt = new Date().toISOString();
    const neu: Objekt = { ...o, id: this.naechsteId++, archiviert: false, erstellt_am: jetzt, erstellt_von: this.user ?? "", geaendert_am: jetzt, geaendert_von: this.user ?? "" };
    this.objekte.push(neu);
    this.hist.push({ id: this.hist.length + 1, objekt_id: neu.id, zeitpunkt: jetzt, nutzer: this.user ?? "", aktion: "angelegt", aenderungen: {} });
    return { ...neu };
  }
  async anlegenViele(os: ObjektDaten[]) {
    for (const o of os) await this.anlegen(o);
    return os.length;
  }
  async aendern(id: number, patch: Partial<ObjektDaten> & { archiviert?: boolean }) {
    const o = this.objekte.find((x) => x.id === id);
    if (!o) throw new Error("Speichern: Eintrag nicht gefunden.");
    const diff: Record<string, { alt: unknown; neu: unknown }> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === "spur") continue;
      const alt = (o as unknown as Record<string, unknown>)[k];
      if (alt !== v) diff[k] = { alt, neu: v };
      (o as unknown as Record<string, unknown>)[k] = v;
    }
    if (o.spur === "B" && !o.quelle.trim()) throw new Error("Speichern: Spur B braucht eine Quelle.");
    o.geaendert_am = new Date().toISOString();
    o.geaendert_von = this.user ?? "";
    if (Object.keys(diff).length) this.hist.push({ id: this.hist.length + 1, objekt_id: id, zeitpunkt: o.geaendert_am, nutzer: o.geaendert_von, aktion: "geaendert", aenderungen: diff });
    return { ...o };
  }
  async historie(id: number) {
    return this.hist.filter((h) => h.objekt_id === id).reverse();
  }
  async austragungen() {
    return [...this.aus];
  }
  async einstellung<T>(schluessel: string) {
    return (this.einst[schluessel] ?? null) as T | null;
  }
  async einstellungSetzen(schluessel: string, wert: unknown) {
    this.einst[schluessel] = wert;
  }
  async austragungAnlegen(name: string, notiz: string) {
    this.aus.push({ id: this.aus.length + 1, name, notiz, erstellt_am: new Date().toISOString(), erstellt_von: this.user ?? "" });
  }
}

export function erstelleStore(): Store {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) return new SupabaseStore(url, key);
  return new DemoStore();
}
