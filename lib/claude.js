'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MAX_DEPTH = 5;
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', '__pycache__']);

function sha(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 20);
}

function normalizeTimestamp(value) {
  if (value == null || value === '') return null;
  let d;
  if (typeof value === 'number') d = new Date(value < 1e12 ? value * 1000 : value);
  else d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function blockText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(blockText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) return blockText(value.content);
    if (typeof value.output === 'string') return value.output;
  }
  return '';
}

function normalizeRole(rawRole) {
  if (rawRole === 'tool') return 'tool_result';
  if (rawRole === 'user') return 'user';
  if (rawRole === 'assistant') return 'assistant';
  return null;
}

function localCommandTag(text, tag) {
  const match = String(text || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function normalizeLocalCommandTurns(turns) {
  const normalized = [];

  for (const turn of turns || []) {
    const content = String(turn?.content || '');
    if (turn?.role !== 'user' || !content.includes('<')) {
      normalized.push(turn);
      continue;
    }

    const commandName = localCommandTag(content, 'command-name');
    const commandArgs = localCommandTag(content, 'command-args');
    const stdout = localCommandTag(content, 'local-command-stdout');
    const hasCaveat = /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/i.test(content);

    // Claude Code persists slash-command bookkeeping as user messages. That is
    // useful for the terminal transcript, but noisy in a chat UI. Represent the
    // actual command once on the user side and its local stdout as a concise
    // assistant/status response instead.
    if (commandName) {
      const display = `${commandName}${commandArgs ? ` ${commandArgs}` : ''}`.trim();
      normalized.push({ ...turn, role: 'user', content: display, blocks: [], toolName: null, toolInput: {} });
    }

    if (stdout) {
      let display = stdout;
      if (commandName === '/compact' || normalized.at(-1)?.content === '/compact') {
        display = display.replace(/\s*\(ctrl\+o to see full summary\)\s*$/i, '').trim();
        if (/^compacted\b/i.test(display)) display = 'Compacted';
      }
      if (display) normalized.push({ ...turn, role: 'assistant', content: display, blocks: [], toolName: null, toolInput: {} });
    }

    if (commandName || stdout || hasCaveat) continue;
    normalized.push(turn);
  }

  return normalized;
}

function parseJsonlText(text) {
  const turns = [];
  const toolNames = new Map();
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;

    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj !== 'object') continue;

    const wrapped = obj.message && typeof obj.message === 'object' ? obj.message : obj;
    const rawRole = wrapped.role || obj.role || null;
    const role = normalizeRole(rawRole);
    const timestamp = normalizeTimestamp(
      obj.timestamp ?? obj.created_at ?? wrapped.timestamp ?? wrapped.created_at ?? obj.message?.created_at
    );
    const content = wrapped.content ?? obj.content ?? '';

    if (Array.isArray(content)) {
      let pending = [];
      const flushPending = () => {
        if (!pending.length) return;
        const contentText = pending.map(blockText).filter(Boolean).join('\n');
        if (contentText || role) {
          turns.push({
            role: role || 'assistant',
            content: contentText,
            blocks: pending,
            timestamp,
            toolName: null,
            toolInput: {}
          });
        }
        pending = [];
      };

      for (const block of content) {
        if (typeof block === 'string') {
          pending.push({ type: 'text', text: block });
          continue;
        }
        if (!block || typeof block !== 'object') continue;

        if (block.type === 'tool_use') {
          flushPending();
          const toolName = block.name || 'tool';
          if (block.id) toolNames.set(block.id, toolName);
          turns.push({
            role: 'assistant',
            content: '',
            blocks: [block],
            timestamp,
            toolName,
            toolInput: block.input && typeof block.input === 'object' ? block.input : {}
          });
          continue;
        }

        if (block.type === 'tool_result') {
          flushPending();
          const toolName = block.name || toolNames.get(block.tool_use_id) || null;
          turns.push({
            role: 'tool_result',
            content: blockText(block.content ?? block.text ?? ''),
            blocks: [block],
            timestamp,
            toolName,
            toolInput: {}
          });
          continue;
        }

        pending.push(block);
      }

      flushPending();
      continue;
    }

    if (!role) continue;
    turns.push({
      role,
      content: blockText(content),
      blocks: [],
      timestamp,
      toolName: null,
      toolInput: {}
    });
  }

  return normalizeLocalCommandTurns(turns);
}

function sessionIdFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function extractSessionContextText(text, filePath, fallbackProjectPath = null) {
  let sessionId = null;
  let projectPath = null;
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj !== 'object') continue;

    if (!sessionId) {
      const candidate = obj.sessionId ?? obj.session_id ?? obj.message?.sessionId ?? obj.message?.session_id;
      if (typeof candidate === 'string' && candidate.trim()) sessionId = candidate.trim();
    }

    if (!projectPath) {
      const candidate = obj.cwd ?? obj.projectPath ?? obj.project_path ?? obj.message?.cwd;
      if (typeof candidate === 'string' && candidate.trim()) projectPath = path.resolve(candidate.trim());
    }

    if (sessionId && projectPath) break;
  }

  const resolvedFallback = fallbackProjectPath ? path.resolve(fallbackProjectPath) : null;
  projectPath = projectPath || resolvedFallback;
  sessionId = sessionId || sessionIdFromPath(filePath);

  return {
    claudeSessionId: sessionId,
    projectPath,
    projectName: projectPath ? (path.basename(projectPath) || projectPath) : null
  };
}

function readSession(filePath, fallbackProjectPath = null) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return {
      text,
      turns: parseJsonlText(text),
      context: extractSessionContextText(text, filePath, fallbackProjectPath)
    };
  } catch {
    return {
      text: '',
      turns: [],
      context: extractSessionContextText('', filePath, fallbackProjectPath)
    };
  }
}

function parseSessionFile(filePath) {
  return readSession(filePath).turns;
}

function firstUsefulName(turns, filePath) {
  const user = turns.find((turn) => turn.role === 'user' && turn.content && turn.content.trim());
  if (user) {
    const line = user.content.replace(/\s+/g, ' ').trim();
    if (line) return line.length > 58 ? `${line.slice(0, 55)}…` : line;
  }
  const base = path.basename(filePath, path.extname(filePath));
  return base || 'Claude session';
}

function listJsonlFiles(root) {
  const out = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        out.push(fullPath);
      }
    }
  }

  walk(root);
  return out;
}

function normalizeFsPath(value) {
  try { return path.resolve(String(value)); } catch { return String(value); }
}

// Claude Code commonly stores project transcripts below
// ~/.claude/projects/<encoded-project-path>/*.jsonl. The exact encoding is not
// safely reversible when folder names themselves contain dashes. Instead we
// build the same slash-to-dash key for directories we actually discovered and
// use it only as a fallback when a transcript does not contain cwd/projectPath.
function claudeProjectKey(value) {
  const resolved = normalizeFsPath(value);
  return resolved.replace(/^[A-Za-z]:/, (drive) => drive[0].toLowerCase()).replace(/[\\/]/g, '-');
}

function encodedProjectKeyFromFile(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  const claudeIndex = parts.lastIndexOf('.claude');
  if (claudeIndex < 0 || parts[claudeIndex + 1] !== 'projects') return null;
  return parts[claudeIndex + 2] || null;
}

