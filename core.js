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
const WRAPPER = `
__tp_save() {
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
// HISTFILE and aliases come from an interactive zsh so ~/.zshrc is honoured.
const zsh = { histfile: path.join(os.homedir(), '.zsh_history'), aliases: '' };

function loadZsh() {
  execFile('zsh', ['-ic', 'print -r -- $HISTFILE; alias -rL'], { cwd: os.homedir(), timeout: 3000 }, (err, out) => {
    if (!out) return;
    const [file, ...aliases] = out.split('\n');
    if (file) zsh.histfile = file;
    zsh.aliases = aliases.join('\n');
  });
}
loadZsh();

// zsh "metafies" history bytes 0x00 and 0x83-0xa2 as 0x83, byte ^ 0x20.
function readHistory() {
  let buf;
  try { buf = fs.readFileSync(zsh.histfile); } catch { return []; }
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) out[n++] = buf[i] === 0x83 && i + 1 < buf.length ? buf[++i] ^ 0x20 : buf[i];
  const items = [];
  let cur = null;
  for (const line of out.toString('utf8', 0, n).split('\n')) {
    cur = cur === null ? line.replace(/^: \d+:\d+;/, '') : cur + '\n' + line;
    if (cur.endsWith('\\')) { cur = cur.slice(0, -1); continue; }
    if (cur && items[items.length - 1] !== cur) items.push(cur);
    cur = null;
  }
  return items;
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

  emitState(tab) {
    const { cwd } = tab == null ? this.state : this.stateFor(tab);
    this.emit('message', { type: 'state', tab, cwd, home: os.homedir(), backend: ptyBackend });
  }

  handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    const run = this.runs.get(msg.id);
    switch (msg.type) {
      case 'hello': this.killAll(); this.tabs.clear(); loadZsh(); this.emitState(); break;   // UI (re)loaded: old panes are gone
      case 'tab-open': this.stateFor(msg.tab, msg.from); this.emitState(msg.tab); break;
      case 'history': this.emit('message', { type: 'history', items: readHistory() }); break;
      case 'history-add': appendHistory(String(msg.cmd || '')); break;
      case 'tab-close': this.tabs.delete(String(msg.tab)); break;
      case 'run': this.run(msg); break;
      case 'cd': this.cd(msg); break;
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
    const base = path.join(tmpRoot, id.replace(/\W/g, '_') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    const env = {
      ...startEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', SHELF_TERMINAL: '1',
      __TP_CMD: String(msg.cmd), __TP_STATE: base + '.cwd', __TP_ENV: base + '.env', __TP_NODE: process.execPath, __TP_ALIASES: zsh.aliases,
    };
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
      const endCwd = readText(env.__TP_STATE);
      applyChanges(state, startCwd, startEnv, endCwd, readJson(env.__TP_ENV));
      for (const f of [env.__TP_STATE, env.__TP_ENV]) fs.rm(f, { force: true }, () => {});
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
    if (ok && target !== state.cwd) { state.prev = state.cwd; state.cwd = target; }
    this.emit('message', { type: 'cd', tab: msg.tab, cmd: msg.cmd, ok });
    if (ok) this.emitState(msg.tab);
  }

  killAll() {
    for (const { pty } of this.runs.values()) pty.kill();
    this.runs.clear();
  }

  dispose() { this.killAll(); this.removeAllListeners(); }
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
