"""
Async database engine and session factory.
All services import from here for consistent connection management.
"""
import os
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "FATAL: DATABASE_URL environment variable is not set. "
        "Example: DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname"
    )

ASYNC_DB_POOL_SIZE = int(os.getenv("ASYNC_DB_POOL_SIZE", os.getenv("DB_POOL_SIZE", "20")))
ASYNC_DB_MAX_OVERFLOW = int(os.getenv("ASYNC_DB_MAX_OVERFLOW", os.getenv("DB_MAX_OVERFLOW", "10")))
ASYNC_DB_POOL_TIMEOUT = int(os.getenv("ASYNC_DB_POOL_TIMEOUT_SECONDS", os.getenv("DB_POOL_TIMEOUT_SECONDS", "30")))
ASYNC_DB_POOL_RECYCLE = int(os.getenv("ASYNC_DB_POOL_RECYCLE_SECONDS", os.getenv("DB_POOL_RECYCLE_SECONDS", "1800")))

engine = create_async_engine(
    DATABASE_URL,
    pool_size=ASYNC_DB_POOL_SIZE,
    max_overflow=ASYNC_DB_MAX_OVERFLOW,
    pool_timeout=ASYNC_DB_POOL_TIMEOUT,
    pool_recycle=ASYNC_DB_POOL_RECYCLE,
    pool_pre_ping=True,
    echo=False,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
