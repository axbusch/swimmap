"""Reisezeiten von jeder 100-m-Rasterzelle zu jedem Bad: zu Fuß, Rad, ÖPNV.

Annahmen (siehe README):
  Fuß  4,5 km/h  (75 m/min), Wegenetz OSM 'walk'
  Rad  15 km/h  (250 m/min), Wegenetz OSM 'bike', Einbahnstraßen beachtet
  ÖPNV Tür-zu-Tür: Fußweg zur Haltestelle (≤ 1 km, Luftlinie × 1,3),
       Fahrplan Stichtag (Dienstag), Umstiege ≤ 500 m Fußweg + 1 min Puffer,
       Fußweg zum Bad. Ankunft am Bad bis T, T = 17:00 … 19:00 im
       15-min-Takt; ausgewiesen wird der Median über alle T.
       Wo zu Fuß schneller, gilt die Fußzeit.

Ausgabe: cache/tt_walk.npy, cache/tt_bike.npy, cache/tt_pt.npy
         (uint8, Form [Bäder, Zellen], Minuten; 255 = > 120 min/unerreichbar)
         cache/tt_pools.json (Reihenfolge der Bäder)
"""
from pathlib import Path
import json

import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
MAXMIN = 120
WALK_MPM = 75.0
BIKE_MPM = 250.0
UMWEG = 1.3

cells = pd.read_csv(CACHE / "raster.csv")
cxy = cells[["x", "y"]].to_numpy()
baeder = json.loads((ROOT / "data" / "muenster_baeder.json").read_text(encoding="utf-8"))["baeder"]
to3035 = Transformer.from_crs(4326, 3035, always_xy=True)
pxy = np.array([to3035.transform(b["lon"], b["lat"]) for b in baeder])
json.dump([b["id"] for b in baeder], open(CACHE / "tt_pools.json", "w"))


def netz_zeiten(typ: str, mpm: float) -> np.ndarray:
    G = ox.load_graphml(CACHE / f"net_{typ}.graphml")
    G = ox.project_graph(G, to_crs="EPSG:3035")
    nodes = np.array(list(G.nodes))
    nxy = np.array([[G.nodes[n]["x"], G.nodes[n]["y"]] for n in nodes])
    tree = cKDTree(nxy)
    c_d, c_i = tree.query(cxy)
    p_d, p_i = tree.query(pxy)
    Grev = G.reverse(copy=False) if G.is_directed() else G
    idx = {n: i for i, n in enumerate(nodes)}
    out = np.full((len(baeder), len(cells)), 255, dtype=np.uint8)
    for k, b in enumerate(baeder):
        src = nodes[p_i[k]]
        dist = nx.single_source_dijkstra_path_length(Grev, src, cutoff=MAXMIN * mpm, weight="length")
        nd = np.full(len(nodes), np.inf)
        for n, dd in dist.items():
            nd[idx[n]] = dd
        meter = nd[c_i] + c_d + p_d[k]
        minutes = meter / mpm
        out[k] = np.where(minutes <= MAXMIN, np.round(minutes), 255).astype(np.uint8)
        print(f"  {typ} {b['name']}: ≤15 min {(minutes <= 15).sum()} Zellen", flush=True)
    return out


