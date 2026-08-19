import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClaudeMark, SearchIcon, PlusIcon, SettingsIcon, FolderIcon,
  ChevronRight, ChevronDown, CopyIcon, TrashIcon, RefreshIcon,
  SidebarIcon, XIcon, ForkIcon
} from '../icons';

function relativeTime(value) {
  if (!value) return '';
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return '';
  const mins = Math.max(0, Math.floor(delta / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const SIDEBAR_DEFAULT_WIDTH = 252;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;

function readSidebarWidth() {
  try {
    const value = Number(localStorage.getItem('claude-harness.sidebar-width'));
    if (Number.isFinite(value)) return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, value));
  } catch { /* ignore */ }
  return SIDEBAR_DEFAULT_WIDTH;
}

function ContextMenu({ menu, onClose, onNewSession, onRename, onDelete, onFork }) {
  if (!menu) return null;
  const width = 188;
  const height = menu.type === 'session' ? 132 : 96;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8));

  const copyPath = async () => {
    const path = menu.type === 'workspace' ? menu.workspace?.path : (menu.workspace?.path || menu.session?.projectPath);
    try { if (path) await navigator.clipboard.writeText(path); } catch { /* ignore */ }
    onClose();
  };

  return (
    <div
      className="fixed z-[120] w-[188px] rounded-xl border border-harness-border bg-harness-panel p-1 shadow-popover"
      style={{ left, top }}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.type === 'workspace' ? (
        <>
          <button className="menu-item" onClick={() => { onClose(); onNewSession(menu.workspace); }}>
            <PlusIcon className="h-3.5 w-3.5" />New session
          </button>
          <button className="menu-item" onClick={copyPath}>
            <CopyIcon className="h-3.5 w-3.5" />Copy path
          </button>
        </>
      ) : (
        <>
          <button className="menu-item" onClick={() => { onClose(); Promise.resolve(onFork(menu.session)).catch(() => {}); }}>
            <ForkIcon className="h-3.5 w-3.5" />Fork session
          </button>
          <button className="menu-item" onClick={() => { onClose(); onRename(menu.session); }}>
            <span className="flex h-4 w-4 items-center justify-center text-[14px] font-semibold">✎</span>Rename
          </button>
          <button className="menu-item" onClick={copyPath}>
            <CopyIcon className="h-3.5 w-3.5" />Copy path
          </button>
          <button className="menu-item text-red-600 hover:text-red-700" onClick={() => { onClose(); onDelete(menu.session); }}>
            <TrashIcon className="h-3.5 w-3.5" />Delete
          </button>
        </>
      )}
    </div>
  );
}

