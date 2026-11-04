"""Schließtage und tatsächlich angebotene Jahresstunden der kommunalen Hallenbäder.

  python 06_schliesstage.py

Eingabe:  data/muenster_schliessungen.json      (Chronik Münster aus Pressemitteilungen)
          data/schliessungen/<AGS>_<slug>.json  (Chroniken der Vergleichsstädte)
          Bäderdaten über staedte.lade_stadt()  (Regelplan = Stunden je Wochentag)
Ausgabe:  cache/schliessungen/<slug>.json       (wird von 04_build_web.py eingebunden)

Definition: Ein Schließtag ist ein Tag, an dem das Bad laut damals gültigem
Regelplan öffentliches Schwimmen hätte, aber für die Öffentlichkeit ganz
geschlossen war. Bei Überschneidungen gilt die Priorität
defekt > revision > ferien > sommer > feiertag > personal.
"""
from datetime import date, timedelta
from pathlib import Path
import json

from metrics import TAGE, slots_of, slot_dauer
from staedte import lade_stadt

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "cache" / "schliessungen"
OUT.mkdir(parents=True, exist_ok=True)
PRIO = ["defekt", "revision", "ferien", "sommer", "feiertag", "personal"]
CODE = {"offen": "o", "kein_plan": ".", **{k: str(i + 1) for i, k in enumerate(PRIO)}}
iso = date.fromisoformat

MS = json.loads((DATA / "muenster_schliessungen.json").read_text(encoding="utf-8"))
STANDARD = {"kategorien": MS["kategorien"], "methodik": MS["methodik"]}


def plan_stunden(bad):
    """Öffentliche Stunden je Wochentag; bad = Bad-Dict oder Plan-Periode mit eigenen 'slots'."""
    h = {t: 0.0 for t in TAGE}
    for s in slots_of(bad):
        if s["art"] in ("oeffentlich", "teiloeffentlich"):
            h[s["tag"]] += slot_dauer(s) * s.get("haeufigkeit", 1.0)
    return h


