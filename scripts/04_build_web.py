"""Packt alle Daten für die Webseite nach docs/data/.

  docs/data/index.js          Städteliste, NRW-Vergleich, Metadaten (window.SWIMMAP_INDEX)
  docs/data/st/<slug>.js      je Stadt mit Karte: Bäder, Standorte, Grenze, Raster, Reisezeiten
                              (ruft window.SWIMMAP_CITY(...) auf – funktioniert auch bei file://)
  docs/data/nrw.json          Vergleich als JSON (Download)
  docs/data/st/<slug>-baeder.json  Bäder einer Stadt als JSON (Download)
"""
from datetime import date
from pathlib import Path
import base64
import json
import re

import markdown

import numpy as np
import pandas as pd

from metrics import ist_kern, stadt_kennzahlen
from staedte import einwohner, lade_stadt, slugify

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
WEB = ROOT / "docs" / "data"
(WEB / "st").mkdir(parents=True, exist_ok=True)

METHODIK_NRW = (
    "Je Stadt werden nur kommunale Hallenbäder (Stadt oder städtische Bäder-/Stadtwerkegesellschaft) mit ihren "
    "Zeiten für allgemeines öffentliches Schwimmen im regulären Winter-Wochenplan erfasst – nach denselben Regeln "
    "wie für Münster. Reine Freizeitbereiche zählen nicht zur Kernkennzahl; die Sportbecken von Freizeitbädern zählen.")
FELDER = ["id", "name", "cat", "typ", "kategorie", "standort_id", "traeger", "adresse", "wasserflaeche_m2",
          "wasserflaeche_geschaetzt", "wasserflaeche_quelle", "ausstattung", "slots", "einschraenkungen", "sommer",
          "saison", "quelle", "hinweis", "zeiten_unsicher", "zeiten_unbekannt", "kennzahlen", "freizeitbad"]
VERGLEICHSJAHR = "2025"  # Jahr für den Schließtage-Vergleich
gtfs_meta = json.loads((CACHE / "gtfs_nrw" / "meta.json").read_text(encoding="utf-8"))

