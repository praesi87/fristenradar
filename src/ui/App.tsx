import { useCallback, useEffect, useMemo, useState } from "react";
import { erstelleStore, type Austragung, type Buero } from "../lib/store";
import type { Objekt } from "../lib/felder";
import { heute, deDatum } from "../lib/fristen";
import { Kontext, useRoute, geheZu, type AppKontext } from "./kontext";
import { Liste } from "./Liste";
import { ObjektSeite } from "./Objekt";
import { ImportSeite } from "./Import";
import { AustragungenSeite } from "./Austragungen";
import { EinstellungenSeite } from "./Einstellungen";
import { Login } from "./Login";
import { Logo } from "./gemeinsam";

const store = erstelleStore();

export function App() {
  const [nutzer, setNutzer] = useState<string | null | undefined>(undefined);
  const [frei, setFrei] = useState<boolean | null>(null);
  const [objekte, setObjekte] = useState<Objekt[]>([]);
  const [austragungen, setAustragungen] = useState<Austragung[]>([]);
  const [buero, setBuero] = useState<Buero | null>(null);
  const [stichtag, setStichtag] = useState(heute());
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ text: string; art: "ok" | "fehler" } | null>(null);
  const route = useRoute();
  const routeKey = route.join("/");
  useEffect(() => window.scrollTo(0, 0), [routeKey]);

  const melde = useCallback((text: string, art: "ok" | "fehler" = "ok") => {
    setMeldung({ text, art });
    window.setTimeout(() => setMeldung((m) => (m?.text === text ? null : m)), art === "fehler" ? 9000 : 4000);
  }, []);

  const neuLaden = useCallback(async () => {
    try {
      const [o, a, b] = await Promise.all([store.liste(), store.austragungen(), store.einstellung<Buero>("buero")]);
      setObjekte(o);
      setAustragungen(a);
      setBuero(b);
      setLadefehler(null);
    } catch (e) {
      setLadefehler((e as Error).message);
    }
  }, []);

  useEffect(() => {
    store.nutzer().then(setNutzer);
    if (store instanceof Object && "sb" in store) {
      // Supabase: auf An-/Abmeldung reagieren
      const sb = (store as unknown as { sb: { auth: { onAuthStateChange(cb: (e: string, s: { user: { email?: string } } | null) => void): unknown } } }).sb;
      sb.auth.onAuthStateChange((_e, s) => setNutzer(s?.user.email ?? null));
    }
  }, []);

  useEffect(() => {
    if (!nutzer) return;
    store.freigeschaltet().then((f) => {
      setFrei(f);
      if (f) neuLaden();
    });
  }, [nutzer, neuLaden]);

  const ctx: AppKontext | null = useMemo(
    () => (nutzer ? { store, nutzer, objekte, austragungen, buero, stichtag, setStichtag, neuLaden, melde } : null),
    [nutzer, objekte, austragungen, buero, stichtag, neuLaden, melde],
  );

  if (nutzer === undefined) return <div className="laden">Lädt …</div>;
  if (!nutzer) return <Login store={store} />;

  const seite = route[0];
  const nav: [string, string][] = [
    ["radar", "Marktradar"],
    ["register", "Register"],
    ["import", "Import"],
    ["austragungen", "Austragungen"],
    ["einstellungen", "Einstellungen"],
  ];

  return (
    <Kontext.Provider value={ctx}>
      <header className="kopf">
        <div className="kopf-innen">
          <a href="#/radar" className="kopf-logo" aria-label="Startseite">
            <Logo variante="dunkel" />
          </a>
          <div className="kopf-titel">
            <span className="eyebrow eyebrow-hell">Qualität &amp; Bau · Gewährleistung</span>
            <strong>Fristenradar Rhein-Main</strong>
          </div>
          <nav className="kopf-nav" aria-label="Hauptnavigation">
            {nav.map(([k, l]) => (
              <a key={k} href={`#/${k}`} aria-current={seite === k || (k === "radar" && seite === "objekt") ? "page" : undefined}>
                {l}
              </a>
            ))}
          </nav>
          <div className="kopf-nutzer">
            <label className="stichtag" title="Stichtag für alle Berechnungen">
              <span>Stichtag</span>
              <input type="date" value={stichtag} onChange={(e) => e.target.value && setStichtag(e.target.value)} />
            </label>
            <span className="nutzer" title={nutzer}>
              {store.modus === "demo" ? "DEMO" : nutzer}
            </span>
            {store.modus === "supabase" && (
              <button className="knopf knopf-geist" onClick={() => store.abmelden()}>
                Abmelden
              </button>
            )}
          </div>
        </div>
      </header>
      {store.modus === "demo" && (
        <div className="band band-demo">
          <b>Demo-Modus:</b> erfundene Beispieldaten, Änderungen gehen beim Neuladen verloren. Für echte Daten Supabase verbinden (siehe HANDOVER.md).
        </div>
      )}
      {stichtag !== heute() && (
        <div className="band band-warn">
          Stichtag ist auf <b>{deDatum(stichtag)}</b> gesetzt, nicht auf heute.{" "}
          <button className="link" onClick={() => setStichtag(heute())}>
            Zurück auf heute
          </button>
        </div>
      )}
      <main className="haupt">
        {frei === false ? (
          <div className="kasten kasten-fehler">
            <h2>Nicht freigeschaltet</h2>
            <p>
              Du bist als <b>{nutzer}</b> angemeldet, hast aber keinen Zugriff. Mögliche Gründe: Du hast dich nicht mit dem Microsoft-Firmenkonto angemeldet, oder die Domain ist noch nicht freigeschaltet. Ein Admin kann das im Supabase-SQL-Editor nachholen:
            </p>
            <pre>
              {`-- ganze Firmen-Domain (nur Microsoft-Login):\ninsert into public.erlaubte_domains (domain) values ('${nutzer.split("@")[1] ?? "firma.de"}');\n-- oder nur diese eine Adresse:\ninsert into public.erlaubte_nutzer (email) values ('${nutzer}');`}
            </pre>
            <button className="knopf knopf-zweit" onClick={() => store.abmelden()}>
              Abmelden und anders anmelden
            </button>
          </div>
        ) : ladefehler ? (
          <div className="kasten kasten-fehler">
            <h2>Daten konnten nicht geladen werden</h2>
            <p>{ladefehler}</p>
            <button className="knopf" onClick={neuLaden}>
              Erneut versuchen
            </button>
          </div>
        ) : seite === "register" ? (
          <Liste spur="A" />
        ) : seite === "objekt" ? (
          <ObjektSeite id={route[1]} />
        ) : seite === "import" ? (
          <ImportSeite />
        ) : seite === "austragungen" ? (
          <AustragungenSeite />
        ) : seite === "einstellungen" ? (
          <EinstellungenSeite />
        ) : (
          <Liste spur="B" />
        )}
      </main>
      <footer className="fuss">
        <span>claim.m GmbH · Fristenradar · keine Rechtsberatung – Fristen vor jeder Handlung am Vertrag prüfen</span>
        <span>
          Karte © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a> · Adresssuche Nominatim
        </span>
      </footer>
      {meldung && (
        <div className={`toast toast-${meldung.art}`} role="status" onClick={() => setMeldung(null)}>
          {meldung.text}
        </div>
      )}
    </Kontext.Provider>
  );
}

export { geheZu };
