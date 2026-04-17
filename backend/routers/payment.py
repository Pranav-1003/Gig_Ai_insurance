"""
Payment Router — Razorpay integration for weekly premium collection.

Flow:
  1. POST /payment/create-order  → creates a Razorpay order, returns order_id + key
  2. Frontend opens Razorpay Checkout with the order_id
  3. POST /payment/verify        → verifies HMAC signature, then calls /policy/create internally

Env vars required:
  RAZORPAY_KEY_ID      — from Razorpay dashboard (rzp_test_... or rzp_live_...)
  RAZORPAY_KEY_SECRET  — secret for HMAC-SHA256 signature verification
"""

import os
import hmac
import hashlib
import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, User
from routers.auth import get_current_worker

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payment", tags=["payment"])

RAZORPAY_API_BASE = "https://api.razorpay.com/v1"


def _get_razorpay_keys() -> tuple[str, str]:
    """Read Razorpay keys fresh from env each time (supports runtime .env reloads)."""
    return os.getenv("RAZORPAY_KEY_ID", ""), os.getenv("RAZORPAY_KEY_SECRET", "")


def _razorpay_configured() -> bool:
    key_id, key_secret = _get_razorpay_keys()
    return bool(
        key_id and key_secret
        and "REPLACE" not in key_id
        and "REPLACE" not in key_secret
    )


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateOrderRequest(BaseModel):
    amount_paise: int        # amount in paise (e.g. 7500 = ₹75)
    currency: str = "INR"
    receipt: str = ""        # e.g. "policy_user_42"

class VerifyPaymentRequest(BaseModel):
    razorpay_order_id:   str
    razorpay_payment_id: str
    razorpay_signature:  str
    # Policy details forwarded from frontend after payment success
    premium:        float
    zone:           str
    zone_key:       str
    risk_score:     int
    max_payout:     float
    payment_method: str = "upi"
    upi_id:         str = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/create-order")
async def create_order(
    req: CreateOrderRequest,
    current_user: User = Depends(get_current_worker),
):
    """
    Create a Razorpay order. Returns order_id and publishable key for frontend checkout.
    Falls back to a simulated order if Razorpay keys are not configured (demo mode).
    """
    if not _razorpay_configured():
        # Demo / dev mode — return a fake order so the UI still works without real keys
        logger.warning("Razorpay not configured — returning simulated order (DEV only)")
        return {
            "order_id":   f"order_sim_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            "amount":     req.amount_paise,
            "currency":   req.currency,
            "key_id":     "rzp_test_demo",
            "simulated":  True,
        }

    key_id, key_secret = _get_razorpay_keys()
    dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"

    payload = {
        "amount":          req.amount_paise,
        "currency":        req.currency,
        "receipt":         req.receipt or f"rcpt_{current_user.id}_{int(datetime.utcnow().timestamp())}",
        "payment_capture": 1,   # auto-capture
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{RAZORPAY_API_BASE}/orders",
                json=payload,
                auth=(key_id, key_secret),
            )
        if resp.status_code != 200:
            logger.error("razorpay_create_order_failed status=%s body=%s",
                         resp.status_code, resp.text[:300])
            if dev_mode:
                # In dev mode, fall back to simulated order instead of crashing
                logger.warning("DEV_MODE: Razorpay API failed — falling back to simulated order")
                return {
                    "order_id":  f"order_sim_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                    "amount":    req.amount_paise,
                    "currency":  req.currency,
                    "key_id":    "rzp_test_demo",
                    "simulated": True,
                }
            raise HTTPException(status_code=502, detail="Payment gateway error. Please try again.")
        data = resp.json()
        return {
            "order_id": data["id"],
            "amount":   data["amount"],
            "currency": data["currency"],
            "key_id":   key_id,
            "simulated": False,
        }
    except httpx.RequestError as e:
        logger.error("razorpay_network_error: %s", e)
        if dev_mode:
            logger.warning("DEV_MODE: Razorpay network error — falling back to simulated order")
            return {
                "order_id":  f"order_sim_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                "amount":    req.amount_paise,
                "currency":  req.currency,
                "key_id":    "rzp_test_demo",
                "simulated": True,
            }
        raise HTTPException(status_code=502, detail="Could not reach payment gateway. Check your connection.")


@router.post("/verify")
async def verify_payment(
    req: VerifyPaymentRequest,
    current_user: User = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    """
    Verify Razorpay payment signature (HMAC-SHA256).
    On success, creates the policy and returns policy details.
    Simulated orders (order_id starts with 'order_sim_') skip signature check in dev mode.
    """
    is_simulated = req.razorpay_order_id.startswith("order_sim_")

    if not is_simulated:
        if not _razorpay_configured():
            raise HTTPException(status_code=503, detail="Payment gateway not configured")

        _, key_secret = _get_razorpay_keys()
        # Razorpay signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret)
        expected_sig = hmac.new(
            key_secret.encode(),
            f"{req.razorpay_order_id}|{req.razorpay_payment_id}".encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected_sig, req.razorpay_signature):
            logger.warning(
                "razorpay_signature_mismatch user_id=%s order=%s payment=%s",
                current_user.id, req.razorpay_order_id, req.razorpay_payment_id,
            )
            raise HTTPException(status_code=400, detail="Payment verification failed: invalid signature")

    # Signature valid (or simulated) — create the policy
    # Import here to avoid circular imports
    from routers.policy import _create_policy_record
    policy = await _create_policy_record(
        db=db,
        user_id=current_user.id,
        premium=req.premium,
        zone=req.zone,
        zone_key=req.zone_key,
        risk_score=req.risk_score,
        max_payout=req.max_payout,
        payment_method=req.payment_method,
        upi_id=req.upi_id,
        payment_id=req.razorpay_payment_id if not is_simulated else f"pay_sim_{req.razorpay_order_id}",
    )

    logger.info(
        "payment_verified_policy_created user_id=%s policy_id=%s order=%s payment=%s simulated=%s",
        current_user.id, policy["policy_id"], req.razorpay_order_id,
        req.razorpay_payment_id, is_simulated,
    )

    return {"status": "success", "payment_verified": True, **policy}
