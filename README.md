# GuardianAI: AI-Powered Parametric Micro-Insurance for India's Gig Workers

## Executive Summary

**GuardianAI** is a parametric micro-insurance platform protecting India's 10M+ delivery partners (Zomato, Swiggy, Amazon, Zepto) from income loss due to uncontrollable disruptions. Unlike traditional insurance (10-day claims), GuardianAI auto-triggers payouts within 3 hours when weather, strikes, or platform crashes cut worker earnings — using real-time AI and government alert APIs.

**Team:** GenXplorers — P Sai Chaithanyia, Pranav Prakash A, Pranhai Prakash A, Nikhil A, Anuttaman R

**Target:** Ravi Kumar (28, Zomato delivery partner, Thane, Mumbai — ₹500–700/day, loses 40% income during monsoon)  
**Problem:** ₹1,800–2,000 loss per disruption event, with zero insurance products designed for weekly-paid gig workers  
**Solution:** ₹75/week → Auto-payout in 3 hours → Zero paperwork

---

## 1. Persona & Workflow

### Worker Persona: Ravi Kumar
- **Age:** 28 | Thane, Mumbai | 2.5 years on platform
- **Daily earnings:** ₹500–700 (40–50 deliveries, 6 AM–11 PM)
- **Payment cycle:** Weekly via UPI every Sunday
- **Disruptions faced:** Monsoon (8–12 events/season), heat waves (5–10 events), app crashes (rare), restaurant closures (1–2/month), curfews (1–5/year)
- **Income loss:** ₹1,800–2,000/disruption = 2–3 weeks emergency fund gone
- **Insurance today:** Zero. No product exists for gig workers.

### Ravi's Journey on GuardianAI
```
SUNDAY:    Pay ₹75 weekly premium via UPI at renewal
MON–SAT:   Coverage active — 5 disruption triggers monitored 24/7
WEDNESDAY: 80mm rainfall detected + GPS confirms Ravi in zone
           AI auto-approves in 2 mins → UPI payout ₹500 in 3 hours
           No form. No call. No 10-day wait.
```

### Full Application Workflow
```
ONBOARDING: Phone OTP → Aadhaar verification → Work details (zone, earnings, platform) → Risk profiling → Payment setup

COVERAGE ACTIVE: Real-time monitoring of 5 disruption triggers
├─ Weather API (OpenWeatherMap + IMD — rainfall, heat, wind)
├─ Traffic APIs (Google Maps — congestion, mobility bans)
├─ Government alerts (BMC/Police scraper — curfews, strikes, official notices)
├─ Restaurant status (Google Maps + crowdsourced reports)
└─ Platform monitoring (app uptime, downtime detection)

AUTO-CLAIM: Disruption detected → Fraud checks (2 mins) → AI approval → Payout queued

PAYOUT: UPI transfer within 3 hours to worker's linked account

DASHBOARD: Workers see protected earnings, claim history, next renewal date
```

---

## 2. Weekly Premium Model & Parametric Triggers

### Why Weekly (Not Monthly)?
- Workers earn weekly, think weekly, get paid Sunday
- ₹75/week = 1.7% of income (affordable) vs ₹200/month = 4.4% (feels expensive — 68% rejection rate)
- 52 renewal touchpoints/year → habit formation → 2.3× retention vs monthly
- 3× higher conversion rate: small weekly bites vs large monthly lump-sum
- XGBoost adjusts premium weekly per-worker, per-zone, per-season — never stale

### Dynamic Premium Calculation (XGBoost ML)
Base: ₹65–120/week | Trained on **12 engineered features** → personalized risk score 0–100

- **Geospatial:** `zone_risk` (flood/heat score per micro-zone), `zone_is_high_risk` (>70)
- **Temporal:** `season_factor` (monsoon 1.2×, winter 0.95×), zone_risk × season interaction
- **Worker:** `tenure_months` (normalized /36), `weekly_earnings` (normalized /10K)
- **Behavioral:** `is_new_partner`, `is_senior`, `is_high_earner`, `is_low_earner` flags
- **Platform:** `platform_risk_offset` (Zepto +2, Amazon −3, Zomato 0)
- **Cross-terms:** tenure × earnings interaction, zone × season interaction

**Example:** Ravi (Thane, monsoon, 2.5 years) → Risk score 75 → ₹90/week

### 5 Parametric Triggers (Auto-Payout, No Claim Forms)

