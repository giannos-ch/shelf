<script>
  import { ui, savePrefs, closeSettings } from './store.svelte.js';

  const int = (e, lo, hi) => Math.min(hi, Math.max(lo, parseInt(e.target.value, 10) || lo));
  const focusFirst = (node) => { node.querySelector('input, select')?.focus(); };
</script>

<div id="help" role="presentation" onclick={closeSettings}>
  <div class="help-card settings" role="dialog" aria-label="Settings" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} use:focusFirst>
    <div class="help-title">Settings <span class="muted">Esc to close · changes apply right away</span></div>
    <label>
      <span>Editor</span>
      <input value={ui.prefs.editor} spellcheck="false" placeholder="automatic"
        onchange={(e) => savePrefs({ editor: e.target.value })} />
      <small>Opens Ctrl+clicked paths, with {'{file}'}, {'{line}'}, {'{col}'} filled in: <code>code -g {'{file}:{line}:{col}'}</code>, <code>nvim +{'{line}'} {'{file}'}</code>. Empty: $SHELF_EDITOR, $VISUAL, $EDITOR, code, then xdg-open.</small>
    </label>
    <label>
      <span>Theme</span>
      <select value={ui.prefs.theme} onchange={(e) => savePrefs({ theme: e.target.value })}>
        <option value="dark">Dark</option><option value="light">Light</option><option value="system">Follow the system</option>
      </select>
    </label>
    <label>
      <span>Font size</span>
      <input type="number" min="8" max="32" value={ui.prefs.fontSize} onchange={(e) => savePrefs({ fontSize: int(e, 8, 32) })} />
    </label>
    <label>
      <span>Font</span>
      <input value={ui.prefs.fontFamily} spellcheck="false" placeholder="JetBrains Mono" onchange={(e) => savePrefs({ fontFamily: e.target.value })} />
    </label>
    <label>
      <span>Cursor</span>
      <select value={ui.prefs.cursorStyle} onchange={(e) => savePrefs({ cursorStyle: e.target.value })}>
        <option value="block">Block</option><option value="bar">Bar</option><option value="underline">Underline</option>
      </select>
    </label>
    {#if ui.prefsFile}<div class="muted file">Saved in {ui.prefsFile}</div>{/if}
  </div>
</div>
