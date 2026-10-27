#!/usr/bin/env node
// shelf in a browser: serves the UI and bridges it to core.js over a
// WebSocket. The desktop app (main.js) does the same over Electron IPC.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Session, ptyBackend, cleanEnv, resolveAsset, mimeOf, loadSettings } = require('./core');

const PORT = Number(process.env.PORT || 7777);
const HOST = process.env.HOST || '127.0.0.1';

// One cwd/env shared by every tab, so reloading the page keeps your place.
const arg = process.argv[2];
const state = {
  cwd: arg && fs.existsSync(arg) ? path.resolve(arg) : os.homedir(),
  env: cleanEnv(process.env),
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { url = null; }
  const file = url && resolveAsset(url);
  if (!file) { res.writeHead(404); return res.end('not found (did you run npm install?)'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': mimeOf(file), 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://${HOST}:${PORT}`]);
const wss = new WebSocketServer({
  server,
  // Browsers always send Origin: refuse other websites from reaching your shell.
  verifyClient: ({ origin }) => !origin || allowedOrigins.has(origin),
});

wss.on('connection', (ws) => {
  const session = new Session(state);
  session.on('message', (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); });
  loadSettings();   // a page load: pick up hand edits to the settings file
  session.emitState();
  ws.on('message', (raw) => { try { session.handle(JSON.parse(raw)); } catch {} });
  ws.on('close', () => session.dispose());
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
// One misbehaving pane must never take down every other running command.
process.on('uncaughtException', (err) => console.error('[shelf] error:', err.message));

server.listen(PORT, HOST, () => {
  console.log(`Shelf running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`PTY backend: ${ptyBackend === 'node-pty' ? 'node-pty' : 'python fallback (npm i node-pty for the native one)'}`);
});
