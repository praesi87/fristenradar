/** Minimaler, robuster CSV-Parser/-Writer (RFC 4180, Trennzeichen ; oder , automatisch erkannt). */

export function erkenneTrenner(text: string): ";" | "," | "\t" {
  const kopf = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const z = (c: string) => kopf.split(c).length;
  if (z("\t") > z(";") && z("\t") > z(",")) return "\t";
  return z(";") >= z(",") ? ";" : ",";
}

export function parseCsv(text: string, trenner?: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const d = trenner ?? erkenneTrenner(t);
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let inQuote = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuote) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          feld += '"';
          i++;
        } else inQuote = false;
      } else feld += c;
    } else if (c === '"' && feld === "") inQuote = true;
    else if (c === d) {
      zeile.push(feld);
      feld = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = "";
    } else feld += c;
  }
  if (feld !== "" || zeile.length) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen.filter((z) => z.some((f) => f.trim() !== ""));
}

/** CSV → Objekte mit Spaltennamen als Schlüssel (Kopfzeile getrimmt) */
export function csvZuDatensaetzen(text: string): { kopf: string[]; zeilen: Record<string, string>[] } {
  const roh = parseCsv(text);
  if (!roh.length) return { kopf: [], zeilen: [] };
  const kopf = roh[0].map((h) => h.trim());
  const zeilen = roh.slice(1).map((r) => Object.fromEntries(kopf.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { kopf, zeilen };
}

function zelle(v: unknown, d: string): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /["\r\n]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel-freundlich: UTF-8 mit BOM, Semikolon, CRLF */
export function schreibeCsv(kopf: string[], zeilen: Record<string, unknown>[], d = ";"): string {
  const lines = [kopf.map((h) => zelle(h, d)).join(d), ...zeilen.map((z) => kopf.map((h) => zelle(z[h], d)).join(d))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
