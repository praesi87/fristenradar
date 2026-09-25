/** CSV-Export (App-Button und wöchentliche Sicherung der GitHub Action) – wieder importierbar. */
import { FELDER, type Objekt } from "./felder";
import { berechne } from "./fristen";
import { entfernungKm } from "./geo";
import { schreibeCsv } from "./csv";

export const EXPORT_KOPF = [
  "_ID",
  "Spur",
  ...FELDER.map((f) => f.csv[0]),
  "Lat",
  "Lon",
  "Geo_Genauigkeit",
  "Archiviert",
  "_Fristende_4J",
  "_Fristende_5J",
  "_Fristende_massgeblich",
  "_Resttage",
  "_Prioritaet",
  "_km_Buero",
  "_Geaendert_am",
  "_Geaendert_von",
];

export function exportCsv(objekte: Objekt[], stichtag: string, buero: { lat: number; lon: number } | null = null): string {
  const zeilen = objekte.map((o) => {
    const f = berechne(o, stichtag);
    const km = buero && o.lat !== null && o.lon !== null ? entfernungKm(buero, { lat: o.lat, lon: o.lon }) : null;
    return {
      _ID: o.id,
      Spur: o.spur,
      ...Object.fromEntries(FELDER.map((fd) => [fd.csv[0], o[fd.key]])),
      Lat: o.lat ?? "",
      Lon: o.lon ?? "",
      Geo_Genauigkeit: o.geo_genauigkeit,
      Archiviert: o.archiviert ? "ja" : "",
      _Fristende_4J: f.f4 ?? "",
      _Fristende_5J: f.f5 ?? "",
      _Fristende_massgeblich: f.fristende ?? "",
      _Resttage: f.tage ?? "",
      _Prioritaet: f.prioritaet ?? "",
      _km_Buero: km === null ? "" : km.toFixed(1),
      _Geaendert_am: o.geaendert_am,
      _Geaendert_von: o.geaendert_von,
    };
  });
  return schreibeCsv(EXPORT_KOPF, zeilen);
}
