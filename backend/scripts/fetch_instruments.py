"""Bake the NSE-equity slice of Angel's scrip master into the image.

Run at Docker build time. The build machine has real memory and a real
network; the 256MB production machine has neither to spare.

    wire size                  25.6 MB
    RSS if parsed in bulk      98.5 MB   (on a 256MB box: swap, then nothing)
    what is actually needed    41 KB

Downloading and parsing that on the production machine is what produced the
recurring "Instruments master still loading" outage. Baking it here means a
price request resolves symbols from a 41KB file with no network involved.

Failure is deliberately non-fatal: the app falls back to its runtime
download, which is now streamed and cheap. A transient blip on the build
host must not block a deploy.
"""
import json
import sys
import time
from pathlib import Path

import httpx
import ijson

URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "instruments.json"


def main() -> int:
    tokens: dict[str, str] = {}
    names: dict[str, str] = {}
    started = time.monotonic()
    try:
        with httpx.Client(timeout=180) as client:
            with client.stream("GET", URL) as resp:
                resp.raise_for_status()
                for item in ijson.items(resp.iter_bytes(), "item"):
                    if item.get("exch_seg") != "NSE":
                        continue
                    if item.get("instrumenttype") != "":
                        continue
                    sym_raw = item.get("symbol", "")
                    if not sym_raw.endswith("-EQ"):
                        continue
                    sym = sym_raw[:-3].upper()
                    token = item.get("token", "")
                    raw_name = item.get("name", sym)
                    if sym and token:
                        tokens[sym] = token
                        names[sym] = raw_name.title() if raw_name else sym
    except Exception as e:
        print(f"[instruments] download failed ({type(e).__name__}: {e}) — "
              f"image will fall back to the runtime load", file=sys.stderr)
        return 0

    if not tokens:
        print("[instruments] master contained no NSE equities — not writing",
              file=sys.stderr)
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"fetched_at": time.time(), "tokens": tokens, "names": names}
    ))
    print(f"[instruments] baked {len(tokens)} NSE equities into {OUT.name} "
          f"({OUT.stat().st_size / 1024:.0f}KB) in {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
