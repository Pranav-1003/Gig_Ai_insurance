"""
Guardian FastAPI Backend — Production-hardened entry point.

Routes:
  POST   /auth/send-otp            → request OTP
  POST   /auth/verify-otp          → verify OTP → JWT token
  POST   /auth/register            → register + OTP → JWT token
  GET    /auth/me                  → current worker profile (token required)
  GET    /auth/user/{id}           → worker profile (own only, token required)
  PUT    /auth/user/{id}           → update profile (own only)
  POST   /auth/admin/login         → admin username+password → admin JWT
  GET    /premium                  → XGBoost premium calculation
  POST   /policy/create            → create policy (token required)
  GET    /policy/dashboard/{id}    → worker dashboard (token required)
  PATCH  /policy/{id}/cancel       → cancel policy (token required)
  GET    /claims/{user_id}         → claim history (token required)
  GET    /stats                    → landing page live stats (public)
  GET    /analytics                → insurer analytics (admin token required)
  POST   /trigger-event            → fire disruption trigger
  GET    /weather/{zone_key}       → real-time weather
  GET    /predict/{zone_key}       → LSTM 48h disruption forecast
  WS     /ws/{user_id}             → real-time WebSocket
"""
import os
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from database import init_db
from routers import auth, premium, policy, claims, stats, triggers, payment

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("guardian")


# ── LSTM pre-load + APScheduler ───────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    logger.info("[OK] Guardian DB initialized (workers / admin / analytics)")

    # Pre-load LSTM model (trains on synthetic data first run, loads from pkl thereafter)
    try:
        from models.lstm_model import _get_model
        _get_model()
        logger.info("[OK] LSTM disruption forecaster ready")
    except Exception as e:
        logger.warning(f"[LSTM] Could not pre-load model: {e}")

    # APScheduler: weekly LSTM re-train
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from models.lstm_model import retrain_model
        scheduler = AsyncIOScheduler()
        scheduler.add_job(retrain_model, "interval", weeks=1, id="lstm_retrain")
        scheduler.start()
        logger.info("[OK] APScheduler started (LSTM weekly retrain)")
    except Exception as e:
        logger.warning(f"[Scheduler] Could not start: {e}")

    yield

    # Shutdown
    logger.info("[STOP] Guardian shutting down")


app = FastAPI(
    title="Guardian API",
    description="Parametric income insurance for India's gig workers",
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
)
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global error handler disabled for debugging ───────────────────────────────

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(premium.router)
app.include_router(policy.router)
app.include_router(claims.router)
app.include_router(stats.router)
app.include_router(triggers.router)
app.include_router(payment.router)


@app.get("/")
async def root():
    return {
        "name": "Guardian API",
        "version": "3.0.0",
        "status": "online",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    """Real liveness/readiness check: probes each DB and Redis (if configured).
    Returns 200 only when all critical dependencies are reachable.
    Load balancers and container orchestrators should use this endpoint.
    """
    import time
    checks: dict = {}
    overall_ok = True

    # ── Worker DB ─────────────────────────────────────────────────────────────
    try:
        from database import WorkerSession
        from sqlalchemy import text
        t0 = time.monotonic()
        async with WorkerSession() as s:
            await s.execute(text("SELECT 1"))
        checks["worker_db"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000, 1)}
    except Exception as e:
        checks["worker_db"] = {"status": "error", "detail": str(e)}
        overall_ok = False

    # ── Admin DB ──────────────────────────────────────────────────────────────
    try:
        from database import AdminSession
        from sqlalchemy import text
        t0 = time.monotonic()
        async with AdminSession() as s:
            await s.execute(text("SELECT 1"))
        checks["admin_db"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000, 1)}
    except Exception as e:
        checks["admin_db"] = {"status": "error", "detail": str(e)}
        overall_ok = False

    # ── Analytics DB ──────────────────────────────────────────────────────────
    try:
        from database import AnalyticsSession
        from sqlalchemy import text
        t0 = time.monotonic()
        async with AnalyticsSession() as s:
            await s.execute(text("SELECT 1"))
        checks["analytics_db"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000, 1)}
    except Exception as e:
        checks["analytics_db"] = {"status": "error", "detail": str(e)}
        overall_ok = False

    # ── Redis (optional) ──────────────────────────────────────────────────────
    redis_url = os.getenv("REDIS_URL", "")
    if redis_url:
        try:
            import redis.asyncio as aioredis
            t0 = time.monotonic()
            r = aioredis.from_url(redis_url, socket_connect_timeout=2)
            await r.ping()
            await r.aclose()
            checks["redis"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000, 1)}
        except Exception as e:
            checks["redis"] = {"status": "error", "detail": str(e)}
            overall_ok = False
    else:
        checks["redis"] = {"status": "not_configured"}

    status_code = 200 if overall_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if overall_ok else "degraded",
            "service": "guardian-backend",
            "version": "3.0.0",
            "checks": checks,
        },
    )
