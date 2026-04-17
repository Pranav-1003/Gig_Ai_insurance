import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAppContext } from '../context/AppContext';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const AdminLogin = () => {
  const navigate = useNavigate();
  const { setSession } = useAppContext();
  
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!formData.username || !formData.password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/auth/admin/login`, formData);
      setSession({
        user: { role: res.data.role, username: res.data.username },
        token: res.data.access_token
      });
      navigate('/analytics');
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 400, width: '100%', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👔</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#3b82f6' }}>Admin Portal</h1>
          <p style={{ color: '#9ca3af', marginTop: 4, fontSize: 14 }}>Secure access for staff only</p>
        </div>

        {error && (
          <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#fca5a5' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input 
              name="username" 
              value={formData.username} 
              onChange={handleChange} 
              placeholder="admin" 
              style={inputStyle} 
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input 
              name="password" 
              type="password" 
              value={formData.password} 
              onChange={handleChange} 
              placeholder="••••••••" 
              style={inputStyle} 
            />
          </div>

          <button type="submit" disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button onClick={() => navigate('/login')}
            style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }}>
            ← Back to Role Selection
          </button>
        </div>
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
  background: '#3b82f6', border: 'none', borderRadius: 8, padding: '14px 0',
  color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%',
  marginTop: 8
};

export default AdminLogin;
