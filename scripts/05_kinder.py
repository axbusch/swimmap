"""Ergänzt das Raster jeder Stadt um die Zahl der Schulkinder (6–15 Jahre).

  python 05_kinder.py

Quelle: Zensus 2022, 'Alter in infrastrukturellen Altersgruppen', 100-m-Gitter
  https://www.destatis.de/static/DE/zensus/gitterdaten/Alter_in_infrastrukturellen_Altersgruppen.zip
  -> cache/zensus/alter_infra.zip

Geheimhaltung: Einzelne Altersklassen sind in Zellen mit wenigen Personen
geschwärzt ('–'). Der Rest (Gesamtzahl minus bekannte Klassen) wird auf die
geschwärzten Klassen verteilt, im Verhältnis der NRW-weiten Anteile dieser
Klassen. Ergebnis: Spalte 'k615' in cache/st/<slug>/raster.csv.
"""
from pathlib import Path
import zipfile

import numpy as np
import pandas as pd
from pyproj import Transformer

from staedte import alle_mit_daten, einwohner, slugify

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
KL = ["Unter3", "a3bis5", "a6bis9", "a10bis15", "a16bis18", "a19bis24", "a25bis39", "a40bis59", "a60bis66", "a67bis74", "a75undaelter"]
KIND = ["a6bis9", "a10bis15"]


def alter_nrw() -> pd.DataFrame:
    f = CACHE / "zensus_alter_nrw.csv"
    if f.exists():
        return pd.read_csv(f)
    t = Transformer.from_crs(4326, 3035, always_xy=True)
    x0, y0 = t.transform(5.80, 50.25); x1, y1 = t.transform(9.55, 52.60)
    z = zipfile.ZipFile(CACHE / "zensus" / "alter_infra.zip")
    name = next(n for n in z.namelist() if n.endswith("100m-Gitter.csv"))
    parts = []
    with z.open(name) as fh:
        for ch in pd.read_csv(fh, sep=";", chunksize=1_000_000, encoding="latin-1", dtype=str):
            x = pd.to_numeric(ch.x_mp_100m); y = pd.to_numeric(ch.y_mp_100m)
            parts.append(ch[x.between(x0 - 20000, x1 + 20000) & y.between(y0 - 20000, y1 + 20000)])
    d = pd.concat(parts)
    out = pd.DataFrame({"x": d.x_mp_100m.astype(int), "y": d.y_mp_100m.astype(int),
                        "tot": pd.to_numeric(d.Insgesamt_Bevoelkerung, errors="coerce")})
    for k in KL:
        out[k] = pd.to_numeric(d[k], errors="coerce")  # geschwärzt -> NaN
    out.to_csv(f, index=False)
    return out


def imputieren(a: pd.DataFrame) -> pd.Series:
    known = a[KL]
    share = known.sum() / known.sum().sum()  # NRW-weite Klassenanteile
    rem = (a["tot"].fillna(0) - known.sum(axis=1, skipna=True)).clip(lower=0)
    miss = known.isna()
    w = miss.mul(share, axis=1)
    wsum = w.sum(axis=1).replace(0, np.nan)
    filled = known.fillna(0) + w.div(wsum, axis=0).fillna(0).mul(rem, axis=0)
    return filled[KIND].sum(axis=1)


def main():
    a = alter_nrw()
    a["k615"] = imputieren(a)
    print("NRW: Kinder 6–15 (inkl. Schätzung geschwärzter Werte):", int(a.k615.sum()),
          "| davon geschätzt:", int((a.k615 - a[KIND].fillna(0).sum(axis=1)).sum()))
    ew = einwohner()
    for ags in alle_mit_daten():
        slug = slugify(ew[ags][0])
        f = CACHE / "st" / slug / "raster.csv"
        if not f.exists():
            continue
        r = pd.read_csv(f).drop(columns=["k615"], errors="ignore")
        r = r.merge(a[["x", "y", "k615"]], on=["x", "y"], how="left")
        r["k615"] = r["k615"].fillna(0).round(1)
        r.to_csv(f, index=False)
        print(f"  {ew[ags][0]:20s} Kinder 6–15: {int(r.k615.sum()):6d}  ({r.k615.sum() / max(1, r.ew.sum()):.1%} der Einwohner)")


if __name__ == "__main__":
    main()
