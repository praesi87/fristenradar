import { useState } from "react";
import { csvZuDatensaetzen } from "../lib/csv";
import { FELDER, SPUR_NAME, type ObjektDaten, type Spur } from "../lib/felder";
import { planeImport, planeZuordnung, type ImportZeile } from "../lib/abgleich";
import { useApp } from "./kontext";

const AKTION_TEXT: Record<string, string> = { neu: "neu anlegen", ergaenzen: "ergänzen", unveraendert: "unverändert", ueberspringen: "überspringen", fehler: "Fehler" };

export function ImportSeite() {
  const { objekte, store, neuLaden, melde } = useApp();
  const [spur, setSpur] = useState<Spur>("B");
  const [dateiname, setDateiname] = useState("");
  const [plan, setPlan] = useState<ImportZeile[] | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [text, setText] = useState("");

  function auswerten(inhalt: string, name: string) {
    const { kopf, zeilen } = csvZuDatensaetzen(inhalt);
    if (!kopf.includes("Projekt")) return melde("Keine Spalte „Projekt“ gefunden – ist das eine Register- oder Marktradar-CSV (Semikolon)?", "fehler");
    setDateiname(name);
    setPlan(planeImport(objekte, zeilen, kopf, spur));
  }

  async function datei(f: File | undefined) {
    if (!f) return;
    auswerten(await f.text(), f.name);
  }

  function setzeAktion(i: number, wert: string) {
    if (!plan) return;
    const z = plan[i];
    let neu: ImportZeile;
    if (wert === "neu" || wert === "ueberspringen") neu = { ...planeZuordnung(z, null), aktion: wert };
    else {
      const ziel = objekte.find((o) => o.id === Number(wert)) ?? null;
      neu = planeZuordnung(z, ziel);
    }
    setPlan(plan.map((p, j) => (j === i ? neu : p)));
  }

  async function uebernehmen() {
    if (!plan) return;
    setLaeuft(true);
    try {
      const neu = plan.filter((z) => z.aktion === "neu").map((z) => z.daten);
      const erg = plan.filter((z) => z.aktion === "ergaenzen" && z.zielId !== null);
      if (neu.length) await store.anlegenViele(neu);
      for (const z of erg) await store.aendern(z.zielId!, z.ergaenzungen as Partial<ObjektDaten>);
      await neuLaden();
      melde(`${neu.length} neu angelegt, ${erg.length} ergänzt. Positionen bitte in der Übersicht über „Koordinaten ermitteln“ nachziehen.`);
      setPlan(null);
      setText("");
    } catch (e) {
      melde((e as Error).message, "fehler");
    } finally {
      setLaeuft(false);
    }
  }

  const zaehle = (a: string) => plan?.filter((z) => z.aktion === a).length ?? 0;
  const label = (k: string) => FELDER.find((f) => f.key === k)?.label ?? k;

  return (
    <section>
      <div className="seitenkopf">
        <div>
          <div className="eyebrow">CSV · Semikolon · UTF-8</div>
          <h1>Import</h1>
          <p className="unterzeile">Register-CSV, Marktradar-/Kandidaten-CSV und Rohimport aus import_abnahmen.py werden erkannt. Bestehende Einträge werden nur ergänzt, nie überschrieben.</p>
        </div>
      </div>

      <div className="kasten">
        <div className="import-schritte">
          <label className="feld">
            <span>1 · Ziel-Spur</span>
            <div className="seg">
              {(["B", "A"] as Spur[]).map((s) => (
                <button key={s} aria-pressed={spur === s} onClick={() => (setSpur(s), setPlan(null))}>
                  {s} · {SPUR_NAME[s]}
                </button>
              ))}
            </div>
            <small>
              {spur === "B"
                ? "Öffentliche Rechercheergebnisse (Wochen-Task, Kandidatenlisten). Ohne Quelle wird nichts übernommen."
                : "Nur belegte Abnahmen aus eigenen Unterlagen (z. B. rohimport.csv aus tools/import_abnahmen.py nach Prüfung)."}
            </small>
          </label>
          <label className="feld">
            <span>2 · Datei wählen</span>
            <input type="file" accept=".csv,text/csv" onChange={(e) => datei(e.target.files?.[0])} />
          </label>
          <label className="feld feld-breit">
            <span>… oder CSV-Text einfügen</span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Projekt;Ort;Bauherr;…" />
            <button className="knopf knopf-zweit knopf-klein" disabled={!text.trim()} onClick={() => auswerten(text, "eingefügter Text")}>
              Vorschau
            </button>
          </label>
        </div>
      </div>

      {plan && (
        <>
          <div className="seitenkopf">
            <div>
              <h2>
                Vorschau: {dateiname} → {SPUR_NAME[spur]}
              </h2>
              <p className="unterzeile">
                {zaehle("neu")} neu · {zaehle("ergaenzen")} ergänzen · {zaehle("unveraendert")} unverändert · {zaehle("ueberspringen")} überspringen · {zaehle("fehler")} Fehler
              </p>
            </div>
            <div className="seitenkopf-aktionen">
              <button className="knopf knopf-zweit" onClick={() => setPlan(null)}>
                Verwerfen
              </button>
              <button className="knopf" disabled={laeuft || zaehle("neu") + zaehle("ergaenzen") === 0} onClick={uebernehmen}>
                {laeuft ? "Übernimmt …" : `${zaehle("neu") + zaehle("ergaenzen")} Zeilen übernehmen`}
              </button>
            </div>
          </div>
          <div className="tabelle-rahmen">
            <table className="tabelle tabelle-import">
              <thead>
                <tr>
                  <th>Zeile</th>
                  <th>Projekt / Ort</th>
                  <th>Aktion</th>
                  <th>Ergänzungen / Abweichungen / Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((z, i) => (
                  <tr key={z.nr} className={`imp imp-${z.aktion}${z.treffer === "schwach" ? " imp-pruefen" : ""}`}>
                    <td className="mono">{z.nr}</td>
                    <td>
                      <b>{z.daten.projekt || "–"}</b>
                      <div className="sub">
                        {z.daten.ort} · {z.daten.datum || "kein Datum"}
                      </div>
                    </td>
                    <td>
                      {z.aktion === "fehler" ? (
                        <span className="chip chip-fehler">Fehler</span>
                      ) : (
                        <select value={z.aktion === "neu" || z.aktion === "ueberspringen" ? z.aktion : String(z.zielId)} onChange={(e) => setzeAktion(i, e.target.value)} aria-label={`Aktion Zeile ${z.nr}`}>
                          <option value="neu">neu anlegen</option>
                          <option value="ueberspringen">überspringen</option>
                          {z.kandidaten.map((k) => (
                            <option key={k.id} value={k.id}>
                              zu #{k.id} {k.projekt.slice(0, 40)} ({Math.round(k.score * 100)} %)
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="sub">{AKTION_TEXT[z.aktion]}{z.treffer === "schwach" ? " · bitte prüfen" : ""}</div>
                    </td>
                    <td className="imp-details">
                      {Object.entries(z.ergaenzungen).map(([k, v]) => (
                        <div key={k} className="erg">
                          + {label(k)}: {String(v).slice(0, 160)}
                        </div>
                      ))}
                      {Object.entries(z.konflikte).map(([k, v]) => (
                        <div key={k} className="konf">
                          ≠ {label(k)}: bleibt „{v!.alt.slice(0, 80)}“, Import hätte „{v!.neu.slice(0, 80)}“
                        </div>
                      ))}
                      {z.meldungen.map((m) => (
                        <div key={m} className="sub">
                          {m}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
