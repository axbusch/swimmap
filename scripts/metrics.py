"""Kennzahlen für öffentliche Schwimmzeiten.

Definitionen (siehe auch README, Abschnitt Methodik):

- Öffentliche Stunden/Woche (h):   Summe der Dauer aller Slots der Art
  'oeffentlich' oder 'teiloeffentlich', gewichtet mit 'haeufigkeit'.
- Wasserflächen-Stunden (m²·h):    wie oben, zusätzlich gewichtet mit der
  Wasserfläche des Bades und dem 'flaechenanteil' des Slots.
- Zielgruppen-Stunden (h):         Slots der Art 'zielgruppe', separat
  ausgewiesen, nicht Teil der Kernmetrik.

Stadtkennzahlen (Kern: städtische Hallenbäder):
- Stunden je 10.000 EW            = Σ h / EW · 10.000
- m²·h je 1.000 EW                = Σ m²·h / EW · 1.000
- Wasserfläche m² je 1.000 EW     = Σ Wasserfläche der Bäder mit
                                    öffentlichen Zeiten / EW · 1.000
"""
from __future__ import annotations

import json
from pathlib import Path

TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
OEFFENTLICH = {"oeffentlich", "teiloeffentlich"}


def _h(t: str) -> float:
    hh, mm = t.split(":")
    return int(hh) + int(mm) / 60


def slot_dauer(s: dict) -> float:
    return max(0.0, _h(s["bis"]) - _h(s["von"]))


def bad_kennzahlen(bad: dict) -> dict:
    flaeche = bad.get("wasserflaeche_m2")
    h = hv = hz = wfh = 0.0
    pro_tag = {t: 0.0 for t in TAGE}
    for s in bad.get("slots", []):
        d = slot_dauer(s) * s.get("haeufigkeit", 1.0)
        art = s["art"]
        if art in OEFFENTLICH:
            h += d
            pro_tag[s["tag"]] += d
            if art == "oeffentlich":
                hv += d
            if flaeche:
                wfh += d * flaeche * s.get("flaechenanteil", 1.0)
        elif art == "zielgruppe":
            hz += d
    return {
        "stunden_woche": round(h, 2),
        "stunden_voll_woche": round(hv, 2),
        "stunden_zielgruppe_woche": round(hz, 2),
        "m2h_woche": round(wfh, 1) if flaeche else None,
        "stunden_pro_tag": {k: round(v, 2) for k, v in pro_tag.items()},
    }


def stadt_kennzahlen(baeder: list[dict], einwohner: int, filt=None) -> dict:
    filt = filt or (lambda b: b["typ"] == "hallenbad" and b["kategorie"] == "staedtisch")
    sel = [b for b in baeder if filt(b)]
    ks = [bad_kennzahlen(b) for b in sel]
    h = sum(k["stunden_woche"] for k in ks)
    m2h = sum(k["m2h_woche"] or 0 for k in ks)
    flaeche = sum((b.get("wasserflaeche_m2") or 0) for b, k in zip(sel, ks) if k["stunden_woche"] > 0)
    return {
        "anzahl_baeder": len(sel),
        "anzahl_baeder_oeffentlich": sum(1 for k in ks if k["stunden_woche"] > 0),
        "stunden_woche": round(h, 1),
        "m2h_woche": round(m2h),
        "wasserflaeche_oeffentlich_m2": round(flaeche, 1),
        "einwohner": einwohner,
        "stunden_je_10k_ew": round(h / einwohner * 10_000, 2),
        "m2h_je_1000_ew": round(m2h / einwohner * 1_000, 1),
        "wasserflaeche_m2_je_1000_ew": round(flaeche / einwohner * 1_000, 2),
        "datenluecken": [b["name"] for b in sel if b.get("zeiten_unbekannt") or not b.get("wasserflaeche_m2")],
    }


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    d = json.loads((root / "data" / "muenster_baeder.json").read_text(encoding="utf-8"))
    for b in d["baeder"]:
        k = bad_kennzahlen(b)
        print(f'{b["name"]:32s} {b["typ"]:9s} {b["kategorie"]:10s} {k["stunden_woche"]:6.1f} h  {k["m2h_woche"] or 0:9.0f} m²h  ZG {k["stunden_zielgruppe_woche"]:.1f} h')
    print(json.dumps(stadt_kennzahlen(d["baeder"], 306368), ensure_ascii=False, indent=1))
