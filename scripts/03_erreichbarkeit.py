"""Reisezeiten von jeder 100-m-Rasterzelle zu jedem Bad-Standort: zu Fuß, Rad, ÖPNV.

  python 03_erreichbarkeit.py <ags|all> [...] [--modes walk,bike,pt] [--force]

Annahmen (siehe README):
  Fuß  4,5 km/h  (75 m/min), Wegenetz OSM 'walk'
  Rad  15 km/h  (250 m/min), Wegenetz OSM 'bike', Einbahnstraßen beachtet
  ÖPNV Tür-zu-Tür: Fußweg zur Haltestelle (≤ 1 km, Luftlinie × 1,3),
       Fahrplan Stichtag (Dienstag), Umstiege ≤ 500 m Fußweg + 1 min Puffer,
       Fußweg zum Bad. Ankunft am Bad bis T, T = 17:00 … 19:00 im
       15-min-Takt; ausgewiesen wird der Median über alle T (Reverse
       Connection Scan). Wo zu Fuß schneller, gilt die Fußzeit.

Ausgabe je Stadt in cache/st/<slug>/:
  tt_walk.npy, tt_bike.npy, tt_pt.npy  (uint8 [Standorte, Zellen], Minuten; 255 = > 120 min)
  tt_standorte.json                    (Reihenfolge der Standort-IDs)
"""
from pathlib import Path
import json
import sys

import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

from staedte import alle_mit_daten, lade_stadt

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
MAXMIN = 120
WALK_MPM = 75.0
BIKE_MPM = 250.0
UMWEG = 1.3
to3035 = Transformer.from_crs(4326, 3035, always_xy=True)

_GTFS = {}


def gtfs():
    if not _GTFS:
        d = np.load(CACHE / "gtfs_nrw" / "connections.npz")
        _GTFS.update({k: d[k] for k in d.files})
        st = pd.read_csv(CACHE / "gtfs_nrw" / "stops.csv")
        x, y = to3035.transform(st.stop_lon.to_numpy(), st.stop_lat.to_numpy())
        _GTFS["sxy"] = np.column_stack([x, y])
    return _GTFS


def netz_zeiten(out: Path, typ: str, mpm: float, cxy, pxy) -> np.ndarray:
    G = ox.load_graphml(out / f"net_{typ}.graphml")
    G = ox.project_graph(G, to_crs="EPSG:3035")
    nodes = np.array(list(G.nodes))
    nxy = np.array([[G.nodes[n]["x"], G.nodes[n]["y"]] for n in nodes])
    tree = cKDTree(nxy)
    c_d, c_i = tree.query(cxy)
    p_d, p_i = tree.query(pxy)
    Grev = G.reverse(copy=False) if G.is_directed() else G
    idx = {n: i for i, n in enumerate(nodes)}
    res = np.full((len(pxy), len(cxy)), 255, dtype=np.uint8)
    for k in range(len(pxy)):
        dist = nx.single_source_dijkstra_path_length(Grev, nodes[p_i[k]], cutoff=MAXMIN * mpm, weight="length")
        nd = np.full(len(nodes), np.inf)
        for n, dd in dist.items():
            nd[idx[n]] = dd
        minutes = (nd[c_i] + c_d + p_d[k]) / mpm
        res[k] = np.where(minutes <= MAXMIN, np.round(minutes), 255).astype(np.uint8)
    return res


