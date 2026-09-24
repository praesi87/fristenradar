import { useState } from "react";
import { useApp } from "./kontext";
import { geokodiereText } from "../lib/geo";
import type { Buero } from "../lib/store";

export function EinstellungenSeite() {
  const { buero, store, neuLaden, melde } = useApp();
  const [adresse, setAdresse] = useState(buero?.adresse ?? "");
  const [lat, setLat] = useState(buero ? String(buero.lat) : "");
  const [lon, setLon] = useState(buero ? String(buero.lon) : "");
  const [sucht, setSucht] = useState(false);

  async function suchen() {
    setSucht(true);
    try {
      const t = await geokodiereText(adresse);
      if (!t) melde("Adresse nicht gefunden. Bitte genauer schreiben (Straße Hausnr., PLZ Ort) oder Koordinaten eintragen.", "fehler");
      else {
        setLat(t.lat.toFixed(6));
        setLon(t.lon.toFixed(6));
        melde(`Gefunden: ${t.anzeige}`);
      }
    } catch (e) {
      melde((e as Error).message, "fehler");
    } finally {
      setSucht(false);
    }
  }

  async function speichern() {
    const b: Buero = { adresse: adresse.trim(), lat: Number(lat.replace(",", ".")), lon: Number(lon.replace(",", ".")) };
    if (!b.adresse || !Number.isFinite(b.lat) || !Number.isFinite(b.lon) || Math.abs(b.lat) > 90 || Math.abs(b.lon) > 180) return melde("Adresse und gültige Koordinaten nötig.", "fehler");
    try {
      await store.einstellungSetzen("buero", b);
      await neuLaden();
      melde("Büroadresse gespeichert – gilt für das ganze Team.");
    } catch (e) {
      melde((e as Error).message, "fehler");
    }
  }

  return (
    <section>
      <div className="seitenkopf">
        <div>
          <div className="eyebrow">Team-weit</div>
          <h1>Einstellungen</h1>
        </div>
      </div>
      <div className="kasten">
        <h2>Büroadresse (Radarzentrum)</h2>
        <p className="unterzeile">Mittelpunkt der Radarringe und Bezugspunkt für alle Entfernungen (Luftlinie).</p>
        <div className="felder">
          <label className="feld feld-breit">
            <span>Adresse</span>
            <input value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="Straße Hausnr., PLZ Frankfurt am Main" />
          </label>
          <label className="feld">
            <span>Breite (lat)</span>
            <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
          </label>
          <label className="feld">
            <span>Länge (lon)</span>
            <input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
          </label>
        </div>
        <div className="knopfreihe">
          <button className="knopf knopf-zweit" disabled={!adresse.trim() || sucht} onClick={suchen}>
            {sucht ? "Sucht …" : "Koordinaten suchen (OpenStreetMap)"}
          </button>
          <button className="knopf" onClick={speichern}>
            Speichern
          </button>
        </div>
      </div>
      <div className="kasten">
        <h2>Modus</h2>
        <p>
          {store.modus === "demo"
            ? "Demo-Modus: keine Datenbank verbunden. In GitHub unter Settings → Variables die Werte SUPABASE_URL und SUPABASE_ANON_KEY setzen und neu deployen."
            : "Verbunden mit Supabase. Rechte werden in der Datenbank geprüft (Freischaltliste erlaubte_nutzer)."}
        </p>
      </div>
    </section>
  );
}
