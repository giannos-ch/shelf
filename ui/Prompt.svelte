<script>
  import { send } from './conn.js';
  import { requestCompletion } from './complete.js';
  import Completions from './Completions.svelte';
  import HistorySearch from './HistorySearch.svelte';
  import { history as hist, toggleSearch } from './history.js';
  import { ui, els, handlers, activeTab, runCommand, tilde } from './store.svelte.js';

  let input = $state();
  const cwd = $derived(activeTab()?.cwd || '');

  let history = hist.items;
  let histIdx = 0, draft = '';
  handlers.history = ({ items }) => {
    const atEnd = histIdx === history.length;
    history = hist.items = items;
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
    else if (e.key === 'Tab') { e.preventDefault(); requestCompletion(input, ui.active); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); toggleSearch(input); }
    else if (e.key === 'ArrowUp' && !v.slice(0, pos).includes('\n')) {
      if (histIdx > 0) { if (histIdx === history.length) draft = v; histIdx--; setInput(history[histIdx]); e.preventDefault(); }
    } else if (e.key === 'ArrowDown' && !v.slice(pos).includes('\n')) {
      if (histIdx < history.length) { histIdx++; setInput(histIdx === history.length ? draft : history[histIdx]); e.preventDefault(); }
    }
  }

  $effect(() => { els.prompt = input; });
  $effect(() => {
    const refresh = () => send({ type: 'history' });
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  });
</script>

{#if ui.comp && ui.comp.input === input}<Completions />{/if}
{#if ui.hsearch && ui.hsearch.input === input}<HistorySearch />{/if}
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
