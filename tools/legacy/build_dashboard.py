#!/usr/bin/env python3
"""Erzeugt aus gewaehrleistungsregister.csv das HTML-Dashboard "Fristenradar Rhein-Main".

Aufruf:  python3 build_dashboard.py [register.csv] [output.html] [--stichtag=JJJJ-MM-TT]

Fristlogik (analog §§ 187 I, 188 II BGB: Ablauf am Kalendertag, der dem Abnahmetag entspricht):
  4 Jahre  = VOB/B § 13 Abs. 4      5 Jahre = BGB § 634a Abs. 1 Nr. 2
  Vertragsart "VOB/B" -> 4 J.; "BGB" -> 5 J.; alles andere ("unklar") -> beide Szenarien, im Fenster wenn eines trifft.
  Spalte "Fristende" (falls gefüllt) hat Vorrang (vertraglich bekannte Frist).
  Datum "JJJJ-MM" (nur Monat bekannt) -> 1. des Monats, Genauigkeit "Monat"; "JJJJ" -> nicht berechenbar.
Das Datum im Register ist i. d. R. ein öffentlich genannter Proxy (Übergabe/Eröffnung), nicht die förmliche Abnahme.
"""
import csv, json, sys, datetime as dt

args = [a for a in sys.argv[1:] if not a.startswith("--")]
src = args[0] if len(args) > 0 else "gewaehrleistungsregister.csv"
out = args[1] if len(args) > 1 else "fristenradar.html"
stichtag = dt.date.today()
for a in sys.argv[1:]:
    if a.startswith("--stichtag="):
        stichtag = dt.date.fromisoformat(a.split("=", 1)[1])
HORIZONT_MONATE = 6