def oepnv_zeiten(walk: np.ndarray) -> np.ndarray:
    st = pd.read_csv(CACHE / "gtfs_ms" / "stops.csv", dtype={"stop_id": str})
    con = pd.read_csv(CACHE / "gtfs_ms" / "connections.csv", dtype={"trip": str, "dep_stop": str, "arr_stop": str})
    sid = {s: i for i, s in enumerate(st.stop_id)}
    sxy = np.array([to3035.transform(lo, la) for lo, la in zip(st.stop_lon, st.stop_lat)])
    stree = cKDTree(sxy)
    ns = len(st)

    # Fußwege zwischen Haltestellen (eingehend: foot_in[v] = [(u, sek)])
    foot_in = [[] for _ in range(ns)]
    for u, vs in enumerate(stree.query_ball_point(sxy, 500)):
        for v in vs:
            if u != v:
                w = np.hypot(*(sxy[u] - sxy[v])) * UMWEG / WALK_MPM * 60 + 60
                foot_in[v].append((u, w))

    # Zugang Zelle -> Haltestelle (≤ 1 km), als Liste je Zelle
    acc = stree.query_ball_point(cxy, 1000)
    rows, cols, secs = [], [], []
    for i, js in enumerate(acc):
        for j in js:
            rows.append(i); cols.append(j)
            secs.append(np.hypot(*(cxy[i] - sxy[j])) * UMWEG / WALK_MPM * 60)
    rows = np.array(rows); cols = np.array(cols); secs = np.array(secs)
    order = np.argsort(rows, kind="stable")
    rows, cols, secs = rows[order], cols[order], secs[order]
    starts = np.searchsorted(rows, np.arange(len(cells)))
    has = np.bincount(rows, minlength=len(cells)) > 0

    con = con[con.dep_stop.isin(sid) & con.arr_stop.isin(sid)]
    con = con.sort_values("dep_s", ascending=False)
    tid = {t: i for i, t in enumerate(con.trip.unique())}
    C_dep = con.dep_stop.map(sid).to_numpy()
    C_arr = con.arr_stop.map(sid).to_numpy()
    C_ds = con.dep_s.to_numpy()
    C_as = con.arr_s.to_numpy()
    C_t = con.trip.map(tid).to_numpy()
    ntrip = len(tid)

    Ts = [17 * 3600 + 15 * 60 * k for k in range(9)]
    out = np.full((len(baeder), len(cells)), 255, dtype=np.uint8)
    for k, b in enumerate(baeder):
        egress = [(j, np.hypot(*(pxy[k] - sxy[j])) * UMWEG / WALK_MPM * 60)
                  for j in stree.query_ball_point(pxy[k], 1000)]
        res = []
        for T in Ts:
            S = np.full(ns, -np.inf)   # spätestens an Haltestelle sein (Zugang von außen)
            A = np.full(ns, -np.inf)   # spätestens per Fahrzeug ankommen (Umstieg)
            for j, w in egress:
                S[j] = max(S[j], T - w); A[j] = max(A[j], T - w)
            ok = np.zeros(ntrip, dtype=bool)
            lo = T - (MAXMIN + 30) * 60
            sel = np.nonzero((C_ds <= T) & (C_ds >= lo) & (C_as <= T))[0]
            Sl, Al, okl = S.tolist(), A.tolist(), ok.tolist()
            for c in sel.tolist():
                t = C_t[c]
                if okl[t] or C_as[c] <= Al[C_arr[c]]:
                    okl[t] = True
                    d, ds = C_dep[c], C_ds[c]
                    if ds > Sl[d]:
                        Sl[d] = ds
                        if ds - 60 > Al[d]:
                            Al[d] = ds - 60
                        for u, w in foot_in[d]:
                            if ds - w > Sl[u]:
                                Sl[u] = ds - w
                            if ds - w > Al[u]:
                                Al[u] = ds - w
            S = np.array(Sl)
            vals = S[cols] - secs
            best = np.full(len(cells), -np.inf)
            nz = has
            best[nz] = np.maximum.reduceat(vals, starts[nz])
            tt = (T - best) / 60
            res.append(tt)
        med = np.median(np.vstack(res), axis=0)
        wk = np.where(walk[k] == 255, np.inf, walk[k].astype(float))
        tot = np.minimum(med, wk)
        out[k] = np.where(tot <= MAXMIN, np.round(tot), 255).astype(np.uint8)
        print(f"  ÖPNV {b['name']}: ≤15 min {(tot <= 15).sum()}, ≤30 min {(tot <= 30).sum()} Zellen", flush=True)
    return out


if __name__ == "__main__":
    import sys
    modes = sys.argv[1:] or ["walk", "bike", "pt"]
    if "walk" in modes:
        np.save(CACHE / "tt_walk.npy", netz_zeiten("walk", WALK_MPM))
    if "bike" in modes:
        np.save(CACHE / "tt_bike.npy", netz_zeiten("bike", BIKE_MPM))
    if "pt" in modes:
        np.save(CACHE / "tt_pt.npy", oepnv_zeiten(np.load(CACHE / "tt_walk.npy")))
