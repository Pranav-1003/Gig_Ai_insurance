/**
 * ═══════════════════════════════════════════════════════════════
 * Guardian — Explicit Business Model Validation Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Programmatically validates that Guardian's business model
 * assumptions hold true given current platform metrics. Each
 * validation returns a structured result with pass/fail, current
 * value, threshold, severity, and human-readable explanation.
 *
 * Checked assumptions:
 *   1. Premium Adequacy     — premiums cover expected payouts + margin
 *   2. Loss Ratio Corridor  — loss ratio stays within 55–75% target
 *   3. Reserve Sufficiency  — reserves cover worst-case 48h surge
 *   4. Fraud Cost Impact    — fraud rate < sustainability threshold
 *   5. Unit Economics       — per-policy profit margin is positive
 *   6. Cohort Sustainability — each zone-cohort is individually viable
 */

// ── Model Constants (Guardian's business assumptions) ──────────
const MODEL_ASSUMPTIONS = {
  weeklyPremium:        75,       // ₹75 per week per policy
  maxWeeklyPayout:      2350,     // Max payout per policy per week
  targetLossRatioLow:   0.55,     // 55% — lower bound of healthy corridor
  targetLossRatioHigh:  0.75,     // 75% — upper bound (above = unsustainable)
  maxFraudRate:         0.03,     // 3% — above this, model breaks
  minProfitMarginPct:   0.08,     // 8% net margin minimum
  reserveMultiplier:    2.5,      // Reserves should cover 2.5x average daily claims
  operatingCostPct:     0.12,     // 12% of premiums go to ops (tech + support)
  reinsurancePct:       0.05,     // 5% ceded to reinsurance
  avgClaimAmount:       450,      // Weighted average claim ₹450
  avgClaimsPerPolicy:   2.2,      // Average claims per policy per month
  weeklyClaimProbability: 0.35,   // 35% chance a policy files a claim in any given week
};

// ── Severity levels ────────────────────────────────────────────
const SEVERITY = {
  PASS:     { level: 'pass',     icon: '✅', color: '#10b981', label: 'Healthy' },
  INFO:     { level: 'info',     icon: 'ℹ️', color: '#3b82f6', label: 'Info' },
  WARNING:  { level: 'warning',  icon: '⚠️', color: '#f59e0b', label: 'Warning' },
  CRITICAL: { level: 'critical', icon: '❌', color: '#ef4444', label: 'Critical' },
};

// ════════════════════════════════════════════════════════════
// Individual Validation Checks
// ════════════════════════════════════════════════════════════

/**
 * 1. Premium Adequacy — Do premiums cover expected claims + margin?
 */
function validatePremiumAdequacy(metrics) {
  const weeklyPremiumIncome = parseFloat(String(metrics.premiums_collected || '₹35.5L').replace(/[₹,L]/g, '')) * 100000;
  const weeklyClaimsPaid    = parseFloat(String(metrics.claims_paid || '₹22.1L').replace(/[₹,L]/g, '')) * 100000;
  const activePolicies      = parseInt(String(metrics.active_policies || '47280').replace(/,/g, ''));

  const perPolicyPremium   = weeklyPremiumIncome / (activePolicies || 1);
  const perPolicyClaimCost = weeklyClaimsPaid / (activePolicies || 1);
  const coverageRatio      = perPolicyPremium / (perPolicyClaimCost || 1);

  const passed = coverageRatio >= 1.15; // Premium should be ≥ 15% above claim cost

  return {
    id: 'premium_adequacy',
    name: 'Premium Adequacy',
    description: 'Validates that collected premiums cover expected claim payouts with sufficient margin',
    passed,
    value: `₹${perPolicyPremium.toFixed(0)}/policy`,
    threshold: `≥ ₹${(perPolicyClaimCost * 1.15).toFixed(0)}/policy`,
    ratio: coverageRatio,
    severity: passed ? SEVERITY.PASS : coverageRatio >= 1.0 ? SEVERITY.WARNING : SEVERITY.CRITICAL,
    explanation: passed
      ? `Premium per policy (₹${perPolicyPremium.toFixed(0)}) exceeds claim cost (₹${perPolicyClaimCost.toFixed(0)}) by ${((coverageRatio - 1) * 100).toFixed(1)}% — sustainable.`
      : `Premium per policy (₹${perPolicyPremium.toFixed(0)}) is only ${(coverageRatio * 100).toFixed(1)}% of claim cost (₹${perPolicyClaimCost.toFixed(0)}) — margin too thin.`,
    metric: `${(coverageRatio * 100).toFixed(1)}%`,
  };
}

