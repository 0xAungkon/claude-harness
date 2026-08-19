import React, { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from './Markdown';
import Composer from './Composer';
import StatsView from './StatsView';
import ExtensionsManager from './ExtensionsManager';
import RewindPanel from './RewindPanel';
import { AgentWriting, QueuePanel } from './PromptQueue';
import {
  CopyIcon, ToolIcon, FolderIcon, MenuIcon, SunIcon, MoonIcon, ForkIcon, PanelRightIcon
} from '../icons';

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function friendlyTimestamp(value, nowMs = Date.now()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const delta = nowMs - date.getTime();
  if (delta >= 0 && delta < 60 * 60 * 1000) {
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return 'just now';
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const now = new Date(nowMs);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(date, now)) return `Today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return `Yesterday at ${time}`;

  if (date.getFullYear() === now.getFullYear()) {
    const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${day} at ${time}`;
  }

  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${day} at ${time}`;
}

function exactTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  });
}

function isToolTurn(turn) {
  return Boolean(turn?.toolName)
    || turn?.role === 'tool_result'
    || turn?.blocks?.some?.((block) => block?.type === 'tool_use' || block?.type === 'tool_result');
}

function mergeAssistantTurns(turns) {
  let content = '';
  let timestamp = null;
  const blocks = [];

  for (const turn of turns) {
    if (turn?.role !== 'assistant' || isToolTurn(turn)) continue;
    const text = String(turn.content || '').trim();
    if (!text) continue;

    if (!content) content = text;
    else if (text === content) { /* duplicate snapshot */ }
    else if (text.startsWith(content)) content = text;
    else if (!content.startsWith(text)) content = `${content}\n\n${text}`;

    if (Array.isArray(turn.blocks)) blocks.push(...turn.blocks);
    if (turn.timestamp) timestamp = turn.timestamp;
  }

  return content ? { role: 'assistant', content, blocks, timestamp, toolName: null, toolInput: {} } : null;
}

function buildConversationItems(turns) {
  const items = [];
  let responseSegment = [];

  const flushResponse = () => {
    if (!responseSegment.length) return;

    const toolTurns = responseSegment.filter(isToolTurn);
    if (toolTurns.length) items.push({ type: 'thinking', turns: toolTurns });

    const lastToolIndex = responseSegment.reduce((last, turn, index) => (isToolTurn(turn) ? index : last), -1);
    let finalCandidates = responseSegment.slice(lastToolIndex + 1).filter((turn) => turn.role === 'assistant' && !isToolTurn(turn));

    if (!finalCandidates.length) {
      const allText = responseSegment.filter((turn) => turn.role === 'assistant' && !isToolTurn(turn) && String(turn.content || '').trim());
      if (allText.length) finalCandidates = [allText[allText.length - 1]];
    }

    const merged = mergeAssistantTurns(finalCandidates);
    if (merged) items.push({ type: 'assistant', turn: merged });
    responseSegment = [];
  };

  for (const turn of turns || []) {
    if (turn.role === 'user') {
      flushResponse();
      items.push({ type: 'user', turn });
    } else {
      responseSegment.push(turn);
    }
  }
  flushResponse();
  return items;
}

function pairToolCalls(turns) {
  const calls = [];
  const byId = new Map();

  for (const turn of turns || []) {
    const toolUse = turn.blocks?.find?.((block) => block?.type === 'tool_use');
    const toolResult = turn.blocks?.find?.((block) => block?.type === 'tool_result');

    if (toolUse || (turn.toolName && turn.role === 'assistant')) {
      const id = toolUse?.id || `tool-${calls.length}`;
      const call = {
        id,
        name: toolUse?.name || turn.toolName || 'Tool',
        input: toolUse?.input || turn.toolInput || {},
        output: '',
        timestamp: turn.timestamp || null
      };
      calls.push(call);
      if (toolUse?.id) byId.set(toolUse.id, call);
      continue;
    }

    if (toolResult || turn.role === 'tool_result') {
      const useId = toolResult?.tool_use_id;
      let call = useId ? byId.get(useId) : null;
      if (!call && turn.toolName) call = [...calls].reverse().find((item) => item.name === turn.toolName && !item.output) || null;
      if (!call) {
        call = {
          id: useId || `result-${calls.length}`,
          name: turn.toolName || 'Tool result',
          input: {},
          output: '',
          timestamp: turn.timestamp || null
        };
        calls.push(call);
      }
      const output = String(turn.content || toolResult?.content || '').trim();
      if (output) call.output = call.output ? `${call.output}\n${output}` : output;
      if (!call.timestamp && turn.timestamp) call.timestamp = turn.timestamp;
    }
  }

  return calls;
}

function FriendlyTime({ value, now, align = 'left' }) {
  const label = friendlyTimestamp(value, now);
  if (!label) return null;
  return (
    <div className={`friendly-time mb-1 text-[13px] ${align === 'right' ? 'text-right' : ''}`} title={exactTimestamp(value)}>
      {label}
    </div>
  );
}

function ToolCall({ call, now }) {
  const hasInput = call.input && Object.keys(call.input).length > 0;
  const hasOutput = Boolean(call.output);

  return (
    <details className="tool-call-compact group/tool">
      <summary className="tool-summary flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px]">
        <ToolIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{call.name}</span>
        {call.timestamp && <span className="ml-auto shrink-0 text-[11px] opacity-60">{friendlyTimestamp(call.timestamp, now)}</span>}
        <span className="text-[11px] opacity-60 transition group-open/tool:rotate-180">⌄</span>
      </summary>
      {(hasInput || hasOutput) && (
        <div className="grid gap-2 px-2 pb-2 pt-1">
          {hasInput && (
            <div>
              <div className="tool-label mb-1 text-[11px] uppercase tracking-[0.14em]">Input</div>
              <pre className="harness-pre">{JSON.stringify(call.input, null, 2)}</pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <div className="tool-label mb-1 text-[11px] uppercase tracking-[0.14em]">Output</div>
              <pre className="harness-pre whitespace-pre-wrap">{call.output}</pre>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

function ThinkingGroup({ turns, now }) {
  const calls = useMemo(() => pairToolCalls(turns), [turns]);
  if (!calls.length) return null;

  return (
    <details className="thinking-group group/thinking max-w-[960px]">
      <summary className="thinking-summary inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px]">
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-45" />
        <span>Thinking…</span>
        <span className="text-[11px] opacity-60">{calls.length} {calls.length === 1 ? 'tool' : 'tools'}</span>
        <span className="text-[11px] transition group-open/thinking:rotate-180">⌄</span>
      </summary>
      <div className="thinking-panel mt-1.5 max-w-[820px] rounded-lg border p-1">
        {calls.map((call) => <ToolCall key={call.id} call={call} now={now} />)}
      </div>
    </details>
  );
}

function UserTurn({ turn, now }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[86%] sm:max-w-[72%]">
        <FriendlyTime value={turn.timestamp} now={now} align="right" />
        <div className="user-turn-bubble whitespace-pre-wrap rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-6 shadow-sm">{turn.content}</div>
      </div>
    </div>
  );
}

function AssistantTurn({ turn, now, onFork = async () => {} }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(turn.content || '')); } catch { /* ignore */ }
  };
  return (
    <div className="group/assistant max-w-[960px]">
      <FriendlyTime value={turn.timestamp} now={now} />
      <div className="assistant-turn">
        <Markdown>{turn.content}</Markdown>
      </div>
      <div className="assistant-actions mt-1.5 flex items-center gap-1 opacity-70 transition group-hover/assistant:opacity-100">
        <button type="button" onClick={copy} className="message-action-btn" title="Copy Claude response" aria-label="Copy Claude response"><CopyIcon className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => Promise.resolve(onFork(turn)).catch(() => {})} className="message-action-btn" title="Fork from this response" aria-label="Fork session from this Claude response"><ForkIcon className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

function BtwQuestions({ items = [] }) {
  const visible = items.slice(-4);
  if (!visible.length) return null;
  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <div key={item.id} className="btw-card max-w-[760px] rounded-2xl border px-3.5 py-3">
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.1em] text-harness-muted"><span className="btw-badge rounded-full px-2 py-0.5 normal-case tracking-normal">BTW</span><span>Side question</span></div>
          <div className="text-[14px] font-medium leading-5 text-harness-primary">{item.question}</div>
          {item.status === 'queued' || item.status === 'running' ? (
            <div className="mt-2 text-[13px] text-harness-muted">Claude is answering this without interrupting the main task…</div>
          ) : item.status === 'error' ? (
            <div className="mt-2 text-[13px] text-red-600">{item.error || 'Side question failed.'}</div>
          ) : (
            <div className="btw-answer mt-2 border-t pt-2"><Markdown>{item.answer || 'No answer returned.'}</Markdown></div>
          )}
        </div>
      ))}
    </div>
  );
}

function trajectoryKind(turn) {
  if (turn.role === 'user') return 'user';
  if (turn.role === 'tool_result') return 'tool';
  if (isToolTurn(turn)) return 'call';
  return 'assistant';
}

function trajectoryLabel(kind) {
  if (kind === 'user') return 'USER';
  if (kind === 'assistant') return 'ASSISTANT';
  if (kind === 'call') return 'CALL';
  if (kind === 'tool') return 'TOOL';
  return 'SYSTEM';
}

function trajectorySummary(turn) {
  if (turn.toolName) return `Tool: ${turn.toolName}`;
  const text = String(turn.content || '').replace(/\s+/g, ' ').trim();
  return text || 'Structured Claude Code event';
}

function trajectoryExpandedContent(row) {
  if (row.synthetic) return row.detail || row.summary || '';
  const turn = row.turn || {};
  const parts = [];
  const content = String(turn.content || '').trim();
  if (content) parts.push(content);
  if (turn.toolName) parts.push(`Tool: ${turn.toolName}`);
  if (turn.toolInput && Object.keys(turn.toolInput).length) parts.push(JSON.stringify(turn.toolInput, null, 2));
  if (Array.isArray(turn.blocks)) {
    for (const block of turn.blocks) {
      if (block?.type === 'text' && block.text && !parts.includes(block.text)) parts.push(String(block.text));
      if (block?.type === 'tool_use') parts.push(`${block.name || 'Tool'}\n${JSON.stringify(block.input || {}, null, 2)}`);
      if (block?.type === 'tool_result' && block.content) parts.push(String(block.content));
    }
  }
  return parts.filter(Boolean).join('\n\n') || row.detail || row.summary || 'Structured Claude Code event';
}

function TrajectoryView({ session, projectPath, projectName, now }) {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const rows = useMemo(() => {
    const base = [{
      synthetic: true,
      kind: 'system',
      summary: `Claude Code session · ${projectName}`,
      detail: projectPath,
      timestamp: session.turns?.find((turn) => turn.timestamp)?.timestamp || null
    }];
    return base.concat((session.turns || []).map((turn) => ({
      turn,
      kind: trajectoryKind(turn),
      summary: trajectorySummary(turn),
      detail: turn.toolName && turn.toolInput && Object.keys(turn.toolInput).length ? JSON.stringify(turn.toolInput) : '',
      timestamp: turn.timestamp || null
    })));
  }, [session.turns, projectName, projectPath]);

  useEffect(() => setExpandedIndex(null), [session.id]);

  const toolCount = useMemo(() => (session.turns || []).filter(isToolTurn).length, [session.turns]);
  const firstTime = (session.turns || []).map((turn) => turn.timestamp).find(Boolean);
  const lastTime = [...(session.turns || [])].reverse().map((turn) => turn.timestamp).find(Boolean);
  let durationLabel = '—';
  if (firstTime && lastTime) {
    const ms = Math.max(0, new Date(lastTime).getTime() - new Date(firstTime).getTime());
    if (ms < 60000) durationLabel = `${Math.max(1, Math.round(ms / 1000))}s`;
    else if (ms < 3600000) durationLabel = `${Math.round(ms / 60000)}m`;
    else durationLabel = `${(ms / 3600000).toFixed(1)}h`;
  }

  return (
    <div className="trajectory-view harness-scroll min-h-0 flex-1 overflow-auto">
      <div className="min-w-[720px]">
        <div className="trajectory-toolbar sticky top-0 z-10 flex h-10 items-center border-b px-4 text-[12px]">
          <span>Duration <strong>{durationLabel}</strong></span>
          <span className="ml-5">Turns <strong>{session.turns?.length || 0}</strong></span>
          <span className="ml-5">Calls <strong>{toolCount}</strong></span>
          <span className="ml-auto max-w-[340px] truncate" title={projectPath}>{projectPath}</span>
        </div>

        <div className="trajectory-timeline border-b px-4 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] opacity-60">
            <span>Input</span><span>Model / Tools</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full">
            {rows.map((row, index) => (
              <div key={index} className={`trajectory-segment trajectory-${row.kind}`} style={{ flex: Math.max(1, row.summary.length / 40) }} title={`${trajectoryLabel(row.kind)} · ${row.summary}`} />
            ))}
          </div>
        </div>

        <div className="trajectory-rows divide-y">
          {rows.map((row, index) => {
            const expanded = expandedIndex === index;
            return (
              <div
                key={index}
                className={`trajectory-row grid cursor-pointer grid-cols-[92px_minmax(0,1fr)_130px] gap-x-4 px-4 py-3 ${expanded ? 'trajectory-row-expanded' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => setExpandedIndex(expanded ? null : index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpandedIndex(expanded ? null : index);
                  }
                }}
              >
                <div><span className={`trajectory-badge trajectory-badge-${row.kind}`}>{trajectoryLabel(row.kind)}</span></div>
                <div className="min-w-0">
                  <div className={`trajectory-summary ${expanded ? 'whitespace-normal break-words' : 'truncate'}`}>{row.summary}</div>
                  {row.detail && !expanded && <div className="trajectory-detail mt-1 truncate font-mono text-[11px]" title={row.detail}>{row.detail}</div>}
                </div>
                <div className="trajectory-time text-right text-[11px]" title={exactTimestamp(row.timestamp)}>{friendlyTimestamp(row.timestamp, now) || '—'}</div>

                {expanded && (
                  <div className="trajectory-expanded col-span-3 mt-3 min-w-0" onClick={(event) => event.stopPropagation()}>
                    <div className="trajectory-expanded-content harness-scroll max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-xl border p-3 font-mono text-[13px] leading-6">
                      {trajectoryExpandedContent(row)}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button type="button" className="trajectory-collapse rounded-lg border px-3 py-1.5 text-[12px] font-medium transition" onClick={() => setExpandedIndex(null)}>Collapse</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function SessionView({
  session, workspace, onSend, runtimeState = null,
  onQueueDelete = async () => {}, onQueuePause = async () => {}, onQueueEdit = async () => {}, onQueueMove = async () => {},
  models, model, onModelChange, permissionMode, onPermissionModeChange, additionalDirs, onAddDir,
  approval = null, onRespondApproval = async () => {}, socketConnected = false, socketReconnecting = false,
  theme = 'light', onToggleTheme = () => {}, onOpenSidebar = () => {}, onNewSession = () => {},
  onRenameSession = async () => {}, onStop = async () => {}, onBtw = async () => {}, onForkMessage = async () => {},
  onLoadRewind = async () => ({ points: [] }), onApplyRewind = async () => {},
  notesOpen = false, onToggleNotes = () => {}
}) {
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('chat');
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [extensions, setExtensions] = useState(null);
  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const titleInputRef = useRef(null);
  const cancelTitleRef = useRef(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.name || '');
  const [rewindOpen, setRewindOpen] = useState(false);
  const [rewindPoints, setRewindPoints] = useState([]);
  const [rewindLoading, setRewindLoading] = useState(false);
  const [rewindError, setRewindError] = useState('');

  const projectPath = session.projectPath || workspace?.path || runtimeState?.workspacePath || '';
  const projectName = session.projectName || workspace?.name || (projectPath ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) : '') || 'Workspace';
  const items = useMemo(() => buildConversationItems(session.turns || []), [session.turns]);
  const queue = Array.isArray(runtimeState?.queue) ? runtimeState.queue : [];
  const sideQuestions = Array.isArray(runtimeState?.sideQuestions) ? runtimeState.sideQuestions : [];
  const activePrompt = runtimeState?.active?.text || '';
  const running = runtimeState?.status === 'running' || runtimeState?.status === 'waiting_approval' || Boolean(runtimeState?.active);
  const contextPercent = Math.max(0, Math.min(100, Number(stats?.session?.context_window?.used_percentage || 0)));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { if (!editingTitle) setTitleDraft(session.name || ''); }, [session.name, editingTitle]);
  useEffect(() => { if (editingTitle) requestAnimationFrame(() => { titleInputRef.current?.focus(); titleInputRef.current?.select(); }); }, [editingTitle]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const scrollToEnd = (behavior = 'smooth') => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
      else endRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  };

  useEffect(() => { if (tab === 'chat' && !extensions) scrollToEnd('auto'); }, [session.id, tab, extensions]);
  useEffect(() => { if (tab === 'chat' && !extensions) scrollToEnd('smooth'); }, [session.turns?.length, activePrompt, queue.length, sideQuestions.length, sideQuestions.at(-1)?.status, tab, extensions]);

  const loadStats = async (quiet = false) => {
    const ref = session.id || session.claudeSessionId;
    if (!ref) return;
    if (!quiet) setStatsLoading(true);
    setStatsError('');
    try {
      const response = await fetch(`/api/session/${encodeURIComponent(ref)}/stats`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to load stats');
      setStats(body);
    } catch (error) {
      setStatsError(error?.message || 'Unable to load stats');
    } finally {
      if (!quiet) setStatsLoading(false);
    }
  };

  useEffect(() => { loadStats(Boolean(stats)); }, [session.id, session.claudeSessionId, session.turns?.length, runtimeState?.status]);
  useEffect(() => {
    if (!running && tab !== 'stats') return undefined;
    const timer = setInterval(() => loadStats(true), running ? 5000 : 15000);
    return () => clearInterval(timer);
  }, [running, tab, session.id, session.claudeSessionId]);

  const copyWorkspacePath = async () => { try { await navigator.clipboard.writeText(projectPath); } catch {} };

  const exportMarkdown = () => {
    const lines = [`# ${session.name || 'Claude Code session'}`, '', `- Workspace: \`${projectPath || ''}\``, `- Session ID: \`${session.claudeSessionId || session.id || ''}\``, `- Exported: ${new Date().toLocaleString()}`, ''];
    for (const turn of session.turns || []) {
      if (turn.role === 'user') {
        lines.push('## You', '', String(turn.content || '').trim(), '');
        continue;
      }
      if (turn.role === 'assistant' && !isToolTurn(turn)) {
        const text = String(turn.content || '').trim();
        if (text) lines.push('## Claude', '', text, '');
        continue;
      }
      if (isToolTurn(turn)) {
        const name = turn.toolName || turn.blocks?.find?.((b) => b?.type === 'tool_use')?.name || 'Tool';
        const input = turn.toolInput || turn.blocks?.find?.((b) => b?.type === 'tool_use')?.input;
        const output = String(turn.content || '').trim();
        lines.push(`<details>`, `<summary>Tool: ${name}</summary>`, '');
        if (input && Object.keys(input).length) lines.push('```json', JSON.stringify(input, null, 2), '```', '');
        if (output) lines.push('```text', output, '```', '');
        lines.push('</details>', '');
      }
    }
    const blob = new Blob([`${lines.join('\n').trim()}\n`], { type: 'text/markdown;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${String(session.name || 'claude-session').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'claude-session'}.md`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
    setNotice('Conversation exported as Markdown');
  };

  const openRewind = async () => {
    setExtensions(null);
    setTab('chat');
    setRewindOpen(true);
    setRewindLoading(true);
    setRewindError('');
    scrollToEnd('smooth');
    try {
      const body = await onLoadRewind();
      setRewindPoints(Array.isArray(body?.points) ? body.points : []);
    } catch (error) {
      setRewindPoints([]);
      setRewindError(error?.message || 'Unable to load rewind checkpoints.');
    } finally {
      setRewindLoading(false);
    }
  };

  const applyRewind = async (point, action) => {
    const result = await onApplyRewind(point, action);
    if (result?.mode === 'same') {
      setRewindOpen(false);
      setNotice(action === 'restore_code' ? 'Tracked code restored' : 'Rewind applied');
    }
    return result;
  };

  const submit = async (explicitPrompt = null) => {
    const value = String(explicitPrompt || '').trim();
    if (!value || !projectPath) return;

    if (value === '/rewind') {
      await openRewind();
      return;
    }

    if (value === '/skills' || value === '/plugins' || value === '/mcp') {
      setExtensions(value.slice(1));
      setNotice(`Opened ${value.slice(1)} manager`);
      return;
    }
    if (value === '/context') {
      setExtensions(null); setTab('stats'); await loadStats(); return;
    }
    if (value === '/export') { exportMarkdown(); return; }
    if (value === '/new') {
      onNewSession({ ...(workspace || {}), path: projectPath, name: projectName });
      return;
    }
    if (value === '/btw') {
      const latest = sideQuestions.slice(-1)[0];
      setNotice(latest?.answer ? `Last BTW: ${latest.answer.slice(0, 120)}` : 'Usage: /btw <question>');
      return;
    }
    if (value.startsWith('/btw ')) {
      const question = value.slice('/btw '.length).trim();
      if (!question) { setNotice('Usage: /btw <question>'); return; }
      try {
        await onBtw(question);
        setNotice('Side question sent without interrupting the current task');
      } catch (error) {
        setNotice(error?.message || 'Unable to ask side question');
        throw error;
      }
      return;
    }

    setExtensions(null);
    setRewindOpen(false);
    setTab('chat');
    scrollToEnd('smooth');
    const outgoing = value === '/plugin-reload' ? '/reload-plugins' : value;
    try {
      await onSend(outgoing);
      setNotice(value === '/plugin-reload' ? 'Plugin reload queued' : (running || queue.length ? 'Prompt added to server queue' : 'Prompt sent'));
    } catch (error) {
      setNotice(error?.message || 'Unable to queue prompt');
      throw error;
    } finally {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const safeQueueAction = async (fn) => {
    try { await fn(); }
    catch (error) { setNotice(error?.message || 'Unable to update queue'); }
  };

  const lastUserText = [...(session.turns || [])].reverse().find((turn) => turn.role === 'user')?.content?.trim() || '';
  const showActiveUserBubble = Boolean(activePrompt && activePrompt.trim() !== lastUserText);

  const selectMainTab = (next) => { setExtensions(null); setTab(next); if (next === 'stats') loadStats(); };

  const saveTitle = async () => {
    if (!editingTitle) return;
    if (cancelTitleRef.current) {
      cancelTitleRef.current = false;
      setEditingTitle(false);
      setTitleDraft(session.name || '');
      return;
    }
    setEditingTitle(false);
    const nextName = String(titleDraft || '').trim();
    if (!nextName || nextName === session.name) { setTitleDraft(session.name || ''); return; }
    try {
      await onRenameSession(session, nextName);
      setNotice('Session renamed');
    } catch (error) {
      setTitleDraft(session.name || '');
      setNotice(error?.message || 'Unable to rename session');
    }
  };

  return (
    <div className="session-view relative flex h-full min-h-0 flex-1 flex-col bg-harness-body">
      <header className="session-header shrink-0 border-b border-harness-border bg-harness-panel backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3 sm:h-14 sm:px-5">
          <button type="button" onClick={onOpenSidebar} className="icon-btn md:hidden" aria-label="Open sidebar"><MenuIcon className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                    if (event.key === 'Escape') { event.preventDefault(); cancelTitleRef.current = true; event.currentTarget.blur(); }
                  }}
                  className="session-title-input min-w-0 max-w-[48vw] sm:max-w-[520px] rounded-md border px-1.5 py-0.5 text-[15px] font-semibold tracking-[-0.01em] outline-none sm:text-[16px]"
                  aria-label="Rename session"
                />
              ) : (
                <button type="button" onClick={() => { cancelTitleRef.current = false; setEditingTitle(true); }} className="session-title-button min-w-0 max-w-[48vw] sm:max-w-[520px] truncate rounded-md px-1 py-0.5 text-left text-[15px] font-semibold tracking-[-0.01em] sm:text-[16px]" title="Click to rename session">{session.name}</button>
              )}
              {runtimeState?.status === 'waiting_approval' ? (
                <span className="rounded-full bg-[#fff2c7] px-2 py-0.5 text-[11px] font-semibold text-[#8b6516]">Waiting approval</span>
              ) : running ? (
                <span className="rounded-full bg-[#e9f6ec] px-2 py-0.5 text-[11px] font-semibold text-[#317047]">Running</span>
              ) : null}
              {!socketConnected && <span className="rounded-full bg-[#f1efeb] px-2 py-0.5 text-[11px] text-harness-muted">{socketReconnecting ? 'Reconnecting…' : 'Offline'}</span>}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-harness-muted sm:text-[12px]">
              <FolderIcon className="h-3 w-3 shrink-0" />
              <span className="max-w-[520px] truncate" title={projectPath}>{projectName}</span>
              <button onClick={copyWorkspacePath} className="rounded p-0.5 hover:bg-harness-hover" title={`Copy workspace path: ${projectPath}`}><CopyIcon className="h-3 w-3" /></button>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleNotes}
            className={`theme-toggle flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-harness-border bg-harness-panel shadow-sm transition hover:bg-harness-hover ${notesOpen ? 'text-harness-accent' : 'text-harness-muted hover:text-harness-primary'}`}
            aria-label={notesOpen ? 'Collapse session notepad' : 'Open session notepad'}
            title="Session notepad · Ctrl+Shift+B"
          >
            <PanelRightIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={onToggleTheme} className="theme-toggle flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-harness-border bg-harness-panel text-harness-muted shadow-sm transition hover:bg-harness-hover hover:text-harness-primary" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
          </button>
        </div>
        <div className="session-tabs flex h-9 items-end gap-6 px-3 sm:px-5">
          <button type="button" data-active={!extensions && tab === 'chat'} onClick={() => selectMainTab('chat')} className="session-tab h-full px-1 text-[13px]">Chat</button>
          <button type="button" data-active={!extensions && tab === 'trajectory'} onClick={() => selectMainTab('trajectory')} className="session-tab h-full px-1 text-[13px]">Trajectory</button>
          <button type="button" data-active={!extensions && tab === 'stats'} onClick={() => selectMainTab('stats')} className="session-tab h-full px-1 text-[13px]">Stats</button>
        </div>
      </header>

      {extensions ? (
        <ExtensionsManager initialTab={extensions} workspacePath={projectPath} onClose={() => setExtensions(null)} onNotice={setNotice} />
      ) : tab === 'chat' ? (
        <div ref={scrollRef} className={`harness-scroll min-h-0 flex-1 overflow-y-auto px-3 pt-5 sm:px-6 sm:pt-7 lg:px-8 ${approval ? 'pb-[520px] sm:pb-[490px]' : rewindOpen ? 'pb-[590px] sm:pb-[560px]' : queue.length ? 'pb-[360px] sm:pb-[370px]' : 'pb-[156px] sm:pb-44'}`}>
          <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6 sm:gap-8">
            {items.map((item, index) => {
              if (item.type === 'user') return <UserTurn key={`user-${item.turn.timestamp || index}-${index}`} turn={item.turn} now={now} />;
              if (item.type === 'assistant') return <AssistantTurn key={`assistant-${item.turn.timestamp || index}-${index}`} turn={item.turn} now={now} onFork={onForkMessage} />;
              return <ThinkingGroup key={`thinking-${index}`} turns={item.turns} now={now} />;
            })}
            {(session.turns || []).length === 0 && !activePrompt && <div className="py-20 text-center text-sm text-harness-muted">This session is ready.</div>}
            <BtwQuestions items={sideQuestions} />
            {activePrompt && (
              <>
                {showActiveUserBubble && <div className="flex justify-end"><div className="user-turn-bubble max-w-[86%] whitespace-pre-wrap rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-6 opacity-90 shadow-sm sm:max-w-[72%]">{activePrompt}</div></div>}
                <AgentWriting />
              </>
            )}
            {runtimeState?.lastError && <div className="max-w-[760px] rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{runtimeState.lastError}</div>}
            <div ref={endRef} className="h-px" />
          </div>
        </div>
      ) : tab === 'trajectory' ? (
        <TrajectoryView session={session} projectPath={projectPath} projectName={projectName} now={now} />
      ) : (
        <StatsView stats={stats} loading={statsLoading} error={statsError} onRefresh={() => loadStats()} onManage={setExtensions} projectPath={projectPath} />
      )}

      <div className="composer-dock pointer-events-none absolute bottom-0 left-0 right-0 px-2 pb-[max(.6rem,env(safe-area-inset-bottom))] pt-12 sm:px-5 sm:pb-5 sm:pt-16">
        {rewindOpen && (
          <RewindPanel
            points={rewindPoints}
            loading={rewindLoading}
            error={rewindError}
            onClose={() => { setRewindOpen(false); setRewindError(''); requestAnimationFrame(() => textareaRef.current?.focus()); }}
            onApply={applyRewind}
          />
        )}
        <QueuePanel
          queue={queue}
          onDelete={(id) => safeQueueAction(() => onQueueDelete(id))}
          onTogglePause={(id) => {
            const item = queue.find((entry) => entry.id === id);
            return safeQueueAction(() => onQueuePause(id, !item?.paused));
          }}
          onMove={(index, delta) => {
            const item = queue[index];
            if (!item) return;
            safeQueueAction(() => onQueueMove(item.id, index + delta));
          }}
          onEdit={(id, text) => safeQueueAction(() => onQueueEdit(id, text))}
        />
        <Composer
          onSubmit={submit} workspacePath={projectPath} disabled={!projectPath} sending={running} onStop={onStop}
          placeholder={running ? 'Queue another prompt — press Enter' : 'Ask Claude Code — use @ for files or / for commands'} rows={2} inputRef={textareaRef}
          className="pointer-events-auto mx-auto w-full max-w-[760px]" models={models} model={model} onModelChange={onModelChange}
          permissionMode={permissionMode} onPermissionModeChange={onPermissionModeChange} additionalDirs={additionalDirs} onAddDir={onAddDir}
          onLocalNotice={setNotice} approval={approval} onRespondApproval={onRespondApproval} contextPercent={contextPercent}
          historyKey={session.claudeSessionId || session.id} draftKey={session.claudeSessionId || session.id}
          historyItems={(session.turns || []).filter((turn) => turn.role === 'user').map((turn) => turn.content)}
        />
        {notice && <div className="pointer-events-auto mx-auto mt-1.5 w-full max-w-[760px] text-center text-[12px] font-medium text-harness-accent">{notice}</div>}
      </div>
    </div>
  );
}
