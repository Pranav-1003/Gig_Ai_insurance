import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import useWebSocket from './hooks/useWebSocket';

// Pages
import Landing from './pages/Landing';
import Register from './pages/Register';
import Payment from './pages/Payment';
import Processing from './pages/Processing';
import Success from './pages/Success';
import Dashboard from './pages/Dashboard';
import Triggers from './pages/Triggers';
import Analytics from './pages/Analytics';
import Profile from './pages/Profile';
import Login from './pages/Login';
import AdminLogin from './pages/AdminLogin';

const AppContent = () => {
  const { user, liveAlert, setLiveAlert } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Connect WebSocket if user logged in
  useWebSocket(user?.id);

  // RBAC Routing Guards
  useEffect(() => {
    const isWorkerRoute = ['/dashboard', '/triggers', '/profile', '/payment', '/processing'].includes(location.pathname);
    const isAdminRoute = ['/analytics'].includes(location.pathname);
    
    if (user) {
      const isAdmin = ['superadmin', 'analyst', 'ops'].includes(user.role);
      if (isAdmin && isWorkerRoute) {
        navigate('/analytics', { replace: true });
      } else if (!isAdmin && isAdminRoute) {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, location.pathname, navigate]);

  // Hidden Nav on certain screens & RBAC
  const isAdmin = user && ['superadmin', 'analyst', 'ops'].includes(user.role);
  const showBottomNav = !isAdmin && ['/dashboard', '/triggers', '/profile'].includes(location.pathname);

  return (
    <div className="flex-1 flex flex-col">
      {liveAlert && !isAdmin && (
        <div className="live-alert-banner" onClick={() => navigate('/triggers')}>
          ⚡ {liveAlert.trigger.alert_title} — Fraud Verification In Progress...
        </div>
      )}

      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route path="/register" element={<Register />} />
        <Route path="/payment" element={<Payment />} />
        <Route path="/processing" element={<Processing />} />
        <Route path="/success" element={<Success />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/triggers" element={<Triggers />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>

      {showBottomNav && (
        <div className="bottom-nav">
          <button className={`bn-item ${location.pathname === '/dashboard' ? 'active' : ''}`} onClick={() => navigate('/dashboard')}>
            <span className="bn-icon">🏠</span>Home
          </button>
          <button className={`bn-item ${location.pathname === '/triggers' ? 'active' : ''}`} onClick={() => navigate('/triggers')}>
            <span className="bn-icon">⚡</span>Triggers
          </button>
          <button className={`bn-item ${location.pathname === '/profile' ? 'active' : ''}`} onClick={() => navigate('/profile')}>
            <span className="bn-icon">👤</span>Profile
          </button>
        </div>
      )}
    </div>
  );
};

const App = () => {
  return (
    <div className="screen">
      <AppProvider>
        <Router>
          <AppContent />
        </Router>
      </AppProvider>
    </div>
  );
};

export default App;
