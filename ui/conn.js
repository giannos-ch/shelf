// In the desktop app the preload script exposes window.shelf (Electron IPC);
// in a browser we talk to server.js over a WebSocket. Same messages.
const bridge = window.shelf || null;
let ws = null;
const outbox = [];

export const platform = bridge?.platform || null;

export function connect({ onMessage, onOpen, onClose }) {
  if (bridge) {
    bridge.onMessage(onMessage);
    bridge.send({ type: 'hello' });
    onOpen();
    return;
  }
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => { while (outbox.length) ws.send(outbox.shift()); onOpen(); };
  ws.onclose = () => { onClose(); setTimeout(() => connect({ onMessage, onOpen, onClose }), 1200); };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
}

export function send(msg) {
  if (bridge) return bridge.send(msg);
  const s = JSON.stringify(msg);
  if (ws && ws.readyState === 1) ws.send(s); else outbox.push(s);
}
