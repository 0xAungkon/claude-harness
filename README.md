# Claude Harness

> **⚠️ Under active development** — APIs, features, and UI may change without notice. Not yet considered stable for production use.

Claude Harness is a local/self-hosted React + Vite + Tailwind UI for browsing and continuing Claude Code sessions. The production build embeds the complete frontend into the Node entry point so `pkg` can create a single executable per platform.

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Reconnectable WebSocket

Live state now uses a reconnectable WebSocket at:

```text
/ws
```

The socket carries:

- active/running session state
- prompt queues
- queue edits/reordering
- permission requests
- permission responses
- workspace/session refresh events
- completed-session notifications

The frontend reconnects automatically with exponential backoff and receives a complete state snapshot after reconnecting. HTTP endpoints remain as a fallback for queue mutations and initial data loading.

## Cross-session permission requests

Permission requests are global to the Harness instance rather than tied to the tab you are currently viewing.

If Claude is working in **Session A** while you are viewing **Session B**:

- the permission request appears above the current composer
- the request identifies the source session/workspace
- the source session receives a yellow attention background in the sidebar
- a notification sound is played when the request arrives
- you can approve it without navigating back to Session A

Permission actions remain:

- **Deny**
- **Always allow**
- **Allow once**

The editable **Always allow rule** is still supported, e.g. changing:

```text
curl https://api.ipify.org
```

to:

```text
curl *
```

before choosing **Always allow**.

## Optional authentication

Authentication is disabled by default.

To require login, define both environment variables before starting Harness:

### Linux / macOS

```bash
export CH_USER="admin"
export CH_PASSWORD="change-this-password"
npm run dev
```

or for production:

```bash
CH_USER="admin" CH_PASSWORD="change-this-password" npm start
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

If neither variable is defined, Harness requires no login. If only one is defined, Harness refuses to start to avoid an accidental partial authentication configuration.

The login cookie is HttpOnly and SameSite=Strict. `CH_USER` and `CH_PASSWORD` are removed from the environment passed to Claude Code subprocesses, so Claude/tools do not receive the Harness portal credentials.

## Access from another device

Harness binds to `127.0.0.1` by default for safety. To access it from another device on your LAN, bind to all interfaces:

```bash
CH_USER="admin" CH_PASSWORD="change-this-password" npm start -- --host 0.0.0.0
```

or in development:

```bash
CH_USER="admin" CH_PASSWORD="change-this-password" npm run dev -- --host 0.0.0.0
```

Then open from another device using the computer running Harness:

```text
http://<computer-lan-ip>:3030
```

You can also set:

```bash
export CH_HOST=0.0.0.0
```

**Use authentication whenever exposing Harness beyond localhost.** For access across the public internet, place it behind a trusted HTTPS reverse proxy/VPN rather than exposing port 3030 directly.

## Development

Requirements:

- Node.js 18+
- npm
- Claude Code installed locally and available as `claude`

Install dependencies:

```bash
npm install
```

Run the real Vite development environment:

```bash
npm run dev
```

This does **not** perform a production build. Express + the API + Vite middleware + Vite HMR share the same HTTP server:

```text
http://localhost:3030
```

Use without automatically opening a browser:

```bash
npm run dev:no-open
```

## Production source run

Build the React/Tailwind frontend and embed it into the Node module:

```bash
npm run build
```

Then serve the already-built production UI:

```bash
npm start
```

`npm start` does not rebuild the frontend.

## Single binaries

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

## CLI

```text
claude-harness [--root <path>] [--host <host>] [--port <n>] [--no-open]
```

Options:

- `--root <path>` — scan root, default `$HOME`
- `--host <host>` — bind address, default `127.0.0.1`
- `--port <n>` — HTTP/WebSocket port, default `3030`
- `--no-open` — don't automatically open the browser

`CH_HOST` can also set the default bind host.

## Existing UI features

- light mode by default; light/dark theme toggle
- responsive mobile-app layout
- workspace/session list sidebar
- resizable desktop sidebar
- right-click workspace/session context menus
- session rename/delete
- `Ctrl/Cmd+B` toggle sidebar
- `Ctrl/Cmd+M` focus active sidebar item
- `Ctrl/Cmd+N` new session in current workspace
- arrow-key sidebar navigation, Enter to open, D/Delete/Backspace to initiate session deletion
- Chat, Trajectory and visual Stats views
- compact `Thinking…` tool disclosure
- automatic scroll to newest conversation content
- server-backed permission approval UI
- model and permission-mode selectors
- `/init`, `/compact`, `/rewind`, `/btw`, `/fork-session`, `/new`, `/context`, `/skills`, `/plugins`, `/mcp`, `/plugin-reload`, `/export`, `/add-dir`, `/model`
- slash command autocomplete
- `@file` suggestions that exclude hidden content and respect `.gitignore`
- recursive Claude workspace/session discovery
- `/compact` transcript normalization

## Persistent Harness state

Harness stores its own state under:

```text
~/.claude-harness/
```

including:

```text
runtime-state.json      background jobs and queued prompts
session-names.json      UI session rename overrides
permission-rules.json   Harness fallback always-allow rules
```

Claude's original JSONL transcripts remain in Claude Code's normal storage.

## Safety

**Bypass permission** intentionally disables normal Claude Code permission checks. Use it only when you understand the consequences for the selected workspace.

## Keyboard shortcuts cheatsheet

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+B` | Toggle sidebar |
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

# claude-harness
