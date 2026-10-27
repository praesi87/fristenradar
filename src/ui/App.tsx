import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erstelleStore, STANDARD_BUERO, type Austragung, type Buero } from "../lib/store";
import type { Objekt } from "../lib/felder";
import { heute, deDatum } from "../lib/fristen";
import { autoImport, berichtText, kannAutoImport } from "../lib/autoimport";
import { positionenErmitteln } from "../lib/autogeo";
import { Kontext, useRoute, geheZu, type AppKontext } from "./kontext";
import { Liste } from "./Liste";
import { ObjektSeite } from "./Objekt";
import { ImportSeite } from "./Import";
import { AustragungenSeite } from "./Austragungen";
import { EinstellungenSeite } from "./Einstellungen";
import { Login } from "./Login";
import { Logo } from "./gemeinsam";

const store = erstelleStore();

/** So oft prüft eine offene App, ob der Wochen-Task neue Import-Dateien abgelegt hat. */
const IMPORT_INTERVALL_MS = 15 * 60 * 1000;

export function App() {
  const [nutzer, setNutzer] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState<string | null>(null);
  const [frei, setFrei] = useState<boolean | null>(null);
  const [objekte, setObjekte] = useState<Objekt[]>([]);
  const [austragungen, setAustragungen] = useState<Austragung[]>([]);
  const [buero, setBuero] = useState<Buero | null>(null);
  const [stichtag, setStichtag] = useState(heute());
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ text: string; art: "ok" | "fehler" } | null>(null);
  const route = useRoute();
  const routeKey = route.join("/");
  // Block statt Ausdruck: neuere Chrome-Versionen geben bei scrollTo ein Promise zurück, das React als Aufräumfunktion missversteht (Absturz)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [routeKey]);

  const melde = useCallback((text: string, art: "ok" | "fehler" = "ok") => {
    setMeldung({ text, art });
    window.setTimeout(() => setMeldung((m) => (m?.text === text ? null : m)), art === "fehler" ? 9000 : 4000);
  }, []);

  const neuLaden = useCallback(async () => {
    try {
      const [o, a, b] = await Promise.all([store.liste(), store.austragungen(), store.einstellung<Buero>("buero")]);
      setObjekte(o);
      setAustragungen(a);
      setBuero(b ?? STANDARD_BUERO);
      setLadefehler(null);
    } catch (e) {
      setLadefehler((e as Error).message);
    }
  }, []);

  // ---------- Automatik: Import-Dateien übernehmen und Fähnchen setzen, ohne Klick
  const [hintergrund, setHintergrund] = useState<string | null>(null);
  const [importBericht, setImportBericht] = useState<{ text: string; fehler: boolean } | null>(null);
  const laeuft = useRef(false);
  const abmeldung = useRef(false);

  const positionen = useCallback(
    async (erneut = false) => {
      const r = await positionenErmitteln(store, await store.liste(), {
        erneut,
        beiFortschritt: (nr, von, projekt) => setHintergrund(`Fähnchen werden gesetzt: ${nr}/${von} – ${projekt}`),
        nachBlock: neuLaden,
        abgebrochen: () => abmeldung.current,
      });
      return r;
    },
    [neuLaden],
  );

  /** Neue Import-Dateien übernehmen, danach fehlende Positionen suchen. Läuft nie doppelt. */
  const automatik = useCallback(
    async (nurPositionen = false, erneut = false) => {
      if (laeuft.current || store.modus === "demo") return;
      laeuft.current = true;
      try {
        if (!nurPositionen && kannAutoImport(store)) {
          setHintergrund("Neue Rechercheergebnisse werden geprüft …");
          const e = await autoImport(store);
          if (e.dateien.length || e.fehler.length) {
            setImportBericht({ text: berichtText(e), fehler: e.fehler.length > 0 });
            await neuLaden();
          }
        }
        const g = await positionen(erneut);
        if (g.gefunden || g.nichtGefunden) await neuLaden();
        if (g.fehler) melde(`Adresssuche unterbrochen: ${g.fehler}. Sie wird beim nächsten Öffnen fortgesetzt.`, "fehler");
        else if (nurPositionen) melde(`${g.gefunden} Positionen ermittelt${g.nichtGefunden ? `, ${g.nichtGefunden} nicht gefunden – Adresse ergänzen oder Fähnchen in den Details setzen` : ""}.`);
      } catch (e) {
        melde((e as Error).message, "fehler");
      } finally {
        setHintergrund(null);
        laeuft.current = false;
      }
    },
    [neuLaden, positionen, melde],
  );

  const aktualisiereNutzer = useCallback(async () => {
    const [n, a] = await Promise.all([store.nutzer(), store.anzeigename()]);
    setNutzer(n);
    setName(a);
  }, []);

  const abmelden = useCallback(async () => {
    abmeldung.current = true;
    await store.abmelden();
    await aktualisiereNutzer();
  }, [aktualisiereNutzer]);

  useEffect(() => {
    aktualisiereNutzer();
    if (store instanceof Object && "sb" in store) {
      // Supabase: auf An-/Abmeldung reagieren
      const sb = (store as unknown as { sb: { auth: { onAuthStateChange(cb: (e: string, s: { user: { email?: string } } | null) => void): unknown } } }).sb;
      sb.auth.onAuthStateChange(() => {
        // nicht direkt in der Rückruffunktion auf Supabase zugreifen (Sperre) – deshalb verzögert
        window.setTimeout(aktualisiereNutzer, 0);
      });
    }
  }, [aktualisiereNutzer]);

  useEffect(() => {
    if (!nutzer) return;
    abmeldung.current = false;
    store.freigeschaltet().then(async (f) => {
      setFrei(f);
      if (!f) return;
      await neuLaden();
      automatik();
    });
  }, [nutzer, neuLaden, automatik]);

  // Offene App: regelmäßig und beim Zurückwechseln in den Tab nach neuen Ergebnissen sehen
  useEffect(() => {
    if (!nutzer || !frei || store.modus === "demo") return;
    const t = window.setInterval(() => automatik(), IMPORT_INTERVALL_MS);
    const sichtbar = () => {
      if (document.visibilityState === "visible") automatik();
    };
    document.addEventListener("visibilitychange", sichtbar);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", sichtbar);
    };
  }, [nutzer, frei, automatik]);

  const ctx: AppKontext | null = useMemo(
    () =>
      nutzer
        ? { store, nutzer, objekte, austragungen, buero, stichtag, setStichtag, neuLaden, melde, hintergrund, positionenErmitteln: (erneut = false) => automatik(true, erneut), automatik: () => automatik() }
        : null,
    [nutzer, objekte, austragungen, buero, stichtag, neuLaden, melde, hintergrund, automatik],
  );

  if (nutzer === undefined) return <div className="laden">Lädt …</div>;
  if (!nutzer) return <Login store={store} onAngemeldet={aktualisiereNutzer} />;

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
            <span className="eyebrow eyebrow-hell">Technical &amp; Quality Management · Gewährleistung</span>
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
              {name ?? nutzer}
            </span>
            <button className="knopf knopf-geist" onClick={abmelden}>
              Abmelden
            </button>
          </div>
        </div>
      </header>
      {store.modus === "demo" && (
        <div className="band band-demo">
          <b>Demo-Modus:</b> erfundene Beispieldaten, Änderungen gehen beim Neuladen verloren. Echte Daten: Seite ohne „?demo“ in der Adresse öffnen.
        </div>
      )}
      {importBericht && (
        <div className={`band ${importBericht.fehler ? "band-warn" : "band-ok"}`} role="status">
          <b>Automatisch übernommen:</b> {importBericht.text}{" "}
          <button className="link" onClick={() => setImportBericht(null)}>
            Ausblenden
          </button>
        </div>
      )}
      {hintergrund && (
        <div className="band band-info" role="status" aria-live="polite">
          {hintergrund}
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
            {store.modus === "sharepoint" ? (
              <p>
                Du bist als <b>{nutzer}</b> angemeldet, aber SharePoint verweigert den Zugriff auf den Datenordner. Zugriff hat, wer Mitglied der claim.m-Teamsite ist. Ablageort: <code>{store.ablageort?.()}</code>
              </p>
            ) : (
              <>
                <p>
                  Du bist als <b>{nutzer}</b> angemeldet, hast aber keinen Zugriff. Mögliche Gründe: Du hast dich nicht mit dem Microsoft-Firmenkonto angemeldet, oder die Domain ist noch nicht freigeschaltet. Ein Admin kann das im Supabase-SQL-Editor nachholen:
                </p>
                <pre>
                  {`-- ganze Firmen-Domain (nur Microsoft-Login):\ninsert into public.erlaubte_domains (domain) values ('${nutzer.split("@")[1] ?? "firma.de"}');\n-- oder nur diese eine Adresse:\ninsert into public.erlaubte_nutzer (email) values ('${nutzer}');`}
                </pre>
              </>
            )}
            <button className="knopf knopf-zweit" onClick={abmelden}>
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
