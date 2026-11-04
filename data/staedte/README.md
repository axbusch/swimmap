# Vergleichsstädte

Eine Datei je Stadt: `<AGS>_<name>.json` mit `ags`, `stadt`, `status` (erfasst | teilweise), `stand`,
`hinweis` und `baeder`. Slots dürfen in Kurzform angegeben werden (siehe `scripts/metrics.py`, `parse_slot`):

    "Mo 06:30-22:00"                  öffentlich
    "Mo-Fr 06:30-08:00"               mehrere Tage
    "Mi 08:00-13:00 teil 0.3"         Teilfläche (Flächenanteil)
    "Sa 10:00-12:00 ziel Frauen"      Zielgruppe (nicht in Kernkennzahl)
    "Sa 10:00-16:00 x0.5"             nur jede zweite Woche

Bad-Felder: `name`, `typ` (hallenbad | freibad), `kategorie` (staedtisch | andere), optional `freizeitbad: true`,
`traeger`, `wasserflaeche_m2` (null wenn unbekannt), `slots`, `quelle: {url, abgerufen}`, `hinweis`.
