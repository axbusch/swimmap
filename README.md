# Schwimmzeiten in Münster

Interaktive Karte der öffentlichen Schwimmbäder in Münster (Westfalen) mit

- **öffentlichen Schwimmzeiten** je Bad (Stunden pro Woche, Wochenplan),
- **Einzugsbereichen** zu Fuß, mit dem Rad und mit dem ÖPNV (Reisezeit auf 100-m-Raster),
- **Kennzahlen** zum Vergleich mit den übrigen NRW-Großstädten (Stunden je 10.000 Einwohner u. a.).

Die Webseite liegt in [`docs/`](docs/) und ist eine statische Seite (Leaflet, keine API-Schlüssel). Zum
Anschauen genügt ein Doppelklick auf `docs/index.html`, weil die Daten als `docs/data/bundle.js` eingebettet sind.
Veröffentlichen lässt sie sich z. B. über GitHub Pages (Quelle: Branch `master`, Ordner `/docs`). Alternativ
lokal mit einem Webserver:

```sh
cd docs
python -m http.server 8000
# http://localhost:8000
```

Für Karte und Hintergrundkacheln ist eine Internetverbindung nötig.

## Methodik in Kürze

| Begriff | Definition |
|---|---|
| Öffentliche Schwimmzeit | Zeit für allgemeines öffentliches Schwimmen laut Betreiber, regulärer Winter-Wochenplan. Ohne Schul-, Vereins-, Kurszeiten. |
| Teilöffentlich | Öffentliches Schwimmen auf Teilfläche (z. B. 2 Bahnen). Zählt als Stunde, Wasserfläche anteilig. |
| Zielgruppenzeit | z. B. Frauen-/TIN*-Schwimmen. Ausgewiesen, aber nicht Teil der Kernkennzahl. |
| Stunden je 10.000 EW | Σ öffentliche Stunden/Woche aller kommunalen Hallenbäder ÷ Einwohner × 10.000 |
| Wasserflächen-Stunden je 1.000 EW | Σ (Stunden × Wasserfläche) ÷ Einwohner × 1.000 |
| Wasserfläche je 1.000 EW | Σ Wasserfläche der Hallenbäder mit öffentlichen Zeiten ÷ Einwohner × 1.000 |

**Einzugsbereich:** Reisezeit von jeder 100-m-Zelle (Zensus 2022) zum Bad. Fuß 4,5 km/h und Rad 15 km/h auf
OSM-Wegenetzen. ÖPNV Tür-zu-Tür mit dem GTFS-Fahrplan (Dienstag, Ankunft 17–19 Uhr, Median) und einem
eigenen Connection-Scan-Algorithmus. Schwellen 10/15/20/30 min. Laut Erfahrungswerten der DGfdB nehmen Badegäste in
der Stadt für ein Sporthallenbad etwa 10–15 min Anfahrt in Kauf (zitiert in Drucksache 2152/2013, Stadt Hannover).

Die ausführliche Methodik und die Grenzen der Auswertung stehen auf der Webseite im Reiter **Methodik**.

## Daten

| Datei | Inhalt | Quelle |
|---|---|---|
| `data/muenster_baeder.json` | Bäder, Zeitslots, Wasserflächen, Einschränkungen | stadt-muenster.de/sportamt/baeder (Abruf 04.11.2026) u. a., je Bad verlinkt |
| `data/nrw_population.csv` | Einwohner der 29 NRW-Großstädte | IT.NRW, Tabelle 12411-02i, 31.12.2025, Basis Zensus 2022 (dl-de/by-2-0) |
| `data/staedte/*.json` | Bäder und Zeiten der Vergleichsstädte (eine Datei je Stadt, Format in `data/staedte/README.md`) | je Bad verlinkt, Abruf 04.11.2026 |

Abgeleitete bzw. große Rohdaten (nicht im Repository, werden von den Skripten geladen):

- Zensus 2022, Bevölkerung im 100-m-Gitter: <https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Bevoelkerungszahl.zip>
- GTFS Nahverkehr Deutschland (gtfs.de / DELFI e.V., CC BY 4.0): <https://download.gtfs.de/germany/nv_free/latest.zip>
- OpenStreetMap-Wegenetz und Stadtgrenze über OSMnx (© OpenStreetMap-Mitwirkende, ODbL)

## Nachrechnen

```sh
python -m venv .venv
.venv/Scripts/pip install osmnx geopandas shapely pandas numpy scipy pyproj requests   # Windows
mkdir -p cache/zensus cache/gtfs
curl -L -o cache/zensus/z22_pop.zip https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Bevoelkerungszahl.zip
curl -L -o cache/gtfs/de_nv.zip https://download.gtfs.de/germany/nv_free/latest.zip

cd scripts
python 01_grundlagen.py          # Stadtgrenze, Raster, Wegenetze
python 02_gtfs_filter.py 2026-11-10   # Fahrplan Raum Münster, Stichtag (Dienstag)
python 03_erreichbarkeit.py      # Reisezeiten Fuß/Rad/ÖPNV (einige Minuten)
python 04_build_web.py           # docs/data/*.json
python metrics.py                # Kennzahlen Münster auf der Konsole
```

Hinweis: Der GTFS-Feed gilt jeweils nur einige Wochen. Der Stichtag muss im Gültigkeitszeitraum liegen.

## Daten aktualisieren

Öffnungszeiten ändern sich häufig (Ferien, Revisionen, Personalmangel). Zum Aktualisieren die Slots in
`data/muenster_baeder.json` bzw. `data/staedte/<AGS>_<stadt>.json` anpassen, `stand` und `quelle.abgerufen` setzen und
`scripts/04_build_web.py` ausführen. Die Reisezeiten müssen nur neu berechnet werden, wenn Bäder hinzukommen oder
wegfallen.

## Stand NRW-Vergleich

26 von 29 Großstädten sind erfasst. Offen sind Wuppertal (Bot-Schutz der Stadtseite), Mülheim an der Ruhr
(Badinfos dynamisch nachgeladen) und Solingen (Betreiberseite nicht erreichbar). Für diese Städte genügt es, die
Zeiten im Browser abzulesen und eine Datei nach dem Muster in `data/staedte/` anzulegen.

Recherche-Hilfen in `scripts/tools/`: `fetch_text.py` (Seite → Text), `eaero.py` (eaero-Öffnungszeiten-Widgets),
`render_text.py` (JavaScript-Seiten über Edge/Playwright; `pip install playwright`).
