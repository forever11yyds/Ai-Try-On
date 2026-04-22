from __future__ import annotations

import logging
import os
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

logger = logging.getLogger(__name__)


def get_database_url() -> str:
  configured_url = os.getenv("DATABASE_URL", "").strip()
  if configured_url:
    return configured_url

  host = os.getenv("MYSQL_HOST", "127.0.0.1").strip() or "127.0.0.1"
  port = os.getenv("MYSQL_PORT", "3306").strip() or "3306"
  database = os.getenv("MYSQL_DATABASE", "ai_tryon").strip() or "ai_tryon"
  user = os.getenv("MYSQL_USER", "ai_tryon").strip() or "ai_tryon"
  password = os.getenv("MYSQL_PASSWORD", "ai_tryon_password").strip() or "ai_tryon_password"

  return f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset=utf8mb4"


class Base(DeclarativeBase):
  pass


def create_db_engine() -> Engine:
  return create_engine(
    get_database_url(),
    pool_pre_ping=True,
    pool_recycle=3600,
    future=True,
  )


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


def get_db() -> Generator[Session, None, None]:
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()


def check_database_connection() -> bool:
  try:
    with engine.connect() as connection:
      connection.execute(text("SELECT 1"))
    return True
  except Exception as exc:  # noqa: BLE001 - intentional backend guard
    logger.warning("MySQL connection check failed: %s", exc)
    return False


def initialize_database() -> bool:
  try:
    from models import Product, User  # noqa: F401
    from catalog_seed import seed_catalog

    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
      seed_catalog(db)

    return True
  except Exception as exc:  # noqa: BLE001 - keep backend alive if MySQL is offline
    logger.warning("MySQL initialization skipped: %s", exc)
    return False