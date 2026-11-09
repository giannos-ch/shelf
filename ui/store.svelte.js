import { tick } from 'svelte';
import { connect, send } from './conn.js';
import * as L from './layout.js';
import { THEMES } from './themes.js';

// xterm instances live outside $state so they are never proxied.
export const terms = new Map();   // pane id -> { term, fit, lastSize }
export const els = { prompt: null, desk: null };
export const handlers = { completions: null, history: null, stat: null, 'git-files': null, 'git-log': null, 'git-show': null, 'git-diff': null, 'git-key': null };

let paneSeq = 0, tabSeq = 0;
// `selected` is the focused terminal, or the last one focused while the prompt has focus; `recent` is the focus history.
const makeTab = (cwd = '') => ({ id: 't' + (++tabSeq), cwd, tree: null, selected: null, recent: [], maximized: null, lastCreated: null, git: null });

export const ui = $state({
  tabs: [makeTab()],
  active: 't1',
  panes: [],
  mode: 'prompt',          // where keys go: 'prompt' | 'pane' (the selected terminal) | 'side' (the closed list)
  layer: false,            // the Ctrl+; command layer is open
  sideFrom: 'prompt',      // mode to return to when leaving the closed list
  sidebar: false,
  sideSel: null,
  help: false,
  home: '',
  connected: true,
  desk: { w: 0, h: 0 },
  drag: null,
  comp: null,
  hsearch: null,           // { input, q } while a history search is open
  hints: null,             // { pane, typed, items } while Ctrl+; o labels links
  runs: null,              // id of the terminal whose history list is open
  gitpop: false,           // the git popup is open from Ctrl+; g and takes the keys
  settings: false,         // the settings panel is open
  prefs: { editor: '', theme: 'dark', fontSize: 13, fontFamily: '', cursorStyle: 'block' },   // core.js's SETTINGS, saved in prefsFile
  prefsFile: '',
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
// When something happened, git-log style: "just now", "5 minutes ago", "2 days ago".
export function fmtAgo(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'just now';
  for (const [n, u] of [[86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']]) {
    if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? 's' : ''} ago`; }
  }
}

const box = () => ({ x: L.GAP, y: L.GAP, w: Math.max(0, ui.desk.w - 2 * L.GAP), h: Math.max(0, ui.desk.h - 2 * L.GAP) });
const fullRects = (tab) => L.rects(tab.tree, box()).panes;
export function layoutOf(tab) {
  if (tab?.maximized) return { panes: new Map([[tab.maximized, box()]]), dividers: [] };
  return L.rects(tab?.tree, box());
}

// ------------------------------------------------------------ messages
// --------------------------------------------------------------- settings
const darkOS = matchMedia('(prefers-color-scheme: dark)');
const theme = () => THEMES[ui.prefs.theme === 'system' ? (darkOS.matches ? 'dark' : 'light') : ui.prefs.theme] || THEMES.dark;

// Options for a new or existing xterm from the settings (--mono already includes the font setting).
export const termOptions = () => ({
  theme: theme().term, fontSize: ui.prefs.fontSize, cursorStyle: ui.prefs.cursorStyle,
  fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
});

function applyPrefs() {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(theme().css)) root.setProperty('--' + k, v);
  if (ui.prefs.fontFamily.trim()) root.setProperty('--font', ui.prefs.fontFamily); else root.removeProperty('--font');
  const opts = termOptions();
  for (const [id, t] of terms) { Object.assign(t.term.options, opts); if (t.view) Object.assign(t.view.options, opts); refit(id); }
}
applyPrefs();
darkOS.addEventListener('change', () => ui.prefs.theme === 'system' && applyPrefs());

export const openSettings = () => { ui.layer = false; ui.settings = true; };
export const closeSettings = () => { ui.settings = false; focusPrompt(); };
export const savePrefs = (patch) => send({ type: 'settings-set', settings: { ...$state.snapshot(ui.prefs), ...patch } });

// Fits a terminal to its box and tells a running program its new size.
export function refit(id) {
  const t = terms.get(id), p = paneById(id);
  if (!t?.term.element?.clientWidth || !t.term.element.clientHeight) return;
  try { t.fit.fit(); } catch { return; }
  const { cols, rows } = t.term;
  if (p?.status === 'running' && (cols !== t.lastSize.cols || rows !== t.lastSize.rows)) send({ type: 'resize', id, cols, rows });
  t.lastSize = { cols, rows };
}

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
    case 'state': ui.home = m.home; if (m.tab && tabById(m.tab)) Object.assign(tabById(m.tab), { cwd: m.cwd, git: m.git }); break;
    case 'started': if (p) p.cwd = p.runCwd = m.cwd; break;
    case 'data':
      if (p && !p.gotOutput) p.gotOutput = true;
      { const t = terms.get(m.id); if (t) { t.buf += m.data; t.term.write(m.data); } }
      break;
    case 'exit': if (p) { if (m.cwd) p.cwd = m.cwd; finish(p, m.code, m.ms, null, m.typed); } break;
    case 'completions': handlers.completions?.(m); break;
    case 'history': handlers.history?.(m); break;
    case 'stat': handlers.stat?.(m); break;
    case 'git-files': case 'git-log': case 'git-show': case 'git-diff': handlers[m.type]?.(m); break;
    case 'settings': ui.prefs = m.settings; ui.prefsFile = m.file; applyPrefs(); break;
    case 'open-pane': if (m.tab === ui.active) runCommand(m.cmd, true, true); break;
    case 'cd': if (!m.ok) runCommand(m.cmd, false, true); break;
  }
}

function finish(p, code, ms, reason = null, typed = '') {
  Object.assign(p, { status: code === 0 ? 'ok' : 'err', code, ms: ms ?? Date.now() - p.started, reason });
  if (reason !== 'disconnected') notify(p, code === 0 ? 'done' : `exit ${code}`);
  const t = terms.get(p.id);
  // ponytail: each run's raw output is kept whole for the pane's lifetime, capped at 50 runs; trim data if memory matters.
  p.runs.push({ cmd: p.cmd, cwd: p.runCwd, status: p.status, code, ms: p.ms, started: p.started, reason, data: t?.buf ?? '' });
  if (p.runs.length > 50) { p.runs.shift(); if (p.viewing != null) p.viewing = p.viewing ? p.viewing - 1 : null; }
  if (t) {
    t.term.options.disableStdin = true;
    t.term.options.cursorBlink = false;
    t.term.write('\x1b[?25l');
  }
  // Keys the command never read move into the terminal's own prompt.
  if (typed) tick().then(() => { const i = t?.input; if (i) { i.value = typed; i.selectionStart = i.selectionEnd = typed.length; } });
  // Focus follows the terminal into its own prompt.
  if (selected() === p) refocus();
}

// ------------------------------------------------------- notifications
// Flags a terminal (OSC 9/777, bell, finished) unless it is the one being looked at; looking at it clears the flag.
export function notify(p, text) {
  if (document.hasFocus() && ui.mode === 'pane' && selected() === p && !p.closed) return;
  p.notify = text;
}
export const tabNotified = (t) => ui.panes.some((p) => p.tab === t.id && !p.closed && p.notify);
window.addEventListener('focus', () => { const p = selected(); if (p && ui.mode === 'pane') p.notify = null; });

// ---------------------------------------------------------------- focus
export function focusPrompt() {
  ui.mode = 'prompt';
  els.prompt?.focus();
}

// Focuses a terminal of the active tab (the selected one by default): a running one's xterm, a finished one's prompt.
export async function focusPane(id = activeTab()?.selected) {
  if (!id || !paneById(id)) return focusPrompt();
  select(id);
  ui.mode = 'pane';
  await tick();
  const p = paneById(id), t = terms.get(id);
  if (ui.mode === 'pane' && activeTab()?.selected === id) (p?.status === 'running' ? shownTerm(id) : t?.input)?.focus();
}

// After the selected terminal changes or re-renders, keep the keyboard on it (or the prompt if there is none).
const refocus = () => ui.mode === 'pane' && focusPane();

function bottomPane() {
  const rs = [...fullRects(activeTab()).entries()];
  rs.sort(([, a], [, b]) => b.y + b.h - (a.y + a.h) || a.x - b.x);
  return rs[0]?.[0];
}
export const focusLast = () => focusPane(activeTab()?.selected || bottomPane());
export const toggleFocus = () => (ui.mode === 'prompt' ? focusLast() : focusPrompt());

export function focusDir(dir) {
  const tab = activeTab();
  const next = tab?.selected && L.neighbor(fullRects(tab), tab.selected, dir);
  if (next) focusPane(next);
  else if (dir === 'down') focusPrompt();
}

export function focusPrevious() {
  const tab = activeTab(), live = L.leaves(tab?.tree);
  const cur = ui.mode === 'pane' ? tab.selected : null;
  const prev = tab?.recent.filter((id) => id !== cur && live.includes(id)).pop();
  if (prev) focusPane(prev);
}

// ---------------------------------------------------------------- panes
function insertInto(tab, id) {
  tab.tree = L.insert(tab.tree, tab.lastCreated, id, 'bottom');
  tab.lastCreated = id;
  setSelected(tab, id);
  tab.maximized = null;
}

function detach(p) {
  const tab = tabById(p.tab);
  if (!tab || !L.leaves(tab.tree).includes(p.id)) return;
  if (tab.selected === p.id) {
    const map = fullRects(tab);
    tab.selected = ['down', 'up', 'right', 'left'].map((d) => L.neighbor(map, p.id, d)).find(Boolean) ?? null;
    if (tab.maximized === p.id) tab.maximized = tab.selected;
    if (tab.id === ui.active) refocus();
  }
  tab.recent = tab.recent.filter((id) => id !== p.id);
  tab.tree = L.remove(tab.tree, p.id);
  if (tab.maximized === p.id) tab.maximized = null;
}

function start(id, cwd) {
  const p = paneById(id), t = terms.get(id);
  if (!p || !t) return;
  try { t.fit.fit(); } catch {}
  Object.assign(p, { status: 'running', started: Date.now(), gotOutput: false, code: null, ms: null, reason: null, viewing: null });
  t.buf = '';
  if (ui.runs === id) ui.runs = null;
  ui.now = Date.now();
  t.term.options.disableStdin = false;
  t.term.options.cursorBlink = true;
  t.term.write('\x1b[?25h');
  const { cols, rows } = t.term;
  t.lastSize = { cols, rows };
  send({ type: 'run', id, tab: p.tab, cmd: p.cmd, cols, rows, cwd });
  if (selected() === p) refocus();
}

const CD = /^cd(?:\s+([^\s'"`$\\;&|<>(){}*?[\]!#]+))?$/;

export async function runCommand(cmd, focus = false, inPane = false) {
  const cd = !inPane && cmd.match(CD);
  if (cd) return send({ type: 'cd', tab: ui.active, path: cd[1] ?? '', cmd });
  const tab = activeTab();
  const id = addPane(tab, cmd, tab.cwd);
  insertInto(tab, id);
  await tick();
  start(id);
  if (focus) focusPane(id);
}

function addPane(tab, cmd, cwd) {
  const id = 'p' + (++paneSeq);
  ui.panes.push({ id, tab: tab.id, cmd, cmds: [cmd], runs: [], viewing: null, cwd, runCwd: cwd, status: 'running', closed: false, closedAt: 0, pinned: false, notify: null, started: Date.now(), gotOutput: false, code: null, ms: null, reason: null });
  return id;
}

// Run the terminal's command again in a new terminal beside it, split along its longer side.
export async function duplicate(p = selected()) {
  const tab = activeTab();
  if (!p || !tab) return;
  const r = fullRects(tab).get(p.id);
  const id = addPane(tab, p.cmd, p.runCwd);
  tab.tree = L.insert(tab.tree, p.id, id, r && r.w > r.h * 2 ? 'right' : 'bottom');
  setSelected(tab, id);
  tab.maximized = null;
  await tick();
  start(id, p.runCwd);
  refocus();
}

function setSelected(tab, id) {
  tab.selected = id;
  tab.recent = [...tab.recent.filter((x) => x !== id), id].slice(-20);
}

export function select(id) {
  const tab = activeTab();
  if (!tab || !id) return;
  setSelected(tab, id);
  paneById(id).notify = null;
  if (tab.maximized) tab.maximized = id;
}

// A running terminal goes to the closed list; a finished one is removed for good.
export function closePane(p = selected()) {
  if (!p || p.closed) return;
  if (p.status !== 'running') return destroy(p);
  detach(p);
  p.closed = true;
  p.closedAt = Date.now();
}

export async function reopen(p = closedPanes()[0]) {
  if (!p) return;
  p.closed = false;
  p.notify = null;
  p.tab = ui.active;
  insertInto(activeTab(), p.id);
  refocus();
}

export function destroy(p) {
  if (!p) return;
  if (p.status === 'running') send({ type: 'kill', id: p.id });
  if (!p.closed) detach(p);
  terms.get(p.id)?.term.dispose();
  terms.delete(p.id);
  ui.panes.splice(ui.panes.indexOf(p), 1);
}

export function kill(p = selected()) { if (p?.status === 'running') send({ type: 'kill', id: p.id }); }

// Pastes clipboard text into a running terminal (bracketed if the program asked); with no text
// (say, an image) it sends a plain ^V so the program can read the clipboard itself.
export function paste(p = selected()) {
  const t = terms.get(p?.id);
  Promise.resolve(navigator.clipboard?.readText()).catch(() => '').then((text) => {
    if (!t || p.status !== 'running') return;
    if (text) t.term.paste(text);
    else send({ type: 'input', id: p.id, data: '\x16' });
  });
}

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
  p.cmds.push(p.cmd);
  t.term.reset();
  start(p.id, p.cwd);
}

// Show an earlier run of a terminal over its own (index into p.runs), or null for its own output.
// A finished terminal's own output is its last run.
export function viewRun(p, i) {
  if (!p || (i != null && !p.runs[i])) return;
  p.viewing = i === p.runs.length - 1 && p.status !== 'running' ? null : i;
  if (selected() === p) refocus();   // the terminal that had the keys may be gone or hidden
}
// Move through the selected terminal's runs: -1 older, +1 newer (p.runs.length is the running command's live terminal).
export function stepRun(d, p = selected()) {
  if (!p?.runs.length) return;
  const last = p.status === 'running' ? p.runs.length : p.runs.length - 1;
  const i = Math.max(0, Math.min(last, (p.viewing ?? last) + d));
  viewRun(p, i === p.runs.length ? null : i);
}
export function openRuns(p = selected()) { if (p?.runs.length) ui.runs = p.id; }

const finished = () => L.leaves(activeTab()?.tree).map(paneById).filter((p) => p.status !== 'running' && !p.pinned);
export function clearFinished() { for (const p of finished()) destroy(p); }
export function togglePin(p = selected()) { if (p) p.pinned = !p.pinned; }

// ------------------------------------------------------------- sidebar
export function openSidebar() {
  if (ui.mode !== 'side') ui.sideFrom = ui.mode;
  ui.sidebar = true;
  ui.sideSel = closedPanes()[0]?.id ?? null;
  ui.mode = 'side';
  els.desk?.focus({ preventScroll: true });
}
// Back to wherever the keyboard was before the list was opened; the list stays visible.
export const leaveSidebar = () => (ui.sideFrom === 'pane' ? focusPane() : focusPrompt());
export function closeSidebar() {
  ui.sidebar = false;
  if (ui.mode === 'side') leaveSidebar();
}
export function sideMove(d) {
  const list = closedPanes();
  if (!list.length) return;
  const i = list.findIndex((p) => p.id === ui.sideSel);
  ui.sideSel = list[Math.max(0, Math.min(list.length - 1, i + d))].id;
}
// Act on the highlighted closed terminal, then highlight the one that took its place.
export async function sideAct(fn) {
  const list = closedPanes(), i = list.findIndex((p) => p.id === ui.sideSel);
  if (i < 0) return leaveSidebar();
  await fn(list[i]);
  const rest = closedPanes();
  ui.sideSel = rest[Math.min(i, rest.length - 1)]?.id ?? null;
  if (!ui.sideSel) leaveSidebar();
}

export function toggleMax() {
  const tab = activeTab();
  if (!tab?.selected) return;
  tab.maximized = tab.maximized ? null : tab.selected;
}

export function swapDir(dir) {
  const tab = activeTab();
  const other = tab?.selected && L.neighbor(fullRects(tab), tab.selected, dir);
  if (other) tab.tree = L.swap(tab.tree, tab.selected, other);
}

export function rotate() {
  const tab = activeTab();
  if (tab?.selected && !tab.maximized) tab.tree = L.rotate(tab.tree, tab.selected);
}

export function nudge(side) {
  const tab = activeTab();
  if (tab?.selected && !tab.maximized) tab.tree = L.nudge(tab.tree, tab.selected, side);
}

export function equalize() { const tab = activeTab(); if (tab) tab.tree = L.equalize(tab.tree); }

// The terminal on screen in a pane: a past run's view, else its own.
export const shownTerm = (id) => { const t = terms.get(id); return paneById(id)?.viewing != null && t?.view || t?.term; };
const selTerm = () => shownTerm(selected()?.id);
export const hasSelection = () => !!selTerm()?.hasSelection();
export function copySelection() {
  const t = selTerm(), text = t?.getSelection().replace(/\s+$/, '');
  if (text) navigator.clipboard?.writeText(text).catch(() => {});
  t?.clearSelection();
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
  if (activate) { ui.active = t.id; refocus(); }
  return tabById(t.id);
}

export const newWindow = () => send({ type: 'new-window', cwd: activeTab()?.cwd });

export function gotoTab(i) {
  const t = ui.tabs[i];
  if (!t) return;
  ui.active = t.id;
  refocus();
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
  if (ui.active === id) { ui.active = ui.tabs[Math.max(0, i - 1)].id; refocus(); }
}

export const tabEmpty = () => !L.leaves(activeTab()?.tree).length;
export function closeTabOrWindow() { ui.tabs.length === 1 ? window.close() : closeTab(); }

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
  setSelected(tab, p.id);
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

export function insertText(el, text) {
  if (!el || !text) return;
  el.focus();
  document.execCommand('insertText', false, text);
}

// The selection in a pane's terminal, else in any terminal.
export function termSelection(id) {
  const own = shownTerm(id);
  if (own?.hasSelection()) return own.getSelection();
  for (const t of terms.values()) for (const x of [t.term, t.view]) if (x?.hasSelection()) return x.getSelection();
  return '';
}

// Text dropped on a prompt is typed into it; on a running terminal it is pasted to the program.
export function dropText(text, target) {
  if (!text || !target) return;
  if (target.closest('#prompt')) return insertText(els.prompt, text);
  const id = target.closest('[data-pane]')?.dataset.pane, p = paneById(id), t = terms.get(id);
  if (!p || !t) return;
  if (p.status !== 'running') return insertText(t.input, text);
  focusPane(id);
  t.term.paste(text);
}

export function startTextDrag(e, term, text) {
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  let on = false;
  const move = (ev) => {
    if (!on && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
    on = true;
    ui.drag = { x: ev.clientX, y: ev.clientY, label: text };
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    ui.drag = null;
    if (on) dropText(text, document.elementFromPoint(ev.clientX, ev.clientY));
    else term.clearSelection();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
}

// Reorders live: the tab goes after every other tab whose middle is left of the pointer.
export function startTabDrag(e, id) {
  if (e.button !== 0) return;
  const sx = e.clientX;
  let on = false;
  const move = (ev) => {
    if (!on && Math.abs(ev.clientX - sx) < 5) return;
    on = true;
    const others = [...document.querySelectorAll('#tabs [data-tab]')].filter((el) => el.dataset.tab !== id);
    const to = others.filter((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2 < ev.clientX; }).length;
    const from = ui.tabs.findIndex((t) => t.id === id);
    if (to !== from) ui.tabs.splice(to, 0, ...ui.tabs.splice(from, 1));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
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
