"""Liest Öffnungszeiten aus eaero-Widgets (app.eaero.de, verbreitet bei kommunalen Bädern).

  python scripts/tools/eaero.py <seiten-url> [<seiten-url> ...]

Sucht auf der Seite nach 'api/tableOfHours/...'-Skripten, lädt sie und gibt
je Tabelle (Bereich, z. B. 'Hallenbad', 'Sauna') die Wochenzeiten aus.
"""
import html
import re
import sys

import requests

UA = {"User-Agent": "Mozilla/5.0 (swimmap research)"}
TAGE = {"Montag": "Mo", "Dienstag": "Di", "Mittwoch": "Mi", "Donnerstag": "Do",
        "Freitag": "Fr", "Samstag": "Sa", "Sonntag": "So"}


def decode(js: str) -> str:
    js = js.replace("\\'", "'").replace("\\/", "/").replace("\\n", "\n")
    i = js.find("<table")
    s = js[i:] if i >= 0 else js
    s = re.sub(r"<style.*?</style>", "", s, flags=re.S)
    s = re.sub(r"<br\s*/?>|</tr>|</h\d>|</div>|</p>", "\n", s)
    s = re.sub(r"</td>|</th>", " | ", s)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s)


def wochenplan(text: str):
    """Gibt (titel, {Tag: [zeitangaben...]}, legende) zurück."""
    titel = text.strip().splitlines()[0].strip() if text.strip() else ""
    plan, cur = {}, None
    end = text.find("= geöffnet")
    body = text[:end] if end > 0 else text
    leg_i = body.rfind("|")
    for line in body.splitlines():
        line = line.strip()
        if re.match(r"^[A-Z0-9-]{1,5}\.? = ", line):  # Legende beginnt
            break
        if line in TAGE:
            cur = TAGE[line]; plan[cur] = []
            continue
        if cur and line and line not in TAGE.values() and not re.match(r"^\d\d \. \d\d \. \d{4}$", line) and line != "|":
            if re.search(r"\d\d:\d\d|geschlossen|Ruhetag", line) and line not in plan[cur]:
                plan[cur].append(line)
            elif len(line) < 40 and line not in plan[cur] and not line.startswith("HS ="):
                plan[cur].append(line)
    legende = ""
    m = re.search(r"(HS = .*?)(?:= geöffnet|$)", text, re.S)
    if m:
        legende = m.group(1).strip()[:200]
    return titel, plan, legende


def main():
    for url in sys.argv[1:]:
        page = requests.get(url, headers=UA, timeout=30).text
        srcs = sorted(set(re.findall(r"(?:https?:)?//app\.eaero\.de/api/tableOfHours/[^\"'\s]+", page)))
        print(f"### {url}  ({len(srcs)} Tabellen)")
        for src in srcs:
            u = "https:" + src if src.startswith("//") else src
            t = decode(requests.get(u, headers=UA, timeout=30).text)
            titel, plan, _ = wochenplan(t)
            kw = re.search(r"KW: (\d+)\s+([\d .]+-[\d .]+)", t)
            print(f"  [{titel}]  {('KW ' + kw.group(1) + ' ' + re.sub(' ', '', kw.group(2))) if kw else ''}")
            for tag, zs in plan.items():
                # Dubletten (Langform/Kurzform) entfernen
                seen = []
                for z in zs:
                    if z not in seen:
                        seen.append(z)
                print(f"    {tag}: {' ; '.join(seen)}")
        print()


if __name__ == "__main__":
    main()
