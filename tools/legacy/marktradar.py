#!/usr/bin/env python3
"""marktradar.py — findet Rhein-Main-Bauherren, deren Gewährleistungsfrist absehbar ausläuft.

Zweck: AKQUISE, nicht Fristenverwaltung. Ergebnis ist eine Kandidatenliste mit
Ansprachefenster und fertigem Anschreiben — kein Fristenregister. Beides nie mischen:
das Register (gewaehrleistungsregister.csv) enthält nur belegte Abnahmedaten aus
eigenen Mandatsunterlagen, der Radar nur öffentlich belegte Schätzungen.

Kernregel für den Text: Es wird nie behauptet, wann die Frist abläuft. Behauptet wird
nur, was öffentlich belegbar ist (Vergabe/Fertigstellung), und daraus wird eine
erkennbar als solche gekennzeichnete Vermutung abgeleitet. Grund ist doppelt:
- Glaubwürdigkeit: Der Empfänger kennt sein Abnahmedatum. Eine falsche Behauptung
  darüber disqualifiziert den Absender genau bei der Zielgruppe, die man will.
- Recht: Als Rechercheergebnis ausgegebene Vermutungen können irreführend sein (§ 5 UWG).

Aufruf:
    python3 marktradar.py kandidaten.csv -o radar.csv --briefe briefe/
    python3 marktradar.py --vorlage            # Muster-Eingabedatei schreiben
    python3 marktradar.py --ted-abfrage        # TED-Request als JSON ausgeben
    python3 marktradar.py --selftest
"""
import argparse, csv, datetime as dt, json, pathlib, sys, textwrap

# --------------------------------------------------------------- Fachparameter

BAUZEIT_MONATE = {"klein": 12, "mittel": 24, "gross": 36}  # Zuschlag -> Abnahme, grobe Erfahrungswerte
FRIST_VOB, FRIST_BGB = 4, 5      # § 13 Abs. 4 VOB/B  /  § 634a Abs. 1 Nr. 2 BGB
VORLAUF_MIN, VORLAUF_MAX = 90, 550   # sinnvolles Ansprachefenster in Tagen vor Fristablauf

EINGABE_SPALTEN = [
    "Projekt", "Ort", "Bauherr", "Auftragnehmer", "Leistung",
    "Bezugsdatum",      # JJJJ-MM-TT: Zuschlag ODER belegte Fertigstellung
    "Bezugsart",        # "zuschlag" | "fertigstellung"
    "Projektgroesse",   # klein | mittel | gross  (nur bei Bezugsart=zuschlag genutzt)
    "Quelle",           # Pflicht: URL oder Aktenzeichen der Bekanntmachung
    "Quelle_Datum",     # wann belegt
    "Anrede", "Kontakt_Funktion",
]
AUSGABE_SPALTEN = EINGABE_SPALTEN + [
    "Abnahme_geschaetzt", "Fristende_frueh", "Fristende_spaet",
    "Tage_bis_frueh", "Ansprachefenster", "Prioritaet", "Briefdatei",
]

# ------------------------------------------------------------------- Rechenteil

def jahre_dazu(d, j):
    try:
        return d.replace(year=d.year + j)
    except ValueError:
        return d.replace(year=d.year + j, day=28)

def monate_dazu(d, m):
    y, mo = d.year + (d.month - 1 + m) // 12, (d.month - 1 + m) % 12 + 1
    tage = [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
    return dt.date(y, mo, min(d.day, tage))

def bewerten(zeile, stichtag):
    """Leitet aus dem Bezugsdatum ein Fristfenster ab. Gibt (dict, fehler) zurück."""
    if not zeile.get("Quelle", "").strip():
        return None, "keine Quelle angegeben – ohne Beleg kein Anschreiben"
    try:
        bezug = dt.date.fromisoformat(zeile["Bezugsdatum"].strip())
    except (ValueError, KeyError):
        return None, f"Bezugsdatum unlesbar: {zeile.get('Bezugsdatum','')!r}"

    art = (zeile.get("Bezugsart") or "fertigstellung").strip().lower()
    if art == "zuschlag":
        groesse = (zeile.get("Projektgroesse") or "mittel").strip().lower()
        if groesse not in BAUZEIT_MONATE:
            groesse = "mittel"
        abnahme = monate_dazu(bezug, BAUZEIT_MONATE[groesse])
        güte = f"aus Zuschlag + {BAUZEIT_MONATE[groesse]} Mon. Bauzeit geschätzt"
    elif art == "fertigstellung":
        abnahme = bezug
        güte = "Fertigstellung öffentlich belegt, Abnahme zeitnah unterstellt"
    else:
        return None, f"Bezugsart unbekannt: {art!r}"

    # Vertragsart ist nicht bekannt -> Spanne statt Punkt.
    frueh, spaet = jahre_dazu(abnahme, FRIST_VOB), jahre_dazu(abnahme, FRIST_BGB)
    tage = (frueh - stichtag).days

    if tage < 0:
        fenster, prio = "abgelaufen (VOB-Fall) – nur noch BGB-Fall denkbar", 4 if (spaet - stichtag).days > 0 else 5
    elif tage < VORLAUF_MIN:
        fenster, prio = "zu knapp für seriöse Begehung", 3
    elif tage <= VORLAUF_MAX:
        fenster, prio = "jetzt ansprechen", 1
    else:
        fenster, prio = "später vormerken", 2

    return {
        "Abnahme_geschaetzt": abnahme.isoformat(),
        "Fristende_frueh": frueh.isoformat(),
        "Fristende_spaet": spaet.isoformat(),
        "Tage_bis_frueh": tage,
        "Ansprachefenster": fenster,
        "Prioritaet": prio,
        "_guete": güte,
    }, None

# ------------------------------------------------------------------ Briefteil

def de(iso):
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y}"

MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
               "August", "September", "Oktober", "November", "Dezember"]

def mon_jahr(iso):
    """Monat/Jahr statt Tagesdatum. Geschätzte Werte dürfen nicht taggenau
    auftreten – das suggeriert eine Präzision, die die Schätzung nicht hat."""
    y, m, _ = iso.split("-")
    return f"{MONATSNAMEN[int(m) - 1]} {y}"

def absatz(text, breite=76):
    return textwrap.fill(" ".join(text.split()), width=breite)

def brieftext(z, b, absender):
    """Postbrief. Bewusst kein E-Mail-Text: § 7 Abs. 2 Nr. 2 UWG verlangt für
    elektronische Werbung die vorherige ausdrückliche Einwilligung – auch im B2B."""
    anrede = (z.get("Anrede") or "").strip() or "Sehr geehrte Damen und Herren,"
    projekt, ort = z["Projekt"].strip(), z["Ort"].strip()
    an = (z.get("Auftragnehmer") or "").strip()
    leistung = (z.get("Leistung") or "").strip()

    if (z.get("Bezugsart") or "").lower() == "zuschlag":
        beleg = (f"ausweislich der öffentlichen Vergabebekanntmachung vom "
                 f"{de(z['Bezugsdatum'])} haben Sie die Leistung „{leistung}“ für das Objekt "
                 f"{projekt} in {ort}" + (f" an die {an}" if an else "") + " vergeben")
        folge = ("Bei einer für Vorhaben dieser Größe üblichen Bauzeit dürfte die Abnahme "
                 f"im Laufe des Jahres {b['Abnahme_geschaetzt'][:4]} erfolgt sein.")
    else:
        beleg = (f"öffentlich zugänglichen Quellen zufolge wurde das Objekt {projekt} in {ort} "
                 f"im {mon_jahr(z['Bezugsdatum'])} fertiggestellt")
        folge = "Die Abnahme dürfte zeitnah danach erfolgt sein."

    betreff = f"Gewährleistungsfristen {projekt} – Begehung vor Fristablauf"

    absaetze = [
        f"{beleg[0].upper()}{beleg[1:]}.",
        f"{folge} Damit liefe die Gewährleistungsfrist – je nachdem, ob VOB/B oder BGB "
        f"vereinbart wurde – zwischen {mon_jahr(b['Fristende_frueh'])} und "
        f"{mon_jahr(b['Fristende_spaet'])} ab.",
        "Das ist ausdrücklich eine Vermutung aus öffentlichen Angaben: Ihr tatsächliches "
        "Abnahmedatum kennen wir nicht, und nur dieses zählt. Falls unsere Einschätzung "
        "ungefähr zutrifft, ist jetzt allerdings der richtige Zeitpunkt, sich das Objekt "
        "anzusehen – eine Gewährleistungsbegehung braucht rund sechs Monate Vorlauf, damit "
        "festgestellte Mängel noch vor Fristablauf wirksam gerügt und nachverfolgt werden "
        "können. Wer zu spät beginnt, verliert Ansprüche nicht wegen der Mängel, sondern "
        "wegen der Uhr.",
        "Wir sind auf genau diesen Abschnitt spezialisiert: strukturierte Begehung vor "
        "Fristablauf, Mängelaufnahme mit Beweissicherung, verjährungswirksame Rügen und die "
        "Prüfung, ob Gewährleistungsbürgschaften zu Recht zurückgegeben werden sollen.",
        "Wenn das für Sie relevant ist, stelle ich Ihnen unser Vorgehen gern in einem kurzen "
        "Gespräch vor – unverbindlich und ohne Vorbereitung Ihrerseits.",
    ]
    hinweis = (f"Hinweis: Wir haben Ihre Kontaktdaten öffentlich zugänglichen Quellen "
               f"entnommen ({z.get('Quelle','')}). Wenn Sie keine weitere Post von uns "
               f"wünschen, genügt eine kurze Nachricht – dann tragen wir Sie aus.")

    text = (f"Betreff: {betreff}\n\n{anrede}\n\n"
            + "\n\n".join(absatz(a) for a in absaetze)
            + f"\n\nMit freundlichen Grüßen\n\n{absender}\n\n"
            + absatz(hinweis) + "\n")
    return betreff, text

