import { send } from './conn.js';
import { ui, handlers } from './store.svelte.js';
import { replaceText } from './history.js';

let req = 0, target = null;

export function requestCompletion(input, tab, cwd) {
  target = input;
  send({ type: 'complete', reqId: ++req, tab, cwd, line: input.value.slice(0, input.selectionStart) });
}

const shellEscape = (s) => s.replace(/([ '"()&;|<>$`\\!*?[\]{}#])/g, '\\$1');
function replaceWord(word, replacement) {
  const input = target, pos = input.selectionStart, before = input.value.slice(0, pos);
  if (!before.endsWith(word)) return;
  replaceText(input, pos - word.length, pos, replacement);
}
function commonPrefix(items) {
  let p = items[0];
  for (const s of items) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}
const finishWord = (it) => shellEscape(it) + (it.endsWith('/') ? '' : ' ');

handlers.completions = ({ reqId, word, items }) => {
  if (reqId !== req || !items.length) return (ui.comp = null);
  if (items.length === 1) { replaceWord(word, finishWord(items[0])); return (ui.comp = null); }
  const pre = commonPrefix(items);
  if (pre.length > word.length) replaceWord(word, shellEscape(pre));
  ui.comp = { input: target, typed: pre.length > word.length ? shellEscape(pre) : word, items: items.slice(0, 60), more: Math.max(0, items.length - 60) };
};

export function pick(it) { replaceWord(ui.comp.typed, finishWord(it)); ui.comp = null; target.focus(); }
export const label = (it) => (it.endsWith('/') ? it.slice(0, -1).split('/').pop() + '/' : it.split('/').pop()) || it;