def add_months(d, m):
    y, mo = d.year + (d.month - 1 + m) // 12, (d.month - 1 + m) % 12 + 1
    last = [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
    return dt.date(y, mo, min(d.day, last))

def add_years(d, y):
    try:
        return d.replace(year=d.year + y)
    except ValueError:
        return d.replace(year=d.year + y, day=28)

def parse(s):
    """-> (date|None, genauigkeit)"""
    s = (s or "").strip()
    if len(s) == 10: return dt.date.fromisoformat(s), "Tag"
    if len(s) == 7:  return dt.date(int(s[:4]), int(s[5:7]), 1), "Monat"
    if len(s) == 4:  return None, "Jahr"
    return None, "–"

fenster_ende = add_months(stichtag, HORIZONT_MONATE)
iso = lambda d: d.isoformat() if d else ""

rows = []
with open(src, encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f, delimiter=";"):
        r = {k.strip(): (v or "").strip() for k, v in r.items() if k}
        if not r.get("Projekt"): continue
        abn, gen = parse(r.get("Abnahme/Fertigstellung") or r.get("Abnahmedatum"))
        va = r.get("Vertragsart", "").upper()
        art = "VOB" if "VOB" in va else "BGB" if "BGB" in va else "unklar"
        fest, _ = parse(r.get("Fristende"))
        f4 = add_years(abn, 4) if abn else None
        f5 = add_years(abn, 5) if abn else None
        if fest:            kand = [fest]; massg = fest
        elif art == "VOB":  kand = [f4] if f4 else []; massg = f4
        elif art == "BGB":  kand = [f5] if f5 else []; massg = f5
        else:               kand = [x for x in (f4, f5) if x]; massg = None
        # massgebliches Datum für Sortierung/Resttage: bei "unklar" das nächste noch nicht abgelaufene, sonst das späteste
        if massg is None and kand:
            offen = [k for k in kand if k >= stichtag]
            massg = min(offen) if offen else max(kand)
        tage = (massg - stichtag).days if massg else None
        r.update({
            "abnahme": iso(abn), "genauigkeit": gen, "art": art, "fest": iso(fest),
            "f4": iso(f4), "f5": iso(f5), "fristende": iso(massg), "tage": tage,
            "rheinmain": r.get("Region", "").lower().replace("-", "").replace(" ", "") == "rheinmain",
            "im_fenster": any(stichtag <= k <= fenster_ende for k in kand),
            "abgelaufen": bool(kand) and all(k < stichtag for k in kand),
            "teilweise_abgelaufen": art == "unklar" and bool(kand) and any(k < stichtag for k in kand) and not all(k < stichtag for k in kand),
        })
        rows.append(r)

rows.sort(key=lambda r: (r["fristende"] or "9999"))
rm = [r for r in rows if r["rheinmain"]]
fenster = [r for r in rm if r["im_fenster"]]
kritisch = [r for r in fenster if r["tage"] is not None and r["tage"] <= 90]
abgelaufen = [r for r in rm if r["abgelaufen"]]
unklar_im_fenster = [r for r in fenster if r["art"] == "unklar"]
ohne_datum = [r for r in rm if not r["abnahme"] and not r["fest"]]

def de(s):
    if not s: return "–"
    y, m, d = s.split("-"); return f"{d}.{m}.{y}"

TITLE = "Fristenradar Rhein-Main"
data_json = json.dumps(rows, ensure_ascii=False)

page = f"""<title>{TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@87.5,500;87.5,700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{{
  --bg:#F3F5F8; --surface:#FFFFFF; --surface-2:#E9EDF2; --ink:#172029; --muted:#5C6975; --line:#D5DCE4;
  --accent:#1E5C78; --accent-ink:#FFFFFF; --accent-soft:#DDEAF1;
  --crit:#B42318; --crit-soft:#FBE7E4; --warn:#9A5B05; --warn-soft:#FCEFD6; --ok:#0E6E4B; --ok-soft:#DDF2E8; --past:#5C6975; --past-soft:#E4E8ED;
  --shadow:0 1px 2px rgba(23,32,41,.06),0 4px 14px rgba(23,32,41,.05);
}}
@media (prefers-color-scheme: dark){{ :root:not([data-theme="light"]){{
  --bg:#0F1519; --surface:#171F26; --surface-2:#1F2931; --ink:#E6ECF1; --muted:#98A5B1; --line:#2B3640;
  --accent:#7CC0DE; --accent-ink:#0F1519; --accent-soft:#1B3441;
  --crit:#F0857A; --crit-soft:#3A1A17; --warn:#E8B04F; --warn-soft:#3A2B10; --ok:#63C79C; --ok-soft:#12332A; --past:#98A5B1; --past-soft:#252E36;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 4px 14px rgba(0,0,0,.3);
}} }}
:root[data-theme="dark"]{{
  --bg:#0F1519; --surface:#171F26; --surface-2:#1F2931; --ink:#E6ECF1; --muted:#98A5B1; --line:#2B3640;
  --accent:#7CC0DE; --accent-ink:#0F1519; --accent-soft:#1B3441;
  --crit:#F0857A; --crit-soft:#3A1A17; --warn:#E8B04F; --warn-soft:#3A2B10; --ok:#63C79C; --ok-soft:#12332A; --past:#98A5B1; --past-soft:#252E36;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 4px 14px rgba(0,0,0,.3);
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Source Sans 3",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.45}}
a{{color:var(--accent)}}
.wrap{{max-width:1280px;margin:0 auto;padding:28px 24px 64px}}
header{{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px}}
h1{{font-family:Archivo,"Source Sans 3",sans-serif;font-stretch:87.5%;font-weight:700;font-size:30px;letter-spacing:-.01em;margin:0;text-wrap:balance}}
.eyebrow{{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}}
.stich{{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px;color:var(--muted);text-align:right;line-height:1.7}}
.stich b{{color:var(--ink);font-weight:600}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}}
.kpi{{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:14px 16px;box-shadow:var(--shadow);position:relative;overflow:hidden}}
.kpi::before{{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--k,var(--accent))}}
.kpi .n{{font-family:Archivo,sans-serif;font-stretch:87.5%;font-weight:700;font-size:34px;line-height:1;font-variant-numeric:tabular-nums}}
.kpi .l{{font-size:13px;color:var(--muted);margin-top:6px}}
.tools{{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}}
.tools input,.tools select{{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:5px;padding:7px 10px}}
.tools input{{min-width:240px;flex:1}}
.tools input:focus,.tools select:focus,button:focus-visible,tr.row:focus-visible{{outline:2px solid var(--accent);outline-offset:1px}}
.seg{{display:inline-flex;border:1px solid var(--line);border-radius:5px;overflow:hidden;background:var(--surface)}}
.seg button{{font:inherit;font-size:13.5px;padding:7px 12px;border:0;background:transparent;color:var(--muted);cursor:pointer}}
.seg button[aria-pressed="true"]{{background:var(--accent);color:var(--accent-ink)}}
.tablewrap{{background:var(--surface);border:1px solid var(--line);border-radius:6px;box-shadow:var(--shadow);overflow-x:auto}}
table{{border-collapse:collapse;width:100%;min-width:1000px}}
th{{text-align:left;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding:11px 12px;border-bottom:1px solid var(--line);background:var(--surface-2);white-space:nowrap;cursor:pointer;user-select:none}}
th[aria-sort]::after{{content:" ↕";opacity:.5}} th[aria-sort="ascending"]::after{{content:" ↑";opacity:1}} th[aria-sort="descending"]::after{{content:" ↓";opacity:1}}
td{{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}}
tr.row{{cursor:pointer}} tr.row:hover td{{background:var(--surface-2)}}
tr.row td:first-child{{border-left:4px solid var(--s)}}
.proj{{font-weight:600}} .sub{{color:var(--muted);font-size:13px}}
.mono{{font-family:"JetBrains Mono",monospace;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}}
.pill{{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap;background:var(--soft);color:var(--s)}}
.chip{{display:inline-block;font-size:12px;padding:2px 7px;border-radius:4px;background:var(--surface-2);color:var(--muted);border:1px solid var(--line);white-space:nowrap}}
.chip.hoch{{color:var(--ok);border-color:var(--ok)}} .chip.niedrig{{color:var(--warn);border-color:var(--warn)}}
.f2{{display:flex;flex-direction:column;gap:3px}} .f2 .dim{{color:var(--muted)}} .f2 .hit{{font-weight:600}}
tr.detail td{{background:var(--surface-2);padding:14px 16px 16px 16px;border-left:4px solid var(--s)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px 22px}}
.grid .k{{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}}
.empty{{padding:32px;text-align:center;color:var(--muted)}}
details{{margin-top:22px}} summary{{cursor:pointer;font-weight:600;color:var(--muted)}}
.note{{margin-top:22px;font-size:13px;color:var(--muted);max-width:78ch}}
.note code{{font-family:"JetBrains Mono",monospace;font-size:12px}}
.legend{{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin:10px 0 0}}
.legend i{{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:5px}}
@media (prefers-reduced-motion:no-preference){{ tr.row td{{transition:background .12s}} }}
</style>
<div class="wrap">
<header>
  <div><div class="eyebrow">claim.m · Gewährleistungsmanagement · Web-Recherche</div><h1>{TITLE}</h1></div>
  <div class="stich">Stichtag <b>{de(iso(stichtag))}</b><br>Fenster bis <b>{de(iso(fenster_ende))}</b> ({HORIZONT_MONATE} Monate)</div>
</header>
<div class="kpis">
  <div class="kpi" style="--k:var(--warn)"><div class="n">{len(fenster)}</div><div class="l">Projekte mit möglichem Fristablauf im Fenster</div></div>
  <div class="kpi" style="--k:var(--crit)"><div class="n">{len(kritisch)}</div><div class="l">davon in ≤ 90 Tagen – Begehung/Rüge jetzt</div></div>
  <div class="kpi" style="--k:var(--accent)"><div class="n">{len(unklar_im_fenster)}</div><div class="l">davon Vertragsart unklar (4 oder 5 Jahre)</div></div>
  <div class="kpi" style="--k:var(--past)"><div class="n">{len(abgelaufen)}</div><div class="l">bereits abgelaufen – Bürgschafts-/Restmängel-Thema</div></div>
</div>
<div class="tools">
  <input id="q" type="search" placeholder="Suchen: Projekt, Ort, GU, Bauherr, Property Manager …" aria-label="Suche">
  <select id="vert" aria-label="Vertragsart"><option value="">Vertragsart: alle</option><option value="VOB">VOB/B (4 J.)</option><option value="BGB">BGB (5 J.)</option><option value="unklar">unklar</option></select>
  <select id="typ" aria-label="Bauherrentyp"><option value="">Bauherr: alle</option><option value="oeff">öffentlich / kommunal</option><option value="priv">privat</option></select>
  <div class="seg" role="group" aria-label="Umfang">
    <button id="m-fenster" aria-pressed="true">Nur 6-Monats-Fenster</button>
    <button id="m-alle" aria-pressed="false">Alle Rhein-Main-Projekte</button>
  </div>
</div>
<div class="tablewrap"><table id="t">
<thead><tr>
  <th data-k="Projekt">Projekt / Ort</th><th data-k="Leistung/Gewerk">Leistung</th><th data-k="Auftragnehmer">Auftragnehmer</th><th data-k="Bauherr">Bauherr</th>
  <th data-k="abnahme">Fertigstellung</th><th data-k="fristende" aria-sort="ascending">Fristende 4 J. / 5 J.</th><th data-k="tage">Resttage</th><th data-k="Konfidenz">Konfidenz</th>
</tr></thead><tbody id="tb"></tbody></table><div id="empty" class="empty" hidden>Keine Projekte im gewählten Umfang.</div></div>
<p class="legend"><span><i style="background:var(--crit)"></i>≤ 90 Tage</span><span><i style="background:var(--warn)"></i>91–180 Tage</span><span><i style="background:var(--ok)"></i>&gt; 6 Monate</span><span><i style="background:var(--past)"></i>abgelaufen</span> · <span>„≈“ = nur Monat bekannt (1. des Monats angesetzt)</span></p>
<details><summary>Außerhalb Rhein-Main ({len(rows)-len(rm)}) · ohne verwertbares Datum ({len(ohne_datum)})</summary><div id="other" class="sub" style="margin-top:8px"></div></details>
<p class="note"><b>Wie die Daten entstehen.</b> Die Projekte stammen aus öffentlich zugänglichen Quellen (Pressemitteilungen von Bauherren, GUs, Kommunen, Fachpresse) – jede Zeile verlinkt ihre Quelle. Das Datum ist fast immer ein <em>Proxy</em> (Übergabe, Eröffnung, Einzug), nicht die förmliche Abnahme; die tatsächliche Frist kann davon um Wochen bis Monate abweichen. Fristende = Datum + 4 Jahre (VOB/B § 13 Abs. 4) bzw. + 5 Jahre (BGB § 634a), Fristlauf nach §§ 187 Abs. 1, 188 Abs. 2 BGB. Ist die Vertragsart nicht bekannt, werden beide Szenarien gezeigt und das Projekt zählt als „im Fenster“, wenn eines davon trifft. Teilabnahmen, TGA-Sonderfristen (2 Jahre ohne Wartungsvertrag), Hemmungen und Verjährungsverzichte sind nicht öffentlich – vor jeder Ansprache am Vertrag prüfen. Datenquelle: <code>gewaehrleistungsregister.csv</code> im Claude-Projekt „claim.m“.</p>
</div>
<script>
const DATA={data_json};
const de=s=>s?s.split("-").reverse().join("."):"–";
const sev=r=>r.tage==null?"past":r.tage<0?"past":r.tage<=90?"crit":r.tage<=182?"warn":"ok";
const label=r=>r.tage==null?"kein Datum":r.tage<0?`vor ${{-r.tage}} T. abgelaufen`:`${{r.tage}} T.`;
const OEFF=/stadt|kreis|landes|kommun|hochschule|universit|gebäudewirtschaft|eigenbetrieb|gww|abg |nassauische|gewobau|mag |zeg|varisano|dfb/i;
let mode="fenster",sortK="fristende",sortDir=1;
const tb=document.getElementById("tb"),q=document.getElementById("q"),vert=document.getElementById("vert"),typ=document.getElementById("typ");
function esc(s){{return String(s??"").replace(/[&<>"]/g,c=>({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}}[c]))}}
function fristCell(r){{
  if(r.fest) return `<div class="f2"><span class="hit">${{de(r.fest)}}</span><span class="dim">vertraglich</span></div>`;
  const ap=r.genauigkeit==="Monat"?"≈ ":"";
  const mk=(d,y)=>{{if(!d)return"";const hit=(r.art==="VOB"&&y===4)||(r.art==="BGB"&&y===5)||(r.art==="unklar"&&d===r.fristende);return `<span class="${{hit?"hit":"dim"}}">${{ap}}${{de(d)}} <span class="dim">(${{y}} J.)</span></span>`}};
  return `<div class="f2">${{mk(r.f4,4)}}${{mk(r.f5,5)}}</div>`;
}}
function render(){{
  const needle=q.value.trim().toLowerCase();
  let rows=DATA.filter(r=>r.rheinmain).filter(r=>mode==="alle"||r.im_fenster)
    .filter(r=>!vert.value||r.art===vert.value)
    .filter(r=>!typ.value||(typ.value==="oeff")===OEFF.test(r.Bauherr||""))
    .filter(r=>!needle||Object.values(r).join(" ").toLowerCase().includes(needle));
  rows.sort((a,b)=>{{let x=a[sortK]??"",y=b[sortK]??"";if(sortK==="tage"){{x=x??1e9;y=y??1e9}}return (x>y?1:x<y?-1:0)*sortDir}});
  tb.innerHTML=rows.map(r=>{{const s=sev(r);const v=`--s:var(--${{s}});--soft:var(--${{s}}-soft)`;
    return `<tr class="row" style="${{v}}" tabindex="0" aria-expanded="false">
      <td><div class="proj">${{esc(r.Projekt)}}</div><div class="sub">${{esc(r.Adresse)}}, ${{esc(r.PLZ)}} ${{esc(r.Ort)}}</div></td>
      <td>${{esc(r["Leistung/Gewerk"])}}</td>
      <td>${{esc(r.Auftragnehmer)||'<span class="sub">nicht öffentlich</span>'}} ${{r["Rolle AN"]?`<span class="chip">${{esc(r["Rolle AN"])}}</span>`:""}}</td>
      <td>${{esc(r.Bauherr)}}</td>
      <td class="mono">${{r.genauigkeit==="Monat"?"≈ ":""}}${{de(r.abnahme)}}<div class="sub" style="white-space:normal">${{esc(r.Datumsart)}}</div></td>
      <td class="mono">${{fristCell(r)}}<div class="sub">${{r.art==="unklar"?"Vertragsart unklar":esc(r.Vertragsart)}}</div></td>
      <td><span class="pill">${{label(r)}}</span>${{r.teilweise_abgelaufen?'<div class="sub">4-J.-Frist bereits abgelaufen</div>':""}}</td>
      <td><span class="chip ${{esc(r.Konfidenz)}}">${{esc(r.Konfidenz)||"–"}}</span></td></tr>
    <tr class="detail" style="${{v}}" hidden><td colspan="8"><div class="grid">
      <div><div class="k">Ansprechpartner Bauherr</div>${{esc(r["Ansprechpartner Bauherr"])||"–"}}</div>
      <div><div class="k">Property Manager / Betreiber</div>${{esc(r["Property Manager"])||"–"}}</div>
      <div><div class="k">Sicherheit</div>${{esc(r.Sicherheit)||"nicht öffentlich"}}</div>
      <div><div class="k">Status</div>${{esc(r.Status)||"–"}}</div>
      <div style="grid-column:1/-1"><div class="k">Bemerkung</div>${{esc(r.Bemerkung)||"–"}}</div>
      <div style="grid-column:1/-1"><div class="k">Quelle</div><a href="${{esc(r.Quelle)}}" target="_blank" rel="noopener">${{esc(r["Quelle Titel"]||r.Quelle)}}</a></div></div></td></tr>`}}).join("");
  document.getElementById("empty").hidden=rows.length>0;
}}
tb.addEventListener("click",e=>{{if(e.target.closest("a"))return;const tr=e.target.closest("tr.row");if(tr)toggle(tr)}});
tb.addEventListener("keydown",e=>{{if(e.key==="Enter"||e.key===" "){{const tr=e.target.closest("tr.row");if(tr){{e.preventDefault();toggle(tr)}}}}}});
function toggle(tr){{const d=tr.nextElementSibling;d.hidden=!d.hidden;tr.setAttribute("aria-expanded",String(!d.hidden))}}
document.querySelectorAll("th[data-k]").forEach(th=>th.addEventListener("click",()=>{{const k=th.dataset.k;if(sortK===k)sortDir*=-1;else{{sortK=k;sortDir=1}}
  document.querySelectorAll("th[data-k]").forEach(t=>t.removeAttribute("aria-sort"));th.setAttribute("aria-sort",sortDir>0?"ascending":"descending");render()}}));
document.getElementById("m-fenster").onclick=()=>setMode("fenster");document.getElementById("m-alle").onclick=()=>setMode("alle");
function setMode(m){{mode=m;document.getElementById("m-fenster").setAttribute("aria-pressed",String(m==="fenster"));document.getElementById("m-alle").setAttribute("aria-pressed",String(m==="alle"));render()}}
q.addEventListener("input",render);vert.addEventListener("change",render);typ.addEventListener("change",render);
document.getElementById("other").innerHTML=DATA.filter(r=>!r.rheinmain||(!r.abnahme&&!r.fest)).map(r=>`${{esc(r.Projekt)}} – ${{esc(r.Ort)}} (${{esc(r.Region)}}) ${{r.abnahme?"":"– kein Monat bekannt"}}`).join("<br>")||"–";
render();
</script>
"""
with open(out, "w", encoding="utf-8") as f:
    f.write(page)
print(f"Stichtag {stichtag}, Fenster bis {fenster_ende}: {len(fenster)} von {len(rm)} Rhein-Main-Projekten im Fenster, {len(kritisch)} kritisch (≤90 T.), {len(abgelaufen)} abgelaufen, {len(ohne_datum)} ohne Datum. -> {out}")
for r in rm:
    flag = "FENSTER" if r["im_fenster"] else ("ABGEL. " if r["abgelaufen"] else "       ")
    print(f"  {r['art']:6} {r['abnahme'] or '        ':10} 4J {r['f4'] or '-':10} 5J {r['f5'] or '-':10} {str(r['tage']).rjust(5)} T  {flag}  {r['Projekt'][:50]}")
