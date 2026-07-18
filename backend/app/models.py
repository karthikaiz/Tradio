import enum
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Numeric, DateTime, ForeignKey, Enum as SAEnum, UniqueConstraint, Text, Float, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class OrderSide(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderStatus(str, enum.Enum):
    EXECUTED = "EXECUTED"
    FAILED = "FAILED"


class TradeReason(str, enum.Enum):
    MOMENTUM = "MOMENTUM"
    NEWS = "NEWS"
    LONG_TERM = "LONG_TERM"
    FRIEND_TIP = "FRIEND_TIP"
    GUT_FEELING = "GUT_FEELING"
    CHART_PATTERN = "CHART_PATTERN"
    SECTOR_TREND = "SECTOR_TREND"
    CUSTOM = "CUSTOM"


class UserGoal(str, enum.Enum):
    LEARN_BASICS = "LEARN_BASICS"
    PRACTICE_STOCKS = "PRACTICE_STOCKS"
    DEVELOP_STRATEGY = "DEVELOP_STRATEGY"


SCHEMA = "tradio"


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    clerk_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    virtual_balance: Mapped[float] = mapped_column(
        Numeric(15, 2), nullable=False, default=100000.00
    )
    goal: Mapped[UserGoal | None] = mapped_column(
        SAEnum(UserGoal, native_enum=False), nullable=True
    )

    portfolio: Mapped[list["Portfolio"]] = relationship(back_populates="user")
    orders: Mapped[list["Order"]] = relationship(back_populates="user")
    watchlist: Mapped[list["Watchlist"]] = relationship(back_populates="user")


class Portfolio(Base):
    __tablename__ = "portfolio"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"), nullable=False)
    ticker_symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    total_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_buy_price: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)

    user: Mapped["User"] = relationship(back_populates="portfolio")


class Watchlist(Base):
    __tablename__ = "watchlist"
    __table_args__ = (
        UniqueConstraint("user_id", "ticker_symbol", name="uq_watchlist_user_ticker"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"), nullable=False, index=True)
    ticker_symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped["User"] = relationship(back_populates="watchlist")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"), nullable=False)
    ticker_symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    order_side: Mapped[OrderSide] = mapped_column(
        SAEnum(OrderSide, native_enum=False), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    execution_price: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    realized_pnl: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    status: Mapped[OrderStatus] = mapped_column(
        SAEnum(OrderStatus, native_enum=False), nullable=False, default=OrderStatus.EXECUTED
    )
    trade_reason: Mapped[TradeReason | None] = mapped_column(
        SAEnum(TradeReason, native_enum=False), nullable=True
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="orders")


# ── Bot monitoring tables (written by AlgoBot, read by /bot dashboard) ────────

class BotStatus(Base):
    __tablename__ = "bot_status"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="STOPPED")
    climate_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    climate_regime: Mapped[str | None] = mapped_column(String(30), nullable=True)
    circuit_breaker: Mapped[str] = mapped_column(String(10), nullable=False, default="OK")
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    daily_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    open_positions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class BotPosition(Base):
    __tablename__ = "bot_positions"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    current_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_1: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_2: Mapped[float | None] = mapped_column(Float, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    conviction: Mapped[float | None] = mapped_column(Float, nullable=True)
    thesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategy: Mapped[str] = mapped_column(String(20), nullable=False, default="SWING")
    entry_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hold_days_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hold_days_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_open: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class BotScanResult(Base):
    __tablename__ = "bot_scan_results"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    fundamental_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    tier: Mapped[str | None] = mapped_column(String(10), nullable=True)
    climate_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(20), nullable=False)   # BOUGHT | SKIPPED | DISQUALIFIED
    skip_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    conviction: Mapped[float | None] = mapped_column(Float, nullable=True)
    llm_thesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class BotLog(Base):
    __tablename__ = "bot_logs"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True
    )
    level: Mapped[str] = mapped_column(String(10), nullable=False)   # TRADE | INFO | WARNING | ERROR
    message: Mapped[str] = mapped_column(Text, nullable=False)
