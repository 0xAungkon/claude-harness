import React, { useEffect, useMemo, useState } from 'react';
import { ClaudeMark, FolderIcon, MenuIcon, PlusIcon, RefreshIcon, SettingsIcon, TrashIcon, XIcon } from '../icons';

const MAX_DEPTH = 20;

function newLocation(root = '') {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: 'path',
    value: root || '',
    depth: 5,
    enabled: true
  };
}

function cloneSettings(settings, root) {
  const locations = Array.isArray(settings?.scanLocations) ? settings.scanLocations : [];
  return {
    scanLocations: (locations.length ? locations : [newLocation(root)]).map((item) => ({
      id: String(item.id || `draft-${Math.random().toString(16).slice(2)}`),
      type: item.type === 'regex' ? 'regex' : 'path',
      value: String(item.value || ''),
      depth: Math.max(0, Math.min(MAX_DEPTH, Number(item.depth ?? 5))),
      enabled: item.enabled !== false
    }))
  };
}

function LocationRow({ item, onChange, onRemove }) {
  return (
    <div className="rounded-2xl border border-harness-border bg-harness-panel p-3.5 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)_112px_36px] lg:items-end">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.1em] text-harness-muted">Type</span>
          <select
            value={item.type}
            onChange={(event) => onChange({ ...item, type: event.target.value === 'regex' ? 'regex' : 'path' })}
            className="settings-input h-10 w-full rounded-xl border border-harness-border bg-harness-body px-3 text-[14px] text-harness-primary outline-none"
          >
            <option value="path">Folder</option>
            <option value="regex">Regex</option>
          </select>
        </label>

        <label className="block min-w-0">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.1em] text-harness-muted">{item.type === 'regex' ? 'Path regular expression' : 'Folder path'}</span>
          <div className="relative">
            <FolderIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-harness-muted" />
            <input
              value={item.value}
              onChange={(event) => onChange({ ...item, value: event.target.value })}
              placeholder={item.type === 'regex' ? '^/home/joy/(project1|project2)$' : '/home/joy/project1'}
              spellCheck={false}
              className="settings-input h-10 w-full rounded-xl border border-harness-border bg-harness-body pl-9 pr-3 font-mono text-[13px] text-harness-primary outline-none"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.1em] text-harness-muted">Depth</span>
          <input
            type="number"
            min="0"
            max={MAX_DEPTH}
            value={item.depth}
            onChange={(event) => onChange({ ...item, depth: Math.max(0, Math.min(MAX_DEPTH, Number(event.target.value || 0))) })}
            className="settings-input h-10 w-full rounded-xl border border-harness-border bg-harness-body px-3 text-[14px] text-harness-primary outline-none"
          />
        </label>

        <button type="button" onClick={onRemove} className="icon-btn h-9 w-9 justify-self-end text-harness-muted hover:text-red-600" title="Remove scan location" aria-label="Remove scan location">
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2.5 text-[12px] leading-5 text-harness-muted">
        {item.type === 'regex'
          ? `Regex is matched against absolute workspace paths. Depth controls how far Harness discovers directories beneath the CLI scan root (0–${MAX_DEPTH}).`
          : 'Depth 0 includes only this exact workspace. Increase it to include nested project folders.'}
      </p>
    </div>
  );
}

