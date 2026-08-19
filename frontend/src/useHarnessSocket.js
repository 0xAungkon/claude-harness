import { useCallback, useEffect, useRef, useState } from 'react';

export default function useHarnessSocket({ enabled = true, onEvent = () => {} } = {}) {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const socketRef = useRef(null);
  const retryRef = useRef(0);
  const timerRef = useRef(null);
  const closedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const pendingRef = useRef(new Map());

  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!enabled) {
      closedRef.current = true;
      clearTimeout(timerRef.current);
      try { socketRef.current?.close(); } catch { /* ignore */ }
      socketRef.current = null;
      setConnected(false);
      setReconnecting(false);
      return undefined;
    }

    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      setReconnecting(retryRef.current > 0);

      socket.addEventListener('open', () => {
        retryRef.current = 0;
        setConnected(true);
        setReconnecting(false);
      });

      socket.addEventListener('message', (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.type === 'ack' && message.requestId) {
          const pending = pendingRef.current.get(message.requestId);
          if (!pending) return;
          pendingRef.current.delete(message.requestId);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve(message);
          else pending.reject(new Error(message.error || 'Claude Harness WebSocket request failed.'));
          return;
        }
        onEventRef.current?.(message);
      });

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnected(false);
        if (closedRef.current) return;
        retryRef.current += 1;
        setReconnecting(true);
        const delay = Math.min(10000, 400 * (2 ** Math.min(retryRef.current - 1, 5))) + Math.floor(Math.random() * 250);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(connect, delay);
      });

      socket.addEventListener('error', () => {
        try { socket.close(); } catch { /* close event schedules reconnect */ }
      });
    };

    connect();
    return () => {
      closedRef.current = true;
      clearTimeout(timerRef.current);
      const socket = socketRef.current;
      socketRef.current = null;
      try { socket?.close(); } catch { /* ignore */ }
      for (const pending of pendingRef.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebSocket disconnected.'));
      }
      pendingRef.current.clear();
    };
  }, [enabled]);

  const send = useCallback((type, payload = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Claude Harness is reconnecting.'));
      return;
    }
    const requestId = globalThis.crypto?.randomUUID?.() || `ws-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timer = setTimeout(() => {
      pendingRef.current.delete(requestId);
      reject(new Error('Claude Harness WebSocket request timed out.'));
    }, timeoutMs);
    pendingRef.current.set(requestId, { resolve, reject, timer });
    try { socket.send(JSON.stringify({ type, requestId, ...payload })); }
    catch (error) {
      clearTimeout(timer);
      pendingRef.current.delete(requestId);
      reject(error);
    }
  }), []);

  return { connected, reconnecting, send };
}
