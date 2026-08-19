import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, FileIcon, FolderIcon, SendIcon, JavaScriptFileIcon, PythonFileIcon,
  MarkdownFileIcon, TextFileIcon, ImageFileIcon, StopIcon
} from '../icons';
import InlineApproval from './InlineApproval';
import usePersistentField from '../usePersistentField';

const COMMANDS = [
  { name: '/init', description: 'Create a CLAUDE.md guide for this project' },
  { name: '/compact', description: 'Compact the current conversation context' },
  { name: '/rewind', description: 'Open Claude Code rewind/checkpoint recovery' },
  { name: '/btw', description: 'Ask a side question without adding it to the main conversation' },
  { name: '/fork-session', description: 'Fork this conversation into a new session' },
  { name: '/new', description: 'Start a new session in the current directory' },
  { name: '/context', description: 'Open visual context and usage stats' },
  { name: '/skills', description: 'Manage Claude Code skills' },
  { name: '/plugins', description: 'Discover and manage plugins' },
  { name: '/mcp', description: 'Manage MCP servers and connection status' },
  { name: '/plugin-reload', description: 'Reload active plugin changes' },
  { name: '/export', description: 'Download the full conversation as Markdown' },
  { name: '/add-dir', description: 'Add another directory to Claude file access' },
  { name: '/model', description: 'Switch model or enter a custom model ID' }
];

const PERMISSION_MODES = [
  { value: 'plan', label: 'Plan', note: 'Explore before editing' },
  { value: 'acceptEdits', label: 'Accept edits', note: 'Approve file edits automatically' },
  { value: 'manual', label: 'Manual', note: 'Ask before actions' },
  { value: 'auto', label: 'Auto', note: 'Claude handles routine approvals' },
  { value: 'bypassPermissions', label: 'Bypass permission', note: 'Skip permission checks' }
];

function mentionAt(text, caret) {
  const before = String(text || '').slice(0, Math.max(0, caret ?? 0));
  const match = before.match(/(^|[\s([{])@((?:\\.|[^\s])*)$/);
  if (!match) return null;
  const rawQuery = match[2] || '';
  return {
    start: before.length - rawQuery.length - 1,
    end: before.length,
    query: rawQuery.replace(/\\ /g, ' ')
  };
}

function slashAt(text, caret) {
  const value = String(text || '');
  const before = value.slice(0, Math.max(0, caret ?? 0));
  if (!before.startsWith('/') || before.includes('\n')) return null;
  const match = before.match(/^\/(\S*)(?:\s+(.*))?$/);
  if (!match) return null;
  return {
    commandQuery: `/${match[1] || ''}`,
    arg: match[2] ?? null,
    hasSpace: /\s/.test(before),
    end: before.length
  };
}

function escapeMentionPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/ /g, '\\ ');
}

function highlightedPieces(text) {
  const value = String(text || '');
  const regex = /(^|[\s([{])(@(?:\\.|[^\s])*)/g;
  const pieces = [];
  let cursor = 0;
  let match;
  while ((match = regex.exec(value))) {
    const mentionStart = match.index + match[1].length;
    if (mentionStart > cursor) pieces.push({ text: value.slice(cursor, mentionStart), mention: false });
    pieces.push({ text: match[2], mention: true });
    cursor = mentionStart + match[2].length;
  }
  if (cursor < value.length) pieces.push({ text: value.slice(cursor), mention: false });
  return pieces;
}

function fileVisual(name = '') {
  const lower = String(name).toLowerCase();
  if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(lower)) return { Icon: JavaScriptFileIcon, className: 'text-[#b58b00]' };
  if (/\.(py|pyw|pyi)$/.test(lower)) return { Icon: PythonFileIcon, className: 'text-[#4778a8]' };
  if (/\.(md|mdx|markdown)$/.test(lower)) return { Icon: MarkdownFileIcon, className: 'text-[#6e6a64]' };
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?)$/.test(lower)) return { Icon: ImageFileIcon, className: 'text-[#9a668e]' };
  if (/\.(txt|log|csv|tsv|ini|cfg|conf)$/.test(lower)) return { Icon: TextFileIcon, className: 'text-[#6f7f86]' };
  return { Icon: FileIcon, className: 'text-[#7b7385]' };
}

function SuggestionIcon({ entry }) {
  if (entry?.kind === 'file' && entry.item?.type === 'folder') return <FolderIcon className="h-4 w-4 shrink-0 text-[#b77955]" />;
  if (entry?.kind === 'file') {
    const { Icon, className } = fileVisual(entry.item?.name);
    return <Icon className={`h-4 w-4 shrink-0 ${className}`} />;
  }
  if (entry?.kind === 'directory' || entry?.kind === 'directory-current') return <FolderIcon className="h-4 w-4 shrink-0 text-[#b77955]" />;
  return null;
}

function MenuButton({ children, onClick, danger = false }) {
  return (
    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClick} className={`menu-item ${danger ? 'text-red-600' : ''}`}>
      {children}
    </button>
  );
}

