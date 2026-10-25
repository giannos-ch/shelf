# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                # also rebuilds node-pty for Electron (postinstall); failure is non-fatal
npm start                  # builds ui/, then the Electron app in $HOME (or: npx electron . <dir>)
npm run web                # builds ui/, then browser mode at http://127.0.0.1:7777 (PORT=, HOST= to change)
npm run dev                # vite build --watch (rebuild public/ on change; reload the page)
npm run check              # node assert script for the docking layout tree (ui/layout.js)
npm run dist:linux         # / dist:mac — electron-builder output in dist/
npx electron-rebuild -f -o node-pty   # retry the native PTY build
```

The UI is Svelte 5 in `ui/`, built by Vite into `public/` (gitignored build output, served by `resolveAsset`). xterm is bundled from npm. There is no test suite beyond `npm run check`. `npm run web` is the quickest way to exercise changes.

## Architecture

Shelf is a terminal where the prompt is a text box and each command runs in its own PTY, shown in its own xterm.js pane.

- **`core.js`** — all shell logic, shared by both front-ends. `Session` takes client messages via `handle(msg)` and emits `'message'` events back. Message types in: `hello`, `tab-open`, `tab-close`, `run`, `input`, `resize`, `kill`, `complete`. Out: `state`, `started`, `data`, `exit`, `completions`. Each UI tab has its own cwd/env (`stateFor(tab)`, cloned from the base state or the `from` tab); `run`/`complete`/`state` carry `tab`. Also hosts tab completion (bash `compgen`) and static-asset resolution (`resolveAsset`).
- **`main.js`** — Electron: one `Session` per window (keyed by `webContents.id`), IPC channel `shelf:send` / `shelf:msg`, UI served via a custom `app://` protocol (no HTTP server). `preload.js` exposes only `window.shelf.{send,onMessage,platform}`; context isolation + sandbox are on.
- **`server.js`** — browser mode: same `Session` over a WebSocket; all tabs share one cwd/env `state`; rejects foreign `Origin`s.
- **`ui/`** — the renderer.
  - `conn.js` picks the Electron bridge (`window.shelf`) or a WebSocket.
  - `store.svelte.js` holds all `$state` (tabs, panes, mode) and the actions; xterm instances live in a plain `terms` Map, never in `$state`.
  - `layout.js` is the pure docking tree (`{pane}` leaves, `{dir, children, sizes}` splits) → rects, neighbors, drop targets.
  - `keys.js` holds the `SHORTCUTS` table; it drives both the capture-phase keydown handler and the help overlay, so add shortcuts there.
  - Panes render as one flat keyed list, absolutely positioned from the tree's rects, so xterm never remounts when the layout changes.
  - Modes: prompt / view (keys never reach programs) / insert (keys go to the selected pane; `Esc` leaves, `Shift+Esc` sends Esc).
  - No per-command special cases, except a bare `cd <dir>` which just changes the tab's cwd (`Session.cd`); anything fancier, or a failing cd, runs in a pane.

### State carry-over between commands

Each command runs as `bash --noprofile --norc -c WRAPPER` with the command in `__TP_CMD`. An `EXIT` trap writes `pwd` and the env (dumped as JSON by the Electron binary run with `ELECTRON_RUN_AS_NODE`) to temp files; `applyChanges` then merges only what *that* command changed and only where state hasn't been changed by another command meanwhile — so a slow command finishing late can't undo a later `cd`/`export`. Aliases, functions and unexported vars are not carried. `__TP_*` vars are internal and filtered out.

### PTY backends

`spawnPty` returns a uniform `{onData,onExit,write,resize,kill}` wrapper over either `node-pty` (optional dependency) or `ptybridge.py` (python3 fallback; resize goes over fd 3). Keep both paths working when changing PTY behavior. In packaged builds, files run by external programs must be resolved via `unpacked()` (`app.asar.unpacked`) and listed in `build.asarUnpack`; new runtime files must also be added to `build.files` in `package.json`.

### Platform note

On Linux all app shortcuts use `Ctrl+Shift` so plain `Ctrl` keys reach the program in a pane — preserve this when adding shortcuts.
