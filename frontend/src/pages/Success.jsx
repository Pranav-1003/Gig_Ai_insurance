import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

const Success = () => {
  const navigate = useNavigate();
  const { policy } = useAppContext();

  return (
    <div id="s-success" className="screen">
      <nav><div className="logo">Guardian</div><div className="nav-badge">✓ Active</div></nav>

      <div className="success-hero">
        <div className="success-icon">✅</div>
        <div className="success-title">Coverage Active!</div>
        <div className="success-sub">You're now protected against income disruptions</div>
      </div>

      <div className="policy-card">
        <div style={{ fontSize: '13px', opacity: 0.85, marginBottom: '4px' }}>Policy #{policy?.policy_number || 'GRD-2024-7841'}</div>
        <div style={{ fontSize: '20px', fontWeight: 700 }}>Income Protection Plan</div>
        <div className="policy-grid">
          <div className="policy-item"><div className="pl">Zone</div><div className="pv">{policy?.zone_label}</div></div>
          <div className="policy-item"><div className="pl">Premium</div><div className="pv">₹{policy?.premium}/week</div></div>
          <div className="policy-item"><div className="pl">Valid until</div><div className="pv">{policy?.valid_until}</div></div>
          <div className="policy-item"><div className="pl">Max payout</div><div className="pv">₹{policy?.max_payout}/week</div></div>
        </div>
      </div>

      <div className="alert alert-info">
        <span className="alert-icon">🤖</span>
        <span>Guardian AI is now monitoring weather, traffic, govt alerts, and platform status in your zone 24/7. You'll receive a push notification the moment a trigger is detected.</span>
      </div>

      <div className="section pb-20">
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>View my dashboard →</button>
      </div>
    </div>
  );
};

export default Success;
