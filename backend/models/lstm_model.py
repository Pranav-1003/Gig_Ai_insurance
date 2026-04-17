from typing import Optional
"""
LSTM Disruption Forecaster — predicts 48h-ahead disruption risk per zone.

Architecture:
  Input:  sequence of N time-steps × F features (weather + historical claims)
  Hidden: 2-layer LSTM (64 units each) → Dense(32) → Dense(num_triggers, sigmoid)
  Output: per-trigger probability scores for the forecast window

Since we don't have real 48h weather time-series at startup, this module:
  1. Defines and trains a lightweight LSTM on synthetic historical data at first run
  2. Saves weights to lstm_weights.pkl for subsequent loads
  3. Exposes predict_zone_risk(zone_key) → dict of {trigger_type: risk_score}

The model is re-trained weekly via APScheduler (wired in main.py).
"""
import os
import pickle
import numpy as np
from pathlib import Path
from datetime import datetime

# ── Constants ──────────────────────────────────────────────────────────────────

TRIGGER_TYPES = ["rain", "heat", "app", "curfew", "closure"]
SEQ_LEN       = 24      # 24 hourly time-steps as input window
N_FEATURES    = 8       # features per time-step
N_HIDDEN      = 64
WEIGHTS_PATH  = Path(__file__).parent / "lstm_weights.pkl"

# Zone baseline risk (0-1) used to shape synthetic training data
ZONE_BASE_RISK = {
    "chennai_north": 0.72, "chennai_south": 0.60, "madurai": 0.50,
    "coimbatore": 0.42, "tiruchirappalli": 0.65, "salem": 0.48,
    "tirunelveli": 0.78, "vellore": 0.54, "erode": 0.44, "thoothukudi": 0.62,
    "mumbai_west": 0.85, "mumbai_east": 0.82, "mumbai_central": 0.88,
    "thane": 0.80, "navi_mumbai": 0.72, "pune_central": 0.58, "pune_west": 0.52,
    "bangalore_north": 0.46, "bangalore_south": 0.44, "bangalore_east": 0.48,
    "delhi_north": 0.68, "delhi_south": 0.65, "gurgaon": 0.62, "noida": 0.64,
    "hyderabad_central": 0.58, "hyderabad_west": 0.54,
}


# ── Lightweight NumPy LSTM implementation ─────────────────────────────────────
# Using a pure-numpy implementation so we avoid TensorFlow/PyTorch deps.
# For production, replace with keras/torch and GPU training.

class _LSTMCell:
    """Single LSTM cell — weight matrices stored as numpy arrays."""

    def __init__(self, input_size: int, hidden_size: int, rng: np.random.Generator):
        k = 1.0 / hidden_size ** 0.5
        def W(r, c): return rng.uniform(-k, k, (r, c)).astype(np.float32)
        # Gates: input, forget, cell, output
        self.Wi = W(hidden_size, input_size);  self.Ui = W(hidden_size, hidden_size)
        self.Wf = W(hidden_size, input_size);  self.Uf = W(hidden_size, hidden_size)
        self.Wg = W(hidden_size, input_size);  self.Ug = W(hidden_size, hidden_size)
        self.Wo = W(hidden_size, input_size);  self.Uo = W(hidden_size, hidden_size)
        self.bi = np.zeros(hidden_size, dtype=np.float32)
        self.bf = np.ones(hidden_size,  dtype=np.float32)   # forget bias = 1 (common init)
        self.bg = np.zeros(hidden_size, dtype=np.float32)
        self.bo = np.zeros(hidden_size, dtype=np.float32)
        self.hidden_size = hidden_size

    def forward(self, x: np.ndarray, h: np.ndarray, c: np.ndarray):
        i = _sigmoid(x @ self.Wi.T + h @ self.Ui.T + self.bi)
        f = _sigmoid(x @ self.Wf.T + h @ self.Uf.T + self.bf)
        g = np.tanh(x @ self.Wg.T  + h @ self.Ug.T + self.bg)
        o = _sigmoid(x @ self.Wo.T + h @ self.Uo.T + self.bo)
        c_new = f * c + i * g
        h_new = o * np.tanh(c_new)
        return h_new, c_new

    def params(self):
        return [self.Wi, self.Ui, self.Wf, self.Uf, self.Wg, self.Ug,
                self.Wo, self.Uo, self.bi, self.bf, self.bg, self.bo]

    def set_params(self, params):
        (self.Wi, self.Ui, self.Wf, self.Uf, self.Wg, self.Ug,
         self.Wo, self.Uo, self.bi, self.bf, self.bg, self.bo) = params


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


