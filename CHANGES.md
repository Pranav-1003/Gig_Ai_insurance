# Guardian — What Changed (v1 → v3)

## 🐳 Infrastructure Round 3 (v3.0.0): Docker + Security hardening

### Docker / docker-compose (`docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`)
- Full `docker compose up --build` stack: Postgres 16, Redis 7, FastAPI backend, Nginx-served React frontend
- Multi-stage Dockerfiles — final backend image ~200 MB, frontend ~25 MB
- Backend runs as non-root `guardian` user
- Postgres init script (`scripts/pg-init-multi-db.sh`) creates all three databases on first boot
- Frontend Nginx config handles SPA routing + reverse-proxies `/auth`, `/policy`, `/ws` etc. to backend (no CORS issues in prod)
- `.dockerignore` for both services keeps build context lean

### Security: OTP rate limiting + brute-force protection (`backend/routers/auth.py`)
- **SMS bombing fix**: `/send-otp` limited to 3 requests per phone per 10 min + 9/10 min per IP (configurable via `OTP_SEND_MAX`, `OTP_SEND_WINDOW_SECONDS`)
- **Brute-force fix**: `/verify-otp` and `/register` limited to 5 attempts per phone/IP per 10 min
- **Attempt counter**: `otp_attempts` column on `User` — OTP is wiped after `OTP_MAX_ATTEMPTS` (default 5) wrong guesses, forcing attacker back through send rate limit
- All limits return `429` with `Retry-After` header

### Health check (`backend/main.py`)
- `/health` now probes all three databases (`SELECT 1`) and Redis (`PING`)
- Returns per-dependency latency, `200 OK` when all healthy, `503` when any dependency is down
- Useful for load balancers, k8s readiness probes, and docker-compose `healthcheck`

### Minor fixes
- `logger` was used but never imported in `auth.py` — added `logging.getLogger("guardian.auth")`
- `otp_attempts` properly initialised to `0` on stub user rows
- Version bumped `2.0.0` → `3.0.0` everywhere in `main.py`

## 🏗️ Infrastructure Round 1 (v3): PostgreSQL + Redis pub/sub

### Infra 1 — PostgreSQL support (`backend/database.py`)
- `_make_engine()` now detects `postgresql+asyncpg://` URLs and configures production-grade pooling:
  `pool_size=10`, `max_overflow=20`, `pool_pre_ping=True` (survives DB restarts), `pool_recycle=1800`
- SQLite (`aiosqlite`) remains the default — zero-config for dev/CI, no env vars required
- New env vars (all optional): `WORKER_DB_URL`, `ADMIN_DB_URL`, `ANALYTICS_DB_URL`
- New pip dep: `asyncpg>=0.29.0`

Quick-start for Postgres:
```
createdb guardian_workers && createdb guardian_admin && createdb guardian_analytics
# then set the three *_DB_URL vars in .env
```

### Infra 2 — Redis pub/sub for WebSocket broadcast (`backend/routers/triggers.py`)
- Replaced the in-process `ConnectionManager` dict (broken with multiple Uvicorn workers) with a Redis pub/sub backed manager
- Architecture: `broadcast()` publishes JSON to `guardian:ws_broadcast` channel; a per-process background subscriber task fans the message out to every local WebSocket — so all workers behind a load balancer deliver to their own connections
- Graceful fallback: if `REDIS_URL` is unset or Redis is unreachable, falls back to in-process delivery (dev mode, single worker)
- Subscriber task reconnects automatically with exponential back-off on transient Redis errors
- New env var (optional): `REDIS_URL=redis://localhost:6379/0`
- New pip dep: `redis>=5.0.0`

Quick-start for Redis:
```
docker run -d -p 6379:6379 redis:7-alpine
# then set REDIS_URL=redis://localhost:6379/0 in .env
```

---

## 🏗️ Infrastructure Round 2 (v3): SMS Gateway

### Infra 3 — SMS gateway (`backend/sms.py` + `routers/auth.py`)
- New `sms.py` service module replaces the `print(f"[OTP]...")` stub
- Three providers selectable via `SMS_PROVIDER` env var:
  - `console` *(default)* — prints to stdout, zero credentials, safe for dev/CI
  - `twilio` — global SMS via Twilio REST API (no SDK, uses existing `httpx`)
  - `msg91` — Indian numbers via MSG91 OTP API v5 (cheaper per-SMS within India; requires TRAI DLT template)
