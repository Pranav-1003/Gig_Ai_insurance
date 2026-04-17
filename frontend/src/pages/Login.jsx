import React from 'react';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 600, width: '100%', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🛡️</div>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0, color: '#10b981' }}>Welcome back</h1>
        <p style={{ color: '#9ca3af', marginTop: 8, fontSize: 16, marginBottom: 40 }}>
          Select your account type to continue
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <button 
            onClick={() => navigate('/register')}
            style={{ ...cardStyle, borderColor: '#374151' }}
            onMouseOver={e => e.currentTarget.style.borderColor = '#10b981'}
            onMouseOut={e => e.currentTarget.style.borderColor = '#374151'}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>🛵</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Gig Worker / Delivery Partner</div>
            <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 4 }}>Log in with OTP to view your active policy and claims.</div>
          </button>

          <button 
            onClick={() => navigate('/admin-login')}
            style={{ ...cardStyle, borderColor: '#374151' }}
            onMouseOver={e => e.currentTarget.style.borderColor = '#3b82f6'}
            onMouseOut={e => e.currentTarget.style.borderColor = '#374151'}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>👔</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>System Administrator</div>
            <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 4 }}>Log in with credentials to access analytics and triggers.</div>
          </button>
        </div>
        
        <button onClick={() => navigate('/')}
          style={{ background: 'transparent', border: 'none', color: '#6b7280', marginTop: 32, cursor: 'pointer', fontSize: 14 }}>
          ← Back to homepage
        </button>
      </div>
    </div>
  );
};

const cardStyle = {
  background: '#1f2937', 
  border: '2px solid', 
  borderRadius: 12, 
  padding: '24px 20px', 
  cursor: 'pointer', 
  textAlign: 'left',
  transition: 'border-color 0.2s',
  display: 'block',
  width: '100%',
};

export default Login;
