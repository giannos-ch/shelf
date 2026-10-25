'use strict';
// Exposes a minimal, message-only bridge to the page. The page never gets
// Node or Electron APIs directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelf', {
  platform: process.platform,
  send: (msg) => ipcRenderer.send('shelf:send', msg),
  onMessage: (cb) => {
    ipcRenderer.removeAllListeners('shelf:msg');
    ipcRenderer.on('shelf:msg', (_event, msg) => cb(msg));
  },
});
