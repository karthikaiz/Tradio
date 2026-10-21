"""Bake the NSE-equity slice of Angel's scrip master into the image.

Run on the deploy runner before `flyctl deploy` (and as a fallback in the
Docker build). Those machines have real memory and a real network; the 256MB
production machine has neither to spare.

    wire size                  25.6 MB
    RSS if parsed in bulk      98.5 MB   (on a 256MB box: swap, then nothing)
    what is actually needed    41 KB

This shares app.services.instruments._stream_instruments with the running
app, deliberately. The first version had its own copy of the parsing, and it
was wrong: it handed ijson a byte generator where a file-like object is
required, so it crashed on every run — and because failure here is non-fatal
it would have crashed silently on every deploy. One implementation means one
thing to test.

Failure is non-fatal: the app falls back to its streamed runtime download,
and a blip on the build host must not block a deploy.
"""
import asyncio
import json
import sys
import time
from pathlib import Path

# Run as a script from anywhere: make `app` importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.instruments import _stream_instruments  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "instruments.json"


async def bake(out: Path = OUT) -> int:
    """Returns the number of equities written; 0 means nothing was written."""
    started = time.monotonic()
    try:
        tokens, names = await _stream_instruments()
    except Exception as e:
        print(f"[instruments] download failed ({type(e).__name__}: {e}) — "
              f"image will fall back to the runtime load", file=sys.stderr)
        return 0

    if not tokens:
        print("[instruments] master contained no NSE equities — not writing",
              file=sys.stderr)
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(
        {"fetched_at": time.time(), "tokens": tokens, "names": names}
    ))
    tmp.replace(out)   # atomic — never leaves a half-written snapshot
    print(f"[instruments] baked {len(tokens)} NSE equities into {out.name} "
          f"({out.stat().st_size / 1024:.0f}KB) in {time.monotonic() - started:.1f}s")
    return len(tokens)


def main() -> int:
    asyncio.run(bake())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
