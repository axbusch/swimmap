"""Grundlagen je Stadt: Stadtgrenze, Bevölkerungsraster (Zensus 2022, 100 m), Wegenetze.

  python 01_grundlagen.py <ags|all> [...] [--ohne-netze]

Ausgaben je Stadt in cache/st/<slug>/:
  grenze.gpkg, grenze.geojson (vereinfacht, WGS84), raster.csv (x, y, lon, lat, ew),
  net_walk.graphml, net_bike.graphml
Einmalig: cache/zensus_nrw.csv (100-m-Zellen im Raum NRW aus dem Zensus-Archiv)

Voraussetzung: cache/zensus/z22_pop.zip
  (https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Bevoelkerungszahl.zip)
"""
from pathlib import Path
import sys
import zipfile

import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd
from pyproj import Transformer

from staedte import alle_mit_daten, einwohner, slugify

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
ox.settings.use_cache = True
ox.settings.cache_folder = str(CACHE / "osmnx")
ox.settings.log_console = False
ox.settings.requests_timeout = 300

OSM_ID = {"05515": "R62591"}  # Münster (eindeutig per Relation)


def zensus_nrw() -> pd.DataFrame:
    f = CACHE / "zensus_nrw.csv"
    if f.exists():
        return pd.read_csv(f)
    t = Transformer.from_crs(4326, 3035, always_xy=True)
    x0, y0 = t.transform(5.80, 50.25)
    x1, y1 = t.transform(9.55, 52.60)
    z = zipfile.ZipFile(CACHE / "zensus" / "z22_pop.zip")
    name = next(n for n in z.namelist() if n.endswith("100m-Gitter.csv"))
    parts = []
    with z.open(name) as fh:
        for ch in pd.read_csv(fh, sep=";", chunksize=1_000_000, usecols=["x_mp_100m", "y_mp_100m", "Einwohner"]):
            m = ch.x_mp_100m.between(x0 - 20000, x1 + 20000) & ch.y_mp_100m.between(y0 - 20000, y1 + 20000)
            parts.append(ch[m])
    pop = pd.concat(parts).rename(columns={"x_mp_100m": "x", "y_mp_100m": "y", "Einwohner": "ew"})
    pop["ew"] = pd.to_numeric(pop["ew"], errors="coerce").fillna(0).astype(int)
    pop.to_csv(f, index=False)
    return pop


def grenze_holen(ags: str, name: str):
    if ags in OSM_ID:
        g = ox.geocode_to_gdf(OSM_ID[ags], by_osmid=True)
    else:
        g = ox.geocode_to_gdf({"city": name, "state": "Nordrhein-Westfalen", "country": "Deutschland"})
    g = g[g.geometry.type.isin(["Polygon", "MultiPolygon"])].iloc[[0]]
    return g[["geometry"]].to_crs(3035)


def stadt(ags: str, pop: pd.DataFrame, netze: bool = True):
    name = einwohner()[ags][0]
    out = CACHE / "st" / slugify(name)
    out.mkdir(parents=True, exist_ok=True)
    print(f"## {name}", flush=True)
    if not (out / "grenze.gpkg").exists():
        g = grenze_holen(ags, name)
        g.to_file(out / "grenze.gpkg")
        gw = g.copy(); gw["geometry"] = gw.simplify(25)
        gw.to_crs(4326).to_file(out / "grenze.geojson", driver="GeoJSON")
    g = gpd.read_file(out / "grenze.gpkg")
    poly = g.geometry.iloc[0]
    print(f"  Fläche {poly.area / 1e6:.1f} km²", flush=True)

    if not (out / "raster.csv").exists():
        minx, miny, maxx, maxy = poly.bounds
        xs = np.arange(np.floor(minx / 100) * 100 + 50, maxx + 100, 100)
        ys = np.arange(np.floor(miny / 100) * 100 + 50, maxy + 100, 100)
        gx, gy = np.meshgrid(xs, ys)
        cells = gpd.GeoDataFrame({"x": gx.ravel(), "y": gy.ravel()},
                                 geometry=gpd.points_from_xy(gx.ravel(), gy.ravel()), crs=3035)
        cells = cells[cells.within(poly)].copy()
        cells = cells.merge(pop, on=["x", "y"], how="left")
        cells["ew"] = cells["ew"].fillna(0).astype(int)
        ll = gpd.GeoSeries(gpd.points_from_xy(cells.x, cells.y), crs=3035).to_crs(4326)
        cells["lon"] = ll.x.values; cells["lat"] = ll.y.values
        cells[["x", "y", "lon", "lat", "ew"]].to_csv(out / "raster.csv", index=False)
        print(f"  Zellen {len(cells)}, Einwohner (Zensus) {int(cells.ew.sum())}", flush=True)

    if not netze:
        return
    puffer = gpd.GeoSeries([poly.buffer(3000)], crs=3035).to_crs(4326).iloc[0]
    for typ in ("walk", "bike"):
        f = out / f"net_{typ}.graphml"
        if f.exists():
            continue
        G = netz_laden(puffer, typ)
        ox.save_graphml(G, f)
        print(f"  {typ}: {len(G.nodes)} Knoten", flush=True)


# Öffentliche Overpass-Server sind oft ausgelastet: mehrere Server im Wechsel, mit Pausen
ENDPOINTS = ["https://overpass.kumi.systems/api", "https://overpass-api.de/api", "https://overpass.private.coffee/api"]


def netz_laden(poly, typ):
    import time
    last = None
    for attempt in range(9):
        ox.settings.overpass_url = ENDPOINTS[attempt % len(ENDPOINTS)]
        ox.settings.overpass_rate_limit = "overpass-api.de" in ox.settings.overpass_url
        try:
            return ox.graph_from_polygon(poly, network_type=typ, simplify=True, retain_all=False)
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"  {typ}: Versuch {attempt + 1} über {ox.settings.overpass_url} fehlgeschlagen ({str(e)[:80]})", flush=True)
            time.sleep(20 * (attempt + 1))
    raise last


if __name__ == "__main__":
    netze = "--ohne-netze" not in sys.argv  # Netze alternativ aus OSM-Extrakt: 01b_netze_pbf.py
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    todo = alle_mit_daten() if (not args or args == ["all"]) else args
    pop = zensus_nrw()
    for ags in todo:
        try:
            stadt(ags, pop, netze)
        except Exception as e:  # noqa: BLE001
            print(f"  FEHLER {ags}: {e}", flush=True)
