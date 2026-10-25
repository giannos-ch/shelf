'use strict';
/* shelf client: a prompt outside the terminal, one floating pane per command. */

const $ = (s) => document.querySelector(s);
const desk = $('#desk'), dock = $('#dock'), input = $('#input'), cwdEl = $('#cwd');
const compEl = $('#completions'), connEl = $('#conn'), emptyEl = $('#empty');

// Commands that take over the terminal: their pane opens maximized and focused.
// Anything that switches to the alternate screen (vim, htop, less…) is also
// detected automatically, so this list mainly covers inline TUIs.
const INTERACTIVE = new Set([
  'claude', 'codex', 'gemini', 'aider', 'vim', 'nvim', 'vi', 'nano', 'emacs', 'micro', 'htop', 'btop',
  'top', 'less', 'more', 'man', 'ssh', 'mosh', 'tmux', 'screen', 'python', 'python3', 'ipython', 'node',
  'bash', 'zsh', 'fish', 'sh', 'psql', 'mysql', 'sqlite3', 'redis-cli', 'mongosh', 'lazygit', 'tig',
  'k9s', 'ranger', 'mc', 'nnn', 'fzf', 'watch',
]);

const THEME = {
  background: '#12151b', foreground: '#d7dce5', cursor: '#e3b341', cursorAccent: '#12151b',
  selectionBackground: '#2f3a52',
  black: '#1b1f27', red: '#f85149', green: '#3fb950', yellow: '#e3b341', blue: '#5b8def',
  magenta: '#bc8cff', cyan: '#39c5cf', white: '#d7dce5',
  brightBlack: '#5c6370', brightRed: '#ff7b72', brightGreen: '#56d364', brightYellow: '#f2cc60',
  brightBlue: '#79a6ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff',
};

const state = { cwd: '', home: '' };
const panes = new Map();
let seq = 0, zTop = 10;
const GAP = 10, MIN_COL = 520;

// ------------------------------------------------------------- connection
// In the desktop app the preload script exposes window.shelf (Electron
// IPC); in a browser we talk to server.js over a WebSocket. Same messages.
const bridge = window.shelf || null;
let ws = null;
const outbox = [];
function connect() {
  if (bridge) {
    document.documentElement.classList.add('desktop', 'platform-' + bridge.platform);
    bridge.onMessage(handle);
    bridge.send({ type: 'hello' });
    return;
  }
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => { connEl.hidden = true; while (outbox.length) ws.send(outbox.shift()); };
  ws.onclose = () => {
    connEl.hidden = false;
    for (const p of panes.values()) if (p.status === 'running') p.finish(null, null, 'disconnected');
    setTimeout(connect, 1200);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}
function send(msg) {
  if (bridge) return bridge.send(msg);
  const s = JSON.stringify(msg);
  if (ws && ws.readyState === 1) ws.send(s); else outbox.push(s);
}
function handle(m) {
  const p = panes.get(m.id);
  switch (m.type) {
    case 'state': state.cwd = m.cwd; state.home = m.home; renderCwd(); break;
    case 'started': if (p) { p.cwd = m.cwd; p.renderMeta(); } break;
    case 'data': p?.write(m.data); break;
    case 'exit': p?.finish(m.code, m.ms); break;
    case 'completions': onCompletions(m); break;
  }
}

// ------------------------------------------------------------------ utils
const tilde = (d) => (state.home && (d === state.home || d.startsWith(state.home + '/')) ? '~' + d.slice(state.home.length) : d);
function renderCwd() {
  cwdEl.innerHTML = `<bdi>${esc(tilde(state.cwd))} ❯</bdi>`;
  cwdEl.title = state.cwd;
  document.title = `${tilde(state.cwd)} — Shelf`;
}
function fmtDur(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;
}
function deskSize() { return { w: desk.clientWidth, h: desk.clientHeight }; }
function programOf(cmd) {
  const words = cmd.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && (/^\w+=/.test(words[i]) || ['sudo', 'env', 'exec', 'time', 'nohup'].includes(words[i]))) i++;
  return (words[i] || '').split('/').pop();
}
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ------------------------------------------------------------------ panes
class Pane {
  constructor(cmd) {
    this.id = 'p' + (++seq);
    this.cmd = cmd;
    this.cwd = state.cwd;
    this.status = 'idle';
    this.userSized = false;     // user resized it: never auto-shrink
    this.pinned = false;        // user dragged it: leave it out of the auto layout
    this.natH = defaultHeight();
    this.maximized = false;
    this.autoMax = false;       // maximized automatically for a full-screen app
    this.prevRect = null;
    this.lastSize = { cols: 0, rows: 0 };
    this.interactive = INTERACTIVE.has(programOf(cmd));
    this.build();
    panes.set(this.id, this);
    layout();
    this.term.open(this.termEl);
    this.trackFocus();
    this.fit.fit();
    this.observe();
    this.front();
    emptyEl.hidden = true;
    if (this.interactive) { this.maximize(true); this.autoMax = true; }
    this.start(false);
    if (this.interactive) this.focus(); else this.reveal();
  }

