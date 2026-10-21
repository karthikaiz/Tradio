"""Bake the NSE-equity slice of Angel's scrip master into the image.

    python scripts/fetch_instruments.py <downloaded OpenAPIScripMaster.json> [out]

This only PARSES. The download is done by the deploy workflow with curl,
because the download is the hard part: the file is 36MB, Angel's host serves
it at roughly 60KB/s and drops the connection part-way (observed:
5,094,045 of 36,292,596 bytes, then the peer closed). curl can retry and
resume; a deploy runner can afford to wait. The 256MB production machine can
do neither, which is why it no longer downloads this at all.

The output is ~100KB of {symbol: token}, which the app loads from disk and
backs with a live searchScrip lookup for anything newer.

Exit status is honest: non-zero on any failure, and nothing is written. The
workflow decides to tolerate that (a deploy must not be blocked by Angel's
file server) and raises a warning. An earlier version returned 0 on failure so
that it would not block a deploy — which also meant its own bug, a crash on
every run, was invisible until it was run in CI.
"""
import json
import sys
import time
from pathlib import Path

import ijson

OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "instruments.json"


def keep(item: dict) -> tuple[str, str, str] | None:
    """(symbol, token, name) for an NSE cash equity; None for everything else.

    The master is ~120,000 rows, overwhelmingly NFO option contracts.
    """
    if item.get("exch_seg") != "NSE":
        return None
    # NSE equities have an empty instrumenttype; AMXIDX are indices
    if item.get("instrumenttype") != "":
        return None
    sym_raw = item.get("symbol", "")
    if not sym_raw.endswith("-EQ"):
        return None
    sym = sym_raw[:-3].upper()
    token = item.get("token", "")
    if not sym or not token:
        return None
    raw_name = item.get("name", sym)
    return sym, str(token), raw_name.title() if raw_name else sym


def parse(source: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Stream the file from disk. Raises on a truncated or malformed document,
    so a half-downloaded master can never become a partial snapshot."""
    tokens: dict[str, str] = {}
    names: dict[str, str] = {}
    with open(source, "rb") as f:
        for item in ijson.items(f, "item"):
            row = keep(item)
            if row:
                sym, token, name = row
                tokens[sym] = token
                names[sym] = name
    return tokens, names


def bake(source: Path, out: Path = OUT) -> int:
    """Returns the number of equities written. Raises on failure."""
    started = time.monotonic()
    tokens, names = parse(source)
    if not tokens:
        raise ValueError("master contained no NSE equities")

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    # No timestamp, and sorted: an unchanged master must produce a byte-identical
    # file, or the weekly refresh would commit noise every time.
    tmp.write_text(json.dumps(
        {"tokens": tokens, "names": names}, sort_keys=True, separators=(",", ":")
    ))
    tmp.replace(out)   # atomic — never leaves a half-written snapshot
    print(f"[instruments] baked {len(tokens)} NSE equities into {out.name} "
          f"({out.stat().st_size / 1024:.0f}KB) in {time.monotonic() - started:.1f}s")
    return len(tokens)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out = Path(argv[2]) if len(argv) > 2 else OUT
    try:
        bake(Path(argv[1]), out)
    except Exception as e:
        print(f"[instruments] could not bake a snapshot ({type(e).__name__}: {e})",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
