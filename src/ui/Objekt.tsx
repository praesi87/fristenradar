import { useCallback, useEffect, useMemo, useState } from "react";
import { FELDER, STATUS, SPUR_NAME, leeresObjekt, pruefe, type FeldDef, type Objekt, type ObjektDaten, type Spur } from "../lib/felder";
import { berechne, deDatum } from "../lib/fristen";
import { brief } from "../lib/brief";
import { entfernungKm, geoAbfrage, geokodiere, himmelsrichtung, peilung, routenLink } from "../lib/geo";
import type { HistorieEintrag } from "../lib/store";
import { useApp, geheZu, herunterladen, lokal, lokalSetzen, queryParam } from "./kontext";
import { Ampel, kmText } from "./gemeinsam";
import { RadarKarte } from "./RadarKarte";

const GRUPPEN: FeldDef["gruppe"][] = ["Objekt", "Beteiligte", "Frist", "Quelle", "Akquise", "Notizen"];
const ZUSATZ_LABEL: Record<string, string> = { lat: "Breite", lon: "Länge", geo_genauigkeit: "Positionsgenauigkeit", geo_abfrage: "Adresssuche", archiviert: "archiviert", spur: "Spur" };
const feldLabel = (k: string) => FELDER.find((fd) => fd.key === k)?.label ?? ZUSATZ_LABEL[k] ?? k;
const wertText = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "boolean" ? (v ? "ja" : "nein") : String(v));

