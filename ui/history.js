import { ui } from './store.svelte.js';

export const history = { items: [] };   // oldest first; shared by every prompt

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

// Suggestions under a prompt while typing; untrusted (scripted) input events, like picks and completions, close them.
export function suggest(e) {
  const input = e.target, q = input.value;
  ui.hsearch = e.isTrusted && q.trim() ? { input, q, sel: 0 } : null;
}
export function hideSuggest() { ui.hsearch = null; }

// ↑/↓ move the selection, Enter or Tab (or → at the end of the line) picks; picking closes the list,
// so a second Enter runs the pick. True when the key was used.
export function navKey(e) {
  const s = ui.hsearch;
  if (s?.input !== e.target) return false;
  const found = matches(s.q);
  if (!found.length) return false;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { closeSearch(found[s.sel]); e.preventDefault(); return true; }
  const step = { ArrowUp: 1, ArrowDown: -1 }[e.key];
  if (step) s.sel = Math.max(0, Math.min(found.length - 1, s.sel + step));
  else if (e.key === 'Tab' || (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length)) closeSearch(found[s.sel]);
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
