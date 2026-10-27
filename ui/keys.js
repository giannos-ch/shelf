import * as S from './store.svelte.js';
import { closeSearch, replaceText } from './history.js';
import { platform } from './conn.js';
import { showHints, hintKey } from './links.js';

const { ui } = S;
const DIR = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const SIDE = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' };
const arrows = (mod) => Object.keys(DIR).map((k) => mod + k);
const arrowOf = (k) => k.split('+').pop();
const digits = (mod) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => mod + 'Digit' + n);
const digitOf = (k) => +k.slice(-1);
const running = () => S.selected()?.status === 'running';
const closeLists = () => (ui.comp ? (ui.comp = null) : closeSearch());
// A text input's own selection wins over the terminal's.
const inputSelection = () => document.activeElement?.selectionStart < document.activeElement?.selectionEnd;

// Esc in a finished terminal's prompt: close completions or suggestions, then clear the text, then back to the main prompt.
function escPanePrompt() {
  const input = S.terms.get(S.selected()?.id)?.input;
  if (ui.comp || ui.hsearch) closeLists();
  else if (input?.value) replaceText(input, 0, input.value.length, '');
  else S.focusPrompt();
}

// Keys are physical (e.code), so shortcuts work whatever the keyboard layout. Contexts: `any`, `prompt` (main
// prompt focused), `pane` (a terminal focused), `layer` (the key after Ctrl+;), `side` (the closed list).
// `when` narrows an entry further. Entries without `run` are handled where they occur and listed for help only.
// Only take Ctrl keys programs can't receive or barely use: everything else must reach the program.
export const SHORTCUTS = [
  { ctx: 'any', label: 'Ctrl+`', keys: ['Ctrl+Backquote'], desc: 'Switch between the prompt and the last terminal', run: S.toggleFocus },
  { ctx: 'any', label: 'Ctrl+Tab', keys: ['Ctrl+Tab'], desc: 'Focus the previously focused terminal', run: S.focusPrevious },
  { ctx: 'any', label: 'Ctrl+M', keys: ['Ctrl+KeyM'], desc: 'Maximize / restore', run: S.toggleMax },
  { ctx: 'any', label: 'Ctrl+Q', keys: ['Ctrl+KeyQ'], desc: 'Close (keeps running, goes to the closed list)', run: () => S.closePane() },
  { ctx: 'any', label: 'Ctrl+.', keys: ['Ctrl+Period'], desc: 'Run again', run: () => S.rerun() },
  { ctx: 'any', label: 'Ctrl+C', keys: ['Ctrl+KeyC'], when: () => S.hasSelection() && !inputSelection(), desc: 'With output selected: copy it (otherwise ^C goes to the program)', run: S.copySelection },
  { ctx: 'any', label: 'Shift+PgUp / PgDn', keys: ['Shift+PageUp', 'Shift+PageDown'], desc: 'Scroll the output a page', run: (k) => S.scroll(k === 'Shift+PageUp' ? -1 : 1) },
  { ctx: 'any', label: 'Ctrl+PgUp / PgDn', keys: ['Ctrl+PageUp', 'Ctrl+PageDown'], desc: 'Previous / next tab', run: (k) => S.shiftTab(k === 'Ctrl+PageUp' ? -1 : 1) },
  { ctx: 'any', label: 'Ctrl+1 … 9', keys: digits('Ctrl+'), desc: 'Go to tab', run: (k) => S.gotoTab(digitOf(k) - 1) },
  { ctx: 'any', label: 'Ctrl+;', keys: ['Ctrl+Semicolon'], desc: 'Command layer (see below)', run: () => (ui.layer = true) },
  { ctx: 'any', label: 'F1', keys: ['F1'], desc: 'This help', run: () => (ui.help = true) },
  { ctx: 'any', label: '…', desc: 'Terminal actions apply to the focused terminal, or to the last one while the prompt has focus' },

  { ctx: 'prompt', label: 'Enter', desc: 'Run and type into its terminal (with history matches shown: pick the selected one)' },
  { ctx: 'prompt', label: 'Ctrl+Enter', desc: 'Run and stay in the prompt' },
  { ctx: 'prompt', label: 'Shift+Enter', desc: 'New line' },
  { ctx: 'prompt', label: 'Tab', desc: 'Pick the selected history match (→ at line end too), else complete' },
  { ctx: 'prompt', label: '↑ ↓ (typing)', desc: 'Select among history matches shown while typing' },
  { ctx: 'prompt', label: 'Shift+Delete', desc: 'Remove the selected history match from history (terminal prompts too)' },
  { ctx: 'prompt', label: '↑ ↓', desc: 'History' },
  { ctx: 'prompt', label: 'Ctrl+↑', keys: ['Ctrl+ArrowUp'], desc: 'Focus the last terminal (or the bottom one)', run: S.focusLast },
  { ctx: 'prompt', label: 'Esc', keys: ['Escape'], when: () => ui.comp || ui.hsearch, desc: 'Close completions or suggestions', run: closeLists },
  { ctx: 'prompt', label: 'Ctrl+L', keys: ['Ctrl+KeyL'], desc: 'Remove finished, unpinned terminals in this tab for good', run: S.clearFinished },

  { ctx: 'pane', label: 'Ctrl+←↑→↓', keys: arrows('Ctrl+'), desc: 'Focus the terminal in that direction (↓ from the bottom one: the prompt)', run: (k) => S.focusDir(DIR[arrowOf(k)]) },
  { ctx: 'pane', label: 'Ctrl+V', keys: ['Ctrl+KeyV'], when: running, desc: 'Paste text (with no text on the clipboard, ^V goes to the program)', run: () => S.paste() },
  { ctx: 'pane', label: 'Ctrl+Z', keys: ['Ctrl+KeyZ'], when: running, desc: 'Ignored: commands run without job control, so a suspended one could never resume', run: () => {} },
  { ctx: 'pane', label: 'Shift+Home / End', keys: ['Shift+Home', 'Shift+End'], when: running, desc: 'Scroll to the top / bottom', run: (k) => S.scroll(k === 'Shift+Home' ? 'top' : 'bottom') },
  { ctx: 'pane', label: '…', desc: 'Every other key, Esc included, goes to the running program' },
  { ctx: 'pane', label: 'Esc', keys: ['Escape'], when: () => !running(), desc: 'Finished terminal: close completions or suggestions, then clear its prompt, then back to the main prompt', run: escPanePrompt },
  { ctx: 'pane', label: 'Enter', desc: 'Finished terminal: run its prompt’s command in that terminal (with history matches shown: pick one)' },
  { ctx: 'pane', label: 'Tab', desc: 'Finished terminal: pick the selected history match, else complete' },
  { ctx: 'pane', label: '↑ ↓', desc: 'Finished terminal: history (shared with the main prompt)' },
  { ctx: 'pane', label: 'Ctrl+D', desc: 'Finished terminal with an empty prompt: close it' },

  { ctx: 'layer', label: '←↑→↓', keys: arrows(''), hint: 'swap', stay: true, desc: 'Swap with the terminal in that direction (repeatable)', run: (k) => S.swapDir(DIR[k]) },
  { ctx: 'layer', label: 'Shift+←↑→↓', keys: arrows('Shift+'), hint: 'resize', stay: true, desc: 'Move a border of the terminal (repeatable)', run: (k) => S.nudge(SIDE[arrowOf(k)]) },
  { ctx: 'layer', label: 'r', keys: ['KeyR'], hint: 'rotate', stay: true, desc: 'Turn the terminal and its closest neighbor from side by side to stacked, or back (repeatable)', run: S.rotate },
  { ctx: 'layer', label: '=', keys: ['Equal'], hint: 'equalize', stay: true, desc: 'Equalize sizes', run: S.equalize },
  { ctx: 'layer', label: 't / w', keys: ['KeyT', 'KeyW'], hint: 'tab new/close', desc: 'New tab (starts in this tab’s directory) / close tab (its terminals go to the closed list)', run: (k) => (k === 'KeyT' ? S.newTab() : S.closeTab()) },
  { ctx: 'layer', label: '1 … 9', keys: digits(''), hint: 'move to tab', desc: 'Move the terminal to tab N', run: (k) => S.moveToIndex(digitOf(k) - 1) },
  { ctx: 'layer', label: '[ / ]', keys: ['BracketLeft', 'BracketRight'], hint: 'move to prev/next tab', desc: 'Move the terminal to the previous / next tab (new tab past the end)', run: (k) => S.moveBy(k === 'BracketLeft' ? -1 : 1) },
  { ctx: 'layer', label: 'k', keys: ['KeyK'], hint: 'kill', desc: 'Kill the command', run: () => S.kill() },
  { ctx: 'layer', label: 'u', keys: ['KeyU'], hint: 'reopen', desc: 'Reopen the last closed terminal', run: () => S.reopen() },
  { ctx: 'layer', label: 'b', keys: ['KeyB'], hint: 'closed list', desc: 'Open the closed list and select its first entry', run: S.openSidebar },
  { ctx: 'layer', label: 'X', keys: ['Shift+KeyX'], hint: 'kill & remove', desc: 'Kill and remove for good', run: () => S.destroy() },
  { ctx: 'layer', label: 'p', keys: ['KeyP'], hint: 'pin', desc: 'Pin / unpin (pinned terminals survive l, L and Ctrl+L)', run: () => S.togglePin() },
  { ctx: 'layer', label: 'o', keys: ['KeyO'], hint: 'open link', desc: 'Label the file links in the terminal; type a label to open it (Esc cancels)', run: () => showHints() },
  { ctx: 'layer', label: 'a', keys: ['KeyA'], hint: 'select all', desc: 'Select all output (then Ctrl+C copies)', run: S.selectAll },
  { ctx: 'layer', label: 'l / L', keys: ['KeyL', 'Shift+KeyL'], hint: 'close/remove finished', desc: 'Close finished, unpinned terminals in this tab / remove them for good', run: (k) => (k === 'KeyL' ? S.shelveFinished() : S.clearFinished()) },
  ...(platform ? [{ ctx: 'layer', label: 'n', keys: ['KeyN'], hint: 'new window', desc: 'New window', run: S.newWindow }] : []),
  { ctx: 'layer', label: '?', keys: ['Shift+Slash'], hint: 'help', desc: 'This help', run: () => (ui.help = true) },
  { ctx: 'layer', label: 'Esc', keys: ['Escape'], hint: 'leave', desc: 'Leave the layer (any other key does too, and is swallowed)', run: () => {} },

  { ctx: 'side', label: '↑ ↓', keys: ['ArrowUp', 'ArrowDown'], desc: 'Select a closed terminal', run: (k) => S.sideMove(k === 'ArrowUp' ? -1 : 1) },
  { ctx: 'side', label: 'Enter', keys: ['Enter'], desc: 'Reopen it', run: () => S.sideAct(S.reopen) },
  { ctx: 'side', label: 'X', keys: ['Shift+KeyX'], desc: 'Kill and remove it for good', run: () => S.sideAct(S.destroy) },
  { ctx: 'side', label: 'Esc', keys: ['Escape'], desc: 'Back to where you were (the list stays open)', run: S.leaveSidebar },
];

export const keyName = (e) => (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.metaKey ? 'Meta+' : '') + e.code;

const consume = (e) => { e.preventDefault(); e.stopPropagation(); };
const find = (ctx, k) => SHORTCUTS.find((s) => s.run && s.ctx === ctx && s.keys.includes(k) && (!s.when || s.when()));

export function onKeydown(e) {
  if (e.isComposing || ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta'].includes(e.key)) return;
  const k = keyName(e);
  if (ui.help) {
    consume(e);
    if (['Escape', 'F1', 'Shift+Slash'].includes(k)) ui.help = false;
    return;
  }
  if (ui.hints) { consume(e); hintKey(e); return; }
  if (ui.layer) {
    consume(e);
    const sc = find('layer', k);   // unknown keys just close the layer
    ui.layer = !!sc?.stay;
    sc?.run(k);
    return;
  }
  const sc = find(ui.mode, k) || find('any', k);
  if (sc) { consume(e); sc.run(k); }
  else if (ui.mode === 'side') consume(e);   // the closed list has no program to reach
}