function createScanner() {
  // Internal id -> immutable metadata for the transcript discovered in the last scan.
  const sessionIndex = new Map();

  async function findClaudeWorkspaces(root = os.homedir()) {
    const resolvedRoot = path.resolve(root);
    const claudeDirs = [];
    const discoveredDirectories = [];
    const seenDirectories = new Set();
    sessionIndex.clear();

    async function walk(dir, depth) {
      if (depth > MAX_DEPTH) return;
      const resolvedDir = path.resolve(dir);
      if (seenDirectories.has(resolvedDir)) return;
      seenDirectories.add(resolvedDir);
      discoveredDirectories.push(resolvedDir);

      let entries;
      try { entries = fs.readdirSync(resolvedDir, { withFileTypes: true }); } catch { return; }

      const hasClaudeDir = entries.some((entry) => entry.isDirectory() && entry.name === '.claude');
      if (hasClaudeDir) claudeDirs.push({ claudeDir: path.join(resolvedDir, '.claude'), ownerPath: resolvedDir });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(path.join(resolvedDir, entry.name), depth + 1);
      }
    }

    await walk(resolvedRoot, 0);

    const projectKeyIndex = new Map();
    for (const dir of discoveredDirectories) {
      const key = claudeProjectKey(dir);
      if (!projectKeyIndex.has(key)) projectKeyIndex.set(key, dir);
    }

    const workspaceMap = new Map();
    const seenFiles = new Set();

    function ensureWorkspace(workspacePath) {
      const resolvedPath = normalizeFsPath(workspacePath);
      let workspace = workspaceMap.get(resolvedPath);
      if (!workspace) {
        workspace = {
          id: sha(resolvedPath),
          name: path.basename(resolvedPath) || resolvedPath,
          path: resolvedPath,
          sessionCount: 0,
          lastActivity: null,
          sessions: []
        };
        workspaceMap.set(resolvedPath, workspace);
      }
      return workspace;
    }

    // A physical .claude folder is still a workspace even if it has no
    // transcripts. Transcripts can later be re-homed to their real cwd.
    for (const entry of claudeDirs) ensureWorkspace(entry.ownerPath);

    for (const { claudeDir, ownerPath } of claudeDirs) {
      const files = listJsonlFiles(claudeDir);
      for (const filePath of files) {
        const resolvedFile = path.resolve(filePath);
        if (seenFiles.has(resolvedFile)) continue;
        seenFiles.add(resolvedFile);

        let stat;
        try { stat = fs.statSync(resolvedFile); } catch { continue; }

        // First read without a fallback so we can distinguish a real cwd from
        // the physical .claude owner. This is what fixes nested project
        // sessions stored in a parent ~/.claude/projects directory.
        const { text, turns } = readSession(resolvedFile, null);
        let context = extractSessionContextText(text, resolvedFile, null);

        if (!context.projectPath) {
          const encodedKey = encodedProjectKeyFromFile(resolvedFile);
          const matchedDirectory = encodedKey ? projectKeyIndex.get(encodedKey) : null;
          context = {
            ...context,
            projectPath: matchedDirectory || ownerPath,
            projectName: path.basename(matchedDirectory || ownerPath) || (matchedDirectory || ownerPath)
          };
        }

        const meaningfulTurns = turns.filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && String(turn.content || '').trim());
        // Ignore transcript files that contain only metadata/tool bookkeeping.
        // They create empty sessions in Claude's project store but are not useful
        // conversation entries in the Harness sidebar.
        if (meaningfulTurns.length === 0) continue;

        const projectPath = normalizeFsPath(context.projectPath || ownerPath);

        // Claude keeps transcript files even after a project directory is moved
        // or deleted. Those orphaned sessions cannot be resumed safely, so do
        // not surface them in the Harness sidebar. A moved project will appear
        // again naturally once Claude creates/uses a transcript whose cwd points
        // at the new, existing directory.
        let projectDirectoryExists = false;
        try { projectDirectoryExists = fs.statSync(projectPath).isDirectory(); } catch {}
        if (!projectDirectoryExists) continue;

        const workspace = ensureWorkspace(projectPath);
        const firstTs = turns.map((turn) => turn.timestamp).find(Boolean);
        const lastTs = [...turns].reverse().map((turn) => turn.timestamp).find(Boolean);
        const created = firstTs || normalizeTimestamp(stat.birthtimeMs) || normalizeTimestamp(stat.mtimeMs);
        const updated = lastTs || normalizeTimestamp(stat.mtimeMs);
        const id = sha(resolvedFile);
        const record = {
          id,
          filePath: resolvedFile,
          claudeSessionId: context.claudeSessionId || sessionIdFromPath(resolvedFile),
          projectPath,
          projectName: path.basename(projectPath) || projectPath
        };
        sessionIndex.set(id, record);

        workspace.sessions.push({
          id,
          name: firstUsefulName(turns, resolvedFile),
          path: resolvedFile,
          claudeSessionId: record.claudeSessionId,
          projectPath: record.projectPath,
          projectName: record.projectName,
          created,
          updated,
          messageCount: meaningfulTurns.length
        });
      }
    }

    const results = [...workspaceMap.values()];
    for (const workspace of results) {
      workspace.sessions.sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')));
      workspace.sessionCount = workspace.sessions.length;
      workspace.lastActivity = workspace.sessions[0]?.updated || workspace.sessions[0]?.created || null;
    }

    results.sort((a, b) => {
      const activity = String(b.lastActivity || '').localeCompare(String(a.lastActivity || ''));
      if (activity) return activity;
      return a.path.localeCompare(b.path);
    });
    return results;
  }

  function getSessionRecord(id) {
    return sessionIndex.get(id) || null;
  }

  function findByClaudeSessionId(claudeSessionId) {
    for (const record of sessionIndex.values()) {
      if (record.claudeSessionId === claudeSessionId) return record;
    }
    return null;
  }

  return {
    sessionIndex,
    findClaudeWorkspaces,
    parseSessionFile,
    getSessionRecord,
    findByClaudeSessionId
  };
}

module.exports = {
  MAX_DEPTH,
  SKIP_DIRS,
  createScanner,
  parseJsonlText,
  parseSessionFile,
  firstUsefulName,
  normalizeTimestamp,
  normalizeLocalCommandTurns,
  extractSessionContextText,
  sessionIdFromPath,
  claudeProjectKey,
  encodedProjectKeyFromFile
};
