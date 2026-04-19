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


class Challenge(Base):
    __tablename__ = "challenges"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    creator_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"), nullable=False)
    starting_balance: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    creator: Mapped["User"] = relationship(foreign_keys=[creator_id])
    participants: Mapped[list["ChallengeParticipant"]] = relationship(back_populates="challenge")


class ChallengeParticipant(Base):
    __tablename__ = "challenge_participants"
    __table_args__ = (
        UniqueConstraint("challenge_id", "user_id", name="uq_challenge_participant"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    challenge_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.challenges.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"), nullable=False, index=True)
    balance: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    challenge: Mapped["Challenge"] = relationship(back_populates="participants")
    user: Mapped["User"] = relationship()


class ChallengePortfolio(Base):
    __tablename__ = "challenge_portfolio"
    __table_args__ = (
        UniqueConstraint("challenge_id", "user_id", "ticker_symbol", name="uq_challenge_portfolio"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    challenge_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.challenges.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"), nullable=False, index=True)
    ticker_symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    total_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_buy_price: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)


class ChallengeOrder(Base):
    __tablename__ = "challenge_orders"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    challenge_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.challenges.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id"), nullable=False, index=True)
    ticker_symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    order_side: Mapped[OrderSide] = mapped_column(SAEnum(OrderSide, native_enum=False), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    execution_price: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    realized_pnl: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    status: Mapped[OrderStatus] = mapped_column(
        SAEnum(OrderStatus, native_enum=False), nullable=False, default=OrderStatus.EXECUTED
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )


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
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="orders")
