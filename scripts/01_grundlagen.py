"""Grundlagen: Stadtgrenze, Bevölkerungsraster (Zensus 2022, 100 m), Wegenetze.

Ausgaben:
  cache/grenze.gpkg           Stadtgrenze Münster (OSM)
  cache/raster.csv            100-m-Zellen innerhalb der Stadt (+ Einwohner)
  cache/net_walk.graphml      Fußwegenetz (OSM)
  cache/net_bike.graphml      Radwegenetz (OSM)
  docs/data/grenze.geojson    vereinfachte Grenze für die Webseite

Voraussetzung: cache/zensus/z22_pop.zip
  (https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Bevoelkerungszahl.zip)
"""
from pathlib import Path
import zipfile

import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
WEB = ROOT / "docs" / "data"
WEB.mkdir(parents=True, exist_ok=True)

ox.settings.use_cache = True
ox.settings.cache_folder = str(CACHE / "osmnx")
ox.settings.log_console = False

# --- Stadtgrenze ---------------------------------------------------------
grenze = ox.geocode_to_gdf("R62591", by_osmid=True)  # Münster, kreisfreie Stadt
grenze = grenze[["geometry"]].to_crs(3035)
grenze.to_file(CACHE / "grenze.gpkg")
g_web = grenze.copy()
g_web["geometry"] = g_web.simplify(20)
g_web.to_crs(4326).to_file(WEB / "grenze.geojson", driver="GeoJSON")
poly = grenze.geometry.iloc[0]
print("Fläche km²:", round(poly.area / 1e6, 1))

# --- Bevölkerungsraster ----------------------------------------------------
minx, miny, maxx, maxy = poly.bounds
z = zipfile.ZipFile(CACHE / "zensus" / "z22_pop.zip")
name = next(n for n in z.namelist() if n.endswith("100m-Gitter.csv"))
parts = []
with z.open(name) as fh:
    for chunk in pd.read_csv(fh, sep=";", chunksize=500_000,
                             usecols=["x_mp_100m", "y_mp_100m", "Einwohner"]):
        m = chunk.x_mp_100m.between(minx - 100, maxx + 100) & chunk.y_mp_100m.between(miny - 100, maxy + 100)
        parts.append(chunk[m])
pop = pd.concat(parts).rename(columns={"x_mp_100m": "x", "y_mp_100m": "y", "Einwohner": "ew"})
pop["ew"] = pd.to_numeric(pop["ew"], errors="coerce").fillna(0).astype(int)  # Geheimhaltung: '–' -> 0

# vollständiges Raster (auch unbewohnte Zellen) innerhalb der Stadtgrenze
xs = np.arange(np.floor(minx / 100) * 100 + 50, maxx + 100, 100)
ys = np.arange(np.floor(miny / 100) * 100 + 50, maxy + 100, 100)
gx, gy = np.meshgrid(xs, ys)
cells = gpd.GeoDataFrame({"x": gx.ravel(), "y": gy.ravel()},
                         geometry=gpd.points_from_xy(gx.ravel(), gy.ravel()), crs=3035)
cells = cells[cells.within(poly)].copy()
cells = cells.merge(pop, on=["x", "y"], how="left")
cells["ew"] = cells["ew"].fillna(0).astype(int)
ll = gpd.GeoSeries(gpd.points_from_xy(cells.x, cells.y), crs=3035).to_crs(4326)
cells["lon"] = ll.x.values
cells["lat"] = ll.y.values
cells[["x", "y", "lon", "lat", "ew"]].to_csv(CACHE / "raster.csv", index=False)
print("Zellen:", len(cells), "bewohnt:", int((cells.ew > 0).sum()), "Einwohner (Zensus 2022):", int(cells.ew.sum()))

# --- Wegenetze -------------------------------------------------------------
puffer = gpd.GeoSeries([poly.buffer(3000)], crs=3035).to_crs(4326).iloc[0]
for typ in ("walk", "bike"):
    G = ox.graph_from_polygon(puffer, network_type=typ, simplify=True, retain_all=False)
    ox.save_graphml(G, CACHE / f"net_{typ}.graphml")
    print(typ, "Knoten:", len(G.nodes), "Kanten:", len(G.edges))