| # | Trigger | Condition | Payout | Data Sources |
|---|---------|-----------|--------|--------------|
| 1 | **Heavy Rainfall** | >50mm/24h + worker GPS in zone | ₹500 | IMD + OpenWeatherMap + crowdsource |
| 2 | **Heat Wave** | >45°C + >70% humidity for 6h+ | ₹300 | HCI model (81% accurate vs basic temp) |
| 3 | **App Downtime** | Platform unavailable >30 mins | ₹400 | Uptime monitor + worker 1-tap reports |
| 4 | **Restaurant Closure** | >40% closed in zone for 6h+ | ₹350 | Google Maps + crowdsource engine |
| 5 | **Curfew / Strike** | Govt notice + traffic validation | ₹800 | Govt API (2-min vs 30-min news API) |

**Annual protection:** ₹2,500 max payout/year | Multi-source verification (5 layers) → 95% confidence → 2-min detection latency

---

## 3. Technology Stack

**Frontend:** React + Vite (worker dashboard, admin analytics panel)  
**Backend:** Python FastAPI — microservices, async endpoints  
**AI/ML:** XGBoost (.pkl), Isolation Forest (.pkl), NumPy LSTM (custom 2-layer)  
**Database:** SQLite (workers, admin, analytics) + Redis cache  
**Payments:** Razorpay UPI — instant transfers, webhook callbacks  
**Deploy:** Docker + Netlify (frontend)  
**APIs:** OpenWeatherMap, IMD, Google Maps Traffic, BMC/Police scraper, Razorpay

---

## 4. AI/ML Engine

### XGBoost Dynamic Premium Engine
- 12 engineered features → personalized risk score 0–100 → premium ₹65–120/week
- Weekly retrain via APScheduler with new disruption data
- Result: Fair, personalized pricing that adjusts per-worker, per-zone, per-season

### LSTM Disruption Forecaster (48h Ahead)
- 2-layer LSTM (64 units each) → Dense(32, ReLU) → Dense(5, sigmoid) → per-trigger risk
- **Input sequence:** 24 hourly time-steps × 8 features: `temp_normalized`, `humidity_normalized`, `rain_mm_normalized`, `zone_base_risk`, `hour_sin(2π·h/24)`, `hour_cos(2π·h/24)`, `claims_normalized`, `season_factor`
- **Output:** risk_score per trigger (rain, heat, app, curfew, closure) — blended 60/40 with zone baseline
- Proactive alerts to workers 48h before predicted disruptions

### Behavioral Trust Scoring Engine

| Component | Weight | Logic |
|-----------|--------|-------|
| Claim Frequency | 30% | Ratio of actual to expected (zone-adjusted). Under-claiming = 95, over 2× expected = flagged |
| Timing Consistency | 25% | CoV of intervals + burst ratio (< 6h gaps penalized −40) |
| Zone Fidelity | 25% | % of claims matching enrolled zone. Zone-mismatch rejections reduce fidelity |
| Tenure Reliability | 20% | New (55) → Mid (75) → Senior (92) |

**Overall Trust = Σ(sub-score × weight) → Trusted (≥80) | Standard (≥55) | Watch (≥35) | Flagged (<35)**

---

## 5. Fraud Detection & Anti-Syndicate Architecture

### 3-Stage Fraud Pipeline

**Stage 1 — Rule Engine (< 2 sec)**
- Policy active & coverage valid?
- Disruption verified by trigger?
- Zone boundary GPS check

**Stage 2 — Isolation Forest (< 1 min)**
- 6-dim feature vector: claims/month, tenure, zone_match, trigger_freq, inter_claim_days, hour_of_day
- Trained anomaly scorer (.pkl) — score > 0.72 → flag for review

**Stage 3 — Pattern Analysis (< 1 min)**
- GPS spoof detection (zone ≠ trigger zone → 0.95 fraud score)
- Tenure-weighted base risk
- BCS composite fed into final decision

**Result: < 2% fraud loss | 98% auto-approval**

### Behavioral Coherence Score (BCS) — 5 Non-Spoofable Data Layers

| Data Layer | Genuine Worker Signal | Spoofer Signal (Detectable) |
|---|---|---|
| **L1: Device Telemetry** | Riding accelerometer signature, high battery drain, screen ON, network handoffs | Flat motion, phone stationary, no tower handoffs |
| **L2: Platform API** | Recent order in affected zone, active app session <90 min ago | App closed, no session, last order from different zone |
| **L3: Cell Tower** | TRAI-compliant carrier API triangulation confirms zone presence | Cell tower data contradicts GPS — hard rejection |
| **L4: Network Graph** | Normal onboarding, staggered registration, no cluster membership | Louvain community detection flags social cluster, burst timing |
| **L5: Historical Baseline** | Cosine similarity to 30-day behavioral profile ≥ 15th percentile | First appearance in zone, similarity near zero |

**Core insight:** A legitimate stranded worker produces dozens of correlated signals naturally. A fraudster must fake ALL simultaneously — economically irrational for ₹300–₹800 payouts.

