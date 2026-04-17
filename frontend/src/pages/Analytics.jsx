import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { validateBusinessModel, MODEL_ASSUMPTIONS } from '../utils/businessModelValidation';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const riskLabelBadgeClass = (label) => {
  if (!label) return 'badge-green';
  if (label === 'Very High') return 'badge-red';
  if (label === 'High') return 'badge-red';
  if (label === 'Medium-High') return 'badge-amber';
  if (label === 'Medium') return 'badge-green';
  return 'badge-green';
};

// ── Mini radial gauge for model health ───────────────────────
const MHG_R = 28;
const MHG_C = 2 * Math.PI * MHG_R;

const ModelHealthGauge = ({ score, label, color }) => {
  const [offset, setOffset] = useState(MHG_C);

  useEffect(() => {
    const t = setTimeout(() => setOffset(MHG_C - (score / 100) * MHG_C), 200);
    return () => clearTimeout(t);
  }, [score]);

  return (
    <div className="model-health-gauge">
      <div className="mhg-ring">
        <svg viewBox="0 0 72 72">
          <circle className="mhg-track" cx="36" cy="36" r={MHG_R} />
          <circle
            className="mhg-fill"
            cx="36" cy="36" r={MHG_R}
            stroke={color}
            strokeDasharray={MHG_C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="mhg-value" style={{ color }}>{score}</div>
      </div>
      <div className="mhg-label" style={{ color }}>{label}</div>
    </div>
  );
};

// ── Business Model Validation Panel ──────────────────────────
const BusinessModelValidationPanel = ({ metrics, zoneBreakdown }) => {
  const report = useMemo(
    () => validateBusinessModel(metrics, zoneBreakdown),
    [metrics, zoneBreakdown]
  );

  const { checks, summary, assumptions } = report;

  const severityBg = (sev) => {
    const map = { pass: 'var(--green-light)', warning: 'var(--amber-light)', critical: 'var(--red-light)', info: 'var(--blue-light)' };
    return map[sev] || 'var(--gray-100)';
  };
  const severityColor = (sev) => {
    const map = { pass: 'var(--green)', warning: 'var(--amber)', critical: 'var(--red)', info: 'var(--blue)' };
    return map[sev] || 'var(--gray-600)';
  };

  return (
    <div className="bm-validation-section">
      {/* Header + Health Gauge */}
      <div className="bm-header">
        <div>
          <div className="bm-title">📊 Business Model Validation</div>
          <div className="bm-desc">
            Programmatic validation of Guardian's unit economics, loss ratios, and sustainability assumptions against live platform data.
          </div>
        </div>
        <ModelHealthGauge
          score={summary.healthScore}
          label={summary.healthLabel}
          color={summary.healthColor}
        />
      </div>

      {/* Summary Bar */}
      <div className="bm-summary-bar">
        <div className="bmsb-item">
          <div className="bmsb-n" style={{ color: 'var(--green)' }}>{summary.passed}</div>
          <div className="bmsb-l">Passed</div>
        </div>
        <div className="bmsb-item">
          <div className="bmsb-n" style={{ color: 'var(--amber)' }}>{summary.warnings}</div>
          <div className="bmsb-l">Warnings</div>
        </div>
        <div className="bmsb-item">
          <div className="bmsb-n" style={{ color: 'var(--red)' }}>{summary.critical}</div>
          <div className="bmsb-l">Critical</div>
        </div>
        <div className="bmsb-item">
          <div className="bmsb-n" style={{ color: 'var(--blue)' }}>{summary.total}</div>
          <div className="bmsb-l">Total Checks</div>
        </div>
      </div>

      {/* Check Cards */}
      <div className="bm-checks-grid">
        {checks.map((check) => (
          <div
            key={check.id}
            className={`bm-check-card severity-${check.severity.level}`}
          >
            <div className="bm-check-header">
              <div className="bm-check-name">
                <span>{check.severity.icon}</span>
                {check.name}
              </div>
              <span
                className="bm-check-status"
                style={{
                  background: severityBg(check.severity.level),
                  color: severityColor(check.severity.level),
                }}
              >
                {check.severity.label}
              </span>
            </div>

            <div className="bm-check-metrics">
              <span className="bm-check-metric">
                Current: <strong>{check.value}</strong>
              </span>
              <span className="bm-check-metric">
                Threshold: <strong>{check.threshold}</strong>
              </span>
            </div>

            <div className="bm-check-explanation">
              {check.explanation}
            </div>

            {/* Unit economics breakdown (if present) */}
            {check.breakdown && (
              <div className="unit-econ-breakdown">
                <div className="ueb-item">
                  <div className="ueb-n" style={{ color: 'var(--blue)' }}>₹{check.breakdown.premium}</div>
                  <div className="ueb-l">Premium</div>
                </div>
                <div className="ueb-item">
                  <div className="ueb-n" style={{ color: 'var(--red)' }}>₹{check.breakdown.claimCost}</div>
                  <div className="ueb-l">Claims</div>
                </div>
                <div className="ueb-item">
                  <div className="ueb-n" style={{ color: 'var(--amber)' }}>₹{check.breakdown.operatingCost}</div>
                  <div className="ueb-l">Ops</div>
                </div>
                <div className="ueb-item">
                  <div className="ueb-n" style={{ color: 'var(--gray-600)' }}>₹{check.breakdown.reinsuranceCost}</div>
                  <div className="ueb-l">Reinsurance</div>
                </div>
                <div className="ueb-item">
                  <div className="ueb-n" style={{ color: check.breakdown.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    ₹{check.breakdown.profit}
                  </div>
                  <div className="ueb-l">Profit</div>
                </div>
              </div>
            )}

            {/* Flagged zones (if present) */}
            {check.flaggedZones && check.flaggedZones.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {check.flaggedZones.map((z, i) => (
                  <span key={i} className="badge badge-amber" style={{ fontSize: 9 }}>⚠ {z}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Model Assumptions */}
      <div className="bm-assumptions">
        <div className="bm-assumptions-title">Model Assumptions</div>
        <div className="bm-assumptions-grid">
          <div className="bma-item"><span>Weekly Premium</span><strong>₹{assumptions.weeklyPremium}</strong></div>
          <div className="bma-item"><span>Max Weekly Payout</span><strong>₹{assumptions.maxWeeklyPayout}</strong></div>
          <div className="bma-item"><span>Target Loss Ratio</span><strong>{assumptions.targetLossRatioLow * 100}–{assumptions.targetLossRatioHigh * 100}%</strong></div>
          <div className="bma-item"><span>Max Fraud Rate</span><strong>{assumptions.maxFraudRate * 100}%</strong></div>
          <div className="bma-item"><span>Min Profit Margin</span><strong>{assumptions.minProfitMarginPct * 100}%</strong></div>
          <div className="bma-item"><span>Reserve Multiplier</span><strong>{assumptions.reserveMultiplier}×</strong></div>
          <div className="bma-item"><span>Operating Cost</span><strong>{assumptions.operatingCostPct * 100}%</strong></div>
          <div className="bma-item"><span>Reinsurance</span><strong>{assumptions.reinsurancePct * 100}%</strong></div>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Analytics Page
// ════════════════════════════════════════════════════════════

const Analytics = () => {
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
  const { authHeaders, logout } = useAppContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await axios.get(`${API_BASE}/analytics`, { headers: authHeaders });
        setData(res.data);
      } catch (e) {
        console.error('Analytics fetch failed', e);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, [API_BASE, authHeaders]);

  if (loading) return <div className="screen flex items-center justify-center spinner">⚙️</div>;

  if (!data) return (
    <div id="s-insurer" className="screen">
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="logo">Guardian <span style={{ color: 'var(--blue)', fontSize: '11px' }}>INSURER VIEW</span></div>
        <button onClick={() => { logout(); navigate('/'); }} style={{ background: 'var(--red)', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Log out</button>
      </nav>
      <div className="hero" style={{ padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
        <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Admin access required</div>
        <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Please log in as an admin to view analytics.</div>
      </div>
    </div>
  );

  const chartData = {
    labels: data.chart.labels,
    datasets: [{
      label: 'Claims Paid',
      data: data.chart.data,
      backgroundColor: '#1a56db',
      borderRadius: 4
    }]
  };

  return (
    <div id="s-insurer" className="screen">
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="logo">Guardian <span style={{ color: 'var(--blue)', fontSize: '11px' }}>INSURER VIEW</span></div>
        <button onClick={() => { logout(); navigate('/'); }} style={{ background: 'var(--red)', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Log out</button>
      </nav>

      <div className="hero" style={{ padding: '16px 20px 12px' }}>
        <div className="section-title">Platform Analytics</div>
        <div style={{ fontSize: '18px', fontWeight: 700 }}>Week of {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </div>

      <div className="insurer-metrics">
        <div className="insurer-metric"><div className="im-n" style={{ color: 'var(--blue)' }}>{data.metrics.active_policies}</div><div className="im-l">Active policies</div></div>
        <div className="insurer-metric"><div className="im-n" style={{ color: 'var(--green)' }}>{data.metrics.premiums_collected}</div><div className="im-l">Premiums collected</div></div>
        <div className="insurer-metric"><div className="im-n" style={{ color: 'var(--amber)' }}>{data.metrics.fraud_rate}%</div><div className="im-l">Fraud rate</div></div>
        <div className="insurer-metric"><div className="im-n" style={{ color: 'var(--green)' }}>{data.metrics.claims_paid}</div><div className="im-l">Claims paid</div></div>
        <div className="insurer-metric"><div className="im-n" style={{ color: 'var(--blue)' }}>{data.metrics.auto_approval}</div><div className="im-l">Auto-approval</div></div>
        <div className="insurer-metric"><div className="im-n" style={{ color: 'var(--green)' }}>{data.metrics.loss_ratio}</div><div className="im-l">Loss ratio</div></div>
      </div>

      <div className="section" style={{ paddingTop: '16px' }}>
        <div className="chart-container">
          <div className="section-title">Claims by Trigger Type</div>
          {data.chart.data.reduce((a, b) => a + b, 0) > 0 ? (
            <Bar data={chartData} options={{ responsive: true, plugins: { legend: { display: false } } }} />
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--gray-400)', padding: '20px 0', textAlign: 'center' }}>No claims processed yet. The chart will update when triggers are fired.</p>
          )}
        </div>
        
        <div className="section-title">Predictive alerts — next 48 hours</div>
        {data.predictive_alerts.map((alert, idx) => (
          <div key={idx} className={`alert alert-${alert.type}`}>
            <span className="alert-icon">{alert.icon}</span>
            <div><div style={{ fontWeight: 600, fontSize: '13px' }}>{alert.title}</div><div style={{ fontSize: '11px', marginTop: '2px' }}>{alert.detail}</div></div>
          </div>
        ))}
      </div>

      {/* ── Business Model Validation ── */}
      <div className="section">
        <div className="section-title">Business Model Validation</div>
        <p style={{ fontSize: '11px', color: 'var(--gray-500)', margin: '0 0 12px', lineHeight: 1.45 }}>
          Programmatic validation of core business assumptions against live platform data. Each check verifies a critical sustainability metric.
        </p>
        <BusinessModelValidationPanel
          metrics={data.metrics}
          zoneBreakdown={data.zone_breakdown || []}
        />
      </div>

      <div className="section pb-20">
        <div className="section-title">Zone risk breakdown</div>
        <p style={{ fontSize: '11px', color: 'var(--gray-500)', margin: '0 0 12px', lineHeight: 1.45 }}>
          Granular sub-zone risk scores. Each city is split into 2–3 micro-zones with individual flood indices, density profiles, and AI risk scores. Premiums and payouts vary at sub-zone level.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(data.zone_breakdown || []).map((zb) => (
            <div key={zb.zone_key || zb.zone} style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'flex-start', gap: '8px' }}>
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{zb.zone}</span>
                  {zb.zone_risk_raw != null && (
                    <div style={{ fontSize: '10px', color: 'var(--gray-400)', marginTop: 2 }}>
                      Zone flood-risk index {zb.zone_risk_raw}/100
                    </div>
                  )}
                </div>
                <span className={`badge ${riskLabelBadgeClass(zb.risk_label)}`} style={{ flexShrink: 0 }}>
                  {zb.risk_label || '—'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-600)', minWidth: '72px' }}>AI risk</div>
                <div className="risk-bar" style={{ flex: 1 }}>
                  <div
                    className="risk-fill"
                    style={{
                      width: `${zb.risk_score ?? 0}%`,
                      background: (zb.risk_score ?? 0) > 75 ? 'var(--red)' : (zb.risk_score ?? 0) > 55 ? 'var(--amber)' : 'var(--green)',
                    }}
                  />
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', minWidth: '36px', textAlign: 'right' }}>
                  {zb.risk_score ?? 0}/100
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Analytics;
