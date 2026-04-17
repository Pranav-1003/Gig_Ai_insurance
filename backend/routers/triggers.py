"""
Triggers Router — WebSocket + POST /trigger-event + GET /predict/{zone_key}
Real-time disruption system with 3-stage fraud detection + LSTM forecasting.

WebSocket broadcast strategy
─────────────────────────────
When REDIS_URL is set, broadcasts use Redis pub/sub so every Uvicorn worker
process (or multiple servers behind a load balancer) receives the message and
forwards it to the WebSocket connections it owns.

Without REDIS_URL the original in-process dict is used — perfectly fine for
single-worker dev/CI and zero-dependency local testing.

Redis quick-start:
  docker run -d -p 6379:6379 redis:7-alpine

.env:
  REDIS_URL=redis://localhost:6379/0
"""
import os
import json
import asyncio
import logging
import random
import string
from datetime import datetime, timedelta
from typing import Dict, Optional, Set

import httpx
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import (get_db, get_analytics_db, Claim, TriggerEvent, User, Policy,
                      LSTMPrediction, WorkerSession, AnalyticsSession)
from models.fraud_model import run_fraud_detection, _zone_label

router = APIRouter(tags=["triggers"])

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "")
_PUBSUB_CHANNEL = "guardian:ws_broadcast"


# ── WebSocket Connection Manager ──────────────────────────────────────────────

class ConnectionManager:
    """
    Manages WebSocket connections for this process.

    broadcast() either:
      • publishes to Redis (multi-worker / multi-server mode), OR
      • delivers directly to local connections (single-process dev mode).

    Redis path: a background subscriber task (started on first connect) listens
    on the shared channel and fans out to every local WebSocket.  This means
    all Uvicorn workers receive every broadcast regardless of which worker
    handled the trigger-event POST.
    """

    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self._redis_client = None          # aioredis client (publish)
        self._subscriber_task: Optional[asyncio.Task] = None

    # ── Redis helpers ─────────────────────────────────────────────────────────

    async def _get_redis(self):
        """Lazy-init a single aioredis client for publishing."""
        if self._redis_client is not None:
            return self._redis_client
        try:
            import redis.asyncio as aioredis   # redis>=4.2 ships this
            self._redis_client = aioredis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            await self._redis_client.ping()
            logger.info("[WS] Redis connection established: %s", REDIS_URL)
        except Exception as e:
            logger.warning("[WS] Redis unavailable (%s) — falling back to in-process broadcast", e)
            self._redis_client = None
        return self._redis_client

    async def _ensure_subscriber(self):
        """Start the background Redis subscriber task (once per process)."""
        if self._subscriber_task is not None and not self._subscriber_task.done():
            return
        self._subscriber_task = asyncio.create_task(self._redis_subscriber_loop())

    async def _redis_subscriber_loop(self):
        """
        Long-running coroutine: subscribes to the broadcast channel and
        delivers every message to all local WebSocket connections.
        Reconnects on transient errors with exponential back-off.
        """
        backoff = 1
        while True:
            try:
                import redis.asyncio as aioredis
                sub_client = aioredis.from_url(
                    REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True,
                )
                async with sub_client.pubsub() as pubsub:
                    await pubsub.subscribe(_PUBSUB_CHANNEL)
                    logger.info("[WS] Subscribed to Redis channel '%s'", _PUBSUB_CHANNEL)
                    backoff = 1   # reset on successful connect
                    async for message in pubsub.listen():
                        if message["type"] != "message":
                            continue
                        try:
                            data = json.loads(message["data"])
                        except json.JSONDecodeError:
                            continue
                        await self._deliver_local(data)
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.warning(
                    "[WS] Redis subscriber error (%s) — reconnecting in %ds", e, backoff
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    # ── Local delivery ────────────────────────────────────────────────────────

    async def _deliver_local(self, data: dict):
        """Fan out a message to every WebSocket connection on THIS process."""
        for uid in list(self.active_connections.keys()):
            dead: Set[WebSocket] = set()
            for ws in self.active_connections.get(uid, set()):
                try:
                    await ws.send_json(data)
                except Exception:
                    dead.add(ws)
            for ws in dead:
                self.active_connections[uid].discard(ws)

    # ── Public API ────────────────────────────────────────────────────────────

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)

        # Kick off the Redis subscriber the first time any client connects
        if REDIS_URL:
            await self._ensure_subscriber()

    def disconnect(self, websocket: WebSocket, user_id: str):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)

    async def send_to_user(self, user_id: str, data: dict):
        """Direct send to a single user's connections (local only)."""
        dead: Set[WebSocket] = set()
        for ws in self.active_connections.get(user_id, set()):
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active_connections[user_id].discard(ws)

    async def broadcast(self, data: dict):
        """
        Broadcast to ALL connected users.

        Redis mode  → publish to channel; every process (including this one)
                      receives via the subscriber loop.
        Local mode  → deliver directly to connections on this process.
        """
        if REDIS_URL:
            redis = await self._get_redis()
            if redis is not None:
                try:
                    await redis.publish(_PUBSUB_CHANNEL, json.dumps(data))
                    return
                except Exception as e:
                    logger.warning("[WS] Redis publish failed (%s) — falling back", e)
        # Fallback: in-process delivery only
        await self._deliver_local(data)


