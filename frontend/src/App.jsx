import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import EmptyState from './components/EmptyState';
import SessionView from './components/SessionView';
import SettingsPage from './components/SettingsPage';
import LoginScreen from './components/LoginScreen';
import SessionNotesSidebar from './components/SessionNotesSidebar';
import useHarnessSocket from './useHarnessSocket';

let harnessAudioContext = null;

function getHarnessAudioContext() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!harnessAudioContext || harnessAudioContext.state === 'closed') harnessAudioContext = new AudioContext();
    return harnessAudioContext;
  } catch {
    return null;
  }
}

function unlockHarnessAudio() {
  const context = getHarnessAudioContext();
  if (context?.state === 'suspended') context.resume().catch(() => {});
}

function playHarnessSound(kind = 'permission') {
  try {
    const context = getHarnessAudioContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const start = context.currentTime + 0.01;
    const notes = kind === 'complete'
      ? [{ hz: 523.25, at: 0, len: 0.12 }, { hz: 659.25, at: 0.11, len: 0.12 }, { hz: 783.99, at: 0.22, len: 0.19 }]
      : [{ hz: 660, at: 0, len: 0.15 }, { hz: 880, at: 0.16, len: 0.22 }];
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(kind === 'complete' ? 0.075 : 0.1, start + 0.015);
    gain.gain.setValueAtTime(kind === 'complete' ? 0.075 : 0.1, start + notes.at(-1).at);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + notes.at(-1).at + notes.at(-1).len + 0.08);
    gain.connect(context.destination);
    for (const note of notes) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.hz, start + note.at);
      oscillator.connect(gain);
      oscillator.start(start + note.at);
      oscillator.stop(start + note.at + note.len);
    }
  } catch { /* sound is best-effort */ }
}

function playPermissionSound() { playHarnessSound('permission'); }
function playCompletionSound() { playHarnessSound('complete'); }

const FALLBACK_MODELS = [
  { id: 'default', label: 'Default', source: 'Claude Code' },
  { id: 'best', label: 'Best available', source: 'Claude Code alias' },
  { id: 'sonnet', label: 'Sonnet', source: 'Claude Code alias' },
  { id: 'opus', label: 'Opus', source: 'Claude Code alias' },
  { id: 'haiku', label: 'Haiku', source: 'Claude Code alias' },
  { id: 'fable', label: 'Fable', source: 'Claude Code alias' }
];

function readStored(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
  catch { return fallback; }
}

function runtimeMap(list) {
  const out = {};
  for (const state of Array.isArray(list) ? list : []) if (state?.key) out[state.key] = state;
  return out;
}

