/**
 * Brieftext für die Akquise (Port von brieftext() aus tools/legacy/marktradar.py).
 *
 * Kernregel: Es wird nie behauptet, wann die Frist abläuft. Behauptet wird nur, was öffentlich
 * belegbar ist (Vergabe/Fertigstellung); daraus wird eine erkennbar als solche gekennzeichnete
 * Vermutung abgeleitet (Glaubwürdigkeit + § 5 UWG). Geschätzte Werte nur als Monat/Jahr.
 * Bewusst Postbrief, kein E-Mail-Text: § 7 Abs. 2 Nr. 2 UWG (auch B2B).
 */
import type { ObjektDaten } from "./felder";
import { deDatum, monJahr, parseDatum, plusJahre, plusMonate, BAUZEIT_MONATE } from "./fristen";
import { norm } from "./abgleich";

export interface Brief {
  betreff: string;
  text: string;
  sperren: string[];
  warnungen: string[];
}

function absatz(text: string, breite = 76): string {
  const woerter = text.split(/\s+/).filter(Boolean);
  const zeilen: string[] = [];
  let z = "";
  for (const w of woerter) {
    if (z && (z + " " + w).length > breite) {
      zeilen.push(z);
      z = w;
    } else z = z ? `${z} ${w}` : w;
  }
  if (z) zeilen.push(z);
  return zeilen.join("\n");
}

export function istAusgetragen(bauherr: string, austragungen: { name: string }[]): string | null {
  const b = norm(bauherr);
  if (!b) return null;
  for (const a of austragungen) {
    const n = norm(a.name);
    if (n && (b.includes(n) || n.includes(b))) return a.name;
  }
  return null;
}

export function brief(z: ObjektDaten, absender: string, austragungen: { name: string }[], prioritaet: number | null): Brief {
  const sperren: string[] = [];
  const warnungen: string[] = [];
  if (z.spur !== "B") sperren.push("Briefe gibt es nur für Marktradar-Einträge (Spur B).");
  if (!z.quelle.trim()) sperren.push("Keine Quelle – ohne Beleg kein Anschreiben.");
  const aus = istAusgetragen(z.bauherr, austragungen);
  if (aus) sperren.push(`Bauherr steht auf der Austragungsliste („${aus}“) – kein Anschreiben (Widerspruch).`);
  const bezug = parseDatum(z.datum);
  if (!bezug.datum) sperren.push("Kein Datum mit mindestens Monatsangabe – kein Anschreiben.");
  if (prioritaet !== null && prioritaet !== 1) warnungen.push(`Priorität ${prioritaet}: außerhalb des empfohlenen Ansprachefensters (90–550 Tage vor dem frühesten Fristende).`);
  if (!z.anrede.trim()) warnungen.push("Keine persönliche Anrede hinterlegt – „Sehr geehrte Damen und Herren“ wird verwendet.");
  if (!z.bauherr.trim()) warnungen.push("Kein Bauherr hinterlegt – Adressat unklar.");

  const anrede = z.anrede.trim() || "Sehr geehrte Damen und Herren,";
  const projekt = z.projekt.trim();
  const ort = z.ort.trim();
  const an = z.auftragnehmer.trim();
  const leistung = z.leistung.trim();
  const betreff = `Gewährleistungsfristen ${projekt} – Begehung vor Fristablauf`;
  if (!bezug.datum) return { betreff, text: "", sperren, warnungen };

  let beleg: string;
  let folge: string;
  let abnahme: string;
  if (z.bezugsart === "zuschlag") {
    const monate = BAUZEIT_MONATE[z.projektgroesse] ?? BAUZEIT_MONATE.mittel;
    abnahme = plusMonate(bezug.datum, monate);
    const wann = bezug.genauigkeit === "Tag" ? `vom ${deDatum(bezug.datum)}` : `aus dem ${monJahr(bezug.datum)}`;
    beleg = `ausweislich der öffentlichen Vergabebekanntmachung ${wann} haben Sie die Leistung „${leistung}“ für das Objekt ${projekt} in ${ort}` + (an ? ` an die ${an}` : "") + " vergeben";
    folge = `Bei einer für Vorhaben dieser Größe üblichen Bauzeit dürfte die Abnahme im Laufe des Jahres ${abnahme.slice(0, 4)} erfolgt sein.`;
  } else {
    abnahme = bezug.datum;
    beleg = `öffentlich zugänglichen Quellen zufolge wurde das Objekt ${projekt} in ${ort} im ${monJahr(bezug.datum)} fertiggestellt`;
    folge = "Die Abnahme dürfte zeitnah danach erfolgt sein.";
  }
  const frueh = plusJahre(abnahme, 4);
  const spaet = plusJahre(abnahme, 5);

  const absaetze = [
    `${beleg[0].toUpperCase()}${beleg.slice(1)}.`,
    `${folge} Damit liefe die Gewährleistungsfrist – je nachdem, ob VOB/B oder BGB vereinbart wurde – zwischen ${monJahr(frueh)} und ${monJahr(spaet)} ab.`,
    "Das ist ausdrücklich eine Vermutung aus öffentlichen Angaben: Ihr tatsächliches Abnahmedatum kennen wir nicht, und nur dieses zählt. Falls unsere Einschätzung ungefähr zutrifft, ist jetzt allerdings der richtige Zeitpunkt, sich das Objekt anzusehen – eine Gewährleistungsbegehung braucht rund sechs Monate Vorlauf, damit festgestellte Mängel noch vor Fristablauf wirksam gerügt und nachverfolgt werden können. Wer zu spät beginnt, verliert Ansprüche nicht wegen der Mängel, sondern wegen der Uhr.",
    "Wir sind auf genau diesen Abschnitt spezialisiert: strukturierte Begehung vor Fristablauf, Mängelaufnahme mit Beweissicherung, verjährungswirksame Rügen und die Prüfung, ob Gewährleistungsbürgschaften zu Recht zurückgegeben werden sollen.",
    "Wenn das für Sie relevant ist, stelle ich Ihnen unser Vorgehen gern in einem kurzen Gespräch vor – unverbindlich und ohne Vorbereitung Ihrerseits.",
  ];
  const hinweis = `Hinweis: Wir haben Ihre Kontaktdaten öffentlich zugänglichen Quellen entnommen (${z.quelle}). Wenn Sie keine weitere Post von uns wünschen, genügt eine kurze Nachricht – dann tragen wir Sie aus.`;
  const text = `Betreff: ${betreff}\n\n${anrede}\n\n` + absaetze.map((a) => absatz(a)).join("\n\n") + `\n\nMit freundlichen Grüßen\n\n${absender}\n\n` + absatz(hinweis) + "\n";
  return { betreff, text, sperren, warnungen };
}
