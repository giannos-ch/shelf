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

Keys go to one place at a time: the prompt at the bottom, or one terminal.
App shortcuts only use Ctrl keys that terminal programs can't receive or
barely use, so everything else (Esc, Tab, Alt keys, Ctrl+R, Ctrl+W…) reaches
the program. `F1` lists every shortcut.

- **Prompt** — type commands. `Enter` runs and focuses the new terminal,
  `Ctrl+Enter` runs and stays in the prompt, `Tab` completes, `↑` `↓` history.
- **Terminals** — click one, or use `Ctrl+←↑→↓`, to type into it (`Ctrl+↓`
  from the bottom one returns to the prompt, `Ctrl+↑` from the prompt goes
  back). ``Ctrl+` `` toggles between the prompt and the last terminal,
  `Ctrl+Tab` returns to the previous one. `Ctrl+M` maximizes, `Ctrl+Q` closes,
  `Ctrl+.` runs again. These act on the focused terminal, or on the last one
  (faintly outlined) while the prompt has focus.
- **Copy and paste** — select output with the mouse and `Ctrl+C` copies it;
  with nothing selected, `Ctrl+C` interrupts as usual. `Ctrl+V` pastes text
  (with an image on the clipboard the program gets `^V`, so Claude Code can
  paste it). `Ctrl+Z` is ignored: commands run without job control, so a
  suspended one could never come back. `Shift+PgUp` / `Shift+PgDn` scroll.
- **Finished terminals** show their own prompt: type there and `Enter` runs
  the command in that terminal (replacing its output), starting where the last
  one ended. `Esc` clears it, then returns to the main prompt.
- **Command layer** — `Ctrl+;` then one key: arrows swap terminals,
  `Shift`+arrows resize, `=` equalizes (these repeat until another key),
  `t` / `w` new / close tab, `1`–`9` move the terminal to a tab, `k` kills,
  `u` reopens, `b` opens the closed list, `p` pins, `l` closes finished
  terminals, `n` opens a new window. A bar lists the keys while it's open.
- **Tabs** — `Ctrl+PgUp` / `Ctrl+PgDn` or `Ctrl+1`–`9`.

Layout:

- **Docking.** The first terminal fills the window, and each new one docks
  below the last one. Drag a header onto another terminal's edge, a window
  edge, or a tab to move it. Drag the gaps to resize.
- **Closed list.** Closing a terminal hides it in the list on the left
  (`Ctrl+;` `b`). It keeps running; click it or press `Enter` there (or
  `Ctrl+;` `u`) to bring it back, or `X` to kill and remove it for good.
- **Tabs.** Each tab has its own working directory and environment: a `cd` in
  one tab doesn't affect the others. New tabs start where the current one is.
- **Windows.** `Ctrl+;` `n` (`⌘N` on macOS) opens a new window, which is its
  own shell session. Closing a window with commands still running asks first.
  Links in output open in your browser.

## Opening files

File paths in output are underlined when you hover them, as long as the file
exists: `src/app.js:42:7` (gcc, tsc, eslint, `grep -n`, ripgrep, Go, Rust,
pytest), `src/app.ts(42,7)`, Python's `File "x.py", line 42`, Node stack
frames, and plain paths. `Ctrl+click` opens the file at that line in your
editor; a directory becomes the tab's directory, like `cd`. `Ctrl+;` `o`
labels every link in the terminal, so you can open one by typing its label.

The editor is the first of:

1. `SHELF_EDITOR`, a template with `{file}`, `{line}` and `{col}`:
   `export SHELF_EDITOR='code -g {file}:{line}:{col}'` or
   `export SHELF_EDITOR='nvim +{line} {file}'`
2. `$VISUAL`, then `$EDITOR` (vim, nvim, nano, micro, emacs, hx, kak, code,
   cursor, subl and zed get the right line syntax)
3. `code`, if it's on your `PATH`
4. `xdg-open` (`open` on macOS), which also opens binary files such as images
   and PDFs whatever the editor setting.

Terminal editors (vim, nano, hx, `emacs -nw`…) open in a new pane; GUI editors
open in their own window.

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
