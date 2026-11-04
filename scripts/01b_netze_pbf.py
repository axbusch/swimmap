"""Fuß- und Radnetze aller Städte aus einem lokalen OSM-Extrakt (statt Overpass).

  python 01b_netze_pbf.py [ags ...]

Liest cache/osm/nrw.osm.pbf (Geofabrik, © OpenStreetMap-Mitwirkende, ODbL) in
einem Durchgang, filtert Wege mit denselben Regeln wie OSMnx (network_type
'walk' bzw. 'bike') und schreibt je Stadt (Stadtgrenze + 3 km) eine OSM-XML,
aus der OSMnx den Graphen baut:
  cache/st/<slug>/net_walk.graphml, net_bike.graphml
Quelle: https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf
"""
from pathlib import Path
from xml.sax.saxutils import quoteattr
import re
import sys

import geopandas as gpd
import osmium
import osmnx as ox
from osmnx import _overpass

from staedte import alle_mit_daten, einwohner, slugify

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
PBF = CACHE / "osm" / "nrw.osm.pbf"
TAGS = ("highway", "oneway", "junction", "name", "maxspeed", "access", "bicycle", "foot", "service", "area", "lanes")


def parse_filter(s: str):
    """Overpass-Filter von OSMnx -> Liste (key, op, regex). op: 'has' | '!~' | '~'."""
    out = []
    for k, op, rx in re.findall(r'\["([^"]+)"(?:(!?~)"([^"]*)")?\]', s):
        out.append((k, op or "has", re.compile(rx) if rx else None))
    return out


FILTERS = {t: parse_filter(_overpass._get_network_filter(t)) for t in ("walk", "bike")}


def passt(tags, rules) -> bool:
    for k, op, rx in rules:
        v = tags.get(k)
        if op == "has":
            if v is None:
                return False
        elif op == "!~":
            if v is not None and rx.search(v):
                return False
        elif op == "~":
            if v is None or not rx.search(v):
                return False
    return True


class Sammler(osmium.SimpleHandler):
    def __init__(self, staedte):
        super().__init__()
        self.st = staedte  # [(slug, bbox, prep(poly))]
        # Wege direkt in Zwischendateien schreiben (spart Arbeitsspeicher)
        self.wf = {(s, t): open(CACHE / "st" / s / f"_ways_{t}.xml", "w", encoding="utf-8") for s, _, _ in staedte for t in FILTERS}
        self.nodes = {(s, t): {} for s, _, _ in staedte for t in FILTERS}
        self.n = 0

    def way(self, w):
        tags = w.tags
        if "highway" not in tags:
            return
        td = {k: tags.get(k) for k in set(k for r in FILTERS.values() for k, _, _ in r) | set(TAGS) if k in tags}
        typen = [t for t, r in FILTERS.items() if passt(td, r)]
        if not typen:
            return
        try:
            coords = [(n.ref, n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        lats = [c[1] for c in coords]; lons = [c[2] for c in coords]
        wb = (min(lons), min(lats), max(lons), max(lats))
        for slug, bb, _ in self.st:
            if wb[2] < bb[0] or wb[0] > bb[2] or wb[3] < bb[1] or wb[1] > bb[3]:
                continue
            line = (f'<way id="{w.id}">' + "".join(f'<nd ref="{c[0]}"/>' for c in coords)
                    + "".join(f"<tag k={quoteattr(k)} v={quoteattr(v)}/>" for k, v in td.items() if k in TAGS) + "</way>\n")
            for t in typen:
                self.wf[(slug, t)].write(line)
                nd = self.nodes[(slug, t)]
                for ref, la, lo in coords:
                    nd[ref] = (la, lo)
        self.n += 1
        if self.n % 500000 == 0:
            print(f"  {self.n} Wege verarbeitet", flush=True)


def xml_schreiben(path: Path, nodes: dict, ways_file: Path):
    with open(path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="swimmap">\n')
        for ref, (la, lo) in nodes.items():
            f.write(f'<node id="{ref}" lat="{la:.7f}" lon="{lo:.7f}"/>\n')
        with open(ways_file, encoding="utf-8") as wf:
            for line in wf:
                f.write(line)
        f.write("</osm>\n")
    ways_file.unlink()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ew = einwohner()
    todo = args or alle_mit_daten()
    staedte = []
    for ags in todo:
        slug = slugify(ew[ags][0])
        out = CACHE / "st" / slug
        if not (out / "grenze.gpkg").exists():
            print(f"{slug}: Grenze fehlt (01_grundlagen.py --ohne-netze)"); continue
        if (out / "net_walk.graphml").exists() and (out / "net_bike.graphml").exists() and "--force" not in sys.argv:
            continue
        g = gpd.read_file(out / "grenze.gpkg")
        poly = gpd.GeoSeries([g.geometry.iloc[0].buffer(3000)], crs=3035).to_crs(4326).iloc[0]
        staedte.append((slug, poly.bounds, poly))
    if not staedte:
        print("nichts zu tun"); return
    print(f"Lese {PBF.name} für {len(staedte)} Städte …", flush=True)
    h = Sammler(staedte)
    h.apply_file(str(PBF), locations=True, idx="flex_mem")
    for f in h.wf.values():
        f.close()
    for slug, _, poly in staedte:
        out = CACHE / "st" / slug
        for t in FILTERS:
            xml = out / f"net_{t}.osm"
            xml_schreiben(xml, h.nodes[(slug, t)], out / f"_ways_{t}.xml")
            h.nodes[(slug, t)] = None
            G = ox.graph_from_xml(xml, bidirectional=(t in ox.settings.bidirectional_network_types),
                                  simplify=False, retain_all=True)
            # wie OSMnx bei graph_from_polygon: auf das Polygon zuschneiden, dann vereinfachen
            G = ox.truncate.truncate_graph_polygon(G, poly, truncate_by_edge=False)
            G = ox.simplify_graph(G)
            G = ox.truncate.largest_component(G, strongly=False)
            ox.save_graphml(G, out / f"net_{t}.graphml")
            xml.unlink()
            print(f"  {slug} {t}: {len(G.nodes)} Knoten, {len(G.edges)} Kanten", flush=True)


if __name__ == "__main__":
    main()
