<script>
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { send } from './conn.js';
  import { linksAt, openLink } from './links.js';
  import { requestCompletion } from './complete.js';
  import Completions from './Completions.svelte';
  import HistorySearch from './HistorySearch.svelte';
  import { suggest, hideSuggest, navKey, record, recall } from './history.js';
  import { ui, terms, termOptions, refit, activeTab, select, focusPane, rerun, runInPane, closePane, toggleMax, togglePin, startDrag, tilde, fmtDur } from './store.svelte.js';

  let { pane, rect, selected, maximized } = $props();
  let inputEl = $state();
  const focused = $derived(selected && ui.mode === 'pane');
  $effect(() => { const e = terms.get(pane.id); if (e) e.input = inputEl; });

  const meta = $derived.by(() => {
    const parts = [tilde(pane.cwd)];
    if (pane.status === 'running') parts.push(fmtDur(Math.max(0, ui.now - pane.started)));
    else parts.push(fmtDur(pane.ms));
    return parts.filter(Boolean).join(' · ');
  });
  const badge = $derived(pane.reason || (pane.status === 'err' ? `exit ${pane.code}` : ''));

  // xterm's defaults warn (OSC 8 confirm, blank-window trick Electron denies); open directly.
  // In Electron, main.js's setWindowOpenHandler hands the URL to the system browser.
  const openUrl = (uri) => window.open(uri, '_blank', 'noopener');

  function xterm(node) {
    const term = new Terminal({
      ...termOptions(), lineHeight: 1.15, cursorBlink: true, scrollback: 10000,
      macOptionIsMeta: true, allowTransparency: false,
      linkHandler: { activate: (e, uri) => openUrl(uri) },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((e, uri) => openUrl(uri)));
    // File paths: underlined if they exist, opened with Ctrl+click (Cmd on macOS); a plain click stays a click.
    term.registerLinkProvider({
      provideLinks: (y, cb) => linksAt(pane, y - 1).then((ls) => cb(ls.length ? ls.map((l) => ({
        range: l.range, text: l.text, decorations: { underline: true, pointerCursor: true },
        activate: (e) => (e.ctrlKey || e.metaKey) && openLink(pane, l),
        hover: () => (node.title = `Ctrl+click to open ${l.label}`),
        leave: () => (node.title = ''),
      })) : undefined), () => cb(undefined)),
    });
    term.open(node);
    const entry = { term, fit, lastSize: { cols: 0, rows: 0 } };
    terms.set(pane.id, entry);
    // Keys and mouse reports reach the program only while this terminal has focus.
    term.onData((data) => {
      if (ui.mode === 'pane' && activeTab()?.selected === pane.id && pane.status === 'running') send({ type: 'input', id: pane.id, data });
    });
    term.textarea?.addEventListener('focus', () => {
      select(pane.id);
      ui.mode = 'pane';
      if (pane.status !== 'running') entry.input?.focus();   // a finished terminal types into its own prompt
    });
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => refit(pane.id));
    });
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

</script>

<section
  class="pane"
  class:focused
  class:last={selected && !focused}
  class:dragging={ui.drag?.id === pane.id}
  hidden={!rect}
  style:left="{rect?.x}px" style:top="{rect?.y}px" style:width="{rect?.w}px" style:height="{rect?.h}px"
  onpointerdowncapture={() => !focused && focusPane(pane.id)}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="pane-head" onpointerdown={(e) => !e.target.closest('button') && startDrag(e, pane.id)} ondblclick={(e) => !e.target.closest('button') && toggleMax()}>
    <span class="dot {pane.status}"></span>
    <span class="cmd" title={pane.cmd}>{pane.cmd.replace(/\n/g, ' ⏎ ')}</span>
    <span class="meta">{meta}{#if badge}{' · '}<span class="code">{badge}</span>{/if}</span>
    <span class="btns">
      <button title="Run again (Ctrl+.)" onclick={() => rerun(pane)}>↻</button>
      <button class="pin" class:on={pane.pinned} title="{pane.pinned ? 'Unpin' : 'Pin'} (Ctrl+; p)" onclick={() => togglePin(pane)}>📌</button>
      <button title="{maximized ? 'Restore' : 'Maximize'} (Ctrl+M)" onclick={toggleMax}>{maximized ? '❐' : '▢'}</button>
      <button class="close" title="Close (Ctrl+Q)" onclick={() => closePane(pane)}>✕</button>
    </span>
  </header>
  <div class="pane-body">
    <div class="term" use:xterm></div>
    {#if pane.status !== 'running' && !pane.gotOutput}<div class="noout">no output</div>{/if}
  </div>
  {#if pane.status !== 'running'}
    {#if ui.comp && ui.comp.input === inputEl}<Completions />{/if}
    {#if ui.hsearch && ui.hsearch.input === inputEl}<HistorySearch />{/if}
    <div class="pane-prompt">
      <span class="where"><bdi>{tilde(pane.cwd)} ❯</bdi></span>
      <input
        bind:this={inputEl} spellcheck="false" autocomplete="off" placeholder="run here…  (Esc: back to the main prompt)"
        oninput={(e) => { ui.comp = null; suggest(e); }}
        onblur={hideSuggest}
        onfocus={() => { select(pane.id); ui.mode = 'pane'; }}
        onkeydown={(e) => {
          if (navKey(e)) return;
          if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); record(e.target.value); runInPane(pane, e.target.value); e.target.value = ''; ui.hsearch = null; }
          else if (e.key === 'Tab') { e.preventDefault(); requestCompletion(e.target, pane.tab, pane.cwd); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const h = recall(e.target, e.key === 'ArrowUp' ? -1 : 1);
            if (h != null) { e.target.value = h; e.target.selectionStart = e.target.selectionEnd = h.length; }
          }
          else if (e.ctrlKey && e.key === 'd' && !e.target.value) { e.preventDefault(); closePane(pane); }
        }}
      />
    </div>
  {/if}
</section>
