#!/usr/bin/env node
'use strict';

const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { exec, spawn } = require('child_process');
const { MAX_DEPTH, SKIP_DIRS, createScanner, firstUsefulName } = require('./lib/claude');
const { listProjectFiles, searchProjectFiles } = require('./lib/file-index');
const { RuntimeStore } = require('./lib/runtime-state');
const { UiStateStore } = require('./lib/ui-state');
const { aggregateStats, analyzeTranscriptFile, listSkills } = require('./lib/stats');
const { WebSocketServer, WebSocket } = require('ws');
const { createLogger } = require('./lib/logger');

const log = createLogger('server');

const MAX_CLAUDE_OUTPUT_BYTES = 12 * 1024 * 1024;
const VALID_PERMISSION_MODES = new Set(['manual', 'default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']);
const MODEL_ALIASES = [
  { id: 'default', label: 'Default', source: 'Claude Code' },
  { id: 'best', label: 'Best available', source: 'Claude Code alias' },
  { id: 'fable', label: 'Fable', source: 'Claude Code alias' },
  { id: 'sonnet', label: 'Sonnet', source: 'Claude Code alias' },
  { id: 'opus', label: 'Opus', source: 'Claude Code alias' },
  { id: 'haiku', label: 'Haiku', source: 'Claude Code alias' },
  { id: 'sonnet[1m]', label: 'Sonnet · 1M context', source: 'Claude Code alias' },
  { id: 'opus[1m]', label: 'Opus · 1M context', source: 'Claude Code alias' }
];

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}


function internalStatusLineCommand(port, token) {
  const executable = `"${String(process.execPath).replace(/"/g, '\\"')}"`;
  const script = process.pkg ? '' : ` "${String(__filename).replace(/"/g, '\\"')}"`;
  return `${executable}${script} --statusline-hook http://127.0.0.1:${port}/api/internal/statusline ${token}`;
}

function maybeRunStatusLineHelper(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--statusline-hook');
  if (index < 0) return false;
  const url = argv[index + 1];
  const token = argv[index + 2];
  if (!url || !token) process.exit(0);
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; if (input.length > 2 * 1024 * 1024) input = input.slice(-2 * 1024 * 1024); });
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(input || '{}'); } catch { process.exit(0); return; }
    let target;
    try { target = new URL(url); } catch { process.exit(0); return; }
    const body = JSON.stringify(payload);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Claude-Harness-Token': token
      },
      timeout: 3000
    }, (response) => { response.resume(); response.on('end', () => process.exit(0)); });
    request.on('timeout', () => { request.destroy(); process.exit(0); });
    request.on('error', () => process.exit(0));
    request.end(body);
  });
  process.stdin.resume();
  return true;
}

function runClaudeCli(args, cwd, { timeout = 20000, env: extraEnv = null } = {}) {
  return new Promise((resolve, reject) => {
    const claudeBin = process.env.CLAUDE_HARNESS_CLAUDE_BIN || 'claude';
    let child;
    try {
      const childEnv = { ...process.env, ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}) };
      delete childEnv.CH_USER;
      delete childEnv.CH_PASSWORD;
      child = spawn(claudeBin, args, { cwd: cwd || os.homedir(), env: childEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { reject(error); return; }
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, timeout);
    child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes < 4 * 1024 * 1024) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { bytes += chunk.length; if (bytes < 4 * 1024 * 1024) stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || stdout.trim() || `Claude CLI exited with status ${code}`));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function validateRuntimeOptions(body, cwd) {
  const permissionMode = typeof body?.permissionMode === 'string' ? body.permissionMode : 'acceptEdits';
  if (!VALID_PERMISSION_MODES.has(permissionMode)) throw new Error(`Unsupported permission mode: ${permissionMode}`);

  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 240) : 'default';
  const seen = new Set();
  const additionalDirs = [];
  for (const raw of Array.isArray(body?.additionalDirs) ? body.additionalDirs : []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = raw.trim();
    const expanded = value === '~' ? os.homedir()
      : value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2))
      : path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value);
    if (seen.has(expanded)) continue;
    try { if (!fs.statSync(expanded).isDirectory()) continue; } catch { continue; }
    seen.add(expanded);
    additionalDirs.push(expanded);
    if (additionalDirs.length >= 12) break;
  }
  return { permissionMode, model, additionalDirs };
}

function collectConfiguredModels(workspacePath = null) {
  const models = new Map(MODEL_ALIASES.map((item) => [item.id, { ...item }]));
  const add = (id, source = 'Configured') => {
    if (typeof id !== 'string') return;
    const value = id.trim();
    if (!value || value.length > 240 || models.has(value)) return;
    models.set(value, { id: value, label: value, source });
  };
  const isModelEnvKey = (key) => /^(?:ANTHROPIC_MODEL|ANTHROPIC_DEFAULT_(?:OPUS|SONNET|HAIKU)_MODEL|CLAUDE_CODE_[A-Z0-9_]*MODEL|[A-Z0-9_]+_MODEL)$/i.test(String(key || ''));
  const inspect = (settings, source) => {
    if (!settings || typeof settings !== 'object') return;
    add(settings.model, source);
    add(settings.defaultModel, source);
    add(settings.opusModel, source);
    add(settings.sonnetModel, source);
    add(settings.haikuModel, source);
    if (settings.env && typeof settings.env === 'object') {
      for (const [key, value] of Object.entries(settings.env)) {
        if (isModelEnvKey(key)) add(value, `${source} · ${key}`);
      }
    }
  };

  inspect(safeReadJson(path.join(os.homedir(), '.claude', 'settings.json')), 'User settings');
  inspect(safeReadJson(path.join(os.homedir(), '.claude.json')), 'Claude configuration');
  if (workspacePath) {
    inspect(safeReadJson(path.join(workspacePath, '.claude', 'settings.json')), 'Project settings');
    inspect(safeReadJson(path.join(workspacePath, '.claude', 'settings.local.json')), 'Project local settings');
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (isModelEnvKey(key)) add(value, `Environment · ${key}`);
  }
  return [...models.values()];
}

function isDevelopmentMode() {
  return process.env.CLAUDE_HARNESS_DEV === '1';
}

function loadProductionHtml() {
  try {
    // Literal require is intentional so pkg includes the generated module.
    return require('./generated/app-html');
  } catch (error) {
    const wrapped = new Error(
      'Production UI is not built. Run `npm run build` first, then `npm start`. ' +
      'For development use `npm run dev`.'
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

function parseArgs(argv) {
  const out = { root: os.homedir(), host: process.env.CH_HOST || '127.0.0.1', port: 3030, open: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--open') out.open = true;
    else if (arg === '--no-open') out.open = false;
    else if (arg === '--root' && argv[i + 1]) out.root = argv[++i];
    else if (arg.startsWith('--root=')) out.root = arg.slice(7);
    else if (arg === '--host' && argv[i + 1]) out.host = String(argv[++i]);
    else if (arg.startsWith('--host=')) out.host = arg.slice(7);
    else if (arg === '--port' && argv[i + 1]) out.port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice(7));
    else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
  }

  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) {
    throw new Error('--port must be an integer from 1 to 65535');
  }

  out.root = path.resolve(String(out.root));
  out.host = String(out.host || '127.0.0.1').trim() || '127.0.0.1';
  return out;
}

function printHelp() {
  process.stdout.write(`Claude Harness — local Claude Code session UI\n\nUsage:\n  claude-harness [--root <path>] [--host <host>] [--port <n>] [--open]\n\nOptions:\n  --root <path>   Scan root (default: $HOME)\n  --host <host>   Bind host (default: 127.0.0.1; use 0.0.0.0 for LAN access)\n  --port <n>      HTTP port (default: 3030)\n  --open          Open the default browser after startup (off by default)\n  --no-open       Explicitly keep browser auto-open disabled\n  -h, --help      Show this help\n\nLogging:\n  CH_LOG_LEVEL=debug|info|warn|error|silent (default: info)\n  CH_LOG_HTTP=1 logs successful HTTP requests as well.\n\nLive prompts invoke the locally installed "claude" executable.\n`);
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, (error) => { if (error) log.warn('Unable to open browser', { error, url }); });
}


