import logging
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, JSON, String, func
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class SavedComparison(Base):
    __tablename__ = "saved_comparisons"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


engine: AsyncEngine | None = None
SessionLocal: async_sessionmaker | None = None


async def init_db() -> None:
    global engine, SessionLocal

    if not settings.DATABASE_URL:
        logger.info("DATABASE_URL not set; skipping database initialization.")
        return

    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database connection ready.")
    except Exception as exc:
        if settings.REQUIRE_DATABASE:
            raise
        logger.warning("Database unavailable; continuing without persistence: %s", exc)


async def close_db() -> None:
    if engine is not None:
        await engine.dispose()
