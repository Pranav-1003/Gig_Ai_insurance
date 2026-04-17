import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAppContext } from '../context/AppContext';

const tierConfig = {
  tier1: { label: 'Tier 1 · Auto-Approved', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', eta: 'AI Decision Pending', icon: '✅' },
  tier2: { label: 'Tier 2 · Grace Period', color: '#d97706', bg: '#fffbeb', border: '#fde68a', eta: 'AI Decision Pending', icon: '⏳' },
  tier3: { label: 'Tier 3 · Human Review', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', eta: 'AI Decision Pending', icon: '🔍' },
};

const BCSMeter = ({ score }) => {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 60 ? '#16a34a' : pct >= 35 ? '#d97706' : '#dc2626';
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>Behavioral Coherence Score</span>
        <span style={{ fontWeight: 700, color }}>{pct} / 100</span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.8s ease' }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>
        {pct >= 60 ? 'High trust — auto-approved' : pct >= 35 ? 'Medium — grace period applied' : 'Low — routed to human review'}
      </div>
    </div>
  );
};

const TierBadge = ({ tier, eta, burstThrottled }) => {
  if (!tier || !tierConfig[tier]) return null;
  const cfg = tierConfig[tier];
  return (
    <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '12px 14px', marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 16 }}>{cfg.icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: cfg.color }}>{cfg.label}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
        Estimated payout: <strong style={{ color: cfg.color }}>{eta || cfg.eta}</strong>
      </div>
      {tier === 'tier2' && (
        <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 6, lineHeight: 1.4 }}>
          AI monitors the user's area 24/7. AI is checking if the claim is valid and will decide whether to credit amount.
        </div>
      )}
      {tier === 'tier3' && (
        <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 6, lineHeight: 1.4 }}>
          Payout is held, not rejected. A Guardian agent will review the valid claim and decide whether to credit.
        </div>
      )}
      {burstThrottled && (
        <div style={{ fontSize: 10, background: '#fef3c7', borderRadius: 6, padding: '4px 8px', marginTop: 8, color: '#92400e' }}>
          ⚡ Burst mode active — high claim volume detected in your zone. Verification window extended.
        </div>
      )}
    </div>
  );
};

