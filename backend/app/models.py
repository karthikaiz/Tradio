import enum
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Numeric, DateTime, ForeignKey, Enum as SAEnum, UniqueConstraint
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
