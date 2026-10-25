# Shelf

A desktop terminal where the prompt is a normal text box, and every command
you run opens its own docked pane containing only that command's output. Panes
can be rearranged, maximized, moved between tabs, hidden and re-run. Each pane is a real terminal
(its own PTY), so full-screen programs such as Claude Code, vim or htop work
inside a pane.

## Run it

```bash
npm install
npm start                  # opens the app in your home directory
npx electron . ~/code      # or start somewhere else
```

Build an installable app (output goes to `dist/`):

```bash
npm run dist:mac           # .dmg + .zip
npm run dist:linux         # .AppImage + .deb
```

Requirements: Node 18+ on macOS or Linux, plus `python3`.

`npm install` compiles `node-pty` for Electron, which needs a C++ toolchain
(Xcode Command Line Tools on macOS, `build-essential` on Debian/Ubuntu). If
that step fails, the install still succeeds and Shelf uses its built-in
Python terminal bridge (`ptybridge.py`), which behaves the same way. You can
retry the native build later with `npx electron-rebuild -f -o node-pty`.

### Browser mode

The same UI also runs in a browser: `npm run web`, then open
http://127.0.0.1:7777 (set `PORT=…` to change it).

## Using it

Shelf is modal, like vim. The badge at the right of the prompt shows the
current mode; press `?` in view mode for every shortcut.

- **Prompt** — type commands. `Enter` runs, `Ctrl+Enter` runs and types into
  the new terminal, `Tab` completes, `↑` `↓` history. `Esc` → view mode.
- **View** — keys never reach programs. Arrow keys move between terminals,
  `i` types into the selected one, `Esc` closes it, `m` maximizes, `k` kills,
  `c` sends Ctrl+C, `r` re-runs. Select text with the mouse and `Ctrl+C` copies.
  `t` new tab, `1`–`9` switch tabs, `Shift+1`–`9` move the terminal to a tab.
- **Insert** — every key goes to the selected terminal. `Esc` returns to view
  mode; `Shift+Esc` sends a real Esc to the program (vim, less…).
- `Ctrl+`` ` jumps back to the prompt from anywhere.

Layout:

- **Docking.** The first terminal fills the window, and each new one docks
  below the last one. Drag a header onto another terminal's edge, a window
  edge, or a tab to move it. Drag the gaps to resize.
- **Closed list.** Closing a terminal hides it in the list on the left (`b`
  toggles it). It keeps running; click it or press `u` to bring it back, or
  `X` to kill and remove it for good.
- **Tabs.** Each tab has its own working directory and environment: a `cd` in
  one tab doesn't affect the others. New tabs start where the current one is.
- **Windows.** `⌘N` / `Ctrl+Shift+N` opens a new window, which is its own shell
  session. Closing a window with commands still running asks first. Links in
  output open in your browser.

On Linux every app shortcut uses `Ctrl+Shift`, so plain `Ctrl` keys always
reach the program in insert mode.

## How it works

```
renderer (ui/, Svelte)             main process (main.js + core.js)
prompt ──── run {cmd} ───────────▶ new PTY per command:
pane (xterm.js) ◀──── output ────  bash -c '<cmd>' in the session cwd/env
pane keystrokes ── input/resize ─▶ same PTY
                ◀── exit {code} ── records final cwd + exported env
```

- `ui/` is the Svelte renderer, built by Vite into `public/` (`npm start` and
  `npm run web` build it first).
- `core.js` holds everything shell-related: sessions, PTYs, carrying state
  between commands (per UI tab), tab completion.
- `main.js` is the Electron app: windows, menus, and the `app://` protocol
  that serves the UI. It talks to the page over IPC through `preload.js`, which
  exposes only a send/receive message bridge (context isolation and sandbox
  on, no Node in the page). There is no local server or open port.
- `server.js` is the browser-mode equivalent over a WebSocket.

Commands run in separate processes, so the session carries state between
them: after each command it records the working directory and the exported
environment, and the next command starts from there. `cd` and `export` behave
as you'd expect. A slow command that finishes later never undoes a `cd` or
`export` you made while it was running.

When launched from the Dock or an app launcher, Shelf reads your login
shell's environment once at startup, so `PATH` includes Homebrew, nvm,
`~/.local/bin` and so on.

Not carried over: shell aliases, functions and unexported variables (each
command is a fresh `bash`). Commands use bash syntax regardless of your login
shell.

## Security

Desktop: the page has no Node access, only accepts its own `app://` content,
never navigates away, and denies permission requests other than clipboard writes. Browser mode: the server
listens on 127.0.0.1 only and rejects WebSocket connections from other web
pages. Either way it is a shell with your user's permissions.