class _LSTMModel:
    """2-layer LSTM + Dense head, inference-only (no backprop for simplicity)."""

    def __init__(self, rng: np.random.Generator):
        self.cell1 = _LSTMCell(N_FEATURES, N_HIDDEN, rng)
        self.cell2 = _LSTMCell(N_HIDDEN, N_HIDDEN, rng)
        k = 1.0 / 32 ** 0.5
        self.W1 = rng.uniform(-k, k, (32, N_HIDDEN)).astype(np.float32)
        self.b1 = np.zeros(32, dtype=np.float32)
        k2 = 1.0 / len(TRIGGER_TYPES) ** 0.5
        self.W2 = rng.uniform(-k2, k2, (len(TRIGGER_TYPES), 32)).astype(np.float32)
        self.b2 = np.zeros(len(TRIGGER_TYPES), dtype=np.float32)

    def forward(self, seq: np.ndarray) -> np.ndarray:
        """seq: (SEQ_LEN, N_FEATURES) → (len(TRIGGER_TYPES),) probabilities"""
        h1 = np.zeros(N_HIDDEN, dtype=np.float32)
        c1 = np.zeros(N_HIDDEN, dtype=np.float32)
        h2 = np.zeros(N_HIDDEN, dtype=np.float32)
        c2 = np.zeros(N_HIDDEN, dtype=np.float32)
        for t in range(seq.shape[0]):
            h1, c1 = self.cell1.forward(seq[t], h1, c1)
            h2, c2 = self.cell2.forward(h1, h2, c2)
        d1 = np.maximum(0, h2 @ self.W1.T + self.b1)   # ReLU
        out = _sigmoid(d1 @ self.W2.T + self.b2)
        return out

    def get_weights(self):
        return {
            "cell1": self.cell1.params(),
            "cell2": self.cell2.params(),
            "W1": self.W1, "b1": self.b1,
            "W2": self.W2, "b2": self.b2,
        }

    def set_weights(self, w):
        self.cell1.set_params(w["cell1"])
        self.cell2.set_params(w["cell2"])
        self.W1 = w["W1"]; self.b1 = w["b1"]
        self.W2 = w["W2"]; self.b2 = w["b2"]


# ── Feature engineering ───────────────────────────────────────────────────────

def _make_feature_sequence(zone_key: str, temperature: float = 36.0,
                            humidity: float = 65.0, rain_mm: float = 5.0,
                            recent_claims: int = 0, hour_of_day: int = 12) -> np.ndarray:
    """
    Build a (SEQ_LEN, N_FEATURES) synthetic input tensor for a zone.
    Features per step: [temp_norm, humidity_norm, rain_norm, zone_risk, hour_sin, hour_cos,
                        claims_norm, season_factor]
    """
    zone_risk = ZONE_BASE_RISK.get(zone_key, 0.55)
    month = datetime.utcnow().month
    season = 1.2 if month in [6,7,8,9] else 1.1 if month in [10,11] else 1.05 if month in [3,4,5] else 0.95

    rng = np.random.default_rng(abs(hash(zone_key)) % (2**32))
    seq = []
    for t in range(SEQ_LEN):
        h = (hour_of_day + t) % 24
        noise = rng.uniform(-0.05, 0.05, N_FEATURES).astype(np.float32)
        step = np.array([
            np.clip(temperature / 55.0, 0, 1),
            np.clip(humidity / 100.0, 0, 1),
            np.clip(rain_mm / 100.0, 0, 1),
            zone_risk,
            np.sin(2 * np.pi * h / 24),
            np.cos(2 * np.pi * h / 24),
            np.clip(recent_claims / 20.0, 0, 1),
            season / 1.25,
        ], dtype=np.float32)
        seq.append(step + noise * 0.1)
    return np.stack(seq)   # (SEQ_LEN, N_FEATURES)


# ── Synthetic training ────────────────────────────────────────────────────────

def _generate_synthetic_data(n_samples: int = 2000, seed: int = 42):
    """Generate (X, y) pairs to initialise weights with plausible values."""
    rng = np.random.default_rng(seed)
    zones = list(ZONE_BASE_RISK.keys())
    X, y = [], []
    for _ in range(n_samples):
        zone = rng.choice(zones)
        base = ZONE_BASE_RISK[zone]
        temp  = rng.uniform(25, 50)
        humid = rng.uniform(40, 95)
        rain  = rng.uniform(0, 80)
        claims = int(rng.poisson(base * 5))
        hour  = int(rng.integers(0, 24))
        seq = _make_feature_sequence(zone, temp, humid, rain, claims, hour)
        X.append(seq)
        # Labels: threshold-based "ground truth" (simplified)
        label = np.array([
            float(rain > 50 and humid > 70),                    # rain
            float(temp > 43 and humid > 68),                    # heat
            rng.uniform() < 0.05,                               # app (random rare)
            rng.uniform() < base * 0.08,                        # curfew
            rng.uniform() < base * 0.12,                        # closure
        ], dtype=np.float32)
        label = np.clip(label + rng.uniform(-0.1, 0.1, len(TRIGGER_TYPES)), 0, 1)
        y.append(label)
    return np.stack(X), np.stack(y)


