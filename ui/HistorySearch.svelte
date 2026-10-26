<script>
  import { ui } from './store.svelte.js';
  import { matches, closeSearch } from './history.js';

  let list = $state();
  const found = $derived(matches(ui.hsearch.q));
  $effect(() => { ui.hsearch?.sel; found; list?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); });
</script>

{#if found.length}
  <div class="hsearch">
    <div class="hlist" bind:this={list}>
      {#each found as h, i}
        <button class:sel={i === ui.hsearch.sel} title={h} onpointerdown={(e) => e.preventDefault()} onclick={() => closeSearch(h)}>{h}</button>
      {/each}
    </div>
  </div>
{/if}