index = {"staedte": [], "methodik": METHODIK_NRW, "oepnv": gtfs_meta}
nrw_rows = []
for ags, (name, ew) in einwohner().items():
    s = lade_stadt(ags)
    slug = s["slug"]
    k = stadt_kennzahlen(s["baeder"], ew, ist_kern) if (s["status"] != "offen" and s["baeder"]) else None
    row = {"ags": ags, "stadt": name, "slug": slug, "einwohner": ew, "status": s["status"], "stand": s["stand"],
           "hinweis": s["hinweis"], "kennzahlen": k, "karte": False,
           "baeder": [{"name": b["name"], "stunden_woche": b["kennzahlen"]["stunden_woche"],
                       "wasserflaeche_m2": b.get("wasserflaeche_m2"), "quelle": (b.get("quelle") or {}).get("url")}
                      for b in s["baeder"] if ist_kern(b)]}
    sf = CACHE / "schliessungen" / f"{slug}.json"
    schl = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else None
    if k and schl and VERGLEICHSJAHR in schl["jahre"]:
        j = schl["jahre"][VERGLEICHSJAHR]
        if j["stunden_plan"]:
            tage = (date(int(VERGLEICHSJAHR), 12, 31) - date(int(VERGLEICHSJAHR), 1, 1)).days + 1
            k["ausfall"] = {"jahr": VERGLEICHSJAHR, "stunden_plan": j["stunden_plan"], "stunden_ist": j["stunden_ist"],
                            "stunden_verloren": j["stunden_verloren"], "schliesstage": j["schliesstage"],
                            "plantage": j["plantage"], "baeder": len(schl["baeder"]),
                            "qualitaet": schl.get("qualitaet")}
            k["ausfall_anteil"] = round(1 - j["stunden_ist"] / j["stunden_plan"], 4)
            k["ist_je_10k_ew"] = round(j["stunden_ist"] / (tage / 7) / ew * 1e4, 2)
            k["ausfall"]["plan_je_10k_ew"] = round(j["stunden_plan"] / (tage / 7) / ew * 1e4, 2)
            k["verloren_je_10k_ew"] = round((j["stunden_plan"] - j["stunden_ist"]) / ew * 1e4, 1)
    out = CACHE / "st" / slug
    ids_f = out / "tt_standorte.json"
    if k and ids_f.exists() and (out / "tt_walk.npy").exists():
        ids = json.loads(ids_f.read_text())
        if ids == [x["id"] for x in s["standorte"]]:
            cells = pd.read_csv(out / "raster.csv")
            kids = cells["k615"].to_numpy() if "k615" in cells else None
            tt = {}
            arrs = {}
            for mode in ("walk", "bike", "pt"):
                f = out / f"tt_{mode}.npy"
                if f.exists():
                    a = np.load(f)
                    arrs[mode] = a
                    tt[mode] = [base64.b64encode(a[i].tobytes()).decode() for i in range(a.shape[0])]
            # Erreichbarkeit der kommunalen Hallenbäder (Kernkategorie) für den Vergleich
            kern_st = [i for i, sid in enumerate(ids)
                       if any(b.get("standort_id") == sid and b["cat"] == "hallenbad" and b["kennzahlen"]["stunden_woche"] > 0
                              for b in s["baeder"])]
            ew_c = cells.ew.to_numpy()
            if kern_st:
                for key, mode, t in (("rad15", "bike", 15), ("fuss15", "walk", 15), ("oepnv20", "pt", 20)):
                    if mode in arrs:
                        m = arrs[mode][kern_st].min(0) <= t
                        k[f"ew_{key}"] = round(float(ew_c[m].sum() / max(1, ew_c.sum())), 4)
                        if kids is not None:
                            k[f"kinder_{key}"] = round(float(kids[m].sum() / max(1, kids.sum())), 4)
            city = {
                "slug": slug, "stadt": name, "ags": ags, "einwohner": ew, "stand": s["stand"], "hinweis": s["hinweis"],
                "bezug": s["bezug"] or "Regulärer Wochenplan Winterhalbjahr 2026/27",
                "kennzahlen_stadt": k,
                "baeder": [{f: b[f] for f in FELDER if f in b} for b in s["baeder"]],
                "standorte": s["standorte"],
                "grenze": json.loads((out / "grenze.geojson").read_text(encoding="utf-8")),
                "raster": {"zellen": len(cells), "lat": [round(v, 5) for v in cells.lat],
                           "lon": [round(v, 5) for v in cells.lon], "ew": cells.ew.astype(int).tolist(),
                           "kinder": [round(float(v), 1) for v in kids] if kids is not None else None,
                           "kinder_summe": round(float(kids.sum())) if kids is not None else None,
                           "ew_summe": int(cells.ew.sum()), "standorte": ids, "tt": tt},
                "oepnv": gtfs_meta,
            }
            if schl:  # Schließtage-Chronik (06_schliesstage.py)
                city["schliessungen"] = schl
            (WEB / "st" / f"{slug}.js").write_text(
                "/* erzeugt von scripts/04_build_web.py */\nwindow.SWIMMAP_CITY("
                + json.dumps(city, ensure_ascii=False, separators=(",", ":")) + ");\n", encoding="utf-8")
            (WEB / "st" / f"{slug}-baeder.json").write_text(
                json.dumps({"stadt": name, "stand": s["stand"], "hinweis": s["hinweis"], "baeder": city["baeder"]},
                           ensure_ascii=False, indent=1), encoding="utf-8")
            row["karte"] = True
            row["modi"] = list(tt)
            print(f"  Karte {name}: {len(s['standorte'])} Standorte, {len(cells)} Zellen, Modi {list(tt)}, "
                  f"{(WEB / 'st' / f'{slug}.js').stat().st_size / 1e6:.1f} MB")
    index["staedte"].append(row)
    nrw_rows.append(row)

(WEB / "index.js").write_text("/* erzeugt von scripts/04_build_web.py */\nwindow.SWIMMAP_INDEX = "
                              + json.dumps(index, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
(WEB / "nrw.json").write_text(json.dumps({"staedte": nrw_rows, "methodik": METHODIK_NRW}, ensure_ascii=False,
                                         indent=1), encoding="utf-8")
# README als HTML für den Reiter „Info“ (relative Links zeigen auf GitHub)
REPO = "https://github.com/axbusch/swimmap/blob/main/"
html = markdown.markdown((ROOT / "README.md").read_text(encoding="utf-8"), extensions=["tables", "fenced_code"])
html = re.sub(r'href="(?!https?:|#|mailto:)([^"]+)"', lambda m: f'href="{REPO}{m.group(1)}"', html)
html = re.sub(r'href="(https?:[^"]+)"', r'href="\1" target="_blank" rel="noopener"', html)
(WEB / "readme.js").write_text("/* erzeugt von scripts/04_build_web.py aus README.md */\nwindow.SWIMMAP_README = "
                               + json.dumps(html, ensure_ascii=False) + ";\n", encoding="utf-8")
# Altlasten des Ein-Stadt-Formats entfernen
for old in ("bundle.js", "muenster.json", "raster.json", "grenze.geojson"):
    (WEB / old).unlink(missing_ok=True)
print("Städte:", len(index["staedte"]), "| mit Karte:", sum(r["karte"] for r in index["staedte"]))
