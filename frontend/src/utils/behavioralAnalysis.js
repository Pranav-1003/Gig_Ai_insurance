/**
 * ═══════════════════════════════════════════════════════════════
 * Guardian — Individual-Level Behavioral Analysis Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Computes per-worker behavioral trust scores from user profile
 * and claim history. All computation is deterministic & front-end
 * only — no backend dependency.
 *
 * Sub-scores (each 0–100):
 *   1. Claim Frequency   — are they claiming at expected rates?
 *   2. Timing Consistency — do claims happen at regular intervals or burst?
 *   3. Zone Fidelity      — what % of claims match their enrolled zone?
 *   4. Tenure Reliability — longer tenure = higher trust baseline
 *
 * Overall Trust Score = weighted composite → Risk Profile label.
 */

// ── Weight configuration ───────────────────────────────────────
const WEIGHTS = {
  claimFrequency:    0.30,
  timingConsistency: 0.25,
  zoneFidelity:      0.25,
  tenureReliability: 0.20,
};

// Expected monthly claims by zone risk tier (low / med / high)
const EXPECTED_CLAIMS_PER_MONTH = { low: 1.2, medium: 2.0, high: 3.0 };

// ── Tenure multiplier ──────────────────────────────────────────
const TENURE_SCORES = {
  new:    55,   // < 6 months — limited history, moderate baseline
  mid:    75,   // 6–24 months — solid track record
  senior: 92,   // 2+ years — high trust baseline
};

// ── Risk profile thresholds ────────────────────────────────────
const RISK_PROFILES = [
  { min: 80, label: 'Trusted',  color: '#10b981', badge: 'badge-green' },
  { min: 55, label: 'Standard', color: '#3b82f6', badge: 'badge-blue'  },
  { min: 35, label: 'Watch',    color: '#f59e0b', badge: 'badge-amber' },
  { min: 0,  label: 'Flagged',  color: '#ef4444', badge: 'badge-red'   },
];

/**
 * Classify zone risk tier from risk score (0–100).
 */
function zoneRiskTier(riskScore) {
  if (riskScore >= 65) return 'high';
  if (riskScore >= 40) return 'medium';
  return 'low';
}

/**
 * Compute Claim Frequency Score (0–100).
 * Measures whether claim rate is within expected range for zone.
 * Too many claims = suspicious, too few = excellent.
 */
function computeClaimFrequency(claims, zoneRiskScore, monthsActive) {
  if (!monthsActive || monthsActive < 0.5) return 85; // new user — benefit of doubt
  const tier = zoneRiskTier(zoneRiskScore || 50);
  const expected = EXPECTED_CLAIMS_PER_MONTH[tier] * monthsActive;
  const totalClaims = claims.length;

  if (expected === 0) return 90;
  const ratio = totalClaims / expected;

  // Perfect ratio = 1.0. Penalise over-claiming (ratio > 1.5) heavily.
  if (ratio <= 0.5) return 95;                          // Under-claiming — great
  if (ratio <= 1.0) return 90;                          // Within expected
  if (ratio <= 1.3) return 75;                          // Slightly above expected
  if (ratio <= 1.6) return 55;                          // Above expected — watch
  if (ratio <= 2.0) return 35;                          // Well above — concerning
  return Math.max(10, 30 - (ratio - 2) * 15);           // Way over — flagged
}

/**
 * Compute Timing Consistency Score (0–100).
 * Checks if claims are spread out or clustered in bursts.
 */
function computeTimingConsistency(claims) {
  if (claims.length < 2) return 88; // Insufficient data — assume good

  // Sort claims by timestamp (newest first assumed, reverse for chronological)
  const timestamps = claims
    .map(c => {
      if (c.timestamp_epoch) return c.timestamp_epoch;
      // Parse string timestamps fallback
      const d = new Date(c.timestamp || c.created_at || Date.now());
      return d.getTime();
    })
    .sort((a, b) => a - b);

  // Calculate intervals between consecutive claims (in hours)
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push((timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60));
  }

  if (intervals.length === 0) return 88;

  // Check for burst patterns (multiple claims within 6 hours)
  const burstThreshold = 6; // hours
  const bursts = intervals.filter(h => h < burstThreshold).length;
  const burstRatio = bursts / intervals.length;

  // Check coefficient of variation (std / mean) — lower = more consistent
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  let score = 90;
  // Penalise bursts
  score -= burstRatio * 40;
  // Penalise high variance (inconsistent timing)
  if (cv > 1.5) score -= 15;
  else if (cv > 1.0) score -= 8;

  return Math.max(10, Math.min(100, Math.round(score)));
}

/**
 * Compute Zone Fidelity Score (0–100).
 * Percentage of claims that match the user's enrolled zone.
 */
function computeZoneFidelity(claims, userZone) {
  if (!claims.length) return 95; // No claims yet — assume good

  const matchingClaims = claims.filter(c => {
    const claimZone = c.zone_key || c.zone || '';
    return (
      claimZone === userZone ||
      c.status === 'paid' ||      // Paid claims already passed zone check
      c.status === 'processing'
    );
  });

  // Also count rejections — zone mismatches reduce fidelity
  const rejectedZoneMismatch = claims.filter(
    c => c.status === 'rejected' && c.rejection_reason?.toLowerCase().includes('zone')
  ).length;

  const fidelity = claims.length > 0
    ? ((claims.length - rejectedZoneMismatch) / claims.length) * 100
    : 100;

  return Math.max(10, Math.min(100, Math.round(fidelity)));
}

