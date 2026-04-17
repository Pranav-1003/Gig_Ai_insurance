"""
XGBoost Premium Calculator
Loads pre-trained model from premium_model.pkl (same directory).
Falls back to rule-based calculation if pkl is missing.
"""
import pickle
import numpy as np
from datetime import datetime
from pathlib import Path

_MODEL_PATH = Path(__file__).parent / "premium_model.pkl"

# ── Zone metadata ──────────────────────────────────────────────────────────────
ZONE_RISK = {
    # Chennai
    "chennai_north_central": 72, "chennai_north_suburban": 48,
    "chennai_south_central": 65, "chennai_south_coastal": 85,
    "chennai_west": 44,
    # Madurai
    "madurai_central": 55, "madurai_north": 38, "madurai_south": 42,
    # Coimbatore
    "coimbatore_urban": 35, "coimbatore_periurban": 50,
    # Trichy
    "trichy_central": 60, "trichy_south": 52,
    # Salem
    "salem_urban": 40, "salem_suburban": 30,
    # Tirunelveli
    "tirunelveli_central": 58, "tirunelveli_rural": 45,
    # Vellore
    "vellore_central": 36, "vellore_suburban": 28,
    # Erode
    "erode_urban": 46, "erode_periurban": 38,
    # Thoothukudi
    "thoothukudi_port": 70, "thoothukudi_inland": 42,
    # Maharashtra — Mumbai monsoon risk is very high
    "mumbai_west": 88, "mumbai_east": 85, "mumbai_central": 90,
    "thane": 82, "navi_mumbai": 75,
    "pune_central": 60, "pune_west": 55,
    # Karnataka
    "bangalore_north": 50, "bangalore_south": 48, "bangalore_east": 52,
    # Delhi NCR — heat wave risk dominant
    "delhi_north": 72, "delhi_south": 70, "gurgaon": 65, "noida": 68,
    # Telangana
    "hyderabad_central": 62, "hyderabad_west": 58,
}
ZONE_LABELS = {k: k.replace("_", " ").title() for k in ZONE_RISK}
ZONE_LABELS.update({
    "chennai_north_central": "Chennai – North Central (Tondiarpet / Basin Bridge)",
    "chennai_north_suburban": "Chennai – North Suburban (Ambattur / Avadi)",
    "chennai_south_central": "Chennai – South Central (T.Nagar / Adyar)",
    "chennai_south_coastal": "Chennai – South Coastal (Velachery / Sholinganallur)",
    "chennai_west": "Chennai – West (Porur / Vadapalani)",
    "madurai_central": "Madurai – Central (Avaniyapuram / Goripalayam)",
    "madurai_north": "Madurai – North (Melur / Thirumangalam)",
    "madurai_south": "Madurai – South (Sholavandan / Usilampatti)",
    "coimbatore_urban": "Coimbatore – Urban Core (RS Puram / Gandhipuram)",
    "coimbatore_periurban": "Coimbatore – Peri-Urban (Kuniyamuthur / Singanallur)",
    "trichy_central": "Trichy – Central (Srirangam / Ariyamangalam)",
    "trichy_south": "Trichy – South (Thillai Nagar / Woraiyur)",
    "salem_urban": "Salem – Urban (Shevapet / Hasthampatti)",
    "salem_suburban": "Salem – Suburban (Attur / Sankagiri)",
    "tirunelveli_central": "Tirunelveli – Central (Palayamkottai / Melapalayam)",
    "tirunelveli_rural": "Tirunelveli – Rural (Nanguneri / Tenkasi)",
    "vellore_central": "Vellore – Central (Katpadi / Gandhi Nagar)",
    "vellore_suburban": "Vellore – Suburban (Gudiyatham / Vaniyambadi)",
    "erode_urban": "Erode – Urban (Erode Town / Chithode)",
    "erode_periurban": "Erode – Peri-Urban (Perundurai / Bhavani)",
    "thoothukudi_port": "Thoothukudi – Port Area (Harbour / Sipcot)",
    "thoothukudi_inland": "Thoothukudi – Inland (Kovilpatti / Ottapidaram)",
})

# Must match `Register.jsx` zone dropdown (order + keys)
REGISTER_ZONE_KEYS = (
    "chennai_north_central", "chennai_north_suburban", "chennai_south_central",
    "chennai_south_coastal", "chennai_west",
    "madurai_central", "madurai_north", "madurai_south",
    "coimbatore_urban", "coimbatore_periurban",
    "trichy_central", "trichy_south",
    "salem_urban", "salem_suburban",
    "tirunelveli_central", "tirunelveli_rural",
    "vellore_central", "vellore_suburban",
    "erode_urban", "erode_periurban",
    "thoothukudi_port", "thoothukudi_inland",
)

