/**
 * Payment.jsx — Razorpay Checkout integration
 *
 * Flow:
 *   1. "Pay" clicked → POST /payment/create-order  (backend creates Razorpay order)
 *   2. Razorpay Checkout modal opens (loads checkout.js from CDN)
 *   3. User completes payment → Razorpay fires onSuccess handler
 *   4. POST /payment/verify  (backend verifies HMAC signature → creates policy)
 *   5. Navigate to /processing
 *
 * If backend is in simulated mode (no real keys), checkout.js is skipped and
 * the verify call is made directly with simulated IDs — dev experience unchanged.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAppContext } from '../context/AppContext';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

// Dynamically load Razorpay checkout.js only when needed
function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const Payment = () => {
  const navigate = useNavigate();
  const { user, policy, setPolicy, authHeaders } = useAppContext();

  const [method, setMethod]           = useState('upi');
  const [upiInput, setUpiInput]       = useState(() => user?.upi_id || '');
  const [upiVerified, setUpiVerified] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 7);
  const fmt = nextDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const amountPaise = Math.round((policy?.premium || 75) * 100);

  // ── Step 4: verify payment + create policy ─────────────────────────────────
  const verifyAndCreatePolicy = async ({ order_id, payment_id, signature }) => {
    const res = await axios.post(
      `${API_BASE}/payment/verify`,
      {
        razorpay_order_id:   order_id,
        razorpay_payment_id: payment_id,
        razorpay_signature:  signature,
        premium:        policy?.premium,
        zone:           user?.zone,
        zone_key:       user?.zone_key,
        risk_score:     policy?.risk_score,
        max_payout:     policy?.max_payout,
        payment_method: method,
        upi_id:         upiInput.trim() || user?.upi_id || '',
      },
      { headers: authHeaders },
    );

    setPolicy({
      ...policy,
      id:            res.data.policy_id,
      policy_number: res.data.policy_number,
      valid_until:   res.data.valid_until,
      status:        'active',
    });
    navigate('/processing');
  };

  // ── Step 1-3: create order → open Razorpay modal ──────────────────────────
  const processPayment = async () => {
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      // Step 1: create order on backend
      const orderRes = await axios.post(
        `${API_BASE}/payment/create-order`,
        {
          amount_paise: amountPaise,
          currency:     'INR',
          receipt:      `policy_user_${user?.id}`,
        },
        { headers: authHeaders },
      );

      const { order_id, key_id, simulated } = orderRes.data;

      // Step 2a: simulated mode (no real Razorpay keys) — skip modal
      if (simulated) {
        await verifyAndCreatePolicy({
          order_id,
          payment_id: `pay_sim_${Date.now()}`,
          signature:  'sim_signature',
        });
        return;
      }

      // Step 2b: real Razorpay — load checkout.js and open modal
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        setError('Could not load payment gateway. Check your connection.');
        setLoading(false);
        return;
      }

      const options = {
        key:         key_id,
        amount:      amountPaise,
        currency:    'INR',
        name:        'Guardian',
        description: 'Weekly income insurance',
        order_id,
        prefill: {
          name:    user?.name || '',
          contact: user?.phone || '',
          vpa:     method === 'upi' ? (upiInput.trim() || '') : '',
        },
        theme: { color: '#6366f1' },
        // Step 3: Razorpay fires this on successful payment
        handler: async (response) => {
          try {
            await verifyAndCreatePolicy({
              order_id,
              payment_id: response.razorpay_payment_id,
              signature:  response.razorpay_signature,
            });
          } catch (e) {
            setError('Payment done but policy creation failed. Contact support with your payment ID: ' + response.razorpay_payment_id);
            setLoading(false);
          }
        },
        modal: {
          ondismiss: () => {
            setLoading(false);
            setError('Payment cancelled. Try again when ready.');
          },
        },
      };

      new window.Razorpay(options).open();

    } catch (e) {
      const msg = e.response?.data?.detail || 'Payment failed. Please try again.';
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div id="s-payment" className="screen">
      <nav>
        <div className="logo">Guardian</div>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/register')}>← Back</button>
      </nav>

      <div className="hero" style={{ paddingBottom: '16px' }}>
        <div className="section-title">Step 2 of 3 — Payment</div>
        <h1 style={{ fontSize: '20px' }}>Activate your coverage</h1>
      </div>

      <div className="pay-card">
        <div className="pay-header">
          <div className="pay-logo">razorpay</div>
          <div className="pay-secure">🔒 Secured &amp; encrypted</div>
        </div>
        <div className="pay-row"><span>Weekly income insurance</span><span>₹{policy?.premium}</span></div>
        <div className="pay-row">
          <span>Zone: {user?.zone}</span>
          <span className={`badge ${policy?.risk_score > 75 ? 'badge-amber' : 'badge-blue'}`}>
            {policy?.risk_score > 75 ? 'High risk' : 'Medium risk'}
          </span>
        </div>
        <div className="pay-row"><span>Coverage valid until</span><span>{fmt}</span></div>
        <div className="pay-row"><span>Total</span><span>₹{policy?.premium}</span></div>

        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)', margin: '16px 0 8px' }}>
          Choose payment method
        </div>
        <div className="pay-methods">
          <button className={`pay-method ${method === 'upi'  ? 'active' : ''}`} onClick={() => setMethod('upi')}>📱 UPI</button>
          <button className={`pay-method ${method === 'card' ? 'active' : ''}`} onClick={() => setMethod('card')}>💳 Card</button>
          <button className={`pay-method ${method === 'nb'   ? 'active' : ''}`} onClick={() => setMethod('nb')}>🏦 Net Banking</button>
        </div>

        {method === 'upi' && (
          <div id="upi-section">
            <div className="upi-input">
              <input
                type="text"
                placeholder="yourname@upi"
                value={upiInput}
                onChange={(e) => { setUpiInput(e.target.value); setUpiVerified(false); }}
              />
              <button
                className="btn btn-secondary btn-sm"
                style={{ flexShrink: 0 }}
                onClick={() => {
                  if (!upiInput.trim()) { alert('Enter your UPI ID'); return; }
                  setUpiVerified(true);
                }}
              >
                Verify
              </button>
            </div>
            {upiVerified && (
              <div className="alert alert-success" style={{ margin: '0 0 12px' }}>
                <span className="alert-icon">✅</span>
                <span>{upiInput.trim()} — verified</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ margin: '0 0 12px' }}>
            <span className="alert-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <button className="btn btn-primary" onClick={processPayment} disabled={loading}>
          {loading ? 'Processing...' : `Pay ₹${policy?.premium} →`}
        </button>
        <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--gray-400)', marginTop: '10px' }}>
          Powered by Razorpay · 256-bit encrypted
        </div>
      </div>
    </div>
  );
};

export default Payment;
