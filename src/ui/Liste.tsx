import { useMemo, useState } from "react";
import { FELDER, SPUR_NAME, STATUS, type Spur } from "../lib/felder";
import { deDatum, fensterEnde } from "../lib/fristen";
import { schreibeCsv } from "../lib/csv";
import { geoAbfrage, geokodiere } from "../lib/geo";
import { useApp, geheZu, herunterladen, lokal, lokalSetzen } from "./kontext";
import { Ampel, OEFF, berechneZeilen, kmText, type Zeile } from "./gemeinsam";
import { RadarKarte } from "./RadarKarte";

type Sortierung = "fristende" | "projekt" | "ort" | "km" | "prio" | "datum";

export function Liste({ spur }: { spur: Spur }) {
  const { objekte, stichtag, buero, store, neuLaden, melde } = useApp();
  const [suche, setSuche] = useState("");
  const [vertrag, setVertrag] = useState("");
  const [typ, setTyp] = useState("");
  const [status, setStatus] = useState("");
  const [umfang, setUmfang] = useState<"fenster" | "alle" | "archiv">(() => lokal(`umfang.${spur}`, "fenster"));
  const [sort, setSort] = useState<{ k: Sortierung; dir: 1 | -1 }>({ k: "fristende", dir: 1 });
  const [geoLaeuft, setGeoLaeuft] = useState<string | null>(null);

  const alle = useMemo(() => berechneZeilen(objekte.filter((o) => o.spur === spur), stichtag, buero), [objekte, spur, stichtag, buero]);
  const aktiv = alle.filter((z) => !z.o.archiviert && z.f.rheinMain);
  const fenster = aktiv.filter((z) => z.f.imFenster);
  const kritisch = fenster.filter((z) => z.f.tage !== null && z.f.tage <= 90);
  const unklar = fenster.filter((z) => z.f.art === "unklar" && !z.f.fest);
  const abgelaufen = aktiv.filter((z) => z.f.abgelaufen);
  const prio1 = aktiv.filter((z) => z.f.prioritaet === 1);

  const n = suche.trim().toLowerCase();
  const gefiltert = alle
    .filter((z) => (umfang === "archiv" ? z.o.archiviert : !z.o.archiviert))
    .filter((z) => umfang !== "fenster" || (z.f.imFenster && z.f.rheinMain))
    .filter((z) => !vertrag || z.f.art === vertrag)
    .filter((z) => !typ || (typ === "oeff") === OEFF.test(z.o.bauherr))
    .filter((z) => !status || z.o.status === status)
    .filter((z) => !n || Object.values(z.o).join(" ").toLowerCase().includes(n));

  const sortiert = [...gefiltert].sort((a, b) => {
    const wert = (z: Zeile): string | number => {
      switch (sort.k) {
        case "projekt":
          return z.o.projekt.toLowerCase();
        case "ort":
          return z.o.ort.toLowerCase();
        case "km":
          return z.km ?? 1e9;
        case "prio":
          return z.f.prioritaet ?? 9;
        case "datum":
          return z.f.abnahme ?? "9999";
        default:
          return z.f.fristende ?? "9999";
      }
    };
    const x = wert(a);
    const y = wert(b);
    return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
  });

  const ohnePos = aktiv.filter((z) => (z.o.lat === null || z.o.lon === null) && (z.o.ort || z.o.plz));
  const statusListe = [...new Set([...STATUS[spur], ...alle.map((z) => z.o.status).filter(Boolean)])];

  function th(k: Sortierung, label: string) {
    const aktivK = sort.k === k;
    return (
      <th aria-sort={aktivK ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
        <button className="th-knopf" onClick={() => setSort({ k, dir: aktivK ? ((-sort.dir) as 1 | -1) : 1 })}>
          {label} {aktivK ? (sort.dir > 0 ? "↑" : "↓") : ""}
        </button>
      </th>
    );
  }

  async function koordinatenErmitteln() {
    let ok = 0;
    let fehl = 0;
    for (let i = 0; i < ohnePos.length; i++) {
      const o = ohnePos[i].o;
      setGeoLaeuft(`${i + 1}/${ohnePos.length}: ${o.projekt}`);
      try {
        const t = await geokodiere(o);
        if (t) {
          await store.aendern(o.id, { lat: t.lat, lon: t.lon, geo_genauigkeit: t.genauigkeit, geo_abfrage: geoAbfrage(o) });
          ok++;
        } else fehl++;
      } catch (e) {
        fehl++;
        melde((e as Error).message, "fehler");
        break;
      }
    }
    setGeoLaeuft(null);
    await neuLaden();
    melde(`${ok} Positionen ermittelt${fehl ? `, ${fehl} nicht gefunden` : ""}.`);
  }

  function exportieren() {
    const kopf = ["Spur", ...FELDER.map((f) => f.csv[0]), "Lat", "Lon", "_Fristende_4J", "_Fristende_5J", "_Fristende_massgeblich", "_Resttage", "_Prioritaet", "_km_Buero", "_ID"];
    const zeilen = sortiert.map(({ o, f, km }) => ({
      Spur: o.spur,
      ...Object.fromEntries(FELDER.map((fd) => [fd.csv[0], o[fd.key]])),
      Lat: o.lat ?? "",
      Lon: o.lon ?? "",
      _Fristende_4J: f.f4 ?? "",
      _Fristende_5J: f.f5 ?? "",
      _Fristende_massgeblich: f.fristende ?? "",
      _Resttage: f.tage ?? "",
      _Prioritaet: f.prioritaet ?? "",
      _km_Buero: km === null ? "" : km.toFixed(1),
      _ID: o.id,
    }));
    herunterladen(`fristenradar-${spur === "A" ? "register" : "marktradar"}-${stichtag}.csv`, schreibeCsv(kopf, zeilen), "text/csv;charset=utf-8");
  }

  const kartenZeilen = sortiert.filter((z) => z.f.rheinMain || umfang !== "fenster");

  return (
    <section>
      <div className="seitenkopf">
        <div>
          <div className="eyebrow">{spur === "A" ? "Spur A · fristverbindlich · eigene Mandatsunterlagen" : "Spur B · Akquise · öffentliche Quellen"}</div>
          <h1>{SPUR_NAME[spur]}</h1>
          <p className="unterzeile">
            Stichtag {deDatum(stichtag)} · Fenster bis {deDatum(fensterEnde(stichtag))} (6 Monate)
          </p>
        </div>
        <div className="seitenkopf-aktionen">
          <button className="knopf knopf-zweit" onClick={exportieren}>
            CSV exportieren
          </button>
          <a className="knopf" href={`#/objekt/neu?spur=${spur}`}>
            + Neuer Eintrag
          </a>
        </div>
      </div>

      <div className="kpis">
        <Kpi n={fenster.length} l="Möglicher Fristablauf im 6-Monats-Fenster" k="warn" />
        <Kpi n={kritisch.length} l="davon in ≤ 90 Tagen – Begehung/Rüge jetzt" k="crit" />
        {spur === "B" ? <Kpi n={prio1.length} l="Priorität 1 – jetzt ansprechen (90–550 T.)" k="rot" /> : <Kpi n={unklar.length} l="davon Vertragsart unklar" k="rot" />}
        <Kpi n={abgelaufen.length} l="bereits abgelaufen – Bürgschaft/Restmängel" k="past" />
      </div>

      {spur === "A" && aktiv.length === 0 && (
        <div className="kasten">
          <b>Das Register ist noch leer.</b> Hier gehören nur belegte Abnahmen aus eigenen Mandatsunterlagen hinein – z. B. per{" "}
          <code>tools/import_abnahmen.py</code> erzeugt und über <a href="#/import">Import</a> als Spur A übernommen. Öffentliche Rechercheergebnisse gehören in den Marktradar.
        </div>
      )}

      <RadarKarte zeilen={kartenZeilen} buero={buero} />

      <div className="karten-leiste">
        {!buero && (
          <span>
            Keine Büroadresse hinterlegt – <a href="#/einstellungen">in den Einstellungen setzen</a>, dann erscheinen Radarringe und Entfernungen.
          </span>
        )}
        {ohnePos.length > 0 && !geoLaeuft && (
          <span>
            {ohnePos.length} Objekt(e) ohne Position.{" "}
            <button className="link" onClick={koordinatenErmitteln}>
              Koordinaten über OpenStreetMap ermitteln
            </button>{" "}
            (ca. {Math.ceil(ohnePos.length * 1.1 * 2)} s)
          </span>
        )}
        {geoLaeuft && <span className="laeuft">Adresssuche läuft … {geoLaeuft}</span>}
      </div>

      <div className="werkzeuge">
        <input type="search" placeholder="Suchen: Projekt, Ort, Bauherr, Auftragnehmer …" value={suche} onChange={(e) => setSuche(e.target.value)} aria-label="Suche" />
        <select value={vertrag} onChange={(e) => setVertrag(e.target.value)} aria-label="Vertragsart">
          <option value="">Vertragsart: alle</option>
          <option value="VOB">VOB/B (4 J.)</option>
          <option value="BGB">BGB (5 J.)</option>
          <option value="unklar">unklar</option>
        </select>
        <select value={typ} onChange={(e) => setTyp(e.target.value)} aria-label="Bauherrentyp">
          <option value="">Bauherr: alle</option>
          <option value="oeff">öffentlich / kommunal</option>
          <option value="priv">privat</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Status: alle</option>
          {statusListe.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="Umfang">
          {(
            [
              ["fenster", "6-Monats-Fenster"],
              ["alle", "Alle"],
              ["archiv", "Archiv"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} aria-pressed={umfang === k} onClick={() => (setUmfang(k), lokalSetzen(`umfang.${spur}`, k))}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="tabelle-rahmen">
        <table className="tabelle">
          <thead>
            <tr>
              {th("projekt", "Projekt / Ort")}
              <th>Bauherr</th>
              <th>Auftragnehmer</th>
              {th("datum", spur === "A" ? "Abnahme" : "Fertigstellung")}
              {th("fristende", "Fristende 4 J. / 5 J.")}
              <th>Resttage</th>
              {spur === "B" && th("prio", "Prio")}
              {th("km", "Entf.")}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sortiert.map((z) => (
              <ZeileRow key={z.o.id} z={z} spur={spur} />
            ))}
          </tbody>
        </table>
        {sortiert.length === 0 && <div className="leer">Keine Einträge im gewählten Umfang.</div>}
      </div>
      <p className="hinweistext">
        <b>Wie die Fristen entstehen.</b>{" "}
        {spur === "B"
          ? "Das Datum ist ein öffentlich genannter Proxy (Übergabe, Eröffnung, Einzug, Zuschlag), nicht die förmliche Abnahme; die tatsächliche Frist kann um Wochen bis Monate abweichen."
          : "Maßgeblich ist die belegte förmliche Abnahme aus den eigenen Unterlagen."}{" "}
        Fristende = Datum + 4 Jahre (VOB/B § 13 Abs. 4) bzw. + 5 Jahre (BGB § 634a), Fristlauf nach §§ 187 Abs. 1, 188 Abs. 2 BGB. Ist die Vertragsart unklar, zählen beide Szenarien.
        Teilabnahmen, TGA-Sonderfristen (2 Jahre ohne Wartungsvertrag), Hemmung und Verjährungsverzicht als manuelles Fristende pflegen. Entfernungen = Luftlinie.
      </p>
    </section>
  );
}

function Kpi({ n, l, k }: { n: number; l: string; k: string }) {
  return (
    <div className={`kpi kpi-${k}`}>
      <div className="kpi-n">{n}</div>
      <div className="kpi-l">{l}</div>
    </div>
  );
}

function ZeileRow({ z, spur }: { z: Zeile; spur: Spur }) {
  const { o, f, km } = z;
  const ap = f.genauigkeit === "Monat" ? "≈ " : "";
  const hit = (d: string | null, j: 4 | 5) => (f.fest ? false : (f.art === "VOB" && j === 4) || (f.art === "BGB" && j === 5) || (f.art === "unklar" && d === f.fristende));
  return (
    <tr className={`zeile zeile-${f.tage === null || f.tage < 0 ? "past" : f.tage <= 90 ? "crit" : f.tage <= 182 ? "warn" : "ok"}`} onClick={() => geheZu(`objekt/${o.id}`)}>
      <td>
        <a className="proj" href={`#/objekt/${o.id}`} onClick={(e) => e.stopPropagation()}>
          {o.projekt}
        </a>
        <div className="sub">{[o.adresse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</div>
      </td>
      <td>{o.bauherr || <span className="sub">–</span>}</td>
      <td>
        {o.auftragnehmer || <span className="sub">nicht öffentlich</span>} {o.rolle_an && <span className="chip">{o.rolle_an}</span>}
      </td>
      <td className="mono">
        {ap}
        {deDatum(f.abnahme)}
        {f.abnahmeGeschaetzt && <div className="sub">geschätzt aus Zuschlag</div>}
        <div className="sub">{o.datumsart}</div>
      </td>
      <td className="mono">
        {f.fest ? (
          <div>
            <b>{deDatum(f.fest)}</b>
            <div className="sub">vertraglich</div>
          </div>
        ) : (
          <div className="f2">
            {f.f4 && (
              <span className={hit(f.f4, 4) ? "hit" : "dim"}>
                {ap}
                {deDatum(f.f4)} <span className="dim">(4 J.)</span>
              </span>
            )}
            {f.f5 && (
              <span className={hit(f.f5, 5) ? "hit" : "dim"}>
                {ap}
                {deDatum(f.f5)} <span className="dim">(5 J.)</span>
              </span>
            )}
          </div>
        )}
        <div className="sub">{f.art === "unklar" ? "Vertragsart unklar" : o.vertragsart}</div>
      </td>
      <td>
        <Ampel f={f} />
        {f.teilweiseAbgelaufen && <div className="sub">4-J.-Fall abgelaufen</div>}
      </td>
      {spur === "B" && (
        <td title={f.ansprachefenster}>
          {f.prioritaet ? <span className={`prio prio-${f.prioritaet}`}>P{f.prioritaet}</span> : "–"}
        </td>
      )}
      <td className="mono">
        {kmText(km)}
        {o.geo_genauigkeit === "ort" && <span className="sub" title="Position nur ungefähr (Ortsmitte)"> ≈</span>}
      </td>
      <td>
        <span className="chip">{o.status || "–"}</span>
      </td>
    </tr>
  );
}
