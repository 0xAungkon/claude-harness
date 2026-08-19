import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, RefreshIcon } from '../icons';

function relativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 30) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function compactPrompt(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function ChangeSummary({ point }) {
  if (!point?.changedFiles) return <div className="text-[12px] text-harness-muted">No tracked file edits after this prompt.</div>;
  return (
    <div className="mt-1.5 space-y-1">
      {(point.changes || []).slice(0, 4).map((change, index) => (
        <div key={`${change.displayPath}-${index}`} className="flex min-w-0 items-center gap-2 text-[12px] text-harness-muted">
          <span className="min-w-0 flex-1 truncate font-mono" title={change.displayPath}>{change.displayPath}</span>
          <span className="shrink-0 tabular-nums">
            {change.additions ? <span className="text-emerald-600">+{change.additions}</span> : null}
            {change.additions && change.deletions ? ' ' : ''}
            {change.deletions ? <span className="text-red-500">-{change.deletions}</span> : null}
          </span>
        </div>
      ))}
      {point.changedFiles > 4 && <div className="text-[11px] text-harness-muted">+ {point.changedFiles - 4} more files</div>}
    </div>
  );
}

const ACTIONS = [
  { id: 'restore_code_conversation', label: 'Restore code and conversation', description: 'Fork the conversation before this prompt and rewind tracked Claude edits.' },
  { id: 'restore_conversation', label: 'Restore conversation', description: 'Fork the conversation before this prompt and keep the current files.' },
  { id: 'restore_code', label: 'Restore code', description: 'Rewind tracked Claude edits but keep the full conversation.' },
  { id: 'summarize_from', label: 'Summarize from here', description: 'Compress this point through the current end into recovered summary context.' },
  { id: 'summarize_up_to', label: 'Summarize up to here', description: 'Compress the earlier context and preserve the later conversation as recovered context.' }
];

export default function RewindPanel({ points = [], loading = false, error = '', onClose = () => {}, onApply = async () => {} }) {
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [pointIndex, setPointIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [applying, setApplying] = useState(false);
  const [actionError, setActionError] = useState('');
  const panelRef = useRef(null);

  const reversed = useMemo(() => [...points].reverse(), [points]);
  const actions = useMemo(() => ACTIONS.map((action) => ({
    ...action,
    disabled: (action.id === 'restore_code' || action.id === 'restore_code_conversation') && !selectedPoint?.canRestoreCode
  })), [selectedPoint]);

  useEffect(() => {
    setPointIndex(0);
    setActionIndex(0);
    setSelectedPoint(null);
    setActionError('');
  }, [points]);

  useEffect(() => {
    const timer = window.setTimeout(() => panelRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [selectedPoint, loading]);

  const activatePoint = (point) => {
    if (!point) return;
    setSelectedPoint(point);
    setActionIndex(point?.canRestoreCode ? 0 : 1);
    setActionError('');
  };

  const moveAction = (delta) => {
    if (!actions.length) return;
    let next = actionIndex;
    for (let i = 0; i < actions.length; i += 1) {
      next = (next + delta + actions.length) % actions.length;
      if (!actions[next].disabled) break;
    }
    setActionIndex(next);
  };

  const apply = async (action) => {
    if (!selectedPoint || !action || action.disabled || applying) return;
    setApplying(true);
    setActionError('');
    try {
      await onApply(selectedPoint, action.id);
    } catch (err) {
      setActionError(err?.message || 'Unable to rewind this session.');
    } finally {
      setApplying(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (selectedPoint) setSelectedPoint(null);
      else onClose();
      return;
    }
    if (loading || applying) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      if (selectedPoint) moveAction(delta);
      else if (reversed.length) setPointIndex((current) => (current + delta + reversed.length) % reversed.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (selectedPoint) apply(actions[actionIndex]);
      else activatePoint(reversed[pointIndex]);
      return;
    }
    if (selectedPoint && /^[1-5]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (actions[index] && !actions[index].disabled) {
        event.preventDefault();
        setActionIndex(index);
        apply(actions[index]);
      }
    }
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="rewind-panel pointer-events-auto mx-auto mb-2 w-full max-w-[760px] overflow-hidden rounded-2xl border border-harness-border bg-harness-panel shadow-[0_18px_55px_rgba(53,46,38,.14)] outline-none"
      role="dialog"
      aria-label="Rewind session"
    >
      <div className="flex items-center gap-2 border-b border-harness-border px-3.5 py-3 sm:px-4">
        {selectedPoint ? (
          <button type="button" onClick={() => setSelectedPoint(null)} className="icon-btn h-7 w-7" title="Back to checkpoints"><ChevronLeft className="h-4 w-4" /></button>
        ) : <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-harness-hover text-harness-accent"><span className="text-[15px]">↶</span></div>}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-harness-primary">Rewind</div>
          <div className="text-[12px] text-harness-muted">
            {selectedPoint ? 'Confirm what to restore from this checkpoint.' : 'Restore code and/or conversation to the point before…'}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[12px] font-medium text-harness-muted hover:bg-harness-hover hover:text-harness-primary">Esc</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-harness-muted"><RefreshIcon className="h-4 w-4 animate-spin" />Loading checkpoints…</div>
      ) : error ? (
        <div className="px-4 py-5 text-[13px] text-red-600">{error}</div>
      ) : !selectedPoint ? (
        <div className="max-h-[min(390px,45vh)] overflow-y-auto p-1.5">
          {reversed.length ? reversed.map((point, index) => {
            const active = index === pointIndex;
            return (
              <button
                key={point.id}
                type="button"
                onMouseEnter={() => setPointIndex(index)}
                onClick={() => activatePoint(point)}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-harness-active' : 'hover:bg-harness-hover'}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${active ? 'bg-harness-accent' : 'border border-harness-border-strong'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[13px] font-medium leading-5 text-harness-primary">{compactPrompt(point.prompt)}</div>
                    <ChangeSummary point={point} />
                  </div>
                  <span className="shrink-0 pt-0.5 text-[11px] text-harness-muted">{relativeTime(point.timestamp)}</span>
                </div>
              </button>
            );
          }) : <div className="px-4 py-8 text-center text-[13px] text-harness-muted">No rewind checkpoints were found in this session.</div>}
          <div className="mx-3 my-1 border-t border-harness-border" />
          <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-[12px] text-harness-muted"><span className="h-2 w-2 rounded-full bg-harness-border-strong" /><span>(current)</span></div>
        </div>
      ) : (
        <div className="max-h-[min(470px,54vh)] overflow-y-auto p-3 sm:p-4">
          <div className="mb-3 text-[12px] font-medium text-harness-muted">Confirm you want to restore to the point before you sent this message:</div>
          <div className="rounded-xl border border-harness-border bg-harness-body px-3 py-2.5">
            <div className="whitespace-pre-wrap break-words text-[13px] leading-5 text-harness-primary">{selectedPoint.prompt}</div>
            <div className="mt-1 text-[11px] text-harness-muted">{relativeTime(selectedPoint.timestamp)}</div>
          </div>
          <div className="mt-3 rounded-xl bg-harness-hover/60 px-3 py-2.5">
            <div className="text-[12px] text-harness-muted">The conversation will be forked for conversation restore actions.</div>
            {selectedPoint.restoreChangedFiles ? (
              <div className="mt-1 text-[12px] text-harness-muted">
                Code restored from this point: {selectedPoint.restoreChangedFiles} {selectedPoint.restoreChangedFiles === 1 ? 'file' : 'files'}
                {selectedPoint.restoreAdditions ? ` · +${selectedPoint.restoreAdditions}` : ''}{selectedPoint.restoreDeletions ? ` -${selectedPoint.restoreDeletions}` : ''}.
              </div>
            ) : null}
          </div>

          <div className="mt-3 space-y-1">
            {actions.map((action, index) => {
              const active = index === actionIndex;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled || applying}
                  onMouseEnter={() => { if (!action.disabled) setActionIndex(index); }}
                  onClick={() => apply(action)}
                  className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition ${action.disabled ? 'cursor-not-allowed opacity-40' : active ? 'bg-harness-active' : 'hover:bg-harness-hover'}`}
                >
                  <span className="mt-0.5 w-5 shrink-0 text-[12px] font-semibold text-harness-accent">{index + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-harness-primary">{action.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-harness-muted">{action.disabled ? 'No tracked Claude file edits are available for this checkpoint.' : action.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {actionError && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:bg-red-950/20">{actionError}</div>}
          {applying && <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-harness-muted"><RefreshIcon className="h-3.5 w-3.5 animate-spin" />Applying rewind…</div>}
        </div>
      )}
    </div>
  );
}