/**
 * 2. Loss Ratio Corridor — Is loss ratio within the 55–75% target?
 */
function validateLossRatio(metrics) {
  const rawLossRatio = parseFloat(String(metrics.loss_ratio || '62%').replace('%', '')) / 100;

  const inCorridor = rawLossRatio >= MODEL_ASSUMPTIONS.targetLossRatioLow &&
                     rawLossRatio <= MODEL_ASSUMPTIONS.targetLossRatioHigh;
  const belowCorridor = rawLossRatio < MODEL_ASSUMPTIONS.targetLossRatioLow;
  const aboveCorridor = rawLossRatio > MODEL_ASSUMPTIONS.targetLossRatioHigh;

  let severity = SEVERITY.PASS;
  if (aboveCorridor) severity = rawLossRatio > 0.85 ? SEVERITY.CRITICAL : SEVERITY.WARNING;
  if (belowCorridor) severity = SEVERITY.INFO; // Below is actually good (more profitable)

  return {
    id: 'loss_ratio',
    name: 'Loss Ratio Corridor',
    description: 'Validates loss ratio stays within the 55–75% target sustainability corridor',
    passed: inCorridor || belowCorridor,
    value: `${(rawLossRatio * 100).toFixed(1)}%`,
    threshold: '55% – 75%',
    ratio: rawLossRatio,
    severity,
    explanation: inCorridor
      ? `Loss ratio of ${(rawLossRatio * 100).toFixed(1)}% is within the ${MODEL_ASSUMPTIONS.targetLossRatioLow * 100}–${MODEL_ASSUMPTIONS.targetLossRatioHigh * 100}% sustainability corridor.`
      : belowCorridor
        ? `Loss ratio of ${(rawLossRatio * 100).toFixed(1)}% is below the corridor — highly profitable but consider increasing coverage.`
        : `Loss ratio of ${(rawLossRatio * 100).toFixed(1)}% exceeds the ${MODEL_ASSUMPTIONS.targetLossRatioHigh * 100}% ceiling — claims are outpacing premiums.`,
    metric: `${(rawLossRatio * 100).toFixed(1)}%`,
  };
}

/**
 * 3. Reserve Sufficiency — Can reserves cover worst-case 48h surge?
 */
function validateReserveSufficiency(metrics) {
  const activePolicies = parseInt(String(metrics.active_policies || '47280').replace(/,/g, ''));
  const weeklyClaimsPaid = parseFloat(String(metrics.claims_paid || '₹22.1L').replace(/[₹,L]/g, '')) * 100000;

  const dailyClaimAvg  = weeklyClaimsPaid / 7;
  const requiredReserve = dailyClaimAvg * MODEL_ASSUMPTIONS.reserveMultiplier;
  // Estimate actual reserves as 3 weeks of premium income minus 2 weeks claims (simplified)
  const weeklyPremium   = activePolicies * MODEL_ASSUMPTIONS.weeklyPremium;
  const estimatedReserve = (weeklyPremium * 3) - (weeklyClaimsPaid * 2);
  const coverageRatio   = estimatedReserve / (requiredReserve || 1);

  const passed = coverageRatio >= 1.0;

  return {
    id: 'reserve_sufficiency',
    name: 'Reserve Sufficiency',
    description: 'Validates reserves can absorb a worst-case 48-hour claim surge without liquidity risk',
    passed,
    value: `₹${(estimatedReserve / 100000).toFixed(1)}L`,
    threshold: `≥ ₹${(requiredReserve / 100000).toFixed(1)}L`,
    ratio: coverageRatio,
    severity: passed ? SEVERITY.PASS : coverageRatio >= 0.7 ? SEVERITY.WARNING : SEVERITY.CRITICAL,
    explanation: passed
      ? `Estimated reserves (₹${(estimatedReserve / 100000).toFixed(1)}L) cover ${(coverageRatio * 100).toFixed(0)}% of worst-case 48h exposure — sufficient buffer.`
      : `Estimated reserves (₹${(estimatedReserve / 100000).toFixed(1)}L) cover only ${(coverageRatio * 100).toFixed(0)}% of worst-case exposure — liquidity risk.`,
    metric: `${(coverageRatio * 100).toFixed(0)}%`,
  };
}

