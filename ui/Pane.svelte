<script>
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { send } from './conn.js';
  import { linksAt, openLink } from './links.js';
  import { requestCompletion } from './complete.js';
  import Completions from './Completions.svelte';
  import HistorySearch from './HistorySearch.svelte';
  import { suggest, hideSuggest, navKey, record, recall, expandBang } from './history.js';
  import { ui, els, insertText, termSelection, startTextDrag, dropText, shownTerm, terms, termOptions, refit, activeTab, select, focusPane, rerun, runInPane, viewRun, closePane, toggleMax, togglePin, startDrag, tilde, fmtDur, fmtAgo, notify } from './store.svelte.js';

  let { pane, rect, selected, maximized } = $props();
  let inputEl = $state();
  const focused = $derived(selected && ui.mode === 'pane');
  $effect(() => { const e = terms.get(pane.id); if (e) e.input = inputEl; });
  $effect(() => { pane.status; terms.get(pane.id)?.align?.(); });

  // The run on screen: the pane itself, or an earlier run picked from its history.
  const shown = $derived(pane.viewing != null ? pane.runs[pane.viewing] : pane);
  const meta = $derived.by(() => {
    const parts = [tilde(shown.cwd)];
    if (shown.status === 'running') parts.push(fmtDur(Math.max(0, ui.now - pane.started)));
    else parts.push(fmtDur(shown.ms));
    return parts.filter(Boolean).join(' · ');
  });
  const runBadge = (r) => r.reason || (r.status === 'err' ? `exit ${r.code}` : '');
  const badge = $derived(runBadge(shown));
  const oneLine = (c) => c.replace(/\n/g, ' ⏎ ');
  const menuOpen = $derived(ui.runs === pane.id);
  // History rows, newest first: i is the run's index, null for a running command (its live terminal).
  const rows = $derived([
    ...(pane.status === 'running' ? [{ r: pane, i: null }] : []),
    ...pane.runs.map((r, i) => ({ r, i })).reverse(),
  ]);
  const onScreen = $derived(pane.viewing ?? (pane.status === 'running' ? null : pane.runs.length - 1));
  function pick(i) { ui.runs = null; viewRun(pane, i); }
  let runsEl = $state();
  $effect(() => { onScreen; runsEl?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); });

  // xterm's defaults warn (OSC 8 confirm, blank-window trick Electron denies); open directly.
  // In Electron, main.js's setWindowOpenHandler hands the URL to the system browser.
  const openUrl = (uri) => window.open(uri, '_blank', 'noopener');

  // An xterm with links and bottom alignment; `live` is the pane's own terminal, else a read-only view of a past run.
  function makeTerm(node, live) {
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
    term.textarea?.addEventListener('focus', () => {
      select(pane.id);
      ui.mode = 'pane';
      if (pane.status !== 'running') terms.get(pane.id)?.input?.focus();   // a finished terminal types into its own prompt
    });
    // Output shorter than the terminal sits at its bottom: shift the screen down by the unused rows.
    // A running program keeps its cursor row; a full-screen one (alternate buffer) or one with scrollback isn't shifted.
    const align = () => {
      const b = term.buffer.active;
      let used = term.rows;
      if (b.type === 'normal' && b.length <= term.rows) {
        used = live && pane.status === 'running' ? b.cursorY + 1 : 0;
        for (let y = term.rows - 1; y >= used; y--) if (b.getLine(y)?.translateToString(true)) { used = y + 1; break; }
      }
      const ch = term.element.querySelector('.xterm-screen').offsetHeight / (term.element.querySelector('.xterm-rows')?.childElementCount || term.rows);
      term.element.style.transform = used < term.rows ? `translateY(${(term.rows - used) * ch}px)` : '';
    };
    term.onRender(align);
    return { term, fit, align };
  }

  function xterm(node) {
    const { term, fit, align } = makeTerm(node, true);
    const entry = { term, fit, align, lastSize: { cols: 0, rows: 0 }, buf: '' };
    terms.set(pane.id, entry);
    // Programs asking for attention: OSC 9 (iTerm2; `9;<digit>;…` are ConEmu commands such as progress), OSC 777 notify, bell.
    term.parser.registerOscHandler(9, (d) => { if (!/^\d;/.test(d)) notify(pane, d || 'notification'); return true; });
    term.parser.registerOscHandler(777, (d) => {
      const [kind, title, body] = d.split(';');
      if (kind === 'notify') notify(pane, body || title || 'notification');
      return true;
    });
    term.onBell(() => notify(pane, 'bell'));
    // Keys and mouse reports reach the program only while this terminal has focus and is on screen.
    term.onData((data) => {
      if (ui.mode === 'pane' && activeTab()?.selected === pane.id && pane.status === 'running' && pane.viewing == null) send({ type: 'input', id: pane.id, data });
    });
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => refit(pane.id));
    });
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

  // A past run's output, replayed over the pane's own terminal, which keeps running underneath. Made on first
  // use and then only hidden: xterm throws if a terminal is disposed right after it opens.
  let viewed = $state(false);
  $effect(() => { if (pane.viewing != null) viewed = true; });
  function overSelection(term, e) {
    const pos = term.getSelectionPosition();
    if (!pos) return false;
    const r = term.element.querySelector('.xterm-screen').getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / term.cols));
    const y = Math.floor((e.clientY - r.top) / (r.height / term.rows)) + term.buffer.active.viewportY;
    if (x < 0 || x >= term.cols) return false;
    const at = y * term.cols + x;
    return at >= pos.start.y * term.cols + pos.start.x && at < pos.end.y * term.cols + pos.end.x;
  }

  // Middle click copies the selection to this pane's prompt (the main one while it runs); pressing on it drags it.
  // While there is one, hover isn't reported to the program: xterm clears the selection on any report.
  function bodyMousedown(e) {
    if (e.button === 1) {
      const text = termSelection(pane.id);
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      window.addEventListener('mouseup', (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
      insertText(pane.status === 'running' ? els.prompt : inputEl, text);
    } else if (e.button === 0 && !e.shiftKey && !e.altKey) {
      const term = shownTerm(pane.id);
      if (term?.hasSelection() && overSelection(term, e)) startTextDrag(e, term, term.getSelection());
    }
  }

  function history(node, run) {
    const { term, fit } = makeTerm(node, false);
    const entry = terms.get(pane.id);
    entry.view = term;
    const show = (r) => { if (r !== pane) { term.reset(); term.write('\x1b[?25l' + r.data); } };
    try { fit.fit(); } catch {}
    show(run);
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(node);
    return { update: show, destroy: () => { ro.disconnect(); term.dispose(); if (entry.view === term) entry.view = null; } };
  }

</script>

<svelte:window onpointerdown={(e) => menuOpen && !e.target.closest('.runs, .hist') && (ui.runs = null)} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
  class="pane"
  class:focused
  class:notify={pane.notify}
  class:last={selected && !focused}
  class:dragging={ui.drag?.id === pane.id}
  hidden={!rect}
  style:left="{rect?.x}px" style:top="{rect?.y}px" style:width="{rect?.w}px" style:height="{rect?.h}px"
  data-pane={pane.id}
  onpointerdowncapture={() => !focused && focusPane(pane.id)}
  onmousedown={(e) => !e.target.closest('input') && e.preventDefault()}
  ondragover={(e) => e.dataTransfer.types.includes('text/plain') && !e.target.closest('input') && e.preventDefault()}
  ondrop={(e) => { if (e.target.closest('input')) return; e.preventDefault(); dropText(e.dataTransfer.getData('text/plain'), e.currentTarget); }}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="pane-head" onpointerdown={(e) => !e.target.closest('button') && startDrag(e, pane.id)} ondblclick={(e) => !e.target.closest('button') && toggleMax()}>
    <span class="dot {shown.status}"></span>
    <span class="cmd" title={shown.cmd}>{oneLine(shown.cmd)}</span>
    {#if pane.viewing != null}<span class="tag">history</span>{/if}
    {#if pane.notify}<span class="tag notify" title={pane.notify}>{pane.notify}</span>{/if}
    <span class="meta">{meta}{#if badge}{' · '}<span class="code">{badge}</span>{/if}</span>
    <span class="btns">
      {#if rows.length > 1}
        <button class="hist" class:on={menuOpen} title="History (Ctrl+; h)"
          onclick={() => (ui.runs = menuOpen ? null : pane.id)}>☰</button>
      {/if}
      <button title="Run again (Ctrl+.)" onclick={() => rerun(pane)}>↻</button>
      <button class="pin" class:on={pane.pinned} title="{pane.pinned ? 'Unpin' : 'Pin'} (Ctrl+; p)" onclick={() => togglePin(pane)}>📌</button>
      <button title="{maximized ? 'Restore' : 'Maximize'} (Ctrl+M)" onclick={toggleMax}>{maximized ? '❐' : '▢'}</button>
      <button class="close" title="Close (Ctrl+Q)" onclick={() => closePane(pane)}>✕</button>
    </span>
  </header>
  {#if menuOpen}
    <ul class="runs" bind:this={runsEl}>
      {#each rows as { r, i } (i ?? 'live')}
        <li><button class:on={onScreen === i} title={r.cmd} onmouseenter={() => viewRun(pane, i)} onclick={() => pick(i)}>
          <span class="dot {r.status}"></span>
          <span class="cmd">{oneLine(r.cmd)}</span>
          <span class="meta" title={new Date(r.started).toLocaleString()}>{r === pane ? 'running' : fmtAgo(r.started)}{#if runBadge(r)}{' · '}<span class="code">{runBadge(r)}</span>{/if}</span>
        </button></li>
      {/each}
    </ul>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="pane-body" onmousedowncapture={bodyMousedown}
    onmousemovecapture={(e) => !e.buttons && shownTerm(pane.id)?.hasSelection() && e.stopPropagation()}>
    <div class="term" class:hidden={pane.viewing != null} use:xterm></div>
    {#if viewed}<div class="term view" class:hidden={pane.viewing == null} use:history={shown}></div>{/if}
    {#if shown.status !== 'running' && (shown === pane ? !pane.gotOutput : !shown.data)}<div class="noout">no output</div>{/if}
  </div>
  {#if pane.status !== 'running'}
    <div class="pane-prompt">
      {#if ui.comp && ui.comp.input === inputEl}<Completions />{/if}
      {#if ui.hsearch && ui.hsearch.input === inputEl}<HistorySearch />{/if}
      <span class="where"><bdi>{tilde(pane.cwd)} ❯</bdi></span>
      <input
        bind:this={inputEl} spellcheck="false" autocomplete="off" placeholder="run here…  (Esc: back to the main prompt)"
        oninput={(e) => { ui.comp = null; suggest(e); }}
        onblur={hideSuggest}
        onfocus={() => { select(pane.id); ui.mode = 'pane'; }}
        onkeydown={(e) => {
          if (navKey(e)) return;
          if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); const cmd = expandBang(e.target.value); record(cmd); runInPane(pane, cmd); e.target.value = ''; ui.hsearch = null; }
          else if (e.key === 'Tab') { e.preventDefault(); requestCompletion(e.target, pane.tab, pane.cwd); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const h = recall(e.target, e.key === 'ArrowUp' ? -1 : 1, pane.cmds);
            if (h != null) { e.target.value = h; e.target.selectionStart = e.target.selectionEnd = h.length; }
          }
        }}
      />
    </div>
  {/if}
</section>
