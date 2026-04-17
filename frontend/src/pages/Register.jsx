import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAppContext } from '../context/AppContext';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

// Granular sub-zone definitions: each top-level city split into 2–3 micro-zones
// with distinct flood risk, density, and infrastructure profiles.
export const ZONES = [
  // ── Chennai ──────────────────────────────────────────────────
  { key: 'chennai_north_central',  label: 'Chennai – North Central (Tondiarpet / Basin Bridge)',  city: 'Chennai', flood_index: 72 },
  { key: 'chennai_north_suburban', label: 'Chennai – North Suburban (Ambattur / Avadi)',           city: 'Chennai', flood_index: 48 },
  { key: 'chennai_south_central',  label: 'Chennai – South Central (T.Nagar / Adyar)',             city: 'Chennai', flood_index: 65 },
  { key: 'chennai_south_coastal',  label: 'Chennai – South Coastal (Velachery / Sholinganallur)',  city: 'Chennai', flood_index: 85 },
  { key: 'chennai_west',           label: 'Chennai – West (Porur / Vadapalani)',                    city: 'Chennai', flood_index: 44 },

  // ── Madurai ──────────────────────────────────────────────────
  { key: 'madurai_central',        label: 'Madurai – Central (Avaniyapuram / Goripalayam)',        city: 'Madurai', flood_index: 55 },
  { key: 'madurai_north',          label: 'Madurai – North (Melur / Thirumangalam)',                city: 'Madurai', flood_index: 38 },
  { key: 'madurai_south',          label: 'Madurai – South (Sholavandan / Usilampatti)',            city: 'Madurai', flood_index: 42 },

  // ── Coimbatore ───────────────────────────────────────────────
  { key: 'coimbatore_urban',       label: 'Coimbatore – Urban Core (RS Puram / Gandhipuram)',      city: 'Coimbatore', flood_index: 35 },
  { key: 'coimbatore_periurban',   label: 'Coimbatore – Peri-Urban (Kuniyamuthur / Singanallur)',  city: 'Coimbatore', flood_index: 50 },

  // ── Tiruchirappalli ──────────────────────────────────────────
  { key: 'trichy_central',         label: 'Trichy – Central (Srirangam / Ariyamangalam)',          city: 'Tiruchirappalli', flood_index: 60 },
  { key: 'trichy_south',           label: 'Trichy – South (Thillai Nagar / Woraiyur)',             city: 'Tiruchirappalli', flood_index: 52 },

  // ── Salem ─────────────────────────────────────────────────────
  { key: 'salem_urban',            label: 'Salem – Urban (Shevapet / Hasthampatti)',               city: 'Salem', flood_index: 40 },
  { key: 'salem_suburban',         label: 'Salem – Suburban (Attur / Sankagiri)',                  city: 'Salem', flood_index: 30 },

  // ── Tirunelveli ──────────────────────────────────────────────
  { key: 'tirunelveli_central',    label: 'Tirunelveli – Central (Palayamkottai / Melapalayam)',   city: 'Tirunelveli', flood_index: 58 },
  { key: 'tirunelveli_rural',      label: 'Tirunelveli – Rural (Nanguneri / Tenkasi)',             city: 'Tirunelveli', flood_index: 45 },

  // ── Vellore ──────────────────────────────────────────────────
  { key: 'vellore_central',        label: 'Vellore – Central (Katpadi / Gandhi Nagar)',            city: 'Vellore', flood_index: 36 },
  { key: 'vellore_suburban',       label: 'Vellore – Suburban (Gudiyatham / Vaniyambadi)',         city: 'Vellore', flood_index: 28 },

  // ── Erode ────────────────────────────────────────────────────
  { key: 'erode_urban',            label: 'Erode – Urban (Erode Town / Chithode)',                 city: 'Erode', flood_index: 46 },
  { key: 'erode_periurban',        label: 'Erode – Peri-Urban (Perundurai / Bhavani)',             city: 'Erode', flood_index: 38 },

  // ── Thoothukudi ──────────────────────────────────────────────
  { key: 'thoothukudi_port',       label: 'Thoothukudi – Port Area (Harbour / Sipcot)',            city: 'Thoothukudi', flood_index: 70 },
  { key: 'thoothukudi_inland',     label: 'Thoothukudi – Inland (Kovilpatti / Ottapidaram)',       city: 'Thoothukudi', flood_index: 42 },
];

