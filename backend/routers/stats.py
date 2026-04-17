"""
Stats + Analytics Router
GET /stats      → landing page live numbers (public)
GET /analytics  → insurer analytics dashboard (admin JWT required)
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta

from database import get_db, User, Policy, Claim
from models.premium_model import analytics_zone_breakdown_registration_zones
from routers.auth import get_current_admin

router  = APIRouter(tags=["stats"])
logger  = logging.getLogger(__name__)

_ANALYTICS_PAGE_SIZE = 500   # max rows loaded per DB round-trip


@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    users_count   = await db.execute(select(func.count(User.id)))
    total_users   = users_count.scalar() or 0

    pol_count     = await db.execute(select(func.count(Policy.id)).where(Policy.status == "active"))
    active_policies = pol_count.scalar() or 0

    since_24h     = datetime.utcnow() - timedelta(hours=24)
    payouts_24h   = await db.execute(
        select(func.sum(Claim.amount)).where(Claim.timestamp >= since_24h, Claim.status == "paid")
    )
    total_payouts = payouts_24h.scalar() or 0

    all_cnt       = await db.execute(select(func.count(Claim.id)))
    total_claims  = all_cnt.scalar() or 0

    recent_claims_list = await db.execute(select(Claim).order_by(Claim.timestamp.desc()).limit(3))
    rc_list = recent_claims_list.scalars().all()
    ticker_items = []
    for c in rc_list:
        dot     = "green" if c.status == "paid" else "amber" if c.status == "processing" else "red"
        amt_txt = f" — ₹{c.amount} payout" if c.status == "paid" else ""
        ticker_items.append({"dot": dot, "text": f"{c.trigger_label} in {c.zone}{amt_txt}"})
    if not ticker_items:
        ticker_items.append({"dot": "green", "text": "Guardian AI monitoring all active zones."})

    return {
        "workers_protected": total_users,
        "claims_processed": total_claims,
        "payouts_24h": int(total_payouts),
        "active_policies": active_policies,
        "ticker_items": ticker_items,
    }


@router.get("/analytics")
async def get_analytics(
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    pol_count = await db.execute(select(func.count(Policy.id)).where(Policy.status == "active"))
    active_policies = pol_count.scalar() or 0

    # ── Aggregate counts/sums entirely in the DB — never load all rows into memory ──

    # Total, paid, rejected counts + paid sum
    total_claims_r  = await db.execute(select(func.count(Claim.id)))
    total_claims_n  = total_claims_r.scalar() or 0

    paid_count_r    = await db.execute(
        select(func.count(Claim.id)).where(Claim.status == "paid")
    )
    paid_count_n    = paid_count_r.scalar() or 0

    rejected_count_r = await db.execute(
        select(func.count(Claim.id)).where(Claim.status == "rejected")
    )
    rejected_count_n = rejected_count_r.scalar() or 0

    total_paid_r    = await db.execute(
        select(func.coalesce(func.sum(Claim.amount), 0)).where(Claim.status == "paid")
    )
    total_paid      = float(total_paid_r.scalar() or 0)

    fraud_rate      = (rejected_count_n / max(total_claims_n, 1)) * 100

    # Per-type counts for the pie chart (DB GROUP BY — one round-trip)
    type_rows = await db.execute(
        select(Claim.trigger_type, func.count(Claim.id))
        .where(Claim.status == "paid")
        .group_by(Claim.trigger_type)
    )
    type_counts = {row[0]: row[1] for row in type_rows.all()}

    chart_labels = ["Rain", "Heat Wave", "App Down", "Curfew", "Zone Closure"]
    chart_data   = [type_counts.get(t, 0) for t in ["rain", "heat", "app", "curfew", "closure"]]

    # Weekly paid-claim counts (7 DB queries, each counts a 1-week window)
    weekly_labels, weekly_data = [], []
    for i in range(6, -1, -1):
        w_start = datetime.utcnow() - timedelta(weeks=i + 1)
        w_end   = datetime.utcnow() - timedelta(weeks=i)
        weekly_labels.append(w_start.strftime("%b %d"))
        wk_r = await db.execute(
            select(func.count(Claim.id)).where(
                Claim.status == "paid",
                Claim.timestamp >= w_start,
                Claim.timestamp <= w_end,
            )
        )
        weekly_data.append(wk_r.scalar() or 0)

    zone_breakdown = analytics_zone_breakdown_registration_zones()

    # Latest paid claim for the predictive alert (fetch 1 row, not all)
    predictive_alerts = []
    latest_r = await db.execute(
        select(Claim)
        .where(Claim.status == "paid")
        .order_by(Claim.timestamp.desc())
        .limit(1)
    )
    latest = latest_r.scalar_one_or_none()
    if latest:
        predictive_alerts.append({
            "type": "warning", "icon": "🤖",
            "title": f"Recent {latest.trigger_label} activity in {latest.zone}",
            "detail": "Algorithm monitoring localized risk. Further automated resolutions expected.",
        })

    return {
        "metrics": {
            "active_policies": active_policies,
            "premiums_collected": f"₹{active_policies * 75:,}",
            "fraud_rate": round(fraud_rate, 1),
            "claims_paid": f"₹{int(total_paid):,}",
            "claims_paid_count": paid_count_n,
            "auto_approval": f"{100 - fraud_rate:.1f}%" if total_claims_n else "0%",
            "loss_ratio": (
                f"{round((total_paid / (active_policies * 75)) * 100, 1)}%"
                if active_policies > 0 and total_paid > 0 else "N/A"
            ),
        },
        "chart": {
            "labels": chart_labels, "data": chart_data,
            "weekly_labels": weekly_labels, "weekly_data": weekly_data,
        },
        "zone_breakdown": zone_breakdown,
        "predictive_alerts": predictive_alerts,
    }
