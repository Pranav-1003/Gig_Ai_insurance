"""
Isolation Forest Fraud Detection — 3-stage claim validation.
Loads pre-trained model from fraud_model.pkl (same directory).
Falls back to heuristics if pkl is missing.
"""
import os
import pickle
import numpy as np
from pathlib import Path

_MODEL_PATH = Path(__file__).parent / "fraud_model.pkl"

# ── Module-level RNG (seeded once at import time) ──────────────────────────────
# A single shared Generator keeps behaviour deterministic within a process and
# makes unit tests reproducible by patching _rng or seeding via FRAUD_RNG_SEED.
_rng = np.random.default_rng(
    int(os.getenv("FRAUD_RNG_SEED", "0")) or None  # None → random seed (default)
)

# ── Load from pkl ──────────────────────────────────────────────────────────────
_iso_model     = None
_scaler        = None
_score_min     = -0.09
_score_max     =  0.20
_use_isolation = False

try:
    with open(_MODEL_PATH, "rb") as f:
        _bundle = pickle.load(f)
    _iso_model     = _bundle["model"]
    _scaler        = _bundle["scaler"]
    _score_min     = _bundle["score_min"]
    _score_max     = _bundle["score_max"]
    _use_isolation = True
    print(f"[fraud_model] Loaded from {_MODEL_PATH}")
except Exception as e:
    print(f"[fraud_model] Could not load pkl, using heuristics: {e}")


# ── Feature builder ────────────────────────────────────────────────────────────

def _build_fraud_features(user_claims_count, user_tenure, zone_match,
                           trigger_type, hour_of_day=12):
    tenure_map       = {"new": 3.0, "mid": 12.0, "senior": 30.0}
    trigger_freq_map = {"rain": 0.55, "heat": 0.40, "app": 0.50,
                        "curfew": 0.20, "closure": 0.35}
    tenure_months    = tenure_map.get(user_tenure, 12.0)
    trigger_freq     = trigger_freq_map.get(trigger_type, 0.45)
    claims_per_month = user_claims_count / max(tenure_months, 1) * 30
    inter_claim_days = 30.0 / max(claims_per_month, 0.1)
    return np.array([
        claims_per_month, tenure_months, float(zone_match),
        trigger_freq, float(np.clip(inter_claim_days, 0.5, 60)),
        float(hour_of_day),
    ], dtype=np.float32)


# ── Score helpers ──────────────────────────────────────────────────────────────

def _isolation_forest_score(user_claims_count, user_tenure, trigger_type,
                             zone_match, hour_of_day=12):
    feats = _build_fraud_features(
        user_claims_count, user_tenure, zone_match, trigger_type, hour_of_day
    ).reshape(1, -1)

    if _use_isolation:
        feats_scaled = _scaler.transform(feats)
        raw_score    = float(_iso_model.decision_function(feats_scaled)[0])
        return float(np.clip(
            (_score_max - raw_score) / (_score_max - _score_min + 1e-9),
            0.0, 1.0
        ))

    # Heuristic fallback
    score = 0.0
    if user_claims_count > 20:   score += 0.40
    elif user_claims_count > 10: score += 0.20
    elif user_claims_count > 5:  score += 0.10
    if user_tenure == "new" and user_claims_count > 3:
        score += 0.30
    return float(np.clip(score, 0.0, 1.0))


def _gps_spoof_check(user_zone, trigger_zone, user_tenure):
    if user_zone != trigger_zone:
        return 0.95
    base = {"senior": 0.05, "mid": 0.10, "new": 0.20}.get(user_tenure, 0.10)
    return float(np.clip(base + _rng.uniform(0, 0.05), 0.0, 1.0))


def _zone_label(zone_key):
    labels = {
        "chennai_north": "Chennai North", "chennai_south": "Chennai South",
        "madurai": "Madurai", "coimbatore": "Coimbatore",
        "tiruchirappalli": "Tiruchirappalli", "salem": "Salem",
        "tirunelveli": "Tirunelveli", "vellore": "Vellore",
        "erode": "Erode", "thoothukudi": "Thoothukudi",
        "mumbai_west": "Mumbai West", "mumbai_east": "Mumbai East",
        "mumbai_central": "Mumbai Central", "thane": "Thane",
        "navi_mumbai": "Navi Mumbai", "pune_central": "Pune Central",
        "pune_west": "Pune West",
        "bangalore_north": "Bangalore North", "bangalore_south": "Bangalore South",
        "bangalore_east": "Bangalore East",
        "delhi_north": "Delhi North", "delhi_south": "Delhi South",
        "gurgaon": "Gurgaon", "noida": "Noida",
        "hyderabad_central": "Hyderabad Central", "hyderabad_west": "Hyderabad West",
    }
    return labels.get(zone_key, zone_key.replace("_", " ").title())


# ── Public API ─────────────────────────────────────────────────────────────────

def run_fraud_detection(user_zone_key, trigger_zone_key, trigger_type,
                        user_claims_count=0, user_tenure="mid", hour_of_day=12):
    result = {
        "stage1": "pending", "stage2": "pending", "stage3": "pending",
        "approved": False, "rejection_reason": "", "fraud_score": 0.0,
        "bcs_score": 100,
        "model": "IsolationForest (pkl)" if _use_isolation else "Heuristic fallback",
    }

    zone_match = user_zone_key.lower() == trigger_zone_key.lower()

    # Stage 1: zone check
    if not zone_match:
        result.update({
            "stage1": "passed", "stage2": "checking", "stage3": "failed",
            "fraud_score": 0.85, "bcs_score": 20,
            "rejection_reason": (
                f"Zone mismatch — your policy covers {_zone_label(user_zone_key)} only. "
                f"The disruption occurred in {_zone_label(trigger_zone_key)}, "
                f"which is outside your coverage boundary."
            ),
        })
        return result

    result["stage1"] = "passed"

    # Stage 2: IsolationForest
    anomaly_score = _isolation_forest_score(
        user_claims_count, user_tenure, trigger_type, zone_match, hour_of_day
    )
    result["fraud_score"] = round(anomaly_score, 4)

    if anomaly_score > 0.72:
        result.update({
            "stage2": "failed", "stage3": "pending",
            "bcs_score": int((1 - anomaly_score) * 60),
            "rejection_reason": (
                "ML anomaly detection flagged this claim. "
                "Unusual claim frequency or behavioural pattern detected. "
                "Claim routed to human review queue."
            ),
        })
        return result

    result["stage2"] = "passed"

    # Stage 3: GPS spoof
    spoof_score = _gps_spoof_check(user_zone_key, trigger_zone_key, user_tenure)
    if spoof_score > 0.70:
        result.update({
            "stage3": "failed",
            "bcs_score": int((1 - spoof_score) * 50),
            "rejection_reason": (
                "GPS validation failed. Device location does not consistently "
                "show presence in the claimed zone during event window. "
                "Possible GPS spoofing detected."
            ),
        })
        return result

    result.update({
        "stage3": "passed", "approved": True,
        "bcs_score": int(85 + _rng.uniform(0, 15)),
    })
    return result
