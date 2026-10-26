import { ui } from './store.svelte.js';

export const history = { items: [] };   // oldest first; shared by every prompt

// fzf-style: space-separated terms, substring matches before fuzzy ones, newest first.
const isSub = (t, s) => { let i = 0; for (const c of s) if (c === t[i]) i++; return i >= t.length; };
export function matches(q) {
  const items = history.items, terms = q.toLowerCase().split(/\s+/).filter(Boolean), seen = new Set(), exact = [], fuzzy = [];
  for (let i = items.length - 1; i >= 0 && exact.length < 100; i--) {
    const h = items[i], l = h.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    if (terms.every((t) => l.includes(t))) exact.push(h);
    else if (fuzzy.length < 100 && terms.every((t) => isSub(t, l))) fuzzy.push(h);
  }
  return exact.concat(fuzzy).slice(0, 100);
}

// Suggestions under a prompt while typing; untrusted (scripted) input events, like picks and completions, close them.
export function suggest(e) {
  const input = e.target, q = input.value;
  ui.hsearch = e.isTrusted && q.trim() ? { input, q, sel: 0 } : null;
}
export function hideSuggest() { ui.hsearch = null; }

// ↑/↓ move the selection, Tab picks. True when the key was used.
export function navKey(e) {
  const s = ui.hsearch;
  if (s?.input !== e.target) return false;
  const found = matches(s.q);
  if (!found.length) return false;
  const step = { ArrowUp: 1, ArrowDown: -1 }[e.key];
  if (step) s.sel = Math.max(0, Math.min(found.length - 1, s.sel + step));
  else if (e.key === 'Tab') closeSearch(found[s.sel]);
  else return false;
  e.preventDefault();
  return true;
}

// Puts `pick` (if any) into the prompt the suggestions belong to and focuses it again.
export function closeSearch(pick) {
  const input = ui.hsearch?.input;
  ui.hsearch = null;
  if (!input) return;
  if (pick != null) {
    input.value = pick;
    input.selectionStart = input.selectionEnd = pick.length;
    input.dispatchEvent(new Event('input'));
  }
  input.focus();
}