manager = ConnectionManager()

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
OPENWEATHER_BASE    = "https://api.openweathermap.org/data/2.5/weather"

ZONE_CITY_OW = {
    "chennai_north": "Chennai",  "chennai_south": "Chennai", "madurai": "Madurai",
    "coimbatore": "Coimbatore",  "tiruchirappalli": "Tiruchirappalli", "salem": "Salem",
    "tirunelveli": "Tirunelveli","vellore": "Vellore",  "erode": "Erode", "thoothukudi": "Thoothukudi",
    "mumbai_west": "Mumbai",     "mumbai_east": "Mumbai", "mumbai_central": "Mumbai",
    "thane": "Thane",            "navi_mumbai": "Navi Mumbai", "pune_central": "Pune", "pune_west": "Pune",
    "bangalore_north": "Bengaluru", "bangalore_south": "Bengaluru", "bangalore_east": "Bengaluru",
    "delhi_north": "Delhi",      "delhi_south": "Delhi", "gurgaon": "Gurugram", "noida": "Noida",
    "hyderabad_central": "Hyderabad", "hyderabad_west": "Hyderabad",
}

TRIGGER_AMOUNTS = {"rain": 500, "heat": 300, "app": 400, "curfew": 800, "closure": 350}
TRIGGER_LABELS  = {"rain": "Heavy Rainfall", "heat": "Heat Wave Alert",
                   "app": "Platform Downtime", "curfew": "Curfew / Strike", "closure": "Zone Closure"}
TRIGGER_ICONS   = {"rain": "🌧️", "heat": "🌡️", "app": "📵", "curfew": "🚫", "closure": "🏪"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _resolve_claim_tier(bcs_score: int, approved: bool) -> tuple:
    if not approved:
        return "rejected", "", "tier3"
    if bcs_score >= 60:
        return "paid", "3 hours", "tier1"
    elif bcs_score >= 35:
        return "processing", "6 hours", "tier2"
    else:
        return "review", "24 hours", "tier3"


async def _check_burst_throttle(db, zone_key: str) -> bool:
    window_start = datetime.utcnow() - timedelta(minutes=10)
    result = await db.execute(
        select(func.count(Claim.id)).where(
            Claim.zone == zone_key,
            Claim.timestamp >= window_start,
        )
    )
    return (result.scalar() or 0) > 10


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(websocket, user_id)
    try:
        await websocket.send_json({
            "type": "connected",
            "message": f"Guardian AI monitoring active for user {user_id}",
            "timestamp": datetime.utcnow().isoformat(),
        })
        while True:
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)


# ── Trigger event ─────────────────────────────────────────────────────────────

class TriggerRequest(BaseModel):
    trigger_type: str
    zone_key: str
    zone_label: str
    workers_affected: int = 1240
    severity: str = "high"
    simulated: bool = True
    user_id: Optional[int] = None


