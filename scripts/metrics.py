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


def parse_slot(s) -> dict:
    """Slot als dict oder Kurzform-String:
    'Mo 06:30-22:00'                     öffentlich
    'Mi 08:00-13:00 teil 0.28'           Teilfläche (Flächenanteil 0,28)
    'Sa 10:00-12:00 ziel Frauenschwimmen' Zielgruppe (+ Hinweis)
    'Sa 10:00-16:00 x0.5'                nicht jede Woche (Häufigkeit)
    Mehrere Tage: 'Mo,Di,Mi 06:30-08:00' bzw. 'Mo-Fr 06:30-08:00'.
    """
    if isinstance(s, dict):
        return [s]
    parts = s.split()
    tage_raw, zeit, rest = parts[0], parts[1], parts[2:]
    if "-" in tage_raw and "," not in tage_raw:
        a, b = tage_raw.split("-")
        tage = TAGE[TAGE.index(a): TAGE.index(b) + 1]
    else:
        tage = tage_raw.split(",")
    von, bis = zeit.split("-")
    d = {"von": von, "bis": bis, "art": "oeffentlich"}
    i = 0
    hinweis = []
    while i < len(rest):
        tok = rest[i]
        if tok == "teil":
            d["art"] = "teiloeffentlich"
            if i + 1 < len(rest):
                try:
                    d["flaechenanteil"] = float(rest[i + 1]); i += 1
                except ValueError:
                    pass
        elif tok == "ziel":
            d["art"] = "zielgruppe"
        elif tok.startswith("x"):
            try:
                d["haeufigkeit"] = float(tok[1:])
            except ValueError:
                hinweis.append(tok)
        else:
            hinweis.append(tok)
        i += 1
    if hinweis:
        d["hinweis"] = " ".join(hinweis)
    return [dict(d, tag=t) for t in tage]


def slots_of(bad: dict) -> list[dict]:
    return [x for s in bad.get("slots", []) for x in parse_slot(s)]


def bad_kennzahlen(bad: dict) -> dict:
    flaeche = bad.get("wasserflaeche_m2")
    h = hv = hz = wfh = 0.0
    pro_tag = {t: 0.0 for t in TAGE}
    for s in slots_of(bad):
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


def ist_kern(b: dict) -> bool:
    """Kernmetrik: kommunale Hallenbäder; reine Freizeitbereiche (Wellenbad,
    Rutschen) zählen nicht, die Sportbecken von Freizeitbädern schon."""
    return b["typ"] == "hallenbad" and b["kategorie"] == "staedtisch" and not b.get("freizeitbad")


def stadt_kennzahlen(baeder: list[dict], einwohner: int, filt=None) -> dict:
    filt = filt or ist_kern
    sel = [b for b in baeder if filt(b)]
    ks = [bad_kennzahlen(b) for b in sel]
    h = sum(k["stunden_woche"] for k in ks)
    m2h = sum(k["m2h_woche"] or 0 for k in ks)
    flaeche = sum((b.get("wasserflaeche_m2") or 0) for b, k in zip(sel, ks) if k["stunden_woche"] > 0)
    flaeche_fehlt = [b["name"] for b, k in zip(sel, ks) if k["stunden_woche"] > 0 and not b.get("wasserflaeche_m2")]
    if flaeche_fehlt:  # unvollständige Flächen würden die Kennzahl verzerren
        return {
            "anzahl_baeder": len(sel),
            "anzahl_baeder_oeffentlich": sum(1 for k in ks if k["stunden_woche"] > 0),
            "stunden_woche": round(h, 1),
            "m2h_woche": None,
            "wasserflaeche_oeffentlich_m2": None,
            "einwohner": einwohner,
            "stunden_je_10k_ew": round(h / einwohner * 10_000, 2),
            "m2h_je_1000_ew": None,
            "wasserflaeche_m2_je_1000_ew": None,
            "datenluecken": [f"Wasserfläche fehlt: {n}" for n in flaeche_fehlt]
                            + [b["name"] for b in sel if b.get("zeiten_unbekannt")],
        }
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
        "datenluecken": [b["name"] for b, k in zip(sel, ks) if b.get("zeiten_unbekannt") or (k["stunden_woche"] > 0 and not b.get("wasserflaeche_m2"))],
    }


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    d = json.loads((root / "data" / "muenster_baeder.json").read_text(encoding="utf-8"))
    for b in d["baeder"]:
        k = bad_kennzahlen(b)
        print(f'{b["name"]:32s} {b["typ"]:9s} {b["kategorie"]:10s} {k["stunden_woche"]:6.1f} h  {k["m2h_woche"] or 0:9.0f} m²h  ZG {k["stunden_zielgruppe_woche"]:.1f} h')
    print(json.dumps(stadt_kennzahlen(d["baeder"], 306368), ensure_ascii=False, indent=1))
