// Colour themes: `css` sets the variables style.css uses, `term` is the xterm palette.
export const THEMES = {
  dark: {
    css: {
      bg: '#0d0f13', grid: '#161a21', pane: '#12151b', head: '#1a1e26', 'head-focus': '#212734', chrome: '#10131a',
      line: '#262c38', 'line-focus': '#5b8def', text: '#d7dce5', muted: '#7d8696', accent: '#5b8def',
      run: '#e3b341', ok: '#3fb950', err: '#f85149', hover: 'rgba(255,255,255,.08)', thumb: '#2b3240', 'thumb-hover': '#3a4356',
    },
    term: {
      background: '#12151b', foreground: '#d7dce5', cursor: '#e3b341', cursorAccent: '#12151b',
      selectionBackground: '#2f3a52',
      black: '#1b1f27', red: '#f85149', green: '#3fb950', yellow: '#e3b341', blue: '#5b8def',
      magenta: '#bc8cff', cyan: '#39c5cf', white: '#d7dce5',
      brightBlack: '#5c6370', brightRed: '#ff7b72', brightGreen: '#56d364', brightYellow: '#f2cc60',
      brightBlue: '#79a6ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff',
    },
  },
  light: {
    css: {
      bg: '#f4f5f7', grid: '#e1e4e9', pane: '#ffffff', head: '#eef0f3', 'head-focus': '#e2e8f3', chrome: '#e9ebef',
      line: '#d5d9e0', 'line-focus': '#3b6fd8', text: '#1f2328', muted: '#6a7280', accent: '#3b6fd8',
      run: '#b7791f', ok: '#1a7f37', err: '#cf222e', hover: 'rgba(0,0,0,.06)', thumb: '#c6cbd3', 'thumb-hover': '#aab0ba',
    },
    term: {
      background: '#ffffff', foreground: '#1f2328', cursor: '#3b6fd8', cursorAccent: '#ffffff',
      selectionBackground: '#c8d7f5',
      black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700', blue: '#0969da',
      magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#116329', brightYellow: '#7d4e00',
      brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
    },
  },
};