export function ObjektSeite({ id }: { id: string }) {
  const { objekte, store, neuLaden, melde, stichtag, buero, austragungen } = useApp();
  const istNeu = id === "neu";
  const bestehend = istNeu ? null : (objekte.find((o) => o.id === Number(id)) ?? null);
  const startSpur: Spur = (queryParam("spur") === "A" ? "A" : "B") as Spur;

  const vorlage = useMemo<ObjektDaten>(() => {
    if (bestehend) {
      const { id: _i, archiviert: _a, erstellt_am: _e, erstellt_von: _ev, geaendert_am: _g, geaendert_von: _gv, ...rest } = bestehend;
      void [_i, _a, _e, _ev, _g, _gv];
      return rest;
    }
    const aus = queryParam("aus");
    const quelle = aus ? objekte.find((o) => o.id === Number(aus)) : null;
    const leer = leeresObjekt(startSpur);
    if (quelle && startSpur === "A") {
      return {
        ...leer,
        projekt: quelle.projekt,
        adresse: quelle.adresse,
        plz: quelle.plz,
        ort: quelle.ort,
        region: quelle.region,
        leistung: quelle.leistung,
        bauherr: quelle.bauherr,
        ansprechpartner: quelle.ansprechpartner,
        property_manager: quelle.property_manager,
        auftragnehmer: quelle.auftragnehmer,
        rolle_an: quelle.rolle_an,
        lat: quelle.lat,
        lon: quelle.lon,
        geo_genauigkeit: quelle.geo_genauigkeit,
        geo_abfrage: quelle.geo_abfrage,
        bemerkung: `Aus Marktradar #${quelle.id} übernommen – Abnahmedatum, Vertragsart und Beleg aus den Mandatsunterlagen eintragen.`,
      };
    }
    return leer;
  }, [bestehend, objekte, startSpur]);

  const [form, setForm] = useState<ObjektDaten>(vorlage);
  const [speichert, setSpeichert] = useState(false);
  const [historie, setHistorie] = useState<HistorieEintrag[]>([]);
  const [briefText, setBriefText] = useState<string | null>(null);
  const [absender, setAbsender] = useState<string>(() => lokal("absender", "[Vorname Nachname]\n[Funktion]\nclaim.m GmbH"));
  useEffect(() => setForm(vorlage), [vorlage]);
  useEffect(() => {
    if (bestehend) store.historie(bestehend.id).then(setHistorie).catch(() => setHistorie([]));
  }, [bestehend, store]);

  const f = berechne(form, stichtag);
  const { fehler, hinweise } = pruefe(form);
  const geaendert = JSON.stringify(form) !== JSON.stringify(vorlage);
  const pos = form.lat !== null && form.lon !== null ? { lat: form.lat, lon: form.lon } : null;
  const km = buero && pos ? entfernungKm(buero, pos) : null;

  const setze = (k: keyof ObjektDaten, v: string) => setForm((alt) => ({ ...alt, [k]: v }));
  const verschoben = useCallback((lat: number, lon: number) => setForm((alt) => ({ ...alt, lat, lon, geo_genauigkeit: "manuell" })), []);

  if (!istNeu && !bestehend)
    return (
      <div className="kasten">
        Eintrag #{id} nicht gefunden. <a href="#/radar">Zur Übersicht</a>
      </div>
    );

  async function speichern() {
    if (fehler.length) return melde(fehler[0], "fehler");
    setSpeichert(true);
    try {
      let ziel: Objekt;
      if (bestehend) {
        const patch: Partial<ObjektDaten> = {};
        for (const [k, v] of Object.entries(form)) if ((vorlage as unknown as Record<string, unknown>)[k] !== v) (patch as Record<string, unknown>)[k] = v;
        ziel = await store.aendern(bestehend.id, patch);
      } else ziel = await store.anlegen(form);
      // Position automatisch suchen, wenn die Adresse neu/anders ist und nicht manuell gesetzt wurde
      const abfrage = geoAbfrage(form);
      if (abfrage && abfrage !== ziel.geo_abfrage && form.geo_genauigkeit !== "manuell") {
        try {
          const t = await geokodiere(form);
          await store.aendern(ziel.id, t ? { lat: t.lat, lon: t.lon, geo_genauigkeit: t.genauigkeit, geo_abfrage: abfrage } : { geo_abfrage: abfrage });
          if (!t) melde("Gespeichert. Adresse auf der Karte nicht gefunden – Fähnchen bitte manuell setzen.", "fehler");
        } catch {
          melde("Gespeichert. Adresssuche derzeit nicht erreichbar.", "fehler");
        }
      } else melde("Gespeichert.");
      await neuLaden();
      if (istNeu) geheZu(`objekt/${ziel.id}`);
      else setHistorie(await store.historie(ziel.id));
    } catch (e) {
      melde((e as Error).message, "fehler");
    } finally {
      setSpeichert(false);
    }
  }

  async function archivieren(wert: boolean) {
    if (!bestehend) return;
    try {
      await store.aendern(bestehend.id, { archiviert: wert });
      await neuLaden();
      melde(wert ? "Archiviert – unter „Archiv“ weiterhin auffindbar." : "Wiederhergestellt.");
    } catch (e) {
      melde((e as Error).message, "fehler");
    }
  }

  async function positionSuchen() {
    try {
      const t = await geokodiere(form);
      if (!t) return melde("Adresse nicht gefunden – Fähnchen auf der Karte ziehen.", "fehler");
      setForm((alt) => ({ ...alt, lat: t.lat, lon: t.lon, geo_genauigkeit: t.genauigkeit, geo_abfrage: geoAbfrage(alt) }));
      melde(`Gefunden: ${t.anzeige}${t.genauigkeit === "ort" ? " (nur Ort – ungefähr)" : ""}. Speichern nicht vergessen.`);
    } catch (e) {
      melde((e as Error).message, "fehler");
    }
  }

  const b = form.spur === "B" ? brief(form, absender, austragungen, f.prioritaet) : null;

  return (
    <section className="objekt">
      <div className="seitenkopf">
        <div>
          <div className="eyebrow">
            <a href={form.spur === "A" ? "#/register" : "#/radar"}>← {SPUR_NAME[form.spur]}</a> · {istNeu ? "Neuer Eintrag" : `#${bestehend!.id}`}
            {bestehend?.archiviert && " · ARCHIVIERT"}
          </div>
          <h1>{form.projekt || "Neuer Eintrag"}</h1>
          {bestehend && (
            <p className="unterzeile">
              Zuletzt geändert {new Date(bestehend.geaendert_am).toLocaleString("de-DE")} von {bestehend.geaendert_von || "–"}
            </p>
          )}
        </div>
        <div className="seitenkopf-aktionen">
          {bestehend && form.spur === "B" && (
            <a className="knopf knopf-zweit" href={`#/objekt/neu?spur=A&aus=${bestehend.id}`} title="Wenn daraus ein Mandat wird: eigenen Register-Eintrag mit belegter Abnahme anlegen">
              Als Mandat ins Register …
            </a>
          )}
          {bestehend &&
            (bestehend.archiviert ? (
              <button className="knopf knopf-zweit" onClick={() => archivieren(false)}>
                Wiederherstellen
              </button>
            ) : (
              <button className="knopf knopf-zweit" onClick={() => archivieren(true)}>
                Archivieren
              </button>
            ))}
          <button className="knopf" disabled={speichert || (!geaendert && !istNeu)} onClick={speichern}>
            {speichert ? "Speichert …" : "Speichern"}
          </button>
        </div>
      </div>

      {(fehler.length > 0 || hinweise.length > 0) && (
        <div className="meldungen">
          {fehler.map((t) => (
            <div key={t} className="meldung meldung-fehler">
              {t}
            </div>
          ))}
          {hinweise.map((t) => (
            <div key={t} className="meldung">
              {t}
            </div>
          ))}
        </div>
      )}

      <div className="objekt-raster">
        <div className="objekt-form">
          {istNeu && (
            <fieldset className="gruppe">
              <legend>Spur</legend>
              <div className="seg">
                {(["B", "A"] as Spur[]).map((s) => (
                  <button key={s} aria-pressed={form.spur === s} onClick={() => setForm((alt) => ({ ...leeresObjekt(s), ...alt, spur: s, bezugsart: s === "A" ? "abnahme" : alt.bezugsart === "abnahme" ? "fertigstellung" : alt.bezugsart, status: STATUS[s][0] }))}>
                    {s === "A" ? "A · Register (eigene Abnahme)" : "B · Marktradar (öffentliche Quelle)"}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {GRUPPEN.map((g) => {
            const felder = FELDER.filter((fd) => fd.gruppe === g && (!fd.nurSpur || fd.nurSpur === form.spur));
            if (!felder.length) return null;
            return (
              <fieldset key={g} className="gruppe">
                <legend>{g}</legend>
                <div className="felder">
                  {felder.map((fd) => (
                    <FeldEingabe key={fd.key} fd={fd} wert={String(form[fd.key] ?? "")} spur={form.spur} setze={(v) => setze(fd.key, v)} />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>

        <aside className="objekt-seite">
          <div className="karte-box">
            <div className="eyebrow">Frist · berechnet</div>
            <div className="frist-gross">
              <Ampel f={f} />
            </div>
            <table className="kv">
              <tbody>
                <tr>
                  <th>{form.bezugsart === "zuschlag" ? "Abnahme (geschätzt)" : form.bezugsart === "abnahme" ? "Abnahme" : "Fertigstellung"}</th>
                  <td>
                    {f.genauigkeit === "Monat" ? "≈ " : ""}
                    {deDatum(f.abnahme)}
                  </td>
                </tr>
                {f.fest ? (
                  <tr>
                    <th>Fristende (vertraglich)</th>
                    <td>
                      <b>{deDatum(f.fest)}</b>
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <th>+ 4 J. (VOB/B)</th>
                      <td className={f.art === "VOB" ? "hit" : ""}>{deDatum(f.f4)}</td>
                    </tr>
                    <tr>
                      <th>+ 5 J. (BGB)</th>
                      <td className={f.art === "BGB" ? "hit" : ""}>{deDatum(f.f5)}</td>
                    </tr>
                  </>
                )}
                <tr>
                  <th>Im 6-Monats-Fenster</th>
                  <td>{f.imFenster ? "ja" : "nein"}</td>
                </tr>
                {form.spur === "B" && (
                  <tr>
                    <th>Ansprache</th>
                    <td>{f.prioritaet ? `P${f.prioritaet} · ${f.ansprachefenster}` : "–"}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="karte-box">
            <div className="eyebrow">Lage</div>
            {pos ? (
              <p className="klein">
                {km !== null && buero ? (
                  <>
                    <b>{kmText(km)}</b> Luftlinie vom Büro · Richtung {himmelsrichtung(peilung(buero, pos))} ·{" "}
                    <a href={routenLink(buero, pos)} target="_blank" rel="noopener">
                      Route ↗
                    </a>
                  </>
                ) : (
                  "Büroadresse fehlt – Einstellungen."
                )}
                <br />
                {form.geo_genauigkeit === "ort" ? "Position ungefähr (Ortsmitte). " : form.geo_genauigkeit === "manuell" ? "Position manuell gesetzt. " : ""}
                Fähnchen ziehen zum Korrigieren.
              </p>
            ) : (
              <p className="klein">Noch keine Position.</p>
            )}
            <RadarKarte
              zeilen={pos ? [{ o: { ...(bestehend ?? ({} as Objekt)), ...form, id: bestehend?.id ?? 0 } as Objekt, f, km }] : []}
              buero={buero}
              hoehe={240}
              ziehbar
              onVerschoben={verschoben}
            />
            <button className="knopf knopf-zweit knopf-klein" onClick={positionSuchen} disabled={!form.ort && !form.plz}>
              Position aus Adresse suchen
            </button>
          </div>

          {b && (
            <div className="karte-box">
              <div className="eyebrow">Anschreiben (Postbrief)</div>
              {b.sperren.map((t) => (
                <div key={t} className="meldung meldung-fehler">
                  {t}
                </div>
              ))}
              {b.warnungen.map((t) => (
                <div key={t} className="meldung">
                  {t}
                </div>
              ))}
              <label className="feld">
                <span>Absender (wird in diesem Browser gemerkt)</span>
                <textarea rows={3} value={absender} onChange={(e) => (setAbsender(e.target.value), lokalSetzen("absender", e.target.value))} />
              </label>
              <button className="knopf knopf-klein" disabled={b.sperren.length > 0} onClick={() => setBriefText(b.text)}>
                Brieftext erzeugen
              </button>
              {briefText && (
                <>
                  <textarea className="brief" rows={16} value={briefText} onChange={(e) => setBriefText(e.target.value)} />
                  <div className="knopfreihe">
                    <button className="knopf knopf-zweit knopf-klein" onClick={() => navigator.clipboard?.writeText(briefText).then(() => melde("Kopiert."))}>
                      Kopieren
                    </button>
                    <button className="knopf knopf-zweit knopf-klein" onClick={() => herunterladen(`Brief_${form.projekt.replace(/[^\wäöüÄÖÜß -]/g, "").slice(0, 50)}.txt`, briefText)}>
                      Als .txt
                    </button>
                  </div>
                  <p className="klein">Nur als Postbrief versenden – E-Mail-Werbung ohne Einwilligung ist auch B2B unzulässig (§ 7 Abs. 2 Nr. 2 UWG). Art. 14 DSGVO beachten. Keine Rechtsberatung.</p>
                </>
              )}
            </div>
          )}

          {bestehend && (
            <div className="karte-box">
              <div className="eyebrow">Historie</div>
              {historie.length === 0 && <p className="klein">Keine Einträge.</p>}
              <ol className="historie">
                {historie.map((h) => (
                  <li key={h.id}>
                    <span className="mono">{new Date(h.zeitpunkt).toLocaleString("de-DE")}</span> · {h.nutzer} · <b>{h.aktion === "geaendert" ? "geändert" : h.aktion}</b>
                    {h.aktion === "geaendert" && (
                      <ul>
                        {Object.entries(h.aenderungen as Record<string, { alt: unknown; neu: unknown }>).map(([k, d]) => (
                          <li key={k}>
                            {feldLabel(k)}: <s>{wertText(d?.alt)}</s> → {wertText(d?.neu)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function FeldEingabe({ fd, wert, spur, setze }: { fd: FeldDef; wert: string; spur: Spur; setze(v: string): void }) {
  const id = `f-${fd.key}`;
  let eingabe: React.ReactNode;
  if (fd.key === "vertragsart")
    eingabe = (
      <select id={id} value={wert} onChange={(e) => setze(e.target.value)}>
        <option value="unklar">unklar (4 oder 5 J.)</option>
        <option value="VOB/B">VOB/B (4 J.)</option>
        <option value="BGB">BGB (5 J.)</option>
      </select>
    );
  else if (fd.key === "bezugsart")
    eingabe = (
      <select id={id} value={wert} onChange={(e) => setze(e.target.value)}>
        {spur === "A" && <option value="abnahme">förmliche Abnahme (belegt)</option>}
        <option value="fertigstellung">Fertigstellung / Übergabe / Eröffnung</option>
        <option value="zuschlag">Zuschlag (Abnahme wird geschätzt)</option>
      </select>
    );
  else if (fd.key === "projektgroesse")
    eingabe = (
      <select id={id} value={wert} onChange={(e) => setze(e.target.value)}>
        <option value="">–</option>
        <option value="klein">klein (12 Mon. Bauzeit)</option>
        <option value="mittel">mittel (24 Mon.)</option>
        <option value="gross">groß (36 Mon.)</option>
      </select>
    );
  else if (fd.key === "konfidenz")
    eingabe = (
      <select id={id} value={wert} onChange={(e) => setze(e.target.value)}>
        <option value="">–</option>
        <option value="hoch">hoch</option>
        <option value="mittel">mittel</option>
        <option value="niedrig">niedrig</option>
      </select>
    );
  else if (fd.key === "status")
    eingabe = (
      <>
        <input id={id} list={`${id}-l`} value={wert} onChange={(e) => setze(e.target.value)} />
        <datalist id={`${id}-l`}>
          {STATUS[spur].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </>
    );
  else if (fd.mehrzeilig) eingabe = <textarea id={id} rows={fd.key === "bemerkung" ? 4 : 2} value={wert} onChange={(e) => setze(e.target.value)} />;
  else eingabe = <input id={id} value={wert} onChange={(e) => setze(e.target.value)} placeholder={fd.key === "datum" || fd.key === "fristende" ? "JJJJ-MM-TT" : undefined} inputMode={fd.key === "plz" ? "numeric" : undefined} />;
  return (
    <label className={`feld${fd.mehrzeilig ? " feld-breit" : ""}`} htmlFor={id}>
      <span>{fd.label}</span>
      {eingabe}
      {fd.hilfe && <small>{fd.hilfe}</small>}
    </label>
  );
}
