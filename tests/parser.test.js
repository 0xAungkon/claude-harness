'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listProjectFiles, searchProjectFiles } = require('../lib/file-index');

const {
  parseJsonlText,
  normalizeTimestamp,
  extractSessionContextText,
  sessionIdFromPath,
  createScanner,
  claudeProjectKey
} = require('../lib/claude');

async function run() {
  const input = [
    JSON.stringify({
      type: 'user',
      sessionId: '635af72b-9007-4acf-a959-78748edd94f4',
      cwd: '/home/oxa',
      message: { role: 'user', content: 'hello' },
      timestamp: '2026-08-16T13:00:00Z'
    }),
    '{malformed',
    JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will check.' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } }
        ]
      }
    }),
    JSON.stringify({
      role: 'tool',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '/tmp/project' }]
    })
  ].join('\n');

  const turns = parseJsonlText(input);
  assert.strictEqual(turns.length, 4);
  assert.strictEqual(turns[0].role, 'user');
  assert.strictEqual(turns[0].content, 'hello');
  assert.strictEqual(turns[1].content, 'I will check.');
  assert.strictEqual(turns[2].toolName, 'Bash');
  assert.deepStrictEqual(turns[2].toolInput, { command: 'pwd' });
  assert.strictEqual(turns[3].role, 'tool_result');
  assert.strictEqual(turns[3].toolName, 'Bash');
  assert.strictEqual(turns[3].content, '/tmp/project');
  assert.strictEqual(normalizeTimestamp(1_700_000_000), '2023-11-14T22:13:20.000Z');
  assert.strictEqual(normalizeTimestamp('not-a-date'), null);

  // Claude Code local slash commands are recorded as several user-side XML-like
  // bookkeeping messages. Harness should render only the command and a concise
  // status response.
  const compactInput = [
    JSON.stringify({ message: { role: 'user', content: '<local-command-caveat>Caveat: local command bookkeeping</local-command-caveat>' }, timestamp: '2026-08-17T15:00:00Z' }),
    JSON.stringify({ message: { role: 'user', content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>' }, timestamp: '2026-08-17T15:00:01Z' }),
    JSON.stringify({ message: { role: 'user', content: '<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>' }, timestamp: '2026-08-17T15:00:02Z' })
  ].join('\n');
  const compactTurns = parseJsonlText(compactInput);
  assert.strictEqual(compactTurns.length, 2);
  assert.strictEqual(compactTurns[0].role, 'user');
  assert.strictEqual(compactTurns[0].content, '/compact');
  assert.strictEqual(compactTurns[1].role, 'assistant');
  assert.strictEqual(compactTurns[1].content, 'Compacted');

  const fakeFile = path.join('/home/oxa/.claude/projects/-home-oxa', '635af72b-9007-4acf-a959-78748edd94f4.jsonl');
  const context = extractSessionContextText(input, fakeFile, '/fallback');
  assert.strictEqual(context.claudeSessionId, '635af72b-9007-4acf-a959-78748edd94f4');
  assert.strictEqual(context.projectPath, path.resolve('/home/oxa'));
  assert.strictEqual(context.projectName, 'oxa');
  assert.strictEqual(sessionIdFromPath(fakeFile), '635af72b-9007-4acf-a959-78748edd94f4');

  // Regression: Claude Code can keep transcripts centrally under a parent
  // ~/.claude/projects folder even when the real cwd is a nested project.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-harness-test-'));
  try {
    const nested = path.join(tempRoot, 'maati-app');
    const fallbackNested = path.join(tempRoot, 'fallback-project');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(fallbackNested, { recursive: true });

    const projectsRoot = path.join(tempRoot, '.claude', 'projects');
    fs.mkdirSync(projectsRoot, { recursive: true });

    const nestedStore = path.join(projectsRoot, claudeProjectKey(nested));
    fs.mkdirSync(nestedStore, { recursive: true });
    fs.writeFileSync(path.join(nestedStore, 'nested-session.jsonl'), [
      JSON.stringify({ sessionId: 'nested-session', cwd: nested, message: { role: 'user', content: 'nested hello' }, timestamp: '2026-08-17T10:00:00Z' }),
      JSON.stringify({ message: { role: 'assistant', content: 'nested reply' }, timestamp: '2026-08-17T10:01:00Z' })
    ].join('\n'));

    // Empty / metadata-only JSONL files are common after aborted starts and
    // must not create blank sidebar sessions.
    fs.writeFileSync(path.join(nestedStore, 'empty-session.jsonl'), [
      JSON.stringify({ sessionId: 'empty-session', cwd: nested, type: 'system', subtype: 'init', timestamp: '2026-08-17T10:02:00Z' })
    ].join('\n'));

    // Also verify the encoded project folder can map to an actually scanned
    // directory when older JSONL does not contain cwd.
    const fallbackStore = path.join(projectsRoot, claudeProjectKey(fallbackNested));
    fs.mkdirSync(fallbackStore, { recursive: true });
    fs.writeFileSync(path.join(fallbackStore, 'fallback-session.jsonl'), [
      JSON.stringify({ sessionId: 'fallback-session', message: { role: 'user', content: 'fallback hello' }, timestamp: '2026-08-17T09:00:00Z' })
    ].join('\n'));

    const scanner = createScanner();
    const workspaces = await scanner.findClaudeWorkspaces(tempRoot);
    const nestedWorkspace = workspaces.find((workspace) => path.resolve(workspace.path) === path.resolve(nested));
    const fallbackWorkspace = workspaces.find((workspace) => path.resolve(workspace.path) === path.resolve(fallbackNested));

    assert(nestedWorkspace, 'nested workspace should be created from transcript cwd');
    assert.strictEqual(nestedWorkspace.sessionCount, 1);
    assert.strictEqual(nestedWorkspace.sessions[0].claudeSessionId, 'nested-session');
    assert.strictEqual(nestedWorkspace.sessions[0].projectPath, path.resolve(nested));

    assert(fallbackWorkspace, 'fallback workspace should be resolved from Claude project folder key');
    assert.strictEqual(fallbackWorkspace.sessionCount, 1);
    assert.strictEqual(fallbackWorkspace.sessions[0].claudeSessionId, 'fallback-session');

    // Regression: Claude's transcript store can outlive a project directory.
    // An orphaned cwd must not create an unusable sidebar session.
    const deletedProject = path.join(tempRoot, 'deleted-project');
    const deletedStore = path.join(projectsRoot, claudeProjectKey(deletedProject));
    fs.mkdirSync(deletedStore, { recursive: true });
    fs.writeFileSync(path.join(deletedStore, 'orphan-session.jsonl'), [
      JSON.stringify({ sessionId: 'orphan-session', cwd: deletedProject, message: { role: 'user', content: 'old project prompt' }, timestamp: '2026-08-17T08:00:00Z' }),
      JSON.stringify({ message: { role: 'assistant', content: 'old project reply' }, timestamp: '2026-08-17T08:01:00Z' })
    ].join('\n'));

    const rescanned = await scanner.findClaudeWorkspaces(tempRoot);
    assert(!rescanned.some((workspace) => path.resolve(workspace.path) === path.resolve(deletedProject)), 'deleted project workspace must not be shown');
    assert(!rescanned.some((workspace) => (workspace.sessions || []).some((session) => session.claudeSessionId === 'orphan-session')), 'orphaned session must not be shown');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  // @file index: hide dot-directories/files, honor .gitignore and search by
  // basename/path prefix without leaking ignored files into suggestions.
  const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-harness-files-'));
  try {
    fs.mkdirSync(path.join(fileRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(fileRoot, '.venv'), { recursive: true });
    fs.mkdirSync(path.join(fileRoot, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(fileRoot, '.gitignore'), 'ignored/\n*.log\n');
    fs.mkdirSync(path.join(fileRoot, 'FarmerTools'), { recursive: true });
    fs.writeFileSync(path.join(fileRoot, 'index.html'), '<html>');
    fs.writeFileSync(path.join(fileRoot, 'FarmerRouter.js'), 'export default {}');
    fs.writeFileSync(path.join(fileRoot, 'RouterFarmer.py'), 'pass');
    fs.writeFileSync(path.join(fileRoot, 'README.md'), '# readme');
    fs.writeFileSync(path.join(fileRoot, 'src', 'index.js'), 'console.log(1)');
    fs.writeFileSync(path.join(fileRoot, 'src', 'internal.log'), 'ignored');
    fs.writeFileSync(path.join(fileRoot, '.venv', 'secret.py'), 'ignored');
    fs.writeFileSync(path.join(fileRoot, 'ignored', 'skip.js'), 'ignored');

    const fileIndex = listProjectFiles(fileRoot);
    const indexedPaths = fileIndex.files.map((file) => file.path);
    assert(indexedPaths.includes('index.html'));
    assert(indexedPaths.includes('src/index.js'));
    assert(!indexedPaths.includes('src/internal.log'));
    assert(!indexedPaths.some((value) => value.includes('.venv')));
    assert(!indexedPaths.some((value) => value.startsWith('ignored/')));
    assert(fileIndex.directories.some((entry) => entry.path === 'src'));

    const rootSuggestions = searchProjectFiles(fileIndex, '');
    assert(rootSuggestions.some((entry) => entry.type === 'folder' && entry.path === 'src'));
    assert(!rootSuggestions.some((entry) => entry.path === 'src/index.js'));

    const matches = searchProjectFiles(fileIndex, 'ind');
    assert(matches.some((file) => file.path === 'index.html'));
    assert(matches.some((file) => file.path === 'src/index.js'));

    const farmerMatches = searchProjectFiles(fileIndex, 'Farmer');
    assert.strictEqual(farmerMatches[0].type, 'folder');
    const farmerRouterIndex = farmerMatches.findIndex((entry) => entry.name === 'FarmerRouter.js');
    const routerFarmerIndex = farmerMatches.findIndex((entry) => entry.name === 'RouterFarmer.py');
    assert(farmerRouterIndex >= 0 && routerFarmerIndex >= 0 && farmerRouterIndex < routerFarmerIndex);

    const srcSuggestions = searchProjectFiles(fileIndex, 'src/');
    assert(srcSuggestions.some((entry) => entry.path === 'src/index.js'));
    assert(!srcSuggestions.some((entry) => entry.path === 'index.html'));

    const absoluteSuggestions = searchProjectFiles(fileIndex, `${fileRoot.replace(/\\/g, '/')}/Farm`);
    assert(absoluteSuggestions.some((entry) => entry.path.endsWith('/FarmerRouter.js')));

    const noMatches = searchProjectFiles(fileIndex, 'definitely-no-such-file-xyz');
    assert.deepStrictEqual(noMatches, []);
  } finally {
    fs.rmSync(fileRoot, { recursive: true, force: true });
  }

  console.log('parser/scanner/file-index tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
