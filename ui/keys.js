import * as S from './store.svelte.js';
import { closeSearch } from './history.js';

const { ui } = S;
// Esc closes completions, then history suggestions, before acting.
const esc = (act) => () => (ui.comp ? (ui.comp = null) : ui.hsearch ? closeSearch() : act());
const DIR = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const SIDE = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' };
const arrows = (mod) => Object.keys(DIR).map((k) => mod + k);
const arrowOf = (k) => k.split('+').pop();
const digits = (mod) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => mod + n);

// Shortcuts without `run` are handled by the prompt itself and listed for help only.
export const SHORTCUTS = [
  { mode: 'any', label: 'Ctrl+`', keys: ['Ctrl+`'], desc: 'Focus the prompt', run: () => S.setMode('prompt') },

  { mode: 'prompt', label: 'Enter', desc: 'Run and type into its terminal (with history matches shown: pick the selected one)' },
  { mode: 'prompt', label: 'Ctrl+Enter', desc: 'Run and stay in the prompt' },
  { mode: 'prompt', label: 'Shift+Enter', desc: 'New line' },
  { mode: 'prompt', label: 'Tab', desc: 'Pick the selected history match (→ at line end too), else complete' },
  { mode: 'prompt', label: '↑ ↓ (typing)', desc: 'Select among history matches shown while typing' },
  { mode: 'prompt', label: '↑ ↓', desc: 'History' },
  { mode: 'prompt', label: 'Esc', keys: ['Escape'], desc: 'View mode (closes completions or suggestions first)', run: esc(() => S.setMode('view')) },
  { mode: 'prompt', label: 'Ctrl+L', keys: ['Ctrl+l'], desc: 'Remove finished, unpinned terminals in this tab for good', run: S.clearFinished },

  { mode: 'insert', label: 'Esc', keys: ['Escape'], desc: 'Back to view mode (closes completions or suggestions first)', run: esc(() => S.setMode('view')) },
  { mode: 'insert', label: 'Tab', desc: 'On a finished terminal: pick the selected history match, else complete' },
  { mode: 'insert', label: 'Enter', desc: 'On a finished terminal: run its prompt’s command in that terminal (with history matches shown: pick one)' },
  { mode: 'insert', label: '↑ ↓', desc: 'On a finished terminal: history (shared with the main prompt)' },
  { mode: 'insert', label: 'Ctrl+D', desc: 'On a finished terminal with an empty prompt: close it' },
  { mode: 'insert', label: 'Shift+Esc', keys: ['Shift+Escape'], desc: 'Send Esc to the program', run: () => S.sendEsc() },

  { mode: 'view', label: '←↑→↓', keys: arrows(''), desc: 'Select the terminal in that direction', run: (k) => S.selectDir(DIR[arrowOf(k)]) },
  { mode: 'view', label: 'Ctrl+Shift+←↑→↓', keys: arrows('Ctrl+Shift+'), desc: 'Swap with the terminal in that direction', run: (k) => S.swapDir(DIR[arrowOf(k)]) },
  { mode: 'view', label: 'Shift+←↑→↓', keys: arrows('Shift+'), desc: 'Move a border of the terminal', run: (k) => S.nudge(SIDE[arrowOf(k)]) },
  { mode: 'view', label: '=', keys: ['='], desc: 'Equalize sizes', run: S.equalize },
  { mode: 'view', label: 'Tab / Shift+Tab', keys: ['Tab', 'Shift+Tab'], desc: 'Next / previous terminal', run: (k) => S.cycle(k === 'Tab' ? 1 : -1) },
  { mode: 'view', label: 'i / Enter', keys: ['i', 'Enter'], desc: 'Insert mode: keys go to the terminal', run: () => S.setMode('insert') },
  { mode: 'view', label: ':', keys: [':'], desc: 'Focus the prompt', run: () => S.setMode('prompt') },
  { mode: 'view', label: 'Esc', keys: ['Escape'], desc: 'Close (keeps running, listed on the left)', run: () => S.closePane() },
  { mode: 'view', label: 'u', keys: ['u'], desc: 'Reopen the last closed terminal', run: () => S.reopen() },
  { mode: 'view', label: 'X', keys: ['X'], desc: 'Kill and remove for good', run: () => S.destroy() },
  { mode: 'view', label: 'm', keys: ['m'], desc: 'Maximize / restore', run: S.toggleMax },
  { mode: 'view', label: 'k', keys: ['k'], desc: 'Kill the command', run: () => S.kill() },
  { mode: 'view', label: 'c', keys: ['c'], desc: 'Send Ctrl+C (interrupt)', run: () => S.interrupt() },
  { mode: 'view', label: 'r', keys: ['r'], desc: 'Run again', run: () => S.rerun() },
  { mode: 'view', label: 'Ctrl+C', keys: ['Ctrl+c'], desc: 'Copy the selected text', run: S.copySelection },
  { mode: 'view', label: 'a', keys: ['a'], desc: 'Select all output', run: S.selectAll },
  { mode: 'view', label: 'g / G', keys: ['g', 'G'], desc: 'Scroll to top / bottom', run: (k) => S.scroll(k === 'g' ? 'top' : 'bottom') },
  { mode: 'view', label: 'PgUp / PgDn', keys: ['PageUp', 'PageDown'], desc: 'Scroll a page', run: (k) => S.scroll(k === 'PageUp' ? -1 : 1) },
  { mode: 'view', label: 'l', keys: ['l'], desc: 'Close finished, unpinned terminals in this tab', run: S.shelveFinished },
  { mode: 'view', label: 'Ctrl+L', keys: ['Ctrl+l'], desc: 'Remove finished, unpinned terminals in this tab for good', run: S.clearFinished },
  { mode: 'view', label: 'p', keys: ['p'], desc: 'Pin / unpin (pinned terminals survive l and Ctrl+L)', run: () => S.togglePin() },
  { mode: 'view', label: 't', keys: ['t'], desc: 'New tab (starts in this tab’s directory)', run: () => S.newTab() },
  { mode: 'view', label: 'w', keys: ['w'], desc: 'Close tab (its terminals go to the closed list)', run: () => S.closeTab() },
  { mode: 'view', label: '1 … 9', keys: digits(''), desc: 'Go to tab', run: (k) => S.gotoTab(+k - 1) },
  { mode: 'view', label: '[ / ]', keys: ['[', ']'], desc: 'Previous / next tab', run: (k) => S.shiftTab(k === '[' ? -1 : 1) },
  { mode: 'view', label: 'Shift+1 … 9', keys: digits('Shift+'), desc: 'Move terminal to tab', run: (k) => S.moveToIndex(+arrowOf(k) - 1) },
  { mode: 'view', label: '{ / }', keys: ['{', '}'], desc: 'Move terminal to previous / next tab (new tab past the end)', run: (k) => S.moveBy(k === '{' ? -1 : 1) },
  { mode: 'view', label: 'b', keys: ['b'], desc: 'Open the closed-terminals list and select its first entry', run: S.openSidebar },
  { mode: 'view', label: '?', keys: ['?'], desc: 'This help', run: () => (ui.help = true) },

  { mode: 'side', label: '↑ ↓', keys: ['ArrowUp', 'ArrowDown'], desc: 'Select a closed terminal', run: (k) => S.sideMove(k === 'ArrowUp' ? -1 : 1) },
  { mode: 'side', label: 'Enter', keys: ['Enter'], desc: 'Reopen it', run: () => S.sideAct(S.reopen) },
  { mode: 'side', label: 'Esc / X', keys: ['Escape', 'X'], desc: 'Kill and remove it for good', run: () => S.sideAct(S.destroy) },
  { mode: 'side', label: '→', keys: ['ArrowRight'], desc: 'Back to the terminals (list stays open)', run: () => S.setMode('view') },
  { mode: 'side', label: 'b', keys: ['b'], desc: 'Hide the list', run: S.closeSidebar },
  { mode: 'side', label: '…', desc: 'Other view-mode shortcuts still work' },
];

export function keyName(e) {
  if (e.ctrlKey && e.code === 'Backquote') return 'Ctrl+`';
  if (e.shiftKey && !e.ctrlKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) return 'Shift+' + e.code.slice(5);
  const printable = e.key.length === 1;
  const mods = (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && !printable ? 'Shift+' : '');
  return mods + (printable && e.ctrlKey ? e.key.toLowerCase() : e.key);
}

const consume = (e) => { e.preventDefault(); e.stopPropagation(); };

export function onKeydown(e) {
  if (e.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  const k = keyName(e);
  if (ui.help) {
    consume(e);
    if (['Escape', '?', 'q'].includes(k)) ui.help = false;
    return;
  }
  const order = ui.mode === 'side' ? ['side', 'view', 'any'] : [ui.mode, 'any'];
  const sc = order.map((m) => SHORTCUTS.find((s) => s.run && s.mode === m && s.keys.includes(k))).find(Boolean);
  if (sc) { consume(e); sc.run(k); return; }
  // View mode: nothing reaches a program. Ctrl+Shift stays free for app shortcuts.
  if ((ui.mode === 'view' || ui.mode === 'side') && !(e.ctrlKey && e.shiftKey)) consume(e);
}
