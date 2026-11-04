"""Schließtage und tatsächlich angebotene Jahresstunden der Münsteraner Hallenbäder.

  python 06_schliesstage.py

Eingabe:  data/muenster_schliessungen.json (Chronik aus Pressemitteilungen)
          data/muenster_baeder.json        (Regelplan = Stunden je Wochentag)
Ausgabe:  cache/muenster_schliessungen_out.json (wird von 04_build_web.py eingebunden)

Definition: Ein Schließtag ist ein Tag, an dem das Bad laut damals gültigem
Regelplan öffentliches Schwimmen hätte, aber für die Öffentlichkeit ganz
geschlossen war. Bei Überschneidungen gilt die Priorität
defekt > revision > ferien > sommer > feiertag > personal.
"""
from datetime import date, timedelta
from pathlib import Path
import json

from metrics import TAGE, slots_of, slot_dauer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PRIO = ["defekt", "revision", "ferien", "sommer", "feiertag", "personal"]
CODE = {"offen": "o", "kein_plan": ".", **{k: str(i + 1) for i, k in enumerate(PRIO)}}

src = json.loads((DATA / "muenster_schliessungen.json").read_text(encoding="utf-8"))
baeder = {b["id"]: b for b in json.loads((DATA / "muenster_baeder.json").read_text(encoding="utf-8"))["baeder"]}
d0 = date.fromisoformat(src["zeitraum"]["von"])
d1 = date.fromisoformat(src["zeitraum"]["bis"])
iso = date.fromisoformat


def plan_stunden(bid):
    h = {t: 0.0 for t in TAGE}
    for s in slots_of(baeder[bid]):
        if s["art"] in ("oeffentlich", "teiloeffentlich"):
            h[s["tag"]] += slot_dauer(s) * s.get("haeufigkeit", 1.0)
    return h


feiertage = {iso(k): v for jahr in src["feiertage"].values() for k, v in jahr.items()}
out = {"zeitraum": src["zeitraum"], "kategorien": src["kategorien"], "methodik": src["methodik"],
       "feiertage_hinweis": src["feiertage_hinweis"], "codes": CODE, "baeder": {}, "jahre": {},
       "ereignisse": src["schliessungen"], "ohne_oeffentlichen_betrieb": src["ohne_oeffentlichen_betrieb"]}

for bid, plaene in src["plaene"].items():
    std = plan_stunden(bid)
    closures = [c for c in src["schliessungen"] if c["bad"] == bid]
    strip = []
    jahre = {}
    d = d0
    while d <= d1:
        tag = TAGE[d.weekday()]
        plan = None
        for p in plaene:
            if d >= iso(p["von"]):
                plan = p
        y = jahre.setdefault(str(d.year), {"plantage": 0, "offen": 0, "geschlossen": {k: 0 for k in PRIO},
                                           "stunden_plan": 0.0, "stunden_verloren": {k: 0.0 for k in PRIO}})
        if plan is None or tag not in plan["tage"]:
            strip.append(CODE["kein_plan"]); d += timedelta(days=1); continue
        y["plantage"] += 1
        h = std[tag]
        y["stunden_plan"] += h
        kats = []
        teil = 0.0
        for c in closures:
            if iso(c["von"]) <= d <= iso(c["bis"]) and d.isoformat() not in c.get("ausser", []) \
                    and (not c.get("tage") or tag in c["tage"]):
                if c.get("teil_stunden"):
                    teil += c["teil_stunden"]
                else:
                    kats.append(c["kat"])
        if d in feiertage and bid not in feiertage[d]:
            kats.append("feiertag")
        if kats:
            k = min(kats, key=PRIO.index)
            y["geschlossen"][k] += 1
            y["stunden_verloren"][k] += h
            strip.append(CODE[k])
        else:
            y["offen"] += 1
            if teil:
                y["stunden_verloren"]["personal"] += min(teil, h)
            strip.append(CODE["offen"])
        d += timedelta(days=1)
    for y in jahre.values():
        y["stunden_plan"] = round(y["stunden_plan"], 1)
        y["stunden_verloren"] = {k: round(v, 1) for k, v in y["stunden_verloren"].items()}
        y["stunden_ist"] = round(y["stunden_plan"] - sum(y["stunden_verloren"].values()), 1)
        y["schliesstage"] = sum(y["geschlossen"].values())
    out["baeder"][bid] = {"name": baeder[bid]["name"], "jahre": jahre, "strip": "".join(strip)}

# Summen je Jahr
for bid, b in out["baeder"].items():
    for j, y in b["jahre"].items():
        s = out["jahre"].setdefault(j, {"plantage": 0, "schliesstage": 0, "stunden_plan": 0.0, "stunden_ist": 0.0,
                                        "geschlossen": {k: 0 for k in PRIO}})
        s["plantage"] += y["plantage"]; s["schliesstage"] += y["schliesstage"]
        s["stunden_plan"] = round(s["stunden_plan"] + y["stunden_plan"], 1)
        s["stunden_ist"] = round(s["stunden_ist"] + y["stunden_ist"], 1)
        for k in PRIO:
            s["geschlossen"][k] += y["geschlossen"][k]

(ROOT / "cache" / "muenster_schliessungen_out.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(f"{'Bad':22s} {'Jahr':5s} {'Plan':>5s} {'zu':>4s} {'%':>4s}  {'Std Plan':>8s} {'Std Ist':>8s}  nach Grund")
for bid, b in out["baeder"].items():
    for j, y in b["jahre"].items():
        if not y["plantage"]:
            continue
        g = ", ".join(f"{k} {v}" for k, v in y["geschlossen"].items() if v)
        print(f"{b['name']:22s} {j:5s} {y['plantage']:5d} {y['schliesstage']:4d} {y['schliesstage'] / y['plantage']:4.0%}  "
              f"{y['stunden_plan']:8.0f} {y['stunden_ist']:8.0f}  {g}")
for j, s in out["jahre"].items():
    print(f"SUMME {j}: {s['schliesstage']} von {s['plantage']} Plantagen geschlossen ({s['schliesstage'] / s['plantage']:.0%}), "
          f"{s['stunden_ist']:.0f} von {s['stunden_plan']:.0f} Plan-Stunden angeboten ({s['stunden_ist'] / s['stunden_plan']:.0%})")