/**
 * 4. Fraud Cost Impact — Is fraud rate below sustainability threshold?
 */
function validateFraudCostImpact(metrics) {
  const fraudRate = parseFloat(String(metrics.fraud_rate || '1.8').replace('%', '')) / 100;
  const passed = fraudRate <= MODEL_ASSUMPTIONS.maxFraudRate;

  const weeklyClaimsPaid = parseFloat(String(metrics.claims_paid || '₹22.1L').replace(/[₹,L]/g, '')) * 100000;
  const fraudCost = weeklyClaimsPaid * fraudRate;

  return {
    id: 'fraud_cost_impact',
    name: 'Fraud Cost Impact',
    description: 'Validates fraud rate stays below the 3% sustainability threshold',
    passed,
    value: `${(fraudRate * 100).toFixed(1)}%`,
    threshold: `≤ ${MODEL_ASSUMPTIONS.maxFraudRate * 100}%`,
    ratio: fraudRate,
    severity: passed ? SEVERITY.PASS : fraudRate <= 0.05 ? SEVERITY.WARNING : SEVERITY.CRITICAL,
    explanation: passed
      ? `Fraud rate of ${(fraudRate * 100).toFixed(1)}% is below the ${MODEL_ASSUMPTIONS.maxFraudRate * 100}% threshold. Estimated fraud cost: ₹${(fraudCost / 100000).toFixed(2)}L/week — within acceptable bounds.`
      : `Fraud rate of ${(fraudRate * 100).toFixed(1)}% exceeds the ${MODEL_ASSUMPTIONS.maxFraudRate * 100}% threshold. Fraud is costing ₹${(fraudCost / 100000).toFixed(2)}L/week — investigate anomalies.`,
    metric: `${(fraudRate * 100).toFixed(1)}%`,
  };
}

/**
 * 5. Unit Economics — Is per-policy margin positive?
 */
function validateUnitEconomics(metrics) {
  const activePolicies    = parseInt(String(metrics.active_policies || '47280').replace(/,/g, ''));
  const weeklyPremium     = MODEL_ASSUMPTIONS.weeklyPremium;
  const weeklyClaimsPaid  = parseFloat(String(metrics.claims_paid || '₹22.1L').replace(/[₹,L]/g, '')) * 100000;
  const perPolicyClaimCost = weeklyClaimsPaid / (activePolicies || 1);

  const operatingCost  = weeklyPremium * MODEL_ASSUMPTIONS.operatingCostPct;
  const reinsuranceCost = weeklyPremium * MODEL_ASSUMPTIONS.reinsurancePct;
  const totalCostPerPolicy = perPolicyClaimCost + operatingCost + reinsuranceCost;
  const profitPerPolicy = weeklyPremium - totalCostPerPolicy;
  const marginPct = profitPerPolicy / weeklyPremium;

  const passed = marginPct >= MODEL_ASSUMPTIONS.minProfitMarginPct;

  return {
    id: 'unit_economics',
    name: 'Unit Economics',
    description: 'Validates per-policy weekly margin stays above 8% after claims + ops + reinsurance',
    passed,
    value: `₹${profitPerPolicy.toFixed(1)}/policy/wk`,
    threshold: `≥ ₹${(weeklyPremium * MODEL_ASSUMPTIONS.minProfitMarginPct).toFixed(1)}/policy/wk`,
    ratio: marginPct,
    severity: passed ? SEVERITY.PASS : marginPct >= 0 ? SEVERITY.WARNING : SEVERITY.CRITICAL,
    explanation: passed
      ? `Per-policy margin: ₹${profitPerPolicy.toFixed(1)}/week (${(marginPct * 100).toFixed(1)}%). Breakdown: Premium ₹${weeklyPremium} − Claims ₹${perPolicyClaimCost.toFixed(1)} − Ops ₹${operatingCost.toFixed(1)} − Reinsurance ₹${reinsuranceCost.toFixed(1)}.`
      : `Per-policy margin only ₹${profitPerPolicy.toFixed(1)}/week (${(marginPct * 100).toFixed(1)}%) — below the ${MODEL_ASSUMPTIONS.minProfitMarginPct * 100}% target. Adjust pricing or reduce claims.`,
    metric: `${(marginPct * 100).toFixed(1)}%`,
    breakdown: {
      premium: weeklyPremium,
      claimCost: parseFloat(perPolicyClaimCost.toFixed(1)),
      operatingCost: parseFloat(operatingCost.toFixed(1)),
      reinsuranceCost: parseFloat(reinsuranceCost.toFixed(1)),
      profit: parseFloat(profitPerPolicy.toFixed(1)),
    },
  };
}

