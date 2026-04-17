"""
Database configuration — Three separate databases, one per role:
  - guardian_workers    → workers (users, policies, claims)
  - guardian_admin      → admin/insurer accounts + audit log
  - guardian_analytics  → trigger events, LSTM predictions, zone stats

Supports both PostgreSQL (asyncpg) and SQLite (aiosqlite).
Set *_DB_URL env vars to postgresql+asyncpg://... for production,
or leave unset to fall back to local SQLite files (dev/CI).

PostgreSQL quick-start (one-time):
  createdb guardian_workers
  createdb guardian_admin
  createdb guardian_analytics

Example .env:
  WORKER_DB_URL=postgresql+asyncpg://user:pass@localhost/guardian_workers
  ADMIN_DB_URL=postgresql+asyncpg://user:pass@localhost/guardian_admin
  ANALYTICS_DB_URL=postgresql+asyncpg://user:pass@localhost/guardian_analytics
"""
import os
import logging
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text, JSON
)
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DB_DIR = os.getenv("DB_DIR", ".")

WORKER_DB_URL    = os.getenv("WORKER_DB_URL",    f"sqlite+aiosqlite:///{DB_DIR}/guardian_workers.db")
ADMIN_DB_URL     = os.getenv("ADMIN_DB_URL",     f"sqlite+aiosqlite:///{DB_DIR}/guardian_admin.db")
ANALYTICS_DB_URL = os.getenv("ANALYTICS_DB_URL", f"sqlite+aiosqlite:///{DB_DIR}/guardian_analytics.db")


def _make_engine(url: str):
    """
    Build an async SQLAlchemy engine.
    - PostgreSQL (asyncpg): connection pooling with sane defaults for production.
    - SQLite (aiosqlite):   single-file, dev/CI only.
    """
    if "postgresql" in url or "postgres" in url:
        # asyncpg driver — pool_pre_ping keeps connections alive after DB restarts
        engine = create_async_engine(
            url,
            echo=False,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            pool_recycle=1800,       # recycle connections every 30 min
        )
        logger.info("[DB] Using PostgreSQL: %s", url.split("@")[-1])  # hide credentials
    else:
        # SQLite — check_same_thread is irrelevant for async but aiosqlite requires it off
        engine = create_async_engine(
            url,
            echo=False,
            connect_args={"check_same_thread": False},
        )
        logger.info("[DB] Using SQLite: %s", url)
    return engine


worker_engine    = _make_engine(WORKER_DB_URL)
admin_engine     = _make_engine(ADMIN_DB_URL)
analytics_engine = _make_engine(ANALYTICS_DB_URL)

WorkerSession    = async_sessionmaker(worker_engine,    expire_on_commit=False, class_=AsyncSession)
AdminSession     = async_sessionmaker(admin_engine,     expire_on_commit=False, class_=AsyncSession)
AnalyticsSession = async_sessionmaker(analytics_engine, expire_on_commit=False, class_=AsyncSession)

# Backwards-compatible alias
AsyncSessionLocal = WorkerSession


# ── Worker DB ─────────────────────────────────────────────────────────────────

class WorkerBase(DeclarativeBase):
    pass


class User(WorkerBase):
    __tablename__ = "users"
    id          = Column(Integer, primary_key=True, index=True)
    phone       = Column(String(15), unique=True, index=True, nullable=False)
    name        = Column(String(100), default="Delivery Partner")
    upi_id      = Column(String(100), default="")
    zone        = Column(String(50), nullable=False)
    zone_key    = Column(String(50), nullable=False)
    income      = Column(Float, default=4500)
    platform    = Column(String(50), default="zomato")
    tenure      = Column(String(20), default="mid")
    language    = Column(String(20), default="Tamil")
    vehicle     = Column(String(30), default="motorcycle")
    otp_hash    = Column(String(128), default="")
    otp_expires = Column(DateTime, nullable=True)
    otp_attempts = Column(Integer, default=0)   # brute-force attempt counter
    is_verified = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    policies = relationship("Policy", back_populates="user")
    claims   = relationship("Claim",  back_populates="user")


class Policy(WorkerBase):
    __tablename__ = "policies"
    id             = Column(Integer, primary_key=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id"), nullable=False)
    policy_number  = Column(String(20), unique=True, nullable=False)
    premium        = Column(Float, nullable=False)
    status         = Column(String(20), default="active")
    zone           = Column(String(50))
    zone_key       = Column(String(50))
    risk_score     = Column(Integer, default=50)
    max_payout     = Column(Float, default=2350)
    valid_until    = Column(DateTime)
    payment_method = Column(String(20), default="upi")
    payment_id     = Column(String(100), default="")
    created_at     = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="policies")


