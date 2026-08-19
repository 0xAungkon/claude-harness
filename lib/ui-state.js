'use strict';

const { createLogger } = require('./logger');
const log = createLogger('ui-state');

const fs = require('fs');
const path = require('path');

function isoNow() { return new Date().toISOString(); }

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

class UiStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { version: 1, draft: {}, note: {} };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        this.state.version = 1;
        this.state.draft = parsed.draft && typeof parsed.draft === 'object' && !Array.isArray(parsed.draft) ? parsed.draft : {};
        this.state.note = parsed.note && typeof parsed.note === 'object' && !Array.isArray(parsed.note) ? parsed.note : {};
      }
    } catch { /* first run */ }
  }

  persist() {
    try { writeAtomic(this.filePath, this.state); }
    catch (error) { log.warn('Unable to persist UI state', { error, file: this.filePath }); }
  }

  normalizeKind(kind) {
    return kind === 'note' ? 'note' : kind === 'draft' ? 'draft' : null;
  }

  get(kind, key) {
    const bucket = this.normalizeKind(kind);
    const normalizedKey = String(key || '').trim();
    if (!bucket || !normalizedKey) return null;
    const item = this.state[bucket][normalizedKey];
    if (!item || typeof item !== 'object') return { value: '', updatedAt: null };
    return { value: typeof item.value === 'string' ? item.value : '', updatedAt: item.updatedAt || null };
  }

  set(kind, key, value) {
    const bucket = this.normalizeKind(kind);
    const normalizedKey = String(key || '').trim();
    if (!bucket) throw new Error('Unsupported UI state kind.');
    if (!normalizedKey || normalizedKey.length > 4096) throw new Error('Invalid UI state key.');
    const max = bucket === 'note' ? 2 * 1024 * 1024 : 256 * 1024;
    const normalizedValue = String(value ?? '');
    if (Buffer.byteLength(normalizedValue, 'utf8') > max) throw new Error(`${bucket === 'note' ? 'Note' : 'Draft'} is too large.`);
    const item = { value: normalizedValue, updatedAt: isoNow() };
    this.state[bucket][normalizedKey] = item;
    this.persist();
    return { ...item };
  }

  delete(kind, key) {
    const bucket = this.normalizeKind(kind);
    const normalizedKey = String(key || '').trim();
    if (!bucket || !normalizedKey) return false;
    const existed = Object.prototype.hasOwnProperty.call(this.state[bucket], normalizedKey);
    if (existed) {
      delete this.state[bucket][normalizedKey];
      this.persist();
    }
    return existed;
  }
}

module.exports = { UiStateStore };