const Triggers = () => {
  const { user, liveAlert } = useAppContext();
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

  const [activeTrigger, setActiveTrigger] = useState(null);
  const [fraudStages, setFraudStages] = useState({ 1: 'pending', 2: 'pending', 3: 'pending' });
  const [fraudMeta, setFraudMeta] = useState(null); // { bcs_score, tier, payout_eta, burst_throttled }
  // Frozen at the moment of approval — never regenerates on re-render.
  const [txnId, setTxnId] = useState(null);

  const handleLiveEvent = async (event) => {
    setActiveTrigger(event.trigger);
    setFraudStages({ 1: 'pending', 2: 'pending', 3: 'pending' });
    setFraudMeta(null);
    setTxnId(null); // clear previous TXN ID for each new event

    await new Promise(r => setTimeout(r, 800));
    setFraudStages(prev => ({ ...prev, 1: event.fraud?.stage1 || 'pending' }));

    await new Promise(r => setTimeout(r, 1000));
    setFraudStages(prev => ({ ...prev, 2: event.fraud?.stage2 || 'pending' }));

    await new Promise(r => setTimeout(r, 1000));
    setFraudStages(prev => ({ ...prev, 3: event.fraud?.stage3 || 'pending' }));

    // Reveal BCS + tier after all stages animate
    await new Promise(r => setTimeout(r, 400));
    if (event.fraud) {
      const meta = {
        bcs_score: event.fraud.bcs_score ?? 100,
        tier: event.fraud.tier || (event.fraud.approved ? 'tier1' : 'tier3'),
        payout_eta: event.fraud.payout_eta || '',
        burst_throttled: event.fraud.burst_throttled || false,
        approved: event.fraud.approved,
        rejection_reason: event.fraud.rejection_reason || '',
      };
      setFraudMeta(meta);
      // Freeze TXN ID at the moment of approval — stable across all future re-renders.
      if (meta.approved) {
        setTxnId(`GRD${Date.now()}`);
      }
    }
  };

  // Now safe — handleLiveEvent is declared above this useEffect
  useEffect(() => {
    if (liveAlert) handleLiveEvent(liveAlert);
  }, [liveAlert]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulateTrigger = async (type, zoneKey, zoneLabel, label, amount, workers) => {
    try {
      await axios.post(`${API_BASE}/trigger-event`, {
        trigger_type: type,
        zone_key: zoneKey,
        zone_label: zoneLabel,
        workers_affected: parseInt(workers.replace(/,/g, '')),
        user_id: user?.id,
      });
    } catch (e) {
      console.error('Trigger simulation failed', e);
    }
  };

  const allStagesDone = fraudStages[3] !== 'pending';
  const approved = fraudMeta?.approved;

  return (
    <div id="s-admin" className="screen">
      <div className="admin-bar">⚙️ Admin Panel — Disruption Simulator</div>
      <nav>
        <div className="logo">Guardian <span style={{ color: 'var(--red)', fontSize: '11px' }}>ADMIN</span></div>
        <div className="nav-badge">● Monitoring {user?.zone}</div>
      </nav>

      <div className="hero" style={{ padding: '16px 20px' }}>
        <p style={{ fontSize: '13px', color: 'var(--gray-600)' }}>Simulate disruptions in your micro-zone and neighbouring areas. Triggers matching your exact sub-zone result in payout; adjacent or out-of-zone events are AI-rejected with precise boundary reasoning.</p>
      </div>

      <div className="trigger-sim">
        {(() => {
          if (!user || !user.zone_key) return <p style={{ padding: 20 }}>Please register first to simulate localized triggers.</p>;
          const uzk = user.zone_key;
          const uzl = user.zone;

          // ── Granular sub-zone neighbor map ────────────────────────────────
          // Each sub-zone lists its 2 closest micro-zones (adjacent streets /
          // districts), making out-of-zone rejection more meaningful and precise.
          const neighborMap = {
            // Chennai North
            'chennai_north_central':  [{ k: 'chennai_north_suburban', l: 'Chennai – North Suburban' }, { k: 'chennai_west', l: 'Chennai – West' }],
            'chennai_north_suburban': [{ k: 'chennai_north_central',  l: 'Chennai – North Central'  }, { k: 'chennai_west', l: 'Chennai – West' }],
            // Chennai South
            'chennai_south_central':  [{ k: 'chennai_south_coastal',  l: 'Chennai – South Coastal'  }, { k: 'chennai_west', l: 'Chennai – West' }],
            'chennai_south_coastal':  [{ k: 'chennai_south_central',  l: 'Chennai – South Central'  }, { k: 'chennai_north_central', l: 'Chennai – North Central' }],
            'chennai_west':           [{ k: 'chennai_north_suburban', l: 'Chennai – North Suburban'  }, { k: 'chennai_south_central', l: 'Chennai – South Central' }],
            // Madurai
            'madurai_central':        [{ k: 'madurai_north',          l: 'Madurai – North'           }, { k: 'madurai_south', l: 'Madurai – South' }],
            'madurai_north':          [{ k: 'madurai_central',        l: 'Madurai – Central'          }, { k: 'trichy_central', l: 'Trichy – Central' }],
            'madurai_south':          [{ k: 'madurai_central',        l: 'Madurai – Central'          }, { k: 'tirunelveli_central', l: 'Tirunelveli – Central' }],
            // Coimbatore
            'coimbatore_urban':       [{ k: 'coimbatore_periurban',   l: 'Coimbatore – Peri-Urban'    }, { k: 'erode_urban', l: 'Erode – Urban' }],
            'coimbatore_periurban':   [{ k: 'coimbatore_urban',       l: 'Coimbatore – Urban Core'     }, { k: 'erode_periurban', l: 'Erode – Peri-Urban' }],
            // Trichy
            'trichy_central':         [{ k: 'trichy_south',           l: 'Trichy – South'             }, { k: 'madurai_north', l: 'Madurai – North' }],
            'trichy_south':           [{ k: 'trichy_central',         l: 'Trichy – Central'            }, { k: 'madurai_central', l: 'Madurai – Central' }],
            // Salem
            'salem_urban':            [{ k: 'salem_suburban',         l: 'Salem – Suburban'            }, { k: 'erode_urban', l: 'Erode – Urban' }],
            'salem_suburban':         [{ k: 'salem_urban',            l: 'Salem – Urban'               }, { k: 'erode_periurban', l: 'Erode – Peri-Urban' }],
            // Tirunelveli
            'tirunelveli_central':    [{ k: 'tirunelveli_rural',      l: 'Tirunelveli – Rural'          }, { k: 'thoothukudi_port', l: 'Thoothukudi – Port Area' }],
            'tirunelveli_rural':      [{ k: 'tirunelveli_central',    l: 'Tirunelveli – Central'        }, { k: 'thoothukudi_inland', l: 'Thoothukudi – Inland' }],
            // Vellore
            'vellore_central':        [{ k: 'vellore_suburban',       l: 'Vellore – Suburban'          }, { k: 'chennai_north_suburban', l: 'Chennai – North Suburban' }],
            'vellore_suburban':       [{ k: 'vellore_central',        l: 'Vellore – Central'           }, { k: 'salem_suburban', l: 'Salem – Suburban' }],
            // Erode
            'erode_urban':            [{ k: 'erode_periurban',        l: 'Erode – Peri-Urban'          }, { k: 'coimbatore_urban', l: 'Coimbatore – Urban' }],
            'erode_periurban':        [{ k: 'erode_urban',            l: 'Erode – Urban'               }, { k: 'salem_urban', l: 'Salem – Urban' }],
            // Thoothukudi
            'thoothukudi_port':       [{ k: 'thoothukudi_inland',     l: 'Thoothukudi – Inland'         }, { k: 'tirunelveli_central', l: 'Tirunelveli – Central' }],
            'thoothukudi_inland':     [{ k: 'thoothukudi_port',       l: 'Thoothukudi – Port Area'      }, { k: 'tirunelveli_rural', l: 'Tirunelveli – Rural' }],
          };

          const nb = neighborMap[uzk] || [{ k: 'chennai_south', l: 'Chennai South' }, { k: 'madurai', l: 'Madurai' }];

          const triggers = [
            { id: 1, type: 'rain', zk: uzk, zl: uzl, title: `🌧️ Heavy Rain in ${uzl}`, desc: `Simulates 65mm rainfall exceeding threshold. Eligible for payout since you are in ${uzl}.`, amt: '₹500', btnClass: 'btn-primary', btnText: 'Trigger Pass', w: '1,240' },
            { id: 2, type: 'app', zk: uzk, zl: uzl, title: `📵 App Downtime in ${uzl}`, desc: `Simulates platform crash in your active zone. Eligible for payout.`, amt: '₹400', btnClass: 'btn-primary', btnText: 'Trigger Pass', w: '2,150' },
            { id: 3, type: 'heat', zk: uzk, zl: uzl, title: `🌡️ Extreme Heat in ${uzl}`, desc: `Simulates 46°C temperature during peak afternoon. Eligible for payout.`, amt: '₹300', btnClass: 'btn-primary', btnText: 'Trigger Pass', w: '890' },
            { id: 4, type: 'curfew', zk: uzk, zl: uzl, title: `🚫 Delivery Strike in ${uzl}`, desc: `Simulates localized strike preventing operations. Eligible for auto-payout.`, amt: '₹800', btnClass: 'btn-primary', btnText: 'Trigger Pass', w: '340' },
            { id: 5, type: 'rain', zk: nb[0].k, zl: nb[0].l, title: `🌧️ Heavy Rain in ${nb[0].l}`, desc: `Simulates flooding in ${nb[0].l}. Your policy strictly covers ${uzl}.`, amt: '₹500', btnClass: 'btn-danger', btnText: 'Trigger Reject', w: '980' },
            { id: 6, type: 'heat', zk: nb[1].k, zl: nb[1].l, title: `🌡️ Heat Wave in ${nb[1].l}`, desc: `Simulates 47°C heat in ${nb[1].l}. Your policy strictly covers ${uzl}.`, amt: '₹300', btnClass: 'btn-danger', btnText: 'Trigger Reject', w: '650' },
            { id: 7, type: 'closure', zk: nb[0].k, zl: nb[0].l, title: `🏪 Zone Closure in ${nb[0].l}`, desc: `Market lockdown in ${nb[0].l}. Your policy strictly covers ${uzl}.`, amt: '₹350', btnClass: 'btn-danger', btnText: 'Trigger Reject', w: '215' },
            { id: 8, type: 'curfew', zk: nb[1].k, zl: nb[1].l, title: `🚫 Delivery Strike in ${nb[1].l}`, desc: `Simulates severe strike in ${nb[1].l}. Your policy strictly covers ${uzl}.`, amt: '₹800', btnClass: 'btn-danger', btnText: 'Trigger Reject', w: '440' },
          ];

          return triggers.map(t => (
            <div className="sim-card" key={t.id}>
              <div className="sim-title">{t.title}</div>
              <div className="sim-desc">{t.desc}</div>
              <div className="sim-btn-row">
                <button className={`btn ${t.btnClass} btn-sm`} onClick={() => simulateTrigger(t.type, t.zk, t.zl, t.title, t.amt, t.w)}>{t.btnText}</button>
                <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{t.w} workers · {t.amt} each</span>
              </div>
            </div>
          ));
        })()}
      </div>

      {activeTrigger && (
        <div id="claim-processing">
          <div className="alert alert-warning" style={{ margin: '0 20px 12px' }}>
            <span className="alert-icon">⚠️</span>
            <div>
              <div style={{ fontWeight: 700 }}>{activeTrigger.alert_title}</div>
              <div style={{ fontSize: '12px', marginTop: '2px' }}>{activeTrigger.alert_sub}</div>
            </div>
          </div>

          <div style={{ padding: '0 20px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)' }}>
            Fraud verification in progress...
          </div>

          <div className="fraud-steps" style={{ padding: '0 20px' }}>
            {[
              { n: 1, icon: '📍', label: 'Stage 1: GPS & policy validation', passText: '✓ Passed', failText: '✗ Failed' },
              { n: 2, icon: '🤖', label: 'Stage 2: ML anomaly detection (Isolation Forest)', passText: '✓ No anomalies', failText: '⚠ Anomalous' },
              { n: 3, icon: '📍', label: 'Stage 3: Zone boundary + GPS spoof check', passText: '✓ Clean', failText: '✗ Zone mismatch' },
            ].map(({ n, icon, label, passText, failText }) => {
              const s = fraudStages[n];
              return (
                <div key={n} className={`fraud-step ${s === 'passed' ? 'passing' : s === 'failed' ? 'failing' : ''}`}>
                  <span className="fs-icon">{icon}</span>
                  <span className="fs-label">{label}</span>
                  <span className={`fs-status ${s === 'passed' ? 'fs-pass' : s === 'failed' ? 'fs-fail' : 'fs-pending'}`}>
                    {s === 'passed' ? passText : s === 'failed' ? failText : 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── BCS Meter + Tier Badge (shown after all stages animate) ── */}
          {allStagesDone && fraudMeta && (
            <div style={{ padding: '0 20px', marginTop: 4 }}>
              <BCSMeter score={fraudMeta.bcs_score} />
              {approved && (
                <TierBadge
                  tier={fraudMeta.tier}
                  eta={fraudMeta.payout_eta}
                  burstThrottled={fraudMeta.burst_throttled}
                />
              )}
            </div>
          )}

          {/* ── Approved payout card ── */}
          {allStagesDone && approved && (
            <div id="payout-section" style={{ marginTop: '12px', padding: '0 20px' }}>
              <div className="txn-card">
                <div className="txn-from">GUARDIAN sent you</div>
                <div className="txn-amount">₹{activeTrigger.amount}</div>
                <div className="txn-upi">{user?.upi_id || ''} · Axis Bank</div>
                <div className="txn-id">TXN ID: {txnId}</div>
              </div>
              <div className="alert alert-success">
                <span className="alert-icon">✅</span>
                <span>Payment credited to your UPI account. <strong>{activeTrigger.workers_affected} workers</strong> received payouts for this event.</span>
              </div>
            </div>
          )}

          {/* ── Rejected card ── */}
          {allStagesDone && !approved && fraudMeta && (
            <div id="rejection-section" style={{ marginTop: '12px', padding: '0 20px' }}>
              <div className="rejection-card">
                <div className="rejection-header">
                  <div className="rejection-icon-wrap">🚫</div>
                  <div>
                    <div className="rejection-title">Claim Rejected</div>
                    <div className="rejection-subtitle">Not eligible for this event</div>
                  </div>
                </div>
                <div className="rejection-divider"></div>
                <div className="rejection-row"><span className="rejection-label">Event location</span><span className="rejection-value mismatch">{activeTrigger.zone_label}</span></div>
                <div className="rejection-row"><span className="rejection-label">Your enrolled zone</span><span className="rejection-value match">{user?.zone}</span></div>
                <div className="ai-reasoning-box">
                  <div className="ai-reasoning-label">🤖 Guardian AI · Reason</div>
                  <div className="ai-reasoning-text">{fraudMeta.rejection_reason || `Your active policy covers ${user?.zone} zone only.`}</div>
                </div>
                {fraudMeta.bcs_score !== undefined && (
                  <div style={{ marginTop: 10 }}>
                    <BCSMeter score={fraudMeta.bcs_score} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Triggers;