class Claim(WorkerBase):
    __tablename__ = "claims"
    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=False)
    trigger_type     = Column(String(30), nullable=False)
    trigger_label    = Column(String(100), default="")
    zone             = Column(String(50))
    status           = Column(String(20), default="processing")
    amount           = Column(Float, nullable=False)
    rejection_reason = Column(Text, default="")
    fraud_stage1     = Column(String(20), default="pending")
    fraud_stage2     = Column(String(20), default="pending")
    fraud_stage3     = Column(String(20), default="pending")
    bcs_score        = Column(Integer, default=0)
    tier             = Column(String(10), default="tier1")
    txn_id           = Column(String(50), default="")
    timestamp        = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="claims")


# ── Admin DB ──────────────────────────────────────────────────────────────────

class AdminBase(DeclarativeBase):
    pass


class AdminUser(AdminBase):
    __tablename__ = "admin_users"
    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String(50), unique=True, nullable=False, index=True)
    email         = Column(String(120), unique=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    role          = Column(String(20), default="analyst")   # superadmin | analyst | ops
    is_active     = Column(Boolean, default=True)
    last_login    = Column(DateTime, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)
    audit_logs = relationship("AuditLog", back_populates="admin")


class AuditLog(AdminBase):
    __tablename__ = "audit_logs"
    id         = Column(Integer, primary_key=True, index=True)
    admin_id   = Column(Integer, ForeignKey("admin_users.id"), nullable=False)
    action     = Column(String(100), nullable=False)
    target     = Column(String(100), default="")
    detail     = Column(Text, default="")
    ip_address = Column(String(45), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    admin = relationship("AdminUser", back_populates="audit_logs")


# ── Analytics DB ──────────────────────────────────────────────────────────────

class AnalyticsBase(DeclarativeBase):
    pass


class TriggerEvent(AnalyticsBase):
    __tablename__ = "triggers"
    id               = Column(Integer, primary_key=True, index=True)
    type             = Column(String(30), nullable=False)
    location         = Column(String(50), nullable=False)
    severity         = Column(String(20), default="medium")
    value            = Column(Float, default=0)
    description      = Column(Text, default="")
    workers_affected = Column(Integer, default=0)
    total_payout     = Column(Float, default=0)
    fired_at         = Column(DateTime, default=datetime.utcnow)


class LSTMPrediction(AnalyticsBase):
    """48-hour-ahead disruption forecasts from LSTM model."""
    __tablename__ = "lstm_predictions"
    id              = Column(Integer, primary_key=True, index=True)
    zone_key        = Column(String(50), nullable=False, index=True)
    trigger_type    = Column(String(30), nullable=False)
    predicted_at    = Column(DateTime, default=datetime.utcnow)
    forecast_window = Column(String(30), default="48h")
    risk_score      = Column(Float, default=0.0)      # 0-1 probability
    risk_label      = Column(String(20), default="low")
    confidence      = Column(Float, default=0.0)
    feature_vector  = Column(JSON, default=list)
    actual_fired    = Column(Boolean, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)


class ZoneStats(AnalyticsBase):
    __tablename__ = "zone_stats"
    id            = Column(Integer, primary_key=True, index=True)
    zone_key      = Column(String(50), nullable=False, index=True)
    period_start  = Column(DateTime, nullable=False)
    period_end    = Column(DateTime, nullable=False)
    claims_count  = Column(Integer, default=0)
    payouts_total = Column(Float, default=0)
    fraud_rate    = Column(Float, default=0)
    avg_bcs       = Column(Float, default=0)
    created_at    = Column(DateTime, default=datetime.utcnow)


# ── Init ──────────────────────────────────────────────────────────────────────

async def init_db():
    async with worker_engine.begin() as conn:
        await conn.run_sync(WorkerBase.metadata.create_all)
    async with admin_engine.begin() as conn:
        await conn.run_sync(AdminBase.metadata.create_all)
    async with analytics_engine.begin() as conn:
        await conn.run_sync(AnalyticsBase.metadata.create_all)
    await _seed_superadmin()


async def _seed_superadmin():
    try:
        import bcrypt
    except ImportError:
        print("[DB] bcrypt not installed, skipping admin seed")
        return
    async with AdminSession() as session:
        from sqlalchemy import select, func
        count = await session.execute(select(func.count(AdminUser.id)))
        if (count.scalar() or 0) > 0:
            return
        pwd = os.getenv("ADMIN_DEFAULT_PASSWORD", "Guardian@Admin2025!")
        hashed = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()
        admin = AdminUser(
            username="superadmin",
            email="admin@guardian.ai",
            password_hash=hashed,
            role="superadmin",
        )
        session.add(admin)
        await session.commit()
        print("[DB] Default superadmin created. Change password immediately.")


async def get_db():
    async with WorkerSession() as session:
        yield session

async def get_admin_db():
    async with AdminSession() as session:
        yield session

async def get_analytics_db():
    async with AnalyticsSession() as session:
        yield session
