<script>
  import { send } from './conn.js';
  import { requestCompletion } from './complete.js';
  import Completions from './Completions.svelte';
  import HistorySearch from './HistorySearch.svelte';
  import { setHistory, expandBang, record, recall, suggest, hideSuggest, navKey } from './history.js';
  import { ui, els, handlers, activeTab, runCommand, tilde } from './store.svelte.js';

  let input = $state();
  const cwd = $derived(activeTab()?.cwd || '');
  const git = $derived(activeTab()?.git);
  // Hover popup listing the changed files; fixed-positioned because #cwd clips its overflow.
  // Closing waits a moment so the pointer can cross the gap from the pill into the popup.
  let gitPop = $state(null), popTimer;
  const keepGitPop = () => clearTimeout(popTimer);
  const hideGitPop = () => { popTimer = setTimeout(() => (gitPop = null), 200); };
  const showGitPop = (e) => { keepGitPop(); if (git?.dirty) { const r = e.currentTarget.getBoundingClientRect(); gitPop = { left: r.left, bottom: innerHeight - r.top + 6 }; } };
  function openGitFile(f) {
    gitPop = null;
    send({ type: 'open', tab: ui.active, abs: git.root + '/' + f.path.replace(/\/$/, '') });
  }
  // Kind from the porcelain letters: conflict, untracked, added, deleted, renamed, else modified.
  const KINDS = { U: ['conflict', '!'], '?': ['new', '+'], A: ['new', '+'], D: ['del', '−'], R: ['ren', '→'], C: ['new', '+'], M: ['mod', '●'] };
  const kind = (xy) => KINDS[xy.includes('U') || xy === 'AA' || xy === 'DD' ? 'U' : (xy[0] !== ' ' ? xy[0] : xy[1])] || KINDS.M;
  const split = (p) => { const i = p.lastIndexOf('/', p.length - 2); return [p.slice(0, i + 1), p.slice(i + 1)]; };

  handlers.history = ({ items }) => setHistory(items);

  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight + 2, 180) + 'px'; }
  function setInput(v) { input.value = v; autoGrow(); input.selectionStart = input.selectionEnd = v.length; }

  function runInput(focus) {
    const cmd = expandBang(input.value.trim());
    if (!cmd) return;
    record(cmd);
    input.value = ''; autoGrow(); ui.comp = ui.hsearch = null;
    runCommand(cmd, focus);
  }

  function onKeydown(e) {
    const v = input.value, pos = input.selectionStart;
    if (navKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); runInput(!e.ctrlKey); }
    else if (e.key === 'Tab') { e.preventDefault(); requestCompletion(input, ui.active); }
    else if ((e.key === 'ArrowUp' && !v.slice(0, pos).includes('\n')) || (e.key === 'ArrowDown' && !v.slice(pos).includes('\n'))) {
      const h = recall(input, e.key === 'ArrowUp' ? -1 : 1);
      if (h != null) { setInput(h); e.preventDefault(); }
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
{#if gitPop && git?.dirty}
  <div class="gitpop" role="menu" tabindex="-1" style:left="{gitPop.left}px" style:bottom="{gitPop.bottom}px" onmouseenter={keepGitPop} onmouseleave={hideGitPop}>
    {#each git.files as f}
      {@const [k, icon] = kind(f.xy)}
      {@const [dir, base] = split(f.path)}
      <button class="gf {k}" role="menuitem" disabled={k === 'del'} onpointerdown={(e) => e.preventDefault()} onclick={() => openGitFile(f)}>
        <span class="ic">{icon}</span><span class="p"><span class="dir">{dir}</span>{base}</span>
        {#if f.add || f.del}<span class="n">{#if f.add}<span class="add">+{f.add}</span>{/if} {#if f.del}<span class="del">−{f.del}</span>{/if}</span>{/if}
      </button>
    {/each}
    {#if git.more}<div class="gf more">… {git.more} more</div>{/if}
  </div>
{/if}
<div id="prompt">
  <div id="cwd" title={cwd}><bdi>{tilde(cwd)}{#if git}<span class="git" class:dirty={git.dirty} role="status" onmouseenter={showGitPop} onmouseleave={hideGitPop}><span class="mark">{git.dirty ? '●' : '✓'}</span>{git.branch}{#if git.ahead}<span class="ab">↑{git.ahead}</span>{/if}{#if git.behind}<span class="ab">↓{git.behind}</span>{/if}</span>{/if} ❯</bdi></div>
  <textarea
    bind:this={input} rows="1" spellcheck="false" autocomplete="off" autocapitalize="off"
    placeholder="Run a command…   (Ctrl+↑: terminals · F1: help)"
    oninput={(e) => { autoGrow(); ui.comp = null; suggest(e); }}
    onblur={hideSuggest}
    onkeydown={onKeydown}
    onfocus={() => (ui.mode = 'prompt')}
  ></textarea>
</div>
