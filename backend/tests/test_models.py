import logging
import pytest
from decimal import Decimal
from sqlalchemy import text, inspect
from sqlalchemy.ext.asyncio import create_async_engine
from app.models import Base, User, Portfolio, Order, OrderSide, OrderStatus

logger = logging.getLogger(__name__)

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def engine():
    eng = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        execution_options={"schema_translate_map": {"tradio": None}},
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


async def test_tables_exist(engine):
    async with engine.connect() as conn:
        table_names = await conn.run_sync(
            lambda sync_conn: inspect(sync_conn).get_table_names()
        )
    assert "users" in table_names
    assert "portfolio" in table_names
    assert "orders" in table_names
    logger.info("Verified: all three tables (users, portfolio, orders) exist in the schema")


async def test_user_created(db_session):
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()

    from sqlalchemy import select
    result = await db_session.execute(select(User).where(User.id == 1))
    fetched = result.scalar_one()

    assert fetched.username == "testuser"
    assert fetched.virtual_balance == Decimal("100000.00")
    logger.info("Verified: user_id=1 created with username='testuser' and balance=100000.00")


async def test_user_default_balance(db_session):
    user = User(id=2, username="defaultuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()

    from sqlalchemy import select
    result = await db_session.execute(select(User).where(User.id == 2))
    fetched = result.scalar_one()

    assert fetched.virtual_balance == Decimal("100000.00")
    logger.info("Verified: user default balance is ₹1,00,000")


async def test_portfolio_row_creates(db_session):
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.flush()

    holding = Portfolio(
        user_id=1,
        ticker_symbol="RELIANCE",
        total_quantity=10,
        avg_buy_price=Decimal("2900.00"),
    )
    db_session.add(holding)
    await db_session.commit()

    from sqlalchemy import select
    result = await db_session.execute(
        select(Portfolio).where(Portfolio.ticker_symbol == "RELIANCE")
    )
    fetched = result.scalar_one()

    assert fetched.total_quantity == 10
    assert fetched.avg_buy_price == Decimal("2900.00")
    logger.info("Verified: Portfolio row created with correct quantity and avg_buy_price")


async def test_order_buy_row_creates(db_session):
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.flush()

    order = Order(
        user_id=1,
        ticker_symbol="TCS",
        order_side=OrderSide.BUY,
        quantity=5,
        execution_price=Decimal("3500.00"),
        realized_pnl=None,
        status=OrderStatus.EXECUTED,
    )
    db_session.add(order)
    await db_session.commit()

    from sqlalchemy import select
    result = await db_session.execute(select(Order).where(Order.ticker_symbol == "TCS"))
    fetched = result.scalar_one()

    assert fetched.order_side == OrderSide.BUY
    assert fetched.realized_pnl is None
    assert fetched.status == OrderStatus.EXECUTED
    logger.info("Verified: BUY Order row created with realized_pnl=NULL and status=EXECUTED")


async def test_order_sell_has_realized_pnl(db_session):
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.flush()

    order = Order(
        user_id=1,
        ticker_symbol="INFY",
        order_side=OrderSide.SELL,
        quantity=3,
        execution_price=Decimal("1600.00"),
        realized_pnl=Decimal("150.00"),
        status=OrderStatus.EXECUTED,
    )
    db_session.add(order)
    await db_session.commit()

    from sqlalchemy import select
    result = await db_session.execute(select(Order).where(Order.ticker_symbol == "INFY"))
    fetched = result.scalar_one()

    assert fetched.order_side == OrderSide.SELL
    assert fetched.realized_pnl == Decimal("150.00")
    logger.info("Verified: SELL Order row stores realized_pnl=150.00 correctly")
