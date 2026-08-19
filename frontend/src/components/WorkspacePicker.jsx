import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FolderIcon, SearchIcon } from '../icons';

function folderName(value) {
  if (!value) return 'Workspace';
  const normalized = String(value).replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || normalized || 'Workspace';
}

function activityValue(workspace) {
  const raw = workspace?.lastActivity || workspace?.sessions?.[0]?.updated || workspace?.sessions?.[0]?.created;
  const ts = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ts) ? ts : 0;
}

function isPathLike(value) {
  const q = String(value || '');
  return q.startsWith('~') || q.startsWith('/') || q.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(q) || q.includes('/') || q.includes('\\');
}

function ensureSeparator(value, separator) {
  if (!value) return value;
  if (value.endsWith('/') || value.endsWith('\\')) return value;
  return `${value}${separator || '/'}`;
}

function workspaceMatches(workspace, query) {
  const q = query.toLowerCase();
  const name = String(workspace.name || '').toLowerCase();
  const base = folderName(workspace.path).toLowerCase();
  return name.startsWith(q) || base.startsWith(q);
}

export default function WorkspacePicker({ workspaces, selected, rootPath, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pathData, setPathData] = useState(null);
  const [loading, setLoading] = useState(false);
  const shellRef = useRef(null);
  const inputRef = useRef(null);
  const pathMode = isPathLike(query);

  const suggested = useMemo(() => [...workspaces]
    .sort((a, b) => activityValue(b) - activityValue(a) || (b.sessionCount || 0) - (a.sessionCount || 0) || a.name.localeCompare(b.name))
    .slice(0, 5), [workspaces]);

  const nameMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || pathMode) return [];
    return workspaces.filter((workspace) => workspaceMatches(workspace, q)).slice(0, 30);
  }, [workspaces, query, pathMode]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!shellRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    if (!open || !pathMode) {
      setPathData(null);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/directories?input=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to browse folders');
        setPathData(await response.json());
      } catch (error) {
        if (error.name !== 'AbortError') setPathData({ current: null, entries: [], separator: '/' });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 90);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, pathMode, query]);

  const chooseWorkspace = (workspace) => {
    onSelect(workspace);
    setQuery('');
    setOpen(false);
  };

  const chooseCurrentFolder = () => {
    if (!pathData?.current) return;
    const current = pathData.current;
    const known = current.workspaceId ? workspaces.find((workspace) => workspace.id === current.workspaceId) : null;
    chooseWorkspace(known || {
      id: null,
      name: current.name || folderName(current.path),
      path: current.path,
      sessionCount: current.sessionCount || 0,
      sessions: []
    });
  };

  const enterDirectory = (entry) => {
    setQuery(ensureSeparator(entry.path, pathData?.separator));
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (event.key === 'Tab' && pathMode && pathData?.entries?.length === 1) {
      event.preventDefault();
      enterDirectory(pathData.entries[0]);
      return;
    }

    if (event.key === 'Enter') {
      if (pathMode && pathData?.current) {
        event.preventDefault();
        chooseCurrentFolder();
      } else if (!pathMode && nameMatches.length === 1) {
        event.preventDefault();
        chooseWorkspace(nameMatches[0]);
      }
    }
  };

  const displayName = selected?.name || folderName(rootPath);
  const displayPath = selected?.path || rootPath || '';

  return (
    <div ref={shellRef} className="workspace-picker-shell relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery('');
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="group flex max-w-[420px] min-w-[190px] items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[13px] text-[#5f5b54] transition hover:border-[#d8d4cc] hover:bg-[#f2f0eb]"
        title={displayPath}
      >
        <FolderIcon className="h-4 w-4 shrink-0 text-[#b77955]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[#34312d]">{displayName}</span>
          <span className="block truncate text-[11px] text-[#99958e]">{displayPath}</span>
        </span>
        <span className="text-[#918d86] transition group-hover:text-[#4b4741]">⌄</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[520px] max-w-[calc(100vw-48px)] overflow-hidden rounded-xl border border-[#dedbd4] bg-white shadow-popover">
          <div className="border-b border-[#ece8e1] p-2">
            <div className="flex items-center gap-2 rounded-lg border border-[#dedbd4] bg-[#fbfaf8] px-2.5 py-2">
              <SearchIcon className="h-4 w-4 shrink-0 text-[#918d86]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-[#34312d] outline-none placeholder:font-sans placeholder:text-[#aaa69f]"
                placeholder={`Search workspace or type a path, e.g. ${rootPath || '/home/joy'}`}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="mt-1.5 px-1 text-[11px] text-[#9c978f]">
              Type a workspace name, or browse a filesystem path. In path mode, Tab completes a single folder.
            </div>
          </div>

          <div className="harness-scroll max-h-[360px] overflow-y-auto p-1.5">
            {!query.trim() && (
              <>
                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#99958e]">Suggested workspaces</div>
                {suggested.map((workspace, index) => (
                  <button key={workspace.id} type="button" onClick={() => chooseWorkspace(workspace)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[#f2f0eb]">
                    <FolderIcon className="h-4 w-4 shrink-0 text-[#b77955]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14px] text-[#34312d]"><span className="truncate">{workspace.name}</span>{index < 5 && <span className="text-[11px] text-[#9c978f]">#{index + 1}</span>}</span>
                      <span className="block truncate font-mono text-[11px] text-[#99958e]">{workspace.path}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-[#918d86]">{workspace.sessionCount || 0} sessions</span>
                  </button>
                ))}
                {suggested.length === 0 && <div className="px-3 py-7 text-center text-[13px] text-[#9c978f]">No workspaces found yet. Type a folder path to start anywhere.</div>}
              </>
            )}

            {query.trim() && !pathMode && (
              <>
                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#99958e]">Workspace matches</div>
                {nameMatches.map((workspace) => (
                  <button key={workspace.id} type="button" onClick={() => chooseWorkspace(workspace)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[#f2f0eb]">
                    <FolderIcon className="h-4 w-4 shrink-0 text-[#b77955]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-[#34312d]">{workspace.name}</span>
                      <span className="block truncate font-mono text-[11px] text-[#99958e]">{workspace.path}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-[#918d86]">{workspace.sessionCount || 0}</span>
                  </button>
                ))}
                {nameMatches.length === 0 && <div className="px-3 py-7 text-center text-[13px] text-[#9c978f]">No workspace starts with “{query.trim()}”. Type a full path to browse folders.</div>}
              </>
            )}

            {query.trim() && pathMode && (
              <>
                {pathData?.current && (
                  <button type="button" onClick={chooseCurrentFolder} className="mb-1 flex w-full items-center gap-2 rounded-lg border border-[#ead4ca] bg-[#fbf0eb] px-2.5 py-2 text-left hover:bg-[#f8e8e1]">
                    <FolderIcon className="h-4 w-4 shrink-0 text-[#b46a4d]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-[#7f3f2d]">Use this folder · {pathData.current.name}</span>
                      <span className="block truncate font-mono text-[11px] text-[#a36f5d]">{pathData.current.path}</span>
                    </span>
                    {pathData.current.isWorkspace && <span className="rounded bg-[#f1ddd4] px-1.5 py-0.5 text-[11px] text-[#8c4e3b]">{pathData.current.sessionCount} sessions</span>}
                  </button>
                )}

                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#99958e]">Subdirectories</div>
                {loading && <div className="px-3 py-6 text-center text-[13px] text-[#918d86]">Reading folders…</div>}
                {!loading && pathData?.entries?.map((entry) => (
                  <div key={entry.path} className="group flex items-center rounded-lg hover:bg-[#f2f0eb]">
                    <button type="button" onClick={() => enterDirectory(entry)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
                      <FolderIcon className="h-4 w-4 shrink-0 text-[#a98768]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-[#4a4640]">{entry.name}</span>
                        <span className="block truncate font-mono text-[11px] text-[#9c978f]">{entry.path}</span>
                      </span>
                      {entry.isWorkspace && <span className="shrink-0 rounded bg-[#eee8e2] px-1.5 py-0.5 text-[11px] text-[#81756a]">{entry.sessionCount}</span>}
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9c978f]" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const known = entry.workspaceId ? workspaces.find((workspace) => workspace.id === entry.workspaceId) : null;
                        chooseWorkspace(known || { id: null, name: entry.name, path: entry.path, sessionCount: entry.sessionCount || 0, sessions: [] });
                      }}
                      className="mr-1 hidden rounded-md border border-[#d8d4cc] px-2 py-1 text-[11px] text-[#7f7a72] hover:border-[#c9b1a6] hover:text-[#6d4638] group-hover:block"
                    >Use</button>
                  </div>
                ))}
                {!loading && pathData && pathData.entries?.length === 0 && !pathData.current && <div className="px-3 py-7 text-center text-[13px] text-[#9c978f]">No readable directory matches this path.</div>}
                {!loading && pathData?.current && pathData.entries?.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-[#9c978f]">No subdirectories. Use the folder above to start Claude here.</div>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