@router.post("/trigger-event")
async def fire_trigger(
    req: TriggerRequest,
    db: AsyncSession = Depends(get_db),
    analytics_db: AsyncSession = Depends(get_analytics_db),
):
    if req.trigger_type not in TRIGGER_AMOUNTS:
        raise HTTPException(status_code=422, detail=f"Unknown trigger type: {req.trigger_type}")

    amount = TRIGGER_AMOUNTS[req.trigger_type]
    label  = TRIGGER_LABELS[req.trigger_type]

    alert_sub_map = {
        "rain":    f"65mm rainfall in last 24h — threshold exceeded (50mm). Claim triggered for {req.workers_affected:,} workers.",
        "heat":    f"47°C + 78% humidity for 7 hours — heat wave confirmed. {req.workers_affected:,} workers affected.",
        "app":     f"Platform unavailable 38 mins — downtime threshold exceeded. {req.workers_affected:,} workers affected.",
        "curfew":  f"Official govt notice + traffic mobility ban confirmed. {req.workers_affected:,} workers affected.",
        "closure": f"42% restaurants closed for 6+ hours. {req.workers_affected:,} workers affected.",
    }
    alert_sub = alert_sub_map.get(req.trigger_type, "Disruption threshold exceeded.")

    # Store trigger in analytics DB
    trigger_evt = TriggerEvent(
        type=req.trigger_type, location=req.zone_label, severity=req.severity,
        value=65.0 if req.trigger_type == "rain" else 47.0,
        description=alert_sub, workers_affected=req.workers_affected,
        total_payout=amount * req.workers_affected, fired_at=datetime.utcnow(),
    )
    analytics_db.add(trigger_evt)
    await analytics_db.flush()

    # Determine primary user (requestor or demo)
    primary_user = None
    if req.user_id is not None:
        urow = await db.execute(select(User).where(User.id == req.user_id).limit(1))
        requested = urow.scalar_one_or_none()
        if requested:
            pol_chk = await db.execute(
                select(Policy).where(Policy.user_id == requested.id, Policy.status == "active").limit(1)
            )
            if pol_chk.scalar_one_or_none():
                primary_user = requested

    if primary_user is None:
        demo = await db.execute(select(User).where(User.phone == "9876543210").limit(1))
        primary_user = demo.scalar_one_or_none()

    fraud_result = None
    primary_claim_id = None

    if primary_user:
        claims_result = await db.execute(select(Claim).where(Claim.user_id == primary_user.id))
        user_claims = claims_result.scalars().all()

        pol_result = await db.execute(
            select(Policy).where(Policy.user_id == primary_user.id, Policy.status == "active")
            .order_by(Policy.created_at.desc()).limit(1)
        )
        active_policy = pol_result.scalar_one_or_none()

        if not active_policy:
            await db.commit()
            await analytics_db.commit()
            return {
                "status": "skipped", "reason": "No active policy.",
                "trigger_type": req.trigger_type, "zone": req.zone_label,
                "claim_id": None, "fraud_result": None,
            }

        # 48-hour waiting period check
        hours_since = (datetime.utcnow() - active_policy.created_at).total_seconds() / 3600
        in_waiting  = hours_since < 48

        # Duplicate claim check (same trigger + zone within 6h)
        six_hours_ago = datetime.utcnow() - timedelta(hours=6)
        dup = await db.execute(
            select(Claim).where(
                Claim.user_id == primary_user.id,
                Claim.trigger_type == req.trigger_type,
                Claim.zone == req.zone_key,   # zone stored as key
                Claim.timestamp >= six_hours_ago,
            )
        )
        existing = dup.scalar_one_or_none()
        if existing:
            await db.commit()
            await analytics_db.commit()
            return {
                "status": "duplicate",
                "reason": f"Duplicate claim blocked (ID: {existing.id}, Status: {existing.status}).",
                "existing_claim_id": existing.id, "existing_claim_status": existing.status,
                "trigger_type": req.trigger_type, "zone": req.zone_label,
                "claim_id": None, "fraud_result": None,
            }

        # Run fraud detection
        fraud_result = run_fraud_detection(
            user_zone_key=primary_user.zone_key or "chennai_north",
            trigger_zone_key=req.zone_key,
            trigger_type=req.trigger_type,
            user_claims_count=len(user_claims),
            user_tenure=primary_user.tenure or "mid",
        )

        if in_waiting:
            fraud_result.update({
                "approved": False, "stage1": "failed", "fraud_score": 0.0, "bcs_score": 0,
                "rejection_reason": "Claim rejected: 48-hour waiting period is still active.",
            })

        txn_id = "GRD" + datetime.utcnow().strftime("%Y%m%d%H%M%S") + str(random.randint(10, 99))
        bcs = fraud_result.get("bcs_score", 100)

        # Burst throttle — demote Tier-1 to Tier-2 when >10 claims in 10 min for
        # this zone. Log the demotion and record it on the claim so the worker
        # can see why their payout was delayed.
        in_burst = await _check_burst_throttle(db, req.zone_key)
        burst_note = ""
        if in_burst and fraud_result["approved"] and bcs >= 60:
            bcs = 55
            burst_note = (
                "Payout moved to Tier 2 (6-hour window): high claim volume detected "
                "in your zone. Your claim is valid and will be paid — processing time "
                "extended as a fraud-prevention measure during burst periods."
            )
            logger.warning(
                "burst_throttle_applied zone=%s user_id=%s original_bcs=%s new_bcs=55",
                req.zone_key, primary_user.id, fraud_result.get("bcs_score"),
            )

        status, payout_eta, tier = _resolve_claim_tier(bcs, fraud_result["approved"])
        fraud_result.update({
            "tier": tier,
            "payout_eta": payout_eta,
            "burst_throttled": in_burst,
            "burst_note": burst_note,
        })

        claim = Claim(
            user_id=primary_user.id,
            trigger_type=req.trigger_type, trigger_label=label, zone=req.zone_key,   # store key (not label) so burst-throttle query matches
            status=status, amount=amount,
            rejection_reason=burst_note if burst_note else fraud_result.get("rejection_reason", ""),
            fraud_stage1=fraud_result["stage1"], fraud_stage2=fraud_result["stage2"],
            fraud_stage3=fraud_result["stage3"],
            bcs_score=bcs, tier=tier,
            txn_id=txn_id if status == "paid" else "",
            timestamp=datetime.utcnow(),
        )
        db.add(claim)
        await db.flush()
        primary_claim_id = claim.id

    await db.commit()
    await analytics_db.commit()

    ws_event = {
        "type": "trigger_fired",
        "trigger": {
            "type": req.trigger_type, "label": label,
            "icon": TRIGGER_ICONS.get(req.trigger_type, "⚡"),
            "zone_key": req.zone_key, "zone_label": req.zone_label,
            "amount": amount, "workers_affected": req.workers_affected,
            "alert_title": f"{label} detected in {req.zone_label}",
            "alert_sub": alert_sub, "simulated": req.simulated,
        },
        "fraud": fraud_result,
        "claim_id": primary_claim_id,
        "timestamp": datetime.utcnow().isoformat(),
    }
    await manager.broadcast(ws_event)

    return {
        "status": "fired", "trigger_id": trigger_evt.id,
        "trigger_type": req.trigger_type, "zone": req.zone_label,
        "amount": amount, "workers_affected": req.workers_affected,
        "fraud_result": fraud_result, "claim_id": primary_claim_id,
        "ws_broadcast": "sent",
    }