  build() {
    this.el = el('section', 'pane');
    this.el.dataset.id = this.id;
    this.el.innerHTML = `
      <header class="pane-head">
        <span class="dot"></span>
        <span class="cmd"></span>
        <span class="meta"></span>
        <span class="btns">
          <button class="rerun" title="Run again">↻</button>
          <button class="min" title="Minimize">▁</button>
          <button class="max" title="Maximize">▢</button>
          <button class="close" title="Close (stops the command)">✕</button>
        </span>
      </header>
      <div class="pane-body"><div class="term"></div></div>
      <div class="grip"></div>`;
    this.head = this.el.querySelector('.pane-head');
    this.dot = this.el.querySelector('.dot');
    this.metaEl = this.el.querySelector('.meta');
    this.body = this.el.querySelector('.pane-body');
    this.termEl = this.el.querySelector('.term');
    const cmdEl = this.el.querySelector('.cmd');
    cmdEl.textContent = this.cmd.replace(/\n/g, ' ⏎ ');
    cmdEl.title = this.cmd;

    this.term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
      fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 10000,
      theme: THEME, macOptionIsMeta: true, allowTransparency: false,
    });
    this.fit = new FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    if (window.WebLinksAddon) this.term.loadAddon(new WebLinksAddon.WebLinksAddon());
    this.term.onData((d) => { if (this.status === 'running') send({ type: 'input', id: this.id, data: d }); });
    this.term.buffer.onBufferChange((buf) => {
      // Full-screen app detected: give it the whole desk and the keyboard.
      if (buf.type === 'alternate' && this.status === 'running' && !this.maximized) {
        this.autoMax = true; this.maximize(true); this.focus();
      }
    });

    this.el.addEventListener('pointerdown', () => this.front(), true);
    this.body.addEventListener('mousedown', () => setTimeout(() => this.focus(), 0));
    this.el.querySelector('.rerun').onclick = () => this.rerun();
    this.el.querySelector('.min').onclick = () => this.minimize();
    this.el.querySelector('.max').onclick = () => this.toggleMax();
    this.el.querySelector('.close').onclick = () => this.close();
    this.head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) this.toggleMax(); });
    this.dragging(this.head, 'move');
    this.dragging(this.el.querySelector('.grip'), 'resize');
    desk.appendChild(this.el);
  }

  // xterm creates its hidden textarea in open(); track focus through it.
  trackFocus() {
    this.term.textarea?.addEventListener('focus', () => this.el.classList.add('focused'));
    this.term.textarea?.addEventListener('blur', () => this.el.classList.remove('focused'));
  }

  // ---- geometry
  rect() { const s = this.el.style; return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) }; }
  setRect({ x, y, w, h }, animate = false) {
    if (animate) { this.el.classList.add('animate'); setTimeout(() => this.el.classList.remove('animate'), 220); }
    Object.assign(this.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  }
  isMin() { return this.el.classList.contains('minimized'); }
  clampIntoDesk() {
    const D = deskSize(), r = this.rect();
    if (this.maximized) return this.setRect(maxRect());
    if (!this.pinned) return;
    const w = Math.min(r.w, D.w - 12);
    this.setRect({ ...r, w, x: Math.max(0, Math.min(r.x, D.w - 80)), y: Math.max(0, r.y) });
  }
  reveal() {
    const r = this.rect(), bottom = r.y + r.h + GAP;
    if (bottom > desk.scrollTop + desk.clientHeight) desk.scrollTo({ top: bottom - desk.clientHeight, behavior: 'smooth' });
    else if (r.y < desk.scrollTop) desk.scrollTo({ top: Math.max(0, r.y - GAP), behavior: 'smooth' });
  }

  dragging(handle, mode) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      if (mode === 'move' && this.maximized) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const start = { mx: e.clientX, my: e.clientY, ...this.rect() };
      const D = deskSize();
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - start.mx, dy = ev.clientY - start.my;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        if (!moved) { moved = true; this.pinned = true; this.front(); }
        if (mode === 'move') {
          this.setRect({ ...start, x: Math.max(-start.w + 80, Math.min(D.w - 80, start.x + dx)), y: Math.max(0, start.y + dy) });
        } else {
          this.userSized = true; this.maximized = false;
          this.setRect({ ...start, w: Math.max(220, Math.min(Math.max(start.w, D.w - start.x - 6), start.w + dx)), h: Math.max(58, start.h + dy) });
        }
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        if (!moved) return;
        // Keep the whole pane (and its resize grip) on screen.
        const r = this.rect(), W = desk.clientWidth;
        if (r.x + r.w > W - 6) {
          const w = Math.max(320, W - r.x - 6);
          this.setRect({ ...r, w, x: Math.max(6, Math.min(r.x, W - w - 6)) }, true);
        }
        if (r.x < 6) this.setRect({ ...this.rect(), x: 6 }, true);
        layout(true);   // the other panes close the gap it left
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  observe() {
    let raf = 0;
    this.ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (this.isMin()) return;
        try { this.fit.fit(); } catch { return; }
        const { cols, rows } = this.term;
        if (this.status === 'running' && (cols !== this.lastSize.cols || rows !== this.lastSize.rows)) {
          send({ type: 'resize', id: this.id, cols, rows });
        }
        this.lastSize = { cols, rows };
      });
    });
    this.ro.observe(this.body);
  }

  // ---- lifecycle
  start(rerun) {
    this.status = 'running';
    this.gotOutput = false;
    this.body.querySelector('.noout')?.remove();
    this.term.options.disableStdin = false;
    this.term.options.cursorBlink = true;
    this.started = Date.now();
    this.renderMeta();
    clearInterval(this.tick);
    this.tick = setInterval(() => this.renderMeta(), 1000);
    const { cols, rows } = this.term;
    this.lastSize = { cols, rows };
    send({ type: 'run', id: this.id, cmd: this.cmd, cols, rows, cwd: rerun ? this.cwd : undefined });
  }
  write(data) {
    if (!this.gotOutput) { this.gotOutput = true; this.body.querySelector('.noout')?.remove(); }
    this.term.write(data);
  }
  finish(code, ms, reason) {
    clearInterval(this.tick);
    this.status = code === 0 ? 'ok' : 'err';
    this.code = code; this.ms = ms ?? Date.now() - this.started; this.reason = reason;
    this.term.options.disableStdin = true;
    this.term.options.cursorBlink = false;
    this.term.write('\x1b[?25l');           // hide cursor in finished panes
    this.renderMeta();
    this.updateChip();
    if (this.el.classList.contains('focused')) focusPrompt();
    if (this.autoMax && this.maximized) { this.autoMax = false; this.maximize(false); }
    if (!this.gotOutput) this.body.appendChild(el('div', 'noout', 'no output'));
    // Let the last bytes render, then trim the pane to its content.
    setTimeout(() => this.shrinkToContent(), 60);
  }
  renderMeta() {
    const parts = [esc(tilde(this.cwd || ''))];
    if (this.status === 'running') parts.push(fmtDur(Date.now() - this.started));
    else if (this.status !== 'idle') {
      parts.push(fmtDur(this.ms));
      if (this.reason) parts.push(`<span class="code">${this.reason}</span>`);
      else if (this.code !== 0) parts.push(`<span class="code">exit ${this.code}</span>`);
    }
    this.metaEl.innerHTML = parts.filter(Boolean).join(' · ');
    this.dot.className = 'dot ' + (this.status === 'running' ? 'running' : this.status);
  }
  shrinkToContent() {
    if (this.userSized || this.maximized || this.isMin()) return;
    const buf = this.term.buffer.active;
    if (buf.baseY > 0) return;                     // output is taller than the pane: keep it
    let used = 0;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf.getLine(i)?.translateToString(true).trim()) { used = i + 1; break; }
    }
    const rows = Math.max(1, used);
    if (rows >= this.term.rows) return;
    const screen = this.term.element?.querySelector('.xterm-screen');
    const cell = screen ? screen.getBoundingClientRect().height / this.term.rows : 16;
    const chrome = this.el.getBoundingClientRect().height - this.body.getBoundingClientRect().height;
    const pad = 10 + 2;                              // body padding + a little air
    this.natH = Math.ceil(chrome + pad + rows * cell);
    if (this.pinned) this.setRect({ ...this.rect(), h: this.natH }, true); else layout(true);
    setTimeout(() => this.term.scrollToTop(), 240);
  }

  // ---- actions
  front() { this.el.style.zIndex = ++zTop; }
  focus() { this.front(); this.term.focus(); }
  rerun() {
    if (this.status === 'running') send({ type: 'kill', id: this.id });
    this.term.reset();
    if (!this.userSized) { this.natH = defaultHeight(); if (this.pinned) this.setRect({ ...this.rect(), h: this.natH }); else layout(true); }
    this.start(true);
    this.updateChip();
  }
  minimize() {
    if (this.el.classList.contains('focused')) focusPrompt();
    this.el.classList.add('minimized');
    this.chip = el('button', 'chip', `<span class="dot"></span><span></span>`);
    this.chip.lastChild.textContent = this.cmd.replace(/\n/g, ' ⏎ ');
    this.chip.title = this.cmd;
    this.chip.onclick = () => this.restore();
    dock.appendChild(this.chip);
    this.updateChip();
    layout(true);
  }
  restore() {
    this.el.classList.remove('minimized');
    this.chip?.remove(); this.chip = null;
    layout(true);
    this.clampIntoDesk();
    this.reveal();
    this.focus();
  }
  updateChip() { if (this.chip) this.chip.firstChild.className = 'dot ' + (this.status === 'running' ? 'running' : this.status); }
  toggleMax() { this.autoMax = false; this.maximize(!this.maximized); }
  maximize(on) {
    if (on === this.maximized) return;
    this.maximized = on;
    if (on) { this.prevRect = this.rect(); this.setRect(maxRect(), true); }
    else if (this.pinned && this.prevRect) this.setRect(this.prevRect, true);
    else layout(true);
    desk.classList.toggle('locked', [...panes.values()].some((p) => p.maximized));
    this.el.querySelector('.max').textContent = on ? '❐' : '▢';
    this.el.querySelector('.max').title = on ? 'Restore' : 'Maximize';
    this.front();
  }
  close() {
    if (this.status === 'running') send({ type: 'kill', id: this.id });
    if (this.el.classList.contains('focused')) focusPrompt();
    clearInterval(this.tick);
    this.ro.disconnect();
    this.term.dispose();
    this.el.remove();
    this.chip?.remove();
    panes.delete(this.id);
    desk.classList.toggle('locked', [...panes.values()].some((p) => p.maximized));
    layout(true);
    if (!panes.size) emptyEl.hidden = false;
  }
}

