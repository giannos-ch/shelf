'use strict';
// shelf desktop app (Electron main process).
// Each window gets its own session from core.js; the page talks to it through
// the preload bridge over IPC, so there is no local server or open port.

const { app, BrowserWindow, ipcMain, protocol, Menu, dialog, shell, session: electronSession } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Session, cleanEnv, resolveAsset, mimeOf } = require('./core');

const isMac = process.platform === 'darwin';
const ORIGIN = 'app://shelf';
const sessions = new Map();   // webContents.id -> Session
let baseEnv = cleanEnv(process.env);

app.setName('Shelf');
process.on('uncaughtException', (err) => console.error('[shelf] error:', err));

// Serve the UI from app://shelf/… using the same URL layout as server.js.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerProtocol() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    let file = null;
    try { file = url.host === 'shelf' && resolveAsset(decodeURIComponent(url.pathname)); } catch {}
    if (!file) return new Response('not found', { status: 404 });
    try {
      return new Response(await fs.promises.readFile(file), { headers: { 'content-type': mimeOf(file) } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// Apps started from the Dock/launcher get a bare environment (PATH without
// Homebrew, nvm, ~/.local/bin…). Ask the user's login shell for the real one.
function loadLoginEnv() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') return resolve(null);
    const userShell = process.env.SHELL || os.userInfo().shell || '/bin/bash';
    const mark = '__SHELF_ENV__';
    const node = `'${process.execPath.replace(/'/g, `'\\''`)}'`;
    const script = `printf '${mark}'; ELECTRON_RUN_AS_NODE=1 ${node} -e 'process.stdout.write(JSON.stringify(process.env))'; printf '${mark}'`;
    const env = cleanEnv(process.env);
    execFile(userShell, ['-ilc', script], { env, timeout: 6000, maxBuffer: 8 << 20 }, (err, out) => {
      const m = (out || '').split(mark);
      try { resolve(m.length >= 3 ? cleanEnv(JSON.parse(m[1])) : null); } catch { resolve(null); }
    });
  });
}

// Starting folder: a directory passed on the command line, else home.
function startDir() {
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && a !== '.');
  for (const a of args) {
    try { if (fs.statSync(a).isDirectory()) return path.resolve(a); } catch {}
  }
  return os.homedir();
}

function focusedCwd() {
  const win = BrowserWindow.getFocusedWindow();
  const s = win && sessions.get(win.webContents.id);
  return s ? s.state.cwd : startDir();
}

function createWindow(cwd = startDir()) {
  const win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 560, minHeight: 360,
    title: 'Shelf',
    backgroundColor: '#0d0f13',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const wc = win.webContents;
  const id = wc.id;
  // Each window is its own shell session, starting where the last one was.
  const sess = new Session({ cwd, env: { ...baseEnv } });
  sessions.set(id, sess);
  sess.on('message', (msg) => { if (!wc.isDestroyed()) wc.send('shelf:msg', msg); });

  // Links in output open in the real browser; the window never navigates away.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.on('close', (e) => {
    const n = sess.runningCount;
    if (!n) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Close', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `${n} command${n > 1 ? 's are' : ' is'} still running`,
      detail: 'Closing this window will stop them.',
    });
    if (choice === 1) e.preventDefault();
  });
  win.on('closed', () => { sess.dispose(); sessions.delete(id); });
  win.once('ready-to-show', () => win.show());

  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

ipcMain.on('shelf:send', (e, msg) => {
  // Only our own page may drive a shell.
  if (!e.senderFrame || !e.senderFrame.url.startsWith(ORIGIN + '/')) return;
  sessions.get(e.sender.id)?.handle(msg);
});

// Keyboard shortcuts must not steal keys from programs running in panes, so
// on Linux every app shortcut uses Ctrl+Shift (Ctrl+W, Ctrl+N… stay with the
// terminal). On macOS the Cmd key is free for the app.
function buildMenu() {
  const key = (mac, other) => (isMac ? mac : other);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: key('Cmd+N', 'Ctrl+Shift+N'), click: () => createWindow(focusedCwd()) },
        { type: 'separator' },
        { label: 'Close Window', accelerator: key('Cmd+W', 'Ctrl+Shift+W'), click: (_i, w) => w?.close() },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'Quit', accelerator: 'Ctrl+Shift+Q', click: () => app.quit() }]),
      ],
    },
    // On macOS Cmd+C/Cmd+V only work through the Edit menu. Elsewhere Chromium
    // handles copy/paste itself, and a Ctrl+C shortcut would break interrupts.
    ...(isMac ? [{ role: 'editMenu' }] : []),
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn', accelerator: key('Cmd+=', 'Ctrl+Shift+=') },
        { role: 'zoomOut', accelerator: key('Cmd+-', 'Ctrl+Shift+-') },
        { role: 'resetZoom', accelerator: key('Cmd+0', 'Ctrl+Shift+0') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Reload Window (stops running commands)', click: (_i, w) => w?.webContents.reload() },
        { role: 'toggleDevTools', accelerator: key('Alt+Cmd+I', 'Ctrl+Shift+I') },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  // The page needs no camera, notifications, etc. — only clipboard writes for copy.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  registerProtocol();
  buildMenu();
  const loginEnv = await loadLoginEnv();
  if (loginEnv) baseEnv = loginEnv;
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