# ── LSTM prediction endpoint ──────────────────────────────────────────────────

@router.get("/predict/{zone_key}")
async def get_lstm_prediction(
    zone_key: str,
    analytics_db: AsyncSession = Depends(get_analytics_db),
):
    """
    Run LSTM model to forecast 48h-ahead disruption risk for a zone.
    Stores result in analytics DB for audit trail.
    """
    try:
        from models.lstm_model import predict_zone_risk
        result = predict_zone_risk(zone_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LSTM inference failed: {e}")

    # Store highest-risk prediction in DB for analytics.
    # A write failure must not break the inference response, but it must be
    # logged so a broken analytics DB is caught before data gaps accumulate.
    try:
        top_type = max(result["predictions"], key=lambda t: result["predictions"][t]["risk_score"])
        top_pred = result["predictions"][top_type]
        pred_row = LSTMPrediction(
            zone_key=zone_key,
            trigger_type=top_type,
            risk_score=top_pred["risk_score"],
            risk_label=top_pred["risk_label"],
            confidence=top_pred["confidence"],
            feature_vector=list(result["predictions"].values()),
            forecast_window="48h",
        )
        analytics_db.add(pred_row)
        await analytics_db.commit()
    except Exception as e:
        # Roll back so the session stays usable on the next request.
        try:
            await analytics_db.rollback()
        except Exception:
            pass
        logger.error(
            "lstm_prediction_db_write_failed zone_key=%s error=%s",
            zone_key, e, exc_info=True,
        )

    return result


# ── Weather endpoint ──────────────────────────────────────────────────────────

@router.get("/weather/{zone_key}")
async def get_weather(zone_key: str):
    if not OPENWEATHER_API_KEY or OPENWEATHER_API_KEY in ("", "YOUR_OPENWEATHERMAP_API_KEY_HERE"):
        return _mock_weather(zone_key)

    city = ZONE_CITY_OW.get(zone_key, "Chennai")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                OPENWEATHER_BASE,
                params={"q": f"{city},IN", "appid": OPENWEATHER_API_KEY, "units": "metric"},
            )
            if resp.status_code != 200:
                return _mock_weather(zone_key)
            data = resp.json()
            temp     = data["main"]["temp"]
            humidity = data["main"]["humidity"]
            rain_3h  = data.get("rain", {}).get("3h", None)
            rain_1h  = data.get("rain", {}).get("1h", 0)
            if rain_3h is not None:
                rain_display  = round(rain_3h, 1)
                rain_triggered = rain_3h >= 6.25
                rain_source    = "3h accumulated"
            else:
                rain_display  = round(rain_1h, 1)
                rain_triggered = rain_1h >= 10.0
                rain_source    = "1h accumulated"
            return {
                "city": city, "zone_key": zone_key,
                "temperature": round(temp, 1), "humidity": humidity,
                "weather": data["weather"][0]["main"],
                "description": data["weather"][0]["description"].title(),
                "rain_mm": rain_display, "rain_source": rain_source,
                "wind_kph": round(data.get("wind", {}).get("speed", 0) * 3.6, 1),
                "rain_threshold": 50, "heat_threshold_temp": 45, "heat_threshold_humidity": 70,
                "rain_triggered": rain_triggered, "heat_triggered": temp > 45 and humidity > 70,
                "source": "OpenWeatherMap Live",
                "fetched_at": datetime.utcnow().isoformat(),
            }
    except Exception as e:
        return {**_mock_weather(zone_key), "error": str(e), "source": "Mock (API error)"}


