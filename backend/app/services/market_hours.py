from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))

# NSE equity market open/close times (IST)
MARKET_OPEN  = (9, 15)   # 09:15
MARKET_CLOSE = (15, 30)  # 15:30

# Official NSE trading holidays sourced from nseindia.com / calendarlabs.com
# Dates that fall on weekends are listed by NSE but need no special handling
# since weekends are already blocked. They are kept here for completeness.
_NSE_HOLIDAYS: set[date] = {
    # ── 2025 ──────────────────────────────────────────────────────────────────
    date(2025, 1, 26),   # Republic Day (Sunday)
    date(2025, 2, 26),   # Maha Shivaratri
    date(2025, 3, 14),   # Holi
    date(2025, 3, 31),   # Id-ul-Fitr (Ramzan Id)
    date(2025, 4, 6),    # Ram Navami (Sunday)
    date(2025, 4, 10),   # Mahavir Jayanti
    date(2025, 4, 14),   # Dr. Baba Saheb Ambedkar Jayanti
    date(2025, 4, 18),   # Good Friday
    date(2025, 5, 1),    # Maharashtra Day
    date(2025, 6, 7),    # Bakri Id / Eid-ul-Adha (Saturday)
    date(2025, 7, 6),    # Muharram (Sunday)
    date(2025, 8, 15),   # Independence Day
    date(2025, 8, 27),   # Ganesh Chaturthi
    date(2025, 10, 2),   # Mahatma Gandhi Jayanti / Dasara
    date(2025, 10, 21),  # Diwali – Laxmi Puja (Muhurat trading only; regular session closed)
    date(2025, 10, 22),  # Diwali – Balipratipada
    date(2025, 11, 5),   # Guru Nanak Jayanti
    date(2025, 12, 25),  # Christmas

    # ── 2026 ──────────────────────────────────────────────────────────────────
    date(2026, 1, 26),   # Republic Day
    date(2026, 3, 3),    # Holi
    date(2026, 3, 26),   # Ram Navami
    date(2026, 3, 31),   # Mahavir Jayanti
    date(2026, 4, 3),    # Good Friday
    date(2026, 4, 14),   # Dr. Baba Saheb Ambedkar Jayanti
    date(2026, 5, 1),    # Maharashtra Day
    date(2026, 5, 28),   # Bakri Id / Eid-ul-Adha
    date(2026, 6, 26),   # Muharram
    date(2026, 9, 14),   # Ganesh Chaturthi
    date(2026, 10, 2),   # Mahatma Gandhi Jayanti
    date(2026, 10, 20),  # Dasara
    date(2026, 11, 8),   # Diwali – Laxmi Puja (Sunday; Muhurat trading only)
    date(2026, 11, 10),  # Diwali – Balipratipada
    date(2026, 11, 24),  # Guru Nanak Jayanti
    date(2026, 12, 25),  # Christmas
}


def _now_ist() -> datetime:
    return datetime.now(IST)


def get_market_status(now: datetime | None = None) -> dict:
    """
    Returns a dict:
      {
        "open": bool,
        "reason": str,          # human-readable explanation when closed
        "next_open": str | None # ISO8601 IST datetime of next market open (approx)
      }
    """
    if now is None:
        now = _now_ist()
    else:
        now = now.astimezone(IST)

    today = now.date()
    weekday = now.weekday()  # 0=Mon … 6=Sun
    hour, minute = now.hour, now.minute
    current_minutes = hour * 60 + minute
    open_minutes  = MARKET_OPEN[0]  * 60 + MARKET_OPEN[1]
    close_minutes = MARKET_CLOSE[0] * 60 + MARKET_CLOSE[1]

    def _next_open_from(d: date) -> str:
        """Return ISO string for 09:15 IST on the next valid trading day from d."""
        candidate = d
        for _ in range(14):  # scan at most 2 weeks
            candidate += timedelta(days=1)
            if candidate.weekday() < 5 and candidate not in _NSE_HOLIDAYS:
                dt = datetime(
                    candidate.year, candidate.month, candidate.day,
                    MARKET_OPEN[0], MARKET_OPEN[1], tzinfo=IST,
                )
                return dt.isoformat()
        return ""

    # Weekend
    if weekday >= 5:
        day_name = "Saturday" if weekday == 5 else "Sunday"
        return {
            "open": False,
            "reason": f"Market closed — {day_name}",
            "next_open": _next_open_from(today),
        }

    # Public holiday
    if today in _NSE_HOLIDAYS:
        return {
            "open": False,
            "reason": "Market closed — public holiday",
            "next_open": _next_open_from(today),
        }

    # Before market open
    if current_minutes < open_minutes:
        open_dt = datetime(today.year, today.month, today.day, MARKET_OPEN[0], MARKET_OPEN[1], tzinfo=IST)
        return {
            "open": False,
            "reason": "Market not yet open — trading starts at 9:15 AM IST",
            "next_open": open_dt.isoformat(),
        }

    # After market close
    if current_minutes >= close_minutes:
        return {
            "open": False,
            "reason": "Market closed — trading ended at 3:30 PM IST",
            "next_open": _next_open_from(today),
        }

    # All checks passed
    return {"open": True, "reason": "", "next_open": None}


def is_market_open(now: datetime | None = None) -> bool:
    return get_market_status(now)["open"]
