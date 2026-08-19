'use strict';

const fs = require('fs');
const path = require('path');

const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', '__pycache__']);
const DEFAULT_LIMIT = 120;
const DEFAULT_MAX_FILES = 25000;

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegexSource(glob) {
  let out = '';
  const value = toPosix(glob);
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '*') {
      if (value[i + 1] === '*') {
        while (value[i + 1] === '*') i += 1;
        if (value[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const close = value.indexOf(']', i + 1);
      if (close > i + 1) {
        let body = value.slice(i + 1, close);
        if (body[0] === '!') body = `^${body.slice(1)}`;
        out += `[${body}]`;
        i = close;
      } else {
        out += '\\[';
      }
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

function compileRule(rawLine, baseRelative = '') {
  let line = String(rawLine || '').replace(/\r$/, '');
  if (!line) return null;
  if (line.startsWith('#')) return null;
  if (line.startsWith('\\#')) line = line.slice(1);

  let negated = false;
  if (line.startsWith('!')) {
    negated = true;
    line = line.slice(1);
  } else if (line.startsWith('\\!')) {
    line = line.slice(1);
  }

  line = line.replace(/(?<!\\)\s+$/, '');
  if (!line) return null;

  const directoryOnly = line.endsWith('/');
  if (directoryOnly) line = line.slice(0, -1);
  if (!line) return null;

  const anchored = line.startsWith('/');
  if (anchored) line = line.slice(1);

  const normalizedBase = toPosix(baseRelative).replace(/^\/+|\/+$/g, '');
  const prefix = normalizedBase ? `${escapeRegex(normalizedBase)}/` : '';
  const hasSlash = line.includes('/');
  const body = globToRegexSource(line);

  let source;
  if (anchored || hasSlash) source = `^${prefix}${body}(?:/.*)?$`;
  else source = `^${prefix}(?:.*/)?${body}(?:/.*)?$`;

  return { negated, directoryOnly, regex: new RegExp(source) };
}

function readRules(dir, root, inheritedRules) {
  const rules = inheritedRules.slice();
  const ignorePath = path.join(dir, '.gitignore');
  let text;
  try { text = fs.readFileSync(ignorePath, 'utf8'); } catch { return rules; }

  const baseRelative = toPosix(path.relative(root, dir));
  for (const line of text.split(/\r?\n/)) {
    const rule = compileRule(line, baseRelative);
    if (rule) rules.push(rule);
  }
  return rules;
}

function isIgnored(relativePath, isDirectory, rules) {
  const rel = toPosix(relativePath).replace(/^\.\//, '');
  let ignored = false;
  for (const rule of rules) {
    if (!rule.regex.test(rel)) continue;
    if (rule.directoryOnly && !isDirectory && !rel.includes('/')) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

function listProjectFiles(root, options = {}) {
  const resolvedRoot = path.resolve(String(root));
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : DEFAULT_MAX_FILES;
  const files = [];
  const directories = [];
  let truncated = false;

  function walk(dir, inheritedRules) {
    if ((files.length + directories.length) >= maxFiles) {
      truncated = true;
      return;
    }

    const rules = readRules(dir, resolvedRoot, inheritedRules);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if ((files.length + directories.length) >= maxFiles) {
        truncated = true;
        break;
      }

      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && ALWAYS_SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relative = toPosix(path.relative(resolvedRoot, fullPath));
      if (!relative || relative.startsWith('../')) continue;

      if (entry.isDirectory()) {
        if (isIgnored(relative, true, rules)) continue;
        directories.push({
          type: 'folder',
          name: entry.name,
          path: relative,
          absolutePath: fullPath
        });
        walk(fullPath, rules);
      } else if (entry.isFile()) {
        if (isIgnored(relative, false, rules)) continue;
        files.push({
          type: 'file',
          name: entry.name,
          path: relative,
          absolutePath: fullPath
        });
      }
    }
  }

  walk(resolvedRoot, []);
  return {
    root: resolvedRoot,
    files,
    directories,
    entries: [...directories, ...files],
    truncated
  };
}

function normalizeQuery(value) {
  return toPosix(String(value || '').replace(/\\ /g, ' '))
    .replace(/^@/, '')
    .replace(/^\.\//, '')
    .trim()
    .toLowerCase();
}

function normalizedRawQuery(value) {
  return toPosix(String(value || '').replace(/\\ /g, ' '))
    .replace(/^@/, '');
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function matchScore(name, query) {
  if (!query) return 0;
  const candidate = String(name || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  if (candidate === q) return 0;
  if (candidate.startsWith(q)) return 10 + candidate.length / 10000;

  const boundary = candidate.search(new RegExp(`(?:^|[-_.\\s])${escapeRegex(q)}`));
  if (boundary >= 0) return 20 + boundary / 100 + candidate.length / 10000;

  const camelCandidate = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const camelIndex = camelCandidate.indexOf(q);
  if (camelIndex >= 0) return 24 + camelIndex / 100 + candidate.length / 10000;

  const index = candidate.indexOf(q);
  if (index >= 0) return 30 + index / 100 + candidate.length / 10000;

  // Small fuzzy fallback: all query characters must appear in order.
  let qIndex = 0;
  let spread = 0;
  for (let i = 0; i < candidate.length && qIndex < q.length; i += 1) {
    if (candidate[i] === q[qIndex]) {
      spread += i;
      qIndex += 1;
    }
  }
  if (qIndex === q.length) return 50 + spread / 1000 + candidate.length / 10000;
  return Number.POSITIVE_INFINITY;
}

function pathParent(relativePath) {
  const dir = path.posix.dirname(toPosix(relativePath));
  return dir === '.' ? '' : dir.replace(/^\/+|\/+$/g, '');
}

function publicEntry(entry, mentionPath) {
  return {
    type: entry.type || 'file',
    name: entry.name,
    path: mentionPath,
    relativePath: entry.path
  };
}

function browseEntries(fileIndex, rawQuery, limit) {
  const root = path.resolve(fileIndex.root || '.');
  const entries = fileIndex.entries || [...(fileIndex.directories || []), ...(fileIndex.files || [])];
  const raw = normalizedRawQuery(rawQuery);
  const trailingSlash = /\/$/.test(raw);
  const absoluteMode = path.isAbsolute(raw);

  let relativeDirectory = '';
  let fragment = '';

  if (absoluteMode) {
    const absoluteTarget = path.resolve(raw || root);
    const browseAbsolute = trailingSlash ? absoluteTarget : path.dirname(absoluteTarget);
    if (!isInsideRoot(root, browseAbsolute)) return [];
    relativeDirectory = toPosix(path.relative(root, browseAbsolute)).replace(/^\.\//, '');
    if (relativeDirectory === '.') relativeDirectory = '';
    fragment = trailingSlash ? '' : path.basename(absoluteTarget);
  } else {
    const rel = toPosix(raw).replace(/^\.\//, '').replace(/^\/+/, '');
    if (!rel) {
      relativeDirectory = '';
      fragment = '';
    } else if (trailingSlash) {
      relativeDirectory = rel.replace(/\/+$/, '');
      fragment = '';
    } else {
      relativeDirectory = pathParent(rel);
      fragment = path.posix.basename(rel);
    }
  }

  const loweredFragment = fragment.toLowerCase();
  const ranked = [];
  for (const entry of entries) {
    if (pathParent(entry.path) !== relativeDirectory) continue;
    const score = matchScore(entry.name, loweredFragment);
    if (!Number.isFinite(score)) continue;
    const mentionPath = absoluteMode ? toPosix(entry.absolutePath) : entry.path;
    ranked.push({ entry, score, mentionPath });
  }

  ranked.sort((a, b) => {
    const kind = (a.entry.type === 'folder' ? 0 : 1) - (b.entry.type === 'folder' ? 0 : 1);
    return kind || a.score - b.score || a.entry.name.localeCompare(b.entry.name);
  });

  return ranked.slice(0, limit).map(({ entry, mentionPath }) => publicEntry(entry, mentionPath));
}

function recursiveEntries(fileIndex, rawQuery, limit) {
  const entries = fileIndex.entries || [...(fileIndex.directories || []), ...(fileIndex.files || [])];
  const query = normalizeQuery(rawQuery);
  const ranked = [];

  for (const entry of entries) {
    const nameScore = matchScore(entry.name, query);
    const pathScore = matchScore(entry.path, query);
    const score = Math.min(nameScore, Number.isFinite(pathScore) ? pathScore + 6 : pathScore);
    if (!Number.isFinite(score)) continue;
    ranked.push({ entry, score });
  }

  ranked.sort((a, b) => {
    const kind = (a.entry.type === 'folder' ? 0 : 1) - (b.entry.type === 'folder' ? 0 : 1);
    return kind || a.score - b.score || a.entry.path.localeCompare(b.entry.path);
  });
  return ranked.slice(0, limit).map(({ entry }) => publicEntry(entry, entry.path));
}

function searchProjectFiles(fileIndex, query, limit = DEFAULT_LIMIT) {
  const raw = normalizedRawQuery(query);

  // Blank @ lists only the current workspace's direct children. Any path-like
  // query browses only that directory. A plain token performs recursive search.
  if (!raw || raw.includes('/')) return browseEntries(fileIndex, raw, limit);
  return recursiveEntries(fileIndex, raw, limit);
}

module.exports = {
  ALWAYS_SKIP_DIRS,
  DEFAULT_LIMIT,
  DEFAULT_MAX_FILES,
  toPosix,
  compileRule,
  isIgnored,
  listProjectFiles,
  searchProjectFiles,
  normalizeQuery,
  matchScore,
  isInsideRoot
};
