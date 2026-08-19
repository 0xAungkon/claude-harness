'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const transcriptCache = new Map();

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function usageFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const message = obj.message && typeof obj.message === 'object' ? obj.message : null;
  const usage = message?.usage || obj.usage || obj.result?.usage || null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    input: number(usage.input_tokens ?? usage.inputTokens),
    output: number(usage.output_tokens ?? usage.outputTokens),
    cacheRead: number(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens),
    cacheWrite: number(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens),
    model: String(message?.model || obj.model || obj.result?.model || '').trim() || null,
    id: String(obj.uuid || message?.id || obj.id || '').trim() || null
  };
}

function timestampFromObject(obj) {
  const raw = obj?.timestamp ?? obj?.created_at ?? obj?.message?.timestamp ?? obj?.message?.created_at;
  if (raw == null) return null;
  const d = new Date(typeof raw === 'number' && raw < 1e12 ? raw * 1000 : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function analyzeTranscriptText(text) {
  const result = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    messageCount: 0,
    toolCount: 0,
    models: {},
    firstAt: null,
    lastAt: null,
    days: {},
    lastUsage: null
  };
  const seenUsage = new Set();

  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj !== 'object') continue;

    const time = timestampFromObject(obj);
    if (time) {
      const iso = time.toISOString();
      if (!result.firstAt || iso < result.firstAt) result.firstAt = iso;
      if (!result.lastAt || iso > result.lastAt) result.lastAt = iso;
      const day = iso.slice(0, 10);
      if (!result.days[day]) result.days[day] = { messages: 0, tokens: 0 };
      result.days[day].messages += 1;
    }

    const wrapped = obj.message && typeof obj.message === 'object' ? obj.message : obj;
    const role = wrapped?.role || obj.role;
    if (role === 'user' || role === 'assistant' || role === 'tool') result.messageCount += 1;
    const content = wrapped?.content ?? obj.content;
    if (Array.isArray(content)) {
      for (const block of content) if (block?.type === 'tool_use') result.toolCount += 1;
    }

    const usage = usageFromObject(obj);
    if (!usage) continue;
    const fingerprint = usage.id ? `id:${usage.id}` : null;
    if (fingerprint && seenUsage.has(fingerprint)) continue;
    if (fingerprint) seenUsage.add(fingerprint);

    result.input += usage.input;
    result.output += usage.output;
    result.cacheRead += usage.cacheRead;
    result.cacheWrite += usage.cacheWrite;
    const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    result.total += tokens;
    result.lastUsage = { ...usage, total: tokens, timestamp: time ? time.toISOString() : null };
    if (usage.model) result.models[usage.model] = (result.models[usage.model] || 0) + tokens;
    if (time) {
      const day = time.toISOString().slice(0, 10);
      if (!result.days[day]) result.days[day] = { messages: 0, tokens: 0 };
      result.days[day].tokens += tokens;
    }
  }

  return result;
}

function analyzeTranscriptFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cached = transcriptCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.metrics;
    const metrics = analyzeTranscriptText(fs.readFileSync(filePath, 'utf8'));
    transcriptCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, metrics });
    if (transcriptCache.size > 1200) {
      const first = transcriptCache.keys().next().value;
      if (first) transcriptCache.delete(first);
    }
    return metrics;
  } catch { return analyzeTranscriptText(''); }
}

function dayDiff(a, b) {
  const one = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const two = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((two - one) / 86400000);
}

function calculateStreaks(dayKeys) {
  const dates = [...new Set(dayKeys)].sort();
  if (!dates.length) return { longest: 0, current: 0 };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i += 1) {
    const prev = new Date(`${dates[i - 1]}T00:00:00Z`);
    const cur = new Date(`${dates[i]}T00:00:00Z`);
    if (dayDiff(prev, cur) === 1) run += 1;
    else run = 1;
    if (run > longest) longest = run;
  }

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const lastKey = dates.at(-1);
  let current = 0;
  if (lastKey === todayKey || lastKey === yesterday) {
    current = 1;
    for (let i = dates.length - 1; i > 0; i -= 1) {
      const later = new Date(`${dates[i]}T00:00:00Z`);
      const earlier = new Date(`${dates[i - 1]}T00:00:00Z`);
      if (dayDiff(earlier, later) !== 1) break;
      current += 1;
    }
  }
  return { longest, current };
}