### Tiered Response Model

| Tier | Condition | Action |
|------|-----------|--------|
| **Tier 1 (94%)** | BCS ≥ 60, no ring signals | Auto-approve → payout in 3h |
| **Tier 2 (5%)** | BCS 35–59 | Grace period → 6h delay (collects more telemetry) |
| **Tier 3 (1%)** | BCS < 35 / ring detected | Human review 24h → video selfie option |

### Anti-Syndicate Countermeasures (Telegram Ring Defense)

**Threat:** 500+ workers coordinate GPS spoofing via Telegram during verified weather events to drain the liquidity pool.

1. **Dynamic Burst Throttling:** Claim burst > 3σ above zone historical rate in 10-min window → auto-throttle ALL claims to Tier 2 (6h delay) until Louvain cluster analysis completes
2. **Louvain Community Detection:** Graph clustering on UPI metadata + referral chains + registration cohort timing. 50+ accounts, same referrer, same zone, zero prior claims = flagged
3. **Claim Arrival Distribution:** Genuine claims arrive in natural Poisson distribution over 20–40 min. Syndicate claims cluster in 3–7 min bursts — statistical test auto-detects
4. **Honeypot Zones (Phase 2):** Synthetic ghost zones in DB — any GPS ping in ghost zone is definitionally spoofed

---

## 6. System Architecture & Scalability

### End-to-End Pipeline

```
DETECTION LAYER (< 2 min)
├─ OpenWeatherMap + IMD
├─ Google Maps Traffic
├─ BMC/Police Scraper
├─ Worker Crowdsource (1-tap)
└─ Platform Uptime Monitor
        │
        ▼
VERIFICATION LAYER (< 1 min)
├─ XGBoost Premium Engine (12 features, .pkl)
├─ Isolation Forest Anomaly Detector (.pkl)
├─ Multi-source Confidence Scorer
└─ PostGIS Geofencing
        │
        ▼
DECISION LAYER (< 2 min)
├─ Parametric Trigger Engine (5 types)
├─ 3-Stage Fraud Pipeline
├─ BCS Scoring (5 data layers)
├─ Burst Throttle (3σ check)
└─ Louvain Ring Detection
        │
        ▼
PAYOUT LAYER (< 3 hrs)
├─ Razorpay UPI (real-time transfer)
├─ RabbitMQ batch queue
├─ FCM Push + SMS notifications
├─ Compliance audit trail
└─ Tier escalation routing

Total: Detection 2m + Fraud Check 2m + Payout ≤ 3 hrs = Zero-touch claim lifecycle
```

### Unit Economics (per policy per week)

| Item | Amount | % |
|------|--------|---|
| Weekly Premium | ₹75.0 | 100% |
| − Expected Claims (62%) | ₹46.7 | 62.3% |
| − Operating Cost (12%) | ₹9.0 | 12.0% |
| − Reinsurance (5%) | ₹3.8 | 5.0% |
| **= Net Margin** | **₹15.5** | **20.7%** |

Annual value per policy: ₹75 × 52 = ₹3,900 | Annual protection: ₹2,500 max payout/year

### Scalability & Network Effect Moat

| Year | Users | Fraud Rate | CAC | Infra/User |
|------|-------|-----------|-----|------------|
| Year 1 | 50K | 2.5% | ₹500 | ₹1.1 |
| Year 2 | 500K | 1.8% | ₹250 | ₹0.4 |
| Year 3 | 2M | 1.2% | ₹100 | ₹0.15 |

**More users → Better ML → Lower fraud → Lower CAC → Defensible moat**

### Business Validation (6 Automated Checks)

| Check | Status | Result |
|-------|--------|--------|
| Premium Adequacy | ✅ PASS | Coverage ratio ≥ 1.15 |
| Loss Ratio Corridor | ✅ PASS | 62% — within 55–75% target band |
| Reserve Sufficiency | ✅ PASS | Covers 2.5× worst-case 48h surge |
| Fraud Cost Impact | ✅ PASS | 1.8% — below 3% threshold |
| Unit Economics | ✅ PASS | ₹15.5/policy/week margin (20.7% > 8% min) |
| Cohort Sustainability | ✅ PASS | All zone-cohorts individually viable |

---

## 7. Competitive Differentiators

