"""An asyncio.Lock that rebinds when the running event loop changes.

Module-level singletons (angel_session, the instruments cache, price_stream)
build their Lock at import time — before any event loop exists. An
asyncio.Lock binds to the first loop that awaits it and then raises
"<Lock ...> is bound to a different event loop" for every other one.

In production that never bites: one long-lived loop owns the lock forever.
Under pytest-asyncio each test gets a fresh loop, so the first test to touch
a lock poisons it for every test that follows — which is why the coach tests
passed alone and failed in a full run.

Rebinding is safe, not a workaround: a lock belonging to a dead loop can
never be awaited again, so there is nothing to preserve. Within a single
loop this returns the same Lock every time and behaves exactly like a plain
asyncio.Lock.
"""

import asyncio


class LoopLock:
    def __init__(self) -> None:
        self._lock: asyncio.Lock | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def get(self) -> asyncio.Lock:
        """The Lock for the currently running loop. Use as `async with x.get():`."""
        loop = asyncio.get_running_loop()
        if self._lock is None or self._loop is not loop:
            self._lock = asyncio.Lock()
            self._loop = loop
        return self._lock
