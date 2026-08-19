import React, { useState } from 'react';

export function AgentWriting() {
  return (
    <div className="agent-writing max-w-[960px]" role="status" aria-live="polite" aria-label="Claude is writing">
      <span>Claude is writing</span>
      <span className="writing-wave" aria-hidden="true"><i /><i /><i /><i /></span>
    </div>
  );
}

export function QueuePanel({ queue, onDelete, onTogglePause, onMove, onEdit }) {
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  if (!queue.length) return null;

  const beginEdit = (item) => { setEditingId(item.id); setEditingValue(item.text); };
  const saveEdit = () => {
    const value = editingValue.trim();
    if (value) onEdit(editingId, value);
    setEditingId(null);
    setEditingValue('');
  };

  return (
    <div className="queue-panel harness-scroll pointer-events-auto mx-auto mb-2 w-full max-w-[760px] overflow-y-auto rounded-2xl border shadow-lg">
      <div className="queue-header sticky top-0 z-10 flex items-center gap-2 border-b px-3.5 py-2.5 backdrop-blur">
        <span className="queue-pulse h-2 w-2 rounded-full" />
        <span className="font-semibold">Queued prompts</span>
        <span className="queue-count rounded-full px-2 py-0.5">{queue.length}</span>
        <span className="ml-auto text-harness-muted">Server queue · synced across devices</span>
      </div>
      <div className="grid gap-1 p-1.5">
        {queue.map((item, index) => (
          <div key={item.id} className={`queue-item rounded-xl border px-3 py-2.5 ${item.paused ? 'is-paused' : ''}`}>
            {editingId === item.id ? (
              <div className="grid gap-2">
                <textarea
                  autoFocus
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveEdit(); }
                    if (event.key === 'Escape') { setEditingId(null); setEditingValue(''); }
                  }}
                  rows={2}
                  className="queue-edit w-full resize-none rounded-lg border px-2.5 py-2 outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" className="queue-btn" onClick={() => { setEditingId(null); setEditingValue(''); }}>Cancel</button>
                  <button type="button" className="queue-btn queue-btn-primary" onClick={saveEdit}>Save</button>
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 items-start gap-3">
                <div className="queue-order mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">{index + 1}</div>
                <div className="min-w-0 flex-1"><div className="whitespace-pre-wrap break-words leading-5">{item.text}</div>{item.recovered && <div className="mt-1 text-[11px] font-semibold text-[#9a6d18]">Recovered after restart · paused for safety</div>}</div>
                <div className="queue-actions flex shrink-0 items-center gap-0.5">
                  <button type="button" className="queue-icon-btn" disabled={index === 0} onClick={() => onMove(index, -1)} title="Move up" aria-label="Move prompt up">↑</button>
                  <button type="button" className="queue-icon-btn" disabled={index === queue.length - 1} onClick={() => onMove(index, 1)} title="Move down" aria-label="Move prompt down">↓</button>
                  <button type="button" className="queue-icon-btn queue-text-btn" onClick={() => onTogglePause(item.id)}>{item.paused ? 'Resume' : 'Pause'}</button>
                  <button type="button" className="queue-icon-btn queue-text-btn" onClick={() => beginEdit(item)}>Edit</button>
                  <button type="button" className="queue-icon-btn queue-text-btn queue-delete" onClick={() => onDelete(item.id)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
