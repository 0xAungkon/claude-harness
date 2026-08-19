import { useCallback, useEffect, useRef, useState } from 'react';

function cacheKey(kind, key) {
  return key ? `claude-harness.${kind}-cache.${key}` : '';
}

function readCache(kind, key, fallback = '') {
  if (!key) return fallback;
  try {
    const value = localStorage.getItem(cacheKey(kind, key));
    return value == null ? fallback : value;
  } catch { return fallback; }
}

function writeCache(kind, key, value) {
  if (!key) return;
  try { localStorage.setItem(cacheKey(kind, key), String(value ?? '')); } catch { /* ignore quota/private mode */ }
}

function sendValue(kind, key, value, { beacon = false } = {}) {
  if (!key) return Promise.resolve();
  const payload = JSON.stringify({ kind, key, value: String(value ?? '') });
  if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon('/api/ui-state', blob)) return Promise.resolve();
    } catch { /* use fetch fallback */ }
  }
  return fetch('/api/ui-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true
  }).then(() => undefined).catch(() => undefined);
}

/**
 * Per-session last-write-wins text persistence.
 *
 * Each browser tab keeps its own live editor value. Changes are periodically
 * written to the Harness server, and the latest write becomes the value that
 * another device/tab receives when it later opens the session.
 */
export default function usePersistentField(kind, key, { fallback = '', debounceMs = 260 } = {}) {
  const [value, setState] = useState(() => readCache(kind, key, fallback));
  const [loading, setLoading] = useState(Boolean(key));
  const valuesRef = useRef(new Map());
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const activeKeyRef = useRef(key || '');

  const persist = useCallback((targetKey, targetValue, options = {}) => {
    if (!targetKey) return Promise.resolve();
    writeCache(kind, targetKey, targetValue);
    return sendValue(kind, targetKey, targetValue, options);
  }, [kind]);

  const schedule = useCallback((targetKey, targetValue) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(targetKey, targetValue), debounceMs);
  }, [debounceMs, persist]);

  const setValue = useCallback((next) => {
    const targetKey = activeKeyRef.current;
    const current = valuesRef.current.has(targetKey) ? valuesRef.current.get(targetKey) : value;
    const resolved = typeof next === 'function' ? next(current) : next;
    const text = String(resolved ?? '');
    valuesRef.current.set(targetKey, text);
    dirtyRef.current = true;
    setState(text);
    if (targetKey) {
      writeCache(kind, targetKey, text);
      schedule(targetKey, text);
    }
  }, [kind, schedule, value]);

  const saveNow = useCallback((nextValue = undefined) => {
    const targetKey = activeKeyRef.current;
    if (!targetKey) return Promise.resolve();
    const text = nextValue === undefined
      ? String(valuesRef.current.get(targetKey) ?? value ?? '')
      : String(nextValue ?? '');
    valuesRef.current.set(targetKey, text);
    clearTimeout(timerRef.current);
    return persist(targetKey, text);
  }, [persist, value]);

  useEffect(() => {
    const targetKey = key || '';
    activeKeyRef.current = targetKey;
    dirtyRef.current = false;
    clearTimeout(timerRef.current);

    const cached = readCache(kind, targetKey, fallback);
    valuesRef.current.set(targetKey, cached);
    setState(cached);
    setLoading(Boolean(targetKey));

    if (!targetKey) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, key: targetKey });
    fetch(`/api/ui-state?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled || dirtyRef.current || !body) return;
        const remote = typeof body.value === 'string' ? body.value : '';
        valuesRef.current.set(targetKey, remote);
        writeCache(kind, targetKey, remote);
        setState(remote);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timerRef.current);
      const last = String(valuesRef.current.get(targetKey) ?? '');
      persist(targetKey, last, { beacon: true });
    };
  }, [kind, key, fallback, persist]);

  useEffect(() => {
    const flush = () => {
      const targetKey = activeKeyRef.current;
      if (!targetKey) return;
      const last = String(valuesRef.current.get(targetKey) ?? value ?? '');
      clearTimeout(timerRef.current);
      persist(targetKey, last, { beacon: true });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [persist, value]);

  return { value, setValue, loading, saveNow };
}