/**
 * 6. Cohort Sustainability — Are high-risk zones individually viable?
 */
function validateCohortSustainability(zoneBreakdown = []) {
  if (!zoneBreakdown.length) {
    return {
      id: 'cohort_sustainability',
      name: 'Cohort Sustainability',
      description: 'Validates each zone-cohort can sustain its own claim load',
      passed: true,
      value: 'No data',
      threshold: 'All cohorts viable',
      ratio: 1,
      severity: SEVERITY.INFO,
      explanation: 'Insufficient zone data to validate cohort sustainability. Will auto-validate when zone breakdown is available.',
      metric: 'N/A',
    };
  }

  // Check if any high-risk zone has a risk score > 85 (dangerously high)
  const highRiskZones = zoneBreakdown.filter(z => (z.risk_score || 0) > 80);
  const criticalZones = zoneBreakdown.filter(z => (z.risk_score || 0) > 90);

  const passed = criticalZones.length === 0;
  const totalZones = zoneBreakdown.length;
  const viableZones = totalZones - criticalZones.length;

  return {
    id: 'cohort_sustainability',
    name: 'Cohort Sustainability',
    description: 'Validates each zone-cohort can sustain its own claim load without cross-subsidisation',
    passed,
    value: `${viableZones}/${totalZones} viable`,
    threshold: 'All cohorts viable',
    ratio: viableZones / (totalZones || 1),
    severity: passed
      ? (highRiskZones.length > 0 ? SEVERITY.WARNING : SEVERITY.PASS)
      : SEVERITY.CRITICAL,
    explanation: passed
      ? highRiskZones.length > 0
        ? `${highRiskZones.length} high-risk zone(s) detected but within sustainable bounds. Consider premium adjustments for: ${highRiskZones.map(z => z.zone).join(', ')}.`
        : `All ${totalZones} zone cohorts are individually sustainable — no cross-subsidisation needed.`
      : `${criticalZones.length} zone(s) have risk scores above 90 and may require premium surcharges: ${criticalZones.map(z => z.zone).join(', ')}.`,
    metric: `${viableZones}/${totalZones}`,
    flaggedZones: highRiskZones.map(z => z.zone),
  };
}

// ════════════════════════════════════════════════════════════
// Main export: run all validations
// ════════════════════════════════════════════════════════════

/**
 * @param {Object} metrics       — Platform metrics object from /analytics API
 * @param {Array}  zoneBreakdown — Zone risk breakdown array
 * @returns {Object} Full validation report
 */
export function validateBusinessModel(metrics = {}, zoneBreakdown = []) {
  const checks = [
    validatePremiumAdequacy(metrics),
    validateLossRatio(metrics),
    validateReserveSufficiency(metrics),
    validateFraudCostImpact(metrics),
    validateUnitEconomics(metrics),
    validateCohortSustainability(zoneBreakdown),
  ];

  const passed  = checks.filter(c => c.passed).length;
  const total   = checks.length;
  const critical = checks.filter(c => c.severity.level === 'critical').length;
  const warnings = checks.filter(c => c.severity.level === 'warning').length;

  // Overall health score: 100 base, -25 per critical, -10 per warning
  const healthScore = Math.max(0, Math.min(100, 100 - (critical * 25) - (warnings * 10)));

  let healthLabel, healthColor;
  if (healthScore >= 80)      { healthLabel = 'Sustainable';       healthColor = '#10b981'; }
  else if (healthScore >= 60) { healthLabel = 'Needs Attention';   healthColor = '#f59e0b'; }
  else                        { healthLabel = 'At Risk';           healthColor = '#ef4444'; }

  return {
    checks,
    summary: {
      passed,
      total,
      critical,
      warnings,
      healthScore,
      healthLabel,
      healthColor,
    },
    assumptions: MODEL_ASSUMPTIONS,
  };
}

export { MODEL_ASSUMPTIONS };
export default validateBusinessModel;
