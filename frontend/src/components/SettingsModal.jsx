import React from 'react';
import { InfoIcon, XIcon } from '../icons';

export default function SettingsModal({ meta, onClose, onLogout = null }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#27231e]/20 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="settings-modal w-full max-w-lg rounded-3xl border border-harness-border bg-harness-panel shadow-popover" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-harness-border px-6 py-5">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-harness-primary">Settings</h2>
            <p className="mt-1 text-[13px] text-harness-muted">Runtime details for this Claude Harness instance.</p>
          </div>
          <button className="icon-btn ml-auto" onClick={onClose}><XIcon /></button>
        </div>
        <div className="space-y-4 p-6 text-sm">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.13em] text-harness-muted">Scan root</div>
            <div className="break-all rounded-xl border border-harness-border bg-harness-hover px-3 py-2.5 font-mono text-[13px] text-harness-primary">{meta?.root || '—'}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.13em] text-harness-muted">WebSocket</div>
              <div className="rounded-xl border border-harness-border bg-harness-hover px-3 py-2.5 text-harness-primary">{meta?.websocket || '—'}</div>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.13em] text-harness-muted">Authentication</div>
              <div className="rounded-xl border border-harness-border bg-harness-hover px-3 py-2.5 text-harness-primary">{meta?.authEnabled ? `Enabled${meta?.user ? ` · ${meta.user}` : ''}` : 'Disabled'}</div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.13em] text-harness-muted">Last scan</div>
            <div className="rounded-xl border border-harness-border bg-harness-hover px-3 py-2.5 text-harness-primary">{meta?.scannedAt ? new Date(meta.scannedAt).toLocaleString() : '—'}</div>
          </div>
          <div className="flex gap-2.5 rounded-xl border border-[#ead6ce] bg-[#fbf1ed] px-3.5 py-3 text-[#815342]">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-5">Background Claude runs and queued prompts live in the Harness server, so they continue when the browser closes and resync when another device connects.</p>
          </div>
          {meta?.authEnabled && onLogout && (
            <div className="flex justify-end pt-1">
              <button type="button" onClick={onLogout} className="rounded-xl border border-harness-border px-3.5 py-2 text-[14px] font-medium text-harness-primary transition hover:bg-harness-hover">Sign out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
