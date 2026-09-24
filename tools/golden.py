#!/usr/bin/env python3
"""Erzeugt tests/fixtures/golden.json aus den Python-Originalen (tools/legacy).
Die TypeScript-Fristlogik (src/lib/fristen.ts) muss exakt dieselben Werte liefern.
Aufruf (im Repo-Hauptordner):  python3 tools/golden.py
"""
import csv, datetime as dt, json, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"
STICHTAGE = ["2026-09-02", "2026-09-24", "2027-01-31", "2026-08-31"]
sys.path.insert(0, str(ROOT / "tools" / "legacy"))
import marktradar  # noqa: E402

out = {"dashboard": {}, "marktradar": {}}
with tempfile.TemporaryDirectory() as tmp:
    for st in STICHTAGE:
        html = pathlib.Path(tmp) / f"d{st}.html"
        subprocess.run([sys.executable, str(ROOT / "tools/legacy/build_dashboard.py"), str(FIX / "golden-register.csv"), str(html), f"--stichtag={st}"],
                       check=True, capture_output=True)
        daten = json.loads(re.search(r"const DATA=(\[.*?\]);\n", html.read_text(encoding="utf-8"), re.S).group(1))
        out["dashboard"][st] = [{k: r[k] for k in ("Projekt", "abnahme", "genauigkeit", "art", "fest", "f4", "f5", "fristende", "tage", "im_fenster", "abgelaufen", "teilweise_abgelaufen", "rheinmain")} for r in daten]

with open(FIX / "golden-register.csv", encoding="utf-8") as f:
    zeilen = list(csv.DictReader(f, delimiter=";"))
for st in STICHTAGE:
    liste = []
    for z in zeilen:
        d = z["Abnahme/Fertigstellung"]
        if len(d) != 10 or z["Vertragsart"] != "unklar":
            continue  # marktradar.py kennt nur taggenaue Daten und rechnet immer 4 UND 5 Jahre
        for art, groesse in (("fertigstellung", ""), ("zuschlag", "klein"), ("zuschlag", "gross"), ("zuschlag", "")):
            b, fehler = marktradar.bewerten({"Quelle": "x", "Bezugsdatum": d, "Bezugsart": art, "Projektgroesse": groesse}, dt.date.fromisoformat(st))
            liste.append({"Projekt": z["Projekt"], "datum": d, "bezugsart": art, "projektgroesse": groesse, **{k: v for k, v in b.items() if not k.startswith("_")}})
    out["marktradar"][st] = liste

(FIX / "golden.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"golden.json: {sum(len(v) for v in out['dashboard'].values())} Dashboard-, {sum(len(v) for v in out['marktradar'].values())} Marktradar-Fälle")

# Brieftexte (fertigstellung + zuschlag)
briefe = []
for z, b_in in [
    ({"Projekt": "TEST Kita Beispiel-Hof", "Ort": "Frankfurt am Main", "Bezugsdatum": "2023-02-01", "Bezugsart": "fertigstellung", "Quelle": "https://beispiel.invalid/kita-beispiel-hof/presse-meldung-zur-eroeffnung", "Anrede": "Sehr geehrte Frau Test,", "Leistung": "Neubau Kita", "Auftragnehmer": ""}, "2026-09-24"),
    ({"Projekt": "TEST Verwaltungsbau", "Ort": "Mainz", "Bezugsdatum": "2021-06-15", "Bezugsart": "zuschlag", "Projektgroesse": "gross", "Quelle": "https://ted.europa.eu/de/notice/-/detail/123456-2021", "Anrede": "", "Leistung": "Rohbauarbeiten", "Auftragnehmer": "Test Bau AG"}, "2026-09-24"),
]:
    b, _ = marktradar.bewerten(z, dt.date.fromisoformat(b_in))
    betreff, text = marktradar.brieftext(z, b, "Max Test\nBereichsleitung\nclaim.m GmbH")
    briefe.append({"eingabe": z, "betreff": betreff, "text": text})
out["briefe"] = briefe
(FIX / "golden.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(briefe)} Brieftexte")