export default function App() {
  const [auth, setAuth] = useState({ loading: true, enabled: false, authenticated: false, user: null });
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [meta, setMeta] = useState(null);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [selected, setSelected] = useState(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [runtimeStates, setRuntimeStates] = useState({});
  const [approvals, setApprovals] = useState([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarFocusRequest, setSidebarFocusRequest] = useState(0);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const stored = Number(readStored('claude-harness.notes-width', 360));
    return Number.isFinite(stored) ? Math.max(280, Math.min(560, stored)) : 360;
  });
  const [theme, setTheme] = useState(() => readStored('claude-harness.theme', 'light'));
  const [newSessionKey, setNewSessionKey] = useState(0);
  const [model, setModel] = useState(() => readStored('claude-harness.model', 'default'));
  const [permissionMode, setPermissionMode] = useState(() => readStored('claude-harness.permission-mode', 'acceptEdits'));
  const [additionalDirs, setAdditionalDirs] = useState(() => readStored('claude-harness.additional-dirs', []));
  const selectedRef = useRef(selected);
  const lastApprovalIdsRef = useRef(new Set());
  const lastRuntimeStatesRef = useRef(new Map());
  const postLoginPathRef = useRef(typeof window !== 'undefined' && window.location.pathname.startsWith('/app') ? window.location.pathname : '/app');

  const navigatePath = useCallback((pathname, { replace = false } = {}) => {
    if (typeof window === 'undefined' || window.location.pathname === pathname) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', pathname);
  }, []);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { try { localStorage.setItem('claude-harness.model', JSON.stringify(model)); } catch {} }, [model]);
  useEffect(() => { try { localStorage.setItem('claude-harness.permission-mode', JSON.stringify(permissionMode)); } catch {} }, [permissionMode]);
  useEffect(() => { try { localStorage.setItem('claude-harness.additional-dirs', JSON.stringify(additionalDirs)); } catch {} }, [additionalDirs]);
  useEffect(() => { try { localStorage.setItem('claude-harness.theme', JSON.stringify(theme)); } catch {} }, [theme]);
  useEffect(() => { try { localStorage.setItem('claude-harness.notes-width', JSON.stringify(rightSidebarWidth)); } catch {} }, [rightSidebarWidth]);

  useEffect(() => {
    const unlock = () => unlockHarnessAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/status', { cache: 'no-store' });
      const body = await response.json();
      setAuth({ loading: false, enabled: Boolean(body.enabled), authenticated: Boolean(body.authenticated), user: body.user || null });
      return body;
    } catch {
      setAuth({ loading: false, enabled: false, authenticated: true, user: null });
      return { enabled: false, authenticated: true };
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  useEffect(() => {
    if (auth.loading) return;
    if (auth.enabled && !auth.authenticated) {
      if (window.location.pathname.startsWith('/app')) postLoginPathRef.current = window.location.pathname;
      navigatePath('/login', { replace: true });
      return;
    }
    if (auth.authenticated && (window.location.pathname === '/login' || !window.location.pathname.startsWith('/app'))) {
      navigatePath('/app', { replace: true });
    }
  }, [auth.loading, auth.enabled, auth.authenticated, navigatePath]);

  const login = async (user, password) => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, password }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to sign in.');
    setAuth({ loading: false, enabled: true, authenticated: true, user: body.user || user });
    navigatePath(postLoginPathRef.current || '/app', { replace: true });
    postLoginPathRef.current = '/app';
  };

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* local state still signs out */ }
    setSettingsOpen(false);
    setRightSidebarOpen(false);
    setSelected(null);
    setApprovals([]);
    setRuntimeStates({});
    setAuth((current) => ({ ...current, loading: false, authenticated: false }));
    postLoginPathRef.current = '/app';
    navigatePath('/login', { replace: true });
  };

  const apiFetch = useCallback(async (url, options = {}) => {
    const response = await fetch(url, options);
    if (response.status === 401) setAuth((current) => ({ ...current, loading: false, authenticated: false }));
    return response;
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const [wsResponse, metaResponse] = await Promise.all([apiFetch('/api/workspaces'), apiFetch('/api/meta')]);
    if (!wsResponse.ok) throw new Error('Unable to load workspaces');
    const nextWorkspaces = await wsResponse.json();
    setWorkspaces(nextWorkspaces);
    setWorkspacesLoaded(true);
    if (metaResponse.ok) setMeta(await metaResponse.json());
    return nextWorkspaces;
  }, [apiFetch]);

  const loadModels = useCallback(async (workspacePath = '') => {
    try {
      const suffix = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      const response = await apiFetch(`/api/models${suffix}`);
      if (!response.ok) return;
      const body = await response.json();
      if (Array.isArray(body.models) && body.models.length) setModels(body.models);
    } catch { /* aliases remain */ }
  }, [apiFetch]);

  const fetchSession = useCallback(async (sessionId) => {
    const response = await apiFetch(`/api/session/${encodeURIComponent(sessionId)}`);
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Unable to load session'); }
    return response.json();
  }, [apiFetch]);

  const handleSocketEvent = useCallback((message) => {
    if (message?.type === 'snapshot') {
      if (Array.isArray(message.runtimes)) {
        setRuntimeStates(runtimeMap(message.runtimes));
        lastRuntimeStatesRef.current = new Map(message.runtimes.filter((state) => state?.key).map((state) => [state.key, state]));
      }
      if (Array.isArray(message.approvals)) setApprovals(message.approvals);
      if (Array.isArray(message.workspaces)) setWorkspaces(message.workspaces);
      if (message.meta) setMeta(message.meta);
      return;
    }
    if (message?.type === 'runtime' && message.state?.key) {
      const next = message.state;
      const previous = lastRuntimeStatesRef.current.get(next.key);
      const wasBusy = Boolean(previous?.active) || ['running', 'waiting_approval'].includes(previous?.status);
      const completed = Boolean(previous) && wasBusy && next.status === 'idle' && !next.active && !next.lastError;
      lastRuntimeStatesRef.current.set(next.key, next);
      setRuntimeStates((current) => ({ ...current, [next.key]: next }));
      if (completed) playCompletionSound();
      return;
    }
    if (message?.type === 'approvals') { setApprovals(Array.isArray(message.approvals) ? message.approvals : []); return; }
    if (message?.type === 'workspaces') {
      if (Array.isArray(message.workspaces)) setWorkspaces(message.workspaces);
      if (message.meta) setMeta(message.meta);
      return;
    }
    if (message?.type === 'session-updated') {
      const current = selectedRef.current;
      let routeRef = '';
      try {
        const match = window.location.pathname.match(/^\/app\/session\/([^/]+)\/?$/);
        if (match) routeRef = decodeURIComponent(match[1]);
      } catch { /* keep routeRef empty */ }
      const routeClaudeId = routeRef.startsWith('runtime:') ? routeRef.slice('runtime:'.length) : routeRef;
      const belongsToVisibleSession = Boolean(message.sessionId) && (
        (current && (current.claudeSessionId === message.claudeSessionId || current.claudeSessionId === message.runtimeKey))
        || routeRef === message.sessionId
        || routeClaudeId === message.claudeSessionId
        || routeClaudeId === message.runtimeKey
      );

      if (belongsToVisibleSession) {
        Promise.all([fetchSession(message.sessionId), loadWorkspaces()]).then(([session, nextWorkspaces]) => {
          const owner = nextWorkspaces.find((workspace) => (workspace.sessions || []).some((item) => item.id === message.sessionId || item.claudeSessionId === message.claudeSessionId));
          setSelected(session);
          if (owner) setSelectedWorkspace(owner);
          navigatePath(`/app/session/${encodeURIComponent(message.sessionId)}`, { replace: true });
        }).catch(() => {});
      } else {
        loadWorkspaces().catch(() => {});
      }
    }
  }, [fetchSession, loadWorkspaces, navigatePath]);

  const socket = useHarnessSocket({ enabled: !auth.loading && auth.authenticated, onEvent: handleSocketEvent });

  useEffect(() => {
    if (!auth.authenticated) return;
    loadWorkspaces().catch((err) => setError(err.message));
    loadModels();
    apiFetch('/api/runtime').then((r) => r.ok ? r.json() : null).then((body) => {
      if (body?.sessions) {
        setRuntimeStates(runtimeMap(body.sessions));
        lastRuntimeStatesRef.current = new Map(body.sessions.filter((state) => state?.key).map((state) => [state.key, state]));
      }
    }).catch(() => {});
    apiFetch('/api/approvals', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((body) => { if (body?.approvals) setApprovals(body.approvals); }).catch(() => {});
  }, [auth.authenticated, apiFetch, loadModels, loadWorkspaces]);

  useEffect(() => {
    const current = new Set(approvals.map((item) => item.id));
    const hasNew = approvals.some((item) => !lastApprovalIdsRef.current.has(item.id));
    if (hasNew) playPermissionSound();
    lastApprovalIdsRef.current = current;
  }, [approvals]);

  useEffect(() => {
    const onGlobalShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 'b' && event.shiftKey) {
        event.preventDefault();
        if (selectedRef.current) setRightSidebarOpen((value) => !value);
      } else if (key === 'b') {
        event.preventDefault();
        if (window.matchMedia('(max-width: 767px)').matches) setMobileSidebarOpen((value) => !value);
        else setSidebarCollapsed((value) => !value);
      } else if (key === 'm') {
        event.preventDefault();
        if (window.matchMedia('(max-width: 767px)').matches) setMobileSidebarOpen(true); else setSidebarCollapsed(false);
        setSidebarFocusRequest((value) => value + 1);
      }
    };
    window.addEventListener('keydown', onGlobalShortcut);
    return () => window.removeEventListener('keydown', onGlobalShortcut);
  }, []);

  useEffect(() => {
    const path = selected?.projectPath || selectedWorkspace?.path || '';
    if (path) loadModels(path);
  }, [selected?.projectPath, selectedWorkspace?.path, loadModels]);

  const refresh = async (quiet = false) => {
    setRefreshing(true); if (!quiet) setError('');
    try {
      const response = await apiFetch('/api/refresh', { method: 'POST' });
      if (!response.ok) throw new Error('Rescan failed');
      const nextWorkspaces = await loadWorkspaces();
      if (selected && !selected.runtimeOnly) {
        const owner = nextWorkspaces.find((ws) => ws.sessions.some((s) => s.id === selected.id));
        if (!owner) { setSelected(null); setSelectedWorkspace(null); } else setSelectedWorkspace(owner);
      }
    } catch (err) { if (!quiet) setError(err.message); }
    finally { setRefreshing(false); }
  };

  const selectSession = async (workspace, sessionMeta, { updateHistory = true } = {}) => {
    setLoadingSession(true); setError('');
    try {
      if (sessionMeta.runtimeOnly) {
        setSelected({ ...sessionMeta, turns: [], runtimeOnly: true });
      } else {
        setSelected(await fetchSession(sessionMeta.id));
      }
      setSelectedWorkspace(workspace);
      setSettingsOpen(false);
      setMobileSidebarOpen(false);
      if (updateHistory) navigatePath(`/app/session/${encodeURIComponent(sessionMeta.id)}`);
    } catch (err) { setError(err.message); }
    finally { setLoadingSession(false); }
  };

  useEffect(() => {
    if (!auth.authenticated || !workspacesLoaded) return undefined;

    let cancelled = false;
    const applyLocation = async () => {
      const pathname = window.location.pathname;
      const match = pathname.match(/^\/app\/session\/([^/]+)\/?$/);
      if (!match) {
        if (pathname === '/app/settings' || pathname === '/app/settings/') {
          if (!cancelled) setSettingsOpen(true);
          return;
        }
        if (!cancelled) setSettingsOpen(false);
        if (pathname === '/app' || pathname === '/app/') {
          if (!cancelled) { setSelected(null); setSelectedWorkspace(null); }
        }
        return;
      }
      if (!cancelled) setSettingsOpen(false);

      let requestedId;
      try { requestedId = decodeURIComponent(match[1]); } catch { requestedId = match[1]; }
      const requestedClaudeId = requestedId.startsWith('runtime:') ? requestedId.slice('runtime:'.length) : requestedId;
      let owner = null;
      let sessionMeta = null;
      for (const workspace of workspaces) {
        const found = (workspace.sessions || []).find((session) => String(session.id) === requestedId
          || String(session.claudeSessionId || '') === requestedId
          || String(session.claudeSessionId || '') === requestedClaudeId);
        if (found) { owner = workspace; sessionMeta = found; break; }
      }

      if (!owner || !sessionMeta) {
        navigatePath('/app', { replace: true });
        if (!cancelled) { setSelected(null); setSelectedWorkspace(null); }
        return;
      }
      if (requestedId.startsWith('runtime:') && !sessionMeta.runtimeOnly && sessionMeta.id) {
        navigatePath(`/app/session/${encodeURIComponent(sessionMeta.id)}`, { replace: true });
      }
      if (selectedRef.current && (String(selectedRef.current.id) === String(sessionMeta.id) || String(selectedRef.current.claudeSessionId || '') === String(sessionMeta.claudeSessionId || ''))) return;

      setLoadingSession(true);
      setError('');
      try {
        const next = sessionMeta.runtimeOnly ? { ...sessionMeta, turns: [], runtimeOnly: true } : await fetchSession(sessionMeta.id);
        if (!cancelled) {
          setSelected(next);
          setSelectedWorkspace(owner);
          setMobileSidebarOpen(false);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    };

    applyLocation();
    const onPopState = () => applyLocation();
    window.addEventListener('popstate', onPopState);
    return () => { cancelled = true; window.removeEventListener('popstate', onPopState); };
  }, [auth.authenticated, workspacesLoaded, workspaces, fetchSession, navigatePath]);

  const runtimeFor = useCallback((session) => {
    if (!session) return null;
    if (session.claudeSessionId && runtimeStates[session.claudeSessionId]) return runtimeStates[session.claudeSessionId];
    return Object.values(runtimeStates).find((state) => state.sessionId === session.id) || null;
  }, [runtimeStates]);

  const runtimeOptions = useCallback(() => ({ permissionMode, model, additionalDirs }), [permissionMode, model, additionalDirs]);

  const forkSession = async (session, throughTimestamp = null) => {
    if (!session) throw new Error('Choose a session first.');
    if (session.runtimeOnly) throw new Error('Wait for the first response before forking this session.');
    setError('');
    try {
      const response = await apiFetch(`/api/session/${encodeURIComponent(session.id)}/fork`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...runtimeOptions(), throughTimestamp: throughTimestamp || null })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to fork Claude session');
      const nextWorkspaces = await loadWorkspaces();
      const owner = nextWorkspaces.find((ws) => ws.sessions.some((item) => item.id === body.sessionId));
      if (!owner) throw new Error('Fork created, but the new session could not be found. Rescan and try again.');
      const forked = await fetchSession(body.sessionId);
      setSelected(forked);
      setSelectedWorkspace(owner);
      setMobileSidebarOpen(false);
      navigatePath(`/app/session/${encodeURIComponent(body.sessionId)}`);
      return body;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const startNewSession = async (workspace, prompt, suppliedOptions = null) => {
    if (!workspace) throw new Error('Choose a workspace first.');
    setError('');
    const options = suppliedOptions || runtimeOptions();
    const response = await apiFetch('/api/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspace.id || null, workspacePath: workspace.path, prompt, ...options })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const err = new Error(body.error || 'Unable to start Claude session'); setError(err.message); throw err; }
    if (body.state?.key) setRuntimeStates((current) => ({ ...current, [body.state.key]: body.state }));
    setSelectedWorkspace(workspace);
    const routeSessionId = body.sessionId || `runtime:${body.claudeSessionId}`;
    setSelected({
      id: routeSessionId,
      claudeSessionId: body.claudeSessionId,
      projectPath: workspace.path,
      projectName: workspace.name,
      name: 'New session',
      turns: [],
      runtimeOnly: !body.sessionId
    });
    navigatePath(`/app/session/${encodeURIComponent(routeSessionId)}`);
    return body;
  };

  const sendWsOrHttp = async (type, wsPayload, fallback) => {
    // Only fall back when no socket is connected before the mutation starts.
    // If a connected socket drops after the server receives a mutation, retrying
    // over HTTP could duplicate a queued prompt. Reconnect + snapshot is safer.
    if (socket.connected) return socket.send(type, wsPayload);
    return fallback();
  };

  const continueSession = async (prompt) => {
    if (!selected) return;
    setError('');
    if (prompt.trim() === '/fork-session') {
      await forkSession(selected);
      return;
    }
    const sessionRef = selected.claudeSessionId || selected.id;
    const options = runtimeOptions();
    const result = await sendWsOrHttp('queue:add', { sessionRef, prompt, runtimeOptions: options }, async () => {
      const response = await apiFetch(`/api/runtime/${encodeURIComponent(sessionRef)}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, runtimeOptions: options }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to queue prompt');
      return body;
    });
    if (result.state?.key) setRuntimeStates((current) => ({ ...current, [result.state.key]: result.state }));
  };

  const stopSession = async () => {
    if (!selected) return;
    const sessionRef = selected.claudeSessionId || selected.id;
    const result = await sendWsOrHttp('runtime:stop', { sessionRef }, async () => {
      const response = await apiFetch(`/api/runtime/${encodeURIComponent(sessionRef)}/stop`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to stop Claude');
      return body;
    });
    if (result.state?.key) setRuntimeStates((current) => ({ ...current, [result.state.key]: result.state }));
    return result;
  };

  const askBtw = async (question) => {
    if (!selected) throw new Error('Choose a session first.');
    const sessionRef = selected.claudeSessionId || selected.id;
    const options = runtimeOptions();
    const result = await sendWsOrHttp('btw:ask', { sessionRef, question, runtimeOptions: options }, async () => {
      const response = await apiFetch(`/api/runtime/${encodeURIComponent(sessionRef)}/btw`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, runtimeOptions: options })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to ask side question');
      return body;
    });
    if (result.state?.key) setRuntimeStates((current) => ({ ...current, [result.state.key]: result.state }));
    return result;
  };

  const mutateQueue = async (action, itemId, payload = {}) => {
    if (!selected) return;
    const sessionRef = selected.claudeSessionId || selected.id;
    const state = runtimeFor(selected);
    if (!state) return;
    let result;
    if (action === 'delete') {
      result = await sendWsOrHttp('queue:delete', { sessionRef, itemId }, async () => {
        const response = await apiFetch(`/api/runtime/${encodeURIComponent(sessionRef)}/queue/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'Unable to delete queued prompt'); return body;
      });
    } else if (action === 'move') {
      result = await sendWsOrHttp('queue:move', { sessionRef, itemId, targetIndex: payload.targetIndex }, async () => {
        const response = await apiFetch(`/api/runtime/${encodeURIComponent(sessionRef)}/queue/${encodeURIComponent(itemId)}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetIndex: payload.targetIndex }) });
        const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'Unable to reorder queue'); return body;
      });
    } else {
      result = await sendWsOrHttp('queue:update', { sessionRef, itemId, ...payload }, async () => {
        const response = await apiFetch(`/api/runtime/${encodeURIComponent(sessionRef)}/queue/${encodeURIComponent(itemId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'Unable to update queued prompt'); return body;
      });
    }
    if (result.state?.key) setRuntimeStates((current) => ({ ...current, [result.state.key]: result.state }));
  };

  const respondApproval = async (approvalId, payload) => {
    const result = await sendWsOrHttp('approval:respond', { approvalId, payload: payload || {} }, async () => {
      const response = await apiFetch(`/api/approvals/${encodeURIComponent(approvalId)}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'Unable to respond to Claude Code'); return body;
    });
    setApprovals((current) => current.filter((item) => item.id !== approvalId));
    return result;
  };

  const renameSession = async (session, name) => {
    const response = await apiFetch(`/api/session/${encodeURIComponent(session.id)}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to rename session');
    await loadWorkspaces();
    if (selected?.id === session.id) setSelected((current) => current ? { ...current, name: body.name || name } : current);
  };

  const newSession = (workspace = null) => {
    setRightSidebarOpen(false);
    setSettingsOpen(false); setSelected(null); setError(''); if (workspace) setSelectedWorkspace(workspace); setMobileSidebarOpen(false); setNewSessionKey((value) => value + 1);
    navigatePath('/app');
  };

  const openSettings = () => {
    setRightSidebarOpen(false);
    setSettingsOpen(true);
    setMobileSidebarOpen(false);
    navigatePath('/app/settings');
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    if (selected?.id) navigatePath(`/app/session/${encodeURIComponent(selected.id)}`);
    else navigatePath('/app');
  };

  useEffect(() => {
    const onNewSessionShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || String(event.key || '').toLowerCase() !== 'n') return;
      event.preventDefault();
      const workspace = selectedWorkspace ? (workspaces.find((item) => item.id === selectedWorkspace.id) || selectedWorkspace) : (workspaces[0] || null);
      newSession(workspace);
    };
    window.addEventListener('keydown', onNewSessionShortcut);
    return () => window.removeEventListener('keydown', onNewSessionShortcut);
  }, [selectedWorkspace, workspaces]);

  const addDirectory = (dir) => { const value = String(dir || '').trim(); if (value) setAdditionalDirs((current) => current.includes(value) ? current : [...current, value].slice(-12)); };
  const preferredWorkspace = useMemo(() => selectedWorkspace ? (workspaces.find((ws) => ws.id === selectedWorkspace.id) || selectedWorkspace) : (workspaces[0] || null), [selectedWorkspace, workspaces]);
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');
  const activeRuntime = runtimeFor(selected);
  const activeApproval = approvals[0] || null;
  const attentionSessionIds = useMemo(() => new Set(approvals.map((item) => item.scannerSessionId).filter(Boolean)), [approvals]);
  const attentionClaudeSessionIds = useMemo(() => new Set(approvals.map((item) => item.sessionId).filter(Boolean)), [approvals]);
  const composerProps = { models, model, onModelChange: setModel, permissionMode, onPermissionModeChange: setPermissionMode, additionalDirs, onAddDir: addDirectory };

  if (auth.loading) return <div className="flex h-screen items-center justify-center bg-[#f7f6f2] text-[15px] text-[#8c8881]">Loading Claude Harness…</div>;
  if (auth.enabled && !auth.authenticated) return <LoginScreen userHint={auth.user || ''} onLogin={login} />;

  return (
    <div className="theme-root flex h-screen overflow-hidden bg-harness-body text-harness-primary" data-theme={theme}>
      <Sidebar
        workspaces={workspaces} selectedId={selected?.id} onSelect={selectSession} onRefresh={refresh} refreshing={refreshing}
        onOpenSettings={openSettings} onNewSession={newSession} onRenameSession={renameSession} onForkSession={forkSession}
        collapsed={sidebarCollapsed} rootPath={meta?.root} onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} focusRequestKey={sidebarFocusRequest}
        attentionSessionIds={attentionSessionIds} attentionClaudeSessionIds={attentionClaudeSessionIds}
      />

      <main className="relative flex min-w-0 flex-1 flex-col bg-harness-body">
        {error && <div className="app-error absolute left-1/2 top-4 z-[70] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-sm leading-5 shadow-lg sm:max-w-[760px]">{error}</div>}
        {loadingSession && <div className="loading-overlay absolute inset-0 z-30 flex items-center justify-center backdrop-blur-[1px]"><div className="loading-pill rounded-full border px-4 py-2 text-sm shadow-sm">Loading session…</div></div>}

        {settingsOpen ? (
          <SettingsPage
            meta={{ ...meta, authEnabled: auth.enabled, user: auth.user }} apiFetch={apiFetch} onReloadWorkspaces={loadWorkspaces}
            onClose={closeSettings} onLogout={auth.enabled ? logout : null} socketConnected={socket.connected}
            theme={theme} onToggleTheme={toggleTheme} onOpenSidebar={() => setMobileSidebarOpen(true)}
          />
        ) : selected ? (
          <SessionView
            key={selected.claudeSessionId || selected.id} session={selected} workspace={selectedWorkspace} onSend={continueSession}
            runtimeState={activeRuntime} onQueueDelete={(id) => mutateQueue('delete', id)}
            onQueuePause={(id, paused) => mutateQueue('update', id, { paused })}
            onQueueEdit={(id, text) => mutateQueue('update', id, { text })}
            onQueueMove={(id, targetIndex) => mutateQueue('move', id, { targetIndex })}
            approval={activeApproval} onRespondApproval={respondApproval}
            socketConnected={socket.connected} socketReconnecting={socket.reconnecting}
            theme={theme} onToggleTheme={toggleTheme} onOpenSidebar={() => setMobileSidebarOpen(true)} onNewSession={newSession} onRenameSession={renameSession}
            onStop={stopSession} onBtw={askBtw} onForkMessage={(turn) => forkSession(selected, turn?.timestamp || null)}
            notesOpen={rightSidebarOpen} onToggleNotes={() => setRightSidebarOpen((value) => !value)} {...composerProps}
          />
        ) : (
          <EmptyState
            key={newSessionKey} rootPath={meta?.root} workspaces={workspaces} preferredWorkspace={preferredWorkspace} onStartSession={startNewSession}
            approval={activeApproval} onRespondApproval={respondApproval} theme={theme} onToggleTheme={toggleTheme} onOpenSidebar={() => setMobileSidebarOpen(true)} {...composerProps}
          />
        )}
      </main>

      <SessionNotesSidebar
        key={selected?.claudeSessionId || selected?.id || 'no-session'}
        open={Boolean(rightSidebarOpen && selected && !settingsOpen)}
        sessionKey={selected?.claudeSessionId || selected?.id || ''}
        sessionName={selected?.name || 'Session'}
        width={rightSidebarWidth}
        onWidthChange={setRightSidebarWidth}
        onClose={() => setRightSidebarOpen(false)}
      />
    </div>
  );
}
