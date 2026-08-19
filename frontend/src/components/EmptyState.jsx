import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClaudeMark, FolderIcon, MenuIcon, SunIcon, MoonIcon } from '../icons';
import WorkspacePicker from './WorkspacePicker';
import Composer from './Composer';
import { AgentWriting } from './PromptQueue';
import ExtensionsManager from './ExtensionsManager';

export default function EmptyState({
  rootPath, workspaces, preferredWorkspace, onStartSession,
  models, model, onModelChange, permissionMode, onPermissionModeChange,
  additionalDirs, onAddDir, approval = null, onRespondApproval = async () => {},
  theme = 'light', onToggleTheme = () => {}, onOpenSidebar = () => {}
}) {
  const [workspace, setWorkspace] = useState(preferredWorkspace || workspaces?.[0] || null);
  const [notice, setNotice] = useState('');
  const [starting, setStarting] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [extensions, setExtensions] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);
  useEffect(() => { if (preferredWorkspace?.path) setWorkspace(preferredWorkspace); }, [preferredWorkspace?.id, preferredWorkspace?.path]);
  useEffect(() => { setWorkspace((current) => current || workspaces?.[0] || null); }, [workspaces]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  const selectedWorkspace = useMemo(() => {
    if (!workspace) return null;
    if (workspace.id) return workspaces.find((item) => item.id === workspace.id) || workspace;
    return workspace;
  }, [workspace, workspaces]);

  const submit = async (explicitPrompt = null) => {
    const value = String(explicitPrompt || '').trim();
    if (!selectedWorkspace?.path || !value || starting) return;

    if (value === '/skills' || value === '/plugins' || value === '/mcp') {
      setExtensions(value.slice(1));
      return;
    }
    if (value === '/new') {
      setNotice('Already ready for a new session in this workspace');
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    if (value === '/context') {
      setNotice('Context stats become available after the session starts');
      return;
    }
    if (value === '/export') {
      setNotice('Open or start a session before exporting a conversation');
      return;
    }
    if (value === '/plugin-reload' || value === '/rewind' || value.startsWith('/btw')) {
      setNotice('Start or open a session before using this command');
      return;
    }

    setPendingPrompt(value);
    setStarting(true);
    try {
      await onStartSession(selectedWorkspace, value, { permissionMode, model, additionalDirs });
    } catch (error) {
      setPendingPrompt('');
      setNotice(error?.message || 'Unable to start session');
      setStarting(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
      throw error;
    }
  };

  return (
    <div className="empty-state relative flex h-full min-h-0 flex-1 flex-col bg-harness-body">
      <div className="flex h-14 shrink-0 items-center border-b border-harness-border px-3 md:hidden">
        <button type="button" onClick={onOpenSidebar} className="icon-btn" aria-label="Open sidebar"><MenuIcon className="h-5 w-5" /></button>
        <div className="ml-2 flex items-center gap-2 text-[15px] font-semibold"><ClaudeMark className="h-4 w-4 text-[#b65f45]" />Claude Harness</div>
        <button type="button" onClick={onToggleTheme} className="icon-btn ml-auto" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}</button>
      </div>
      <button type="button" onClick={onToggleTheme} className="theme-toggle absolute right-5 top-5 z-10 hidden h-9 w-9 items-center justify-center rounded-xl border border-harness-border bg-harness-panel text-harness-muted shadow-sm transition hover:bg-harness-hover md:flex" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}</button>
      {extensions ? (
        <ExtensionsManager initialTab={extensions} workspacePath={selectedWorkspace?.path || ''} onClose={() => { setExtensions(null); requestAnimationFrame(() => textareaRef.current?.focus()); }} onNotice={setNotice} />
      ) : (
      <div className="harness-scroll flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 pb-8 sm:px-6 sm:pb-16">
        <div className="w-full max-w-[780px] md:-translate-y-3">
          {pendingPrompt ? (
            <div className="mb-6 grid gap-4 rounded-2xl px-1">
              <div className="flex justify-end"><div className="user-turn-bubble max-w-[86%] whitespace-pre-wrap rounded-2xl rounded-tr-md px-4 py-3 text-[15px] leading-6 shadow-sm sm:max-w-[72%]">{pendingPrompt}</div></div>
              <AgentWriting />
            </div>
          ) : (
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#efe5df] text-[#bd684d] shadow-sm"><ClaudeMark className="h-6 w-6" /></div>
              <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-harness-primary">What can I help with?</h1>
              <p className="mt-2 text-[15px] text-harness-muted">Start a Claude Code session in any local project.</p>
            </div>
          )}

          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-harness-border bg-harness-hover p-1">
              <div className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-harness-panel text-[#a66a4f] shadow-sm"><FolderIcon className="h-4 w-4" /></div>
              <WorkspacePicker workspaces={workspaces} selected={selectedWorkspace} rootPath={rootPath} onSelect={setWorkspace} />
            </div>
          </div>

          <Composer
            onSubmit={submit} workspacePath={selectedWorkspace?.path || ''}
            disabled={!selectedWorkspace?.path || starting} sending={starting} rows={4} inputRef={textareaRef}
            placeholder={selectedWorkspace?.path ? 'Ask anything — use @ for files or / for commands' : 'Choose a workspace first'}
            models={models} model={model} onModelChange={onModelChange} permissionMode={permissionMode} onPermissionModeChange={onPermissionModeChange}
            additionalDirs={additionalDirs} onAddDir={onAddDir} onLocalNotice={setNotice} approval={approval} onRespondApproval={onRespondApproval}
            historyKey={`new:${selectedWorkspace?.path || 'none'}`} draftKey={`new:${selectedWorkspace?.path || 'none'}`}
          />

          <div className="mt-3 flex items-center justify-center gap-2 text-[13px] text-harness-muted"><span>Enter to send</span><span>·</span><span>Shift+Enter for a new line</span><span>·</span><span>@ files</span><span>·</span><span>/ commands</span></div>
          {notice && <div className="mt-3 text-center text-[13px] font-medium text-harness-accent">{notice}</div>}
        </div>
      </div>
      )}
    </div>
  );
}
