<script>
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { send } from './conn.js';
  import { ui, terms, activeTab, select, setMode, rerun, runInPane, closePane, toggleMax, startDrag, tilde, fmtDur } from './store.svelte.js';

  let { pane, rect, selected, maximized } = $props();
  let inputEl = $state();
  $effect(() => { const e = terms.get(pane.id); if (e) e.input = inputEl; });

  const THEME = {
    background: '#12151b', foreground: '#d7dce5', cursor: '#e3b341', cursorAccent: '#12151b',
    selectionBackground: '#2f3a52',
    black: '#1b1f27', red: '#f85149', green: '#3fb950', yellow: '#e3b341', blue: '#5b8def',
    magenta: '#bc8cff', cyan: '#39c5cf', white: '#d7dce5',
    brightBlack: '#5c6370', brightRed: '#ff7b72', brightGreen: '#56d364', brightYellow: '#f2cc60',
    brightBlue: '#79a6ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff',
  };

  const meta = $derived.by(() => {
    const parts = [tilde(pane.cwd)];
    if (pane.status === 'running') parts.push(fmtDur(Math.max(0, ui.now - pane.started)));
    else parts.push(fmtDur(pane.ms));
    return parts.filter(Boolean).join(' · ');
  });
  const badge = $derived(pane.reason || (pane.status === 'err' ? `exit ${pane.code}` : ''));

  function xterm(node) {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
      fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 10000,
      theme: THEME, macOptionIsMeta: true, allowTransparency: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(node);
    const entry = { term, fit, lastSize: { cols: 0, rows: 0 } };
    terms.set(pane.id, entry);
    // Keys and mouse reports reach the program only in insert mode.
    term.onData((data) => {
      if (ui.mode === 'insert' && activeTab()?.selected === pane.id && pane.status === 'running') send({ type: 'input', id: pane.id, data });
    });
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!node.clientWidth || !node.clientHeight) return;
        try { fit.fit(); } catch { return; }
        const { cols, rows } = term;
        if (pane.status === 'running' && (cols !== entry.lastSize.cols || rows !== entry.lastSize.rows)) {
          send({ type: 'resize', id: pane.id, cols, rows });
        }
        entry.lastSize = { cols, rows };
      });
    });
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

  function onPointerDown() {
    if (selected && ui.mode === 'insert') return;
    select(pane.id);
    if (ui.mode !== 'view') setMode('view');
  }
</script>

<section
  class="pane"
  class:selected
  class:insert={selected && ui.mode === 'insert'}
  class:dragging={ui.drag?.id === pane.id}
  hidden={!rect}
  style:left="{rect?.x}px" style:top="{rect?.y}px" style:width="{rect?.w}px" style:height="{rect?.h}px"
  onpointerdowncapture={onPointerDown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="pane-head" onpointerdown={(e) => !e.target.closest('button') && startDrag(e, pane.id)} ondblclick={(e) => !e.target.closest('button') && toggleMax()}>
    <span class="dot {pane.status}"></span>
    <span class="cmd" title={pane.cmd}>{pane.cmd.replace(/\n/g, ' ⏎ ')}</span>
    <span class="meta">{meta}{#if badge}{' · '}<span class="code">{badge}</span>{/if}</span>
    <span class="btns">
      <button title="Run again (r)" onclick={() => rerun(pane)}>↻</button>
      <button title="{maximized ? 'Restore' : 'Maximize'} (m)" onclick={toggleMax}>{maximized ? '❐' : '▢'}</button>
      <button class="close" title="Close (Esc in view mode)" onclick={() => closePane(pane)}>✕</button>
    </span>
  </header>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="pane-body" ondblclick={() => setMode('insert')}>
    <div class="term" use:xterm></div>
    {#if pane.status !== 'running' && !pane.gotOutput}<div class="noout">no output</div>{/if}
  </div>
  {#if pane.status !== 'running'}
    <div class="pane-prompt">
      <span class="where"><bdi>{tilde(pane.cwd)} ❯</bdi></span>
      <input
        bind:this={inputEl} spellcheck="false" autocomplete="off" placeholder="run here… (i)"
        onfocus={() => { select(pane.id); ui.mode = 'insert'; }}
        onkeydown={(e) => {
          if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); runInPane(pane, e.target.value); e.target.value = ''; }
          else if (e.key === 'ArrowUp') { e.preventDefault(); e.target.value = pane.cmd; }
        }}
      />
    </div>
  {/if}
</section>
