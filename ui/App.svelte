<script>
  import Pane from './Pane.svelte';
  import Prompt from './Prompt.svelte';
  import { SHORTCUTS, onKeydown } from './keys.js';
  import {
    ui, els, init, activeTab, tabById, closedPanes, layoutOf, tabTitle, tilde, setMode,
    newTab, closeTab, reopen, destroy, startResize, openSidebar, closeSidebar,
  } from './store.svelte.js';

  let desk;
  const tab = $derived(activeTab());
  const layout = $derived(layoutOf(tab));
  const closed = $derived(closedPanes());
  const MODES = [['any', 'Anywhere'], ['prompt', 'Prompt'], ['view', 'View mode'], ['insert', 'Insert mode'], ['side', 'Closed list']];
  const px = (r) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;

  function gotoTabId(id) {
    ui.active = id;
    setMode(ui.mode === 'insert' ? 'view' : ui.mode);
  }

  $effect(() => { els.desk = desk; init(); setMode('prompt'); });
  $effect(() => { document.title = `${tilde(tab?.cwd || '')} — Shelf`; });
  $effect(() => { if (ui.mode === 'side' && ui.sideSel) document.querySelector('.closed-item.sel')?.scrollIntoView({ block: 'nearest' }); });
</script>

<svelte:window onkeydowncapture={onKeydown} />

<nav id="tabs">
  <button class="side-toggle" class:on={ui.sidebar} title="Closed terminals (b)" onclick={() => (ui.sidebar ? closeSidebar() : openSidebar())}>
    ☰{#if closed.length}<span class="count">{closed.length}</span>{/if}
  </button>
  {#each ui.tabs as t, i (t.id)}
    <div
      class="tab" class:active={t.id === ui.active} class:drop={ui.drag?.tab === t.id}
      data-tab={t.id} title={t.cwd} role="tab" tabindex="-1" aria-selected={t.id === ui.active}
      onclick={() => gotoTabId(t.id)} onkeydown={() => {}}
      onauxclick={(e) => e.button === 1 && closeTab(t.id)}
    >
      {#if i < 9}<span class="num">{i + 1}</span>{/if}
      <span class="name">{tabTitle(t)}</span>
      <button class="x" title="Close tab (w)" onclick={(e) => { e.stopPropagation(); closeTab(t.id); }}>✕</button>
    </div>
  {/each}
  <button class="add" title="New tab (t)" onclick={() => newTab()}>+</button>
  <span class="spacer"></span>
  <button class="help-btn" title="Shortcuts (?)" onclick={() => (ui.help = true)}>?</button>
</nav>

<div id="main">
  {#if ui.sidebar}
    <aside id="sidebar">
      <div class="side-head">Closed <span class="muted">· b to select · Enter reopens</span></div>
      {#each closed as p (p.id)}
        <div class="closed-item" class:sel={ui.mode === 'side' && ui.sideSel === p.id} title="{p.cmd}&#10;{p.cwd}">
          <button class="reopen" onclick={() => reopen(p)}>
            <span class="dot {p.status}"></span>
            <span class="cmd">{p.cmd.replace(/\n/g, ' ⏎ ')}</span>
            <span class="where">{tilde(p.cwd)}</span>
          </button>
          <button class="x" title="Kill and remove" onclick={() => destroy(p)}>✕</button>
        </div>
      {:else}
        <div class="side-empty">Terminals you close (Esc or l in view mode) keep running here.</div>
      {/each}
    </aside>
  {/if}

  <main
    id="desk" bind:this={desk} tabindex="-1" class:view={ui.mode === 'view'}
    bind:clientWidth={ui.desk.w} bind:clientHeight={ui.desk.h}
    onpointerdown={(e) => { if (e.target === desk) setMode('view'); }}
  >
    {#each ui.panes as pane (pane.id)}
      {@const t = tabById(pane.tab)}
      <Pane
        {pane}
        rect={pane.tab === ui.active && !pane.closed ? layout.panes.get(pane.id) : null}
        selected={t?.selected === pane.id}
        maximized={t?.maximized === pane.id}
      />
    {/each}
    {#each layout.dividers as d}
      <div class="divider {d.dir}" style={px(d.rect)} onpointerdown={(e) => startResize(e, d)} role="separator"></div>
    {/each}
    {#if ui.drag?.drop}<div class="drop-zone" style={px(ui.drag.drop.rect)}></div>{/if}
    {#if !tab?.tree}
      <div id="empty">
        <div class="empty-title">Type a command below</div>
        <div class="empty-sub">Each command gets its own terminal, docked below the last one.</div>
        <div class="empty-sub">Esc for view mode · drag a header to dock it elsewhere · <kbd>?</kbd> for every shortcut</div>
      </div>
    {/if}
  </main>
</div>

{#if ui.drag}<div class="drag-ghost" style="left:{ui.drag.x + 12}px;top:{ui.drag.y + 12}px">{ui.drag.label}</div>{/if}

<footer id="bar">
  <Prompt />
  {#if !ui.connected}<div id="conn">Disconnected — retrying…</div>{/if}
</footer>

{#if ui.help}
  <div id="help" role="presentation" onclick={() => (ui.help = false)}>
    <div class="help-card" role="dialog" aria-label="Keyboard shortcuts" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="help-title">Keyboard shortcuts <span class="muted">Esc or ? to close</span></div>
      <div class="help-cols">
        {#each MODES as [mode, title]}
          <section>
            <h3>{title}</h3>
            {#each SHORTCUTS.filter((s) => s.mode === mode) as s}
              <div class="row"><kbd>{s.label}</kbd><span>{s.desc}</span></div>
            {/each}
          </section>
        {/each}
        <section>
          <h3>Mouse</h3>
          <div class="row"><kbd>click</kbd><span>Select a terminal (view mode); drag to select text, Shift+drag in mouse apps</span></div>
          <div class="row"><kbd>double-click</kbd><span>Insert mode in that terminal</span></div>
          <div class="row"><kbd>drag header</kbd><span>Dock next to a terminal, a window edge, or onto a tab</span></div>
          <div class="row"><kbd>drag gap</kbd><span>Resize</span></div>
          <div class="row"><kbd>dbl-click header</kbd><span>Maximize / restore</span></div>
        </section>
      </div>
    </div>
  </div>
{/if}
