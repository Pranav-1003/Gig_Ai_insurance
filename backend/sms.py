"""
SMS Gateway — send OTP and notification messages to workers.

Provider selection (set SMS_PROVIDER in .env):
  twilio   → Twilio SMS (global, recommended for production)
  msg91    → MSG91 (Indian numbers, cheaper per-SMS within India)
  console  → print to stdout — safe fallback for dev / CI

Automatic fallback chain:
  configured provider → console (if provider call raises an exception)

Environment variables
─────────────────────
SMS_PROVIDER      twilio | msg91 | console   (default: console)

Twilio
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_FROM_NUMBER   e.g. +14155552671  (your Twilio number)

MSG91
  MSG91_AUTH_KEY
  MSG91_SENDER_ID      6-char sender ID, e.g. GRDJOB
  MSG91_TEMPLATE_ID    DLT-registered template ID (required by TRAI)

Usage
─────
  from sms import send_otp_sms, send_sms

  ok, err = await send_otp_sms(phone="9876543210", otp="482910", expire_min=10)
  ok, err = await send_sms(phone="+919876543210", message="Your Guardian payout of ₹500 is being processed.")
"""
import os
import logging
from typing import Tuple

import httpx

logger = logging.getLogger(__name__)

SMS_PROVIDER = os.getenv("SMS_PROVIDER", "console").lower()

# ── Twilio ─────────────────────────────────────────────────────────────────────
TWILIO_SID    = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN  = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM   = os.getenv("TWILIO_FROM_NUMBER", "")

# ── MSG91 ──────────────────────────────────────────────────────────────────────
MSG91_AUTH_KEY     = os.getenv("MSG91_AUTH_KEY", "")
MSG91_SENDER_ID    = os.getenv("MSG91_SENDER_ID", "GRDJOB")
MSG91_TEMPLATE_ID  = os.getenv("MSG91_TEMPLATE_ID", "")


def _e164(phone: str) -> str:
    """Normalise Indian phone numbers to E.164 format (+91XXXXXXXXXX)."""
    phone = phone.strip().replace(" ", "").replace("-", "")
    if phone.startswith("+"):
        return phone
    if phone.startswith("91") and len(phone) == 12:
        return f"+{phone}"
    if len(phone) == 10:
        return f"+91{phone}"
    return f"+{phone}"   # best-effort for other formats


def _otp_message(otp: str, expire_min: int) -> str:
    return (
        f"Your Guardian OTP is {otp}. "
        f"Valid for {expire_min} minutes. "
        f"Do not share this code with anyone."
    )


# ── Provider implementations ───────────────────────────────────────────────────

async def _send_twilio(to: str, message: str) -> Tuple[bool, str]:
    """Send via Twilio Messages API using httpx (no SDK dependency)."""
    if not all([TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM]):
        return False, "Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)"

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                auth=(TWILIO_SID, TWILIO_TOKEN),
                data={"To": to, "From": TWILIO_FROM, "Body": message},
            )
        if resp.status_code in (200, 201):
            sid = resp.json().get("sid", "")
            logger.info("[SMS/Twilio] Sent to %s sid=%s", to[-4:].rjust(14, "*"), sid)
            return True, ""
        err = resp.json().get("message", resp.text)
        logger.error("[SMS/Twilio] Failed to=%s status=%s err=%s", to[-4:], resp.status_code, err)
        return False, err
    except Exception as exc:
        logger.error("[SMS/Twilio] Exception: %s", exc)
        return False, str(exc)


async def _send_msg91(to: str, otp: str, expire_min: int) -> Tuple[bool, str]:
    """
    Send via MSG91 OTP API v5.
    Requires a TRAI-registered DLT template (MSG91_TEMPLATE_ID).
    """
    if not MSG91_AUTH_KEY:
        return False, "MSG91_AUTH_KEY not configured"

    # Strip leading + for MSG91 (expects 91XXXXXXXXXX)
    mobile = to.lstrip("+")

    payload = {
        "template_id": MSG91_TEMPLATE_ID,
        "mobile":      mobile,
        "authkey":     MSG91_AUTH_KEY,
        "otp":         otp,
        "otp_expiry":  expire_min,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://control.msg91.com/api/v5/otp",
                json=payload,
                headers={"Content-Type": "application/JSON"},
            )
        data = resp.json()
        if data.get("type") == "success":
            logger.info("[SMS/MSG91] Sent to %s", mobile[-4:].rjust(14, "*"))
            return True, ""
        err = data.get("message", str(data))
        logger.error("[SMS/MSG91] Failed mobile=%s err=%s", mobile[-4:], err)
        return False, err
    except Exception as exc:
        logger.error("[SMS/MSG91] Exception: %s", exc)
        return False, str(exc)


async def _send_console(to: str, message: str) -> Tuple[bool, str]:
    """No-op provider: logs OTP to stdout. Safe for dev / CI."""
    print(f"[SMS/console] -> {to}  |  {message}")
    return True, ""


# ── Public API ─────────────────────────────────────────────────────────────────

async def send_otp_sms(phone: str, otp: str, expire_min: int = 10) -> Tuple[bool, str]:
    """
    Send an OTP SMS to `phone`.
    Returns (success: bool, error_message: str).
    Falls back to console on provider failure so the auth flow is never blocked.
    """
    to = _e164(phone)
    message = _otp_message(otp, expire_min)
    provider = SMS_PROVIDER

    ok, err = await _dispatch(provider, to=to, message=message, otp=otp, expire_min=expire_min)

    if not ok and provider != "console":
        logger.warning("[SMS] Provider '%s' failed (%s) — falling back to console", provider, err)
        ok, err = await _send_console(to, message)

    return ok, err


async def send_sms(phone: str, message: str) -> Tuple[bool, str]:
    """
    Send an arbitrary SMS (e.g. claim status notification).
    MSG91 generic SMS and Twilio both support freeform messages.
    """
    to = _e164(phone)
    provider = SMS_PROVIDER

    ok, err = await _dispatch(provider, to=to, message=message, otp=None, expire_min=None)

    if not ok and provider != "console":
        logger.warning("[SMS] Provider '%s' failed (%s) — falling back to console", provider, err)
        ok, err = await _send_console(to, message)

    return ok, err


async def _dispatch(
    provider: str,
    *,
    to: str,
    message: str,
    otp: str | None,
    expire_min: int | None,
) -> Tuple[bool, str]:
    if provider == "twilio":
        return await _send_twilio(to, message)
    if provider == "msg91":
        if otp:
            return await _send_msg91(to, otp, expire_min or 10)
        # MSG91 generic SMS (non-OTP)
        return await _send_twilio_or_msg91_generic(to, message)
    return await _send_console(to, message)


async def _send_twilio_or_msg91_generic(to: str, message: str) -> Tuple[bool, str]:
    """MSG91 doesn't have a simple freeform API; use Twilio for generic sends if available."""
    if all([TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM]):
        return await _send_twilio(to, message)
    return await _send_console(to, message)
