"""
Premium Router — GET /premium
Returns dynamic premium from XGBoost model.
"""
from fastapi import APIRouter, Query
from models.premium_model import calculate_premium_xgboost

router = APIRouter(prefix="/premium", tags=["premium"])


@router.get("")
async def get_premium(
    zone: str = Query(..., description="Zone key e.g. chennai_north"),
    earnings: float = Query(4500, description="Weekly earnings in INR"),
    tenure: str = Query("mid", description="new | mid | senior"),
    platform: str = Query("zomato", description="Delivery platform"),
):
    result = calculate_premium_xgboost(
        zone_key=zone,
        weekly_earnings=earnings,
        tenure=tenure,
        platform=platform,
    )
    return result
