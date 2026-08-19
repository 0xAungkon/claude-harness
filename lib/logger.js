'use strict';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });
const REDACT_RE = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|credential)/i;

function normalizeLevel(value) {
  const key = String(value || 'info').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, key) ? key : 'info';
}

function sanitize(value, depth = 0) {
  if (depth > 4) return '[MaxDepth]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}…` : value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = REDACT_RE.test(key) ? '[REDACTED]' : sanitize(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

function formatMeta(meta) {
  if (!meta || typeof meta !== 'object' || !Object.keys(meta).length) return '';
  try { return ` ${JSON.stringify(sanitize(meta))}`; }
  catch { return ' {"meta":"[unserializable]"}'; }
}

function createLogger(scope = 'app') {
  const configured = normalizeLevel(process.env.CH_LOG_LEVEL || process.env.CLAUDE_HARNESS_LOG_LEVEL || 'info');
  const threshold = LEVELS[configured];

  const write = (level, message, meta = null) => {
    if (LEVELS[level] < threshold) return;
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${String(message || '')}${formatMeta(meta)}\n`;
    if (level === 'warn' || level === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (name) => createLogger(`${scope}:${name}`)
  };
}

module.exports = { createLogger };
