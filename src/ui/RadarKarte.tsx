/**
 * OpenStreetMap im Radarstil (Leaflet).
 * - Kacheln von tile.openstreetmap.org, per CSS dunkel eingefärbt (Nutzungsbedingungen: Quellenangabe, keine Massenabrufe)
 * - Büro als Radarzentrum mit Entfernungsringen und optionalem Sweep
 * - Fähnchen je Objekt in Ampelfarbe, Führungslinie zu einem grünen Monospace-Label (wie Flugradar)
 * - Klick: Popup mit allen Angaben, Luftlinie + Richtung vom Büro, Routenlink
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { ampel } from "../lib/fristen";
import { deDatum } from "../lib/fristen";
import { entfernungKm, himmelsrichtung, peilung, routenLink } from "../lib/geo";
import type { Buero } from "../lib/store";
import { type Zeile, kmText, resttageText } from "./gemeinsam";
import { lokal, lokalSetzen } from "./kontext";

const RINGE_KM = [10, 25, 50, 75];
const RHEIN_MAIN: L.LatLngTuple = [50.05, 8.65];
const KACHELN = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Radar-Look für die normalen OSM-Kacheln: Graustufen, dann eine Helligkeitskurve, die helle Flächen (Land)
 * dunkel und Straßen hell macht – wie auf einem Flugradar. Stützpunkte [Helligkeit Kachel → Helligkeit Radar];
 * zum Nachjustieren nur diese Tabelle ändern. Werte grob kalibriert an den Standardfarben des OSM-Stils
 * (Land ≈ 0,94 · Nebenstraßen weiß · Hauptstraßen ≈ 0,86 · Autobahn ≈ 0,65 · Wasser ≈ 0,80 · Beschriftung dunkel).
 */
export const RADAR_KURVE: [number, number][] = [
  [0, 0.78], [0.3, 0.72], [0.5, 0.58], [0.66, 0.58], [0.74, 0.2], [0.79, 0.15], [0.81, 0.2], [0.84, 0.3],
  [0.87, 0.3], [0.895, 0.11], [0.92, 0.085], [0.955, 0.085], [0.975, 0.24], [1, 0.44],
];
const TOENUNG = [0.86, 1, 0.9]; // leichter Grünstich (R, G, B)

function stelleFilterSicher() {
  if (document.getElementById("radar-kachelfilter")) return;
  const kurve = (v: number) => {
    for (let i = 1; i < RADAR_KURVE.length; i++)
      if (v <= RADAR_KURVE[i][0]) {
        const [a, fa] = RADAR_KURVE[i - 1];
        const [b, fb] = RADAR_KURVE[i];
        return fa + ((fb - fa) * (v - a)) / (b - a);
      }
    return RADAR_KURVE[RADAR_KURVE.length - 1][1];
  };
  const tabelle = (k: number) => Array.from({ length: 256 }, (_, i) => (kurve(i / 255) * TOENUNG[k]).toFixed(3)).join(" ");
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.innerHTML = `<filter id="radar-kachelfilter" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>
    <feFuncR type="table" tableValues="${tabelle(0)}"/><feFuncG type="table" tableValues="${tabelle(1)}"/><feFuncB type="table" tableValues="${tabelle(2)}"/></feComponentTransfer></filter>`;
  document.body.appendChild(svg);
}

