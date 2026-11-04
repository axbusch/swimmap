"""Schneidet den deutschlandweiten GTFS-Fahrplan (gtfs.de, Nahverkehr, CC BY 4.0,
Daten: DELFI e.V.) auf NRW (+ Rand) und einen Stichtag zu.

  python 02_gtfs_filter.py [YYYY-MM-DD]     (Standard: Dienstag 2026-11-10)

Ausgabe: cache/gtfs_nrw/connections.npz  (dep_stop, arr_stop, dep_s, arr_s, trip als int-Arrays)
         cache/gtfs_nrw/stops.csv        (idx, stop_id, stop_name, stop_lat, stop_lon)
         cache/gtfs_nrw/meta.json
Voraussetzung: cache/gtfs/de_nv.zip  (https://download.gtfs.de/germany/nv_free/latest.zip)
"""
from datetime import date
from pathlib import Path
import io
import json
import sys
import zipfile

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "cache" / "gtfs" / "de_nv.zip"
OUT = ROOT / "cache" / "gtfs_nrw"
OUT.mkdir(parents=True, exist_ok=True)

STICHTAG = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date(2026, 11, 10)
BBOX = dict(lat=(50.25, 52.60), lon=(5.80, 9.55))  # NRW + ca. 5 km Rand
WOCHENTAG = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][STICHTAG.weekday()]
dstr = int(STICHTAG.strftime("%Y%m%d"))

z = zipfile.ZipFile(SRC)


def read(name, **kw):
    with z.open(name) as fh:
        return pd.read_csv(io.TextIOWrapper(fh, encoding="utf-8"), **kw)


stops = read("stops.txt", dtype={"stop_id": str, "parent_station": str})
stops = stops[stops.stop_lat.between(*BBOX["lat"]) & stops.stop_lon.between(*BBOX["lon"])]
stop_ids = set(stops.stop_id)
print("Haltestellen im Raum:", len(stops), flush=True)

cal = read("calendar.txt", dtype={"service_id": str})
act = set(cal[(cal[WOCHENTAG] == 1) & (cal.start_date <= dstr) & (cal.end_date >= dstr)].service_id)
cd = read("calendar_dates.txt", dtype={"service_id": str})
cd = cd[cd.date == dstr]
act |= set(cd[cd.exception_type == 1].service_id)
act -= set(cd[cd.exception_type == 2].service_id)
print("Feed-Gültigkeit:", cal.start_date.min(), "–", cal.end_date.max(), "| aktive service_ids:", len(act), flush=True)

trips = read("trips.txt", dtype={"service_id": str, "trip_id": str, "route_id": str})
trip_ids = set(trips[trips.service_id.isin(act)].trip_id)

parts = []
with z.open("stop_times.txt") as fh:
    for i, ch in enumerate(pd.read_csv(io.TextIOWrapper(fh, encoding="utf-8"), chunksize=2_000_000,
                                       usecols=["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
                                       dtype={"trip_id": str, "stop_id": str})):
        ch = ch[ch.trip_id.isin(trip_ids) & ch.stop_id.isin(stop_ids)]
        parts.append(ch)
        if i % 10 == 0:
            print("  Chunk", i, flush=True)
st = pd.concat(parts)


def secs(s):
    h, mi, se = s.str.split(":", expand=True).astype(int).T.values
    return h * 3600 + mi * 60 + se


st["arr"] = secs(st.arrival_time)
st["dep"] = secs(st.departure_time)
st = st.sort_values(["trip_id", "stop_sequence"])
nxt = st.groupby("trip_id").shift(-1)
con = pd.DataFrame({"trip": st.trip_id, "dep_stop": st.stop_id, "arr_stop": nxt.stop_id,
                    "dep_s": st.dep, "arr_s": nxt.arr}).dropna()
con = con[con.dep_stop != con.arr_stop]

used = sorted(set(con.dep_stop) | set(con.arr_stop))
sidx = {s: i for i, s in enumerate(used)}
stops = stops.set_index("stop_id").loc[used].reset_index()
stops.insert(0, "idx", range(len(stops)))
stops[["idx", "stop_id", "stop_name", "stop_lat", "stop_lon"]].to_csv(OUT / "stops.csv", index=False)
tidx = {t: i for i, t in enumerate(con.trip.unique())}
np.savez_compressed(
    OUT / "connections.npz",
    dep_stop=con.dep_stop.map(sidx).to_numpy(np.int32),
    arr_stop=con.arr_stop.map(sidx).to_numpy(np.int32),
    dep_s=con.dep_s.to_numpy(np.int32),
    arr_s=con.arr_s.astype(int).to_numpy(np.int32),
    trip=con.trip.map(tidx).to_numpy(np.int32),
)
json.dump({"stichtag": STICHTAG.isoformat(), "fahrten": len(tidx), "verbindungen": len(con),
           "haltestellen": len(used), "quelle": "gtfs.de (DELFI e.V.), Nahverkehr Deutschland, CC BY 4.0"},
          open(OUT / "meta.json", "w"), ensure_ascii=False, indent=1)
print("Verbindungen:", len(con), "Fahrten:", len(tidx), "Haltestellen:", len(used))
