'use strict';
// shelf core: sessions where every command runs in its own PTY, with the
// working directory and exported environment carried from one command to the
// next. Used by both the Electron main process (main.js) and the browser
// server (server.js); they only differ in how messages reach the UI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const SHELL = '/bin/bash';

// ---------------------------------------------------------------- PTY layer
let nodePty = null;
try { nodePty = require('node-pty'); } catch { /* fall back to the python bridge */ }
const ptyBackend = nodePty ? 'node-pty' : 'python';

// Inside a packaged Electron app, files that external programs must read live
// next to the archive in app.asar.unpacked.
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

function spawnPty(file, args, { cwd, env, cols, rows }) {
  if (nodePty) {
    const p = nodePty.spawn(file, args, { name: 'xterm-256color', cwd, env, cols, rows });
    return {
      onData: (cb) => p.onData(cb),
      onExit: (cb) => p.onExit(({ exitCode, signal }) => cb(signal ? 128 + signal : exitCode)),
      write: (d) => p.write(d),
      resize: (c, r) => { try { p.resize(c, r); } catch {} },
      kill: () => { try { process.kill(-p.pid, 'SIGHUP'); } catch {} try { p.kill(); } catch {} },
    };
  }
  const bridge = unpacked(path.join(__dirname, 'ptybridge.py'));
  const p = spawn('python3', [bridge, String(cols), String(rows), file, ...args], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  p.stdout.setEncoding('utf8');
  p.stderr.setEncoding('utf8');
  // Pipes may reset when the process is killed; that's expected, not fatal.
  p.on('error', () => {});
  for (const s of p.stdio) s?.on('error', () => {});
  return {
    onData: (cb) => { p.stdout.on('data', cb); p.stderr.on('data', cb); },
    onExit: (cb) => p.on('close', (code, sig) => cb(code ?? (sig ? 128 + (os.constants.signals[sig] || 0) : 1))),
    write: (d) => { if (p.stdin.writable) p.stdin.write(d); },
    resize: (c, r) => { if (p.stdio[3].writable) p.stdio[3].write(`${c} ${r}\n`); },
    kill: () => { try { p.kill('SIGTERM'); } catch {} },
  };
}

// Runs the user's command, then records the final cwd and exported env so the
// next command starts where this one left off. The trap also fires on `exit`.
// ELECTRON_RUN_AS_NODE lets the Electron binary act as plain node here.
// Ending in another directory runs zsh's chpwd hooks first, as a cd would.
const WRAPPER = `
__tp_save() {
  if [ "$PWD" != "$__TP_START" ]; then
    for __tp_f in "\${__tp_hooks[@]}"; do declare -F "$__tp_f" >/dev/null && "$__tp_f"; done
  fi
  pwd > "$__TP_STATE" 2>/dev/null
  ELECTRON_RUN_AS_NODE=1 "$__TP_NODE" -e 'process.stdout.write(JSON.stringify(process.env))' > "$__TP_ENV" 2>/dev/null
}
trap __tp_save EXIT
shopt -s expand_aliases
eval "$__TP_ALIASES" 2>/dev/null
eval "$__TP_CMD"
`;

const IGNORED_ENV = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD', 'TERM', 'COLORTERM', 'SHELF_TERMINAL', 'ELECTRON_RUN_AS_NODE']);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-'));
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

const readText = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Environment for a fresh session: drop anything that belongs to the process
// that launched us (npm script vars, our own markers) rather than to the user.
function cleanEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) =>
    !k.startsWith('__TP_') && !k.startsWith('npm_') && !k.startsWith('ELECTRON_') && k !== 'INIT_CWD'));
}

// ------------------------------------------------------------- zsh bridge
// HISTFILE, aliases and the user's own functions come from an interactive zsh
// so ~/.zshrc is honoured. Functions from oh-my-zsh, system dirs or named _*
// are skipped (zsh-only, and some would shadow bash builtins like compgen);
// each is eval'd alone so one bash can't parse doesn't break the rest.
const zsh = { histfile: path.join(os.homedir(), '.zsh_history'), aliases: '', hooks: false };
const ZSH_DUMP = 'print -r -- $HISTFILE; alias -rL; zmodload zsh/parameter; ' +
  'for f in ${(k)functions}; do s=${functions_source[$f]}; ' +
  '[[ -n $s && $f != _* && $s != /usr/* && $s != /proc/* && ( -z $ZSH || $s != $ZSH/* ) ]] && ' +
  'print -r -- "eval ${(qq)$(functions $f)} 2>/dev/null"; done; ' +
  'hooks=(${(k)functions[chpwd]} $chpwd_functions); (( $#hooks )) && print -r -- "__tp_hooks=(${(qq)hooks})"; true';

