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

export function toggleSearch(input) {
  if (ui.hsearch) closeSearch();
  else ui.hsearch = { input, q: input.value };
}
// Puts `pick` (if any) into the input that opened the search and focuses it again.
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
