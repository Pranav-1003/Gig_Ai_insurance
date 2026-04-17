"""
Auth Router — secure OTP-based worker login + JWT session tokens.
POST /auth/send-otp     → generate & store OTP, deliver via SMS gateway
POST /auth/verify-otp   → verify OTP → issue JWT access token
POST /auth/register     → register new worker (phone + profile) → returns token
GET  /auth/me           → get current worker from token
GET  /auth/user/{id}    → get user profile (token required)
PUT  /auth/user/{id}    → update user profile (token required, own profile only)

Admin login (separate DB):
POST /auth/admin/login  → username + password → JWT with role claim

SMS delivery is handled by sms.py.  Set SMS_PROVIDER in .env:
  console  (default) → logs OTP to stdout, no credentials needed
  twilio             → production global SMS via Twilio
  msg91              → Indian numbers, cheaper; requires DLT template
"""
import os
import time
import random
import string
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db, get_admin_db, User, AdminUser, AuditLog, AdminSession
from sms import send_otp_sms

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("guardian.auth")

# ── JWT config ────────────────────────────────────────────────────────────────

_INSECURE_DEFAULTS = {
    "CHANGE_ME_IN_PRODUCTION_guardian_secret_2025",
    "CHANGE_ME_ADMIN_guardian_admin_2025",
}

SECRET_KEY   = os.getenv("JWT_SECRET_KEY", "")
ADMIN_SECRET = os.getenv("JWT_ADMIN_SECRET", "")

def _validate_secrets() -> None:
    """Crash at import-time if JWT secrets are missing or still set to defaults.

    A blank or well-known placeholder secret would let anyone forge valid tokens,
    so we treat that as a hard startup failure rather than a warning.
    """
    errors = []
    if not SECRET_KEY or SECRET_KEY in _INSECURE_DEFAULTS:
        errors.append(
            "JWT_SECRET_KEY is not set or is still the placeholder value. "
            "Generate a strong secret with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    if not ADMIN_SECRET or ADMIN_SECRET in _INSECURE_DEFAULTS:
        errors.append(
            "JWT_ADMIN_SECRET is not set or is still the placeholder value. "
            "Generate a strong secret with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    if len(SECRET_KEY) < 32:
        errors.append("JWT_SECRET_KEY must be at least 32 characters long.")
    if len(ADMIN_SECRET) < 32:
        errors.append("JWT_ADMIN_SECRET must be at least 32 characters long.")
    if errors:
        raise RuntimeError(
            "\n\n[GUARDIAN STARTUP FAILURE — INSECURE JWT CONFIG]\n"
            + "\n".join(f"  • {e}" for e in errors)
            + "\n\nSet strong secrets in your .env file and restart.\n"
        )

_validate_secrets()

ALGORITHM     = "HS256"
ACCESS_EXPIRE = int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))   # 7 days default
OTP_EXPIRE_MIN  = 10
# DEV_MODE=true exposes OTP in response for local development ONLY.
# Must be unset or "false" in any production / staging environment.
DEV_MODE        = os.getenv("DEV_MODE", "false").lower() in ("1", "true", "yes")

# ── Rate limiting (in-process; swap for Redis-backed in multi-worker deploy) ──
# Stores: { key -> [timestamp, ...] }
_rate_store: dict[str, list[float]] = defaultdict(list)

# OTP send: max 3 requests per phone per 10 minutes (anti-SMS-bombing)
OTP_SEND_MAX    = int(os.getenv("OTP_SEND_MAX", "3"))
OTP_SEND_WINDOW = int(os.getenv("OTP_SEND_WINDOW_SECONDS", "600"))  # 10 min

# OTP verify: max 5 attempts per phone per 10 minutes (anti-brute-force)
OTP_VERIFY_MAX    = int(os.getenv("OTP_VERIFY_MAX", "5"))
OTP_VERIFY_WINDOW = int(os.getenv("OTP_VERIFY_WINDOW_SECONDS", "600"))  # 10 min

# Max OTP guess attempts stored on the User row before the OTP is invalidated
OTP_MAX_ATTEMPTS = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))