// --------------------------------------------------------- desk actions
function defaultHeight() { return Math.max(120, Math.min(320, desk.clientHeight - 2 * GAP)); }
function maxRect() { return { x: 6, y: desk.scrollTop + 6, w: desk.clientWidth - 12, h: desk.clientHeight - 12 }; }

// Masonry flow: unpinned panes fill the shortest column, oldest first, so the
// desk reads top-to-bottom like a notebook and scrolls when it fills up.
function layout(animate = false) {
  const W = desk.clientWidth;
  const cols = Math.max(1, Math.floor((W - GAP) / (MIN_COL + GAP)));
  const w = (W - GAP * (cols + 1)) / cols;
  const heights = Array(cols).fill(GAP);
  for (const p of panes.values()) {
    if (p.pinned || p.maximized || p.isMin()) continue;
    const c = heights.indexOf(Math.min(...heights));
    p.setRect({ x: GAP + c * (w + GAP), y: heights[c], w, h: p.natH }, animate && p.placed);
    p.placed = true;
    heights[c] += p.natH + GAP;
  }
}
// Put every pane back into the flow (undo drags, resizes and maximize).
function arrange() {
  for (const p of panes.values()) {
    p.pinned = false; p.autoMax = false;
    if (p.userSized) { p.userSized = false; p.shrinkToContent(); }
    if (p.maximized) p.maximize(false);
  }
  layout(true);
}
function clearFinished() { for (const p of [...panes.values()]) if (p.status !== 'running') p.close(); }