function aggregateStats(workspaces) {
  const overall = {
    sessions: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    toolCalls: 0,
    activeDays: 0,
    firstDay: null,
    lastDay: null,
    longestSessionMs: 0,
    longestSessionId: null,
    longestStreak: 0,
    currentStreak: 0,
    mostActiveDay: null,
    favoriteModel: null,
    days: [],
    models: []
  };
  const dayMap = new Map();
  const modelMap = new Map();

  for (const workspace of workspaces || []) {
    for (const session of workspace.sessions || []) {
      overall.sessions += 1;
      const metrics = analyzeTranscriptFile(session.path);
      overall.input += metrics.input;
      overall.output += metrics.output;
      overall.cacheRead += metrics.cacheRead;
      overall.cacheWrite += metrics.cacheWrite;
      overall.totalTokens += metrics.total;
      overall.toolCalls += metrics.toolCount;

      if (metrics.firstAt && metrics.lastAt) {
        const duration = Math.max(0, new Date(metrics.lastAt).getTime() - new Date(metrics.firstAt).getTime());
        if (duration > overall.longestSessionMs) {
          overall.longestSessionMs = duration;
          overall.longestSessionId = session.id;
        }
      }

      for (const [model, tokens] of Object.entries(metrics.models)) modelMap.set(model, (modelMap.get(model) || 0) + tokens);
      for (const [day, value] of Object.entries(metrics.days)) {
        const current = dayMap.get(day) || { date: day, tokens: 0, messages: 0, sessions: new Set() };
        current.tokens += value.tokens || 0;
        current.messages += value.messages || 0;
        current.sessions.add(session.id);
        dayMap.set(day, current);
      }
    }
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  overall.activeDays = days.length;
  overall.firstDay = days[0]?.date || null;
  overall.lastDay = days.at(-1)?.date || null;
  const streaks = calculateStreaks(days.map((d) => d.date));
  overall.longestStreak = streaks.longest;
  overall.currentStreak = streaks.current;
  overall.days = days.map((d) => ({ date: d.date, tokens: d.tokens, messages: d.messages, sessions: d.sessions.size }));
  overall.mostActiveDay = [...overall.days].sort((a, b) => (b.tokens || b.messages) - (a.tokens || a.messages))[0] || null;
  overall.models = [...modelMap.entries()].map(([id, tokens]) => ({ id, tokens })).sort((a, b) => b.tokens - a.tokens);
  overall.favoriteModel = overall.models[0]?.id || null;
  return overall;
}

function parseFrontmatter(text) {
  const source = String(text || '');
  if (!source.startsWith('---')) return {};
  const end = source.indexOf('\n---', 3);
  if (end < 0) return {};
  const out = {};
  for (const line of source.slice(3, end).split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) out[key] = value;
  }
  return out;
}

function listSkills(workspacePath = null) {
  const results = [];
  const seen = new Set();
  const sources = [
    { dir: path.join(os.homedir(), '.claude', 'skills'), scope: 'user' },
    workspacePath ? { dir: path.join(workspacePath, '.claude', 'skills'), scope: 'project' } : null
  ].filter(Boolean);
  const userSettings = (() => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')); } catch { return {}; } })();
  const projectSettings = workspacePath ? (() => {
    let shared = {}; let local = {};
    try { shared = JSON.parse(fs.readFileSync(path.join(workspacePath, '.claude', 'settings.json'), 'utf8')); } catch {}
    try { local = JSON.parse(fs.readFileSync(path.join(workspacePath, '.claude', 'settings.local.json'), 'utf8')); } catch {}
    return { ...shared, ...local, skillOverrides: { ...(shared.skillOverrides || {}), ...(local.skillOverrides || {}) } };
  })() : {};

  for (const source of sources) {
    let entries;
    try { entries = fs.readdirSync(source.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillPath = path.join(source.dir, entry.name, 'SKILL.md');
      let text;
      try { text = fs.readFileSync(skillPath, 'utf8'); } catch { continue; }
      const fm = parseFrontmatter(text);
      const name = fm.name || entry.name;
      const key = `${source.scope}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const overrides = source.scope === 'project' ? projectSettings.skillOverrides : userSettings.skillOverrides;
      const state = overrides && Object.prototype.hasOwnProperty.call(overrides, name) ? String(overrides[name]) : 'on';
      const description = fm.description || text.replace(/^---[\s\S]*?---\s*/m, '').split(/\n\s*\n/)[0].replace(/^#+\s*/gm, '').trim();
      results.push({
        name,
        scope: source.scope,
        path: skillPath,
        description: description.slice(0, 500),
        state,
        userInvocable: String(fm['user-invocable'] || 'true').toLowerCase() !== 'false',
        modelInvocable: String(fm['disable-model-invocation'] || 'false').toLowerCase() !== 'true'
      });
    }
  }
  function pluginNameFor(skillPath) {
    let dir = path.dirname(skillPath);
    for (let i = 0; i < 7; i += 1) {
      const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
      try {
        const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (parsed?.name) return String(parsed.name);
      } catch {}
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  function scanPluginSkills(root, depth = 0) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) { scanPluginSkills(full, depth + 1); continue; }
      if (!entry.isFile() || entry.name !== 'SKILL.md') continue;
      const normalized = full.split(path.sep).join('/');
      if (!normalized.includes('/skills/')) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const fm = parseFrontmatter(text);
      const rawName = fm.name || path.basename(path.dirname(full));
      const plugin = pluginNameFor(full);
      if (!plugin) continue;
      const name = rawName.includes(':') ? rawName : `${plugin}:${rawName}`;
      const key = `plugin:${name}:${full}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const description = fm.description || text.replace(/^---[\s\S]*?---\s*/m, '').split(/\n\s*\n/)[0].replace(/^#+\s*/gm, '').trim();
      results.push({
        name,
        scope: 'plugin',
        plugin,
        path: full,
        description: description.slice(0, 500),
        state: 'on',
        locked: true,
        userInvocable: String(fm['user-invocable'] || 'true').toLowerCase() !== 'false',
        modelInvocable: String(fm['disable-model-invocation'] || 'false').toLowerCase() !== 'true'
      });
    }
  }

  scanPluginSkills(path.join(os.homedir(), '.claude', 'plugins', 'cache'));
  scanPluginSkills(path.join(os.homedir(), '.claude', 'skills'));

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  analyzeTranscriptText,
  analyzeTranscriptFile,
  aggregateStats,
  listSkills,
  parseFrontmatter
};
