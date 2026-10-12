// WS: a small WebSocket server (RFC 6455) on node's own http server, no dependencies. Enough for the co-op room: the
// upgrade handshake, text and binary messages (fragmented or not, masked as clients must), ping / pong, close. One
// connection is {send(text), close(code, why), onmessage, onclose, ip}; the room never sees frames.
// Swappable: the room (room.mjs) talks to connections through that small shape only, so another transport (Steam
// networking, WebRTC, Electron IPC) is a module with the same shape (transport.mjs).
//   attachWs(httpServer, '/mp', conn => { conn.onmessage = text => ...; conn.onclose = () => ... })
import {createHash} from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 1 << 20;   // a message larger than 1 MB closes the connection (a client never sends one)

export function attachWs(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);
    onConnection(wrap(socket, req));
  });
}

function frame(op, payload) {
  const n = payload.length, head = n < 126 ? 2 : n < 65536 ? 4 : 10, b = Buffer.allocUnsafe(head + n);
  b[0] = 0x80 | op;
  if (n < 126) b[1] = n;
  else if (n < 65536) { b[1] = 126; b.writeUInt16BE(n, 2); }
  else { b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); }
  payload.copy(b, head);
  return b;
}

function wrap(socket, req) {
  let buf = Buffer.alloc(0), parts = [], partOp = 0, open = true;
  const conn = {
    ip: req.socket.remoteAddress, onmessage: null, onclose: null,
    get open() { return open; },
    send(text) { if (open) socket.write(frame(1, Buffer.from(text))); },
    close(code = 1000, why = '') {
      if (!open) return;
      const p = Buffer.alloc(2 + Buffer.byteLength(why)); p.writeUInt16BE(code, 0); p.write(why, 2);
      socket.write(frame(8, p)); end();
    },
  };
  function end() { if (!open) return; open = false; socket.end(); conn.onclose?.(); }
  socket.on('data', d => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let n = buf[1] & 0x7f, o = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
      if (n > MAX_MSG) { conn.close(1009, 'too big'); return; }
      if (!masked) { conn.close(1002, 'unmasked'); return; }   // (a client's frames are always masked)
      if (buf.length < o + 4 + n) return;
      const mask = buf.subarray(o, o + 4), data = Buffer.from(buf.subarray(o + 4, o + 4 + n));
      for (let i = 0; i < n; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(o + 4 + n);
      if (op === 8) { end(); return; }                                  // close
      if (op === 9) { if (open) socket.write(frame(10, data)); continue; } // ping -> pong
      if (op === 10) continue;                                          // pong
      if (op === 1 || op === 2) { parts = [data]; partOp = op; } else if (op === 0) parts.push(data); else continue;
      if (fin) { const all = parts.length === 1 ? parts[0] : Buffer.concat(parts); parts = []; if (partOp === 1 || partOp === 2) conn.onmessage?.(all.toString('utf8')); }
    }
  });
  socket.on('close', end); socket.on('error', end);
  return conn;
}
