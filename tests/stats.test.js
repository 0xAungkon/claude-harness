'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeTranscriptText, aggregateStats, listSkills } = require('../lib/stats');

const sample = [
  { timestamp: '2026-08-16T10:00:00Z', message: { id: 'm1', role: 'assistant', model: 'test-model', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 }, content: [{ type: 'text', text: 'hello' }] } },
  { timestamp: '2026-08-17T10:00:00Z', message: { id: 'm2', role: 'assistant', model: 'test-model', usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 60, cache_creation_input_tokens: 15 }, content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }
].map(JSON.stringify).join('\n');

const metrics = analyzeTranscriptText(sample);
assert.strictEqual(metrics.input, 220);
assert.strictEqual(metrics.output, 50);
assert.strictEqual(metrics.cacheRead, 110);
assert.strictEqual(metrics.cacheWrite, 25);
assert.strictEqual(metrics.toolCount, 1);
assert.strictEqual(metrics.models['test-model'], 405);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-harness-stats-'));
const transcript = path.join(tmp, 'session.jsonl');
fs.writeFileSync(transcript, sample);
const overall = aggregateStats([{ sessions: [{ id: 's1', path: transcript }] }]);
assert.strictEqual(overall.sessions, 1);
assert.strictEqual(overall.totalTokens, 405);
assert.strictEqual(overall.favoriteModel, 'test-model');
assert.strictEqual(overall.activeDays, 2);

const workspace = path.join(tmp, 'project');
fs.mkdirSync(path.join(workspace, '.claude', 'skills', 'demo'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\n# Demo\n');
fs.writeFileSync(path.join(workspace, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { demo: 'off' } }));
const skills = listSkills(workspace);
const demo = skills.find((item) => item.name === 'demo' && item.scope === 'project');
assert(demo);
assert.strictEqual(demo.state, 'off');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('stats tests passed');