def berechne(src, baeder):
    d0, d1 = iso(src["zeitraum"]["von"]), iso(src["zeitraum"]["bis"])
    feiertage = {iso(k): v for jahr in src.get("feiertage", {}).values() for k, v in jahr.items()}
    out = {"stadt": src.get("stadt"), "zeitraum": src["zeitraum"],
           "kategorien": src.get("kategorien", STANDARD["kategorien"]),
           "methodik": src.get("methodik", STANDARD["methodik"]),
           "feiertage_hinweis": src.get("feiertage_hinweis", ""), "codes": CODE, "baeder": {}, "jahre": {},
           "ereignisse": src["schliessungen"], "ohne_oeffentlichen_betrieb": src.get("ohne_oeffentlichen_betrieb", []),
           "qualitaet": src.get("qualitaet"), "offene_punkte": src.get("offene_punkte", [])}
    for bid, plaene in src["plaene"].items():
        if bid not in baeder:
            raise SystemExit(f"{src.get('stadt')}: unbekannte Bad-ID {bid}")
        std0 = plan_stunden(baeder[bid])
        std_p = {id(p): plan_stunden(p) for p in plaene if p.get("slots")}
        closures = [c for c in src["schliessungen"] if c["bad"] == bid]
        strip, jahre = [], {}
        d = d0
        while d <= d1:
            tag = TAGE[d.weekday()]
            plan = None
            for p in plaene:
                if d >= iso(p["von"]) and (not p.get("bis") or d <= iso(p["bis"])):
                    plan = p
            y = jahre.setdefault(str(d.year), {"plantage": 0, "offen": 0, "geschlossen": {k: 0 for k in PRIO},
                                               "stunden_plan": 0.0, "stunden_verloren": {k: 0.0 for k in PRIO}})
            std = std_p.get(id(plan), std0)
            if plan is None or tag not in plan["tage"] or std[tag] == 0:
                strip.append(CODE["kein_plan"]); d += timedelta(days=1); continue
            y["plantage"] += 1
            h = std[tag]
            y["stunden_plan"] += h
            kats, teil = [], {}
            for c in closures:
                if iso(c["von"]) <= d <= iso(c["bis"]) and d.isoformat() not in c.get("ausser", []) \
                        and (not c.get("tage") or tag in c["tage"]):
                    if c.get("teil_stunden"):
                        teil[c["kat"]] = teil.get(c["kat"], 0.0) + c["teil_stunden"]
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
                rest = h
                for k in sorted(teil, key=PRIO.index):
                    v = min(teil[k], rest)
                    y["stunden_verloren"][k] += v
                    rest -= v
                strip.append(CODE["offen"])
            d += timedelta(days=1)
        for y in jahre.values():
            y["stunden_plan"] = round(y["stunden_plan"], 1)
            y["stunden_verloren"] = {k: round(v, 1) for k, v in y["stunden_verloren"].items()}
            y["stunden_ist"] = round(y["stunden_plan"] - sum(y["stunden_verloren"].values()), 1)
            y["schliesstage"] = sum(y["geschlossen"].values())
        out["baeder"][bid] = {"name": baeder[bid]["name"], "jahre": jahre, "strip": "".join(strip)}
    for b in out["baeder"].values():
        for j, y in b["jahre"].items():
            s = out["jahre"].setdefault(j, {"plantage": 0, "schliesstage": 0, "stunden_plan": 0.0, "stunden_ist": 0.0,
                                            "geschlossen": {k: 0 for k in PRIO},
                                            "stunden_verloren": {k: 0.0 for k in PRIO}})
            s["plantage"] += y["plantage"]; s["schliesstage"] += y["schliesstage"]
            s["stunden_plan"] = round(s["stunden_plan"] + y["stunden_plan"], 1)
            s["stunden_ist"] = round(s["stunden_ist"] + y["stunden_ist"], 1)
            for k in PRIO:
                s["geschlossen"][k] += y["geschlossen"][k]
                s["stunden_verloren"][k] = round(s["stunden_verloren"][k] + y["stunden_verloren"][k], 1)
    return out


def bericht(out):
    print(f"\n== {out['stadt']} ==")
    print(f"{'Bad':28s} {'Jahr':5s} {'Plan':>5s} {'zu':>4s} {'%':>4s}  {'Std Plan':>8s} {'Std Ist':>8s}  nach Grund")
    for b in out["baeder"].values():
        for j, y in b["jahre"].items():
            if not y["plantage"]:
                continue
            g = ", ".join(f"{k} {v}" for k, v in y["geschlossen"].items() if v)
            print(f"{b['name'][:28]:28s} {j:5s} {y['plantage']:5d} {y['schliesstage']:4d} "
                  f"{y['schliesstage'] / y['plantage']:4.0%}  {y['stunden_plan']:8.0f} {y['stunden_ist']:8.0f}  {g}")
    for j, s in out["jahre"].items():
        if s["stunden_plan"]:
            print(f"SUMME {j}: {s['schliesstage']} von {s['plantage']} Plantagen geschlossen "
                  f"({s['schliesstage'] / s['plantage']:.0%}), {s['stunden_ist']:.0f} von {s['stunden_plan']:.0f} "
                  f"Plan-Stunden angeboten ({s['stunden_ist'] / s['stunden_plan']:.0%})")


quellen = [("05515", MS)] + [(f.name.split("_")[0], json.loads(f.read_text(encoding="utf-8")))
                             for f in sorted((DATA / "schliessungen").glob("*.json"))]
for ags, src in quellen:
    st = lade_stadt(ags)
    src.setdefault("stadt", st["stadt"])
    res = berechne(src, {b["id"]: b for b in st["baeder"]})
    res["slug"], res["ags"] = st["slug"], ags
    (OUT / f"{st['slug']}.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    bericht(res)
(ROOT / "cache" / "muenster_schliessungen_out.json").unlink(missing_ok=True)