def _rate_check(bucket: str, max_calls: int, window_seconds: int) -> None:
    """Raise 429 if bucket has exceeded max_calls within window_seconds.

    Trims expired timestamps so the store doesn't grow unboundedly.
    """
    now = time.monotonic()
    cutoff = now - window_seconds
    calls = _rate_store[bucket]
    # evict old entries
    _rate_store[bucket] = [t for t in calls if t > cutoff]
    if len(_rate_store[bucket]) >= max_calls:
        retry_after = int(window_seconds - (now - _rate_store[bucket][0]))
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Please wait {retry_after} seconds before retrying.",
            headers={"Retry-After": str(max(retry_after, 1))},
        )
    _rate_store[bucket].append(now)

bearer_scheme = HTTPBearer(auto_error=False)


def _create_token(data: dict, secret: str = SECRET_KEY, expires_minutes: int = ACCESS_EXPIRE) -> str:
    payload = data.copy()
    # JWT spec requires sub to be a string; enforce this unconditionally.
    # Guarding against None prevents str(None) == "None" edge case.
    sub = payload.get("sub")
    if sub is None:
        raise ValueError("_create_token: 'sub' claim is required and must not be None")
    payload["sub"] = str(sub)
    payload["exp"] = datetime.utcnow() + timedelta(minutes=expires_minutes)
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def _decode_token(token: str, secret: str = SECRET_KEY) -> dict:
    return jwt.decode(token, secret, algorithms=[ALGORITHM])


def _hash_otp(otp: str) -> str:
    return bcrypt.hashpw(otp.encode(), bcrypt.gensalt()).decode()


