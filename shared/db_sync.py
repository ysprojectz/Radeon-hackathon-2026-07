"""
Synchronous SQLAlchemy session factory.

The main pipeline runs synchronously (not async), so we need a psycopg2-backed
engine separate from the asyncpg engine in shared/database.py.

Usage:
    from shared.db_sync import get_sync_session

    with get_sync_session() as db:
        if db:
            persist_claim(db, claim_ref, claim_data, result)
        # else: DB not available, graceful skip

Or for a one-shot session:
    from shared.db_sync import get_sync_db
    db = get_sync_db()
    try:
        ...
    finally:
        if db: db.close()
"""
import os
import logging
from contextlib import contextmanager
from typing import Generator, Optional

logger = logging.getLogger(__name__)

SYNC_DATABASE_URL = os.getenv(
    "SYNC_DATABASE_URL",
    "postgresql+psycopg2://user:password@localhost:5432/dbname",
)

ENABLE_DB_PERSISTENCE = os.getenv("ENABLE_DB_PERSISTENCE", "true").lower() == "true"
SYNC_DB_POOL_SIZE = int(os.getenv("SYNC_DB_POOL_SIZE", os.getenv("DB_POOL_SIZE", "5")))
SYNC_DB_MAX_OVERFLOW = int(os.getenv("SYNC_DB_MAX_OVERFLOW", os.getenv("DB_MAX_OVERFLOW", "10")))
SYNC_DB_POOL_TIMEOUT = int(os.getenv("SYNC_DB_POOL_TIMEOUT_SECONDS", os.getenv("DB_POOL_TIMEOUT_SECONDS", "30")))
SYNC_DB_POOL_RECYCLE = int(os.getenv("SYNC_DB_POOL_RECYCLE_SECONDS", os.getenv("DB_POOL_RECYCLE_SECONDS", "1800")))

_engine = None
_SessionLocal = None


def _init_engine():
    """Lazily create the sync engine. Fails gracefully if psycopg2 or DB unavailable."""
    global _engine, _SessionLocal
    if _engine is not None:
        return _engine

    if not ENABLE_DB_PERSISTENCE:
        return None

    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        _engine = create_engine(
            SYNC_DATABASE_URL,
            pool_size=SYNC_DB_POOL_SIZE,
            max_overflow=SYNC_DB_MAX_OVERFLOW,
            pool_timeout=SYNC_DB_POOL_TIMEOUT,
            pool_recycle=SYNC_DB_POOL_RECYCLE,
            pool_pre_ping=True,
            echo=False,
            connect_args={"connect_timeout": 5},
        )
        _SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
        logger.info("Sync DB engine initialized: %s", SYNC_DATABASE_URL.split("@")[-1])
        return _engine

    except ImportError:
        logger.warning("psycopg2 not installed — DB persistence disabled")
        return None
    except Exception as e:
        logger.warning("Sync DB engine init failed (DB may be offline): %s", e)
        return None


@contextmanager
def get_sync_session() -> Generator[Optional[object], None, None]:
    """
    Context manager that yields a SQLAlchemy Session or None.

    If the database is unavailable, yields None so callers can skip
    persistence without crashing.

    Example:
        with get_sync_session() as db:
            if db:
                persist_claim(db, ref, data, result)
    """
    engine = _init_engine()
    if _SessionLocal is None or engine is None:
        yield None
        return

    session = _SessionLocal()
    try:
        yield session
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
        raise
    finally:
        session.close()


def get_sync_db():
    """
    Return a raw Session (caller must close). Returns None if DB unavailable.
    Prefer get_sync_session() context manager for automatic cleanup.
    """
    engine = _init_engine()
    if _SessionLocal is None or engine is None:
        return None
    return _SessionLocal()


def test_connection() -> bool:
    """Return True if a DB connection can be established."""
    try:
        engine = _init_engine()
        if engine is None:
            return False
        with engine.connect() as conn:
            from sqlalchemy import text
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.debug("DB connection test failed: %s", e)
        return False