/**
 * Compute Tenure Reliability Score (0–100).
 */
function computeTenureReliability(tenure) {
  return TENURE_SCORES[tenure] || TENURE_SCORES.mid;
}

/**
 * Determine risk profile from overall score.
 */
function getRiskProfile(score) {
  for (const rp of RISK_PROFILES) {
    if (score >= rp.min) return rp;
  }
  return RISK_PROFILES[RISK_PROFILES.length - 1];
}

/**
 * Generate human-readable behavioral insights.
 */
function generateInsights(subScores, claims, user) {
  const insights = [];

  // Claim frequency insights
  if (subScores.claimFrequency >= 85) {
    insights.push({ icon: '✅', text: 'Your claim rate is within the expected range for your zone', type: 'positive' });
  } else if (subScores.claimFrequency < 55) {
    insights.push({ icon: '⚠️', text: 'Claim frequency is above the expected range — AI monitoring enhanced', type: 'warning' });
  }

  // Timing insights
  if (subScores.timingConsistency >= 80) {
    insights.push({ icon: '🕐', text: 'Claims are evenly distributed — no burst patterns detected', type: 'positive' });
  } else if (subScores.timingConsistency < 50) {
    insights.push({ icon: '⏱️', text: 'Multiple claims detected in short windows — burst flag active', type: 'warning' });
  }

  // Zone fidelity insights
  if (subScores.zoneFidelity >= 90) {
    insights.push({ icon: '📍', text: 'All claims match your enrolled zone — strong fidelity', type: 'positive' });
  } else if (subScores.zoneFidelity < 70) {
    insights.push({ icon: '🗺️', text: 'Some claims occurred outside your enrolled zone boundary', type: 'warning' });
  }

  // Tenure insights
  if (subScores.tenureReliability >= 80) {
    insights.push({ icon: '🏆', text: `${user?.tenure === 'senior' ? 'Senior partner' : 'Experienced'} — high trust baseline from tenure`, type: 'positive' });
  } else {
    insights.push({ icon: '🌱', text: 'New partner — trust score will improve with consistent behavior', type: 'info' });
  }

  // Overall pattern
  const approved = claims.filter(c => c.status === 'paid').length;
  const rejected = claims.filter(c => c.status === 'rejected').length;
  if (approved > 0 && rejected === 0) {
    insights.push({ icon: '🛡️', text: `${approved} claims approved with zero rejections — excellent record`, type: 'positive' });
  } else if (rejected > 0) {
    insights.push({ icon: '📋', text: `${rejected} claim${rejected > 1 ? 's' : ''} rejected — review zone coverage settings`, type: 'warning' });
  }

  return insights;
}

// ════════════════════════════════════════════════════════════
// Main export: compute full behavioral profile
// ════════════════════════════════════════════════════════════

/**
 * @param {Object}  user   - User object with { tenure, zone_key, zone, created_at, ... }
 * @param {Array}   claims - Array of claim objects
 * @param {number}  zoneRiskScore - Zone risk score (0–100), optional
 * @returns {Object} Full behavioral analysis result
 */
export function computeBehavioralProfile(user, claims = [], zoneRiskScore = 50) {
  // Estimate months active (fallback: based on tenure)
  const tenureMonths = { new: 3, mid: 12, senior: 30 };
  const monthsActive = tenureMonths[user?.tenure] || 6;

  // Sub-scores
  const claimFrequency    = computeClaimFrequency(claims, zoneRiskScore, monthsActive);
  const timingConsistency = computeTimingConsistency(claims);
  const zoneFidelity      = computeZoneFidelity(claims, user?.zone_key || user?.zone);
  const tenureReliability = computeTenureReliability(user?.tenure);

  const subScores = { claimFrequency, timingConsistency, zoneFidelity, tenureReliability };

  // Weighted overall score
  const overallScore = Math.round(
    claimFrequency    * WEIGHTS.claimFrequency +
    timingConsistency * WEIGHTS.timingConsistency +
    zoneFidelity      * WEIGHTS.zoneFidelity +
    tenureReliability * WEIGHTS.tenureReliability
  );

  const riskProfile = getRiskProfile(overallScore);
  const insights    = generateInsights(subScores, claims, user);

  return {
    overallScore,
    subScores: [
      { key: 'claimFrequency',    label: 'Claim Frequency',    score: claimFrequency,    weight: WEIGHTS.claimFrequency },
      { key: 'timingConsistency', label: 'Timing Consistency', score: timingConsistency, weight: WEIGHTS.timingConsistency },
      { key: 'zoneFidelity',      label: 'Zone Fidelity',      score: zoneFidelity,      weight: WEIGHTS.zoneFidelity },
      { key: 'tenureReliability', label: 'Tenure Reliability', score: tenureReliability, weight: WEIGHTS.tenureReliability },
    ],
    riskProfile,
    insights,
    meta: {
      totalClaims:   claims.length,
      approvedClaims: claims.filter(c => c.status === 'paid').length,
      rejectedClaims: claims.filter(c => c.status === 'rejected').length,
      monthsActive,
    },
  };
}

export default computeBehavioralProfile;