def _verify_otp(otp: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(otp.encode(), hashed.encode())
    except Exception:
        return False


# ── Token verification dependencies ──────────────────────────────────────────

async def get_current_worker(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency: parse JWT, return worker User. Raises 401 on failure."""
    if not creds:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = _decode_token(creds.credentials)
        sub: str = payload.get("sub")
        role: str = payload.get("role", "worker")
        if not sub or role != "worker":
            raise HTTPException(status_code=401, detail="Invalid token")
        try:
            user_id = int(sub)
        except (TypeError, ValueError):
            raise HTTPException(status_code=401, detail="Invalid token: bad subject claim")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_current_admin(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """Dependency: parse admin JWT, return payload dict."""
    if not creds:
        raise HTTPException(status_code=401, detail="Admin authentication required")
    try:
        payload = _decode_token(creds.credentials, secret=ADMIN_SECRET)
        if payload.get("role") not in ("superadmin", "analyst", "ops"):
            raise HTTPException(status_code=403, detail="Insufficient privileges")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    return payload


# ── Schemas ───────────────────────────────────────────────────────────────────

class SendOTPRequest(BaseModel):
    phone: str

class VerifyOTPRequest(BaseModel):
    phone: str
    otp: str

class RegisterRequest(BaseModel):
    phone: str
    otp: str
    name: str = "Delivery Partner"
    zone: str
    zone_key: str
    income: float = 4500
    platform: str = "zomato"
    tenure: str = "mid"
    upi_id: str = ""

class AdminLoginRequest(BaseModel):
    username: str
    password: str


# ── OTP endpoints ─────────────────────────────────────────────────────────────

@router.post("/send-otp")
async def send_otp(req: SendOTPRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Generate a 6-digit OTP, hash & store it. In production, send via SMS."""
    # Basic phone validation
    phone = req.phone.strip().replace(" ", "").replace("-", "")
    if not phone.isdigit() or len(phone) not in (10, 12, 13):
        raise HTTPException(status_code=422, detail="Invalid phone number format")

    # ── Rate limit: per-phone + per-IP to block SMS bombing ──────────────────
    client_ip = request.client.host if request.client else "unknown"
    _rate_check(f"send_otp:phone:{phone}", OTP_SEND_MAX, OTP_SEND_WINDOW)
    _rate_check(f"send_otp:ip:{client_ip}", OTP_SEND_MAX * 3, OTP_SEND_WINDOW)

    otp = "".join(random.choices(string.digits, k=6))
    otp_hash = _hash_otp(otp)
    otp_expires = datetime.utcnow() + timedelta(minutes=OTP_EXPIRE_MIN)

    # Upsert OTP on user row (create stub row for new users so OTP is verifiable at registration)
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()

    if user:
        user.otp_hash = otp_hash
        user.otp_expires = otp_expires
        user.otp_attempts = 0   # reset attempt counter on fresh OTP
    else:
        # New user: create a minimal unverified stub row to hold the OTP.
        # The registration endpoint will fill in the remaining fields.
        stub = User(
            phone=phone,
            name="",
            zone="",
            zone_key="",
            otp_hash=otp_hash,
            otp_expires=otp_expires,
            otp_attempts=0,
            is_verified=False,
        )
        db.add(stub)

    await db.commit()

    # Send OTP via configured SMS gateway (Twilio / MSG91 / console fallback)
    sms_ok, sms_err = await send_otp_sms(phone=phone, otp=otp, expire_min=OTP_EXPIRE_MIN)
    if not sms_ok:
        # SMS failure must never block authentication — log and continue.
        # The OTP is still valid; the user can retry or use dev_otp in DEV_MODE.
        logger.error("[OTP] SMS delivery failed phone=%s err=%s", phone[-4:], sms_err)

    response: dict = {
        "message": f"OTP sent to {phone[-4:].rjust(10, '*')}",
        "expires_in": f"{OTP_EXPIRE_MIN} minutes",
    }
    # Only expose the raw OTP when explicitly running in dev mode.
    # Never set DEV_MODE=true in production or staging.
    if DEV_MODE:
        response["dev_otp"] = otp
    return response


@router.post("/verify-otp")
async def verify_otp(req: VerifyOTPRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Verify OTP for existing user, issue JWT."""
    # ── Rate limit: prevent brute-force across 1M combinations ───────────────
    client_ip = request.client.host if request.client else "unknown"
    _rate_check(f"verify_otp:phone:{req.phone}", OTP_VERIFY_MAX, OTP_VERIFY_WINDOW)
    _rate_check(f"verify_otp:ip:{client_ip}", OTP_VERIFY_MAX * 5, OTP_VERIFY_WINDOW)

    result = await db.execute(select(User).where(User.phone == req.phone))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Phone not registered. Please register first.")

    if not user.otp_hash or not user.otp_expires:
        raise HTTPException(status_code=400, detail="No OTP requested. Call /auth/send-otp first.")
    if datetime.utcnow() > user.otp_expires:
        raise HTTPException(status_code=400, detail="OTP expired. Request a new one.")

    # ── Per-row attempt counter — invalidate OTP after OTP_MAX_ATTEMPTS wrong guesses
    attempts = (user.otp_attempts or 0)
    if attempts >= OTP_MAX_ATTEMPTS:
        # Wipe the OTP so attacker must trigger a fresh send (and hit rate limit)
        user.otp_hash = ""
        user.otp_expires = None
        user.otp_attempts = 0
        await db.commit()
        raise HTTPException(
            status_code=429,
            detail="Too many incorrect OTP attempts. Please request a new OTP.",
        )

    if not _verify_otp(req.otp, user.otp_hash):
        user.otp_attempts = attempts + 1
        await db.commit()
        remaining = OTP_MAX_ATTEMPTS - user.otp_attempts
        raise HTTPException(
            status_code=401,
            detail=f"Invalid OTP. {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
        )

    # Mark verified, clear OTP
    user.is_verified = True
    user.otp_hash = ""
    user.otp_expires = None
    await db.commit()

    token = _create_token({"sub": user.id, "role": "worker", "phone": user.phone})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "name": user.name,
        "zone": user.zone,
        "is_new": False,
    }


@router.post("/register")
async def register(req: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Register new worker: validate OTP then create account, return JWT."""
    phone = req.phone.strip().replace(" ", "").replace("-", "")
    if not phone.isdigit() or len(phone) not in (10, 12, 13):
        raise HTTPException(status_code=422, detail="Invalid phone number format")

    # Rate-limit registration attempts (shares verify bucket — same attack surface)
    client_ip = request.client.host if request.client else "unknown"
    _rate_check(f"verify_otp:phone:{phone}", OTP_VERIFY_MAX, OTP_VERIFY_WINDOW)
    _rate_check(f"verify_otp:ip:{client_ip}", OTP_VERIFY_MAX * 5, OTP_VERIFY_WINDOW)

    # Check existing
    result = await db.execute(select(User).where(User.phone == phone))
    existing = result.scalar_one_or_none()

    if existing:
        # Both returning users AND new users (stub row from send-otp) land here.
        # Always verify OTP against the stored hash — no DEMO_OTP bypass.
        if not existing.otp_hash or not existing.otp_expires:
            raise HTTPException(status_code=400, detail="Request OTP first via /auth/send-otp")
        if datetime.utcnow() > existing.otp_expires:
            raise HTTPException(status_code=400, detail="OTP expired")

        # Per-row attempt counter check
        attempts = (existing.otp_attempts or 0)
        if attempts >= OTP_MAX_ATTEMPTS:
            existing.otp_hash = ""
            existing.otp_expires = None
            existing.otp_attempts = 0
            await db.commit()
            raise HTTPException(
                status_code=429,
                detail="Too many incorrect OTP attempts. Please request a new OTP.",
            )

        if not _verify_otp(req.otp, existing.otp_hash):
            existing.otp_attempts = attempts + 1
            await db.commit()
            remaining = OTP_MAX_ATTEMPTS - existing.otp_attempts
            raise HTTPException(
                status_code=401,
                detail=f"Invalid OTP. {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
            )

        is_new = not existing.is_verified  # stub rows have is_verified=False

        # Fill in / update profile fields
        existing.name      = req.name or existing.name or "Delivery Partner"
        existing.zone      = req.zone or existing.zone
        existing.zone_key  = req.zone_key or existing.zone_key
        existing.income    = req.income
        existing.platform  = req.platform or existing.platform
        existing.tenure    = req.tenure or existing.tenure
        existing.upi_id    = req.upi_id or existing.upi_id
        existing.is_verified = True
        existing.otp_hash  = ""
        existing.otp_expires = None
        existing.otp_attempts = 0

        await db.commit()
        await db.refresh(existing)

        token = _create_token({"sub": existing.id, "role": "worker", "phone": existing.phone})
        return {
            "access_token": token, "token_type": "bearer",
            "user_id": existing.id, "name": existing.name, "zone": existing.zone,
            "is_new": is_new,
            "message": "Registration successful! Welcome to Guardian." if is_new else "Welcome back!",
        }

    # Should not reach here — send-otp always creates a stub row first.
    raise HTTPException(status_code=400, detail="Please request an OTP first via /auth/send-otp")


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_worker)):
    return {
        "id": current_user.id, "phone": current_user.phone, "name": current_user.name,
        "upi_id": current_user.upi_id, "zone": current_user.zone, "zone_key": current_user.zone_key,
        "income": current_user.income, "platform": current_user.platform,
        "tenure": current_user.tenure, "language": current_user.language,
        "vehicle": current_user.vehicle, "is_verified": current_user.is_verified,
    }


@router.get("/user/{user_id}")
async def get_user(
    user_id: int,
    current_user: User = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    # Workers can only fetch their own profile; admins not handled here
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id, "phone": user.phone, "name": user.name, "upi_id": user.upi_id,
        "zone": user.zone, "zone_key": user.zone_key, "income": user.income,
        "platform": user.platform, "tenure": user.tenure, "language": user.language,
        "vehicle": user.vehicle,
    }


@router.put("/user/{user_id}")
async def update_user(
    user_id: int,
    data: dict,
    current_user: User = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    allowed = ["name", "upi_id", "zone", "zone_key", "income", "platform",
               "tenure", "language", "vehicle"]
    for key, val in data.items():
        if key in allowed:
            setattr(user, key, val)

    await db.commit()
    return {"message": "Profile updated successfully"}


# ── Admin login ───────────────────────────────────────────────────────────────

@router.post("/admin/login")
async def admin_login(req: AdminLoginRequest, request: Request, db: AsyncSession = Depends(get_admin_db)):
    result = await db.execute(select(AdminUser).where(AdminUser.username == req.username))
    admin = result.scalar_one_or_none()

    if not admin or not admin.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    try:
        valid = bcrypt.checkpw(req.password.encode(), admin.password_hash.encode())
    except Exception:
        valid = False
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Update last login
    admin.last_login = datetime.utcnow()

    # Audit log
    ip = request.client.host if request.client else "unknown"
    log = AuditLog(admin_id=admin.id, action="login", detail="Admin login", ip_address=ip)
    db.add(log)
    await db.commit()

    token = _create_token(
        {"sub": admin.id, "role": admin.role, "username": admin.username},
        secret=ADMIN_SECRET,
        expires_minutes=480,   # 8 hours for admin sessions
    )
    return {
        "access_token": token, "token_type": "bearer",
        "username": admin.username, "role": admin.role,
    }