def _train(model: _LSTMModel, X: np.ndarray, y: np.ndarray,
           epochs: int = 5, lr: float = 0.01):
    """
    Simple gradient-free hill-climbing to warm-start weights.
    For production: use proper backprop (PyTorch/Keras).
    """
    rng = np.random.default_rng(0)
    best_loss = float("inf")
    best_w = model.get_weights()

    # Evaluate initial loss on a small batch
    def _loss(idx):
        total = 0.0
        for i in idx:
            pred = model.forward(X[i])
            total += float(np.mean((pred - y[i]) ** 2))
        return total / len(idx)

    batch = rng.integers(0, len(X), 100).tolist()
    best_loss = _loss(batch)

    # Perturbation-based optimisation (extremely simplified)
    for epoch in range(epochs):
        w = model.get_weights()
        # Randomly perturb W2 (output layer) — biggest bang for minimal compute
        delta = rng.uniform(-lr, lr, model.W2.shape).astype(np.float32)
        model.W2 = w["W2"] + delta
        loss = _loss(batch)
        if loss < best_loss:
            best_loss = loss
            best_w = model.get_weights()
        else:
            model.set_weights(best_w)
        lr *= 0.9

    model.set_weights(best_w)
    return best_loss


# ── Global model instance ─────────────────────────────────────────────────────

_model: Optional[_LSTMModel] = None
_trained: bool = False


def _get_model() -> _LSTMModel:
    global _model, _trained
    if _model is not None:
        return _model

    rng = np.random.default_rng(42)
    _model = _LSTMModel(rng)

    if WEIGHTS_PATH.exists():
        try:
            with open(WEIGHTS_PATH, "rb") as f:
                weights = pickle.load(f)
            _model.set_weights(weights)
            _trained = True
            print("[LSTM] Loaded weights from disk")
            return _model
        except Exception as e:
            print(f"[LSTM] Could not load weights: {e}. Re-training.")

    # Train on synthetic data
    print("[LSTM] Training on synthetic data…")
    X, y = _generate_synthetic_data(n_samples=1500, seed=42)
    loss = _train(_model, X, y, epochs=8, lr=0.02)
    print(f"[LSTM] Training done. Final loss: {loss:.4f}")

    try:
        with open(WEIGHTS_PATH, "wb") as f:
            pickle.dump(_model.get_weights(), f)
        print(f"[LSTM] Weights saved to {WEIGHTS_PATH}")
    except Exception as e:
        print(f"[LSTM] Could not save weights: {e}")

    _trained = True
    return _model


# ── Public API ────────────────────────────────────────────────────────────────

def predict_zone_risk(
    zone_key: str,
    temperature: float = 36.0,
    humidity: float = 65.0,
    rain_mm: float = 5.0,
    recent_claims: int = 0,
    hour_of_day: int = 12,
) -> dict:
    """
    Returns 48h-ahead disruption risk scores for a zone.
    {
      "zone_key": ...,
      "predictions": {
        "rain":    {"risk_score": 0.72, "risk_label": "high",    "confidence": 0.81},
        "heat":    {...},
        ...
      },
      "overall_risk": 0.65,
      "model": "LSTM-2layer-numpy",
      "generated_at": "...",
    }
    """
    model = _get_model()
    seq = _make_feature_sequence(zone_key, temperature, humidity, rain_mm, recent_claims, hour_of_day)
    scores = model.forward(seq)   # (5,)

    # Zone baseline anchors the confidence — high-risk zones have higher confidence
    zone_base = ZONE_BASE_RISK.get(zone_key, 0.55)
    confidence_base = 0.65 + zone_base * 0.20

    def _label(s: float) -> str:
        if s >= 0.70: return "critical"
        if s >= 0.50: return "high"
        if s >= 0.30: return "medium"
        return "low"

    predictions = {}
    for i, t in enumerate(TRIGGER_TYPES):
        s = float(np.clip(scores[i], 0.0, 1.0))
        # Blend with zone baseline to avoid overconfident outputs
        blended = s * 0.6 + zone_base * 0.4
        conf = float(np.clip(confidence_base + np.random.default_rng(abs(hash(zone_key+t)) % 2**32).uniform(-0.05, 0.05), 0.55, 0.95))
        predictions[t] = {
            "risk_score": round(blended, 3),
            "risk_label": _label(blended),
            "confidence": round(conf, 2),
        }

    overall = float(np.mean([v["risk_score"] for v in predictions.values()]))

    return {
        "zone_key": zone_key,
        "forecast_window": "48h",
        "predictions": predictions,
        "overall_risk": round(overall, 3),
        "overall_label": _label(overall),
        "model": "LSTM-2layer-numpy",
        "generated_at": datetime.utcnow().isoformat(),
    }


def retrain_model():
    """Called by APScheduler weekly to refresh weights."""
    global _model, _trained
    print("[LSTM] Starting weekly re-train…")
    rng = np.random.default_rng(int(datetime.utcnow().timestamp()))
    _model = _LSTMModel(rng)
    X, y = _generate_synthetic_data(n_samples=2000, seed=int(datetime.utcnow().timestamp()) % 999)
    loss = _train(_model, X, y, epochs=10, lr=0.015)
    print(f"[LSTM] Re-train done. Loss: {loss:.4f}")
    try:
        with open(WEIGHTS_PATH, "wb") as f:
            pickle.dump(_model.get_weights(), f)
    except Exception as e:
        print(f"[LSTM] Could not save weights: {e}")
    _trained = True



