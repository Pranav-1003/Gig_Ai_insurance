"""Claims Router — GET /claims/{user_id} (JWT required)"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db, Claim, User
from routers.auth import get_current_worker

router = APIRouter(prefix="/claims", tags=["claims"])

_TRIGGER_ICONS = {
    "rain":    "🌧️",
    "heat":    "🌡️",
    "app":     "📵",
    "curfew":  "🚫",
    "closure": "🏪",
}

@router.get("/{user_id}")
async def get_claims(
    user_id: int,
    current_user: User = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(Claim).where(Claim.user_id == user_id).order_by(Claim.timestamp.desc())
    )
    claims = result.scalars().all()
    return [
        {
            "id": c.id, "trigger_type": c.trigger_type, "trigger_label": c.trigger_label,
            "icon": _TRIGGER_ICONS.get(c.trigger_type, "⚡"),
            "zone": c.zone, "status": c.status, "amount": c.amount,
            "rejection_reason": c.rejection_reason,
            "fraud_stage1": c.fraud_stage1, "fraud_stage2": c.fraud_stage2, "fraud_stage3": c.fraud_stage3,
            "bcs_score": c.bcs_score, "tier": c.tier,
            "txn_id": c.txn_id,
            "timestamp": c.timestamp.strftime("%d %b %Y, %I:%M %p"),
        }
        for c in claims
    ]