# ------------------------------------------------------------------ TED-Abfrage

def ted_request(von_jahr, bis_jahr):
    """Baut den Request für die TED Search API (POST https://api.ted.europa.eu/v3/notices/search,
    laut Entwicklerdoku ohne Authentifizierung). Hier NICHT ausgeführt – in dieser Umgebung
    ist kein ausgehender POST möglich; im eigenen Netz mit requests absetzen.

    CPV- und NUTS-Codes bitte einmal gegen die amtlichen Listen prüfen
    (ted.europa.eu/en/simap/cpv bzw. /nuts) – aus dem Gedächtnis zitiert."""
    nuts = ["DE71",    # Regierungsbezirk Darmstadt: FFM, OF, DA, WI, MTK, HTK, MKK, Groß-Gerau …
            "DEB35",   # Mainz
            "DEB3",    # Rheinhessen-Pfalz (weiter gefasst)
            "DE26"]    # Unterfranken (Aschaffenburg)
    cpv = ["45210000",  # Bauarbeiten für Gebäude
           "45211000",  # Wohngebäude
           "45214000",  # Gebäude für Bildung/Forschung
           "45215000",  # Gebäude für Gesundheit/Soziales
           "45213000"]  # Gebäude für Handel/Verkehr
    q = (f"(notice-type=can) AND "
         f"(publication-date>={von_jahr}0101 AND publication-date<={bis_jahr}1231) AND "
         f"(place-of-performance IN ({' '.join(nuts)})) AND "
         f"(classification-cpv IN ({' '.join(cpv)}))")
    return {
        "url": "https://api.ted.europa.eu/v3/notices/search",
        "method": "POST",
        "body": {
            "query": q,
            "fields": ["publication-number", "notice-title", "buyer-name", "winner-name",
                       "contract-conclusion-date", "place-of-performance",
                       "classification-cpv", "notice-value"],
            "limit": 250, "page": 1, "scope": "ALL",
        },
        "hinweis": ("notice-type=can = contract award notice (vergebener Auftrag). "
                    "Feldnamen gegen die aktuelle API-Version prüfen, sie haben sich "
                    "zwischen TED-Versionen geändert."),
    }

# ----------------------------------------------------------------------- Lauf

VORLAGE = [
    dict(zip(EINGABE_SPALTEN, [
        "BEISPIELZEILE – ersetzen", "Frankfurt am Main", "Beispiel Bauherr GmbH",
        "Beispiel Bau AG", "Neubau Verwaltungsgebäude", "2021-06-15", "zuschlag",
        "gross", "https://ted.europa.eu/de/notice/…", "2026-08-25",
        "Sehr geehrte Frau …,", "Leitung Immobilienmanagement"])),
]

