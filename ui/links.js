// File links in terminal output: find them (paths.js), keep only those core.js's stat says exist, open them.
import { findPaths } from './paths.js';
import { send } from './conn.js';
import { ui, handlers, terms, paneById, selected } from './store.svelte.js';

let reqSeq = 0;
const pending = new Map();
const cache = new Map();   // base + '\n' + path -> { at, it: { path, abs, exists, isDir } }
handlers.stat = (m) => { pending.get(m.reqId)?.(m.items); pending.delete(m.reqId); };

// Map of path -> stat result for paths as seen from `base`; results are reused for a few seconds.
function stat(tab, base, paths) {
  const key = (p) => base + '\n' + p, fresh = Date.now() - 3000;
  const miss = [...new Set(paths)].filter((p) => !(cache.get(key(p))?.at > fresh));
  if (cache.size > 2000) cache.clear();
  const ready = !miss.length ? Promise.resolve() : new Promise((res) => {
    const reqId = ++reqSeq;
    pending.set(reqId, res);
    send({ type: 'stat', reqId, tab, base, paths: miss });
  }).then((items) => { for (const it of items) cache.set(key(it.path), { at: Date.now(), it }); });
  return ready.then(() => new Map(paths.map((p) => [p, cache.get(key(p))?.it])));
}

// The logical line through buffer row y (0-based): soft-wrapped rows joined, each UTF-16 index mapped to its cell.
function logicalLine(term, y) {
  const buf = term.buffer.active, cell = buf.getNullCell();
  while (y > 0 && buf.getLine(y)?.isWrapped) y--;
  let text = '';
  const cells = [];
  for (let r = y, line; (line = buf.getLine(r)) && (r === y || line.isWrapped); r++) {
    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell);
      const w = cell.getWidth();
      if (!w) continue;   // the right half of a wide character
      const ch = cell.getChars() || ' ';
      for (let i = 0; i < ch.length; i++) cells.push({ x, y: r, w });
      text += ch;
    }
  }
  return { text, cells };
}

// The existing files on the logical line through buffer row y, with their xterm ranges (1-based, end inclusive).
export async function linksAt(pane, y) {
  const term = terms.get(pane.id)?.term;
  if (!term) return [];
  const { text, cells } = logicalLine(term, y);
  const found = findPaths(text);
  if (!found.length) return [];
  const info = await stat(pane.tab, pane.runCwd || pane.cwd, found.map((m) => m.path));
  return found.filter((m) => info.get(m.path)?.exists).map((m) => {
    const a = cells[m.start], b = cells[m.end - 1];
    return {
      ...m, info: info.get(m.path), text: text.slice(m.start, m.end),
      label: m.path + (m.line ? ':' + m.line : '') + (m.col ? ':' + m.col : ''),
      range: { start: { x: a.x + 1, y: a.y + 1 }, end: { x: b.x + b.w, y: b.y + 1 } },
    };
  });
}

export const openLink = (pane, l) =>
  send({ type: 'open', tab: pane.tab, abs: l.info.abs, line: l.line ?? 0, col: l.col ?? 0, isDir: l.info.isDir });

// ---------------------------------------------------------------- hints
const KEYS = 'asdfghjklqwertyuiopzxcvbnm', HOME = 'asdfghjkl';
const labels = (n) => (n <= KEYS.length ? [...KEYS] : [...HOME].flatMap((a) => [...HOME].map((b) => a + b))).slice(0, n);

// Ctrl+; o: label every visible link in the selected terminal; typing a label opens it.
export async function showHints(p = selected()) {
  const term = terms.get(p?.id)?.term;
  const screen = term?.element?.querySelector('.xterm-screen');
  if (!screen) return;
  const buf = term.buffer.active, top = buf.viewportY, bottom = top + term.rows;
  const rows = [];
  for (let y = top; y < bottom; y++) if (y === top || !buf.getLine(y)?.isWrapped) rows.push(y);
  const links = (await Promise.all(rows.map((y) => linksAt(p, y)))).flat()
    .filter((l) => l.range.start.y - 1 >= top && l.range.start.y - 1 < bottom);
  if (!links.length) return;
  const r = screen.getBoundingClientRect(), cw = r.width / term.cols, ch = r.height / term.rows;
  const ls = labels(links.length);
  ui.hints = {
    pane: p.id, typed: '',
    items: ls.map((label, i) => ({
      label, link: links[i],
      left: r.left + (links[i].range.start.x - 1) * cw, top: r.top + (links[i].range.start.y - 1 - top) * ch,
    })),
  };
}

// A key while hints show: letters narrow them down and open the one typed; anything else cancels.
export function hintKey(e) {
  const h = ui.hints, typed = h.typed + (/^Key[A-Z]$/.test(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey ? e.code[3].toLowerCase() : '\0');
  const hit = h.items.find((i) => i.label === typed);
  if (hit) { ui.hints = null; const p = paneById(h.pane); if (p) openLink(p, hit.link); }
  else if (h.items.some((i) => i.label.startsWith(typed))) h.typed = typed;
  else ui.hints = null;
}
