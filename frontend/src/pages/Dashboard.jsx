import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAppContext } from '../context/AppContext';
import { computeBehavioralProfile } from '../utils/behavioralAnalysis';

const tierInfo = {
  paid:       { label: 'Paid · Tier 1',          badge: 'badge-green',  eta: null },
  processing: { label: 'Grace Period · Tier 2',   badge: 'badge-amber',  eta: 'AI is reviewing your claim' },
  review:     { label: 'Human Review · Tier 3',   badge: 'badge-amber',  eta: 'Routed to human review' },
  rejected:   { label: 'Rejected',                badge: 'badge-red',    eta: null },
};

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

// ── SVG Gauge helper ─────────────────────────────────────────
const GAUGE_R = 50;
const GAUGE_C = 2 * Math.PI * GAUGE_R; // circumference ≈ 314

const scoreColor = (s) => {
  if (s >= 80) return '#10b981';
  if (s >= 55) return '#3b82f6';
  if (s >= 35) return '#f59e0b';
  return '#ef4444';
};

// ── TrustGauge — animated SVG ring ───────────────────────────
const TrustGauge = ({ score, label }) => {
  const [animatedOffset, setAnimatedOffset] = useState(GAUGE_C);
  const color = scoreColor(score);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedOffset(GAUGE_C - (score / 100) * GAUGE_C);
    }, 150);
    return () => clearTimeout(timer);
  }, [score]);

  return (
    <div className="trust-gauge">
      <div className="trust-gauge-ring">
        <svg viewBox="0 0 120 120">
          <circle className="gauge-track" cx="60" cy="60" r={GAUGE_R} />
          <circle
            className="gauge-fill"
            cx="60" cy="60" r={GAUGE_R}
            stroke={color}
            strokeDasharray={GAUGE_C}
            strokeDashoffset={animatedOffset}
          />
        </svg>
        <div className="trust-gauge-value">
          <div className="tgv-score" style={{ color }}>{score}</div>
          <div className="tgv-label" style={{ color }}>{label}</div>
        </div>
      </div>
    </div>
  );
};

// ── SubScoreBar — animated fill bar ──────────────────────────
const SubScoreBar = ({ label, score, weight }) => {
  const [width, setWidth] = useState(0);
  const color = scoreColor(score);

  useEffect(() => {
    const timer = setTimeout(() => setWidth(score), 200);
    return () => clearTimeout(timer);
  }, [score]);

  return (
    <div className="sub-score-item">
      <div className="sub-score-header">
        <span className="sub-score-label">{label}</span>
        <span className="sub-score-value" style={{ color }}>{score}</span>
      </div>
      <div className="sub-score-bar">
        <div
          className="sub-score-fill"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
      <span className="sub-score-weight">Weight: {(weight * 100).toFixed(0)}%</span>
    </div>
  );
};

