"""Recherche-Hilfe: lädt Webseiten und speichert sie als Rohtext (raw/<stadt>/).

  python scripts/tools/fetch_text.py <stadt> <url> [<url> ...] [--grep muster]

Gibt den Text auf der Konsole aus (gekürzt). Die Dateien landen in raw/ und
sind nicht Teil des Repositorys (nur zur Nachvollziehbarkeit lokal).
"""
import html
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parents[2]
UA = {"User-Agent": "Mozilla/5.0 (swimmap research)"}


def to_text(raw: str) -> str:
    m = re.search(r"<main.*?</main>", raw, re.S | re.I)
    s = m.group(0) if m else raw
    s = re.sub(r"<(script|style|nav|footer|header|noscript)\b.*?</\1>", "", s, flags=re.S | re.I)
    s = re.sub(r"<br\s*/?>|</p>|</li>|</h\d>|</tr>|</div>|</dt>|</dd>", "\n", s, flags=re.I)
    s = re.sub(r"</td>|</th>", " | ", s, flags=re.I)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    s = re.sub(r"[ \t\xa0]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s)
    return s.strip()


def main():
    args = sys.argv[1:]
    pat = None
    if "--grep" in args:
        i = args.index("--grep"); pat = args[i + 1]; args = args[:i] + args[i + 2:]
    limit = 6000
    if "--max" in args:
        i = args.index("--max"); limit = int(args[i + 1]); args = args[:i] + args[i + 2:]
    stadt, urls = args[0], args[1:]
    out = ROOT / "raw" / stadt
    out.mkdir(parents=True, exist_ok=True)
    for url in urls:
        try:
            r = requests.get(url, headers=UA, timeout=30)
            r.encoding = r.apparent_encoding if r.encoding in (None, "ISO-8859-1") else r.encoding
            t = to_text(r.text)
        except Exception as e:  # noqa: BLE001
            print(f"### {url}\nFEHLER: {e}\n")
            continue
        name = re.sub(r"[^a-z0-9]+", "_", urlparse(url).path.lower()).strip("_") or "index"
        (out / f"{name}.txt").write_text(f"{url}\n{r.status_code}\n\n{t}", encoding="utf-8")
        print(f"### {url} [{r.status_code}]")
        if pat:
            lines = t.splitlines()
            hits = [i for i, l in enumerate(lines) if re.search(pat, l, re.I)]
            keep = sorted({j for i in hits for j in range(max(0, i - 2), min(len(lines), i + 12))})
            print("\n".join(lines[j] for j in keep)[:limit])
        else:
            print(t[:limit])
        print()


if __name__ == "__main__":
    main()
