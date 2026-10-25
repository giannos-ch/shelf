import { tick } from 'svelte';
import { connect, send } from './conn.js';
import * as L from './layout.js';

// xterm instances live outside $state so they are never proxied.
export const terms = new Map();   // pane id -> { term, fit, lastSize }
export const els = { prompt: null, desk: null };
export const handlers = { completions: null, history: null };

let paneSeq = 0, tabSeq = 0;
const makeTab = (cwd = '') => ({ id: 't' + (++tabSeq), cwd, tree: null, selected: null, maximized: null, lastCreated: null });

export const ui = $state({
  tabs: [makeTab()],
  active: 't1',
  panes: [],
  mode: 'prompt',          // 'prompt' | 'view' | 'insert'
  sidebar: true,
  help: false,
  home: '',
  connected: true,
  desk: { w: 0, h: 0 },
  drag: null,
  comp: null,
  now: Date.now(),
});
setInterval(() => { if (ui.panes.some((p) => p.status === 'running')) ui.now = Date.now(); }, 1000);

export const tabById = (id) => ui.tabs.find((t) => t.id === id);
export const paneById = (id) => ui.panes.find((p) => p.id === id);
export const activeTab = () => tabById(ui.active);
export const selected = () => paneById(activeTab()?.selected);
export const closedPanes = () => ui.panes.filter((p) => p.closed).sort((a, b) => b.closedAt - a.closedAt);

export const tilde = (d) => (ui.home && d && (d === ui.home || d.startsWith(ui.home + '/')) ? '~' + d.slice(ui.home.length) : d || '');
export const tabTitle = (t) => (tilde(t.cwd) === '~' ? '~' : (t.cwd || '').split('/').filter(Boolean).pop() || '/');
export function fmtDur(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;
}

const box = () => ({ x: L.GAP, y: L.GAP, w: Math.max(0, ui.desk.w - 2 * L.GAP), h: Math.max(0, ui.desk.h - 2 * L.GAP) });
const fullRects = (tab) => L.rects(tab.tree, box()).panes;
export function layoutOf(tab) {
  if (tab?.maximized) return { panes: new Map([[tab.maximized, box()]]), dividers: [] };
  return L.rects(tab?.tree, box());
}

// ------------------------------------------------------------ messages
export function init() {
  connect({
    onMessage,
    onOpen: () => { ui.connected = true; for (const t of ui.tabs) send({ type: 'tab-open', tab: t.id }); send({ type: 'history' }); },
    onClose: () => {
      ui.connected = false;
      for (const p of ui.panes) if (p.status === 'running') finish(p, null, null, 'disconnected');
    },
  });
}

function onMessage(m) {
  const p = m.id ? paneById(m.id) : null;
  switch (m.type) {
    case 'state': ui.home = m.home; if (m.tab && tabById(m.tab)) tabById(m.tab).cwd = m.cwd; break;
    case 'started': if (p) p.cwd = p.runCwd = m.cwd; break;
    case 'data':
      if (p && !p.gotOutput) p.gotOutput = true;
      terms.get(m.id)?.term.write(m.data);
      break;
    case 'exit': if (p) { if (m.cwd) p.cwd = m.cwd; finish(p, m.code, m.ms); } break;
    case 'completions': handlers.completions?.(m); break;
    case 'history': handlers.history?.(m); break;
    case 'cd': if (!m.ok) runCommand(m.cmd, false, true); break;
  }
}

function finish(p, code, ms, reason = null) {
  Object.assign(p, { status: code === 0 ? 'ok' : 'err', code, ms: ms ?? Date.now() - p.started, reason });
  const t = terms.get(p.id);
  if (t) {
    t.term.options.disableStdin = true;
    t.term.options.cursorBlink = false;
    t.term.write('\x1b[?25l');
  }
  // Insert mode follows the terminal into its own prompt.
  if (ui.mode === 'insert' && selected() === p) tick().then(() => setMode('insert'));
}

