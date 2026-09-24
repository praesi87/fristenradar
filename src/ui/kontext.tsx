import { createContext, useContext, useEffect, useState } from "react";
import type { Objekt } from "../lib/felder";
import type { Austragung, Buero, Store } from "../lib/store";

export interface AppKontext {
  store: Store;
  nutzer: string;
  objekte: Objekt[];
  austragungen: Austragung[];
  buero: Buero | null;
  stichtag: string;
  setStichtag(s: string): void;
  neuLaden(): Promise<void>;
  melde(text: string, art?: "ok" | "fehler"): void;
}

export const Kontext = createContext<AppKontext | null>(null);

export function useApp(): AppKontext {
  const k = useContext(Kontext);
  if (!k) throw new Error("App-Kontext fehlt");
  return k;
}

// ------------------------------------------------------------------ Hash-Routing (GitHub Pages kennt keine SPA-Routen)


export function useRoute(): string[] {
  const lies = () => (window.location.hash.replace(/^#\/?/, "") || "radar").split("?")[0].split("/").map(decodeURIComponent);
  const [r, setR] = useState(lies);
  useEffect(() => {
    const f = () => setR(lies());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}

export function queryParam(name: string): string | null {
  const q = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(q).get(name);
}

export function geheZu(pfad: string) {
  window.location.hash = `#/${pfad}`;
}

// ------------------------------------------------------------------ lokale Einstellungen (nur Komfort, pro Browser)

export function lokal<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(`fristenradar.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function lokalSetzen(key: string, wert: unknown) {
  try {
    window.localStorage.setItem(`fristenradar.${key}`, JSON.stringify(wert));
  } catch {
    /* privates Fenster o. Ä. – dann eben nicht merken */
  }
}

export function herunterladen(name: string, inhalt: string, typ = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