export default function SettingsPage({
  meta, apiFetch, onReloadWorkspaces, onClose, onLogout = null,
  socketConnected = false, theme = 'light', onToggleTheme = () => {}, onOpenSidebar = () => {}
}) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('general');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/settings', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to load settings.');
      const next = cloneSettings(body.settings, meta?.root || '');
      setSaved(next);
      setDraft(next);
    } catch (err) {
      setError(err.message || 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const dirty = useMemo(() => JSON.stringify(saved || {}) !== JSON.stringify(draft || {}), [saved, draft]);
  const locations = draft?.scanLocations || [];

  const replaceLocation = (id, next) => {
    setDraft((current) => ({ ...current, scanLocations: (current?.scanLocations || []).map((item) => item.id === id ? next : item) }));
  };

  const removeLocation = (id) => {
    setDraft((current) => ({ ...current, scanLocations: (current?.scanLocations || []).filter((item) => item.id !== id) }));
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to save settings.');
      const next = cloneSettings(body.settings, meta?.root || '');
      setSaved(next);
      setDraft(next);
      await onReloadWorkspaces();
      setNotice('Settings saved and sidebar rescanned');
    } catch (err) {
      setError(err.message || 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const rescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    setError('');
    try {
      const response = await apiFetch('/api/settings/rescan', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Rescan failed.');
      await onReloadWorkspaces();
      setNotice('Workspace scan complete');
    } catch (err) {
      setError(err.message || 'Rescan failed.');
    } finally {
      setRescanning(false);
    }
  };

  const discard = () => {
    setDraft(cloneSettings(saved, meta?.root || ''));
    setError('');
    setNotice('Unsaved changes discarded');
  };

  return (
    <section className="settings-page flex h-full min-h-0 flex-1 flex-col bg-harness-body">
      <header className="flex h-14 shrink-0 items-center border-b border-harness-border px-3 sm:px-5">
        <button type="button" onClick={onOpenSidebar} className="icon-btn mr-2 md:hidden" aria-label="Open sidebar"><MenuIcon className="h-5 w-5" /></button>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-harness-active text-harness-accent"><SettingsIcon className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-semibold text-harness-primary">Settings</h1>
            <p className="hidden text-[12px] text-harness-muted sm:block">Configure workspace discovery and Harness behavior</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={rescan} disabled={rescanning} className="toolbar-pill" title="Rescan using saved settings"><RefreshIcon className={`h-3.5 w-3.5 ${rescanning ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Rescan</span></button>
          <button type="button" onClick={onClose} className="icon-btn" title="Close settings"><XIcon className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="border-b border-harness-border px-3 sm:px-5">
        <nav className="flex h-11 items-end gap-1" aria-label="Settings sections">
          <button type="button" onClick={() => setTab('general')} className={`h-10 border-b-2 px-3 text-[14px] font-medium transition ${tab === 'general' ? 'border-harness-accent text-harness-primary' : 'border-transparent text-harness-muted hover:text-harness-primary'}`}>General</button>
        </nav>
      </div>

      <div className="harness-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[960px] px-4 py-5 pb-28 sm:px-6 sm:py-7">
          {loading ? (
            <div className="rounded-2xl border border-harness-border bg-harness-panel px-4 py-10 text-center text-[14px] text-harness-muted">Loading settings…</div>
          ) : tab === 'general' ? (
            <div className="space-y-6">
              <section>
                <div className="mb-3 flex items-start gap-3">
                  <div>
                    <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-harness-primary">Workspace discovery</h2>
                    <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-harness-muted">Choose exactly which folders Harness should surface. Add multiple folder roots, use regular expressions for dynamic sets, and control nested discovery depth independently for each rule.</p>
                  </div>
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, scanLocations: [...(current?.scanLocations || []), newLocation(meta?.root || '')] }))} className="toolbar-pill ml-auto shrink-0"><PlusIcon className="h-3.5 w-3.5" />Add location</button>
                </div>

                <div className="space-y-3">
                  {locations.map((item) => <LocationRow key={item.id} item={item} onChange={(next) => replaceLocation(item.id, next)} onRemove={() => removeLocation(item.id)} />)}
                  {locations.length === 0 && (
                    <button type="button" onClick={() => setDraft((current) => ({ ...current, scanLocations: [newLocation(meta?.root || '')] }))} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-harness-border bg-harness-panel px-4 py-8 text-[14px] font-medium text-harness-muted transition hover:bg-harness-hover hover:text-harness-primary"><PlusIcon className="h-4 w-4" />Add your first scan location</button>
                  )}
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-harness-border bg-harness-panel p-4">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-harness-muted">CLI scan root</div>
                  <div className="mt-2 break-all font-mono text-[13px] text-harness-primary">{meta?.root || '—'}</div>
                </div>
                <div className="rounded-2xl border border-harness-border bg-harness-panel p-4">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-harness-muted">WebSocket</div>
                  <div className="mt-2 text-[14px] font-medium text-harness-primary">{socketConnected ? 'Connected' : 'Reconnecting'}</div>
                </div>
                <div className="rounded-2xl border border-harness-border bg-harness-panel p-4">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-harness-muted">Last scan</div>
                  <div className="mt-2 text-[14px] font-medium text-harness-primary">{meta?.scannedAt ? new Date(meta.scannedAt).toLocaleString() : '—'}</div>
                </div>
              </section>

              <section className="rounded-2xl border border-harness-border bg-harness-panel p-4">
                <div className="flex items-start gap-3">
                  <ClaudeMark className="mt-0.5 h-5 w-5 shrink-0 text-harness-accent" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-semibold text-harness-primary">Runtime & account</h3>
                    <p className="mt-1 text-[13px] leading-5 text-harness-muted">Background Claude runs and queued prompts live in the Harness server, so they continue when the browser closes and resync when another device connects.</p>
                    {meta?.authEnabled && onLogout && <button type="button" onClick={onLogout} className="mt-3 rounded-xl border border-harness-border px-3.5 py-2 text-[13px] font-medium text-harness-primary transition hover:bg-harness-hover">Sign out{meta?.user ? ` · ${meta.user}` : ''}</button>}
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700">{error}</div>}
          {notice && <div className="mt-4 rounded-xl border border-harness-border bg-harness-panel px-3.5 py-3 text-[13px] font-medium text-harness-accent">{notice}</div>}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-harness-border bg-harness-panel px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-[960px] items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[12px] text-harness-muted">{dirty ? 'You have unsaved changes.' : 'All changes are saved.'}</span>
          <button type="button" onClick={discard} disabled={!dirty || saving} className="rounded-xl border border-harness-border px-4 py-2 text-[14px] font-medium text-harness-primary transition hover:bg-harness-hover disabled:cursor-not-allowed disabled:opacity-45">Discard</button>
          <button type="button" onClick={save} disabled={!dirty || saving || locations.length === 0} className="rounded-xl bg-harness-accent px-4 py-2 text-[14px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </section>
  );
}
