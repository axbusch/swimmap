"""Recherche-Hilfe für JavaScript-lastige Seiten: rendert mit dem installierten
Edge (Playwright, channel 'msedge') und gibt Text + Links aus.

  python scripts/tools/render_text.py <stadt> <url> [<url> ...] [--grep muster] [--links muster]

Bot-Schutz (z. B. Cloudflare-Challenges) wird bewusst NICHT umgangen.
"""
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main():
    args = sys.argv[1:]
    opts = {}
    for k in ("--grep", "--links", "--max"):
        if k in args:
            i = args.index(k); opts[k] = args[i + 1]; args = args[:i] + args[i + 2:]
    stadt, urls = args[0], args[1:]
    out = ROOT / "raw" / stadt
    out.mkdir(parents=True, exist_ok=True)
    limit = int(opts.get("--max", 5000))
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True)
        pg = b.new_page()
        for url in urls:
            try:
                pg.goto(url, wait_until="networkidle", timeout=45000)
                pg.wait_for_timeout(1500)
                t = pg.inner_text("body")
                links = pg.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
            except Exception as e:  # noqa: BLE001
                print(f"### {url}\nFEHLER: {e}\n"); continue
            t = re.sub(r"\n\s*\n+", "\n", t)
            name = re.sub(r"[^a-z0-9]+", "_", urlparse(url).path.lower()).strip("_") or "index"
            (out / f"r_{name}.txt").write_text(f"{url}\n\n{t}", encoding="utf-8")
            print(f"### {url}")
            if "--grep" in opts:
                L = t.splitlines()
                hits = [i for i, l in enumerate(L) if re.search(opts["--grep"], l, re.I)]
                keep = sorted({j for i in hits for j in range(max(0, i - 1), min(len(L), i + 10))})
                print("\n".join(L[j] for j in keep)[:limit])
            else:
                print(t[:limit])
            if "--links" in opts:
                print("LINKS:", sorted({l for l in links if re.search(opts["--links"], l, re.I)})[:40])
            print()
        b.close()


if __name__ == "__main__":
    main()
