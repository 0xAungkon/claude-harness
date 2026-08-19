# Changelog

## v4.0 — persistent drafts, resizable composer, session notepad

- The prompt composer is vertically resizable. Its height is remembered across sessions in the browser.
- Unsent prompt text is now persisted per Claude session. Switching sessions gives each session its own draft; returning restores it. Drafts are saved to the Harness server with last-write-wins semantics so a browser restart or another device can restore the latest saved text.
- New-session drafts are stored separately per workspace until the first prompt is sent.
- Added a **session notepad** as a right sidebar. It is collapsed by default, opens from the top-right panel icon, and toggles with **Ctrl/Cmd+Shift+B**.
- The notepad is resizable on desktop and becomes a touch-friendly slide-over panel on mobile. Its width is remembered locally.
- Notes are WYSIWYG text-only (bold, italic, underline, headings, lists, quotes, clear formatting). Image/media pastes are excluded.
- Notes are persisted per session on the Harness server with the same cross-browser/device last-write-wins behavior as prompt drafts.
- Server-side draft/note state is stored in `~/.claude-harness/ui-state.json`.

## v3.9 — configurable discovery, settings page, external @ paths

- **Settings is now a first-class page** at `/app/settings` rather than a modal. It uses the same application shell as conversations and remains responsive on mobile.
- Settings is organized into tabs, beginning with **General**. The page has a sticky **Save / Discard** action bar so changes are explicit.
- **Workspace discovery is configurable** with any number of rules. Each rule can be:
  - a specific folder such as `/home/joy/project1`
  - a folder plus a per-rule recursive depth (`0` means only that exact workspace)
  - a regular expression matched against absolute workspace paths, such as `^/home/joy/(project1|project2)$`
- Saving discovery settings persists them in `~/.claude-harness/settings.json`, rescans Claude transcripts, and refreshes the sidebar immediately. A separate **Rescan** action reruns the currently saved rules at any time.
- Central Claude transcript storage is still inspected, but sessions are surfaced only when their real workspace path matches the configured rules and the project folder still exists.
- The `@` picker can now browse **outside the active workspace** with absolute or home-relative paths. Examples: `@/home/joy/project1/`, `~/project1/`, and partial names inside those directories. Hidden files and `.gitignore` rules remain excluded.
- **Bypass permissions** now launches Claude with its dedicated bypass CLI mode and does not register Harness approval hooks for normal permission boundaries. Human-input requests such as `AskUserQuestion` remain interactive because they require an answer rather than permission.

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

## v3.5 UI revisions

- Long unbroken user text (tokens, hashes, JWTs, URLs) wraps inside the user message bubble instead of overflowing.
- Trajectory rows expand on click/Enter to show the full event/message in a scrollable panel, with a Collapse button.
- Click the session title in the header to rename it inline; blur or Enter saves, Escape cancels.
- `@` suggestions now behave like a filesystem-aware picker: bare `@` lists only direct workspace children, path queries browse only that folder, and plain-name queries search recursively with close matches ranked first.
- Folder matches are ranked before files. Clicking a folder drills into it; clicking a file inserts the file reference.
- File suggestions use distinct icons for folders, JavaScript/TypeScript, Python, Markdown, text/config files, images, and generic files. Hidden entries and `.gitignore` exclusions remain filtered.

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

## v3.2 — persistent background runs

Claude execution is now owned by the Harness server rather than by the browser tab.

- Switching to another session does **not** stop the active Claude task.
- Closing the browser does **not** stop the active Claude task as long as the Harness process remains running.
- Queued prompts are stored server-side in `~/.claude-harness/runtime-state.json`.
- Queue state is synced to every connected browser/device.
- Queued prompts can be edited, deleted, paused/resumed and reordered from any connected client.
- If Harness itself is restarted while a prompt is active, that prompt is restored to the queue in a **paused** state instead of being silently lost, so you can review it before rerunning possible side effects.
- New sessions are exposed as temporary sidebar sessions while their first Claude turn is still running, so another device can see their current state before the transcript has finished.