// ── BehavioralProfilePanel ────────────────────────────────────
const BehavioralProfilePanel = ({ user, claims }) => {
  const profile = useMemo(
    () => computeBehavioralProfile(user, claims, 55),
    [user, claims]
  );

  const { overallScore, subScores, riskProfile, insights, meta } = profile;

  return (
    <div className="section" style={{ paddingBottom: 0 }}>
      <div className="section-title">Your Behavioral Profile</div>

      <div className="behavioral-card">
        <div className="bc-header">
          <div>
            <div className="bc-title">
              🧠 Individual Trust Analysis
            </div>
            <div className="bc-subtitle">
              AI-computed from your claim history, timing patterns, and zone behavior
            </div>
          </div>
          <div
            className="risk-profile-badge"
            style={{
              background: riskProfile.color + '18',
              color: riskProfile.color,
            }}
          >
            {riskProfile.label}
          </div>
        </div>

        {/* Central Trust Gauge */}
        <TrustGauge score={overallScore} label={riskProfile.label} />

        {/* Claim Summary Strip */}
        <div className="claim-summary-strip">
          <div className="css-item">
            <div className="css-n" style={{ color: 'var(--blue)' }}>{meta.totalClaims}</div>
            <div className="css-l">Total Claims</div>
          </div>
          <div className="css-item">
            <div className="css-n" style={{ color: 'var(--green)' }}>{meta.approvedClaims}</div>
            <div className="css-l">Approved</div>
          </div>
          <div className="css-item">
            <div className="css-n" style={{ color: meta.rejectedClaims > 0 ? 'var(--red)' : 'var(--gray-400)' }}>
              {meta.rejectedClaims}
            </div>
            <div className="css-l">Rejected</div>
          </div>
        </div>

        {/* Sub-Scores */}
        <div className="sub-scores">
          {subScores.map((ss) => (
            <SubScoreBar
              key={ss.key}
              label={ss.label}
              score={ss.score}
              weight={ss.weight}
            />
          ))}
        </div>

        {/* Behavioral Insights */}
        <div className="behavioral-insights">
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            🤖 AI Insights
          </div>
          {insights.map((ins, idx) => (
            <div key={idx} className={`bi-item ${ins.type}`}>
              <span className="bi-icon">{ins.icon}</span>
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Dashboard Page
// ════════════════════════════════════════════════════════════

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, authHeaders } = useAppContext();
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

  const [dashData, setDashData] = useState(null);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);

  const userId = user?.id || 1;

  useEffect(() => {
    const fetchDash = async () => {
      try {
        const [dashRes, claimsRes] = await Promise.all([
          axios.get(`${API_BASE}/policy/dashboard/${userId}`, { headers: authHeaders }),
          axios.get(`${API_BASE}/claims/${userId}`, { headers: authHeaders }),
        ]);
        setDashData(dashRes.data);
        setClaims(claimsRes.data);
      } catch (e) {
        console.error('Dashboard fetch failed', e);
      } finally {
        setLoading(false);
      }
    };
    fetchDash();
  }, [userId]);

  if (loading) return <div className="screen flex items-center justify-center spinner">⚙️</div>;

  return (
    <div id="s-dashboard" className="screen">
      <div className="dash-header">
        <div className="dash-welcome">{getGreeting()},</div>
        <div className="dash-name">{dashData?.user?.name || 'Delivery Partner'} 👋</div>
        <div style={{ marginTop: '6px' }}>
          {dashData?.policy?.status === 'active'
            ? <span className="badge badge-green">● Coverage Active</span>
            : <span className="badge badge-amber">● No Active Policy</span>
          }
          {dashData?.policy && (
            <span style={{ fontSize: '11px', color: 'var(--gray-600)', marginLeft: '8px' }}>Renews {dashData?.metrics?.next_renewal}</span>
          )}
        </div>
      </div>

      <div className="metrics">
        <div className="metric"><div className="mn g">₹{dashData?.metrics?.total_protected_month}</div><div className="ml">Total protected this month</div></div>
        <div className="metric"><div className="mn b">{dashData?.metrics?.claims_paid_month}</div><div className="ml">Claims paid this month</div></div>
        <div className="metric"><div className="mn a">₹{dashData?.metrics?.next_premium}</div><div className="ml">Next renewal (Sunday)</div></div>
        <div className="metric"><div className="mn g">{dashData?.metrics?.auto_approval_rate}</div><div className="ml">Auto-approval rate</div></div>
      </div>

      {/* ── Individual Behavioral Analysis Panel ── */}
      <BehavioralProfilePanel user={user} claims={claims} />

      <div className="claims-list">
        <div className="section-title">Recent claims</div>
        {claims.length > 0 ? claims.map(claim => {
          const ti = tierInfo[claim.status] || tierInfo.rejected;
          return (
            <div
              key={claim.id}
              className="claim-item"
              style={claim.status === 'rejected' ? { borderColor: '#fca5a5', background: '#fff9f9' }
                   : claim.status === 'processing' || claim.status === 'review' ? { borderColor: '#fde68a', background: '#fffdf0' }
                   : {}}
            >
              <div className="claim-left">
                <div className="claim-icon">{claim.icon}</div>
                <div>
                  <div className="claim-type">{claim.trigger_label} — {claim.zone}</div>
                  <div className="claim-date">{claim.timestamp}</div>
                  {/* Payout ETA for in-progress tiers */}
                  {ti.eta && (
                    <div style={{ fontSize: 10, color: '#d97706', fontWeight: 600, marginTop: 2 }}>
                      ⏳ {ti.eta}
                    </div>
                  )}
                  {claim.status === 'rejected' && claim.rejection_reason && (
                    <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 4, lineHeight: 1.35 }}>
                      {claim.rejection_reason}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={`claim-amt ${claim.status === 'rejected' ? 'text-gray-400 line-through' : ''}`}>
                  ₹{claim.amount}
                </div>
                <div className={`badge ${ti.badge}`} style={{ fontSize: 10 }}>
                  {ti.label}
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="text-center text-gray-400 py-4 text-xs">No claims yet. Guardian is monitoring your zone.</div>
        )}
      </div>

      <div className="section pb-20">
        <div className="section-title">Current zone status</div>
        {dashData?.zone_status?.map((st, idx) => (
          <div key={idx} className="trigger" style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: '8px' }}>
            <div className="trigger-left">
              <div className="trigger-icon">{st.icon}</div>
              <div>
                <div className="trigger-name">{st.label}</div>
                <div className="trigger-cond">Current: {st.current} — threshold {st.threshold}</div>
              </div>
            </div>
            <div><span className={`badge badge-${st.badge}`}>{st.status}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