function esc(s: string): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function kurzname(p: string): string {
  const s = p.replace(/\s*[–-]\s*(Neubau|Sanierung|Umbau.*)$/i, "").trim();
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

function kurzDatum(iso: string | null): string {
  if (!iso) return "--.--.--";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

type Versatz = { dx: number; dy: number };
type Rechteck = { x0: number; y0: number; x1: number; y1: number };

/** Startwinkel je Objekt (goldener Winkel) – deterministisch, damit Labels nicht springen */
function startWinkel(id: number): number {
  return (id * 137.508) % 360;
}

function labelRechteck(p: L.Point, v: Versatz, breite: number): Rechteck {
  const x = v.dx >= 0 ? p.x + v.dx + 4 : p.x + v.dx - 4 - breite;
  const y = p.y - 19 + v.dy - 18;
  return { x0: x, y0: y, x1: x + breite, y1: y + 40 };
}

function ueberlappung(a: Rechteck, b: Rechteck): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Einfache Kollisionsvermeidung: dringendste Objekte zuerst; je Objekt 16 Kandidatenpositionen
 * (8 Richtungen × 2 Abstände), gewählt wird die mit der geringsten Überdeckung bereits gesetzter Labels/Fähnchen.
 */
function platziere(m: L.Map, zeilen: Zeile[]): Map<number, Versatz> {
  const ergebnis = new Map<number, Versatz>();
  const belegt: Rechteck[] = [];
  const punkte = zeilen.map((z) => ({ z, p: m.latLngToContainerPoint([z.o.lat!, z.o.lon!]) }));
  for (const { p } of punkte) belegt.push({ x0: p.x - 3, y0: p.y - 20, x1: p.x + 14, y1: p.y + 2 });
  const reihenfolge = [...punkte].sort((a, b) => (a.z.f.tage ?? 1e6) - (b.z.f.tage ?? 1e6));
  for (const { z, p } of reihenfolge) {
    const breite = Math.min(28, kurzname(z.o.projekt).length) * 6.4 + 6;
    const w0 = startWinkel(z.o.id);
    let best: { v: Versatz; k: number } | null = null;
    for (const r of [38, 72]) {
      for (let i = 0; i < 8; i++) {
        const w = ((w0 + i * 45) % 360) * (Math.PI / 180);
        const v = { dx: Math.round(Math.cos(w) * r), dy: Math.round(Math.sin(w) * r) };
        const rect = labelRechteck(p, v, breite);
        const k = belegt.reduce((s, b) => s + ueberlappung(rect, b), 0) + (r > 38 ? 40 : 0) + i;
        if (!best || k < best.k) best = { v, k };
        if (k < 10) break;
      }
      if (best && best.k < 50) break;
    }
    ergebnis.set(z.o.id, best!.v);
    belegt.push(labelRechteck(p, best!.v, breite));
  }
  return ergebnis;
}

function fahnenIcon(z: Zeile, labels: boolean, v: Versatz): L.DivIcon {
  const a = ampel(z.f.tage);
  const { dx, dy } = v;
  const lx = dx >= 0 ? dx + 4 : dx - 4;
  const ausrichtung = dx >= 0 ? "links" : "rechts";
  const art = z.f.fest ? "VTR" : z.f.art === "VOB" ? "VOB" : z.f.art === "BGB" ? "BGB" : "4/5";
  const prio = z.o.spur === "B" && z.f.prioritaet ? ` P${z.f.prioritaet}` : "";
  const ungefaehr = z.o.geo_genauigkeit === "ort" ? " ≈" : "";
  const html = `
    <div class="rb rb-${a}${labels ? "" : " rb-ohne-label"}">
      <svg class="rb-linie" width="1" height="1" overflow="visible" aria-hidden="true"><line x1="0" y1="0" x2="${dx}" y2="${dy}"/></svg>
      <svg class="rb-fahne" viewBox="0 0 14 18" width="14" height="18" aria-hidden="true"><path d="M1.5 17.5V1.2" /><path class="rb-tuch" d="M2 1.5h10.5l-3 3.6 3 3.6H2z"/></svg>
      <div class="rb-label rb-${ausrichtung}" style="left:${lx}px;top:${dy - 18}px">
        <b>${esc(kurzname(z.o.projekt).toUpperCase())}</b>
        <span>FR ${kurzDatum(z.f.fristende)} ${z.f.tage === null ? "" : z.f.tage < 0 ? "ABGL" : String(z.f.tage).padStart(3, "0") + "T"}</span>
        <span>${art}${prio} · ${z.km === null ? "--" : Math.round(z.km) + "KM"}${ungefaehr}</span>
      </div>
    </div>`;
  // Klickfläche = Fähnchen (16×20 px); Fußpunkt der Stange liegt exakt auf der Koordinate
  return L.divIcon({ html, className: "rb-icon", iconSize: [16, 20], iconAnchor: [1, 19], popupAnchor: [6, -16] });
}

export function popupHtml(z: Zeile, buero: Buero | null): string {
  const o = z.o;
  const f = z.f;
  const zeile = (k: string, v: string) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "");
  const pos = o.lat !== null && o.lon !== null ? { lat: o.lat, lon: o.lon } : null;
  const entf =
    buero && pos
      ? `<div class="pp-entf"><b>${kmText(entfernungKm(buero, pos))}</b> Luftlinie vom Büro · Richtung ${himmelsrichtung(peilung(buero, pos))}
         <a href="${routenLink(buero, pos)}" target="_blank" rel="noopener">Route in OpenStreetMap ↗</a></div>`
      : `<div class="pp-entf">Entfernung: ${buero ? "keine Koordinaten" : "Büroadresse in den Einstellungen hinterlegen"}</div>`;
  const frist = f.fest
    ? `${deDatum(f.fest)} (vertraglich)`
    : [f.f4 && `${deDatum(f.f4)} (4 J.)`, f.f5 && `${deDatum(f.f5)} (5 J.)`].filter(Boolean).join(" · ");
  return `
    <div class="pp">
      <div class="pp-kopf pp-${ampel(f.tage)}"><span class="eyebrow">${o.spur === "A" ? "Register" : "Marktradar"} · #${o.id}</span><strong>${esc(o.projekt)}</strong>
        <span>${esc([o.adresse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</span></div>
      ${entf}
      <table class="pp-tab">
        ${zeile("Resttage", `<b>${resttageText(f)}</b>${f.teilweiseAbgelaufen ? " (4-J.-Fall bereits abgelaufen)" : ""}`)}
        ${zeile("Fristende", frist || "–")}
        ${zeile("Vertragsart", esc(o.vertragsart))}
        ${zeile(o.bezugsart === "abnahme" ? "Abnahme" : o.bezugsart === "zuschlag" ? "Zuschlag" : "Fertigstellung", `${f.genauigkeit === "Monat" ? "≈ " : ""}${deDatum(o.datum)} ${o.datumsart ? `<span class="pp-dim">(${esc(o.datumsart)})</span>` : ""}`)}
        ${o.spur === "B" && f.prioritaet ? zeile("Ansprache", `P${f.prioritaet} · ${esc(f.ansprachefenster)}`) : ""}
        ${zeile("Status", esc(o.status))}
        ${zeile("Leistung", esc(o.leistung))}
        ${zeile("Bauherr", esc(o.bauherr))}
        ${zeile("Ansprechpartner", esc(o.ansprechpartner))}
        ${zeile("Auftragnehmer", esc([o.auftragnehmer, o.rolle_an && `(${o.rolle_an})`].filter(Boolean).join(" ")))}
        ${zeile("Property Mgr.", esc(o.property_manager))}
        ${zeile("Sicherheit", esc(o.sicherheit))}
        ${zeile("Konfidenz", esc(o.konfidenz))}
        ${zeile("Bemerkung", esc(o.bemerkung))}
        ${zeile("Quelle", /^https?:\/\//.test(o.quelle) ? `<a href="${esc(o.quelle)}" target="_blank" rel="noopener">${esc(o.quelle_titel || o.quelle)}</a>` : esc(o.quelle))}
      </table>
      ${o.geo_genauigkeit === "ort" ? `<div class="pp-hinweis">Position ungefähr (nur Ort/PLZ gefunden) – in den Details korrigierbar.</div>` : ""}
      <a class="knopf pp-knopf" href="#/objekt/${o.id}">Details öffnen / bearbeiten →</a>
    </div>`;
}

interface Props {
  zeilen: Zeile[];
  buero: Buero | null;
  hoehe?: number;
  /** Detailansicht: ein verschiebbares Fähnchen */
  ziehbar?: boolean;
  onVerschoben?(lat: number, lon: number): void;
}

export function RadarKarte({ zeilen, buero, hoehe = 520, ziehbar = false, onVerschoben }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const karte = useRef<L.Map | null>(null);
  const ebene = useRef<L.LayerGroup | null>(null);
  const ringe = useRef<L.LayerGroup | null>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const gefittet = useRef(0);
  const [labels, setLabels] = useState<boolean>(() => lokal("karte.labels", true));
  const [sweep, setSweep] = useState<boolean>(() => lokal("karte.sweep", !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const [zoom, setZoom] = useState(9);

  // Karte einmalig anlegen
  useEffect(() => {
    if (!div.current || karte.current) return;
    stelleFilterSicher();
    const m = L.map(div.current, { center: RHEIN_MAIN, zoom: 9, zoomControl: true, attributionControl: true, preferCanvas: false });
    L.tileLayer(KACHELN, {
      maxZoom: 18,
      className: "radar-kachel",
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    ringe.current = L.layerGroup().addTo(m);
    ebene.current = L.layerGroup().addTo(m);
    m.on("zoomend", () => setZoom(m.getZoom()));
    karte.current = m;
    return () => {
      m.remove();
      karte.current = null;
    };
  }, []);

  // Radarzentrum + Ringe
  useEffect(() => {
    const m = karte.current;
    const g = ringe.current;
    if (!m || !g) return;
    g.clearLayers();
    if (!buero) return;
    const c: L.LatLngTuple = [buero.lat, buero.lon];
    for (const km of RINGE_KM) {
      L.circle(c, { radius: km * 1000, className: "radar-ring", interactive: false, fill: false }).addTo(g);
      const lbl = L.latLng(buero.lat + km / 111.2, buero.lon);
      L.marker(lbl, { interactive: false, icon: L.divIcon({ className: "radar-ringlabel", html: `${km} km`, iconSize: [0, 0] }) }).addTo(g);
    }
    L.marker(c, {
      icon: L.divIcon({ className: "radar-zentrum", html: `<div class="rz"><span></span></div>`, iconSize: [0, 0] }),
      title: `Büro: ${buero.adresse}`,
      zIndexOffset: -1000,
    })
      .bindPopup(`<div class="pp"><div class="pp-kopf"><span class="eyebrow">Radarzentrum</span><strong>Büro</strong><span>${esc(buero.adresse)}</span></div></div>`)
      .addTo(g);
  }, [buero]);

  // Fähnchen
  useEffect(() => {
    const m = karte.current;
    const g = ebene.current;
    if (!m || !g) return;
    g.clearLayers();
    const mitPos = zeilen.filter((z) => z.o.lat !== null && z.o.lon !== null);
    const zeigeLabels = labels && (zoom >= 9 || mitPos.length <= 25);
    const lagen = platziere(m, mitPos);
    for (const z of mitPos) {
      const mk = L.marker([z.o.lat!, z.o.lon!], { icon: fahnenIcon(z, zeigeLabels, lagen.get(z.o.id)!), draggable: ziehbar, riseOnHover: true, keyboard: true, title: z.o.projekt });
      if (!ziehbar) mk.bindPopup(() => popupHtml(z, buero), { maxWidth: 380, minWidth: 280, className: "radar-popup", autoPanPadding: [30, 30] });
      if (ziehbar && onVerschoben)
        mk.on("dragend", () => {
          const p = mk.getLatLng();
          onVerschoben(p.lat, p.lng);
        });
      mk.addTo(g);
    }
    // Ausschnitt anpassen, wenn neue Positionen hinzukommen (erstes Laden, nach Adresssuche) – sonst nicht springen
    if (mitPos.length > gefittet.current) {
      einpassen();
      gefittet.current = mitPos.length;
    }
  }, [zeilen, buero, labels, zoom, ziehbar, onVerschoben]);

  function einpassen() {
    const m = karte.current;
    if (!m) return;
    const punkte = zeilen.filter((z) => z.o.lat !== null && z.o.lon !== null).map((z) => L.latLng(z.o.lat!, z.o.lon!));
    if (buero && !ziehbar) punkte.push(L.latLng(buero.lat, buero.lon));
    if (punkte.length > 1) m.fitBounds(L.latLngBounds(punkte).pad(0.12), { maxZoom: ziehbar ? 15 : 12, animate: false });
    else if (punkte.length === 1) m.setView(punkte[0], ziehbar ? 15 : 11, { animate: false });
  }

  // Sweep am Büro ausrichten
  useEffect(() => {
    const m = karte.current;
    if (!m) return;
    const setze = () => {
      const el = sweepRef.current;
      if (!el || !buero) return;
      const p = m.latLngToContainerPoint([buero.lat, buero.lon]);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    };
    setze();
    m.on("move zoom resize", setze);
    return () => {
      m.off("move zoom resize", setze);
    };
  }, [buero, sweep]);

  const ohnePos = zeilen.filter((z) => z.o.lat === null || z.o.lon === null).length;

  return (
    <div className="radar" style={{ height: hoehe }}>
      <div ref={div} className="radar-karte" role="application" aria-label="Radar-Karte der Objekte" />
      <div className="radar-raster" aria-hidden="true" />
      {sweep && buero && !ziehbar && (
        <div ref={sweepRef} className="radar-sweep" aria-hidden="true">
          <div />
        </div>
      )}
      {!ziehbar && (
        <div className="radar-hud">
          <div className="radar-hud-titel">FRISTENRADAR · RHEIN-MAIN</div>
          <div>
            {zeilen.length - ohnePos} OBJ. AUF KARTE{ohnePos ? ` · ${ohnePos} OHNE POSITION` : ""}
          </div>
          <div className="radar-hud-knoepfe">
            <button aria-pressed={labels} onClick={() => (setLabels(!labels), lokalSetzen("karte.labels", !labels))}>
              LABELS
            </button>
            <button aria-pressed={sweep} onClick={() => (setSweep(!sweep), lokalSetzen("karte.sweep", !sweep))}>
              SWEEP
            </button>
            <button onClick={einpassen}>ALLE</button>
          </div>
          <div className="radar-legende">
            <span className="lg lg-crit">≤90T</span>
            <span className="lg lg-warn">≤6M</span>
            <span className="lg lg-ok">&gt;6M</span>
            <span className="lg lg-past">ABGL</span>
          </div>
        </div>
      )}
    </div>
  );
}