function createAuthConfig() {
  const userDefined = Object.prototype.hasOwnProperty.call(process.env, 'CH_USER');
  const passwordDefined = Object.prototype.hasOwnProperty.call(process.env, 'CH_PASSWORD');
  if (userDefined !== passwordDefined) {
    throw new Error('CH_USER and CH_PASSWORD must either both be defined or both be unset.');
  }
  if (!userDefined) return { enabled: false, cookieName: 'ch_auth' };
  const user = String(process.env.CH_USER || '').trim();
  const password = String(process.env.CH_PASSWORD || '');
  if (!user || !password) throw new Error('CH_USER and CH_PASSWORD cannot be empty when authentication is enabled.');
  const token = crypto.createHmac('sha256', password)
    .update(`claude-harness-auth\n${String(user)}`)
    .digest('hex');
  return { enabled: true, user: String(user), password: String(password), token, cookieName: 'ch_auth' };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requestAuthenticated(req, auth) {
  if (!auth.enabled) return true;
  const cookies = parseCookies(req.headers?.cookie || req.get?.('cookie'));
  return timingSafeStringEqual(cookies[auth.cookieName], auth.token);
}

function setAuthCookie(res, auth) {
  res.setHeader('Set-Cookie', `${auth.cookieName}=${encodeURIComponent(auth.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
}

function clearAuthCookie(res, auth) {
  res.setHeader('Set-Cookie', `${auth.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function parseClaudePayload(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }

  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* keep looking */ }
  }
  return null;
}


function mergeHarnessHooks(cwd, harnessHooks) {
  const merged = {};
  const sources = [
    safeReadJson(path.join(os.homedir(), '.claude', 'settings.json')),
    safeReadJson(path.join(cwd, '.claude', 'settings.json')),
    safeReadJson(path.join(cwd, '.claude', 'settings.local.json'))
  ];

  for (const source of sources) {
    const hooks = source?.hooks;
    if (!hooks || typeof hooks !== 'object') continue;
    for (const [eventName, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      if (!merged[eventName]) merged[eventName] = [];
      merged[eventName].push(...groups);
    }
  }

  for (const [eventName, groups] of Object.entries(harnessHooks || {})) {
    if (!merged[eventName]) merged[eventName] = [];
    merged[eventName].push(...groups);
  }
  return merged;
}

function buildHarnessHookSettings({ cwd, port, token, permissionMode }) {
  if (!port || !token) return null;
  const base = `http://127.0.0.1:${port}/api/internal/hooks`;
  const common = { type: 'http', timeout: 3600, headers: { 'X-Claude-Harness-Token': token } };
  const hooks = {
    PreToolUse: [
      {
        // AskUserQuestion is human input rather than a permission boundary, so
        // keep it interactive even in bypass mode. ExitPlanMode is automatically
        // allowed when bypassPermissions is active.
        matcher: permissionMode === 'bypassPermissions' ? 'AskUserQuestion' : 'AskUserQuestion|ExitPlanMode',
        hooks: [{ ...common, url: `${base}/interactive` }]
      }
    ]
  };

  // In headless `-p` mode Claude cannot display its own terminal permission
  // prompt. These matchers route the actions that normally require a human
  // decision through the Harness web approval dialog instead.
  let gatedMatcher = '';
  if (permissionMode === 'manual' || permissionMode === 'default') {
    gatedMatcher = 'Bash|PowerShell|Write|Edit|NotebookEdit|WebFetch|Task|Agent';
  } else if (permissionMode === 'acceptEdits') {
    gatedMatcher = 'Bash|PowerShell|WebFetch|Task|Agent';
  }
  if (gatedMatcher) {
    hooks.PreToolUse.push({
      matcher: gatedMatcher,
      hooks: [{ ...common, url: `${base}/approval` }]
    });
  }

  // Newer Claude Code builds can emit PermissionRequest in headless flows.
  // Keep this hook as well so provider / connector / policy prompts surface in
  // the same modal when Claude itself identifies a permission boundary.
  if (permissionMode !== 'bypassPermissions' && permissionMode !== 'dontAsk') {
    hooks.PermissionRequest = [{
      matcher: '.*',
      hooks: [{ ...common, url: `${base}/permission-request` }]
    }];
  }

  const allowedHttpHookUrls = [];
  for (const source of [
    safeReadJson(path.join(os.homedir(), '.claude', 'settings.json')),
    safeReadJson(path.join(cwd, '.claude', 'settings.json')),
    safeReadJson(path.join(cwd, '.claude', 'settings.local.json'))
  ]) {
    for (const value of Array.isArray(source?.allowedHttpHookUrls) ? source.allowedHttpHookUrls : []) {
      if (typeof value === 'string' && value && !allowedHttpHookUrls.includes(value)) allowedHttpHookUrls.push(value);
    }
  }
  for (const value of [`${base}/interactive`, `${base}/approval`, `${base}/permission-request`]) {
    if (!allowedHttpHookUrls.includes(value)) allowedHttpHookUrls.push(value);
  }

  return {
    hooks,
    allowedHttpHookUrls,
    statusLine: {
      type: 'command',
      command: internalStatusLineCommand(port, token)
    }
  };
}

function runClaudeCode({
  cwd, prompt, resumeId = null, sessionId = null,
  permissionMode = 'acceptEdits', model = 'default', additionalDirs = [],
  harnessPort = null, hookToken = null, onSpawn = null,
  forkSession = false, tools = null, disallowedTools = []
}) {
  return new Promise((resolve, reject) => {
    const claudeBin = process.env.CLAUDE_HARNESS_CLAUDE_BIN || 'claude';
    const normalizedPermission = permissionMode === 'manual' ? 'default' : permissionMode;
    const args = normalizedPermission === 'bypassPermissions'
      ? ['--dangerously-skip-permissions', '-p', prompt, '--output-format', 'json']
      : ['-p', prompt, '--output-format', 'json', '--permission-mode', normalizedPermission || 'acceptEdits'];
    // Claude Code documents --dangerously-skip-permissions as the CLI
    // equivalent of bypassPermissions. Keep it as the leading flag so newer
    // Claude Code launch routing also recognizes the mode before print mode.
    const hookSettings = buildHarnessHookSettings({ cwd, port: harnessPort, token: hookToken, permissionMode: normalizedPermission });
    if (hookSettings) args.push('--settings', JSON.stringify(hookSettings));
    if (model && model !== 'default') args.push('--model', model);
    if (tools !== null && tools !== undefined) args.push('--tools', String(tools));
    for (const rule of Array.isArray(disallowedTools) ? disallowedTools : []) {
      if (typeof rule === 'string' && rule.trim()) args.push('--disallowedTools', rule.trim());
    }
    const dirs = (Array.isArray(additionalDirs) ? additionalDirs : []).filter(Boolean);
    if (dirs.length) args.push('--add-dir', ...dirs);
    if (resumeId) {
      args.push('--resume', resumeId);
      if (forkSession) args.push('--fork-session');
    } else if (sessionId) args.push('--session-id', sessionId);

    let child;
    try {
      const childEnv = { ...process.env, CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: 'true' };
      // Harness login credentials are for the web portal only and must never
      // be exposed to Claude Code or tools that Claude launches.
      delete childEnv.CH_USER;
      delete childEnv.CH_PASSWORD;
      child = spawn(claudeBin, args, {
        cwd,
        env: childEnv,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      if (typeof onSpawn === 'function') onSpawn(child);
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        fail(new Error('Claude Code CLI was not found. Install Claude Code and make sure the `claude` command is available in PATH.'));
        return;
      }
      fail(new Error(`Unable to start Claude Code: ${error.message}`));
    });

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_CLAUDE_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        fail(new Error('Claude Code produced more output than Claude Harness can safely buffer for one turn.'));
        return;
      }
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_CLAUDE_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        fail(new Error('Claude Code produced more output than Claude Harness can safely buffer for one turn.'));
        return;
      }
      stderr += chunk.toString('utf8');
    });

    // Keep stdin valid but empty. The actual prompt is passed as an argv value.
    child.stdin.end();

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;

      const payload = parseClaudePayload(stdout);
      if (code !== 0) {
        const detail = payload?.result || payload?.error || stderr.trim() || stdout.trim() || `Claude Code exited with status ${code}${signal ? ` (${signal})` : ''}.`;
        reject(new Error(String(detail)));
        return;
      }

      resolve({
        payload,
        result: payload?.result ?? stdout.trim(),
        sessionId: payload?.session_id || payload?.sessionId || sessionId || resumeId || null,
        stderr: stderr.trim()
      });
    });
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    log.error('Invalid command-line arguments', { error });
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  try {
    const stat = fs.statSync(args.root);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    log.error('Scan root is not readable', { root: args.root });
    process.exitCode = 2;
    return;
  }

  let auth;
  try { auth = createAuthConfig(); }
  catch (error) {
    log.error('Authentication configuration is invalid', { error });
    process.exitCode = 2;
    return;
  }

  const scanner = createScanner();
  let workspaceCache = [];
  let scanMeta = { root: args.root, scannedAt: null };
  const activeRuns = new Set();
  const runtimeWorkers = new Map();
  const activeProcesses = new Map();
  const cancelledRuns = new Set();
  const btwWorkers = new Set();
  const approvalRequests = new Map();
  const hookToken = crypto.randomBytes(24).toString('hex');
  const fileIndexCache = new Map();
  const FILE_INDEX_TTL_MS = 5000;
  const harnessStateDir = path.join(os.homedir(), '.claude-harness');
  const runtimeStore = new RuntimeStore(path.join(harnessStateDir, 'runtime-state.json'));
  const uiStateStore = new UiStateStore(path.join(harnessStateDir, 'ui-state.json'));
  const sessionNamesPath = path.join(harnessStateDir, 'session-names.json');
  const permissionRulesPath = path.join(harnessStateDir, 'permission-rules.json');
  const statusMetricsPath = path.join(harnessStateDir, 'session-metrics.json');
  const settingsPath = path.join(harnessStateDir, 'settings.json');
  let broadcast = () => {};
  let sessionNames = safeReadJson(sessionNamesPath) || {};
  let permissionRules = safeReadJson(permissionRulesPath);
  if (!Array.isArray(permissionRules)) permissionRules = [];
  let statusMetrics = safeReadJson(statusMetricsPath) || {};
  if (!statusMetrics || typeof statusMetrics !== 'object' || Array.isArray(statusMetrics)) statusMetrics = {};
  let overallStatsCache = { at: 0, data: null };

  function expandSettingsPath(value) {
    const raw = String(value || '').trim();
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(args.root, raw);
  }

  function normalizeHarnessSettings(input, { strict = false } = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const rawLocations = Array.isArray(source.scanLocations) ? source.scanLocations : null;
    const fallback = [{ id: 'default-root', type: 'path', value: args.root, depth: MAX_DEPTH, enabled: true }];
    const locations = [];
    for (const item of rawLocations == null ? fallback : rawLocations) {
      if (!item || item.enabled === false) continue;
      const type = item.type === 'regex' ? 'regex' : 'path';
      const rawValue = String(item.value || item.pattern || '').trim();
      if (!rawValue) {
        if (strict) throw new Error('Every scan location needs a folder path or regular expression.');
        continue;
      }
      const depthNumber = Number(item.depth);
      if (strict && (!Number.isFinite(depthNumber) || depthNumber < 0 || depthNumber > 20)) throw new Error('Scan depth must be between 0 and 20.');
      const depth = Math.max(0, Math.min(20, Number.isFinite(depthNumber) ? Math.floor(depthNumber) : MAX_DEPTH));
      let value = rawValue;
      if (type === 'regex') {
        try { new RegExp(value); } catch (error) {
          if (strict) throw new Error(`Invalid regular expression: ${value}`);
          continue;
        }
      } else {
        value = expandSettingsPath(value);
      }
      locations.push({
        id: String(item.id || crypto.randomUUID()),
        type,
        value,
        depth,
        enabled: true
      });
    }
    if (!locations.length) {
      if (strict) throw new Error('Add at least one scan location.');
      return { scanLocations: fallback };
    }
    return { scanLocations: locations };
  }

  let harnessSettings = normalizeHarnessSettings(safeReadJson(settingsPath));

  function saveHarnessSettings() {
    try { writeJsonAtomic(settingsPath, harnessSettings); }
    catch (error) { log.warn('Unable to persist settings', { error, file: settingsPath }); }
  }

  function publicHarnessSettings() {
    return { scanLocations: harnessSettings.scanLocations.map((item) => ({ ...item })) };
  }

  function workspaceAllowedBySettings(workspacePath) {
    const resolved = path.resolve(String(workspacePath || ''));
    const normalized = resolved.split(path.sep).join('/');
    for (const location of harnessSettings.scanLocations || []) {
      if (location.type === 'regex') {
        try { if (new RegExp(location.value).test(normalized)) return true; } catch { /* validated on save */ }
        continue;
      }
      const base = path.resolve(location.value);
      const relative = path.relative(base, resolved);
      if (relative === '') return true;
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      const depth = relative.split(path.sep).filter(Boolean).length;
      if (depth <= Number(location.depth || 0)) return true;
    }
    return false;
  }

  function saveSessionNames() {
    try {
      fs.mkdirSync(harnessStateDir, { recursive: true });
      fs.writeFileSync(sessionNamesPath, `${JSON.stringify(sessionNames, null, 2)}\n`, 'utf8');
    } catch (error) {
      log.warn('Unable to persist session names', { error, file: sessionNamesPath });
    }
  }


  function savePermissionRules() {
    try {
      fs.mkdirSync(harnessStateDir, { recursive: true });
      fs.writeFileSync(permissionRulesPath, `${JSON.stringify(permissionRules, null, 2)}\n`, 'utf8');
    } catch (error) {
      log.warn('Unable to persist permission rules', { error, file: permissionRulesPath });
    }
  }

  function saveStatusMetrics() {
    try {
      const entries = Object.entries(statusMetrics)
        .sort((a, b) => String(b[1]?.capturedAt || '').localeCompare(String(a[1]?.capturedAt || '')))
        .slice(0, 600);
      statusMetrics = Object.fromEntries(entries);
      writeJsonAtomic(statusMetricsPath, statusMetrics);
    } catch (error) {
      log.warn('Unable to persist session metrics', { error, file: statusMetricsPath });
    }
  }

  function overallStats(force = false) {
    const now = Date.now();
    if (!force && overallStatsCache.data && now - overallStatsCache.at < 15000) return overallStatsCache.data;
    const data = aggregateStats(workspaceCache);
    overallStatsCache = { at: now, data };
    return data;
  }

  function capturePayloadMetrics(payload, sessionId, cwd) {
    if (!payload || typeof payload !== 'object' || !sessionId) return;
    const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage : {};
    const modelUsage = payload.modelUsage && typeof payload.modelUsage === 'object' ? payload.modelUsage : {};
    const modelEntry = Object.entries(modelUsage)[0] || [];
    const modelId = typeof payload.model === 'string' ? payload.model : (modelEntry[0] || null);
    const modelMeta = modelEntry[1] && typeof modelEntry[1] === 'object' ? modelEntry[1] : {};
    const input = Number(usage.input_tokens || usage.inputTokens || 0);
    const cacheRead = Number(usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0);
    const cacheWrite = Number(usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0);
    const output = Number(usage.output_tokens || usage.outputTokens || 0);
    if (!(input || cacheRead || cacheWrite || output || modelId)) return;
    const windowSize = Number(modelMeta.contextWindow || modelMeta.context_window || process.env.CLAUDE_HARNESS_CONTEXT_WINDOW || 200000);
    const current = input + cacheRead + cacheWrite;
    const used = windowSize > 0 ? Math.min(100, (current / windowSize) * 100) : 0;
    const existing = statusMetrics[sessionId];
    // Prefer a real status-line snapshot when it is newer; this is a reliable
    // fallback for headless builds that do not execute statusLine handlers.
    const captured = {
      session_id: sessionId,
      model: { id: modelId, display_name: modelId || existing?.model?.display_name || 'Unknown model' },
      workspace: { current_dir: cwd, project_dir: cwd, added_dirs: [] },
      context_window: {
        total_input_tokens: current,
        total_output_tokens: output,
        context_window_size: windowSize,
        used_percentage: used,
        remaining_percentage: Math.max(0, 100 - used),
        current_usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead }
      },
      cost: typeof payload.total_cost_usd === 'number' ? { total_cost_usd: payload.total_cost_usd } : undefined,
      version: payload.version || existing?.version || null,
      session_kind: payload.session_kind || 'headless',
      estimated: true,
      capturedAt: new Date().toISOString()
    };
    if (!existing || existing.estimated || !existing.capturedAt || Date.now() - new Date(existing.capturedAt).getTime() > 30000) {
      statusMetrics[sessionId] = captured;
      saveStatusMetrics();
      broadcast({ type: 'status-metrics', sessionId, metrics: captured });
    }
  }

  function safeBaseUrl() {
    const raw = process.env.ANTHROPIC_BASE_URL || process.env.CLAUDE_CODE_BASE_URL || '';
    if (!raw) return null;
    try {
      const url = new URL(raw);
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch { return String(raw).replace(/([?&#](?:token|key|secret|password)=)[^&#]*/ig, '$1***').slice(0, 500); }
  }

  function environmentSummary(workspacePath) {
    const authTokenEnv = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'].find((key) => Boolean(process.env[key])) || null;
    const settingSources = [];
    const candidates = [
      ['User settings', path.join(os.homedir(), '.claude', 'settings.json')],
      ['Shared project settings', workspacePath ? path.join(workspacePath, '.claude', 'settings.json') : null],
      ['Project local settings', workspacePath ? path.join(workspacePath, '.claude', 'settings.local.json') : null]
    ];
    for (const [label, file] of candidates) if (file && fs.existsSync(file)) settingSources.push(label);
    return { authTokenEnv, anthropicBaseUrl: safeBaseUrl(), settingSources };
  }

  function contextFallback(record) {
    const transcriptPath = record?.filePath || record?.path;
    if (!transcriptPath) return null;
    try {
      const analysis = analyzeTranscriptFile(transcriptPath);
      const usage = analysis.lastUsage || {};
      const current = Number(usage.input || 0) + Number(usage.cacheRead || 0) + Number(usage.cacheWrite || 0);
      const windowSize = Number(process.env.CLAUDE_HARNESS_CONTEXT_WINDOW || 200000);
      const used = windowSize > 0 ? Math.min(100, (current / windowSize) * 100) : 0;
      return {
        session_id: record.claudeSessionId || record.id,
        model: { id: (Object.entries(analysis.models || {}).sort((a, b) => b[1] - a[1])[0]?.[0]) || usage.model || null, display_name: (Object.entries(analysis.models || {}).sort((a, b) => b[1] - a[1])[0]?.[0]) || usage.model || 'Unknown model' },
        workspace: { current_dir: record.projectPath, project_dir: record.projectPath, added_dirs: [] },
        context_window: {
          total_input_tokens: analysis.input + analysis.cacheRead + analysis.cacheWrite,
          total_output_tokens: analysis.output,
          context_window_size: windowSize,
          used_percentage: used,
          remaining_percentage: Math.max(0, 100 - used),
          current_usage: {
            input_tokens: Number(usage.input || 0),
            output_tokens: Number(usage.output || 0),
            cache_creation_input_tokens: Number(usage.cacheWrite || 0),
            cache_read_input_tokens: Number(usage.cacheRead || 0)
          }
        },
        transcript: analysis,
        estimated: true,
        capturedAt: new Date().toISOString()
      };
    } catch { return null; }
  }

  function permissionRuleValue(toolName, toolInput = {}) {
    if (toolName === 'Bash' || toolName === 'PowerShell') return typeof toolInput.command === 'string' ? toolInput.command : '';
    if (toolName === 'WebFetch') return typeof toolInput.url === 'string' ? toolInput.url : '';
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') {
      return typeof toolInput.file_path === 'string' ? toolInput.file_path : (typeof toolInput.notebook_path === 'string' ? toolInput.notebook_path : '');
    }
    return typeof toolInput.description === 'string' ? toolInput.description : '';
  }

  function wildcardMatches(value, pattern) {
    const source = String(pattern || '');
    if (!source) return true;
    const escaped = source.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    try { return new RegExp(`^${escaped}$`).test(String(value || '')); }
    catch { return String(value || '') === source; }
  }

  function matchingHarnessAllowRule(input) {
    const toolName = String(input?.tool_name || '');
    const cwd = input?.cwd ? path.resolve(String(input.cwd)) : '';
    const value = permissionRuleValue(toolName, input?.tool_input || {});
    return permissionRules.find((rule) => {
      if (!rule || rule.behavior !== 'allow' || rule.toolName !== toolName) return false;
      if (rule.cwd && cwd && path.resolve(String(rule.cwd)) !== cwd) return false;
      if (rule.cwd && !cwd) return false;
      return wildcardMatches(value, rule.ruleContent || '');
    }) || null;
  }

  function suggestedPermissionRule(input) {
    const suggestions = Array.isArray(input?.permission_suggestions) ? input.permission_suggestions : [];
    for (const suggestion of suggestions) {
      if (suggestion?.type !== 'addRules' || !Array.isArray(suggestion.rules)) continue;
      const matching = suggestion.rules.find((rule) => rule?.toolName === input?.tool_name && typeof rule?.ruleContent === 'string');
      if (matching?.ruleContent) return matching.ruleContent;
    }
    return permissionRuleValue(input?.tool_name, input?.tool_input || {});
  }

  function addHarnessAllowRule(input, ruleContent) {
    const toolName = String(input?.tool_name || '').trim();
    if (!toolName || toolName === 'AskUserQuestion') return;
    const cwd = input?.cwd ? path.resolve(String(input.cwd)) : '';
    const normalizedRule = typeof ruleContent === 'string' ? ruleContent.trim().slice(0, 8000) : suggestedPermissionRule(input).slice(0, 8000);
    const duplicate = permissionRules.some((rule) => rule?.behavior === 'allow' && rule?.toolName === toolName && String(rule?.cwd || '') === cwd && String(rule?.ruleContent || '') === normalizedRule);
    if (!duplicate) {
      permissionRules.push({ behavior: 'allow', toolName, ruleContent: normalizedRule, cwd, createdAt: new Date().toISOString() });
      permissionRules = permissionRules.slice(-500);
      savePermissionRules();
    }
  }

  function applySessionNames() {
    for (const workspace of workspaceCache) {
      for (const session of workspace.sessions) {
        const override = sessionNames[session.claudeSessionId] || sessionNames[session.id];
        if (typeof override === 'string' && override.trim()) session.name = override.trim();
      }
    }
  }


  function runtimeDisplayName(state) {
    const override = sessionNames[state.claudeSessionId] || sessionNames[state.sessionId];
    if (typeof override === 'string' && override.trim()) return override.trim();
    const prompt = state.active?.text || state.queue?.[0]?.text || '';
    const line = String(prompt).replace(/\s+/g, ' ').trim();
    if (line) return line.length > 58 ? `${line.slice(0, 55)}…` : line;
    return 'New session';
  }

  function publicWorkspaces() {
    const copies = workspaceCache.map((workspace) => ({ ...workspace, sessions: workspace.sessions.map((session) => ({ ...session })) }));
    const byId = new Map(copies.map((workspace) => [workspace.id, workspace]));
    const byPath = new Map(copies.map((workspace) => [path.resolve(workspace.path), workspace]));

    for (const state of runtimeStore.sessions.values()) {
      if (scanner.findByClaudeSessionId(state.claudeSessionId)) continue;
      if (!state.workspacePath) continue;
      if (!workspaceAllowedBySettings(state.workspacePath)) continue;
      if (!state.active && !(state.queue || []).length && !(state.sideQuestions || []).length) continue;
      let workspace = (state.workspaceId && byId.get(state.workspaceId)) || byPath.get(path.resolve(state.workspacePath));
      if (!workspace) {
        workspace = {
          id: state.workspaceId || crypto.createHash('sha1').update(path.resolve(state.workspacePath)).digest('hex').slice(0, 20),
          name: path.basename(state.workspacePath) || state.workspacePath,
          path: path.resolve(state.workspacePath),
          sessionCount: 0,
          lastActivity: state.updatedAt || state.createdAt || null,
          sessions: []
        };
        copies.push(workspace);
        byId.set(workspace.id, workspace);
        byPath.set(path.resolve(workspace.path), workspace);
      }
      workspace.sessions.push({
        id: `runtime:${state.key}`,
        name: runtimeDisplayName(state),
        path: '',
        claudeSessionId: state.claudeSessionId,
        projectPath: state.workspacePath,
        projectName: path.basename(state.workspacePath) || state.workspacePath,
        created: state.createdAt || state.updatedAt || null,
        updated: state.updatedAt || state.createdAt || null,
        messageCount: 0,
        runtimeOnly: true
      });
    }

    for (const workspace of copies) {
      workspace.sessions.sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')));
      workspace.sessionCount = workspace.sessions.length;
      workspace.lastActivity = workspace.sessions[0]?.updated || workspace.sessions[0]?.created || workspace.lastActivity || null;
    }
    copies.sort((a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')) || a.path.localeCompare(b.path));
    return copies;
  }


  function publicApproval(request) {
    const found = request.sessionId ? findSessionByClaudeId(request.sessionId) : null;
    const runtime = request.sessionId ? runtimeStore.get(request.sessionId) : null;
    const displayName = found?.session?.name
      || (request.sessionId && sessionNames[request.sessionId])
      || (runtime?.sessionId && sessionNames[runtime.sessionId])
      || 'Claude session';
    return {
      id: request.id,
      kind: request.kind,
      sessionId: request.sessionId || null,
      scannerSessionId: found?.session?.id || runtime?.sessionId || null,
      sessionName: displayName,
      workspaceId: found?.workspace?.id || runtime?.workspaceId || null,
      workspaceName: found?.workspace?.name || (runtime?.workspacePath ? path.basename(runtime.workspacePath) : null),
      cwd: request.cwd || runtime?.workspacePath || null,
      permissionMode: request.permissionMode || null,
      toolName: request.toolName || 'Tool',
      toolInput: request.toolInput || {},
      questions: request.questions || [],
      permissionSuggestions: request.permissionSuggestions || [],
      createdAt: request.createdAt
    };
  }

  function waitForHumanDecision(input, kind) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const request = {
      id,
      kind,
      sessionId: input?.session_id || null,
      cwd: input?.cwd || null,
      permissionMode: input?.permission_mode || null,
      toolName: input?.tool_name || (kind === 'question' ? 'AskUserQuestion' : 'Tool'),
      toolInput: input?.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {},
      questions: Array.isArray(input?.tool_input?.questions) ? input.tool_input.questions : [],
      permissionSuggestions: Array.isArray(input?.permission_suggestions) ? input.permission_suggestions : [],
      createdAt,
      input
    };

    return new Promise((resolve) => {
      let settled = false;
      const runtime = input?.session_id ? runtimeStore.get(input.session_id) : null;
      const finish = (decision) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        approvalRequests.delete(id);
        if (runtime?.active) runtimeStore.running(runtime);
        broadcast({ type: 'approvals', approvals: [...approvalRequests.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(publicApproval) });
        if (runtime) broadcast({ type: 'runtime', state: runtimeStore.publicState(runtime) });
        resolve(decision || { action: 'deny', message: 'No approval response was provided.' });
      };
      request.resolve = finish;
      approvalRequests.set(id, request);
      if (runtime) runtimeStore.waitingApproval(runtime);
      broadcast({ type: 'approvals', approvals: [...approvalRequests.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(publicApproval) });
      if (runtime) broadcast({ type: 'runtime', state: runtimeStore.publicState(runtime) });
      const timer = setTimeout(() => finish({ action: 'deny', message: 'Approval request timed out in Claude Harness.' }), 55 * 60 * 1000);
    });
  }

  function verifyHookRequest(req, res) {
    if (req.get('X-Claude-Harness-Token') !== hookToken) {
      res.status(403).json({ error: 'Invalid Claude Harness hook token.' });
      return false;
    }
    return true;
  }

  function preToolDecision(input, decision) {
    const toolInput = input?.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    if (decision?.action === 'allow' || decision?.action === 'always_allow') {
      let updatedInput = toolInput;
      if (input?.tool_name === 'AskUserQuestion') {
        updatedInput = {
          ...toolInput,
          questions: Array.isArray(toolInput.questions) ? toolInput.questions : [],
          answers: decision.answers && typeof decision.answers === 'object' ? decision.answers : {}
        };
        if (decision.response) updatedInput.response = String(decision.response);
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Approved in Claude Harness',
          updatedInput
        }
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision?.message || 'The user denied this action in Claude Harness.'
      }
    };
  }

  function permissionRequestDecision(input, decision) {
    if (decision?.action === 'allow' || decision?.action === 'always_allow') {
      const output = {
        behavior: 'allow',
        updatedInput: input?.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}
      };
      if (decision?.action === 'always_allow') {
        const destination = (Array.isArray(input?.permission_suggestions) && input.permission_suggestions.find((entry) => entry?.destination)?.destination) || 'localSettings';
        const ruleContent = typeof decision.permissionRule === 'string' ? decision.permissionRule.trim() : suggestedPermissionRule(input);
        const rule = { toolName: input?.tool_name || 'Tool' };
        if (ruleContent) rule.ruleContent = ruleContent;
        output.updatedPermissions = [{ type: 'addRules', rules: [rule], behavior: 'allow', destination }];
      }
      return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: output } };
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: decision?.message || 'The user denied this permission in Claude Harness.' }
      }
    };
  }

  function handleApprovalResponse(approvalId, payload = {}) {
    const request = approvalRequests.get(String(approvalId || ''));
    if (!request) throw new Error('This approval request is no longer pending.');
    const requestedAction = String(payload?.action || 'deny');
    const action = requestedAction === 'allow' || requestedAction === 'always_allow' ? requestedAction : 'deny';
    const answers = payload?.answers && typeof payload.answers === 'object' ? payload.answers : {};
    const response = typeof payload?.response === 'string' ? payload.response.slice(0, 10000) : '';
    const permissionRule = typeof payload?.permissionRule === 'string' ? payload.permissionRule.trim().slice(0, 8000) : '';
    if (action === 'always_allow') addHarnessAllowRule(request.input || {}, permissionRule || suggestedPermissionRule(request.input || {}));
    request.resolve({
      action,
      answers,
      response,
      permissionRule,
      message: typeof payload?.message === 'string' ? payload.message.slice(0, 1000) : undefined
    });
    return { ok: true };
  }

  async function rescan() {
    workspaceCache = await scanner.findClaudeWorkspaces({ root: args.root, locations: harnessSettings.scanLocations });
    applySessionNames();
    fileIndexCache.clear();
    overallStatsCache = { at: 0, data: null };
    scanMeta = { root: args.root, scannedAt: new Date().toISOString(), scanLocations: publicHarnessSettings().scanLocations };

    for (const state of runtimeStore.sessions.values()) {
      const record = scanner.findByClaudeSessionId(state.claudeSessionId);
      if (!record) continue;
      const workspace = findWorkspaceForSession(record.id);
      let changed = false;
      if (state.sessionId !== record.id) { state.sessionId = record.id; changed = true; }
      if (state.workspacePath !== record.projectPath) { state.workspacePath = record.projectPath; changed = true; }
      if (workspace?.id && state.workspaceId !== workspace.id) { state.workspaceId = workspace.id; changed = true; }
      if (changed) runtimeStore.touch(state);
    }

    broadcast({ type: 'workspaces', workspaces: publicWorkspaces(), meta: scanMeta });
    return workspaceCache;
  }

  function findWorkspace(workspaceId) {
    return workspaceCache.find((workspace) => workspace.id === workspaceId) || null;
  }

  function findWorkspaceByPath(workspacePath) {
    if (!workspacePath) return null;
    const resolved = path.resolve(String(workspacePath));
    return workspaceCache.find((workspace) => path.resolve(workspace.path) === resolved) || null;
  }

  function expandUserPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return args.root;
    if (raw === '~') return os.homedir();
    if (raw.startsWith(`~${path.sep}`) || raw.startsWith('~/') || raw.startsWith('~\\')) {
      return path.join(os.homedir(), raw.slice(2));
    }
    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(args.root, raw);
  }

  function readableDirectory(value) {
    try { return fs.statSync(value).isDirectory(); } catch { return false; }
  }

  function getProjectFileIndex(workspacePath) {
    const resolved = path.resolve(String(workspacePath || ''));
    if (!readableDirectory(resolved)) throw new Error(`Workspace folder is not readable: ${resolved}`);

    const cached = fileIndexCache.get(resolved);
    const now = Date.now();
    if (cached && (now - cached.createdAt) < FILE_INDEX_TTL_MS) return cached.index;

    const index = listProjectFiles(resolved);
    fileIndexCache.set(resolved, { createdAt: now, index });
    return index;
  }

  function directorySuggestions(input) {
    const raw = typeof input === 'string' ? input.slice(0, 4096) : '';
    const expanded = expandUserPath(raw);
    const exactDirectory = readableDirectory(expanded);
    const baseDir = exactDirectory ? expanded : path.dirname(expanded);
    const prefix = exactDirectory ? '' : path.basename(expanded).toLowerCase();

    let entries = [];
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !SKIP_DIRS.has(entry.name))
        .filter((entry) => !entry.name.startsWith('.'))
        .filter((entry) => !prefix || entry.name.toLowerCase().startsWith(prefix))
        .slice(0, 80)
        .map((entry) => {
          const fullPath = path.join(baseDir, entry.name);
          const workspace = findWorkspaceByPath(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            isWorkspace: Boolean(workspace),
            workspaceId: workspace?.id || null,
            sessionCount: workspace?.sessionCount || 0,
            lastActivity: workspace?.lastActivity || null
          };
        });
    } catch {
      entries = [];
    }

    entries.sort((a, b) => {
      if (a.isWorkspace !== b.isWorkspace) return a.isWorkspace ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const currentWorkspace = exactDirectory ? findWorkspaceByPath(expanded) : null;
    return {
      input: raw,
      separator: path.sep,
      basePath: baseDir,
      current: exactDirectory ? {
        name: path.basename(expanded) || expanded,
        path: expanded,
        isWorkspace: Boolean(currentWorkspace),
        workspaceId: currentWorkspace?.id || null,
        sessionCount: currentWorkspace?.sessionCount || 0,
        lastActivity: currentWorkspace?.lastActivity || null
      } : null,
      entries
    };
  }

  function findWorkspaceForSession(sessionId) {
    for (const workspace of workspaceCache) {
      if (workspace.sessions.some((session) => session.id === sessionId)) return workspace;
    }
    return null;
  }

  function findSessionByClaudeId(claudeSessionId) {
    for (const workspace of workspaceCache) {
      const session = workspace.sessions.find((item) => item.claudeSessionId === claudeSessionId);
      if (session) return { workspace, session };
    }
    return null;
  }

  function findTranscriptFileBySessionId(claudeSessionId) {
    const target = `${String(claudeSessionId || '').trim()}.jsonl`;
    if (target === '.jsonl') return null;
    const roots = [path.join(os.homedir(), '.claude', 'projects')];
    if (args.root && path.resolve(args.root) !== path.resolve(os.homedir())) roots.push(path.join(args.root, '.claude', 'projects'));
    const seen = new Set();
    for (const root of roots) {
      const resolvedRoot = path.resolve(root);
      if (seen.has(resolvedRoot)) continue;
      seen.add(resolvedRoot);
      const stack = [resolvedRoot];
      while (stack.length) {
        const current = stack.pop();
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isFile() && entry.name === target) return full;
          if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(full);
        }
      }
    }
    return null;
  }

  function forkSessionTranscript(record, throughTimestamp = null) {
    const sourceText = fs.readFileSync(record.filePath, 'utf8');
    const oldSessionId = record.claudeSessionId;
    const newSessionId = crypto.randomUUID();
    const output = [];
    const cutoff = throughTimestamp ? new Date(throughTimestamp).getTime() : NaN;
    const hasCutoff = Number.isFinite(cutoff);

    for (const line of sourceText.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch {
        if (!hasCutoff) output.push(line);
        continue;
      }

      if (hasCutoff) {
        const rawTs = obj.timestamp ?? obj.created_at ?? obj.message?.timestamp ?? obj.message?.created_at;
        const lineTime = rawTs == null ? NaN : new Date(rawTs).getTime();
        if (Number.isFinite(lineTime) && lineTime > cutoff) break;
      }

      const replaceId = (target) => {
        if (!target || typeof target !== 'object') return;
        if (typeof target.sessionId === 'string' && (!oldSessionId || target.sessionId === oldSessionId)) target.sessionId = newSessionId;
        if (target.session_id === oldSessionId) target.session_id = newSessionId;
      };
      replaceId(obj);
      replaceId(obj.message);
      output.push(JSON.stringify(obj));
    }
    if (!output.length) throw new Error('No transcript messages were available at the selected point.');
    const destination = path.join(path.dirname(record.filePath), `${newSessionId}.jsonl`);
    fs.writeFileSync(destination, `${output.join('\n')}\n`, 'utf8');
    return { newSessionId, destination };
  }

  function transcriptContentText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        if (item.type === 'tool_result') return '';
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        return '';
      }).filter(Boolean).join('\n');
    }
    if (typeof value === 'object') {
      if (typeof value.text === 'string') return value.text;
      if (typeof value.content === 'string') return value.content;
    }
    return '';
  }

  function transcriptTimestamp(obj) {
    const wrapped = obj?.message && typeof obj.message === 'object' ? obj.message : obj;
    const raw = obj?.timestamp ?? obj?.created_at ?? wrapped?.timestamp ?? wrapped?.created_at ?? null;
    if (raw == null || raw === '') return null;
    const date = typeof raw === 'number' ? new Date(raw < 1e12 ? raw * 1000 : raw) : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function transcriptUserPrompt(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const wrapped = obj.message && typeof obj.message === 'object' ? obj.message : obj;
    if ((wrapped.role || obj.role) !== 'user') return null;
    const content = wrapped.content ?? obj.content ?? '';
    if (Array.isArray(content)) {
      const meaningfulBlocks = content.filter((block) => {
        if (typeof block === 'string') return Boolean(block.trim());
        if (!block || typeof block !== 'object') return false;
        return block.type !== 'tool_result';
      });
      if (!meaningfulBlocks.length) return null;
    }
    let text = transcriptContentText(content).trim();
    if (!text) return null;
    const command = text.match(/<command-name>([\s\S]*?)<\/command-name>/i)?.[1]?.trim();
    const commandArgs = text.match(/<command-args>([\s\S]*?)<\/command-args>/i)?.[1]?.trim();
    if (command) text = `${command}${commandArgs ? ` ${commandArgs}` : ''}`.trim();
    if (/^<local-command-caveat>/i.test(text) && !command) return null;
    const checkpointId = [obj.uuid, wrapped.uuid, obj.message_id, wrapped.message_id]
      .find((value) => typeof value === 'string' && value.trim()) || null;
    return { text, checkpointId, timestamp: transcriptTimestamp(obj) };
  }

  function lineCount(value) {
    const text = String(value ?? '');
    if (!text) return 0;
    return text.split(/\r?\n/).length;
  }

  function toolEditDelta(block, projectPath) {
    if (!block || block.type !== 'tool_use') return null;
    const name = String(block.name || '');
    if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return null;
    const input = block.input && typeof block.input === 'object' ? block.input : {};
    const rawPath = input.file_path || input.path || input.notebook_path || input.notebookPath || null;
    if (!rawPath || typeof rawPath !== 'string') return null;
    const absolutePath = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(projectPath || os.homedir(), rawPath);
    let additions = 0;
    let deletions = 0;
    if (name === 'Write') additions = lineCount(input.content);
    else if (name === 'Edit') {
      additions = lineCount(input.new_string ?? input.newString);
      deletions = lineCount(input.old_string ?? input.oldString);
    } else if (name === 'MultiEdit') {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      for (const edit of edits) {
        additions += lineCount(edit?.new_string ?? edit?.newString);
        deletions += lineCount(edit?.old_string ?? edit?.oldString);
      }
    } else {
      additions = lineCount(input.new_source ?? input.newSource ?? input.source);
      deletions = lineCount(input.old_source ?? input.oldSource);
    }
    let displayPath = absolutePath;
    if (projectPath) {
      const relative = path.relative(projectPath, absolutePath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) displayPath = relative;
      else if (!relative) displayPath = path.basename(absolutePath);
    }
    return { path: absolutePath, displayPath, additions, deletions, tool: name };
  }

  function listRewindPoints(record) {
    const sourceText = fs.readFileSync(record.filePath, 'utf8');
    const lines = sourceText.split(/\r?\n/);
    const points = [];
    let current = null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      const prompt = transcriptUserPrompt(obj);
      if (prompt) {
        current = {
          id: prompt.checkpointId || `line:${lineIndex}`,
          checkpointId: prompt.checkpointId,
          lineIndex,
          prompt: prompt.text,
          timestamp: prompt.timestamp,
          changes: []
        };
        points.push(current);
        continue;
      }

      if (!current) continue;
      const wrapped = obj.message && typeof obj.message === 'object' ? obj.message : obj;
      if ((wrapped.role || obj.role) !== 'assistant') continue;
      const content = wrapped.content ?? obj.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const delta = toolEditDelta(block, record.projectPath);
        if (!delta) continue;
        const existing = current.changes.find((item) => item.path === delta.path);
        if (existing) {
          existing.additions += delta.additions;
          existing.deletions += delta.deletions;
        } else current.changes.push(delta);
      }
    }

    const cumulative = new Map();
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index];
      point.changedFiles = point.changes.length;
      point.additions = point.changes.reduce((sum, item) => sum + item.additions, 0);
      point.deletions = point.changes.reduce((sum, item) => sum + item.deletions, 0);
      for (const change of point.changes) {
        const existing = cumulative.get(change.path);
        if (existing) {
          existing.additions += change.additions;
          existing.deletions += change.deletions;
        } else cumulative.set(change.path, { ...change });
      }
      point.restoreChanges = [...cumulative.values()].map((item) => ({ ...item }));
      point.restoreChangedFiles = point.restoreChanges.length;
      point.restoreAdditions = point.restoreChanges.reduce((sum, item) => sum + item.additions, 0);
      point.restoreDeletions = point.restoreChanges.reduce((sum, item) => sum + item.deletions, 0);
      point.canRestoreCode = Boolean(point.checkpointId && point.restoreChangedFiles > 0);
    }
    return points;
  }

  function forkSessionBeforeLine(record, lineIndex) {
    const sourceText = fs.readFileSync(record.filePath, 'utf8');
    const oldSessionId = record.claudeSessionId;
    const newSessionId = crypto.randomUUID();
    const output = [];
    const sourceLines = sourceText.split(/\r?\n/);
    const cutoff = Math.max(0, Math.min(sourceLines.length, Number(lineIndex) || 0));

    for (let index = 0; index < cutoff; index += 1) {
      const line = sourceLines[index];
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { output.push(line); continue; }
      const replaceId = (target) => {
        if (!target || typeof target !== 'object') return;
        if (typeof target.sessionId === 'string' && (!oldSessionId || target.sessionId === oldSessionId)) target.sessionId = newSessionId;
        if (typeof target.session_id === 'string' && (!oldSessionId || target.session_id === oldSessionId)) target.session_id = newSessionId;
      };
      replaceId(obj);
      replaceId(obj.message);
      output.push(JSON.stringify(obj));
    }

    const destination = path.join(path.dirname(record.filePath), `${newSessionId}.jsonl`);
    if (!output.length) return { newSessionId, destination: null, empty: true };
    fs.writeFileSync(destination, `${output.join('\n')}\n`, 'utf8');
    return { newSessionId, destination, empty: false };
  }

  async function rewindFilesForPoint(record, point) {
    if (!point?.checkpointId) throw new Error('This turn does not contain a Claude checkpoint ID, so code cannot be restored from it.');
    const args = ['-p', '--resume', record.claudeSessionId, '--rewind-files', point.checkpointId];
    await runClaudeCli(args, record.projectPath, {
      timeout: 120000,
      env: { CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: 'true' }
    });
  }

  function transcriptSliceAsText(record, startLine, endLine = Number.POSITIVE_INFINITY) {
    const sourceLines = fs.readFileSync(record.filePath, 'utf8').split(/\r?\n/);
    const out = [];
    const start = Math.max(0, Number(startLine) || 0);
    const end = Number.isFinite(endLine) ? Math.min(sourceLines.length, Number(endLine)) : sourceLines.length;
    for (let index = start; index < end; index += 1) {
      const line = sourceLines[index];
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const wrapped = obj.message && typeof obj.message === 'object' ? obj.message : obj;
      const role = wrapped.role || obj.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const content = wrapped.content ?? obj.content;
      if (Array.isArray(content) && content.every((block) => block && typeof block === 'object' && block.type === 'tool_result')) continue;
      const text = transcriptContentText(content).trim();
      if (!text || /^<local-command-caveat>/i.test(text)) continue;
      out.push(`${role === 'user' ? 'User' : 'Claude'}: ${text}`);
    }
    return out.join('\n\n').slice(0, 300000);
  }

  async function generateTargetedSummary(record, text, scopeLabel) {
    if (!text.trim()) return 'No substantive conversation content was present in the selected range.';
    const prompt = [
      'Create a compact Claude Code conversation summary for checkpoint recovery.',
      `Scope: ${scopeLabel}.`,
      'Preserve requirements, decisions, unresolved tasks, file names, code behavior, commands/tests, and important errors.',
      'Do not add advice or commentary. Return only the summary in Markdown.',
      '',
      text
    ].join('\n');
    const result = await runClaudeCode({
      cwd: record.projectPath,
      prompt,
      permissionMode: 'bypassPermissions',
      model: 'default',
      tools: '',
      disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Task', 'Agent']
    });
    const raw = String(result?.result || result?.stdout || result?.text || '').trim();
    return raw || 'Conversation range summarized.';
  }

  async function seedSummarySession(record, summary, tailText = '') {
    const newSessionId = crypto.randomUUID();
    const prompt = [
      '<claude-harness-rewind-summary>',
      summary,
      '</claude-harness-rewind-summary>',
      tailText ? '\n<claude-harness-preserved-later-conversation>\n' + tailText + '\n</claude-harness-preserved-later-conversation>' : '',
      '',
      'This is recovered conversation context. Do not perform any task. Reply exactly: Context restored.'
    ].filter(Boolean).join('\n');
    await runClaudeCode({
      cwd: record.projectPath,
      prompt,
      sessionId: newSessionId,
      permissionMode: 'bypassPermissions',
      model: 'default',
      tools: '',
      disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Task', 'Agent']
    });
    return newSessionId;
  }

  function validatePrompt(value) {
    if (typeof value !== 'string') throw new Error('Prompt is required.');
    const prompt = value.trim();
    if (!prompt) throw new Error('Prompt cannot be empty.');
    if (Buffer.byteLength(prompt, 'utf8') > 256 * 1024) throw new Error('Prompt is too large.');
    return prompt;
  }

  function runtimeForSessionRef(ref) {
    const existing = runtimeStore.get(ref);
    if (existing) return existing;
    const record = scanner.getSessionRecord(ref) || scanner.findByClaudeSessionId(ref);
    if (!record) return null;
    const workspace = findWorkspaceForSession(record.id);
    return runtimeStore.ensure({
      key: record.claudeSessionId,
      claudeSessionId: record.claudeSessionId,
      sessionId: record.id,
      workspaceId: workspace?.id || null,
      workspacePath: record.projectPath || workspace?.path || args.root
    });
  }

  function runtimeSnapshot() {
    return runtimeStore.list();
  }

  function broadcastRuntime(state) {
    broadcast({ type: 'runtime', state: runtimeStore.publicState(state) });
  }

  async function processRuntimeQueue(state) {
    if (!state || runtimeWorkers.has(state.key)) return;
    runtimeWorkers.set(state.key, true);
    try {
      while (true) {
        const item = runtimeStore.nextRunnable(state);
        if (!item) {
          if (!state.active && state.status !== 'error') {
            state.status = 'idle';
            runtimeStore.touch(state);
            broadcastRuntime(state);
          }
          break;
        }

        runtimeStore.begin(state, item);
        activeRuns.add(state.key);
        broadcastRuntime(state);

        let cwd = state.workspacePath || args.root;
        try { if (!fs.statSync(cwd).isDirectory()) cwd = args.root; } catch { cwd = args.root; }
        const opts = item.runtimeOptions || {};
        try {
          const record = (state.sessionId ? scanner.getSessionRecord(state.sessionId) : null) || scanner.findByClaudeSessionId(state.claudeSessionId);
          const resumeId = record?.claudeSessionId || (state.sessionId ? state.claudeSessionId : null);
          const result = await runClaudeCode({
            cwd,
            prompt: item.text,
            resumeId: record ? resumeId : null,
            sessionId: record ? null : state.claudeSessionId,
            permissionMode: opts.permissionMode || 'acceptEdits',
            model: opts.model || 'default',
            additionalDirs: Array.isArray(opts.additionalDirs) ? opts.additionalDirs : [],
            harnessPort: args.port,
            hookToken,
            onSpawn: (child) => activeProcesses.set(state.key, child)
          });
          if (cancelledRuns.has(state.key)) {
            cancelledRuns.delete(state.key);
            runtimeStore.cancel(state);
            broadcastRuntime(state);
            break;
          }
          if (result.sessionId) state.claudeSessionId = result.sessionId;
          capturePayloadMetrics(result.payload, state.claudeSessionId, cwd);
          await rescan();
          const refreshed = scanner.findByClaudeSessionId(state.claudeSessionId);
          if (refreshed) {
            state.sessionId = refreshed.id;
            state.workspacePath = refreshed.projectPath || state.workspacePath;
            state.workspaceId = findWorkspaceForSession(refreshed.id)?.id || state.workspaceId;
          }
          runtimeStore.complete(state);
          broadcastRuntime(state);
          broadcast({ type: 'session-updated', runtimeKey: state.key, claudeSessionId: state.claudeSessionId, sessionId: state.sessionId, workspaceId: state.workspaceId });
        } catch (error) {
          log.error('Claude task failed', { error, sessionKey: state.key, workspacePath: state.workspacePath });
          try { await rescan(); } catch (scanError) { log.warn('Rescan after Claude task failure also failed', { error: scanError }); }
          if (cancelledRuns.has(state.key)) {
            cancelledRuns.delete(state.key);
            runtimeStore.cancel(state);
          } else {
            runtimeStore.fail(state, error);
          }
          broadcastRuntime(state);
          break;
        } finally {
          activeProcesses.delete(state.key);
          activeRuns.delete(state.key);
        }
      }
    } finally {
      runtimeWorkers.delete(state.key);
    }
  }

  function terminateChild(child) {
    if (!child || child.killed) return false;
    try {
      child.kill('SIGTERM');
      const forceTimer = setTimeout(() => {
        try { if (!child.killed) child.kill('SIGKILL'); } catch { /* already exited */ }
      }, 1800);
      forceTimer.unref?.();
      return true;
    } catch {
      return false;
    }
  }

  function stopRuntime(ref) {
    const state = runtimeForSessionRef(ref);
    if (!state) throw new Error('Session not found.');
    const child = activeProcesses.get(state.key);
    if (!state.active && !child) return { state, stopped: false };
    // A stopped run must not leave a stale permission card waiting in another
    // browser. Deny any outstanding hook decisions before marking the process
    // as stopping; the hook's normal cleanup removes the global approval UI.
    for (const request of [...approvalRequests.values()]) {
      if (request.sessionId === state.claudeSessionId && typeof request.resolve === 'function') {
        request.resolve({ action: 'deny', message: 'The Claude task was stopped from Claude Harness.' });
      }
    }
    cancelledRuns.add(state.key);
    runtimeStore.requestStop(state);
    broadcastRuntime(state);
    const stopped = terminateChild(child);
    if (!child) {
      cancelledRuns.delete(state.key);
      runtimeStore.cancel(state);
      broadcastRuntime(state);
    }
    return { state, stopped: stopped || Boolean(state.active) };
  }

  async function processBtwQuestion(state, item, runtimeOptions = {}) {
    if (!state || !item || btwWorkers.has(state.key)) return;
    btwWorkers.add(state.key);
    try {
      runtimeStore.updateSideQuestion(state, item.id, { status: 'running', error: null });
      broadcastRuntime(state);
      let cwd = state.workspacePath || args.root;
      try { if (!fs.statSync(cwd).isDirectory()) cwd = args.root; } catch { cwd = args.root; }
      const record = (state.sessionId ? scanner.getSessionRecord(state.sessionId) : null) || scanner.findByClaudeSessionId(state.claudeSessionId);
      const resumeId = record?.claudeSessionId || state.claudeSessionId;
      const sourceTranscript = record?.filePath || findTranscriptFileBySessionId(resumeId);
      // A BTW question must not append to the main transcript. Resume the
      // current context into a disposable fork, disable both built-in and MCP
      // tools, ask the side question there, then remove that fork transcript.
      // Keep the recent side-question thread available without polluting the
      // primary Claude transcript.
      const priorSideThread = (state.sideQuestions || [])
        .filter((entry) => entry.id !== item.id && entry.status === 'done' && entry.answer)
        .slice(-20)
        .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
        .join('\n\n');
      const sidePrompt = priorSideThread
        ? `This is a side question about the resumed session. Do not use tools. Answer briefly from the existing conversation context.\n\nRecent side-question thread:\n${priorSideThread}\n\nCurrent question: ${item.question}`
        : `This is a side question about the resumed session. Do not use tools. Answer briefly from the existing conversation context.\n\nQuestion: ${item.question}`;
      const result = await runClaudeCode({
        cwd,
        prompt: sidePrompt,
        resumeId,
        forkSession: true,
        tools: '',
        disallowedTools: ['mcp__*'],
        permissionMode: 'dontAsk',
        model: runtimeOptions.model || state.active?.runtimeOptions?.model || 'default',
        additionalDirs: [],
        harnessPort: null,
        hookToken: null
      });
      if (result.sessionId && result.sessionId !== resumeId) {
        let disposableTranscript = sourceTranscript
          ? path.join(path.dirname(sourceTranscript), `${result.sessionId}.jsonl`)
          : null;
        if (!disposableTranscript || !fs.existsSync(disposableTranscript)) disposableTranscript = findTranscriptFileBySessionId(result.sessionId);
        try { if (disposableTranscript && fs.existsSync(disposableTranscript)) fs.unlinkSync(disposableTranscript); } catch { /* best-effort cleanup */ }
      }
      runtimeStore.updateSideQuestion(state, item.id, { status: 'done', answer: String(result.result || '').trim(), error: null });
      broadcastRuntime(state);
    } catch (error) {
      log.warn('BTW side question failed', { error, sessionKey: state.key });
      runtimeStore.updateSideQuestion(state, item.id, { status: 'error', error: error?.message || String(error), answer: '' });
      broadcastRuntime(state);
    } finally {
      btwWorkers.delete(state.key);
      const next = (state.sideQuestions || []).find((entry) => entry.status === 'queued');
      if (next) setImmediate(() => processBtwQuestion(state, next, runtimeOptions));
    }
  }

  function askBtw(ref, question, runtimeOptions = {}) {
    const state = runtimeForSessionRef(ref);
    if (!state) throw new Error('Session not found.');
    const text = validatePrompt(question);
    const item = runtimeStore.addSideQuestion(state, text);
    broadcastRuntime(state);
    setImmediate(() => processBtwQuestion(state, item, runtimeOptions));
    return { state, item };
  }

  function enqueueRuntimePrompt(ref, prompt, runtimeOptions) {
    const state = runtimeForSessionRef(ref);
    if (!state) throw new Error('Session not found. Rescan if the transcript moved.');
    const item = runtimeStore.addPrompt(state, prompt, runtimeOptions);
    broadcastRuntime(state);
    // Start an idle session immediately so the API/WebSocket response already
    // reflects `active` + `running`. If Claude is already working, the worker
    // guard leaves this new item in the durable queue.
    void processRuntimeQueue(state);
    return { state, item };
  }

  function createRuntimeSession(workspacePath, workspaceId, claudeSessionId, prompt, runtimeOptions) {
    const state = runtimeStore.ensure({
      key: claudeSessionId,
      claudeSessionId,
      workspaceId: workspaceId || null,
      workspacePath
    });
    const item = runtimeStore.addPrompt(state, prompt, runtimeOptions);
    broadcastRuntime(state);
    broadcast({ type: 'workspaces', workspaces: publicWorkspaces(), meta: scanMeta });
    // The first prompt is not a queued follow-up from the user's perspective.
    // Begin the runtime synchronously (up to runClaudeCode's first await) so
    // the initial response shows the sent user bubble and "Claude is writing".
    void processRuntimeQueue(state);
    return { state, item };
  }

  log.info('Scanning Claude workspaces', { root: args.root, maxDepth: MAX_DEPTH, scanLocations: harnessSettings.scanLocations?.length || 0 });
  await rescan();
  log.info('Workspace scan complete', { workspaces: workspaceCache.length, sessions: workspaceCache.reduce((n, w) => n + w.sessionCount, 0) });

  const app = express();
  const server = http.createServer(app);
  const devMode = isDevelopmentMode();
  const wsClients = new Set();
  const wss = new WebSocketServer({ noServer: true });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const startedAt = Date.now();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === 'object' && typeof body.error === 'string') res.locals.harnessError = body.error;
      return originalJson(body);
    };
    res.on('finish', () => {
      const details = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        ...(res.locals.harnessError ? { errorMessage: res.locals.harnessError } : {})
      };
      if (res.statusCode >= 500) log.error('HTTP request failed', details);
      else if (res.statusCode >= 400) log.warn('HTTP request rejected', details);
      else if (process.env.CH_LOG_HTTP === '1') log.info('HTTP request', details);
    });
    next();
  });
  app.use(express.json({ limit: '16mb' }));

  broadcast = (payload) => {
    const encoded = JSON.stringify(payload);
    for (const client of wsClients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try { client.send(encoded); } catch { /* reconnect will recover state */ }
    }
  };

  const approvalsSnapshot = () => [...approvalRequests.values()]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(publicApproval);

  function sendSocketSnapshot(socket) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'snapshot',
      runtimes: runtimeSnapshot(),
      approvals: approvalsSnapshot(),
      workspaces: publicWorkspaces(),
      meta: scanMeta,
      auth: { enabled: auth.enabled, user: auth.enabled ? auth.user : null }
    }));
  }

  function socketReply(socket, requestId, ok, data = {}) {
    if (!requestId || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'ack', requestId, ok, ...data }));
  }

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { pathname = req.url || ''; }
    if (pathname !== '/ws') return;
    if (!requestAuthenticated(req, auth)) {
      log.warn('Rejected unauthenticated WebSocket upgrade', { remoteAddress: req.socket?.remoteAddress });
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  app.get('/api/auth/status', (req, res) => {
    const authenticated = requestAuthenticated(req, auth);
    return res.json({ enabled: auth.enabled, authenticated, user: auth.enabled && authenticated ? auth.user : null });
  });
  app.post('/api/auth/login', (req, res) => {
    if (!auth.enabled) return res.json({ ok: true, authenticated: true, enabled: false });
    const userOk = timingSafeStringEqual(req.body?.user, auth.user);
    const passwordOk = timingSafeStringEqual(req.body?.password, auth.password);
    if (!userOk || !passwordOk) {
      log.warn('Login rejected', { remoteAddress: req.socket?.remoteAddress });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    log.info('User authenticated', { user: auth.user, remoteAddress: req.socket?.remoteAddress });
    setAuthCookie(res, auth);
    return res.json({ ok: true, authenticated: true, user: auth.user });
  });
  app.post('/api/auth/logout', (_req, res) => {
    clearAuthCookie(res, auth);
    return res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    if (req.path.startsWith('/internal/')) return next();
    if (requestAuthenticated(req, auth)) return next();
    return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
  });

  wss.on('connection', (socket, request) => {
    wsClients.add(socket);
    log.debug('WebSocket client connected', { remoteAddress: request?.socket?.remoteAddress, clients: wsClients.size });
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    sendSocketSnapshot(socket);

    socket.on('message', async (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const requestId = message?.requestId || null;
      try {
        if (message.type === 'ping') { socketReply(socket, requestId, true, { pong: Date.now() }); return; }
        if (message.type === 'snapshot') { sendSocketSnapshot(socket); socketReply(socket, requestId, true); return; }
        if (message.type === 'runtime:stop') {
          const result = stopRuntime(message.sessionRef);
          socketReply(socket, requestId, true, { stopped: result.stopped, state: runtimeStore.publicState(result.state) });
          return;
        }
        if (message.type === 'btw:ask') {
          const state = runtimeForSessionRef(message.sessionRef);
          if (!state) throw new Error('Session not found.');
          const options = validateRuntimeOptions(message.runtimeOptions || {}, state.workspacePath || args.root);
          const result = askBtw(state.key, message.question, options);
          socketReply(socket, requestId, true, { item: result.item, state: runtimeStore.publicState(result.state) });
          return;
        }
        if (message.type === 'queue:add') {
          const prompt = validatePrompt(message.prompt);
          const state = runtimeForSessionRef(message.sessionRef);
          if (!state) throw new Error('Session not found.');
          const options = validateRuntimeOptions(message.runtimeOptions || {}, state.workspacePath || args.root);
          const result = enqueueRuntimePrompt(state.key, prompt, options);
          socketReply(socket, requestId, true, { item: result.item, state: runtimeStore.publicState(result.state) });
          return;
        }
        if (message.type === 'queue:delete' || message.type === 'queue:update' || message.type === 'queue:move') {
          const state = runtimeForSessionRef(message.sessionRef);
          if (!state) throw new Error('Session not found.');
          if (message.type === 'queue:delete' && !runtimeStore.deletePrompt(state, message.itemId)) throw new Error('Queued prompt is no longer available.');
          if (message.type === 'queue:update' && !runtimeStore.updatePrompt(state, message.itemId, { text: message.text, paused: message.paused })) throw new Error('Queued prompt is no longer available.');
          if (message.type === 'queue:move') {
            const exists = state.queue.some((item) => item.id === message.itemId);
            if (!exists) throw new Error('Queued prompt is no longer available.');
            runtimeStore.movePrompt(state, message.itemId, Number(message.targetIndex));
          }
          broadcastRuntime(state);
          setImmediate(() => processRuntimeQueue(state));
          socketReply(socket, requestId, true, { state: runtimeStore.publicState(state) });
          return;
        }
        if (message.type === 'approval:respond') {
          const result = handleApprovalResponse(message.approvalId, message.payload || {});
          socketReply(socket, requestId, true, result);
          return;
        }
        throw new Error(`Unsupported WebSocket message: ${message.type || 'unknown'}`);
      } catch (error) {
        log.warn('WebSocket request failed', { error, type: message?.type || 'unknown' });
        socketReply(socket, requestId, false, { error: error.message || String(error) });
      }
    });

    socket.on('close', () => {
      wsClients.delete(socket);
      log.debug('WebSocket client disconnected', { clients: wsClients.size });
    });
    socket.on('error', (error) => {
      wsClients.delete(socket);
      log.warn('WebSocket client error', { error, clients: wsClients.size });
    });
  });

  const wsHeartbeat = setInterval(() => {
    for (const socket of wsClients) {
      if (socket.isAlive === false) { try { socket.terminate(); } catch {} continue; }
      socket.isAlive = false;
      try { socket.ping(); } catch { /* close handler cleans up */ }
    }
  }, 25000);


  // Human-in-the-loop bridge for Claude Code. Claude Code posts hook events to
  // these loopback-only endpoints and the request remains open while the web UI
  // collects the user's answer/approval.
  app.post('/api/internal/statusline', (req, res) => {
    if (!timingSafeStringEqual(req.get('X-Claude-Harness-Token') || '', hookToken)) return res.status(403).end();
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
    if (!sessionId) return res.status(204).end();
    const captured = { ...payload, capturedAt: new Date().toISOString() };
    statusMetrics[sessionId] = captured;
    saveStatusMetrics();
    broadcast({ type: 'status-metrics', sessionId, metrics: captured });
    return res.status(204).end();
  });

  app.post('/api/internal/hooks/interactive', async (req, res) => {
    if (!verifyHookRequest(req, res)) return;
    const toolName = req.body?.tool_name;
    const kind = toolName === 'AskUserQuestion' ? 'question' : 'permission';
    const decision = await waitForHumanDecision(req.body || {}, kind);
    return res.json(preToolDecision(req.body || {}, decision));
  });

  app.post('/api/internal/hooks/approval', async (req, res) => {
    if (!verifyHookRequest(req, res)) return;
    if (matchingHarnessAllowRule(req.body || {})) {
      return res.json(preToolDecision(req.body || {}, { action: 'allow' }));
    }
    const decision = await waitForHumanDecision(req.body || {}, 'permission');
    return res.json(preToolDecision(req.body || {}, decision));
  });

  app.post('/api/internal/hooks/permission-request', async (req, res) => {
    if (!verifyHookRequest(req, res)) return;
    if (matchingHarnessAllowRule(req.body || {})) {
      return res.json(permissionRequestDecision(req.body || {}, { action: 'allow' }));
    }
    const decision = await waitForHumanDecision(req.body || {}, 'permission');
    return res.json(permissionRequestDecision(req.body || {}, decision));
  });

  app.get('/api/approvals', (_req, res) => {
    const pending = [...approvalRequests.values()]
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(publicApproval);
    return res.json({ approvals: pending });
  });

  app.post('/api/approvals/:id/respond', (req, res) => {
    try { return res.json(handleApprovalResponse(req.params.id, req.body || {})); }
    catch (error) { return res.status(404).json({ error: error.message || 'This approval request is no longer pending.' }); }
  });

  app.get('/api/ui-state', (req, res) => {
    const kind = String(req.query?.kind || '');
    const key = String(req.query?.key || '');
    if (!key || (kind !== 'draft' && kind !== 'note')) return res.status(400).json({ error: 'kind and key are required.' });
    return res.json({ kind, key, ...(uiStateStore.get(kind, key) || { value: '', updatedAt: null }) });
  });

  const saveUiState = (req, res) => {
    try {
      const kind = String(req.body?.kind || '');
      const key = String(req.body?.key || '');
      if (!key || (kind !== 'draft' && kind !== 'note')) return res.status(400).json({ error: 'kind and key are required.' });
      const saved = uiStateStore.set(kind, key, req.body?.value ?? '');
      return res.json({ ok: true, kind, key, ...saved });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to save UI state.' });
    }
  };
  app.put('/api/ui-state', saveUiState);
  app.post('/api/ui-state', saveUiState);

  app.get('/api/workspaces', (_req, res) => res.json(publicWorkspaces()));
  app.get('/api/meta', (_req, res) => res.json(scanMeta));
  app.get('/api/settings', (_req, res) => res.json({ settings: publicHarnessSettings() }));
  app.put('/api/settings', async (req, res) => {
    try {
      harnessSettings = normalizeHarnessSettings(req.body || {}, { strict: true });
      saveHarnessSettings();
      await rescan();
      log.info('Settings saved and workspace discovery rescanned', { scanLocations: harnessSettings.scanLocations.length, workspaces: workspaceCache.length });
      return res.json({ ok: true, settings: publicHarnessSettings(), meta: scanMeta, workspaces: publicWorkspaces() });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to save settings.' });
    }
  });
  app.post('/api/settings/rescan', async (_req, res) => {
    try {
      const startedAt = Date.now();
      await rescan();
      log.info('Workspace discovery rescan requested', { workspaces: workspaceCache.length, sessions: workspaceCache.reduce((count, item) => count + item.sessionCount, 0), durationMs: Date.now() - startedAt });
      return res.json({ ok: true, settings: publicHarnessSettings(), meta: scanMeta, workspaces: publicWorkspaces() });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Rescan failed.' });
    }
  });
  app.get('/api/models', (req, res) => {
    let workspacePath = null;
    if (typeof req.query?.workspacePath === 'string' && req.query.workspacePath.trim()) {
      const candidate = expandUserPath(req.query.workspacePath);
      if (readableDirectory(candidate)) workspacePath = candidate;
    }
    return res.json({ models: collectConfiguredModels(workspacePath) });
  });
  app.get('/api/directories', (req, res) => {
    try {
      return res.json(directorySuggestions(req.query?.input || ''));
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to browse directories.' });
    }
  });

  app.get('/api/files', (req, res) => {
    try {
      if (!req.query?.workspacePath) return res.status(400).json({ error: 'workspacePath is required.' });
      const workspacePath = expandUserPath(req.query.workspacePath || '');
      const rawQuery = String(req.query?.q || '').slice(0, 4096);
      const unescapedQuery = rawQuery.replace(/\\ /g, ' ');
      const pathLikeExternal = unescapedQuery === '~'
        || unescapedQuery.startsWith('~/')
        || unescapedQuery.startsWith('~\\')
        || path.isAbsolute(unescapedQuery)
        || unescapedQuery.startsWith('../')
        || unescapedQuery.startsWith('..\\');

      let indexRoot = workspacePath;
      let searchQuery = rawQuery;
      if (pathLikeExternal) {
        const hadTrailingSeparator = /[\\/]$/.test(unescapedQuery);
        let expandedQuery;
        if (unescapedQuery === '~') expandedQuery = os.homedir();
        else if (unescapedQuery.startsWith('~/') || unescapedQuery.startsWith('~\\')) expandedQuery = path.join(os.homedir(), unescapedQuery.slice(2));
        else if (path.isAbsolute(unescapedQuery)) expandedQuery = path.normalize(unescapedQuery);
        else expandedQuery = path.resolve(workspacePath, unescapedQuery);
        if (hadTrailingSeparator && !expandedQuery.endsWith(path.sep)) expandedQuery += path.sep;

        const candidateDirectory = hadTrailingSeparator ? expandedQuery : path.dirname(expandedQuery);
        indexRoot = path.resolve(candidateDirectory);
        if (!readableDirectory(indexRoot)) {
          return res.json({ workspacePath, browseRoot: indexRoot, files: [], totalIndexed: 0, truncated: false });
        }
        searchQuery = expandedQuery;
      }

      const index = getProjectFileIndex(indexRoot);
      const files = searchProjectFiles(index, searchQuery);
      return res.json({
        workspacePath,
        browseRoot: indexRoot,
        files,
        totalIndexed: (index.entries || index.files || []).length,
        truncated: Boolean(index.truncated)
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to list files.' });
    }
  });

  app.get('/api/runtime', (_req, res) => res.json({ sessions: runtimeSnapshot() }));

  app.get('/api/runtime/:ref', (req, res) => {
    const state = runtimeForSessionRef(req.params.ref);
    if (!state) return res.status(404).json({ error: 'Runtime session not found.' });
    return res.json(runtimeStore.publicState(state));
  });

  app.post('/api/runtime/:ref/stop', (req, res) => {
    try {
      const result = stopRuntime(req.params.ref);
      return res.json({ ok: true, stopped: result.stopped, state: runtimeStore.publicState(result.state) });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to stop Claude.' });
    }
  });

  app.post('/api/runtime/:ref/btw', (req, res) => {
    try {
      const state = runtimeForSessionRef(req.params.ref);
      if (!state) return res.status(404).json({ error: 'Session not found.' });
      const options = validateRuntimeOptions(req.body?.runtimeOptions || req.body || {}, state.workspacePath || args.root);
      const result = askBtw(state.key, req.body?.question, options);
      return res.status(202).json({ ok: true, item: result.item, state: runtimeStore.publicState(result.state) });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to ask side question.' });
    }
  });

  app.post('/api/runtime/:ref/queue', (req, res) => {
    try {
      const prompt = validatePrompt(req.body?.prompt);
      const state = runtimeForSessionRef(req.params.ref);
      if (!state) return res.status(404).json({ error: 'Session not found.' });
      const options = validateRuntimeOptions(req.body?.runtimeOptions || req.body || {}, state.workspacePath || args.root);
      const result = enqueueRuntimePrompt(state.key, prompt, options);
      return res.status(202).json({ ok: true, item: result.item, state: runtimeStore.publicState(result.state) });
    } catch (error) { return res.status(400).json({ error: error.message || 'Unable to queue prompt.' }); }
  });

  app.patch('/api/runtime/:ref/queue/:itemId', (req, res) => {
    const state = runtimeForSessionRef(req.params.ref);
    if (!state) return res.status(404).json({ error: 'Session not found.' });
    const item = runtimeStore.updatePrompt(state, req.params.itemId, { text: req.body?.text, paused: req.body?.paused });
    if (!item) return res.status(404).json({ error: 'Queued prompt not found.' });
    broadcastRuntime(state);
    setImmediate(() => processRuntimeQueue(state));
    return res.json({ ok: true, state: runtimeStore.publicState(state) });
  });

  app.delete('/api/runtime/:ref/queue/:itemId', (req, res) => {
    const state = runtimeForSessionRef(req.params.ref);
    if (!state) return res.status(404).json({ error: 'Session not found.' });
    if (!runtimeStore.deletePrompt(state, req.params.itemId)) return res.status(404).json({ error: 'Queued prompt not found.' });
    broadcastRuntime(state);
    return res.json({ ok: true, state: runtimeStore.publicState(state) });
  });

  app.post('/api/runtime/:ref/queue/:itemId/move', (req, res) => {
    const state = runtimeForSessionRef(req.params.ref);
    if (!state) return res.status(404).json({ error: 'Session not found.' });
    runtimeStore.movePrompt(state, req.params.itemId, Number(req.body?.targetIndex));
    broadcastRuntime(state);
    return res.json({ ok: true, state: runtimeStore.publicState(state) });
  });

  app.post('/api/refresh', async (_req, res) => {
    try {
      await rescan();
      res.json({
        ok: true,
        workspaces: workspaceCache.length,
        sessions: workspaceCache.reduce((n, w) => n + w.sessionCount, 0),
        scannedAt: scanMeta.scannedAt
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Rescan failed' });
    }
  });

  // Start a brand-new Claude Code conversation. The request only enqueues
  // work; Claude keeps running in the server process even if the browser closes.
  app.post('/api/session', async (req, res) => {
    let prompt;
    try { prompt = validatePrompt(req.body?.prompt); } catch (error) { return res.status(400).json({ error: error.message }); }

    const workspace = findWorkspace(req.body?.workspaceId);
    let workspacePath = workspace?.path || null;
    if (!workspacePath && typeof req.body?.workspacePath === 'string' && req.body.workspacePath.trim()) workspacePath = expandUserPath(req.body.workspacePath);
    if (!workspacePath) return res.status(404).json({ error: 'Choose a workspace or folder first.' });
    if (!readableDirectory(workspacePath)) return res.status(400).json({ error: `Workspace folder is not readable: ${workspacePath}` });

    let runtimeOptions;
    try { runtimeOptions = validateRuntimeOptions(req.body, workspacePath); }
    catch (error) { return res.status(400).json({ error: error.message }); }

    const requestedSessionId = typeof req.body?.claudeSessionId === 'string' ? req.body.claudeSessionId.trim() : '';
    const claudeSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedSessionId)
      ? requestedSessionId
      : crypto.randomUUID();
    const { state, item } = createRuntimeSession(workspacePath, workspace?.id || null, claudeSessionId, prompt, runtimeOptions);
    return res.status(202).json({
      ok: true,
      queued: true,
      runtimeKey: state.key,
      claudeSessionId,
      sessionId: state.sessionId,
      workspaceId: state.workspaceId,
      workspacePath: state.workspacePath,
      item,
      state: runtimeStore.publicState(state)
    });
  });

  // Queue a follow-up for an existing Claude Code session. Queue state lives in
  // the Harness server, not in the browser, and is persisted to disk.
  app.post('/api/session/:id/message', async (req, res) => {
    let prompt;
    try { prompt = validatePrompt(req.body?.prompt); } catch (error) { return res.status(400).json({ error: error.message }); }
    const state = runtimeForSessionRef(req.params.id);
    if (!state) return res.status(404).json({ error: 'Session not found. Rescan if the transcript moved.' });
    let runtimeOptions;
    try { runtimeOptions = validateRuntimeOptions(req.body, state.workspacePath || args.root); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const { item } = enqueueRuntimePrompt(state.key, prompt, runtimeOptions);
    return res.status(202).json({ ok: true, queued: true, item, state: runtimeStore.publicState(state) });
  });

  app.get('/api/session/:id/stats', (req, res) => {
    const record = scanner.getSessionRecord(req.params.id) || scanner.findByClaudeSessionId(req.params.id) || findSessionByClaudeId(req.params.id)?.session || null;
    const runtime = runtimeForSessionRef(req.params.id);
    const claudeSessionId = record?.claudeSessionId || runtime?.claudeSessionId || (String(req.params.id).startsWith('runtime:') ? String(req.params.id).slice(8) : req.params.id);
    const live = statusMetrics[claudeSessionId] || null;
    let fallback = null;
    if (!live && (record?.filePath || record?.path)) fallback = contextFallback(record);
    const sessionMetric = live || fallback || {
      session_id: claudeSessionId,
      model: { id: null, display_name: 'Waiting for metrics' },
      workspace: { current_dir: record?.projectPath || runtime?.workspacePath || '', project_dir: record?.projectPath || runtime?.workspacePath || '', added_dirs: [] },
      context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 200000, used_percentage: 0, remaining_percentage: 100, current_usage: {} },
      estimated: true,
      capturedAt: null
    };
    return res.json({ session: sessionMetric, overall: overallStats(), environment: environmentSummary(record?.projectPath || runtime?.workspacePath || '') });
  });

  app.get('/api/stats', (_req, res) => res.json(overallStats()));

  app.get('/api/extensions/skills', (req, res) => {
    const workspacePath = typeof req.query.workspacePath === 'string' && req.query.workspacePath ? expandUserPath(req.query.workspacePath) : args.root;
    if (!readableDirectory(workspacePath)) return res.status(400).json({ error: 'Workspace is not readable.' });
    try { return res.json({ skills: listSkills(workspacePath) }); }
    catch (error) { return res.status(500).json({ error: error.message || 'Unable to list skills.' }); }
  });

  app.post('/api/extensions/skills/state', (req, res) => {
    const workspacePath = typeof req.body?.workspacePath === 'string' && req.body.workspacePath ? expandUserPath(req.body.workspacePath) : args.root;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const state = typeof req.body?.state === 'string' ? req.body.state : 'on';
    const scope = req.body?.scope === 'project' ? 'project' : 'user';
    if (!name || name.length > 240) return res.status(400).json({ error: 'Skill name is required.' });
    if (!['on', 'off', 'name-only', 'user-invocable-only'].includes(state)) return res.status(400).json({ error: 'Invalid skill state.' });
    const settingsPath = scope === 'project' ? path.join(workspacePath, '.claude', 'settings.local.json') : path.join(os.homedir(), '.claude', 'settings.json');
    try {
      const settings = safeReadJson(settingsPath) || {};
      if (!settings.skillOverrides || typeof settings.skillOverrides !== 'object' || Array.isArray(settings.skillOverrides)) settings.skillOverrides = {};
      if (state === 'on') delete settings.skillOverrides[name];
      else settings.skillOverrides[name] = state;
      writeJsonAtomic(settingsPath, settings);
      return res.json({ ok: true, skills: listSkills(workspacePath) });
    } catch (error) { return res.status(500).json({ error: error.message || 'Unable to update skill.' }); }
  });

  function parsePluginList(raw) {
    let value;
    try { value = JSON.parse(raw || '[]'); } catch { return { plugins: [], raw: String(raw || '') }; }
    const list = Array.isArray(value) ? value : Array.isArray(value?.plugins) ? value.plugins : Array.isArray(value?.installed) ? value.installed : Array.isArray(value?.available) ? value.available : Array.isArray(value?.items) ? value.items : [];
    return { plugins: list.map((item) => typeof item === 'string' ? { id: item, name: item, enabled: true } : {
      ...item,
      id: item.id || item.name || item.plugin || item.package || 'plugin',
      name: item.name || item.id || item.plugin || item.package || 'Plugin',
      enabled: item.enabled !== false && item.disabled !== true
    }), raw: '' };
  }

  app.get('/api/extensions/plugins', async (req, res) => {
    const workspacePath = typeof req.query.workspacePath === 'string' && req.query.workspacePath ? expandUserPath(req.query.workspacePath) : args.root;
    const mode = String(req.query.mode || 'installed');
    try {
      if (mode === 'marketplaces') {
        const result = await runClaudeCli(['plugin', 'marketplace', 'list', '--json'], workspacePath, { timeout: 30000 });
        let marketplaces = [];
        try { const parsed = JSON.parse(result.stdout || '[]'); marketplaces = Array.isArray(parsed) ? parsed : (parsed.marketplaces || parsed.items || []); } catch {}
        return res.json({ marketplaces, raw: marketplaces.length ? '' : result.stdout });
      }
      const cli = ['plugin', 'list', '--json'];
      if (mode === 'available') cli.push('--available');
      const result = await runClaudeCli(cli, workspacePath, { timeout: mode === 'available' ? 60000 : 25000 });
      return res.json(parsePluginList(result.stdout));
    } catch (error) { return res.status(500).json({ error: error.message || 'Unable to list plugins.' }); }
  });

  app.post('/api/extensions/plugins/action', async (req, res) => {
    const workspacePath = typeof req.body?.workspacePath === 'string' && req.body.workspacePath ? expandUserPath(req.body.workspacePath) : args.root;
    const action = String(req.body?.action || '');
    const plugin = typeof req.body?.plugin === 'string' ? req.body.plugin.trim() : '';
    const scope = ['user', 'project', 'local'].includes(req.body?.scope) ? req.body.scope : 'user';
    if (!['enable', 'disable', 'update', 'uninstall', 'install'].includes(action) || !plugin || plugin.length > 300) return res.status(400).json({ error: 'Invalid plugin action.' });
    const command = ['plugin', action, plugin];
    if (['install', 'uninstall', 'enable', 'disable', 'update'].includes(action)) command.push('--scope', scope);
    if (action === 'update') command.push('-y');
    try {
      const result = await runClaudeCli(command, workspacePath, { timeout: 120000 });
      return res.json({ ok: true, output: result.stdout || result.stderr || `${action} completed` });
    } catch (error) { return res.status(500).json({ error: error.message || `Unable to ${action} plugin.` }); }
  });

  app.post('/api/extensions/plugins/marketplace', async (req, res) => {
    const workspacePath = typeof req.body?.workspacePath === 'string' && req.body.workspacePath ? expandUserPath(req.body.workspacePath) : args.root;
    const action = String(req.body?.action || '');
    const source = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
    const scope = ['user', 'project', 'local'].includes(req.body?.scope) ? req.body.scope : 'user';
    let command;
    if (action === 'add' && source) command = ['plugin', 'marketplace', 'add', source, '--scope', scope];
    else if (action === 'remove' && source) command = ['plugin', 'marketplace', 'remove', source, '--scope', scope];
    else if (action === 'update') command = ['plugin', 'marketplace', 'update', ...(source ? [source] : [])];
    else return res.status(400).json({ error: 'Invalid marketplace action.' });
    try {
      const result = await runClaudeCli(command, workspacePath, { timeout: 120000 });
      return res.json({ ok: true, output: result.stdout || result.stderr || 'Marketplace updated.' });
    } catch (error) { return res.status(500).json({ error: error.message || 'Unable to update marketplace.' }); }
  });

  function stripAnsi(value) { return String(value || '').replace(/\x1b\[[0-9;]*m/g, ''); }
  function parseMcpList(raw) {
    return stripAnsi(raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = line.match(/^([^:]+):\s*(.*?)\s+-\s+(.+)$/);
      if (!match) return { name: line, detail: '', status: 'unknown', raw: line };
      const statusText = match[3];
      const status = /Connected|✔|✓/i.test(statusText) ? 'connected' : /Failed|✘|×|error/i.test(statusText) ? 'failed' : 'unknown';
      return { name: match[1].trim(), detail: match[2].trim(), status, statusText };
    });
  }

  app.get('/api/extensions/mcp', async (req, res) => {
    const workspacePath = typeof req.query.workspacePath === 'string' && req.query.workspacePath ? expandUserPath(req.query.workspacePath) : args.root;
    try {
      const result = await runClaudeCli(['mcp', 'list'], workspacePath, { timeout: 30000 });
      return res.json({ servers: parseMcpList(result.stdout) });
    } catch (error) { return res.status(500).json({ error: error.message || 'Unable to list MCP servers.' }); }
  });

  app.post('/api/extensions/mcp/action', async (req, res) => {
    const workspacePath = typeof req.body?.workspacePath === 'string' && req.body.workspacePath ? expandUserPath(req.body.workspacePath) : args.root;
    const action = String(req.body?.action || '');
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const scope = ['user', 'project', 'local'].includes(req.body?.scope) ? req.body.scope : 'local';
    if (!name || name.length > 160) return res.status(400).json({ error: 'MCP server name is required.' });
    let command;
    if (action === 'remove') command = ['mcp', 'remove', name];
    else if (action === 'add-http') {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid HTTP(S) MCP URL is required.' });
      command = ['mcp', 'add', '--scope', scope, '--transport', 'http', name, url];
    } else if (action === 'add-stdio') {
      const executable = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
      const serverArgs = Array.isArray(req.body?.args) ? req.body.args.filter((item) => typeof item === 'string').map((item) => item.slice(0, 1000)).slice(0, 50) : [];
      if (!executable || executable.length > 1000) return res.status(400).json({ error: 'A stdio command is required.' });
      command = ['mcp', 'add', '--scope', scope, '--transport', 'stdio', name, '--', executable, ...serverArgs];
    } else return res.status(400).json({ error: 'Unsupported MCP action.' });
    try {
      const result = await runClaudeCli(command, workspacePath, { timeout: 60000 });
      return res.json({ ok: true, output: result.stdout || result.stderr || `${action} completed` });
    } catch (error) { return res.status(500).json({ error: error.message || 'Unable to update MCP server.' }); }
  });

  app.get('/api/session/:id/rewind', (req, res) => {
    const record = scanner.getSessionRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Session not found.' });
    try {
      const points = listRewindPoints(record).map((point) => ({
        id: point.id,
        checkpointId: point.checkpointId,
        prompt: point.prompt,
        timestamp: point.timestamp,
        changes: point.changes.map((item) => ({ displayPath: item.displayPath, additions: item.additions, deletions: item.deletions, tool: item.tool })),
        changedFiles: point.changedFiles,
        additions: point.additions,
        deletions: point.deletions,
        canRestoreCode: point.canRestoreCode,
        restoreChanges: point.restoreChanges.map((item) => ({ displayPath: item.displayPath, additions: item.additions, deletions: item.deletions, tool: item.tool })),
        restoreChangedFiles: point.restoreChangedFiles,
        restoreAdditions: point.restoreAdditions,
        restoreDeletions: point.restoreDeletions
      }));
      return res.json({
        sessionId: req.params.id,
        claudeSessionId: record.claudeSessionId,
        projectPath: record.projectPath,
        points
      });
    } catch (error) {
      log.warn('Unable to list rewind checkpoints', { error, sessionId: req.params.id });
      return res.status(500).json({ error: `Unable to read rewind checkpoints: ${error.message}` });
    }
  });

  app.post('/api/session/:id/rewind', async (req, res) => {
    const record = scanner.getSessionRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Session not found.' });
    const runtime = runtimeStore.get(record.claudeSessionId) || runtimeStore.get(req.params.id);
    if (runtime?.active || runtime?.status === 'running' || runtime?.status === 'waiting_approval') {
      return res.status(409).json({ error: 'Stop the active Claude task before rewinding this session.' });
    }

    const action = String(req.body?.action || '');
    const allowedActions = new Set(['restore_code_conversation', 'restore_conversation', 'restore_code', 'summarize_from', 'summarize_up_to']);
    if (!allowedActions.has(action)) return res.status(400).json({ error: 'Unsupported rewind action.' });

    let points;
    try { points = listRewindPoints(record); }
    catch (error) { return res.status(500).json({ error: `Unable to read rewind checkpoints: ${error.message}` }); }
    const pointId = String(req.body?.pointId || '');
    const point = points.find((item) => item.id === pointId);
    if (!point) return res.status(404).json({ error: 'That rewind checkpoint is no longer available. Reopen /rewind and try again.' });

    const finishFork = async (newSessionId, draft = '', nameSuffix = 'rewind') => {
      if (draft) uiStateStore.set('draft', newSessionId, draft);
      const sourceName = sessionNames[record.claudeSessionId]
        || sessionNames[record.id]
        || firstUsefulName(scanner.parseSessionFile(record.filePath), record.filePath);
      if (sourceName) {
        sessionNames[newSessionId] = `${sourceName} · ${nameSuffix}`.slice(0, 120);
        saveSessionNames();
      }
      await rescan();
      const found = findSessionByClaudeId(newSessionId);
      if (!found) throw new Error('The rewound session was created but could not be indexed.');
      return {
        ok: true,
        mode: 'session',
        workspaceId: found.workspace.id,
        sessionId: found.session.id,
        claudeSessionId: newSessionId,
        draft
      };
    };

    try {
      if (action === 'restore_code' || action === 'restore_code_conversation') {
        if (!point.canRestoreCode) return res.status(400).json({ error: 'Claude did not record restorable file edits for this checkpoint.' });
        await rewindFilesForPoint(record, point);
      }

      if (action === 'restore_code') {
        fileIndexCache.delete(path.resolve(record.projectPath));
        broadcast({ type: 'files-changed', workspacePath: record.projectPath, sessionId: record.claudeSessionId });
        return res.json({ ok: true, mode: 'same', sessionId: req.params.id, claudeSessionId: record.claudeSessionId });
      }

      if (action === 'restore_conversation' || action === 'restore_code_conversation') {
        const forked = forkSessionBeforeLine(record, point.lineIndex);
        if (forked.empty) {
          const draftKey = `new:${record.projectPath}`;
          uiStateStore.set('draft', draftKey, point.prompt);
          return res.json({ ok: true, mode: 'new', workspacePath: record.projectPath, draft: point.prompt });
        }
        const body = await finishFork(forked.newSessionId, point.prompt, 'rewind');
        return res.json(body);
      }

      if (action === 'summarize_from') {
        const rangeText = transcriptSliceAsText(record, point.lineIndex);
        const summary = await generateTargetedSummary(record, rangeText, 'selected message through the current end of the session');
        const forked = forkSessionBeforeLine(record, point.lineIndex);
        let newSessionId = forked.newSessionId;
        const summaryPrompt = [
          '<claude-harness-rewind-summary>', summary, '</claude-harness-rewind-summary>',
          'This is recovered conversation context. Do not perform any task. Reply exactly: Context restored.'
        ].join('\n');
        if (forked.empty) {
          newSessionId = await seedSummarySession(record, summary);
        } else {
          await runClaudeCode({ cwd: record.projectPath, prompt: summaryPrompt, resumeId: newSessionId, permissionMode: 'bypassPermissions', model: 'default', tools: '', disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Task', 'Agent'] });
        }
        const body = await finishFork(newSessionId, point.prompt, 'summary');
        return res.json(body);
      }

      if (action === 'summarize_up_to') {
        const beforeText = transcriptSliceAsText(record, 0, point.lineIndex);
        const laterText = transcriptSliceAsText(record, point.lineIndex);
        const summary = await generateTargetedSummary(record, beforeText, 'start of the session through the message immediately before the selected checkpoint');
        const newSessionId = await seedSummarySession(record, summary, laterText);
        const body = await finishFork(newSessionId, '', 'summary');
        return res.json(body);
      }

      return res.status(400).json({ error: 'Unsupported rewind action.' });
    } catch (error) {
      log.error('Rewind action failed', { error, sessionId: req.params.id, action, pointId });
      return res.status(500).json({ error: `Rewind failed: ${error.message}` });
    }
  });

  app.get('/api/session/:id', (req, res) => {
    const record = scanner.getSessionRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Session not found. Rescan if the file moved.' });

    const filePath = record.filePath;
    let stat;
    try { stat = fs.statSync(filePath); } catch { return res.status(404).json({ error: 'Session file no longer exists.' }); }
    if (!stat.isFile()) return res.status(404).json({ error: 'Session path is not a file.' });

    const turns = scanner.parseSessionFile(filePath);
    return res.json({
      id: req.params.id,
      name: sessionNames[record.claudeSessionId] || sessionNames[req.params.id] || firstUsefulName(turns, filePath),
      path: filePath,
      claudeSessionId: record.claudeSessionId,
      projectPath: record.projectPath,
      projectName: record.projectName,
      turns
    });
  });

  app.post('/api/session/:id/rename', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Session name cannot be empty.' });
    if (name.length > 120) return res.status(400).json({ error: 'Session name must be 120 characters or fewer.' });
    const record = scanner.getSessionRecord(req.params.id);
    const runtimeRef = String(req.params.id).startsWith('runtime:') ? String(req.params.id).slice('runtime:'.length) : req.params.id;
    const runtime = runtimeStore.get(runtimeRef);
    if (!record && !runtime) return res.status(404).json({ error: 'Session not found.' });
    const key = record?.claudeSessionId || runtime?.claudeSessionId || req.params.id;
    sessionNames[key] = name;
    saveSessionNames();
    if (record) await rescan();
    else broadcast({ type: 'workspaces', workspaces: publicWorkspaces(), meta: scanMeta });
    return res.json({ ok: true, name });
  });

  app.post('/api/session/:id/fork', async (req, res) => {
    const record = scanner.getSessionRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Session not found.' });
    const runtime = runtimeStore.get(record.claudeSessionId) || runtimeStore.get(req.params.id);
    const throughTimestamp = typeof req.body?.throughTimestamp === 'string' && req.body.throughTimestamp.trim() ? req.body.throughTimestamp.trim() : null;
    if (!throughTimestamp && (runtime?.active || runtime?.status === 'running' || runtime?.status === 'waiting_approval')) return res.status(409).json({ error: 'Cannot fork the live tip of a session while Claude is working on it. Fork an earlier Claude message instead.' });
    try {
      const { newSessionId } = forkSessionTranscript(record, throughTimestamp);
      await rescan();
      const found = findSessionByClaudeId(newSessionId);
      if (!found) return res.status(500).json({ error: 'The forked transcript was created but could not be indexed.' });
      return res.json({ ok: true, workspaceId: found.workspace.id, sessionId: found.session.id, claudeSessionId: newSessionId });
    } catch (error) {
      return res.status(500).json({ error: `Unable to fork session: ${error.message}` });
    }
  });

  app.delete('/api/session/:id', async (req, res) => {
    const record = scanner.getSessionRecord(req.params.id);
    const runtimeRef = String(req.params.id).startsWith('runtime:') ? String(req.params.id).slice('runtime:'.length) : req.params.id;
    const runtime = (record ? runtimeStore.get(record.claudeSessionId) : null) || runtimeStore.get(runtimeRef);
    if (!record && !runtime) return res.status(404).json({ error: 'Session not found.' });
    if (runtime?.active || runtime?.status === 'running' || runtime?.status === 'waiting_approval') return res.status(409).json({ error: 'Cannot delete a session while Claude is working on it.' });

    try {
      if (record) fs.unlinkSync(record.filePath);
      if (runtime) runtimeStore.remove(runtime.key);
      delete sessionNames[record?.claudeSessionId || runtime?.claudeSessionId || req.params.id];
      delete sessionNames[req.params.id];
      saveSessionNames();
      if (record) await rescan();
      else broadcast({ type: 'workspaces', workspaces: publicWorkspaces(), meta: scanMeta });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: `Unable to delete session: ${error.message}` });
    }
  });

  // Keep API 404s JSON even when Vite's SPA fallback is enabled in development.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  let vite = null;
  if (devMode) {
    // Vite runs in middleware mode inside this same HTTP server. There is no
    // second :5173 server: Express API, React UI and Vite HMR all use --port.
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      configFile: path.resolve(__dirname, 'frontend', 'vite.config.mjs'),
      server: {
        middlewareMode: true,
        hmr: { server }
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const APP_HTML = loadProductionHtml();
    app.get('/', (_req, res) => res.type('html').send(APP_HTML));
    app.get('*', (_req, res) => res.type('html').send(APP_HTML));
  }

  server.requestTimeout = 0;
  server.headersTimeout = 0;

  server.listen(args.port, args.host, () => {
    const localUrl = `http://localhost:${args.port}`;
    const displayHost = args.host === '0.0.0.0' || args.host === '::' ? '<this-computer-ip>' : args.host;
    log.info('Claude Harness listening', { mode: devMode ? 'development' : 'production', url: `http://${displayHost}:${args.port}`, browserAutoOpen: args.open });
    if (auth.enabled) log.info('Authentication enabled', { user: auth.user });
    else {
      log.info('Authentication disabled because CH_USER / CH_PASSWORD are not set');
      if (!['127.0.0.1', 'localhost', '::1'].includes(args.host)) {
        log.warn('Listening beyond localhost without authentication; set CH_USER and CH_PASSWORD before LAN/public use', { host: args.host });
      }
    }
    if (devMode) log.info('Vite HMR mounted on the same HTTP server');
    for (const state of runtimeStore.sessions.values()) {
      if (runtimeStore.nextRunnable(state)) setImmediate(() => processRuntimeQueue(state));
    }
    if (args.open) setTimeout(() => openBrowser(localUrl), 250);
  });

  server.on('error', (error) => {
    log.error('HTTP server error', { error });
    process.exitCode = 1;
  });

  server.on('close', () => {
    clearInterval(wsHeartbeat);
    for (const socket of wsClients) { try { socket.close(); } catch {} }
    try { wss.close(); } catch {}
  });

  if (vite) {
    server.on('close', () => {
      vite.close().catch(() => {});
    });
  }

  return server;
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { error: reason instanceof Error ? reason : new Error(String(reason)) });
});
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', { error });
  process.exit(1);
});

if (require.main === module) {
  if (!maybeRunStatusLineHelper()) {
    main().catch((error) => {
      log.error('Fatal startup error', { error });
      process.exitCode = 1;
    });
  }
}

module.exports = { parseArgs, parseClaudePayload, runClaudeCode, isDevelopmentMode, loadProductionHtml, main };