// ---------------------------------------------------------------- modes
export function setMode(mode) {
  if (mode === 'insert') {
    const p = selected(), t = terms.get(p?.id);
    if (!t) mode = 'view';
    else { ui.mode = 'insert'; (p.status === 'running' ? t.term : t.input)?.focus(); return; }
  }
  ui.mode = mode;
  if (mode === 'prompt') els.prompt?.focus();
  else els.desk?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- panes
function insertInto(tab, id) {
  tab.tree = L.insert(tab.tree, tab.lastCreated, id, 'bottom');
  tab.lastCreated = id;
  tab.selected = id;
  tab.maximized = null;
}

function detach(p) {
  const tab = tabById(p.tab);
  if (!tab || !L.leaves(tab.tree).includes(p.id)) return;
  if (tab.selected === p.id) {
    const map = fullRects(tab);
    tab.selected = ['down', 'up', 'right', 'left'].map((d) => L.neighbor(map, p.id, d)).find(Boolean) ?? null;
    if (tab.maximized === p.id) tab.maximized = tab.selected;
    if (ui.mode === 'insert' && tab.id === ui.active) setMode('view');
  }
  tab.tree = L.remove(tab.tree, p.id);
  if (tab.maximized === p.id) tab.maximized = null;
}

function start(id, cwd) {
  const p = paneById(id), t = terms.get(id);
  if (!p || !t) return;
  try { t.fit.fit(); } catch {}
  Object.assign(p, { status: 'running', started: Date.now(), gotOutput: false, code: null, ms: null, reason: null });
  ui.now = Date.now();
  t.term.options.disableStdin = false;
  t.term.options.cursorBlink = true;
  t.term.write('\x1b[?25h');
  const { cols, rows } = t.term;
  t.lastSize = { cols, rows };
  send({ type: 'run', id, tab: p.tab, cmd: p.cmd, cols, rows, cwd });
}

const CD = /^cd(?:\s+([^\s'"`$\\;&|<>(){}*?[\]!#]+))?$/;

export async function runCommand(cmd, insert = false, inPane = false) {
  const cd = !inPane && cmd.match(CD);
  if (cd) return send({ type: 'cd', tab: ui.active, path: cd[1] ?? '', cmd });
  const tab = activeTab();
  const id = 'p' + (++paneSeq);
  ui.panes.push({ id, tab: tab.id, cmd, cwd: tab.cwd, runCwd: tab.cwd, status: 'running', closed: false, closedAt: 0, pinned: false, started: Date.now(), gotOutput: false, code: null, ms: null, reason: null });
  insertInto(tab, id);
  await tick();
  start(id);
  if (insert) setMode('insert');
}

export function select(id) {
  const tab = activeTab();
  if (!tab || !id) return;
  tab.selected = id;
  if (tab.maximized) tab.maximized = id;
}

export function closePane(p = selected()) {
  if (!p || p.closed) return;
  detach(p);
  p.closed = true;
  p.closedAt = Date.now();
}

export async function reopen(p = closedPanes()[0]) {
  if (!p) return;
  p.closed = false;
  p.tab = ui.active;
  insertInto(activeTab(), p.id);
  await tick();
  if (ui.mode === 'insert') setMode('view');
}

export function destroy(p = selected()) {
  if (!p) return;
  if (p.status === 'running') send({ type: 'kill', id: p.id });
  if (!p.closed) detach(p);
  terms.get(p.id)?.term.dispose();
  terms.delete(p.id);
  ui.panes.splice(ui.panes.indexOf(p), 1);
}

export function kill(p = selected()) { if (p?.status === 'running') send({ type: 'kill', id: p.id }); }
export function interrupt(p = selected()) { if (p?.status === 'running') send({ type: 'input', id: p.id, data: '\x03' }); }
export function sendEsc(p = selected()) { if (p?.status === 'running') send({ type: 'input', id: p.id, data: '\x1b' }); }

export function rerun(p = selected()) {
  const t = p && terms.get(p.id);
  if (!t) return;
  if (p.status === 'running') send({ type: 'kill', id: p.id });
  t.term.reset();
  start(p.id, p.runCwd);
}

// Run another command in a finished terminal, replacing its output, where the last one ended.
export async function runInPane(p, cmd) {
  const t = p && terms.get(p.id);
  if (!t || p.status === 'running' || !cmd.trim()) return;
  p.cmd = cmd.trim();
  t.term.reset();
  start(p.id, p.cwd);
  await tick();
  if (ui.mode === 'insert' && selected() === p) t.term.focus();
}

const finished = () => L.leaves(activeTab()?.tree).map(paneById).filter((p) => p.status !== 'running' && !p.pinned);
export function shelveFinished() { for (const p of finished()) closePane(p); }
export function clearFinished() { for (const p of finished()) destroy(p); }
export function togglePin(p = selected()) { if (p) p.pinned = !p.pinned; }

export function toggleMax() {
  const tab = activeTab();
  if (!tab?.selected) return;
  tab.maximized = tab.maximized ? null : tab.selected;
}

export function selectDir(dir) {
  const tab = activeTab();
  if (!tab?.selected) return select(L.leaves(tab?.tree)[0]);
  select(L.neighbor(fullRects(tab), tab.selected, dir));
}

export function swapDir(dir) {
  const tab = activeTab();
  const other = tab?.selected && L.neighbor(fullRects(tab), tab.selected, dir);
  if (other) tab.tree = L.swap(tab.tree, tab.selected, other);
}

export function nudge(side) {
  const tab = activeTab();
  if (tab?.selected && !tab.maximized) tab.tree = L.nudge(tab.tree, tab.selected, side);
}

export function equalize() { const tab = activeTab(); if (tab) tab.tree = L.equalize(tab.tree); }

export function cycle(delta) {
  const ids = L.leaves(activeTab()?.tree);
  if (!ids.length) return;
  const i = ids.indexOf(activeTab().selected);
  select(ids[(i + delta + ids.length) % ids.length]);
}

const selTerm = () => terms.get(selected()?.id)?.term;
export function copySelection() {
  const text = selTerm()?.getSelection().replace(/\s+$/, '');
  if (text) navigator.clipboard?.writeText(text).catch(() => {});
}
export function selectAll() { selTerm()?.selectAll(); }
export function scroll(how) {
  const t = selTerm();
  if (!t) return;
  if (how === 'top') t.scrollToTop();
  else if (how === 'bottom') t.scrollToBottom();
  else t.scrollPages(how);
}

// ----------------------------------------------------------------- tabs
export function newTab(activate = true) {
  const from = activeTab();
  const t = makeTab(from?.cwd);
  ui.tabs.push(t);
  send({ type: 'tab-open', tab: t.id, from: from?.id });
  if (activate) ui.active = t.id;
  return tabById(t.id);
}

export function gotoTab(i) {
  const t = ui.tabs[i];
  if (!t) return;
  ui.active = t.id;
  if (ui.mode === 'insert') setMode('view');
}
const activeIndex = () => ui.tabs.findIndex((t) => t.id === ui.active);
export function shiftTab(d) { gotoTab((activeIndex() + d + ui.tabs.length) % ui.tabs.length); }

export function closeTab(id = ui.active) {
  const tab = tabById(id);
  if (!tab) return;
  for (const pid of L.leaves(tab.tree)) closePane(paneById(pid));
  if (ui.tabs.length === 1) newTab();
  const i = ui.tabs.indexOf(tab);
  ui.tabs.splice(i, 1);
  send({ type: 'tab-close', tab: id });
  if (ui.active === id) ui.active = ui.tabs[Math.max(0, i - 1)].id;
}

export function moveToTab(p, tabId) {
  const dest = tabById(tabId);
  if (!p || !dest || p.tab === tabId || p.closed) return;
  detach(p);
  p.tab = tabId;
  insertInto(dest, p.id);
}

export function moveToIndex(i, p = selected()) {
  if (!p || i < 0) return;
  const dest = ui.tabs[i] || newTab(false);
  moveToTab(p, dest.id);
}
export const moveBy = (d) => moveToIndex(activeIndex() + d);

// ---------------------------------------------------------------- mouse
function dock(p, target, side) {
  const tab = activeTab();
  if (!p || target === p.id) return;
  tab.tree = L.insert(L.remove(tab.tree, p.id), target, p.id, side);
  tab.selected = p.id;
}

export function startDrag(e, id) {
  if (e.button !== 0 || activeTab().maximized) return;
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  let on = false;
  const move = (ev) => {
    if (!on && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
    on = true;
    const base = { id, x: ev.clientX, y: ev.clientY, label: paneById(id)?.cmd };
    const tabEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-tab]');
    if (tabEl) { ui.drag = { ...base, tab: tabEl.dataset.tab }; return; }
    const d = els.desk.getBoundingClientRect();
    ui.drag = { ...base, drop: L.dropTarget(fullRects(activeTab()), box(), ev.clientX - d.left, ev.clientY - d.top, id) };
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    const dr = ui.drag;
    ui.drag = null;
    if (!dr) return;
    if (dr.tab) moveToTab(paneById(id), dr.tab);
    else if (dr.drop) dock(paneById(id), dr.drop.target, dr.drop.side);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
}

export function startResize(e, d) {
  if (e.button !== 0) return;
  e.preventDefault();
  const tab = activeTab();
  const from = $state.snapshot(tab.tree);
  const pos = (ev) => (d.dir === 'row' ? ev.clientX : ev.clientY);
  const s0 = pos(e);
  const move = (ev) => { tab.tree = L.resizeAt(from, d.path, d.i, (pos(ev) - s0) / d.total); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
}
