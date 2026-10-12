// TRANSPORT: how co-op messages travel (docs/MULTIPLAYER.md). One shape, so the game never knows which: {send(text), close(),
// open, onopen, onmessage(text), onclose(why)}. Today a browser WebSocket to server/server.mjs; the packaged game (Electron)
// can swap in another (Steam networking, WebRTC, an IPC pipe) with the same shape (net/client.js takes any).
//   const tr = wsTransport('ws://host:8320/mp')
export function wsTransport(url) {
  const T = {open: false, onopen: null, onmessage: null, onclose: null, url,
    send(text) { if (T.open) ws.send(text); },
    close() { try { ws.close(1000); } catch {} },
  };
  const ws = new WebSocket(url);
  ws.onopen = () => { T.open = true; T.onopen?.(); };
  ws.onmessage = e => { if (typeof e.data === 'string') T.onmessage?.(e.data); };
  ws.onclose = e => { const was = T.open; T.open = false; T.onclose?.(e.reason || (was ? 'closed' : 'could not connect')); };
  ws.onerror = () => {};   // (onclose follows with the reason)
  return T;
}
