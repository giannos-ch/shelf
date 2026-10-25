# Shelf

A desktop terminal where the prompt is a normal text box, and every command
you run opens its own pane containing only that command's output. Panes can be
moved, resized, minimized, maximized and re-run. Each pane is a real terminal
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

| | |
|---|---|
| `Enter` / `Shift+Enter` | run / new line in the prompt |
| `Tab` | complete commands and paths (pick from the list if several match) |
| `↑` `↓` | command history |
| click a pane | type into the program running in it |
| `Ctrl+`` ` | jump back to the prompt from anywhere |
| `clear` or `Ctrl+L` | close all finished panes |
| `⌘N` / `Ctrl+Shift+N` | new window (starts in the current folder) |
| `⌘=` `⌘-` `⌘0` / `Ctrl+Shift+= - 0` | zoom in, out, reset |

On Linux every app shortcut uses `Ctrl+Shift`, so plain `Ctrl` keys (`Ctrl+C`,
`Ctrl+W`, `Ctrl+R`…) always reach the program running in a pane.

- **Layout.** New panes flow into columns, oldest first, and the window
  scrolls like a notebook. A finished pane shrinks to fit its output.
- **Moving.** Drag a header to take a pane out of the flow and put it anywhere;
  the rest close the gap. **Arrange** puts everything back into the flow.
- **Pane buttons:** ↻ re-run (in the directory it originally ran in),
  ▁ minimize to the dock above the prompt, ▢ maximize (or double-click the
  header), ✕ close (stops the command if it is still running).
- **Full-screen programs.** Anything that switches to the terminal's
  alternate screen (vim, htop, less…) is maximized and given the keyboard
  automatically, and restored when it exits. Programs that draw inline, such as
  `claude`, `python` or `ssh`, are recognised by name: see `INTERACTIVE` at the
  top of `public/app.js` to add your own.
- **Windows.** Each window is its own shell session. Closing a window with
  commands still running asks first. Links in output open in your browser.

## How it works

```
renderer (public/)                 main process (main.js + core.js)
prompt ──── run {cmd} ───────────▶ new PTY per command:
pane (xterm.js) ◀──── output ────  bash -c '<cmd>' in the session cwd/env
pane keystrokes ── input/resize ─▶ same PTY
                ◀── exit {code} ── records final cwd + exported env
```

- `core.js` holds everything shell-related: sessions, PTYs, carrying state
  between commands, tab completion.
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
never navigates away, and denies permission requests. Browser mode: the server
listens on 127.0.0.1 only and rejects WebSocket connections from other web
pages. Either way it is a shell with your user's permissions.
