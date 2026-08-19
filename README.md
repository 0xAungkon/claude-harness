# Claude Harness

> **⚠️ Under active development** — APIs, features, and UI may change without notice. Not yet considered stable for production use.

Claude Harness is a local/self-hosted React + Vite + Tailwind UI for browsing and continuing Claude Code sessions. The production build embeds the complete frontend into the Node entry point so `pkg` can create a single executable per platform.

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Features

- light/dark theme toggle with responsive mobile-app layout
- workspace/session list sidebar with resizable desktop support
- right-click context menus for workspaces and sessions
- session rename/delete with inline editing
- Chat, Trajectory and visual Stats views
- compact `Thinking…` tool disclosure
- server-backed permission approval UI with cross-session support
- model and permission-mode selectors
- `@file` suggestions that exclude hidden content and respect `.gitignore`
- slash command autocomplete
- recursive Claude workspace/session discovery

### Reconnectable WebSocket

Live state uses a reconnectable WebSocket at `/ws` carrying:

- active/running session state
- prompt queues and queue edits/reordering
- permission requests and responses
- workspace/session refresh events
- completed-session notifications

The frontend reconnects automatically with exponential backoff and receives a complete state snapshot after reconnecting. HTTP endpoints remain as a fallback for queue mutations and initial data loading.

### Cross-session permission requests

Permission requests are global to the Harness instance rather than tied to the current tab. If Claude is working in **Session A** while you view **Session B**, the permission request appears above your current composer, identifies the source session/workspace, highlights it in the sidebar, and plays a notification sound — all without navigating away.

## How to run

### Requirements

- Node.js 18+
- npm
- Claude Code installed locally and available as `claude`

### Install dependencies

```bash
npm install
```

### Development

```bash
npm run dev
```

This runs the Vite development server with HMR at `http://localhost:3030`. Browser auto-open is disabled by default; use `npm run dev:open` or `npm run dev -- --open` to open it explicitly.

### Production

Build the frontend and start the server:

```bash
npm run build
npm start
```

`npm start` does not rebuild — it serves the already-built production UI. Use `npm run start:open` or `npm start -- --open` to open the browser automatically.

### CLI options

```text
claude-harness [--root <path>] [--host <host>] [--port <n>] [--no-open]
```

| Option | Description | Default |
|---|---|---|
| `--root <path>` | Scan root directory | `$HOME` |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--port <n>` | HTTP/WebSocket port | `3030` |
| `--no-open` | Don't auto-open browser | — |

`CH_HOST` can also set the default bind host.

### Access from another device

Harness binds to `127.0.0.1` by default. To access it from another device on your LAN, bind to all interfaces:

```bash
npm start -- --host 0.0.0.0
```

Then open `http://<computer-lan-ip>:3030` from the other device.

**Use authentication whenever exposing Harness beyond localhost.** For public internet access, place it behind a trusted HTTPS reverse proxy/VPN.

## Optional authentication

Authentication is disabled by default. To require login, set both environment variables before starting Harness:

### Linux / macOS

```bash
export CH_USER="admin"
export CH_PASSWORD="change-this-password"
npm start
```

### Windows Command Prompt

```bat
set CH_USER=admin
set CH_PASSWORD=change-this-password
npm start
```

### PowerShell

```powershell
$env:CH_USER = "admin"
$env:CH_PASSWORD = "change-this-password"
npm start
```

If neither variable is defined, Harness requires no login. If only one is defined, Harness refuses to start to avoid an accidental partial configuration.

The login cookie is HttpOnly and SameSite=Strict. `CH_USER` and `CH_PASSWORD` are removed from the environment passed to Claude Code subprocesses.

## Keyboard shortcuts cheatsheet

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+B` | Toggle sidebar |
| `Ctrl/Cmd+Shift+B` | Toggle session notepad (right sidebar) |
| `Ctrl/Cmd+M` | Focus active sidebar item |
| `Ctrl/Cmd+N` | New session in current workspace |
| `↑` / `↓` | Navigate sidebar items / prompt history |
| `Enter` | Open focused session / send prompt |
| `D` | Delete focused session (sidebar) |
| `Delete` / `Backspace` | Delete focused session (sidebar) |
| `←` / `→` | Switch Cancel/Delete in confirmation dialog |
| `Esc` | Cancel dialog / close popover |

### Slash commands

Type `/` in the composer to see available commands:

| Command | Description |
|---|---|
| `/init` | Initialize a project |
| `/compact` | Compact/normalize the transcript |
| `/rewind` | Rewind to a checkpoint |
| `/btw <question>` | Ask a side question without interrupting the main task |
| `/fork-session` | Fork the current session |
| `/new` | Create a new session |
| `/context` | Open the Stats dashboard |
| `/skills` | Manage project/user skills |
| `/plugins` | Discover and manage plugins |
| `/mcp` | Inspect MCP health and manage servers |
| `/plugin-reload` | Reload plugins |
| `/export` | Download conversation as Markdown |
| `/add-dir` | Add a directory to the workspace |
| `/model` | Switch the active model |

## Development

### Single binaries

Build all configured `pkg` targets:

```bash
npm run binary
```

or:

```bash
./build.sh
```

Windows:

```bat
build.bat
```

Configured targets:

- `node18-macos-x64`
- `node18-linux-x64`
- `node18-win-x64`

The final executable contains the production web UI and backend server. No React files, Vite server, Tailwind files, HTML files or `node_modules` directory are required next to the executable.

Claude Harness still invokes the locally installed `claude` executable for live Claude Code runs.

## Persistent state

Harness stores its own state under `~/.claude-harness/`:

```text
runtime-state.json      background jobs and queued prompts
session-names.json      UI session rename overrides
permission-rules.json   Harness fallback always-allow rules
ui-state.json           prompt drafts and session notepad notes
settings.json           workspace discovery rules
```

Claude's original JSONL transcripts remain in Claude Code's normal storage.

## Safety

**Bypass permission** intentionally disables normal Claude Code permission checks. Use it only when you understand the consequences for the selected workspace.