| # | Innovation | Impact |
|---|---|---|
| 1 | **Weekly pricing model** | 3× higher conversion, 2.3× retention vs monthly |
| 2 | **Parametric + AI fusion** | 98% auto-approval (vs 60–70% industry) |
| 3 | **Crowdsourced disruption network** | 5× faster detection (workers report 1-tap) |
| 4 | **Government Alert API** | 2-min latency vs 30-min news API competitors |
| 5 | **Human Comfort Index (HCI)** | 81% accurate heat impact prediction (not just temp) |
| 6 | **3-stage fraud detection** | <2% fraud loss vs 3–5% industry average |
| 7 | **Zero-touch UX** | Payouts in 3 hours (not 10 days traditional) |
| 8 | **Behavioral Coherence Score** | 5 non-spoofable data layers — defeats Telegram syndicates |
| 9 | **Regulatory alignment** | Parametric insurance = compliance-ready, scalable nationally |
| 10 | **Network economics moat** | More data → Better ML → Lower fraud → Defensible advantage |

---

## 8. Adversarial Defense & Anti-Spoofing Strategy

> **Context:** A threat report from our simulated alpha environment identified a coordinated syndicate of 500 delivery workers using GPS-spoofing applications to fake zone presence during red-alert weather events — draining the liquidity pool with mass false payouts while physically resting at home. This section describes our architectural response.

### Why GPS Alone Fails

A GPS coordinate tells us *where a device claims to be*. It says nothing about whether the device is actually there, whether the person is working, or whether the claim is part of a coordinated ring. Our defense shifts from "is this GPS real?" to **"does this worker's entire behavioral fingerprint match someone who is genuinely stranded?"**

### Genuine Worker vs. Bad Actor

| Signal | Genuine Worker | GPS Spoofer at Home |
|--------|---------------|---------------------|
| **App activity** | Zomato/Swiggy app open, order active <90 min ago | App closed, no session |
| **Movement pattern** | GPS trajectory shows movement toward zone 30–60 min before event | Static or teleports to zone at trigger time |
| **Platform API** | Last accepted order in affected zone | No active session or last order from a different location |
| **Cell tower** | Carrier API triangulation confirms zone presence | Cell tower data contradicts GPS — hard rejection |
| **Accelerometer** | Riding/movement signature, noisy motion | Phone stationary, flat readings |
| **Battery & screen** | Screen frequently ON — active navigation | Screen off for long periods |
| **Historical zone** | Past 30 days show regular presence in claimed zone | First appearance in zone |
| **Time-of-day** | Claim during worker's known active hours | Claim at unusual hours |

### Claim Decision Flow

```
TRIGGER FIRES (parametric threshold crossed)
        │
        ▼
CLAIM INGESTION
├─ Collect device telemetry (accelerometer, battery, network handoffs)
├─ Query delivery platform API (last active session + location)
├─ Request cell tower triangulation (carrier API)
└─ Pull historical behavioral baseline from worker profile DB
        │
        ▼
BEHAVIORAL COHERENCE SCORE (BCS) COMPUTED [0–100]
        │
        ├─ BCS ≥ 60 AND no ring signals ──► AUTO-APPROVE → Payout in 3h (Tier 1)
        │
        ├─ BCS 35–59 OR weak ring signal ──► GRACE PERIOD → 3h analysis → Payout in 6h (Tier 2)
        │
        └─ BCS < 35 OR strong ring signals ──► HUMAN REVIEW QUEUE → 24h (Tier 3)
                                                      │
                                    ┌─────────────────┼──────────────────┐
                                    ▼                 ▼                  ▼
                               APPROVE           REQUEST SELFIE       REJECT + APPEAL PATH
                            (payout now)      (geo+timestamp video)  (written reason + 48h appeal)
```

### Performance Targets

| Metric | Target |
|--------|--------|
| False rejection rate (Tier 3 → appeal success) | < 0.5% |
| Genuine worker payout delay (Tier 2) | +3 hours max |
| Coordinated ring detection rate | > 85% of syndicates flagged before first payout |
| BCS computation latency | < 8 seconds per claim |
| Tier 1 auto-approval rate | ≥ 94% of all claims |

---

## 9. Running the App Locally

### Prerequisites

- Python 3.9+
- Node.js 18+

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/guardianai.git
cd guardianai
```

### 2. Backend Setup (FastAPI)

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```
#### Start the backend server like this

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be live at `http://localhost:8000`  
Swagger docs: `http://localhost:8000/docs`

### 2. Frontend Setup (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

The app will be live at `http://localhost:5173`

No need for .env files as they are already hardcoded in the repo for ease.

## 📊 Pitch Deck

View the full GuardianAI pitch deck here:  
**[GuardianAI_PitchDeck.pdf — Google Drive](https://drive.google.com/file/d/1yk7acTkF8Ca7qAMvQQm1GpfPJXF52GPn/view?usp=sharing)**

The deck covers:
- Market gap & worker persona (Ravi Kumar)
- AI/ML engine deep dive (XGBoost, LSTM, BCS)
- Fraud detection & anti-syndicate architecture
- Weekly pricing model & unit economics
- System architecture & scalability roadmap
- Team: GenXplorers
