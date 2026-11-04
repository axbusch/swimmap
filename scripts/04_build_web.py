"""Packt alle Daten für die Webseite nach docs/data/.

  docs/data/muenster.json   Bäder inkl. Kennzahlen, Stadtkennzahlen
  docs/data/raster.json     100-m-Raster (Lage, Einwohner) + Reisezeiten je Bad
  docs/data/nrw.json        Vergleich der NRW-Großstädte
"""
from pathlib import Path
import base64
import csv
import json

import numpy as np
import pandas as pd

from metrics import bad_kennzahlen, stadt_kennzahlen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CACHE = ROOT / "cache"
WEB = ROOT / "docs" / "data"
WEB.mkdir(parents=True, exist_ok=True)

pop = {r["ags"]: (r["stadt"], int(r["einwohner_31_12_2025"]))
       for r in csv.DictReader(open(DATA / "nrw_population.csv", encoding="utf-8"))}

FILTER = {
    "kern": lambda b: b["typ"] == "hallenbad" and b["kategorie"] == "staedtisch",
    "staedtisch": lambda b: b["kategorie"] == "staedtisch",
    "alle": lambda b: True,
}

# --- Münster ---------------------------------------------------------------
ms = json.loads((DATA / "muenster_baeder.json").read_text(encoding="utf-8"))
ew_ms = pop["05515"][1]
for b in ms["baeder"]:
    b["kennzahlen"] = bad_kennzahlen(b)
ms["einwohner"] = ew_ms
ms["einwohner_quelle"] = "IT.NRW, Fortschreibung Basis Zensus 2022, 31.12.2025"
ms["kennzahlen_stadt"] = {k: stadt_kennzahlen(ms["baeder"], ew_ms, f) for k, f in FILTER.items()}
gtfs_meta = json.loads((CACHE / "gtfs_ms" / "meta.json").read_text(encoding="utf-8"))
ms["oepnv"] = gtfs_meta
(WEB / "muenster.json").write_text(json.dumps(ms, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("Münster Kern:", ms["kennzahlen_stadt"]["kern"])

# --- Raster ---------------------------------------------------------------
cells = pd.read_csv(CACHE / "raster.csv")
ids = json.load(open(CACHE / "tt_pools.json"))
raster = {
    "zellen": len(cells),
    "lat": [round(v, 5) for v in cells.lat],
    "lon": [round(v, 5) for v in cells.lon],
    "ew": cells.ew.astype(int).tolist(),
    "ew_summe": int(cells.ew.sum()),
    "ew_quelle": "Zensus 2022, 100-m-Gitter (Destatis), Einwohner je Zelle",
    "baeder": ids,
    "tt": {},
}
for mode in ("walk", "bike", "pt"):
    f = CACHE / f"tt_{mode}.npy"
    if f.exists():
        a = np.load(f)
        raster["tt"][mode] = [base64.b64encode(a[k].tobytes()).decode() for k in range(a.shape[0])]
(WEB / "raster.json").write_text(json.dumps(raster, separators=(",", ":")), encoding="utf-8")
print("Raster:", len(cells), "Zellen, Modi:", list(raster["tt"]))

# --- NRW-Vergleich ----------------------------------------------------------
nrw_src = json.loads((DATA / "nrw_staedte.json").read_text(encoding="utf-8"))
staedte = []
for ags, (name, ew) in pop.items():
    eintrag = nrw_src["staedte"].get(ags, {"status": "offen"})
    out = {"ags": ags, "stadt": name, "einwohner": ew, "status": eintrag.get("status", "offen"),
           "hinweis": eintrag.get("hinweis", ""), "stand": eintrag.get("stand")}
    if ags == "05515":
        baeder = ms["baeder"]
        out["status"] = "erfasst"
        out["stand"] = ms["stand"]
    else:
        baeder = eintrag.get("baeder", [])
    if out["status"] != "offen" and baeder:
        out["kennzahlen"] = stadt_kennzahlen(baeder, ew, FILTER["kern"])
        out["baeder"] = [{"name": b["name"], "wasserflaeche_m2": b.get("wasserflaeche_m2"),
                          "wasserflaeche_geschaetzt": b.get("wasserflaeche_geschaetzt", False),
                          "stunden_woche": bad_kennzahlen(b)["stunden_woche"],
                          "quelle": b.get("quelle", {}).get("url")}
                         for b in baeder if FILTER["kern"](b)]
    staedte.append(out)
(WEB / "nrw.json").write_text(json.dumps({"staedte": staedte, "methodik": nrw_src.get("methodik", "")},
                                         ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("NRW:", sum(1 for s in staedte if s["status"] != "offen"), "von", len(staedte), "Städten erfasst")
