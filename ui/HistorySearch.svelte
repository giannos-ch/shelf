<script>
  import { ui } from './store.svelte.js';
  import { matches, toggleSearch, closeSearch } from './history.js';

  let sel = $state(0), search = $state();
  const found = $derived(matches(ui.hsearch.q));
  $effect(() => { search?.focus(); });
  $effect(() => { sel; found; search?.parentElement.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); });

  function onkeydown(e) {
    const step = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (step) { e.preventDefault(); sel = Math.max(0, Math.min(found.length - 1, sel + step)); }
    else if (e.key === 'Enter') { e.preventDefault(); closeSearch(found[sel]); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); toggleSearch(); }
  }
</script>

<div class="hsearch">
  <div class="hlist">
    {#each found as h, i}
      <button class:sel={i === sel} title={h} onpointerdown={(e) => e.preventDefault()} onclick={() => closeSearch(h)}>{h}</button>
    {:else}<span class="more">no matches</span>{/each}
  </div>
  <input bind:this={search} bind:value={ui.hsearch.q} spellcheck="false" autocomplete="off" placeholder="Search history…"
    oninput={() => (sel = 0)} {onkeydown} onblur={() => (ui.hsearch = null)} />
</div>