def oepnv_zeiten(cxy, pxy, walk: np.ndarray) -> np.ndarray:
    G = gtfs()
    pad = 5000
    lo = cxy.min(0) - pad; hi = cxy.max(0) + pad
    inbox = np.all((G["sxy"] >= lo) & (G["sxy"] <= hi), axis=1)
    keep = np.nonzero(inbox)[0]
    remap = np.full(len(inbox), -1, dtype=np.int64); remap[keep] = np.arange(len(keep))
    sxy = G["sxy"][keep]
    m = inbox[G["dep_stop"]] & inbox[G["arr_stop"]]
    C_dep = remap[G["dep_stop"][m]]; C_arr = remap[G["arr_stop"][m]]
    C_ds = G["dep_s"][m]; C_as = G["arr_s"][m]
    _, C_t = np.unique(G["trip"][m], return_inverse=True)
    order = np.argsort(-C_ds, kind="stable")
    C_dep, C_arr, C_ds, C_as, C_t = C_dep[order], C_arr[order], C_ds[order], C_as[order], C_t[order]
    ntrip = int(C_t.max()) + 1 if len(C_t) else 0
    ns = len(sxy)
    stree = cKDTree(sxy)
    foot_in = [[] for _ in range(ns)]
    for u, vs in enumerate(stree.query_ball_point(sxy, 500)):
        for v in vs:
            if u != v:
                foot_in[v].append((u, float(np.hypot(*(sxy[u] - sxy[v]))) * UMWEG / WALK_MPM * 60 + 60))
    acc = stree.query_ball_point(cxy, 1000)
    rows, cols, secs = [], [], []
    for i, js in enumerate(acc):
        for j in js:
            rows.append(i); cols.append(j)
            secs.append(np.hypot(*(cxy[i] - sxy[j])) * UMWEG / WALK_MPM * 60)
    rows = np.array(rows, dtype=np.int64); cols = np.array(cols, dtype=np.int64); secs = np.array(secs)
    o = np.argsort(rows, kind="stable"); rows, cols, secs = rows[o], cols[o], secs[o]
    starts = np.searchsorted(rows, np.arange(len(cxy)))
    has = np.bincount(rows, minlength=len(cxy)) > 0
    C_dep_l, C_arr_l, C_ds_l, C_as_l, C_t_l = C_dep.tolist(), C_arr.tolist(), C_ds.tolist(), C_as.tolist(), C_t.tolist()

    Ts = [17 * 3600 + 15 * 60 * k for k in range(9)]
    res = np.full((len(pxy), len(cxy)), 255, dtype=np.uint8)
    for k in range(len(pxy)):
        egress = [(j, float(np.hypot(*(pxy[k] - sxy[j]))) * UMWEG / WALK_MPM * 60)
                  for j in stree.query_ball_point(pxy[k], 1000)]
        runs = []
        for T in Ts:
            S = [-1e18] * ns; A = [-1e18] * ns
            for j, w in egress:
                S[j] = max(S[j], T - w); A[j] = max(A[j], T - w)
            ok = [False] * ntrip
            lo_t = T - (MAXMIN + 30) * 60
            i0 = int(np.searchsorted(-C_ds, -T, side="left"))
            for c in range(i0, len(C_ds_l)):
                ds = C_ds_l[c]
                if ds < lo_t:
                    break
                if C_as_l[c] > T:
                    continue
                t = C_t_l[c]
                if ok[t] or C_as_l[c] <= A[C_arr_l[c]]:
                    ok[t] = True
                    d = C_dep_l[c]
                    if ds > S[d]:
                        S[d] = ds
                        if ds - 60 > A[d]:
                            A[d] = ds - 60
                        for u, w in foot_in[d]:
                            v = ds - w
                            if v > S[u]:
                                S[u] = v
                            if v > A[u]:
                                A[u] = v
            Sa = np.array(S)
            best = np.full(len(cxy), -np.inf)
            if has.any():
                best[has] = np.maximum.reduceat(Sa[cols] - secs, starts[has])
            runs.append((T - best) / 60)
        med = np.median(np.vstack(runs), axis=0)
        wk = np.where(walk[k] == 255, np.inf, walk[k].astype(float))
        tot = np.minimum(med, wk)
        res[k] = np.where(tot <= MAXMIN, np.round(tot), 255).astype(np.uint8)
    return res


def stadt(ags: str, modes, force=False):
    s = lade_stadt(ags)
    out = CACHE / "st" / s["slug"]
    if not (out / "raster.csv").exists():
        print(f"## {s['stadt']}: Grundlagen fehlen, übersprungen", flush=True); return
    st = s["standorte"]
    if not st:
        print(f"## {s['stadt']}: keine verorteten Standorte", flush=True); return
    ids = [x["id"] for x in st]
    old = json.loads((out / "tt_standorte.json").read_text()) if (out / "tt_standorte.json").exists() else None
    if old != ids:
        force = True
    cells = pd.read_csv(out / "raster.csv")
    cxy = cells[["x", "y"]].to_numpy()
    pxy = np.array([to3035.transform(x["lon"], x["lat"]) for x in st])
    print(f"## {s['stadt']}: {len(st)} Standorte, {len(cells)} Zellen", flush=True)
    for mode in modes:
        f = out / f"tt_{mode}.npy"
        if f.exists() and not force:
            continue
        if mode == "walk":
            a = netz_zeiten(out, "walk", WALK_MPM, cxy, pxy)
        elif mode == "bike":
            a = netz_zeiten(out, "bike", BIKE_MPM, cxy, pxy)
        else:
            a = oepnv_zeiten(cxy, pxy, np.load(out / "tt_walk.npy"))
        np.save(f, a)
        ew = cells.ew.to_numpy()
        share = ew[a.min(0) <= 15].sum() / max(1, ew.sum())
        print(f"  {mode}: ≤15 min {share:.0%} der Einwohner (alle Standorte)", flush=True)
    (out / "tt_standorte.json").write_text(json.dumps(ids))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    modes = ["walk", "bike", "pt"]
    for a in sys.argv[1:]:
        if a.startswith("--modes="):
            modes = a.split("=", 1)[1].split(",")
    force = "--force" in sys.argv
    todo = alle_mit_daten() if (not args or args == ["all"]) else args
    for ags in todo:
        try:
            stadt(ags, modes, force)
        except Exception as e:  # noqa: BLE001
            import traceback; traceback.print_exc()
            print(f"  FEHLER {ags}: {e}", flush=True)