// ---------------------------------------------------------------- prompt
const history = (() => { try { return JSON.parse(localStorage.getItem('shelf.history') || localStorage.getItem('shelf.history') || '[]'); } catch { return []; } })();
let histIdx = history.length, draft = '';
function saveHistory() { try { localStorage.setItem('shelf.history', JSON.stringify(history.slice(-500))); } catch {} }

function focusPrompt() { input.focus(); }
function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight + 2, 180) + 'px'; }

function runInput() {
  const cmd = input.value.trim();
  if (!cmd) return;
  if (history[history.length - 1] !== cmd) { history.push(cmd); saveHistory(); }
  histIdx = history.length; draft = '';
  input.value = ''; autoGrow(); hideCompletions();
  if (cmd === 'clear' || cmd === 'cls') return clearFinished();
  new Pane(cmd);
}

input.addEventListener('input', () => { autoGrow(); hideCompletions(); });
input.addEventListener('keydown', (e) => {
  const v = input.value, pos = input.selectionStart;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); runInput(); }
  else if (e.key === 'Tab') { e.preventDefault(); requestCompletion(); }
  else if (e.key === 'Escape') { hideCompletions(); }
  else if (e.key === 'ArrowUp' && !v.slice(0, pos).includes('\n')) {
    if (histIdx > 0) { if (histIdx === history.length) draft = v; histIdx--; setInput(history[histIdx]); e.preventDefault(); }
  } else if (e.key === 'ArrowDown' && !v.slice(pos).includes('\n')) {
    if (histIdx < history.length) { histIdx++; setInput(histIdx === history.length ? draft : history[histIdx]); e.preventDefault(); }
  } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); clearFinished(); }
});
function setInput(v) { input.value = v; autoGrow(); input.selectionStart = input.selectionEnd = v.length; }

