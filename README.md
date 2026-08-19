# Claude Harness v3.8

Claude Harness is a local/self-hosted React + Vite + Tailwind UI for browsing and continuing Claude Code sessions. The production build embeds the complete frontend into the Node entry point so `pkg` can create a single executable per platform.

## v3.8 — live first turn, stable session handoff, completion sounds

- A brand-new session now promotes its first prompt directly to the active runtime instead of briefly presenting it as a queued follow-up. The chat immediately shows the sent user bubble followed by **Claude is writing**.
- Temporary `/app/session/runtime:<id>` routes now resolve by Claude session ID while the transcript is materializing. When the transcript becomes available the URL is canonically replaced with `/app/session/<session-id>` without dropping back to the new-session screen.
- The `session-updated` WebSocket handoff now preserves the visible session even during workspace refresh races and restores the correct owning workspace.
- Permission requests keep their existing notification sound. A separate completion chime now plays whenever a running Claude turn completes successfully, including tasks that finish while another session is open.
- Audio is primed after the first pointer/keyboard interaction so notification sounds can continue to work for background session events subject to browser autoplay policy.



## v3.7 — stale-session filtering and stable @ empty state

- Sessions whose recorded project directory no longer exists are excluded from the sidebar, so moved/deleted projects do not leave unusable transcript entries behind.
- The `@` file/folder suggestion popover now stays visible and displays **No match found** when the active query has no results instead of flashing and disappearing.

## v3.6 — responsive composer controls and message workflow

- Delete confirmation is fully keyboard-operable: **Left/Right** switches between Cancel/Delete, **Enter** activates the selected action, and **Esc** cancels.
- Metadata-only or otherwise empty Claude transcripts are omitted from the sidebar.
- The composer keeps its draft state locally so typing no longer rerenders the full conversation; ordinary prompts also avoid the mirrored highlighting layer unless an `@` mention is present.
- While Claude is working, an empty composer shows a **Stop** button. Typing a new prompt replaces it with **Send**; Enter adds that prompt to the persistent server queue without interrupting the active task.
- `/rewind` is available in slash autocomplete and is delegated to Claude Code's checkpoint command path.
- `/btw <question>` runs as a side question while the main task continues. Harness keeps the answer in a separate side-question card rather than adding it to the main chat history.
- Prompt history behaves like a terminal: **Up** on the first line recalls older prompts/commands, **Down** on the last line moves forward, and the unfinished draft is restored after the newest history item.
- Every Claude response has compact **Copy** and **Fork** actions. Forking from a response creates a transcript branch at that response rather than only at the live tip.

## v3.5 — visual Stats and extension management

The session header now has **Chat**, **Trajectory**, and **Stats**. Stats is a responsive dashboard rather than terminal-formatted `/context` or `/config` output. It includes:

- current context-window percentage and token capacity
- current input/cache/output composition
- all-time transcript token totals
- session count, active days, longest session and streaks
- activity heatmap
- model-usage bars
- current Claude Code version/session/workspace metadata when available
- quick access to Skills, Plugins and MCP management

Harness captures Claude Code status-line JSON when supported and also falls back to JSON response/transcript usage metadata. The small circular context meter beside the send button uses the same session metrics.

New web-native slash commands:

- `/context` — open the Stats dashboard
- `/skills` — manage project/user skills
- `/plugins` — discover/install/enable/disable/update/remove plugins and manage marketplaces
- `/mcp` — inspect MCP health and add/remove HTTP or stdio servers
- `/plugin-reload` — queues Claude Code's `/reload-plugins` command
- `/export` — download the full conversation as Markdown
- `/new` — create a new session in the current workspace

The existing `/init`, `/compact`, `/fork-session`, `/add-dir` and `/model` commands remain available.

Sidebar keyboard navigation also accepts **D** on a focused session item to open the delete confirmation, in addition to Delete/Backspace.

## v3.2 — persistent background runs

Claude execution is now owned by the Harness server rather than by the browser tab.

- Switching to another session does **not** stop the active Claude task.
- Closing the browser does **not** stop the active Claude task as long as the Harness process remains running.
- Queued prompts are stored server-side in `~/.claude-harness/runtime-state.json`.
- Queue state is synced to every connected browser/device.
- Queued prompts can be edited, deleted, paused/resumed and reordered from any connected client.
- If Harness itself is restarted while a prompt is active, that prompt is restored to the queue in a **paused** state instead of being silently lost, so you can review it before rerunning possible side effects.
- New sessions are exposed as temporary sidebar sessions while their first Claude turn is still running, so another device can see their current state before the transcript has finished.

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

## v3.3 UI navigation changes

- Sidebar is list-only; the tree view has been removed.
- Workspaces with no sessions are hidden from the sidebar.
- Sidebar action dots are removed. Right-click a workspace or session to open its context menu.
- Session context menu includes **Fork session**, Rename, Copy path, and Delete.
- Login inputs include username/password placeholders.
- Browser URLs now reflect the active page:
  - `/login`
  - `/app`
  - `/app/session/<session_id>`
- Deep links to session URLs reopen the matching session after authentication/workspace discovery.


## v3.5 UI revisions

- Long unbroken user text (tokens, hashes, JWTs, URLs) wraps inside the user message bubble instead of overflowing.
- Trajectory rows expand on click/Enter to show the full event/message in a scrollable panel, with a Collapse button.
- Click the session title in the header to rename it inline; blur or Enter saves, Escape cancels.
- `@` suggestions now behave like a filesystem-aware picker: bare `@` lists only direct workspace children, path queries browse only that folder, and plain-name queries search recursively with close matches ranked first.
- Folder matches are ranked before files. Clicking a folder drills into it; clicking a file inserts the file reference.
- File suggestions use distinct icons for folders, JavaScript/TypeScript, Python, Markdown, text/config files, images, and generic files. Hidden entries and `.gitignore` exclusions remain filtered.
# claude-harness
