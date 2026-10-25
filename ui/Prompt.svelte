<script>
  import { send } from './conn.js';
  import { ui, els, handlers, activeTab, runCommand, tilde } from './store.svelte.js';

  let input;
  const cwd = $derived(activeTab()?.cwd || '');

  let history = [];
  let histIdx = 0, draft = '';
  handlers.history = ({ items }) => {
    const atEnd = histIdx === history.length;
    history = items;
    if (atEnd || histIdx > history.length) histIdx = history.length;
  };

  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight + 2, 180) + 'px'; }
  function setInput(v) { input.value = v; autoGrow(); input.selectionStart = input.selectionEnd = v.length; }

  function runInput(insert) {
    const cmd = input.value.trim();
    if (!cmd) return;
    send({ type: 'history-add', cmd: input.value });
    if (history[history.length - 1] !== cmd) history.push(cmd);
    histIdx = history.length; draft = '';
    input.value = ''; autoGrow(); ui.comp = null;
    runCommand(cmd, insert);
  }

  function onKeydown(e) {
    const v = input.value, pos = input.selectionStart;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); runInput(e.ctrlKey); }
    else if (e.key === 'Tab') { e.preventDefault(); requestCompletion(); }
    else if (e.key === 'ArrowUp' && !v.slice(0, pos).includes('\n')) {
      if (histIdx > 0) { if (histIdx === history.length) draft = v; histIdx--; setInput(history[histIdx]); e.preventDefault(); }
    } else if (e.key === 'ArrowDown' && !v.slice(pos).includes('\n')) {
      if (histIdx < history.length) { histIdx++; setInput(histIdx === history.length ? draft : history[histIdx]); e.preventDefault(); }
    }
  }

  let compReq = 0;
  function requestCompletion() {
    send({ type: 'complete', reqId: ++compReq, tab: ui.active, line: input.value.slice(0, input.selectionStart) });
  }
  const shellEscape = (s) => s.replace(/([ '"()&;|<>$`\\!*?[\]{}#])/g, '\\$1');
  function replaceWord(word, replacement) {
    const pos = input.selectionStart, before = input.value.slice(0, pos);
    if (!before.endsWith(word)) return;
    const head = before.slice(0, before.length - word.length);
    input.value = head + replacement + input.value.slice(pos);
    input.selectionStart = input.selectionEnd = head.length + replacement.length;
    autoGrow();
  }
  function commonPrefix(items) {
    let p = items[0];
    for (const s of items) while (!s.startsWith(p)) p = p.slice(0, -1);
    return p;
  }
  const finishWord = (it) => shellEscape(it) + (it.endsWith('/') ? '' : ' ');
  handlers.completions = ({ reqId, word, items }) => {
    if (reqId !== compReq || !items.length) return (ui.comp = null);
    if (items.length === 1) { replaceWord(word, finishWord(items[0])); return (ui.comp = null); }
    const pre = commonPrefix(items);
    if (pre.length > word.length) replaceWord(word, shellEscape(pre));
    ui.comp = { typed: pre.length > word.length ? shellEscape(pre) : word, items: items.slice(0, 60), more: Math.max(0, items.length - 60) };
  };
  function pick(it) { replaceWord(ui.comp.typed, finishWord(it)); ui.comp = null; input.focus(); }
  const label = (it) => (it.endsWith('/') ? it.slice(0, -1).split('/').pop() + '/' : it.split('/').pop()) || it;

  $effect(() => { els.prompt = input; });
  $effect(() => {
    const refresh = () => send({ type: 'history' });
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  });
</script>

{#if ui.comp}
  <div id="completions">
    {#each ui.comp.items as it}<button title={it} onclick={() => pick(it)}>{label(it)}</button>{/each}
    {#if ui.comp.more}<span class="more">+{ui.comp.more} more</span>{/if}
  </div>
{/if}
<div id="prompt">
  <div id="cwd" title={cwd}><bdi>{tilde(cwd)} ❯</bdi></div>
  <textarea
    bind:this={input} rows="1" spellcheck="false" autocomplete="off" autocapitalize="off"
    placeholder="Run a command…   (Esc: view mode · ? help)"
    oninput={() => { autoGrow(); ui.comp = null; }}
    onkeydown={onKeydown}
    onfocus={() => (ui.mode = 'prompt')}
  ></textarea>
  <span class="mode {ui.mode}">{ui.mode.toUpperCase()}</span>
</div>
