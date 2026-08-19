'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function isoNow() { return new Date().toISOString(); }

function cloneState(state) {
  return {
    key: state.key,
    claudeSessionId: state.claudeSessionId || state.key,
    sessionId: state.sessionId || null,
    workspaceId: state.workspaceId || null,
    workspacePath: state.workspacePath || null,
    status: state.status || 'idle',
    active: state.active ? { ...state.active, runtimeOptions: { ...(state.active.runtimeOptions || {}) } } : null,
    queue: (state.queue || []).map((item) => ({ ...item, runtimeOptions: { ...(item.runtimeOptions || {}) } })),
    lastError: state.lastError || null,
    sideQuestions: (state.sideQuestions || []).map((item) => ({ ...item })),
    createdAt: state.createdAt || null,
    updatedAt: state.updatedAt || null
  };
}

class RuntimeStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.sessions = new Map();
    this.load();
  }

  load() {
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { parsed = null; }
    const list = parsed && Array.isArray(parsed.sessions) ? parsed.sessions : [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const key = String(raw.key || raw.claudeSessionId || '').trim();
      if (!key) continue;
      const state = {
        key,
        claudeSessionId: String(raw.claudeSessionId || key),
        sessionId: raw.sessionId || null,
        workspaceId: raw.workspaceId || null,
        workspacePath: raw.workspacePath || null,
        status: raw.status || 'idle',
        active: raw.active && typeof raw.active === 'object' ? raw.active : null,
        queue: Array.isArray(raw.queue) ? raw.queue.filter((item) => item && typeof item.text === 'string') : [],
        lastError: raw.lastError || null,
        sideQuestions: Array.isArray(raw.sideQuestions) ? raw.sideQuestions.filter((item) => item && typeof item.question === 'string').slice(-20) : [],
        createdAt: raw.createdAt || isoNow(),
        updatedAt: raw.updatedAt || isoNow()
      };
      // If the server itself was stopped while Claude was running, the child
      // process is gone. Requeue the active prompt so the queue remains durable.
      if ((state.status === 'running' || state.status === 'waiting_approval' || state.status === 'stopping') && state.active?.text) {
        state.queue.unshift({ ...state.active, paused: true, recovered: true });
        state.active = null;
        state.status = 'idle';
        state.lastError = 'Claude Harness restarted while this prompt was running. The prompt was restored to the queue in a paused state; review it before resuming to avoid repeating side effects.';
      }
      this.sessions.set(key, state);
    }
    this.persist();
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify({ version: 1, sessions: [...this.sessions.values()].map(cloneState) }, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      console.warn(`Claude Harness: unable to persist runtime state: ${error.message}`);
    }
  }

  list() { return [...this.sessions.values()].map(cloneState); }
  snapshot() { return { sessions: this.list() }; }

  get(ref) {
    if (!ref) return null;
    const value = String(ref);
    if (this.sessions.has(value)) return this.sessions.get(value);
    for (const state of this.sessions.values()) {
      if (state.claudeSessionId === value || state.sessionId === value) return state;
    }
    return null;
  }

  remove(ref) {
    const state = this.get(ref);
    if (!state) return false;
    const removed = this.sessions.delete(state.key);
    if (removed) this.persist();
    return removed;
  }

  ensure(meta = {}) {
    const key = String(meta.key || meta.claudeSessionId || '').trim();
    if (!key) throw new Error('Runtime session key is required.');
    let state = this.sessions.get(key);
    if (!state) {
      state = {
        key,
        claudeSessionId: String(meta.claudeSessionId || key),
        sessionId: meta.sessionId || null,
        workspaceId: meta.workspaceId || null,
        workspacePath: meta.workspacePath || null,
        status: 'idle',
        active: null,
        queue: [],
        lastError: null,
        sideQuestions: [],
        createdAt: isoNow(),
        updatedAt: isoNow()
      };
      this.sessions.set(key, state);
    } else {
      if (meta.claudeSessionId) state.claudeSessionId = String(meta.claudeSessionId);
      if (meta.sessionId) state.sessionId = meta.sessionId;
      if (meta.workspaceId) state.workspaceId = meta.workspaceId;
      if (meta.workspacePath) state.workspacePath = meta.workspacePath;
      state.updatedAt = isoNow();
    }
    this.persist();
    return state;
  }

  touch(state) {
    state.updatedAt = isoNow();
    this.persist();
    return state;
  }

  addPrompt(state, text, runtimeOptions = {}) {
    const item = {
      id: crypto.randomUUID(),
      text: String(text || '').trim(),
      paused: false,
      createdAt: isoNow(),
      runtimeOptions: {
        permissionMode: runtimeOptions.permissionMode || 'acceptEdits',
        model: runtimeOptions.model || 'default',
        additionalDirs: Array.isArray(runtimeOptions.additionalDirs) ? runtimeOptions.additionalDirs : []
      }
    };
    state.queue.push(item);
    state.lastError = null;
    this.touch(state);
    return item;
  }

  deletePrompt(state, itemId) {
    const before = state.queue.length;
    state.queue = state.queue.filter((item) => item.id !== itemId);
    if (before !== state.queue.length) this.touch(state);
    return before !== state.queue.length;
  }

  updatePrompt(state, itemId, patch = {}) {
    const item = state.queue.find((entry) => entry.id === itemId);
    if (!item) return null;
    if (typeof patch.text === 'string' && patch.text.trim()) item.text = patch.text.trim();
    if (typeof patch.paused === 'boolean') item.paused = patch.paused;
    this.touch(state);
    return item;
  }

  movePrompt(state, itemId, targetIndex) {
    const index = state.queue.findIndex((entry) => entry.id === itemId);
    if (index < 0) return false;
    const bounded = Math.max(0, Math.min(state.queue.length - 1, Number(targetIndex)));
    if (!Number.isInteger(bounded) || bounded === index) return false;
    const [item] = state.queue.splice(index, 1);
    state.queue.splice(bounded, 0, item);
    this.touch(state);
    return true;
  }

  nextRunnable(state) {
    return state.queue.find((item) => !item.paused) || null;
  }

  begin(state, item) {
    state.queue = state.queue.filter((entry) => entry.id !== item.id);
    state.active = { ...item, startedAt: isoNow() };
    state.status = 'running';
    state.lastError = null;
    this.touch(state);
  }

  waitingApproval(state) {
    if (!state) return;
    state.status = 'waiting_approval';
    this.touch(state);
  }

  running(state) {
    if (!state) return;
    if (state.active) state.status = 'running';
    this.touch(state);
  }

  complete(state) {
    state.active = null;
    state.status = 'idle';
    state.lastError = null;
    this.touch(state);
  }

  fail(state, error) {
    state.active = null;
    state.status = 'error';
    state.lastError = error?.message || String(error || 'Claude Code failed.');
    this.touch(state);
  }

  requestStop(state) {
    if (!state || !state.active) return;
    state.status = 'stopping';
    this.touch(state);
  }

  cancel(state) {
    if (!state) return;
    state.active = null;
    state.status = 'idle';
    state.lastError = null;
    this.touch(state);
  }

  addSideQuestion(state, question) {
    const item = {
      id: crypto.randomUUID(),
      question: String(question || '').trim(),
      answer: '',
      error: null,
      status: 'queued',
      createdAt: isoNow(),
      updatedAt: isoNow()
    };
    if (!Array.isArray(state.sideQuestions)) state.sideQuestions = [];
    state.sideQuestions.push(item);
    state.sideQuestions = state.sideQuestions.slice(-20);
    this.touch(state);
    return item;
  }

  updateSideQuestion(state, itemId, patch = {}) {
    const item = (state.sideQuestions || []).find((entry) => entry.id === itemId);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: isoNow() });
    this.touch(state);
    return item;
  }

  publicState(state) { return cloneState(state); }
}

module.exports = { RuntimeStore };