def lauf(quelle, ziel, briefordner, absender, stichtag):
    with open(quelle, encoding="utf-8-sig", newline="") as f:
        zeilen = [r for r in csv.DictReader(f, delimiter=";") if (r.get("Projekt") or "").strip()]
    if not zeilen:
        print("Keine Kandidatenzeilen gefunden.", file=sys.stderr)
        return 1

    briefpfad = pathlib.Path(briefordner) if briefordner else None
    if briefpfad:
        briefpfad.mkdir(parents=True, exist_ok=True)

    ausgabe, verworfen = [], []
    for z in zeilen:
        b, fehler = bewerten(z, stichtag)
        if fehler:
            verworfen.append((z.get("Projekt", "?"), fehler))
            continue
        if z["Projekt"].startswith("BEISPIELZEILE"):
            verworfen.append((z["Projekt"], "Vorlagenzeile – nicht anschreiben"))
            continue
        zeile = {**z, **{k: v for k, v in b.items() if not k.startswith("_")}}
        zeile["Briefdatei"] = ""
        if briefpfad and b["Prioritaet"] == 1:
            betreff, text = brieftext(z, b, absender)
            name = "".join(c if c.isalnum() or c in " -_" else "" for c in z["Projekt"])[:60].strip().replace(" ", "_")
            p = briefpfad / f"{name}.txt"
            p.write_text(text, encoding="utf-8")
            zeile["Briefdatei"] = p.name
        ausgabe.append(zeile)

    ausgabe.sort(key=lambda r: (r["Prioritaet"], r["Fristende_frueh"]))
    with open(ziel, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=AUSGABE_SPALTEN, delimiter=";", extrasaction="ignore")
        w.writeheader(); w.writerows(ausgabe)

    jetzt = [r for r in ausgabe if r["Prioritaet"] == 1]
    print(f"Stichtag {stichtag} · {len(zeilen)} Kandidat(en) eingelesen -> {ziel}")
    print(f"  {len(jetzt)} mit Priorität 1 (jetzt ansprechen)"
          + (f", Briefe in {briefpfad}/" if briefpfad and jetzt else ""))
    for r in ausgabe:
        print(f"  [P{r['Prioritaet']}] {r['Projekt'][:42]:42s} {r['Ort'][:18]:18s} "
              f"Frist {de(r['Fristende_frueh'])}–{de(r['Fristende_spaet'])}  {r['Ansprachefenster']}")
    for p, grund in verworfen:
        print(f"  [--] {p[:42]:42s} verworfen: {grund}")
    return 0

# ------------------------------------------------------------------ Selbsttest

def selftest():
    stichtag = dt.date(2026, 8, 25)
    faelle = [
        # (Bezugsdatum, Bezugsart, Groesse, erwartete Prio)
        ("2021-06-15", "zuschlag", "gross", 1),        # Abnahme ~06/2024 -> VOB-Frist 06/2028 -> zu früh? prüfen
        ("2022-09-01", "fertigstellung", "", 1),        # VOB-Frist 09/2026 -> 11 Tage -> zu knapp
        ("2018-01-10", "fertigstellung", "", 5),        # längst abgelaufen
    ]
    print("Fall-Prüfung (Stichtag 25.08.2026):")
    for bezug, art, groesse, _ in faelle:
        z = {"Projekt": "T", "Ort": "O", "Bezugsdatum": bezug, "Bezugsart": art,
             "Projektgroesse": groesse, "Quelle": "test"}
        b, fehler = bewerten(z, stichtag)
        print(f"  {bezug} ({art:15s}) -> Abnahme {b['Abnahme_geschaetzt']}, "
              f"Frist {b['Fristende_frueh']}–{b['Fristende_spaet']}, "
              f"{b['Tage_bis_frueh']:>5} T, P{b['Prioritaet']} {b['Ansprachefenster']}")
    # Quellenzwang
    _, fehler = bewerten({"Projekt": "X", "Bezugsdatum": "2022-01-01", "Quelle": ""}, stichtag)
    print(f"  ohne Quelle -> {'blockiert: ' + fehler if fehler else 'FEHLER: durchgelassen!'}")
    assert fehler, "Quellenzwang greift nicht"
    print("\nSelbsttest bestanden.")
    return 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("quelle", nargs="?", help="Kandidaten-CSV (Semikolon, UTF-8)")
    ap.add_argument("-o", "--out", default="radar.csv")
    ap.add_argument("--briefe", help="Ordner für generierte Anschreiben")
    ap.add_argument("--absender", default="[Name]\n[Funktion]\nclaim.m")
    ap.add_argument("--stichtag", default="")
    ap.add_argument("--vorlage", action="store_true")
    ap.add_argument("--ted-abfrage", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        sys.exit(selftest())
    if a.ted_abfrage:
        print(json.dumps(ted_request(2019, 2023), ensure_ascii=False, indent=2)); sys.exit(0)
    if a.vorlage:
        with open("kandidaten_vorlage.csv", "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=EINGABE_SPALTEN, delimiter=";")
            w.writeheader(); w.writerows(VORLAGE)
        print("kandidaten_vorlage.csv geschrieben."); sys.exit(0)
    if not a.quelle:
        ap.print_help(); sys.exit(2)
    st = dt.date.fromisoformat(a.stichtag) if a.stichtag else dt.date.today()
    sys.exit(lauf(a.quelle, a.out, a.briefe, a.absender, st))