// Ctrl+` from anywhere (even inside a running pane) returns to the prompt.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.code === 'Backquote' || e.key === '`')) { e.preventDefault(); e.stopPropagation(); focusPrompt(); }
}, true);

// ------------------------------------------------------------ completion
let compReq = 0;
function requestCompletion() {
  const line = input.value.slice(0, input.selectionStart);
  send({ type: 'complete', reqId: ++compReq, line });
}
const shellEscape = (s) => s.replace(/([ '"()&;|<>$`\\!*?[\]{}#])/g, '\\$1');
function replaceWord(word, replacement) {
  const pos = input.selectionStart, before = input.value.slice(0, pos);
  if (!before.endsWith(word)) return;
  const head = before.slice(0, before.length - word.length);
  input.value = head + replacement + input.value.slice(pos);
  input.selectionStart = input.selectionEnd = head.length + replacement.length;
  autoGrow();
}
function commonPrefix(items) {
  let p = items[0];
  for (const s of items) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}
function onCompletions({ reqId, word, items }) {
  if (reqId !== compReq || !items.length) return hideCompletions();
  if (items.length === 1) {
    const it = items[0];
    replaceWord(word, shellEscape(it) + (it.endsWith('/') ? '' : ' '));
    return hideCompletions();
  }
  const pre = commonPrefix(items);
  if (pre.length > word.length) replaceWord(word, shellEscape(pre));
  const typed = pre.length > word.length ? shellEscape(pre) : word;
  compEl.innerHTML = '';
  for (const it of items.slice(0, 60)) {
    const b = el('button');
    const label = it.endsWith('/') ? it.slice(0, -1).split('/').pop() + '/' : it.split('/').pop();
    b.textContent = label || it;
    b.title = it;
    b.onclick = () => { replaceWord(typed, shellEscape(it) + (it.endsWith('/') ? '' : ' ')); hideCompletions(); focusPrompt(); };
    compEl.appendChild(b);
  }
  if (items.length > 60) compEl.appendChild(el('span', 'more', `+${items.length - 60} more`));
  compEl.hidden = false;
}
function hideCompletions() { compEl.hidden = true; compEl.innerHTML = ''; }

// ------------------------------------------------------------------ init
$('#arrange').onclick = () => { arrange(); focusPrompt(); };
$('#clearDone').onclick = () => { clearFinished(); focusPrompt(); };
// Panes may hang off the right edge; never let that scroll the desk sideways.
desk.addEventListener('scroll', () => { if (desk.scrollLeft) desk.scrollLeft = 0; });
desk.addEventListener('mousedown', (e) => { if (e.target === desk || e.target === emptyEl) setTimeout(focusPrompt, 0); });
window.addEventListener('resize', () => { layout(); for (const p of panes.values()) if (!p.isMin()) p.clampIntoDesk(); });
connect();
focusPrompt();
