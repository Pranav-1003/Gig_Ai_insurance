import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

import { ZONES } from './Register';

const Profile = () => {
  const navigate = useNavigate();
  const { user, setUser, authHeaders, policy, logout } = useAppContext();
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
  
  const [formData, setFormData] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    upi_id: user?.upi_id || '',
    zone: user?.zone || '',
    zone_key: user?.zone_key || '',
    platform: user?.platform || 'zomato',
    income: user?.income || 4500,
    tenure: user?.tenure || 'mid',
    language: user?.language || '',
    vehicle: user?.vehicle || 'motorcycle',
  });
  
  const [toast, setToast] = useState(false);

  const saveProfile = async () => {
    try {
      await axios.put(`${API_BASE}/auth/user/${user.id}`, formData, { headers: authHeaders });
      setUser({ ...user, ...formData });
      setToast(true);
      setTimeout(() => setToast(false), 2500);
    } catch (e) {
      alert('Failed to save profile');
    }
  };

  const cancelPolicy = async () => {
    if (!confirm('Cancel your active policy? Coverage will end next Sunday.')) return;
    try {
      // Fetch the real policy_id from the dashboard endpoint first
      const dashRes = await axios.get(
        `${API_BASE}/policy/dashboard/${user.id}`,
        { headers: authHeaders }
      );
      const policyId = dashRes.data?.policy?.id;
      if (!policyId) {
        alert('No active policy found to cancel.');
        return;
      }
      await axios.patch(
        `${API_BASE}/policy/${policyId}/cancel`,
        {},
        { headers: authHeaders }
      );
      alert('Cancelled! Coverage expires at end of current term.');
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to cancel policy. Please try again.');
    }
  };

  return (
    <div id="s-profile" className="screen">
      <nav><div className="logo">Guardian <span style={{ color: 'var(--blue)', fontSize: '11px' }}>PROFILE</span></div></nav>

      <div style={{ background: '#fff', padding: '24px 20px 20px', textAlign: 'center', borderBottom: '1px solid var(--gray-200)' }}>
        <div className="prof-avatar">{formData.name.charAt(0)}</div>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>{formData.name}</div>
        <div style={{ fontSize: '13px', color: 'var(--gray-600)' }}>+91 {formData.phone}</div>
        <div style={{ marginTop: '8px' }}>
          {policy?.status === 'active'
            ? <span className="badge badge-green">● Coverage Active</span>
            : <span className="badge badge-amber">● No Active Policy</span>
          }
        </div>
      </div>

      <div style={{ background: 'var(--blue-light)', borderBottom: '1px solid #bfdbfe', padding: '10px 20px', display: 'flex', alignItems: 'center', justifySpaceBetween: 'space-between' }}>
        <span style={{ fontSize: '13px', color: 'var(--blue)', fontWeight: 500 }}>Update your profile details below</span>
        <button className="btn btn-primary btn-sm" onClick={saveProfile}>Save changes</button>
      </div>

      <div style={{ padding: '20px' }}>
        <div className="form-group">
          <label>Full Name</label>
          <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Mobile Number</label>
          <input type="tel" value={formData.phone} disabled style={{ background: 'var(--gray-100)', color: 'var(--gray-400)' }} />
          <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>Phone number cannot be changed</span>
        </div>
        <div className="form-group">
          <label>UPI ID (for payouts)</label>
          <input type="text" value={formData.upi_id} onChange={e => setFormData({ ...formData, upi_id: e.target.value })} placeholder="yourname@upi" />
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '20px 0 10px' }}>
          Work Details
        </div>

        <div className="form-group">
          <label>Zone / Location</label>
          <select value={formData.zone_key} onChange={e => {
            const zKey = e.target.value;
            const zLabel = ZONES.find(z => z.key === zKey)?.label || zKey;
            setFormData({ ...formData, zone_key: zKey, zone: zLabel });
          }}>
            <option value="">Select zone...</option>
            {Array.from(new Set(ZONES.map(z => z.city))).map(city => (
              <optgroup key={city} label={`── ${city} ──`}>
                {ZONES.filter(z => z.city === city).map(z => (
                  <option key={z.key} value={z.key}>
                    {z.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Delivery Platform</label>
          <select value={formData.platform} onChange={e => setFormData({ ...formData, platform: e.target.value })}>
            <option value="zomato">Zomato</option>
            <option value="swiggy">Swiggy</option>
            <option value="amazon">Amazon</option>
            <option value="zepto">Zepto</option>
            <option value="dunzo">Dunzo</option>
          </select>
        </div>
        <div className="form-group">
          <label>Weekly Earnings (₹)</label>
          <input type="number" value={formData.income} onChange={e => setFormData({ ...formData, income: parseFloat(e.target.value) })} />
        </div>
        <div className="form-group">
          <label>Experience</label>
          <select value={formData.tenure} onChange={e => setFormData({ ...formData, tenure: e.target.value })}>
            <option value="new">New (under 6 months)</option>
            <option value="mid">Mid (6–24 months)</option>
            <option value="senior">Senior (2+ years)</option>
          </select>
        </div>
        <div className="form-group">
          <label>Vehicle</label>
          <select value={formData.vehicle} onChange={e => setFormData({ ...formData, vehicle: e.target.value })}>
            <option value="motorcycle">Motorcycle</option>
            <option value="bicycle">Bicycle</option>
            <option value="scooter">Scooter</option>
            <option value="cycle">Cycle</option>
          </select>
        </div>
        <div className="form-group">
          <label>Preferred Language</label>
          <select value={formData.language} onChange={e => setFormData({ ...formData, language: e.target.value })}>
            <option value="Hindi">Hindi</option>
            <option value="Tamil">Tamil</option>
            <option value="Telugu">Telugu</option>
            <option value="Kannada">Kannada</option>
            <option value="Marathi">Marathi</option>
            <option value="English">English</option>
          </select>
        </div>

        <button className="btn btn-primary mt-16" onClick={saveProfile}>💾 Save all changes</button>

        <div style={{ marginTop: '32px' }}>
          <button onClick={() => { logout(); navigate('/'); }} style={{ background: 'var(--red)', border: 'none', color: '#fff', borderRadius: '8px', padding: '12px', width: '100%', fontWeight: 600, cursor: 'pointer' }}>
            Log out from Guardian
          </button>
        </div>

        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--gray-200)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Danger Zone</div>
          <button className="btn btn-secondary" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={cancelPolicy}>Cancel Policy</button>
        </div>
      </div>

      {toast && <div className="toast">✅ Profile saved successfully</div>}
    </div>
  );
};

export default Profile;