TENURE_MAP    = {"new": 3, "mid": 12, "senior": 30}
PLATFORM_RISK = {"zomato": 0, "swiggy": 1, "amazon": -3, "zepto": 2, "dunzo": 3}

# ── Load from pkl ──────────────────────────────────────────────────────────────
_xgb_model   = None
_use_xgboost = False

try:
    with open(_MODEL_PATH, "rb") as f:
        _xgb_model = pickle.load(f)
    _use_xgboost = True
    print(f"[premium_model] Loaded from {_MODEL_PATH}")
except Exception as e:
    print(f"[premium_model] Could not load pkl, using rule-based fallback: {e}")


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_season_factor():
    month = datetime.utcnow().month
    if month in [6, 7, 8, 9]:   return 1.20
    elif month in [10, 11]:      return 1.10
    elif month in [3, 4, 5]:     return 1.05
    return 0.95


def _build_features(zone_key, weekly_earnings, tenure, platform, season_factor):
    zone_risk     = ZONE_RISK.get(zone_key, 60)
    tenure_months = TENURE_MAP.get(tenure, 12)
    plat_risk     = PLATFORM_RISK.get(platform, 0)
    return np.array([
        zone_risk / 100.0,
        min(weekly_earnings, 10_000) / 10_000.0,
        tenure_months / 36.0,
        season_factor,
        (plat_risk + 5) / 10.0,
        float(tenure == "new"),
        float(tenure == "senior"),
        float(weekly_earnings >= 6500),
        float(weekly_earnings <= 3500),
        float(zone_risk > 70),
        (zone_risk / 100.0) * season_factor,
        (tenure_months / 36.0) * (min(weekly_earnings, 10_000) / 10_000.0),
    ], dtype=np.float32)


# ── Public API ─────────────────────────────────────────────────────────────────

def calculate_premium_xgboost(zone_key, weekly_earnings, tenure, platform="zomato"):
    zone_risk     = ZONE_RISK.get(zone_key, 60)
    tenure_months = TENURE_MAP.get(tenure, 12)
    season_factor = get_season_factor()
    zone_label    = ZONE_LABELS.get(zone_key, zone_key)

    risk_label = ("Very High" if zone_risk > 80 else "High" if zone_risk > 70
                  else "Medium-High" if zone_risk > 60 else "Medium" if zone_risk > 50
                  else "Low")

    if _use_xgboost:
        feats       = _build_features(zone_key, weekly_earnings, tenure, platform, season_factor).reshape(1, -1)
        raw_premium = float(_xgb_model.predict(feats)[0])
        model_tag   = "XGBoost (pkl)"
    else:
        raw_premium  = 75.0 + max(0, (zone_risk - 50) * 0.5)
        raw_premium *= season_factor
        raw_premium -= max(0, (tenure_months - 6) * 0.15)
        raw_premium += PLATFORM_RISK.get(platform, 0)
        if weekly_earnings >= 6500: raw_premium -= 5
        elif weekly_earnings <= 3500: raw_premium += 3
        model_tag = "Rule-based fallback"

    final_premium = int(round(float(np.clip(raw_premium, 65, 120))))
    risk_score    = int(np.clip(zone_risk * 0.45 + (season_factor - 0.9) / 0.3 * 20
                                + (3 - tenure_months / 10) * 5
                                + PLATFORM_RISK.get(platform, 0), 20, 95))
    tenure_note   = {"new": "new-partner risk factor", "mid": "standard tenure",
                     "senior": "senior loyalty discount"}.get(tenure, "standard tenure")

    return {
        "premium":        final_premium,
        "risk_score":     risk_score,
        "risk_label":     risk_label,
        "max_payout":     round(final_premium * 2350 / 75),
        "annual_value":   final_premium * 52,
        "zone_label":     zone_label,
        "zone_risk_raw":  zone_risk,
        "ai_explanation": (f"{model_tag}: {zone_label} flood-risk {zone_risk}/100 "
                           f"+ {tenure_note}. Season factor: {season_factor:.2f}×. "
                           f"Premium → ₹{final_premium}/week."),
        "model": model_tag,
    }


def analytics_zone_breakdown_registration_zones():
    """
    Insurer analytics: same zones as the signup dropdown, with risk_label + risk_score
    exactly as returned by GET /premium for that zone with default profile
    (₹4500/wk, mid tenure, Zomato) — matches Register after those defaults + zone select.
    """
    ref_earnings = 4500.0
    ref_tenure = "mid"
    ref_platform = "zomato"
    rows = []
    for zone_key in REGISTER_ZONE_KEYS:
        calc = calculate_premium_xgboost(
            zone_key, ref_earnings, ref_tenure, ref_platform
        )
        rows.append({
            "zone_key": zone_key,
            "zone": calc["zone_label"],
            "risk_score": calc["risk_score"],
            "risk_label": calc["risk_label"],
            "zone_risk_raw": calc["zone_risk_raw"],
        })
    return rows
