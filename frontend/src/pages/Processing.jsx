import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const Processing = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/success');
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div id="s-processing" className="screen">
      <nav><div className="logo">Guardian</div></nav>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
        <div className="spinner">⚙️</div>
        <div style={{ fontSize: '18px', fontWeight: 700, margin: '20px 0 8px' }}>Processing payment...</div>
        <div style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '30px' }}>Razorpay test mode — this is simulated</div>
        <div className="loading-bar" style={{ width: '100%', maxWidth: '300px', margin: '0 auto' }}>
          <div className="loading-fill"></div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '12px' }}>Verifying UPI ID and activating policy...</div>
      </div>
    </div>
  );
};

export default Processing;
