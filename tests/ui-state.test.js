'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UiStateStore } = require('../lib/ui-state');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-harness-ui-state-'));
const file = path.join(dir, 'ui-state.json');
const store = new UiStateStore(file);
assert.deepStrictEqual(store.get('draft', 'session-a'), { value: '', updatedAt: null });
store.set('draft', 'session-a', 'unfinished prompt');
store.set('note', 'session-a', '<b>remember this</b>');
assert.strictEqual(store.get('draft', 'session-a').value, 'unfinished prompt');
assert.strictEqual(store.get('note', 'session-a').value, '<b>remember this</b>');
const reload = new UiStateStore(file);
assert.strictEqual(reload.get('draft', 'session-a').value, 'unfinished prompt');
assert.strictEqual(reload.get('note', 'session-a').value, '<b>remember this</b>');
reload.set('draft', 'session-a', 'last writer wins');
assert.strictEqual(new UiStateStore(file).get('draft', 'session-a').value, 'last writer wins');
fs.rmSync(dir, { recursive: true, force: true });
console.log('ui-state tests passed');
