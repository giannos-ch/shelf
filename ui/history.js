import { ui } from './store.svelte.js';
import { send } from './conn.js';

export const history = { items: [] };   // oldest first; shared by every prompt

// Called with the items reloaded from the history file.
export function setHistory(items) {
  history.items = items;
  if (nav && nav.idx > items.length) nav.idx = items.length;
}

// Every prompt records what it runs, so ↑ in any prompt reaches commands run from the others.
export function record(cmd) {
  const c = cmd.trim();
  if (!c) return;
  send({ type: 'history-add', cmd });
  if (history.items[history.items.length - 1] !== c) history.items.push(c);
  nav = null;
}

// Removes every copy of `cmd` from history, here and in the history file.
export function forget(cmd) {
  history.items = history.items.filter((h) => h !== cmd);
  send({ type: 'history-delete', cmd });
  nav = null;
}

// ↑/↓ through history (dir -1 / +1) in `input`, coming back to what was typed past the newest;
// only one prompt navigates at a time. The text to show, or null at either end.
let nav = null;   // { input, idx, draft }
export function recall(input, dir) {
  const items = history.items;
  if (nav?.input !== input) nav = { input, idx: items.length, draft: '' };
  const idx = nav.idx + dir;
  if (idx < 0 || idx > items.length) return null;
  if (nav.idx === items.length) nav.draft = input.value;
  nav.idx = idx;
  return idx === items.length ? nav.draft : items[idx];
}

// fzf-style: space-separated terms, closest match first (prefix, then word start, then substring,
// then fuzzy by how spread out it is), shorter commands first, then newest first.
// Scores one term against a lowercased command; null when it doesn't match even fuzzily.
function termScore(t, l) {
  const i = l.indexOf(t);
  if (i === 0) return 0;
  if (i > 0) return /[a-z0-9]/.test(l[i - 1]) ? 2 : 1;
  let j = 0, start = -1, end = -1;
  for (let k = 0; k < l.length && j < t.length; k++) if (l[k] === t[j]) { if (!j++) start = k; end = k; }
  return j < t.length ? null : 3 + end - start + 1 - t.length;
}
// ponytail: scores the whole history on every call; cache per query if it gets slow on huge histories.
export function matches(q) {
  const items = history.items, terms = q.toLowerCase().split(/\s+/).filter(Boolean), seen = new Set(), found = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const h = items[i], l = h.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    let score = 0;
    for (const t of terms) { const s = termScore(t, l); if (s == null) { score = null; break; } score += s; }
    if (score != null) found.push({ h, score });
  }
  found.sort((a, b) => a.score - b.score || a.h.length - b.h.length);   // stable: ties stay newest first
  return found.slice(0, 100).map((m) => m.h);
}

// Replaces input[start, end) with `text` as one edit Ctrl+Z can undo (setting .value would clear the undo stack).
// execCommand only edits the focused element; an unfocused input still changes, just not undoably.
let scripted = false;
export function replaceText(input, start, end, text) {
  input.setSelectionRange(start, end);
  scripted = true;
  try {
    if (document.activeElement !== input || !document.execCommand('insertText', false, text)) {
      input.setRangeText(text, start, end, 'end');
      input.dispatchEvent(new Event('input'));
    }
  } finally { scripted = false; }
}

// Suggestions under a prompt while typing; scripted edits, like picks and completions, close them.
export function suggest(e) {
  const input = e.target, q = input.value;
  ui.hsearch = e.isTrusted && !scripted && q.trim() ? { input, q, sel: 0 } : null;
}
export function hideSuggest() { ui.hsearch = null; }

// ↑/↓ move the selection, Enter or Tab (or → at the end of the line) picks; picking closes the list,
// so a second Enter runs the pick (one Enter does when the pick is already what was typed). Shift+Delete removes the selected match from history. True when the key was used.
export function navKey(e) {
  const s = ui.hsearch;
  if (s?.input !== e.target) return false;
  const found = matches(s.q);
  if (!found.length) return false;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    if (found[s.sel] === e.target.value) { ui.hsearch = null; return false; }   // nothing to pick: let Enter run it
    closeSearch(found[s.sel]); e.preventDefault(); return true;
  }
  if (e.key === 'Delete' && e.shiftKey) { forgetMatch(s.sel); e.preventDefault(); return true; }
  const step = { ArrowUp: 1, ArrowDown: -1 }[e.key];
  if (step) s.sel = Math.max(0, Math.min(found.length - 1, s.sel + step));
  else if (e.key === 'Tab' || (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length)) closeSearch(found[s.sel]);
  else return false;
  e.preventDefault();
  return true;
}

// Removes the i-th shown match from history, keeping the selection on the same command.
export function forgetMatch(i) {
  const s = ui.hsearch, found = matches(s.q);
  forget(found[i]);
  ui.hsearch = { ...s, sel: Math.max(0, Math.min(s.sel - (i < s.sel), found.length - 2)) };   // a new object so the list recomputes
}

// Puts `pick` (if any) into the prompt the suggestions belong to and focuses it again.
export function closeSearch(pick) {
  const input = ui.hsearch?.input;
  ui.hsearch = null;
  if (!input) return;
  if (pick != null) replaceText(input, 0, input.value.length, pick);
  input.focus();
}
