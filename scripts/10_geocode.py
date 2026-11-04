"""Verortet die Bäder der Vergleichsstädte über OpenStreetMap (Nominatim).

  python 10_geocode.py [--force] [ags ...]

Für jeden Standort (Badname ohne Bereichszusatz) werden mehrere Suchvarianten
probiert; akzeptiert wird nur ein Treffer innerhalb der Stadtgrenze (+500 m).
Ergebnis wird in data/staedte/<ags>_*.json je Bad geschrieben:
  lat, lon, geocode: {q, osm, name}
Manuelle Vorgabe möglich über 'geocode_q' (Suchtext) oder direkt lat/lon.
Nominatim-Nutzungsregeln: max. 1 Anfrage/s, eigener User-Agent.
"""
import json
import re
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import Point, shape

from staedte import DATA, einwohner, standort_name

UA = {"User-Agent": "swimmap-research/0.1 (lokales Auswertungsprojekt)"}
NOM = "https://nominatim.openstreetmap.org/search"
_last = [0.0]


def nominatim(**params):
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    params.setdefault("format", "jsonv2")
    r = requests.get(NOM, params=params, headers=UA, timeout=30)
    r.raise_for_status()
    return r.json()


def stadtgrenze(name: str):
    res = nominatim(city=name, state="Nordrhein-Westfalen", country="Deutschland",
                    polygon_geojson=1, limit=3)
    for x in res:
        if x.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon"):
            return shape(x["geojson"]), x
    raise RuntimeError(f"keine Grenze für {name}")


def varianten(name: str, stadt: str):
    base = name
    ohne_klammer = re.sub(r"\s*\(.*?\)", "", base).strip()
    klammer = re.findall(r"\((.*?)\)", base)
    v = [base, ohne_klammer]
    v += [k for k in klammer]
    for x in list(v):
        if not re.search(r"bad|halle|oper|pool|aquarium|lagune|oase", x, re.I):
            v.append(x + " Schwimmbad")
            v.append("Hallenbad " + x)
    seen, out = set(), []
    for x in v:
        q = f"{x}, {stadt}"
        if x and q not in seen:
            seen.add(q); out.append(q)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    ew = einwohner()
    files = sorted((DATA / "staedte").glob("*.json"))
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("status") == "offen" or (args and d["ags"] not in args):
            continue
        stadt = ew[d["ags"]][0]
        poly, _ = stadtgrenze(stadt)
        area = poly.buffer(0.007)  # ~500 m
        minx, miny, maxx, maxy = poly.bounds
        cache = {}
        print(f"## {stadt}")
        for b in d["baeder"]:
            if b.get("lat") is not None and not force:
                continue
            sname = b.get("geocode_q") or standort_name(b["name"])
            if sname in cache:
                hit = cache[sname]
            else:
                hit = None
                for q in ([sname + ", " + stadt] if b.get("geocode_q") else varianten(sname, stadt)):
                    res = nominatim(q=q, viewbox=f"{minx},{maxy},{maxx},{miny}", bounded=1, limit=5)
                    res = [x for x in res if area.contains(Point(float(x["lon"]), float(x["lat"])))]
                    # Schwimmbad-artige Treffer bevorzugen
                    res.sort(key=lambda x: (0 if re.search(r"swimming|sports_centre|water_park|leisure", x.get("category", "") + x.get("type", "")) else 1))
                    if res:
                        x = res[0]
                        hit = {"lat": round(float(x["lat"]), 6), "lon": round(float(x["lon"]), 6),
                               "geocode": {"q": q, "osm": f"{x['osm_type']}/{x['osm_id']}", "name": x.get("display_name", "")[:140],
                                           "typ": f"{x.get('category')}/{x.get('type')}"}}
                        break
                cache[sname] = hit
            if hit:
                b.update(hit)
                print(f"  OK  {b['name']:45s} <- {hit['geocode']['q']}  [{hit['geocode']['typ']}] {hit['geocode']['name'][:70]}")
            else:
                print(f"  --  {b['name']:45s} NICHT GEFUNDEN")
        f.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
