import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAppContext } from '../context/AppContext';

const Landing = () => {
  const navigate = useNavigate();
  const { stats, setStats } = useAppContext();
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get(`${API_BASE}/stats`);
        setStats(res.data);
      } catch (e) {
        console.error('Stats fetch failed', e);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div id="s-landing" className="flex flex-col">
      <nav>
        <div className="logo">Guardian<span>by GigShield</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button style={{ background: '#3b82f6', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 600, padding: '6px 16px', borderRadius: '6px' }} onClick={() => navigate('/login')}>Login</button>
          <div className="nav-badge">● Live</div>
        </div>
      </nav>

      <div className="ticker">
        <div className="ticker-inner">
          {stats?.ticker_items?.map((item, idx) => (
            <span key={idx} className="ticker-item">
              <span className={`ticker-dot ${item.dot}`}></span>{item.text}
            </span>
          ))}
          {!stats && <span className="ticker-item">● Guardian real-time protection active...</span>}
        </div>
      </div>

      <div className="hero">
        <div className="hero-tag">🛡️ Parametric Income Insurance</div>
        <h1>Delivery partners lose <span className="highlight">₹1,800/month</span> to disruptions. We pay it back.</h1>
        <p>AI monitors your area 24/7. Upon a claim trigger, the AI will check if the claim is valid and then will decide whether to credit the amount or not.</p>
        <div className="stat-row">
          <div className="stat">
            <div className="n r">₹1,800</div>
            <div className="l">avg monthly loss per worker</div>
          </div>
          <div className="stat">
            <div className="n g">24/7</div>
            <div className="l">AI monitoring</div>
          </div>
          <div className="stat">
            <div className="n b">₹75/wk</div>
            <div className="l">covers ₹2,500 in disruptions</div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/register')}>Check coverage in your area →</button>
      </div>

      <div className="divider"></div>

      <div className="section">
        <div className="section-title">How it works</div>
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <div>
              <div className="step-title">Sign up in 2 minutes</div>
              <div className="step-desc">Phone OTP + work zone + earnings details. No Aadhaar needed for Phase 1.</div>
            </div>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <div>
              <div className="step-title">Pay ₹75/week via UPI</div>
              <div className="step-desc">Renews every Sunday, matching your earnings cycle. Cancel anytime.</div>
            </div>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <div>
              <div className="step-title">AI monitors your zone 24/7</div>
              <div className="step-desc">5 data sources: weather, traffic, govt alerts, platform status, crowd reports.</div>
            </div>
          </div>
          <div className="step">
            <div className="step-num">4</div>
            <div>
              <div className="step-title">Trigger a claim</div>
              <div className="step-desc">AI checks if the claim is valid and decides to credit the amount.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="divider"></div>

      <div className="section">
        <div className="section-title">What we cover (income loss only)</div>
        <div className="triggers">
          <div className="trigger">
            <div className="trigger-left"><div className="trigger-icon">🌧️</div><div><div className="trigger-name">Heavy Rainfall</div><div className="trigger-cond">&gt;50mm/24h + GPS in zone</div></div></div>
            <div className="trigger-amt">₹500</div>
          </div>
          <div className="trigger">
            <div className="trigger-left"><div className="trigger-icon">🌡️</div><div><div className="trigger-name">Heat Wave</div><div className="trigger-cond">&gt;45°C + &gt;70% humidity, 6h+</div></div></div>
            <div className="trigger-amt">₹300</div>
          </div>
          <div className="trigger">
            <div className="trigger-left"><div className="trigger-icon">📵</div><div><div className="trigger-name">Platform Downtime</div><div className="trigger-cond">App unavailable &gt;30 mins</div></div></div>
            <div className="trigger-amt">₹400</div>
          </div>
          <div className="trigger">
            <div className="trigger-left"><div className="trigger-icon">🚫</div><div><div className="trigger-name">Curfew / Strike</div><div className="trigger-cond">Official govt notice + traffic</div></div></div>
            <div className="trigger-amt">₹800</div>
          </div>
          <div className="trigger">
            <div className="trigger-left"><div className="trigger-icon">🏪</div><div><div className="trigger-name">Zone Closure</div><div className="trigger-cond">&gt;40% restaurants closed, 6h+</div></div></div>
            <div className="trigger-amt">₹350</div>
          </div>
        </div>
      </div>

      <div className="section pb-20">
        <button className="btn btn-primary" onClick={() => navigate('/register')}>Get covered now — ₹75/week →</button>
      </div>
    </div>
  );
};

export default Landing;
