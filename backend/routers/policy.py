"""
Policy Router — create, get dashboard, cancel policy.
All endpoints require a valid worker JWT.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import random
import string

from database import get_db, User, Policy, Claim
from routers.auth import get_current_worker

logger = logging.getLogger(__name__)
_MAX_POLICY_NUMBER_RETRIES = 5
from routers.triggers import get_weather

router = APIRouter(prefix="/policy", tags=["policy"])


class CreatePolicyRequest(BaseModel):
    user_id: int
    premium: float
    zone: str
    zone_key: str
    risk_score: int
    max_payout: float
    payment_method: str = "upi"
    upi_id: Optional[str] = ""
    payment_id: Optional[str] = None


@router.post("/create")
async def create_policy(
    req: CreatePolicyRequest,
    current_user: User = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    # Workers can only create policies for themselves
    if current_user.id != req.user_id:
        raise HTTPException(status_code=403, detail="Cannot create policy for another user")

    # Use payment_id from request or fall back to simulated ID (legacy path — prefer /payment/verify)
    payment_id = req.payment_id if req.payment_id else f"pay_sim_{random.randint(100000, 999999)}"

    return await _create_policy_record(
        db=db,
        user_id=req.user_id,
        premium=req.premium,
        zone=req.zone,
        zone_key=req.zone_key,
        risk_score=req.risk_score,
        max_payout=req.max_payout,
        payment_method=req.payment_method,
        upi_id=req.upi_id,
        payment_id=payment_id,
    )


async def _create_policy_record(
    db,
    user_id: int,
    premium: float,
    zone: str,
    zone_key: str,
    risk_score: int,
    max_payout: float,
    payment_method: str = "upi",
    upi_id: str = "",
    payment_id: str = "",
) -> dict:
    """
    Shared helper used by both POST /policy/create (legacy) and POST /payment/verify (Razorpay).
    Creates policy row with retry on policy_number collision. Returns the policy response dict.
    """
    valid_until   = datetime.utcnow() + timedelta(days=7)
    waiting_until = datetime.utcnow() + timedelta(hours=48)

    if upi_id:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            user.upi_id   = upi_id
            user.zone     = zone
            user.zone_key = zone_key

    COVERAGE_EXCLUSIONS = [
        "Self-caused disruptions or negligence",
        "Disruptions outside registered zone",
        "Claims within 48-hour waiting period after activation",
        "More than 8 claims per rolling 30-day window",
        "Events not meeting minimum threshold (e.g. rainfall < 50mm)",
    ]

    policy = None
    for attempt in range(1, _MAX_POLICY_NUMBER_RETRIES + 1):
        suffix        = "".join(random.choices(string.digits, k=4))
        policy_number = f"GRD-{datetime.utcnow().year}-{suffix}"
        policy = Policy(
            user_id=user_id, policy_number=policy_number, premium=premium,
            status="active", zone=zone, zone_key=zone_key,
            risk_score=risk_score, max_payout=max_payout,
            valid_until=valid_until, payment_method=payment_method,
            payment_id=payment_id,
        )
        db.add(policy)
        try:
            await db.commit()
            await db.refresh(policy)
            break
        except IntegrityError:
            await db.rollback()
            logger.warning(
                "policy_number_collision policy_number=%s attempt=%d/%d",
                policy_number, attempt, _MAX_POLICY_NUMBER_RETRIES,
            )
            policy = None
            if attempt == _MAX_POLICY_NUMBER_RETRIES:
                logger.error(
                    "policy_number_exhausted after %d attempts for user_id=%s",
                    _MAX_POLICY_NUMBER_RETRIES, user_id,
                )
                raise HTTPException(
                    status_code=500,
                    detail="Could not generate a unique policy number. Please try again.",
                )

    return {
        "policy_id": policy.id, "policy_number": policy_number,
        "premium": policy.premium, "zone": policy.zone,
        "max_payout": policy.max_payout,
        "valid_until": valid_until.strftime("%d %b %Y"),
        "status": "active",
        "waiting_period_ends": waiting_until.strftime("%d %b %Y, %I:%M %p UTC"),
        "coverage_exclusions": COVERAGE_EXCLUSIONS,
        "max_claims_per_month": 8,
    }


@router.get("/dashboard/{user_id}")
async def get_dashboard(
    user_id: int,
    current_user: User = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    pol_result = await db.execute(
        select(Policy).where(Policy.user_id == user_id, Policy.status == "active")
        .order_by(Policy.created_at.desc()).limit(1)
    )
    policy = pol_result.scalar_one_or_none()

    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)
    claims_result = await db.execute(
        select(Claim).where(Claim.user_id == user_id, Claim.timestamp >= month_start)
    )
    monthly_claims = claims_result.scalars().all()
    paid_claims     = [c for c in monthly_claims if c.status == "paid"]
    total_protected = sum(c.amount for c in paid_claims)

    next_renewal = policy.valid_until if policy else datetime.utcnow() + timedelta(days=7)
    total_monthly = len(monthly_claims)
    auto_appr = int((len(paid_claims) / total_monthly) * 100) if total_monthly > 0 else 0

    zone_key = user.zone_key or "chennai_north"
    zone_status = await _get_zone_status_async(zone_key)

    return {
        "user": {
            "id": user.id, "name": user.name, "phone": user.phone,
            "upi_id": user.upi_id, "zone": user.zone, "zone_key": user.zone_key,
            "platform": user.platform,
        },
        "policy": {
            "id": policy.id, "policy_number": policy.policy_number,
            "premium": policy.premium, "status": policy.status,
            "zone": policy.zone, "max_payout": policy.max_payout,
            "valid_until": policy.valid_until.strftime("%d %b %Y"),
            "risk_score": policy.risk_score,
        } if policy else None,
        "metrics": {
            "total_protected_month": total_protected,
            "claims_paid_month": len(paid_claims),
            "next_premium": policy.premium if policy else 75,
            "next_renewal": next_renewal.strftime("%d %b %Y"),
            "auto_approval_rate": f"{auto_appr}%",
        },
        "zone_status": zone_status,
    }


@router.patch("/{policy_id}/cancel")
async def cancel_policy(
    policy_id: int,
    current_user: User = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    if policy.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    policy.status = "cancelled"
    await db.commit()
    return {"message": "Policy cancelled. Coverage ends at the end of the term.", "status": "cancelled"}


async def _get_zone_status_async(zone_key: str) -> list:
    try:
        weather_data = await get_weather(zone_key)
        # Fix: use correct field names from weather response
        rain_mm = weather_data.get("rain_mm", 0)
        temp_c  = weather_data.get("temperature", 38)

        rain_badge = "red" if rain_mm > 50 else "amber" if rain_mm > 20 else "green"
        heat_badge = "red" if temp_c > 45 else "amber" if temp_c > 40 else "green"

        return [
            {"type": "rain", "icon": "🌧️", "label": "Rainfall",
             "status": "Safe" if rain_badge == "green" else "Warning" if rain_badge == "amber" else "Critical",
             "current": f"{rain_mm}mm", "threshold": "50mm", "badge": rain_badge},
            {"type": "heat", "icon": "🌡️", "label": "Temperature",
             "status": "Safe" if heat_badge == "green" else "Warning" if heat_badge == "amber" else "Critical",
             "current": f"{temp_c}°C", "threshold": "45°C", "badge": heat_badge},
            {"type": "app", "icon": "📵", "label": "Platform Status",
             "status": "Online", "current": "All systems operational",
             "threshold": "30 min downtime", "badge": "green"},
        ]
    except Exception:
        return [
            {"type": "rain", "icon": "🌧️", "label": "Rainfall",
             "status": "No Data", "current": "Unavailable", "threshold": "50mm", "badge": "amber"},
            {"type": "heat", "icon": "🌡️", "label": "Temperature",
             "status": "No Data", "current": "Unavailable", "threshold": "45°C", "badge": "amber"},
            {"type": "app", "icon": "📵", "label": "Platform Status",
             "status": "Online", "current": "Systems operational", "threshold": "30 min downtime", "badge": "green"},
        ]
