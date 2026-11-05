<script>
  // Hover popup on the git pill: changed files, then commits (unpushed first, older on request);
  // hovering a commit opens a second popup beside it with its files and actions, hovering a file (changed, or in that commit) one with its diff.
  // Both are fixed-positioned because #cwd clips its overflow.
  import { send } from './conn.js';
  import { ui, handlers, activeTab, runCommand } from './store.svelte.js';

  const git = $derived(activeTab()?.git);
  let pos = $state(null), older = $state(0), log = $state(null), files = $state(null), detail = $state(null), diff = $state(null), copied = $state(false);
  const shown = {};   // sha → git-show reply
  let timer, box, detailBox;

  // Closing waits a moment so the pointer can cross the gaps between pill and popups.
  const keep = () => clearTimeout(timer);
  const close = () => { clearTimeout(intent); pos = detail = diff = log = files = null; older = 0; };
  export const hide = () => { timer = setTimeout(close, 200); };
  export function show(anchor) {
    keep();
    if (!git || pos) return;
    const r = anchor.getBoundingClientRect();
    pos = { left: r.left, bottom: innerHeight - r.top + 6 };
  }

  // Changed files (with line counts) and the unpushed commits (at least 5) plus `older` more, fetched only while
  // open; the effect re-runs whenever the tab's git state changes, so both follow the pill.
  const want = $derived(pos && git ? Math.max(git.ahead, 5) + older : 0);
  $effect(() => { if (pos && git) send({ type: 'git-files', tab: ui.active }); });
  $effect(() => { if (want) send({ type: 'git-log', tab: ui.active, n: want, head: git.branch }); });
  handlers['git-files'] = (m) => { if (pos && m.tab === ui.active) files = m; };
  handlers['git-log'] = (m) => { if (pos && m.tab === ui.active) log = m; };
  handlers['git-diff'] = (m) => { if (diff?.path === m.path && diff.sha === m.sha) diff = { ...diff, info: m }; };
  handlers['git-show'] = (m) => { shown[m.sha] = m; if (detail?.sha === m.sha) detail = { ...detail, info: m }; };

  // Switches (or clears) only once the pointer rests on a row, so a diagonal move toward the
  // open detail popup doesn't flip it to every row crossed on the way.
  let intent;
  function hoverCommit(c, e) {
    clearTimeout(intent);
    const r = e.currentTarget.getBoundingClientRect();
    if (!detail) showCommit(c, r); else intent = setTimeout(() => showCommit(c, r), 150);
  }
  const clearSoon = () => { clearTimeout(intent); intent = setTimeout(() => (detail = diff = null), 150); };
  const beside = (r, el = box) => ({ left: el.getBoundingClientRect().right + 4, bottom: innerHeight - r.bottom - 6, maxH: r.bottom - 8 });
  // `sha` set: a file of the open commit, whose diff opens beside the commit popup, which stays.
  function hoverFile(f, e, sha) {
    clearTimeout(intent);
    if (f.path.endsWith('/')) return sha ? (intent = setTimeout(() => (diff = null), 150)) : clearSoon();
    const r = e.currentTarget.getBoundingClientRect();
    const showDiff = () => {
      if (!sha) detail = null;
      diff = { path: f.path, sha, ...beside(r, sha ? detailBox : box) };
      send({ type: 'git-diff', tab: ui.active, path: f.path, sha, untracked: f.xy === '??' });
    };
    if (!(sha ? diff : detail || diff)) showDiff(); else intent = setTimeout(showDiff, 150);
  }
  function showCommit(c, r) {
    copied = false;
    diff = null;
    detail = { sha: c.sha, c, info: shown[c.sha], ...beside(r) };
    if (!detail.info) send({ type: 'git-show', tab: ui.active, sha: c.sha });
  }

  const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const run = (cmd) => { close(); runCommand(cmd, true, true); };
  function copyHash() {
    navigator.clipboard?.writeText(detail.sha).then(() => (copied = true), () => {});
  }
  const openFile = (f) => { const abs = files.root + '/' + f.path.replace(/\/$/, ''); close(); send({ type: 'open', tab: ui.active, abs }); };

  // Kind from the porcelain letters: conflict, untracked, added, deleted, renamed, else modified.
  const KINDS = { U: ['conflict', '!'], '?': ['new', '+'], A: ['new', '+'], D: ['del', '−'], R: ['ren', '→'], C: ['new', '+'], M: ['mod', '●'] };
  const kind = (xy) => KINDS[xy.includes('U') || xy === 'AA' || xy === 'DD' ? 'U' : (xy[0] !== ' ' ? xy[0] : xy[1])] || KINDS.M;
  const split = (p) => { const i = p.lastIndexOf('/', p.length - 2); return [p.slice(0, i + 1), p.slice(i + 1)]; };
  const nodown = (e) => e.preventDefault();   // keep focus where it is
</script>

