"""Einheitlicher Zugriff auf die Bäderdaten aller Städte (Münster + Vergleichsstädte).

Jede Stadt liefert:
  slug, stadt, ags, einwohner, stand, hinweis, bezug,
  baeder:    Liste von Bädern/Bereichen (Slots normalisiert, 'cat', 'standort')
  standorte: Liste {id, name, lat, lon, baeder: [bad-ids]} – ein Marker/Reisezeit je Ort
"""
from __future__ import annotations

import csv
import json
import re
import unicodedata
from pathlib import Path

from metrics import bad_kennzahlen, slots_of

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def slugify(s: str) -> str:
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def einwohner() -> dict[str, tuple[str, int]]:
    return {r["ags"]: (r["stadt"], int(r["einwohner_31_12_2025"]))
            for r in csv.DictReader(open(DATA / "nrw_population.csv", encoding="utf-8"))}


def standort_name(name: str) -> str:
    """'Vitusbad – Sportbecken' -> 'Vitusbad'; 'Friesi (Traglufthalle Friesdorf)' bleibt."""
    return name.split(" – ")[0].strip()


def kategorie(b: dict) -> str:
    if b.get("kategorie") == "andere":
        return "andere"
    if b.get("typ") == "freibad":
        return "freibad"
    if b.get("freizeitbad"):
        return "freizeit"
    if not b.get("zeiten_unbekannt") and bad_kennzahlen(b)["stunden_woche"] == 0:
        return "geschlossen"
    return "hallenbad"


def _quellen_datei(ags: str) -> Path | None:
    hits = sorted((DATA / "staedte").glob(f"{ags}_*.json"))
    return hits[0] if hits else None


def stadt_dateien() -> list[tuple[str, Path]]:
    """[(ags, pfad)] aller Städte mit Daten; Münster aus muenster_baeder.json."""
    out = [("05515", DATA / "muenster_baeder.json")]
    for f in sorted((DATA / "staedte").glob("*.json")):
        ags = f.name.split("_")[0]
        out.append((ags, f))
    return out


def lade_stadt(ags: str) -> dict:
    ew = einwohner()
    name, n = ew[ags]
    if ags == "05515":
        src = json.loads((DATA / "muenster_baeder.json").read_text(encoding="utf-8"))
        status = "erfasst"
    else:
        f = _quellen_datei(ags)
        src = json.loads(f.read_text(encoding="utf-8")) if f else {"status": "offen", "baeder": []}
        status = src.get("status", "offen")
    slug = slugify(name)
    baeder = []
    for i, b in enumerate(src.get("baeder", [])):
        b = dict(b)
        b.setdefault("id", f"{slug}-{i}")
        b["slots"] = slots_of(b)
        b["cat"] = kategorie(b)
        b["standort"] = b.get("standort") or (b["id"] if ags == "05515" else standort_name(b["name"]))
        b["kennzahlen"] = bad_kennzahlen(b)
        baeder.append(b)
    # Standorte bilden (nur Bäder mit Koordinaten)
    st = {}
    for b in baeder:
        if b.get("lat") is None:
            continue
        key = b["standort"]
        if key not in st:
            st[key] = {"id": f"{slug}-s{len(st)}", "name": standort_name(b["name"]) if ags != "05515" else b["name"],
                       "lat": b["lat"], "lon": b["lon"], "baeder": []}
        st[key]["baeder"].append(b["id"])
        b["standort_id"] = st[key]["id"]
    return {
        "slug": slug, "stadt": name, "ags": ags, "einwohner": n, "status": status,
        "stand": src.get("stand"), "hinweis": src.get("hinweis", ""), "bezug": src.get("bezug", ""),
        "baeder": baeder, "standorte": list(st.values()), "src": src,
    }


def alle_mit_daten() -> list[str]:
    """AGS aller Städte mit erfassten Bädern (ohne Status 'offen'), Münster zuerst."""
    out = []
    for ags, f in stadt_dateien():
        d = json.loads(f.read_text(encoding="utf-8"))
        if ags == "05515" or d.get("status") != "offen":
            out.append(ags)
    return out
