import { useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '../context/AppContext';

const useWebSocket = (userId) => {
  const { setLiveAlert } = useAppContext();
  const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:8000';
  // Use a ref so onclose can always call the latest version of connect
  // without triggering the hoisting issue.
  const connectRef = useRef(null);

  const connect = useCallback(() => {
    if (!userId) return null;

    const socket = new WebSocket(`${WS_BASE}/ws/${userId}`);

    socket.onopen = () => {
      console.log('WebSocket Connected');
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket Message:', data);

      if (data.type === 'trigger_fired') {
        setLiveAlert(data);
        // Clear alert after 10 seconds
        setTimeout(() => setLiveAlert(null), 10000);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket Disconnected. Reconnecting...');
      // Call via ref — always points to the declared function, no hoisting issue
      setTimeout(() => connectRef.current?.(), 3000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket Error:', error);
      socket.close();
    };

    return socket;
  }, [userId, WS_BASE, setLiveAlert]);

  // Keep ref in sync with latest connect
  connectRef.current = connect;

  useEffect(() => {
    const socket = connect();
    return () => {
      if (socket) socket.close();
    };
  }, [connect]);
};

export default useWebSocket;