function loadZsh() {
  execFile('zsh', ['-ic', ZSH_DUMP], { cwd: os.homedir(), timeout: 3000 }, (err, out) => {
    if (!out) return;
    const [file, ...aliases] = out.split('\n');
    if (file) zsh.histfile = file;
    zsh.aliases = aliases.join('\n');
    zsh.hooks = aliases.some((l) => l.startsWith('__tp_hooks='));
  });
}
loadZsh();

// zsh "metafies" history bytes 0x00 and 0x83-0xa2 as 0x83, byte ^ 0x20.
function unmetafy(buf) {
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) out[n++] = buf[i] === 0x83 && i + 1 < buf.length ? buf[++i] ^ 0x20 : buf[i];
  return out.subarray(0, n);
}

// The history file as { raw, cmd } entries: the entry's bytes (a line ending in a backslash
// continues it) and its decoded command.
function historyEntries() {
  let buf;
  try { buf = fs.readFileSync(zsh.histfile); } catch { return []; }
  const entries = [];
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i < buf.length && (buf[i] !== 0x0a || buf[i - 1] === 0x5c)) continue;
    const raw = buf.subarray(start, i + 1);
    start = i + 1;
    const cmd = unmetafy(raw).toString('utf8').replace(/^: \d+:\d+;/, '').replace(/\n$/, '').replace(/\\\n/g, '\n');
    if (raw.length) entries.push({ raw, cmd });
  }
  return entries;
}

function readHistory() {
  const items = [];
  for (const { cmd } of historyEntries()) if (cmd && items[items.length - 1] !== cmd) items.push(cmd);
  return items;
}