function RenameDialog({ session, onCancel, onSubmit }) {
  const [value, setValue] = useState(session?.name || '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const save = async () => {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      await onSubmit(next);
      onCancel();
    } catch {
      // App-level error UI reports the backend error. Keep the dialog open.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/15 px-4 backdrop-blur-[1px]" onMouseDown={onCancel}>
      <div className="app-dialog w-full max-w-[380px] rounded-2xl border border-[#d9d5ce] bg-harness-panel p-4 shadow-[0_24px_70px_rgba(43,39,34,.20)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[16px] font-semibold text-[#2e2b27]">Rename session</div>
            <div className="mt-0.5 text-[13px] text-[#918d86]">Use a short name that is easy to find later.</div>
          </div>
          <button className="icon-btn ml-auto" onClick={onCancel} title="Close"><XIcon className="h-4 w-4" /></button>
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); save(); }
            if (event.key === 'Escape') onCancel();
          }}
          maxLength={120}
          className="mt-4 h-10 w-full rounded-xl border border-[#d8d4cd] bg-[#fbfaf8] px-3 text-[15px] text-[#34312d] outline-none transition focus:border-[#c5b7ae] focus:bg-harness-panel focus:ring-2 focus:ring-[#eecfc3]/40"
          placeholder="Session name"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-2 text-[14px] font-medium text-[#6d6861] hover:bg-[#f2f0eb]">Cancel</button>
          <button onClick={save} disabled={!value.trim() || saving} className="rounded-lg bg-[#d97757] px-3.5 py-2 text-[14px] font-medium text-white shadow-sm transition hover:bg-[#ca6d50] disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Saving…' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({ session, onCancel, onConfirm }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [selectedAction, setSelectedAction] = useState('cancel');
  const cancelRef = useRef(null);
  const deleteRef = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, []);

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      await onConfirm();
      onCancel();
    } catch (err) {
      setError(err?.message || 'Unable to delete session.');
    } finally {
      setDeleting(false);
    }
  };

  const selectAction = (action) => {
    setSelectedAction(action);
    requestAnimationFrame(() => (action === 'delete' ? deleteRef.current : cancelRef.current)?.focus());
  };

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      selectAction(event.key === 'ArrowRight' ? 'delete' : 'cancel');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (selectedAction === 'delete') remove();
      else onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/15 px-4 backdrop-blur-[1px]"
      onMouseDown={onCancel}
      onKeyDown={handleDialogKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-session-title"
    >
      <div className="app-dialog w-full max-w-[390px] rounded-2xl border border-[#e2d7d2] bg-harness-panel p-4 shadow-[0_24px_70px_rgba(43,39,34,.20)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fff0eb] text-[#c6573a]"><TrashIcon className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div id="delete-session-title" className="text-[16px] font-semibold text-[#2e2b27]">Delete session?</div>
            <div className="mt-1 text-[13px] leading-5 text-[#827d75]">“{session?.name}” will be removed from the local Claude transcript store. This cannot be undone.</div>
          </div>
          <button className="icon-btn" onClick={onCancel} title="Close"><XIcon className="h-4 w-4" /></button>
        </div>
        {error && <div className="mt-3 rounded-lg bg-[#fff0eb] px-3 py-2 text-[13px] text-[#a34229]">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onFocus={() => setSelectedAction('cancel')}
            onClick={onCancel}
            className={`rounded-lg px-3 py-2 text-[14px] font-medium text-[#6d6861] outline-none transition hover:bg-[#f2f0eb] ${selectedAction === 'cancel' ? 'ring-2 ring-[#d9b5a6]/60 bg-[#f5f1ed]' : ''}`}
          >Cancel</button>
          <button
            ref={deleteRef}
            type="button"
            onFocus={() => setSelectedAction('delete')}
            onClick={remove}
            disabled={deleting}
            className={`rounded-lg bg-[#c6573a] px-3.5 py-2 text-[14px] font-medium text-white shadow-sm outline-none transition hover:bg-[#b74b30] disabled:cursor-not-allowed disabled:opacity-50 ${selectedAction === 'delete' ? 'ring-2 ring-[#d98f7b]/60 ring-offset-2' : ''}`}
          >{deleting ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </div>
  );
}

function SessionRow({ workspace, session, selectedId, onSelect, openContextMenu, keyboardActiveKey, setKeyboardActiveKey, attentionSessionIds, attentionClaudeSessionIds }) {
  const needsApproval = Boolean(attentionSessionIds?.has?.(session.id) || attentionClaudeSessionIds?.has?.(session.claudeSessionId));
  return (
    <button
      data-sidebar-nav="true"
      data-sidebar-key={`session:${session.id}`}
      data-sidebar-type="session"
      data-session-id={session.id}
      data-kbd-active={keyboardActiveKey === `session:${session.id}` ? 'true' : 'false'}
      onFocus={() => setKeyboardActiveKey(`session:${session.id}`)}
      onClick={() => onSelect(workspace, session)}
      onContextMenu={(event) => openContextMenu(event, { type: 'session', workspace, session })}
      className={`sidebar-nav-target flex min-h-8 w-full items-center rounded-lg px-2 py-1.5 text-left outline-none transition ${needsApproval ? 'session-needs-approval' : selectedId === session.id ? 'bg-harness-active text-harness-primary' : 'text-harness-muted hover:bg-harness-hover'}`}
      title={session.path}
    >
      <span className={`mr-2 h-1.5 w-1.5 shrink-0 rounded-full ${needsApproval ? 'bg-[#d99a16]' : selectedId === session.id ? 'bg-[#d97757]' : 'border border-[#bdb8af] bg-transparent'}`} />
      <span className="min-w-0 flex-1 truncate text-[14px]">{session.name}</span>
      <span className="ml-2 shrink-0 text-[12px] text-[#9f9a92]">{relativeTime(session.updated || session.created)}</span>
    </button>
  );
}

export default function Sidebar({
  workspaces, selectedId, onSelect, onRefresh, refreshing, onOpenSettings,
  onNewSession, onRenameSession, onForkSession, collapsed, onToggleCollapse,
  mobileOpen = false, onMobileClose = () => {}, focusRequestKey = 0,
  attentionSessionIds = new Set(), attentionClaudeSessionIds = new Set()
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [queryOpen, setQueryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [keyboardActiveKey, setKeyboardActiveKey] = useState(() => selectedId ? `session:${selectedId}` : '');
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const resizeStateRef = useRef(null);
  const sidebarRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem('claude-harness.sidebar-width', String(sidebarWidth)); } catch { /* ignore */ }
  }, [sidebarWidth]);

  useEffect(() => {
    if (selectedId) setKeyboardActiveKey(`session:${selectedId}`);
  }, [selectedId]);

  useEffect(() => {
    if (!focusRequestKey || collapsed) return;
    const timer = window.setTimeout(() => {
      const shell = sidebarRef.current;
      if (!shell) return;
      const allItems = [...shell.querySelectorAll('[data-sidebar-nav="true"]')];
      const activeElement = keyboardActiveKey ? allItems.find((element) => element.dataset.sidebarKey === keyboardActiveKey) : null;
      const selectedElement = selectedId ? allItems.find((element) => element.dataset.sessionId === String(selectedId)) : null;
      const target = activeElement || selectedElement || allItems[0] || null;
      if (!target) return;
      setKeyboardActiveKey(target.dataset.sidebarKey || '');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest' });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [focusRequestKey, collapsed, selectedId, query, keyboardActiveKey]);

  useEffect(() => {
    if (!resizing) return undefined;
    const move = (event) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const next = state.startWidth + (event.clientX - state.startX);
      setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(next))));
    };
    const stop = () => {
      resizeStateRef.current = null;
      setResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [resizing]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setContextMenu(null);
      }
    };
    const closePointer = () => setContextMenu(null);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', closePointer);
    document.addEventListener('mousedown', closePointer);
    document.addEventListener('scroll', closePointer, true);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('resize', closePointer);
      document.removeEventListener('mousedown', closePointer);
      document.removeEventListener('scroll', closePointer, true);
    };
  }, [contextMenu]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspaces.map((workspace) => {
      const sourceSessions = Array.isArray(workspace.sessions) ? workspace.sessions : [];
      const workspaceMatch = !q || workspace.name.toLowerCase().includes(q) || workspace.path.toLowerCase().includes(q);
      const sessions = workspaceMatch ? sourceSessions : sourceSessions.filter((session) => session.name.toLowerCase().includes(q));
      return { ...workspace, sessions, sessionCount: sessions.length };
    }).filter((workspace) => workspace.sessions.length > 0 && (!q || workspace.name.toLowerCase().includes(q) || workspace.path.toLowerCase().includes(q) || workspace.sessions.length > 0));
  }, [workspaces, query]);

  const toggle = (id) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const doDelete = async (session) => {
    const response = await fetch(`/api/session/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Unable to delete session.');
    }
    await onRefresh(true);
  };

  const submitRename = async (name) => {
    if (!renameTarget) return;
    await onRenameSession(renameTarget, name);
  };

  const openContextMenu = (event, menu) => {
    event.preventDefault();
    event.stopPropagation();
    setKeyboardActiveKey(menu.type === 'session' ? `session:${menu.session.id}` : `workspace:${menu.workspace.id}`);
    setContextMenu({ ...menu, x: event.clientX, y: event.clientY });
  };

  const getNavigableItems = () => {
    const shell = sidebarRef.current;
    if (!shell) return [];
    return [...shell.querySelectorAll('[data-sidebar-nav="true"]')].filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });
  };

  const focusNavItem = (element) => {
    if (!element) return;
    setKeyboardActiveKey(element.dataset.sidebarKey || '');
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest' });
  };

  const handleSidebarKeyDown = (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    if (contextMenu && event.key === 'Escape') {
      event.preventDefault();
      setContextMenu(null);
      return;
    }

    const items = getNavigableItems();
    if (!items.length) return;
    const activeElement = document.activeElement?.closest?.('[data-sidebar-nav="true"]');
    let index = activeElement ? items.indexOf(activeElement) : items.findIndex((element) => element.dataset.sidebarKey === keyboardActiveKey);
    if (index < 0 && selectedId) index = items.findIndex((element) => element.dataset.sessionId === String(selectedId));
    if (index < 0) index = 0;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      focusNavItem(items[(index + step + items.length) % items.length]);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusNavItem(event.key === 'Home' ? items[0] : items[items.length - 1]);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      (activeElement || items[index])?.click();
      return;
    }

    const directDeleteKey = !event.ctrlKey && !event.metaKey && !event.altKey && String(event.key || '').toLowerCase() === 'd';
    if (event.key === 'Delete' || event.key === 'Backspace' || directDeleteKey) {
      const current = activeElement || items[index];
      if (current?.dataset.sidebarType === 'session' && current.dataset.sessionId) {
        const session = workspaces.flatMap((workspace) => workspace.sessions || []).find((item) => String(item.id) === current.dataset.sessionId);
        if (session) {
          event.preventDefault();
          setContextMenu(null);
          setDeleteTarget(session);
        }
      }
    }
  };

  const beginResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeStateRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    setResizing(true);
  };

  const renderWorkspace = (workspace) => {
    const key = `ws:${workspace.id}`;
    const isOpen = expanded.has(key) || workspace.sessions.some((session) => session.id === selectedId) || Boolean(query);
    return (
      <div key={workspace.id} className="mb-0.5">
        <div
          className="group flex min-h-8 items-center rounded-lg transition hover:bg-harness-hover"
          onContextMenu={(event) => openContextMenu(event, { type: 'workspace', workspace })}
        >
          <button
            data-sidebar-nav="true"
            data-sidebar-key={`workspace:${workspace.id}`}
            data-sidebar-type="workspace"
            data-workspace-id={workspace.id || ''}
            data-kbd-active={keyboardActiveKey === `workspace:${workspace.id}` ? 'true' : 'false'}
            onFocus={() => setKeyboardActiveKey(`workspace:${workspace.id}`)}
            onClick={() => toggle(key)}
            className="sidebar-nav-target flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left outline-none"
            title={workspace.path}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8f8a82]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8f8a82]" />}
            <FolderIcon className="h-4 w-4 shrink-0 text-[#a86a4d]" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#45413b]">{workspace.name}</span>
            <span className="text-[12px] text-[#a09b93]">{workspace.sessions.length}</span>
          </button>
          <button
            onClick={(event) => { event.stopPropagation(); onNewSession(workspace); }}
            className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-[#9a958d] opacity-55 transition hover:bg-[#dcd8d1] hover:text-[#423e38] hover:opacity-100 group-hover:opacity-100 focus:opacity-100"
            title={`New session in ${workspace.name}`}
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {isOpen && (
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-harness-border pl-1.5">
            {workspace.sessions.map((session) => (
              <SessionRow
                key={session.id}
                workspace={workspace}
                session={session}
                selectedId={selectedId}
                onSelect={(ws, sess) => { onSelect(ws, sess); onMobileClose(); }}
                openContextMenu={openContextMenu}
                keyboardActiveKey={keyboardActiveKey}
                setKeyboardActiveKey={setKeyboardActiveKey}
                attentionSessionIds={attentionSessionIds}
                attentionClaudeSessionIds={attentionClaudeSessionIds}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (collapsed && !mobileOpen) {
    return (
      <aside className="hidden h-screen w-14 shrink-0 flex-col items-center border-r border-harness-border bg-harness-sidebar py-3 md:flex">
        <button className="icon-btn mb-4" onClick={onToggleCollapse} title="Expand sidebar"><SidebarIcon /></button>
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#e9ddd6] text-[#b65f45]"><ClaudeMark className="h-5 w-5" /></div>
        <button className="icon-btn mt-3" onClick={() => onNewSession(null)} title="New session"><PlusIcon /></button>
        <div className="mt-auto"><button className="icon-btn" onClick={onOpenSettings} title="Settings"><SettingsIcon /></button></div>
      </aside>
    );
  }

  return (
    <>
      {mobileOpen && <button type="button" aria-label="Close sidebar" onClick={onMobileClose} className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-[1px] md:hidden" />}
      <aside
        ref={sidebarRef}
        onKeyDown={handleSidebarKeyDown}
        style={{ '--sidebar-width': `${sidebarWidth}px` }}
        className={`sidebar-shell fixed inset-y-0 left-0 z-[90] flex h-[100dvh] w-[86vw] max-w-[320px] shrink-0 flex-col border-r border-harness-border bg-harness-sidebar text-sm text-harness-primary shadow-2xl transition-transform duration-200 ease-out md:relative md:z-auto md:h-screen md:max-w-none md:translate-x-0 md:shadow-none ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${resizing ? 'sidebar-resizing' : ''}`}
      >
        <div className="flex h-12 items-center gap-2 px-3 pt-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#e9ddd6] text-[#b65f45]"><ClaudeMark className="h-[18px] w-[18px]" /></div>
          <div className="text-[15px] font-semibold tracking-[-0.02em] text-[#34312d]">Claude Harness</div>
          <button className="icon-btn ml-auto md:hidden" onClick={onMobileClose} title="Close sidebar"><XIcon className="h-4 w-4" /></button>
          <button className="icon-btn ml-auto hidden md:flex" onClick={onToggleCollapse} title="Collapse sidebar"><SidebarIcon className="h-4 w-4" /></button>
        </div>

        <div className="px-2.5 pb-3 pt-1">
          <button onClick={() => onNewSession(null)} className="flex h-9 w-full items-center gap-2 rounded-xl border border-[#ddd9d2] bg-harness-panel px-3 text-[14px] font-medium text-[#45413b] shadow-sm transition hover:bg-harness-hover">
            <PlusIcon className="h-4 w-4" /> New session
            <span className="ml-auto rounded border border-[#e4e0d9] bg-[#f7f5f1] px-1.5 py-0.5 text-[11px] font-medium text-[#9a958d]">⌘ N</span>
          </button>
        </div>

        <div className="flex items-center px-3 pb-1.5 pt-1 text-[13px] font-medium text-[#77726a]">
          <span>Workspaces</span>
          <div className="ml-auto flex items-center gap-0.5">
            <button className={`icon-btn-xs ${queryOpen ? 'bg-[#e5e2dc] text-[#3e3a35]' : ''}`} onClick={() => setQueryOpen((value) => !value)} title="Search"><SearchIcon className="h-3.5 w-3.5" /></button>
            <button className="icon-btn-xs" onClick={() => onRefresh(false)} title="Rescan"><RefreshIcon className={refreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /></button>
            <button className="icon-btn-xs" onClick={() => onNewSession(null)} title="Add workspace / session"><PlusIcon className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        {queryOpen && (
          <div className="px-2.5 pb-2">
            <div className="flex items-center gap-2 rounded-xl border border-harness-border bg-harness-panel px-2.5 py-2 shadow-sm">
              <SearchIcon className="h-3.5 w-3.5 text-[#9b968f]" />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-[13px] text-[#4d4942] outline-none placeholder:text-[#aaa59e]" placeholder="Search workspaces or sessions" />
            </div>
          </div>
        )}

        <div className="harness-scroll flex-1 overflow-y-auto px-2 pb-4">
          {visible.length === 0 && <div className="px-2 py-8 text-center text-[13px] text-[#aaa59e]">No sessions found</div>}
          {visible.map(renderWorkspace)}
        </div>

        <div className="border-t border-harness-border p-2">
          <button onClick={() => { onMobileClose(); onOpenSettings(); }} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[14px] text-[#5d5952] hover:bg-harness-hover"><SettingsIcon className="h-4 w-4" />Settings</button>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize · Double-click to reset"
          onPointerDown={beginResize}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
          className="sidebar-resize-handle hidden md:block"
        />
      </aside>

      <ContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onNewSession={onNewSession}
        onRename={setRenameTarget}
        onDelete={setDeleteTarget}
        onFork={onForkSession}
      />

      {renameTarget && (
        <RenameDialog session={renameTarget} onCancel={() => setRenameTarget(null)} onSubmit={submitRename} />
      )}

      {deleteTarget && (
        <DeleteDialog session={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => doDelete(deleteTarget)} />
      )}
    </>
  );
}