function promptHistoryStorageKey(historyKey) {
  return historyKey ? `claude-harness.prompt-history.${historyKey}` : '';
}

function readPromptHistory(historyKey, seed = []) {
  const normalizedSeed = (Array.isArray(seed) ? seed : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!historyKey) return normalizedSeed.slice(-100);
  try {
    const raw = JSON.parse(localStorage.getItem(promptHistoryStorageKey(historyKey)) || '[]');
    const stored = Array.isArray(raw) ? raw.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const merged = [...normalizedSeed, ...stored];
    const out = [];
    for (const item of merged) if (!out.length || out[out.length - 1] !== item) out.push(item);
    return out.slice(-100);
  } catch {
    return normalizedSeed.slice(-100);
  }
}

function writePromptHistory(historyKey, history) {
  if (!historyKey) return;
  try { localStorage.setItem(promptHistoryStorageKey(historyKey), JSON.stringify((history || []).slice(-100))); } catch { /* ignore */ }
}

export default function Composer({
  value: controlledValue,
  onChange: controlledOnChange,
  onSubmit,
  workspacePath,
  disabled = false,
  sending = false,
  placeholder = 'Ask Claude Code anything',
  rows = 3,
  inputRef,
  className = '',
  models = [],
  model = 'default',
  onModelChange = () => {},
  permissionMode = 'acceptEdits',
  onPermissionModeChange = () => {},
  additionalDirs = [],
  onAddDir = () => {},
  onLocalNotice = () => {},
  approval = null,
  onRespondApproval = async () => {},
  contextPercent = 0,
  onStop = async () => {},
  historyKey = '',
  historyItems = [],
  draftKey = ''
}) {
  const internalRef = useRef(null);
  const backdropRef = useRef(null);
  const textareaRef = inputRef || internalRef;
  const persistenceKey = draftKey || historyKey || '';
  const persistedDraft = usePersistentField('draft', persistenceKey, { fallback: '', debounceMs: 220 });
  const isControlled = typeof controlledValue === 'string' && typeof controlledOnChange === 'function';
  const value = isControlled ? controlledValue : persistedDraft.value;
  const onChange = isControlled ? controlledOnChange : persistedDraft.setValue;
  const [promptHistory, setPromptHistory] = useState(() => readPromptHistory(historyKey, historyItems));
  const historySeedVersion = `${historyItems.length}:${String(historyItems.at?.(-1) || '').slice(-160)}`;
  const [historyIndex, setHistoryIndex] = useState(null);
  const historyScratchRef = useRef('');
  const [stopping, setStopping] = useState(false);
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [directorySuggestions, setDirectorySuggestions] = useState([]);
  const [currentDirectory, setCurrentDirectory] = useState(null);
  const [loadingDirectories, setLoadingDirectories] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suppressed, setSuppressed] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(() => {
    let saved = 112;
    try {
      const parsed = Number(localStorage.getItem('claude-harness.composer-height'));
      if (Number.isFinite(parsed)) saved = parsed;
    } catch { /* default height */ }
    return Math.max(64, Math.min(420, Math.round(saved)));
  });
  const composerHeightRef = useRef(composerHeight);

  const composerHeightBounds = () => {
    if (typeof window === 'undefined') return { min: 64, max: 420 };
    const mobile = window.innerWidth <= 767;
    const viewportMax = Math.floor(window.innerHeight * (mobile ? 0.38 : 0.44));
    return { min: 64, max: Math.max(96, Math.min(mobile ? 320 : 420, viewportMax)) };
  };

  const applyComposerHeight = (nextHeight, persist = true) => {
    const { min, max } = composerHeightBounds();
    const next = Math.max(min, Math.min(max, Math.round(nextHeight)));
    composerHeightRef.current = next;
    setComposerHeight(next);
    if (persist) {
      try { localStorage.setItem('claude-harness.composer-height', String(next)); } catch { /* ignore */ }
    }
  };

  const beginComposerResize = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = composerHeightRef.current;
    const pointerId = event.pointerId;
    document.body.classList.add('composer-resizing');

    const onMove = (moveEvent) => {
      if (pointerId !== undefined && moveEvent.pointerId !== undefined && moveEvent.pointerId !== pointerId) return;
      // The resize edge sits above the field: dragging upward makes the composer taller.
      applyComposerHeight(startHeight + (startY - moveEvent.clientY), false);
    };
    const onEnd = (endEvent) => {
      if (pointerId !== undefined && endEvent.pointerId !== undefined && endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('composer-resizing');
      try { localStorage.setItem('claude-harness.composer-height', String(composerHeightRef.current)); } catch { /* ignore */ }
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const handleComposerResizeKey = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const { min, max } = composerHeightBounds();
    if (event.key === 'ArrowUp') applyComposerHeight(composerHeightRef.current + 16);
    if (event.key === 'ArrowDown') applyComposerHeight(composerHeightRef.current - 16);
    if (event.key === 'Home') applyComposerHeight(min);
    if (event.key === 'End') applyComposerHeight(max);
  };

  useEffect(() => {
    composerHeightRef.current = composerHeight;
  }, [composerHeight]);

  useEffect(() => {
    const clampToViewport = () => applyComposerHeight(composerHeightRef.current);
    window.addEventListener('resize', clampToViewport);
    clampToViewport();
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

  const mentionHighlightActive = value.includes('@');
  const mention = useMemo(() => mentionAt(value, caret), [value, caret]);
  const slash = useMemo(() => slashAt(value, caret), [value, caret]);
  const pieces = useMemo(() => mentionHighlightActive ? highlightedPieces(value) : [], [value, mentionHighlightActive]);

  const mode = PERMISSION_MODES.find((item) => item.value === permissionMode) || PERMISSION_MODES[1];
  const selectedModel = models.find((item) => item.id === model) || { id: model || 'default', label: model || 'Default' };

  useEffect(() => {
    setPromptHistory(readPromptHistory(historyKey, historyItems));
    setHistoryIndex(null);
    historyScratchRef.current = '';
  }, [historyKey, historySeedVersion]);

  useEffect(() => {
    if (!workspacePath || disabled || suppressed || !mention || slash) {
      setFiles([]);
      setLoadingFiles(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingFiles(true);
      try {
        const params = new URLSearchParams({ workspacePath, q: mention.query || '' });
        const response = await fetch(`/api/files?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to list files');
        const body = await response.json();
        setFiles(Array.isArray(body.files) ? body.files : []);
        setActiveIndex(0);
      } catch (error) {
        if (error.name !== 'AbortError') setFiles([]);
      } finally {
        if (!controller.signal.aborted) setLoadingFiles(false);
      }
    }, 80);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspacePath, disabled, suppressed, mention?.start, mention?.end, mention?.query, slash?.commandQuery]);

  useEffect(() => {
    const isAddDir = slash?.commandQuery === '/add-dir' && slash.hasSpace;
    if (!isAddDir || suppressed) {
      setDirectorySuggestions([]);
      setCurrentDirectory(null);
      setLoadingDirectories(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingDirectories(true);
      try {
        const input = String(slash.arg || '').trim() || workspacePath || '';
        const params = new URLSearchParams({ input });
        const response = await fetch(`/api/directories?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to list folders');
        const body = await response.json();
        const entries = Array.isArray(body.entries) ? body.entries : [];
        setCurrentDirectory(body.current || null);
        setDirectorySuggestions(entries.slice(0, 20));
        setActiveIndex(0);
      } catch (error) {
        if (error.name !== 'AbortError') { setDirectorySuggestions([]); setCurrentDirectory(null); }
      } finally {
        if (!controller.signal.aborted) setLoadingDirectories(false);
      }
    }, 80);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [slash?.commandQuery, slash?.hasSpace, slash?.arg, suppressed, workspacePath]);

  const commandSuggestions = useMemo(() => {
    if (!slash || slash.hasSpace) return [];
    const q = slash.commandQuery.toLowerCase();
    return COMMANDS.filter((item) => item.name.startsWith(q));
  }, [slash]);

  const modelSuggestions = useMemo(() => {
    if (slash?.commandQuery !== '/model' || !slash.hasSpace) return [];
    const q = String(slash.arg || '').trim().toLowerCase();
    const filtered = (models || []).filter((item) => !q || item.id.toLowerCase().startsWith(q) || String(item.label || '').toLowerCase().startsWith(q));
    return filtered.slice(0, 20);
  }, [slash?.commandQuery, slash?.hasSpace, slash?.arg, models]);

  const suggestionItems = useMemo(() => {
    if (mention && !suppressed && !slash) return files.map((item) => ({ kind: 'file', item }));
    if (slash && !suppressed) {
      if (!slash.hasSpace) return commandSuggestions.map((item) => ({ kind: 'command', item }));
      if (slash.commandQuery === '/add-dir') {
        const items = directorySuggestions.map((item) => ({ kind: 'directory', item }));
        if (currentDirectory) items.unshift({ kind: 'directory-current', item: currentDirectory });
        return items;
      }
      if (slash.commandQuery === '/model') return modelSuggestions.map((item) => ({ kind: 'model', item }));
    }
    return [];
  }, [mention, suppressed, slash, files, commandSuggestions, directorySuggestions, currentDirectory, modelSuggestions]);

  const loadingSuggestions = Boolean(
    (!slash && mention && loadingFiles)
    || (slash?.commandQuery === '/add-dir' && loadingDirectories)
  );
  // Keep the popover mounted for an active @ mention even when there are no
  // results. Otherwise the suggestion panel briefly flashes and disappears,
  // which reads like a rendering glitch rather than a clear empty state.
  const mentionSuggestionsVisible = Boolean(mention && !slash);
  const slashSuggestionsVisible = Boolean(slash && (loadingSuggestions || suggestionItems.length > 0));
  const suggestionsVisible = !suppressed && (mentionSuggestionsVisible || slashSuggestionsVisible);

  const syncCaret = (event) => setCaret(event.currentTarget.selectionStart ?? 0);
  const syncScroll = (event) => {
    if (!backdropRef.current) return;
    backdropRef.current.scrollTop = event.currentTarget.scrollTop;
    backdropRef.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  const replaceValue = (nextValue, nextCaret = nextValue.length) => {
    onChange(nextValue);
    setSuppressed(false);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const chooseSuggestion = (entry) => {
    if (!entry) return;
    if (entry.kind === 'file' && mention) {
      const isFolder = entry.item.type === 'folder';
      const token = `@${escapeMentionPath(entry.item.path)}${isFolder ? '/' : ''}`;
      const needsSpace = !isFolder && value.slice(mention.end, mention.end + 1) !== ' ';
      const suffix = needsSpace ? ' ' : '';
      replaceValue(`${value.slice(0, mention.start)}${token}${suffix}${value.slice(mention.end)}`, mention.start + token.length + suffix.length);
      if (!isFolder) setFiles([]);
      return;
    }
    if (entry.kind === 'command') {
      const command = entry.item.name;
      const requiresArg = command === '/add-dir' || command === '/model' || command === '/btw';
      replaceValue(`${command}${requiresArg ? ' ' : ''}`);
      return;
    }
    if (entry.kind === 'directory-current') {
      onAddDir(entry.item.path);
      onChange('');
      setDirectorySuggestions([]);
      setCurrentDirectory(null);
      onLocalNotice(`Added directory: ${entry.item.path}`);
      return;
    }
    if (entry.kind === 'directory') {
      replaceValue(`/add-dir ${entry.item.path}`);
      return;
    }
    if (entry.kind === 'model') {
      replaceValue(`/model ${entry.item.id}`);
    }
  };

  const recordHistory = (text) => {
    const normalized = String(text || '').trim();
    if (!normalized) return;
    setPromptHistory((current) => {
      const next = current.length && current[current.length - 1] === normalized ? current : [...current, normalized].slice(-100);
      writePromptHistory(historyKey, next);
      return next;
    });
    setHistoryIndex(null);
    historyScratchRef.current = '';
  };

  const handleChange = (event) => {
    onChange(event.target.value);
    setCaret(event.target.selectionStart ?? event.target.value.length);
    setSuppressed(false);
  };

  const handleSubmit = async (explicitValue = null) => {
    const source = typeof explicitValue === 'string' ? explicitValue : value;
    const trimmed = String(source || '').trim();
    if (!trimmed || disabled) return;

    if (trimmed === '/model') {
      setSuppressed(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    if (trimmed.startsWith('/model ')) {
      const customModel = trimmed.slice('/model '.length).trim();
      if (customModel) {
        onModelChange(customModel);
        onChange('');
        recordHistory(trimmed);
        onLocalNotice(`Model set to ${customModel}`);
      }
      return;
    }
    if (trimmed === '/add-dir') {
      setSuppressed(false);
      return;
    }
    if (trimmed.startsWith('/add-dir ')) {
      const dir = trimmed.slice('/add-dir '.length).trim();
      if (dir) {
        onAddDir(dir);
        onChange('');
        recordHistory(trimmed);
        onLocalNotice(`Added directory: ${dir}`);
      }
      return;
    }

    const restore = String(source || '');
    onChange('');
    setSuppressed(true);
    recordHistory(trimmed);
    try {
      await onSubmit(trimmed);
    } catch (error) {
      onChange(restore);
      setSuppressed(false);
      onLocalNotice(error?.message || 'Unable to send prompt');
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const handleStop = async () => {
    if (!sending || stopping) return;
    setStopping(true);
    try {
      await onStop();
      onLocalNotice('Claude stopped');
    } catch (error) {
      onLocalNotice(error?.message || 'Unable to stop Claude');
    } finally {
      setStopping(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && slash && !slash.hasSpace && commandSuggestions.length === 1 && slash.commandQuery.length > 1) {
      const command = commandSuggestions[0].name;
      const requiresArg = command === '/add-dir' || command === '/model' || command === '/btw';
      event.preventDefault();
      if (requiresArg) {
        replaceValue(`${command} `);
      } else {
        onChange('');
        setSuppressed(true);
        handleSubmit(command);
      }
      return;
    }
    if (suggestionsVisible && suggestionItems.length > 0) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % suggestionItems.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index - 1 + suggestionItems.length) % suggestionItems.length); return; }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        chooseSuggestion(suggestionItems[activeIndex] || suggestionItems[0]);
        return;
      }
    }

    const node = event.currentTarget;
    const selectionStart = node.selectionStart ?? 0;
    const selectionEnd = node.selectionEnd ?? selectionStart;
    const firstBreak = value.indexOf('\n');
    const lastBreak = value.lastIndexOf('\n');
    const cursorOnFirstLine = selectionStart === selectionEnd && (firstBreak < 0 || selectionStart <= firstBreak);
    const cursorOnLastLine = selectionStart === selectionEnd && (lastBreak < 0 || selectionStart > lastBreak);

    if (event.key === 'ArrowUp' && cursorOnFirstLine && promptHistory.length) {
      event.preventDefault();
      let nextIndex;
      if (historyIndex == null) {
        historyScratchRef.current = value;
        nextIndex = promptHistory.length - 1;
      } else {
        nextIndex = Math.max(0, historyIndex - 1);
      }
      setHistoryIndex(nextIndex);
      const nextValue = promptHistory[nextIndex] || '';
      replaceValue(nextValue, nextValue.length);
      return;
    }

    if (event.key === 'ArrowDown' && cursorOnLastLine && historyIndex != null) {
      event.preventDefault();
      if (historyIndex < promptHistory.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        const nextValue = promptHistory[nextIndex] || '';
        replaceValue(nextValue, nextValue.length);
      } else {
        setHistoryIndex(null);
        const scratch = historyScratchRef.current || '';
        replaceValue(scratch, scratch.length);
      }
      return;
    }

    if (event.key === 'Escape') {
      if (modeOpen || modelOpen) { setModeOpen(false); setModelOpen(false); return; }
      if (mention || slash) { event.preventDefault(); setSuppressed(true); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(); }
  };

  const canSend = Boolean(String(value || '').trim() && !disabled);
  const normalizedContext = Math.max(0, Math.min(100, Number(contextPercent || 0)));
  const contextCircumference = 2 * Math.PI * 15;

  return (
    <div className={`composer-root relative ${className}`}>
      {suggestionsVisible && (
        <div className="harness-scroll soft-popover absolute bottom-[calc(100%+10px)] left-0 right-0 z-50 max-h-[320px] overflow-y-auto p-1.5">
          <div className="flex items-center px-2.5 pb-1.5 pt-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-harness-muted">
            <span>{mention && !slash ? 'Files & folders' : slash?.commandQuery === '/add-dir' ? 'Folders' : slash?.commandQuery === '/model' ? 'Models' : 'Commands'}</span>
            <span className="ml-auto normal-case tracking-normal text-harness-muted">↑↓ navigate · Enter select · Esc close</span>
          </div>
          {loadingSuggestions && suggestionItems.length === 0 && <div className="px-3 py-6 text-center text-[14px] text-harness-muted">Loading suggestions…</div>}
          {!loadingSuggestions && mention && !slash && suggestionItems.length === 0 && (
            <div className="px-3 py-6 text-center text-[14px] text-harness-muted">No match found</div>
          )}
          {suggestionItems.map((entry, index) => (
            <button
              key={`${entry.kind}:${entry.item.path || entry.item.name || entry.item.id}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseSuggestion(entry)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${index === activeIndex ? 'bg-harness-active' : 'hover:bg-harness-hover'}`}
            >
              <SuggestionIcon entry={entry} />
              {entry.kind === 'command' && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#f4e6df] font-mono text-[14px] font-bold text-harness-accent">/</span>}
              {entry.kind === 'model' && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#eee9f2] text-[12px] font-semibold text-[#79568f]">M</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-harness-primary">
                  {entry.kind === 'file' ? entry.item.name : entry.kind === 'directory-current' ? `Use this folder · ${entry.item.name}` : entry.kind === 'directory' ? entry.item.name : entry.kind === 'command' ? entry.item.name : (entry.item.label || entry.item.id)}
                </span>
                <span className="block truncate text-[12px] text-harness-muted">
                  {entry.kind === 'file' ? entry.item.path : (entry.kind === 'directory' || entry.kind === 'directory-current') ? entry.item.path : entry.kind === 'command' ? entry.item.description : `${entry.item.id}${entry.item.source ? ` · ${entry.item.source}` : ''}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {approval && <InlineApproval approval={approval} onRespond={onRespondApproval} />}

      <div className={`composer-card relative rounded-[20px] border p-2.5 shadow-composer transition ${approval ? 'mt-2' : ''}`}>
        <div
          className="composer-resize-edge"
          role="separator"
          aria-label="Resize prompt box"
          aria-orientation="horizontal"
          aria-valuemin={64}
          aria-valuemax={composerHeightBounds().max}
          aria-valuenow={Math.round(composerHeight)}
          tabIndex={0}
          onPointerDown={beginComposerResize}
          onKeyDown={handleComposerResizeKey}
          title="Drag to resize prompt box"
        />
        <div className="composer-resize-corner composer-resize-corner-left" onPointerDown={beginComposerResize} aria-hidden="true" />
        <div className="composer-resize-corner composer-resize-corner-right" onPointerDown={beginComposerResize} aria-hidden="true" />

        <div className="mention-editor relative min-h-[64px] overflow-hidden rounded-xl" style={{ height: `${composerHeight}px` }}>
          {value && mentionHighlightActive && (
            <div ref={backdropRef} aria-hidden="true" className="mention-backdrop pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-2.5 py-2 text-[16px] leading-6">
              {pieces.map((piece, index) => piece.mention ? <span key={index} className="mention-token">{piece.text}</span> : <span key={index}>{piece.text}</span>)}
              {value.endsWith('\n') ? '\u200b' : null}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            onScroll={syncScroll}
            disabled={disabled}
            rows={rows}
            placeholder={placeholder}
            spellCheck={false}
            className={`mention-textarea relative z-10 h-full w-full resize-none bg-transparent px-2.5 py-2 text-[16px] leading-6 outline-none disabled:cursor-not-allowed disabled:opacity-60 ${mentionHighlightActive ? '' : 'mention-textarea-plain'}`}
          />
        </div>

        <div className="composer-toolbar flex items-center gap-1 border-t pt-2">
          <div className="relative">
            <button type="button" onClick={() => { setModeOpen((v) => !v); setModelOpen(false); }} className="toolbar-pill" title="Claude Code permission mode">
              <span className="h-2 w-2 rounded-full bg-harness-accent" />
              <span>{mode.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-harness-muted" />
            </button>
            {modeOpen && (
              <div className="soft-popover absolute bottom-10 left-0 z-50 w-[245px] p-1.5">
                <div className="px-2.5 pb-1.5 pt-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-harness-muted">Claude Code mode</div>
                {PERMISSION_MODES.map((item) => (
                  <MenuButton key={item.value} onClick={() => { onPermissionModeChange(item.value); setModeOpen(false); }}>
                    <span className={`h-2 w-2 rounded-full ${item.value === permissionMode ? 'bg-harness-accent' : 'bg-harness-border'}`} />
                    <span className="min-w-0 flex-1"><span className="block font-medium">{item.label}</span><span className="block text-[12px] text-harness-muted">{item.note}</span></span>
                  </MenuButton>
                ))}
              </div>
            )}
          </div>

          {additionalDirs.length > 0 && <span className="ml-1 rounded-full composer-dir-pill px-2 py-1 text-[12px]" title={additionalDirs.join('\n')}>+{additionalDirs.length} dir{additionalDirs.length === 1 ? '' : 's'}</span>}

          <div className="relative ml-auto">
            <button type="button" onClick={() => { setModelOpen((v) => !v); setModeOpen(false); }} className="toolbar-pill max-w-[190px]" title={`Model: ${selectedModel.id}`}>
              <span className="truncate">{selectedModel.label || selectedModel.id}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-harness-muted" />
            </button>
            {modelOpen && (
              <div className="soft-popover absolute bottom-10 right-0 z-50 max-h-[330px] w-[285px] overflow-y-auto p-1.5">
                <div className="px-2.5 pb-1.5 pt-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-harness-muted">Model</div>
                {(models || []).map((item) => (
                  <MenuButton key={item.id} onClick={() => { onModelChange(item.id); setModelOpen(false); }}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold ${item.id === model ? 'bg-harness-accentSoft text-harness-accent' : 'bg-harness-hover text-harness-muted'}`}>M</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.label || item.id}</span><span className="block truncate text-[12px] text-harness-muted">{item.id}{item.source ? ` · ${item.source}` : ''}</span></span>
                  </MenuButton>
                ))}
                <div className="mt-1 border-t border-harness-border px-2.5 py-2 text-[12px] leading-4 text-harness-muted">Type <span className="font-mono text-harness-accent">/model &lt;custom-model&gt;</span> to use any custom model ID accepted by your Claude Code provider.</div>
              </div>
            )}
          </div>

          <div className="context-mini-gauge relative ml-1 flex h-9 w-9 shrink-0 items-center justify-center" title={`Context used: ${Math.round(normalizedContext)}%`}>
            <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray={contextCircumference} strokeDashoffset={contextCircumference * (1 - normalizedContext / 100)} />
            </svg>
            <span className="relative z-10 text-[9px] font-bold tracking-[-0.04em] text-harness-primary">{Math.round(normalizedContext)}%</span>
          </div>

          {sending && !canSend ? (
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="stop-button ml-1 flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm transition disabled:cursor-wait disabled:opacity-70"
              title={stopping ? 'Stopping Claude…' : 'Stop current task'}
              aria-label={stopping ? 'Stopping Claude' : 'Stop current Claude task'}
            >
              <StopIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSend}
              className={`ml-1 flex h-9 w-9 items-center justify-center rounded-full transition ${canSend ? 'send-button-active text-white shadow-sm' : 'send-button-disabled cursor-not-allowed text-white'}`}
              title={sending ? 'Queue prompt (Enter)' : 'Send (Enter)'}
            >
              <SendIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
