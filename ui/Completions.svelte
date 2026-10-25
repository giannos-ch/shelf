<script>
  import { ui } from './store.svelte.js';
  import { pick, label } from './complete.js';
</script>

<div class="completions">
  {#each ui.comp.items as it}<button title={it} onpointerdown={(e) => e.preventDefault()} onclick={() => pick(it)}>{label(it)}</button>{/each}
  {#if ui.comp.more}<span class="more">+{ui.comp.more} more</span>{/if}
</div>