- Automatic fallback: if configured provider fails → falls back to `console` — auth flow is never blocked by SMS outages
- SMS failure is logged as an error but does NOT raise an HTTP exception (OTP is still valid in DB)
- `send_otp_sms(phone, otp, expire_min)` — used by `/auth/send-otp`
- `send_sms(phone, message)` — generic helper for future claim-status notifications
- Phone numbers auto-normalised to E.164 (`+91XXXXXXXXXX` for 10-digit Indian numbers)
- No new pip deps — uses `httpx` already in `requirements.txt`

---



## 🔐 Authentication & Security

### Before
- No passwords. No tokens. Just phone number lookup → instant access.
- Any request could impersonate any user by guessing a user_id.
- Admin analytics endpoint was fully public.

### After
- **OTP-based login**: `POST /auth/send-otp` → 6-digit OTP (bcrypt-hashed, 10-min TTL) → `POST /auth/verify-otp` → signed JWT
- **JWT access tokens** (HS256, 7-day expiry for workers, 8-hour for admin sessions)
- **Every protected route** requires `Authorization: Bearer <token>`; wrong token = 401
- **Workers can only access their own data** (policy, claims, dashboard) — cross-user attempts return 403
- **Admin login**: `POST /auth/admin/login` with username + bcrypt password → separate admin JWT with role claim
- **Analytics endpoint** now requires admin JWT; returns 401 without it
- JWT secrets are env-var driven (`JWT_SECRET_KEY`, `JWT_ADMIN_SECRET`) — change before deploy

## 🗄️ Three Separate SQLite Databases (Role-Based)

| Database | File | Contains |
|---|---|---|
| Worker DB | `guardian_workers.db` | users, policies, claims |
| Admin DB | `guardian_admin.db` | admin accounts, audit log |
| Analytics DB | `guardian_analytics.db` | trigger events, LSTM predictions, zone stats |

A compromised worker DB does **not** expose admin credentials. Admin DB breach does **not** expose worker PII. Swap individual DBs to PostgreSQL independently by changing env vars.

## 🤖 LSTM Disruption Forecaster (New)

README called for "Phase 2: LSTM model predicts disruptions 48h in advance → Alert workers proactively."

**Implemented**: `backend/models/lstm_model.py`
- Pure-NumPy 2-layer LSTM (no TensorFlow/Torch dependency)
- Trained on synthetic historical data at first startup; weights saved to `lstm_weights.pkl`
- Retrained weekly via APScheduler
- New endpoint: `GET /predict/{zone_key}` → per-trigger risk scores + confidence
- Predictions stored in `guardian_analytics.db` for audit trail
- Features: temperature, humidity, rainfall, zone risk, time-of-day (sin/cos), recent claims, season factor

## 🐛 Bugs Fixed

1. **`_get_zone_status_async` used wrong field** — `rain_24h_extrapolated` doesn't exist in weather response; fixed to use `rain_mm`
2. **JWT `sub` must be string** — jose library rejects integer subjects; now stringified in `_create_token`
3. **`all_claims.scalar_one_or_none()` on non-scalar result** in `stats.py` — removed broken ticker logic, replaced with clean query
4. **No 403 on cross-user access** — dashboard/claims/policy endpoints now verify token user == path user_id
5. **`Optional` import at bottom of lstm_model.py** — moved to top
6. **Policy cancel had no ownership check** — anyone with a policy_id could cancel it; fixed

## 📦 Minimal Production Hardening

- Global FastAPI exception handler (no raw tracebacks to clients)
- Structured logging (stdlib `logging`, ISO timestamps)
- CORS origins from env var `ALLOWED_ORIGINS`
- `.env.example` with all required variables documented
- Default superadmin seeded from `ADMIN_DEFAULT_PASSWORD` env var
- Audit log table: every admin login recorded with IP + timestamp
- APScheduler for LSTM weekly retraining

## Frontend

- `AppContext` now stores `{ user, token }` as a session; `authHeaders` helper available everywhere
- `Register.jsx` rewritten with OTP step: send-otp → enter OTP → register
- Dev mode shows OTP in UI (remove `dev_otp` from backend response in production)
- All protected API calls pass `Authorization: Bearer <token>` header