// ponytail: zsh sessions open while this runs may write the entry back from their in-memory history.
function deleteHistory(cmd) {
  const entries = historyEntries(), keep = entries.filter((e) => e.cmd !== cmd);
  if (keep.length === entries.length) return;
  try {
    const file = fs.realpathSync(zsh.histfile), tmp = file + '.shelf-tmp';   // a symlinked HISTFILE stays a symlink
    fs.writeFileSync(tmp, Buffer.concat(keep.map((e) => e.raw)), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {}
}

// ponytail: ignores zsh's HISTFILE.LOCK; a single small O_APPEND write is safe enough.
function appendHistory(cmd) {
  if (!cmd.trim() || cmd.startsWith(' ')) return;
  let extended = false;
  try {
    const fd = fs.openSync(zsh.histfile, 'r');
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    extended = head.toString() === ': ';
  } catch {}
  const line = (extended ? `: ${Math.floor(Date.now() / 1000)}:0;` : '') + cmd.trim().replace(/\n/g, '\\\n') + '\n';
  const bytes = [];
  for (const b of Buffer.from(line)) {
    if (b === 0 || (b >= 0x83 && b <= 0xa2)) bytes.push(0x83, b ^ 0x20); else bytes.push(b);
  }
  try { fs.appendFileSync(zsh.histfile, Buffer.from(bytes), { mode: 0o600 }); } catch {}
}

// ------------------------------------------------------------------ session
// A session holds a base cwd + env (`state`, which callers may share between
// sessions), one cwd + env per UI tab cloned from it, and the commands it is
// running. Feed it client messages with handle(); it emits 'message' events.
class Session extends EventEmitter {
  constructor(state) {
    super();
    this.state = state;
    this.tabs = new Map();
    this.runs = new Map();
  }

  get runningCount() { return this.runs.size; }

  stateFor(tab, from) {
    tab = String(tab ?? '');
    if (!this.tabs.has(tab)) {
      const src = this.tabs.get(String(from ?? '')) || this.state;
      this.tabs.set(tab, { cwd: src.cwd, env: { ...src.env } });
    }
    return this.tabs.get(tab);
  }

  async emitState(tab) {
    const { cwd } = tab == null ? this.state : this.stateFor(tab);
    const git = await gitStatus(cwd);
    this.emit('message', { type: 'state', tab, cwd, git, home: os.homedir(), backend: ptyBackend });
  }

  handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    const run = this.runs.get(msg.id);
    switch (msg.type) {
      case 'hello': this.killAll(); this.tabs.clear(); loadZsh(); this.emitState(); break;   // UI (re)loaded: old panes are gone
      case 'tab-open': this.stateFor(msg.tab, msg.from); this.emitState(msg.tab); break;
      case 'history': this.emit('message', { type: 'history', items: readHistory() }); break;
      case 'history-add': appendHistory(String(msg.cmd || '')); break;
      case 'history-delete': deleteHistory(String(msg.cmd || '')); break;
      case 'tab-close': this.tabs.delete(String(msg.tab)); break;
      case 'run': this.run(msg); break;
      case 'cd': this.cd(msg); break;
      case 'stat': this.stat(msg); break;
      case 'open': this.open(msg); break;
      case 'input': run?.pty.write(String(msg.data)); break;
      case 'resize': run?.pty.resize(Math.max(2, msg.cols | 0), Math.max(1, msg.rows | 0)); break;
      case 'kill': run?.pty.kill(); break;
      case 'complete':
        complete({ ...this.stateFor(msg.tab), ...(msg.cwd && { cwd: String(msg.cwd) }) }, String(msg.line || ''), (r) => this.emit('message', { type: 'completions', reqId: msg.reqId, ...r }));
        break;
    }
  }

  run(msg) {
    const id = String(msg.id);
    if (this.runs.has(id)) this.runs.get(id).pty.kill();
    const state = this.stateFor(msg.tab);
    const startCwd = msg.cwd && fs.existsSync(msg.cwd) ? msg.cwd : (fs.existsSync(state.cwd) ? state.cwd : os.homedir());
    const startEnv = { ...state.env };
    const env = wrapperEnv(id, startEnv, startCwd, String(msg.cmd));
    const pty = spawnPty(SHELL, ['--noprofile', '--norc', '-c', WRAPPER], {
      cwd: startCwd, env, cols: msg.cols || 80, rows: msg.rows || 24,
    });
    const started = Date.now();
    this.runs.set(id, { pty });
    this.emit('message', { type: 'started', id, cwd: startCwd });
    pty.onData((data) => this.emit('message', { type: 'data', id, data }));
    pty.onExit((code) => {
      if (this.runs.get(id)?.pty !== pty) return;   // superseded by a rerun
      this.runs.delete(id);
      const endCwd = collect(env, state, startCwd, startEnv);
      // Give trailing output a moment to flush before announcing exit.
      setTimeout(() => {
        this.emit('message', { type: 'exit', id, code, ms: Date.now() - started, cwd: endCwd || startCwd });
        this.emitState(msg.tab);
      }, 30);
    });
  }

  // A bare `cd` changes the tab's directory without a terminal; on failure the
  // UI runs it for real so the error shows up in a pane.
  cd(msg) {
    const state = this.stateFor(msg.tab), home = os.homedir();
    const arg = String(msg.path ?? '');
    const target = arg === '-' ? state.prev
      : !arg || arg === '~' ? home
      : path.resolve(state.cwd, arg.startsWith('~/') ? home + arg.slice(1) : arg);
    let ok = false;
    try { ok = !!target && fs.statSync(target).isDirectory(); } catch {}
    const from = state.cwd;
    if (ok && target !== from) { state.prev = from; state.cwd = target; }
    this.emit('message', { type: 'cd', tab: msg.tab, cmd: msg.cmd, ok });
    if (ok) this.emitState(msg.tab);
    // ponytail: hooks run after the cd lands, so a command typed instantly may miss their env.
    if (ok && target !== from && zsh.hooks) {
      const startEnv = { ...state.env };
      const env = { ...wrapperEnv('cd', startEnv, from, 'cd -- "$__TP_DIR"'), __TP_DIR: target };
      execFile(SHELL, ['--noprofile', '--norc', '-c', WRAPPER], { cwd: from, env, timeout: 10000 },
        () => collect(env, state, from, startEnv));
    }
  }

  // Paths seen in a pane's output, resolved against `base` (the directory its command started in), then
  // against the git root of `base`. Replies { path, abs, exists, isDir } for each.
  async stat(msg) {
    const home = os.homedir();
    const base = typeof msg.base === 'string' && path.isAbsolute(msg.base) ? msg.base : this.stateFor(msg.tab).cwd;
    const paths = (Array.isArray(msg.paths) ? msg.paths : []).slice(0, 200).map(String);
    let root;
    const items = [];
    for (const p of paths) {
      const rel = p === '~' ? home : p.startsWith('~/') ? home + p.slice(1) : p;
      let abs = path.resolve(base, rel), st = await statOf(abs);
      if (!st && !path.isAbsolute(rel)) {
        if (root === undefined) root = await gitRoot(base);
        if (root && (st = await statOf(path.resolve(root, rel)))) abs = path.resolve(root, rel);
      }
      items.push({ path: p, abs, exists: !!st, isDir: !!st?.isDirectory() });
    }
    this.emit('message', { type: 'stat', reqId: msg.reqId, items });
  }

  // Opens a file the UI found with stat. The path comes from program output: it only ever becomes one
  // argument of an argv (never shell text), and a terminal editor's command is quoted word by word.
  open(msg) {
    const abs = String(msg.abs ?? '');
    let st;
    try { st = path.isAbsolute(abs) && fs.statSync(abs); } catch {}
    if (!st) return;
    if (st.isDirectory()) return this.cd({ tab: msg.tab, path: abs, cmd: 'cd ' + shq(abs) });
    const env = this.stateFor(msg.tab).env;
    const argv = editorArgv(env, abs, msg.line > 0 ? msg.line | 0 : 0, msg.col > 0 ? msg.col | 0 : 0);
    if (isTerminalEditor(argv)) return this.emit('message', { type: 'open-pane', tab: msg.tab, cmd: argv.map(shq).join(' ') });
    const child = spawn(argv[0], argv.slice(1), { cwd: path.dirname(abs), env, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }

  killAll() {
    for (const { pty } of this.runs.values()) pty.kill();
    this.runs.clear();
  }

  dispose() { this.killAll(); this.removeAllListeners(); }
}

function wrapperEnv(id, startEnv, startCwd, cmd) {
  const base = path.join(tmpRoot, id.replace(/\W/g, '_') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  return {
    ...startEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', SHELF_TERMINAL: '1',
    __TP_CMD: cmd, __TP_START: startCwd, __TP_STATE: base + '.cwd', __TP_ENV: base + '.env', __TP_NODE: process.execPath, __TP_ALIASES: zsh.aliases,
  };
}

// Reads what a WRAPPER run left behind into `state`; returns its final cwd.
function collect(env, state, startCwd, startEnv) {
  const endCwd = readText(env.__TP_STATE);
  applyChanges(state, startCwd, startEnv, endCwd, readJson(env.__TP_ENV));
  for (const f of [env.__TP_STATE, env.__TP_ENV]) fs.rm(f, { force: true }, () => {});
  return endCwd;
}

// Apply only what *this* command changed, and only where nothing else changed
// the same thing while it ran: a slow command that finishes later can't undo
// a `cd` or `export` you made in the meantime.
function applyChanges(state, startCwd, startEnv, endCwd, endEnv) {
  if (endCwd && endCwd !== startCwd && state.cwd === startCwd && fs.existsSync(endCwd)) state.cwd = endCwd;
  if (!endEnv) return;
  for (const [k, v] of Object.entries(endEnv)) {
    if (k.startsWith('__TP_') || IGNORED_ENV.has(k)) continue;
    if (startEnv[k] !== v && state.env[k] === startEnv[k]) state.env[k] = v;
  }
  for (const k of Object.keys(startEnv)) {
    if (!(k in endEnv) && !IGNORED_ENV.has(k) && state.env[k] === startEnv[k]) delete state.env[k];
  }
}

// ---------------------------------------------------------- opening files
const statOf = (f) => fs.promises.stat(f).catch(() => null);
const gitRoot = (dir) => new Promise((res) =>
  execFile('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 2000 }, (err, out) => res(err ? '' : out.trim())));
// { branch, ahead, behind, dirty } for the repo `dir` is in, or null outside one.
const gitStatus = (dir) => new Promise((res) =>
  execFile('git', ['-C', dir, 'status', '--porcelain=v2', '--branch'], { timeout: 2000 }, (err, out) => {
    if (err) return res(null);
    const lines = out.split('\n').filter(Boolean);
    const head = lines.find((l) => l.startsWith('# branch.head '))?.slice(14);
    const ab = lines.find((l) => l.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/);
    res({ branch: head, ahead: +(ab?.[1] || 0), behind: +(ab?.[2] || 0), dirty: lines.some((l) => !l.startsWith('#')) });
  }));
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function which(cmd, env) {
  return (env.PATH || '').split(':').some((d) => { try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; } catch { return false; } });
}

const OPENER = process.platform === 'darwin' ? 'open' : 'xdg-open';
const TERMINAL_EDITORS = new Set(['vim', 'nvim', 'vi', 'nano', 'micro', 'hx', 'helix', 'kak']);
const isTerminalEditor = ([cmd, ...args]) => {
  const name = path.basename(cmd);
  return TERMINAL_EDITORS.has(name) || (/^emacs(client)?$/.test(name) && args.some((a) => ['-nw', '-t', '--tty'].includes(a)));
};
// How to jump to a line in editors set through $VISUAL / $EDITOR. kak takes +line:col, not file:line:col.
const EDITOR_ARGS = {
  ...Object.fromEntries(['vim', 'nvim', 'vi', 'nano', 'micro', 'emacs', 'emacsclient'].map((e) => [e, '+{line} {file}'])),
  ...Object.fromEntries(['hx', 'helix', 'subl', 'zed'].map((e) => [e, '{file}:{line}:{col}'])),
  ...Object.fromEntries(['code', 'codium', 'cursor'].map((e) => [e, '-g {file}:{line}:{col}'])),
  kak: '+{line}:{col} {file}',
};
const BINARY = /\.(pdf|png|jpe?g|gif|webp|bmp|ico|tiff?|svg|mp[34]|m4a|mov|mkv|webm|avi|wav|ogg|flac|zip|gz|tgz|xz|bz2|7z|rar|docx?|xlsx?|pptx?|od[tsp])$/i;

function isBinary(file) {
  if (BINARY.test(file)) return true;
  try {
    const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(4096), n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).includes(0);
  } catch { return false; }
}

// The editor command for `file` as an argv: SHELF_EDITOR (a template with {file}, {line}, {col}), else
// $VISUAL / $EDITOR / code with their known line syntax, else the system opener (always, for binary files).
// The template is split into words before the placeholders are filled, so a path is always one whole argument.
// ponytail: splits on whitespace only, so an editor path with spaces needs a wrapper script.
function editorArgv(env, file, line, col) {
  let tpl = env.SHELF_EDITOR;
  if (!tpl) {
    const ed = env.VISUAL || env.EDITOR || (which('code', env) ? 'code' : '');
    tpl = ed ? `${ed} ${EDITOR_ARGS[path.basename(ed.split(/\s+/)[0])] || '{file}'}` : `${OPENER} {file}`;
  }
  if (isBinary(file)) tpl = `${OPENER} {file}`;
  const vals = { file, line, col };
  return tpl.trim().split(/\s+/)
    .map((w) => (line ? (col ? w : w.replace(/:?\{col\}/g, '')) : w.replace(/[:+]?\{(line|col)\}/g, '')))
    .filter(Boolean)
    .concat(/\{file\}/.test(tpl) ? [] : ['{file}'])
    .map((w) => w.replace(/\{(file|line|col)\}/g, (_, k) => vals[k]));
}

// ------------------------------------------------------------ completion
function complete(state, line, cb) {
  const m = line.match(/(\S*)$/);
  const word = m ? m[1] : '';
  const isFirst = line.trimStart() === word;
  const home = os.homedir();
  const expanded = word.startsWith('~') ? home + word.slice(1) : word;
  const script = `
    w="$1"
    { ${isFirst && !word.includes('/') ? 'compgen -c -- "$w";' : ''}
      compgen -f -- "$w" | while IFS= read -r f; do if [ -d "$f" ]; then echo "$f/"; else echo "$f"; fi; done
    } 2>/dev/null | sort -u | head -200`;
  execFile(SHELL, ['--noprofile', '--norc', '-c', script, 'complete', expanded],
    { cwd: fs.existsSync(state.cwd) ? state.cwd : home, env: state.env, timeout: 2000 }, (err, out) => {
      let items = (out || '').split('\n').filter(Boolean);
      if (word.startsWith('~')) items = items.map((s) => (s.startsWith(home) ? '~' + s.slice(home.length) : s));
      cb({ word, items });
    });
}

// ---------------------------------------------------------- static assets
// URL path -> file on disk, shared by the HTTP server and the app:// protocol.
// public/ is the Vite build output of ui/.
const PUBLIC = path.join(__dirname, 'public');

function resolveAsset(urlPath) {
  const p = path.posix.normalize(urlPath);
  if (p.includes('..')) return null;
  return path.join(PUBLIC, p === '/' ? 'index.html' : p);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.map': 'application/json', '.png': 'image/png',
};
const mimeOf = (file) => MIME[path.extname(file)] || 'application/octet-stream';

module.exports = { Session, ptyBackend, cleanEnv, resolveAsset, mimeOf };
