<script>
  import { ui } from './store.svelte.js';
  import { matches, closeSearch, forgetMatch } from './history.js';

  let list = $state();
  const found = $derived(matches(ui.hsearch.q));
  $effect(() => { ui.hsearch?.sel; found; list?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); });
</script>

{#if found.length}
  <div class="hsearch">
    <div class="hlist" bind:this={list}>
      {#each found as h, i}
        <!-- pointerdown is cancelled so the prompt keeps focus and the list stays open -->
        <div class="hrow" class:sel={i === ui.hsearch.sel} onpointerdown={(e) => e.preventDefault()}>
          <button class="pick" title={h} onclick={() => closeSearch(h)}>{h}</button>
          <button class="x" title="Remove from history (Shift+Delete)" onclick={() => forgetMatch(i)}>✕</button>
        </div>
      {/each}
    </div>
  </div>
{/if}
