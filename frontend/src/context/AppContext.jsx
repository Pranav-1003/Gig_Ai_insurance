import React, { createContext, useContext, useState, useEffect } from 'react';

const AppContext = createContext();

// Helper to read stored session
function readSession() {
  try {
    const raw = sessionStorage.getItem('guardian_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export const AppProvider = ({ children }) => {
  const [session, setSessionState] = useState(() => readSession());
  const [policy, setPolicy] = useState(null);
  const [liveAlert, setLiveAlert] = useState(null);
  const [stats, setStats] = useState(null);

  // session = { user: {...}, token: "..." }
  const user  = session?.user  ?? null;
  const token = session?.token ?? null;

  const setUser = (userData) => {
    if (!userData) {
      sessionStorage.removeItem('guardian_session');
      setSessionState(null);
    } else {
      // Called from old code passing just user obj — preserve token
      const updated = { user: userData, token: session?.token ?? '' };
      sessionStorage.setItem('guardian_session', JSON.stringify(updated));
      setSessionState(updated);
    }
  };

  const setSession = ({ user: userData, token: tok }) => {
    const s = { user: userData, token: tok };
    sessionStorage.setItem('guardian_session', JSON.stringify(s));
    setSessionState(s);
  };

  const logout = () => {
    sessionStorage.removeItem('guardian_session');
    setSessionState(null);
  };

  // Axios default header helper
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  return (
    <AppContext.Provider value={{
      user, setUser, token, authHeaders,
      session, setSession, logout,
      policy, setPolicy,
      liveAlert, setLiveAlert,
      stats, setStats,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