const PLATFORMS = ['zomato','swiggy','amazon','zepto','dunzo'];
const TENURES   = [
  { value: 'new',    label: 'New (< 6 months)' },
  { value: 'mid',    label: 'Mid (6–24 months)' },
  { value: 'senior', label: 'Senior (2+ years)' },
];

const Register = () => {
  const navigate = useNavigate();
  const { setSession, setPolicy } = useAppContext();

  const [step, setStep] = useState('form');   // form | otp | loading
  const [formData, setFormData] = useState({
    phone: '', name: '', platform: '', zone_key: '', income: 4500, tenure: 'mid',
  });
  const [otp, setOtp]               = useState('');
  const [otpSent, setOtpSent]       = useState(false);
  const [devOtp, setDevOtp]         = useState('');
  const [premiumData, setPremiumData] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  // Fetch premium whenever zone/platform/income/tenure changes
  useEffect(() => {
    if (formData.zone_key && formData.platform) fetchPremium();
  }, [formData.zone_key, formData.platform, formData.income, formData.tenure]);

  const fetchPremium = async () => {
    try {
      const res = await axios.get(`${API_BASE}/premium`, {
        params: { zone: formData.zone_key, earnings: formData.income,
                  tenure: formData.tenure, platform: formData.platform },
      });
      setPremiumData(res.data);
    } catch (e) { console.error('Premium fetch failed', e); }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'income' ? Number(value) : value }));
    setError('');
  };

  const handleSendOtp = async () => {
    if (formData.phone.replace(/\D/g,'').length !== 10) {
      setError('Enter a valid 10-digit phone number.'); return;
    }
    if (!formData.zone_key || !formData.platform) {
      setError('Please select zone and platform.'); return;
    }
    setLoading(true); setError('');
    try {
      const res = await axios.post(`${API_BASE}/auth/send-otp`, { phone: formData.phone });
      setOtpSent(true);
      if (res.data.dev_otp) setDevOtp(res.data.dev_otp);   // dev mode only
      setStep('otp');
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to send OTP. Try again.');
    } finally { setLoading(false); }
  };

  const handleRegister = async () => {
    if (otp.length < 4) { setError('Enter the OTP sent to your phone.'); return; }
    setLoading(true); setError('');
    try {
      const res = await axios.post(`${API_BASE}/auth/register`, {
        phone:    formData.phone,
        otp,
        name:     formData.name || 'Delivery Partner',
        zone:     premiumData?.zone_label || formData.zone_key,
        zone_key: formData.zone_key,
        income:   formData.income,
        platform: formData.platform,
        tenure:   formData.tenure,
      });

      setSession({
        user: {
          id:       res.data.user_id,
          phone:    formData.phone,
          name:     res.data.name,
          zone_key: formData.zone_key,
          zone:     premiumData?.zone_label || formData.zone_key,
          income:   formData.income,
          platform: formData.platform,
          tenure:   formData.tenure,
        },
        token: res.data.access_token,
      });

      setPolicy({
        premium:    premiumData?.premium    || 75,
        risk_score: premiumData?.risk_score || 50,
        max_payout: premiumData?.max_payout || 2350,
        zone_label: premiumData?.zone_label || formData.zone_key,
      });

      navigate('/payment');
    } catch (e) {
      setError(e.response?.data?.detail || 'Registration failed. Check OTP and try again.');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛡️</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#10b981' }}>Guardian</h1>
          <p style={{ color: '#9ca3af', marginTop: 4, fontSize: 14 }}>
            Parametric income insurance for gig workers
          </p>
        </div>

        {error && (
          <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 8,
                        padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Full Name" name="name" placeholder="Raju Kumar"
                   value={formData.name} onChange={handleChange} />
            <Field label="Phone Number" name="phone" placeholder="9876543210"
                   value={formData.phone} onChange={handleChange} type="tel" />

            <div>
              <label style={labelStyle}>Delivery Platform</label>
              <select name="platform" value={formData.platform} onChange={handleChange} style={inputStyle}>
                <option value="">Select platform</option>
                {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Your Zone (Micro-Area)</label>
              <select name="zone_key" value={formData.zone_key} onChange={handleChange} style={inputStyle}>
                <option value="">Select your exact zone</option>
                {Array.from(new Set(ZONES.map(z => z.city))).map(city => (
                  <optgroup key={city} label={`── ${city} ──`}>
                    {ZONES.filter(z => z.city === city).map(z => (
                      <option key={z.key} value={z.key}>
                        {z.label} · Flood risk {z.flood_index}/100
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {formData.zone_key && (() => {
                const selected = ZONES.find(z => z.key === formData.zone_key);
                if (!selected) return null;
                const fi = selected.flood_index;
                const color = fi >= 65 ? '#ef4444' : fi >= 45 ? '#f59e0b' : '#10b981';
                const label = fi >= 65 ? 'High flood risk' : fi >= 45 ? 'Medium flood risk' : 'Low flood risk';
                return (
                  <div style={{ marginTop: 6, fontSize: 12, color, fontWeight: 600 }}>
                    📍 {label} — Flood index {fi}/100
                  </div>
                );
              })()}
            </div>

            <div>
              <label style={labelStyle}>Weekly Income (₹)</label>
              <input name="income" type="number" value={formData.income}
                     onChange={handleChange} style={inputStyle} min={2000} max={15000} step={500} />
            </div>

            <div>
              <label style={labelStyle}>Experience</label>
              <select name="tenure" value={formData.tenure} onChange={handleChange} style={inputStyle}>
                {TENURES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {premiumData && (
              <div style={{ background: '#064e3b', border: '1px solid #10b981', borderRadius: 12,
                            padding: 16, marginTop: 4 }}>
                <div style={{ fontSize: 13, color: '#6ee7b7', marginBottom: 4 }}>Your premium (XGBoost AI)</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#10b981' }}>
                  ₹{premiumData.premium}<span style={{ fontSize: 14, color: '#9ca3af' }}>/week</span>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                  {premiumData.ai_explanation}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 12 }}>
                  <span style={{ color: '#fbbf24' }}>Risk: {premiumData.risk_label}</span>
                  <span style={{ color: '#6ee7b7' }}>Max payout: ₹{premiumData.max_payout?.toFixed(0)}</span>
                </div>
              </div>
            )}

            <button onClick={handleSendOtp} disabled={loading}
              style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Sending OTP…' : 'Send OTP →'}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📱</div>
              <p style={{ color: '#d1d5db', margin: 0 }}>
                OTP sent to <strong>{formData.phone}</strong>
              </p>
              {devOtp && (
                <div style={{ background: '#1f2937', borderRadius: 8, padding: '8px 16px',
                              marginTop: 12, fontSize: 13, color: '#fbbf24' }}>
                  Dev mode OTP: <strong>{devOtp}</strong>
                </div>
              )}
            </div>

            <Field label="Enter 6-digit OTP" name="otp" placeholder="123456"
                   value={otp} onChange={(e) => { setOtp(e.target.value); setError(''); }}
                   type="number" />

            <button onClick={handleRegister} disabled={loading}
              style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Verifying…' : 'Verify & Continue →'}
            </button>

            <button onClick={() => setStep('form')}
              style={{ background: 'transparent', border: '1px solid #374151',
                       color: '#9ca3af', borderRadius: 8, padding: '12px 0',
                       cursor: 'pointer', fontSize: 14 }}>
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const labelStyle = { display: 'block', fontSize: 13, color: '#9ca3af', marginBottom: 6, fontWeight: 500 };
const inputStyle = {
  width: '100%', background: '#1f2937', border: '1px solid #374151',
  borderRadius: 8, padding: '12px 14px', color: '#fff', fontSize: 15,
  boxSizing: 'border-box', outline: 'none',
};
const btnStyle = {
  background: '#10b981', border: 'none', borderRadius: 8, padding: '14px 0',
  color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%',
};

const Field = ({ label, name, value, onChange, placeholder, type = 'text' }) => (
  <div>
    <label style={labelStyle}>{label}</label>
    <input name={name} type={type} value={value} onChange={onChange}
           placeholder={placeholder} style={inputStyle} />
  </div>
);

export default Register;