{#snippet fileRow(f, onclick, disabled)}
  {@const [k, icon] = kind(f.xy)}
  {@const [dir, base] = split(f.path)}
  <button class="gf {k}" role="menuitem" {disabled} onpointerdown={nodown} {onclick}>
    <span class="ic">{icon}</span><span class="p"><span class="dir">{dir}</span>{base}</span>
    {#if f.add || f.del}<span class="n">{#if f.add}<span class="add">+{f.add}</span>{/if} {#if f.del}<span class="del">−{f.del}</span>{/if}</span>{/if}
  </button>
{/snippet}

{#if pos && git}
  <div class="gitpop" role="menu" tabindex="-1" bind:this={box} style:left="{pos.left}px" style:bottom="{pos.bottom}px" onmouseenter={keep} onmouseleave={hide}>
    {#if git.dirty}
      <div class="gh" role="none" onmouseenter={clearSoon}>Changes</div>
      {#each files?.files ?? [] as f}
        <div role="none" onmouseenter={(e) => hoverFile(f, e)} onmouseleave={() => clearTimeout(intent)}>{@render fileRow(f, () => openFile(f), kind(f.xy)[0] === 'del')}</div>
      {/each}
      {#if !files}<div class="gf more">Loading…</div>{/if}
      {#if files?.more}<div class="gf more">… {files.more} more</div>{/if}
    {/if}
    <div class="gh" role="none" onmouseenter={clearSoon}>{git.ahead ? `Commits · ${git.ahead} unpushed` : 'Commits'}</div>
    {#each log?.commits ?? [] as c (c.sha)}
      <button class="gc" class:pushed={!c.unpushed} class:on={detail?.sha === c.sha} role="menuitem" onpointerdown={nodown}
        onmouseenter={(e) => hoverCommit(c, e)} onmouseleave={() => clearTimeout(intent)} onclick={() => run('git show ' + c.sha)}>
        <span class="ic">{c.unpushed ? '↑' : '•'}</span><span class="sha">{c.short}</span><span class="p">{c.subject}</span><span class="when">{c.when}</span>
      </button>
    {/each}
    {#if !log || log.more}
      <button class="gf older" role="menuitem" onpointerdown={nodown} onmouseenter={clearSoon} onclick={() => (older += 10)}>Show older commits…</button>
    {/if}
  </div>
{/if}

{#if pos && detail}
  {@const info = detail.info}
  <div class="gitpop gitdetail" role="menu" tabindex="-1" bind:this={detailBox} style:left="{detail.left}px" style:bottom="{Math.max(detail.bottom, 8)}px" style:max-height="{detail.maxH}px" onmouseenter={() => { keep(); clearTimeout(intent); }} onmouseleave={hide}>
    <div class="gd-head" role="none" onmouseenter={() => { clearTimeout(intent); intent = setTimeout(() => (diff = null), 150); }}>
      <div class="gd-subj">{detail.c.subject}</div>
      {#if info?.body && info.body !== detail.c.subject}<pre class="gd-body">{info.body.slice(detail.c.subject.length).trim()}</pre>{/if}
      <div class="gd-meta"><span class="sha">{detail.sha.slice(0, 12)}</span> · {info?.author ?? detail.c.author} · {info?.date ?? detail.c.when}</div>
      <div class="gd-acts">
        <button onpointerdown={nodown} onclick={copyHash}>{copied ? 'Copied ✓' : 'Copy hash'}</button>
        <button onpointerdown={nodown} onclick={() => run('git show ' + detail.sha)}>Show diff</button>
      </div>
    </div>
    {#if !info}<div class="gf more">Loading…</div>
    {:else}
      {#each info.files.slice(0, 100) as f}
        <div role="none" onmouseenter={(e) => hoverFile(f, e, detail.sha)} onmouseleave={() => clearTimeout(intent)}>{@render fileRow(f, () => files && run(`git show ${detail.sha} -- ${shq(files.root + '/' + f.path)}`))}</div>
      {/each}
      {#if info.files.length > 100}<div class="gf more">… {info.files.length - 100} more</div>{/if}
      {#if !info.files.length}<div class="gf more">No file changes</div>{/if}
    {/if}
  </div>
{/if}

{#if pos && diff}
  <div class="gitpop gitdiff" role="none" style:left="{diff.left}px" style:bottom="{Math.max(diff.bottom, 8)}px" style:max-height="{diff.maxH}px" onmouseenter={() => { keep(); clearTimeout(intent); }} onmouseleave={hide}>
    <div class="gd-head"><div class="gd-subj">{diff.path}</div></div>
    {#if !diff.info}<div class="gf more">Loading…</div>
    {:else if !diff.info.lines.length}<div class="gf more">No diff to show</div>
    {:else}
      <pre>{#each diff.info.lines as l}<span class={l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : ''}>{l}</span>
{/each}</pre>
      {#if diff.info.more}<div class="gf more">… truncated</div>{/if}
    {/if}
  </div>
{/if}