def _mock_weather(zone_key: str) -> dict:
    temps = {
        "chennai_north": 36, "chennai_south": 35, "madurai": 42, "coimbatore": 32,
        "tiruchirappalli": 40, "salem": 38, "tirunelveli": 41, "vellore": 37,
        "erode": 35, "thoothukudi": 38, "mumbai_west": 32, "mumbai_east": 33,
        "mumbai_central": 33, "thane": 34, "navi_mumbai": 33, "pune_central": 35,
        "pune_west": 34, "bangalore_north": 28, "bangalore_south": 27, "bangalore_east": 29,
        "delhi_north": 40, "delhi_south": 39, "gurgaon": 40, "noida": 41,
        "hyderabad_central": 38, "hyderabad_west": 37,
    }
    temp     = temps.get(zone_key, 36) + random.uniform(-2, 2)
    humidity = random.randint(60, 78)
    rain_3h  = round(random.uniform(0, 5), 1)
    return {
        "city": ZONE_CITY_OW.get(zone_key, "Chennai"), "zone_key": zone_key,
        "temperature": round(temp, 1), "humidity": humidity,
        "weather": "Partly Cloudy", "description": "Partly Cloudy",
        "rain_mm": rain_3h, "rain_source": "3h accumulated (mock)",
        "wind_kph": round(random.uniform(10, 25), 1),
        "rain_threshold": 50, "heat_threshold_temp": 45, "heat_threshold_humidity": 70,
        "rain_triggered": rain_3h >= 6.25, "heat_triggered": temp > 45 and humidity > 70,
        "source": "Mock Data (API key pending)", "fetched_at": datetime.utcnow().isoformat(),
    }
