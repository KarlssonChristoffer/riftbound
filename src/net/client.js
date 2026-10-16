// NET CLIENT: this page's side of a co-op room (docs/MULTIPLAYER.md; the server: server/room.mjs). Speaks the protocol
// (net/protocol.js) over any transport (net/transport.js), keeps the other players' snapshots, and answers "where was peer X
// at time t" for the view, a little in the past (INTERP_MS) so it can interpolate between two snapshots. No game imports:
// features/coop.js connects it to the world.
//   const C = createNetClient({transport, name}); C.peers (Map id -> peer); C.sendState(o); C.act(a, id, o?);
//   C.sample(peer, now, out) -> out {x, y, z, phi, s, pose, ls}; C.drain() -> the queued sim messages (world / fix / deny /
//   clock / sec / ev / gear: your own set as the server took it); C.wear(ids) asks for a set; a peer's q.gear (ids) / q.gv
//   (its version); C.elk: the night elk's snapshots (a ring like a peer's: C.sample(C.elk, out) -> s = its mode's index,
//   pose = its quarry's id); C.soot: the cave's soot things' rings (C.sample(C.soot[k], out): z its height, s its mode's index);
//   a peer's q.lt: their lantern burns in the cave (the latest snapshot; 2, a burnt eel's eyes, is not a light); q.md: the meal in
//   them (content/meals.js codeOf); q.bd: their body's look (content/body.js packBody); C.serverNow() -> the server's clock (ms) now
// OWNS: the connection's state, the peers' snapshot rings, the clock offset. READS: the transport.
import {VERSION, INTERP_MS, encode, decode} from './protocol.js';

const RING = 32;   // snapshots kept per peer (1.6 s at 20 Hz)

export function createNetClient({transport, name = ''}) {
  const C = {
    status: 'connecting', why: '', id: 0, name: '', color: '', seed: null, world: new Map(), peers: new Map(), unc: null,
    ping: 0, joined: [], left: [],
  };
  const queue = [];         // sim messages (world, fix, deny), handed to the game's step by drain()
  let offset = NaN;         // server clock - performance.now(), the smallest seen (the least delayed snapshot)
  const B64 = new Map();    // (decoded poses by their string: a pose that didn't change isn't decoded again)

  const ring = (id, name = '', color = '', wn = null, rig = '') => ({id, name, color, wn, rig, n: 0, head: 0, T: new Float64Array(RING), X: new Float32Array(RING), Y: new Float32Array(RING),
    Z: new Float32Array(RING), F: new Float32Array(RING), S: new Array(RING).fill('idle'), P: new Array(RING).fill('idle.0'), W: new Array(RING).fill(null), L: new Array(RING).fill(null), w: null, wv: 0});
  function peer(p) {
    let q = C.peers.get(p.id);
    if (!q) { q = ring(p.id, p.name, p.color, p.wn || null, p.rig || ''); q.gear = Array.isArray(p.g) ? p.g : []; q.gv = 0; C.peers.set(p.id, q); C.joined.push(q); }
    return q;
  }
  C.elk = ring(-1); C.soot = [];
  function push(q, t, x, y, z, phi, s, pose, rig, w, ls) {
    if (w) { let a = B64.get(w); if (!a) { a = unb64(w); if (B64.size > 64) B64.clear(); B64.set(w, a); } q.w = a; q.wv++; }
    const i = q.head; q.head = (q.head + 1) % RING; q.n = Math.min(RING, q.n + 1);
    q.T[i] = t; q.X[i] = x; q.Y[i] = y; q.Z[i] = z; q.F[i] = phi; q.S[i] = s; q.P[i] = pose; q.W[i] = q.w; q.L[i] = ls || null;
    if (rig !== q.rig) q.rig = rig;
  }
  const onMsg = text => {
    const m = decode(text); if (!m) return;
    switch (m.k) {
      case 'welcome':
        Object.assign(C, {status: 'online', id: m.id, name: m.name, color: m.color, seed: m.seed});
        for (const [id, s] of Object.entries(m.world || {})) { C.world.set(id, s); queue.push({...s, k: 'world', id, s: s.s, by: s.by, late: true}); }   // (its own fields too: a struck vein's blows left)
        for (const p of m.peers || []) { const q = peer(p); if (p.x !== undefined) push(q, m.t, p.x, p.y, p.z, p.phi, p.s, p.pose, p.rig, p.w, p.ls); }
        offset = m.t - performance.now();
        if (m.clock) queue.push({k: 'clock', t: m.clock.t, h: m.clock.h, rate: m.clock.rate});
        C.unc = m.unc || null;
        for (const [id, s] of Object.entries(m.unc?.sec || {})) queue.push({k: 'sec', id, s: s.s, by: s.by, n: s.n, late: true});
        break;
      case 'join': peer(m.p); break;
      case 'leave': { const q = C.peers.get(m.id); if (q) { C.peers.delete(m.id); C.left.push(q); } break; }
      case 'wn': { const q = C.peers.get(m.id); if (q) { q.wn = m.wn; q.wv++; } break; }
      case 'snap': {
        const o = m.t - performance.now(); if (!(o >= offset)) offset = o; else offset += (o - offset) * .002;   // (drifts up slowly: a late spike doesn't stick)
        for (const r of m.p) { if (r[0] === C.id) continue; const q = C.peers.get(r[0]); if (q) { push(q, m.t, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8] || null, r[9] || null); q.lt = r[10] === 1; q.md = typeof r[11] === 'string' ? r[11] : ''; q.bd = r[12] | 0; } }
        if (m.c) push(C.elk, m.t, m.c[0], m.c[1], 0, m.c[2], m.c[3], m.c[4], '', null, null);
        if (m.sn) for (let i = 0, k = 0; i + 3 < m.sn.length; i += 4, k++) push(C.soot[k] ??= ring(-2 - k), m.t, m.sn[i], m.sn[i + 1], m.sn[i + 2], 0, m.sn[i + 3], '', '', null, null);
        break;
      }
      case 'world': if (m.s === 'grown') C.world.delete(m.id); else C.world.set(m.id, {s: m.s, by: m.by}); queue.push(m); break;   // (grown: a patch or a vein back, features/forage.js, mining.js)
      case 'fix': case 'deny': case 'clock': case 'sec': case 'ev': case 'fish': case 'bolt': case 'snow': queue.push(m); break;   // (bolt: natural lightning, features/thunder.js; snow: a snowball hit someone, features/winter.js)
      case 'gear': {
        if (!Array.isArray(m.g)) break;
        if (m.id === C.id) { queue.push(m); break; }   // (yours: a sim message, features/gear.js wears it at a step)
        const q = C.peers.get(m.id); if (q) { q.gear = m.g; q.gv++; }
        break;
      }
      case 'pong': C.ping = performance.now() - m.c; break;
    }
  };
  transport.onmessage = onMsg;
  transport.onopen = () => { transport.send(encode({k: 'hello', v: VERSION, name})); };
  transport.onclose = why => { C.status = 'offline'; C.why = why; };
  if (transport.open) transport.onopen();

  // "where was q at time t": the two snapshots round the render time, lerped (the facing the short way round); the pose, the
  // state and the lasso are the older one's (they step). Past the newest: held there (no guessing ahead)
  C.sample = (q, out) => {
    if (!q.n) return null;
    const t = performance.now() + offset - INTERP_MS;
    let a = -1, b = -1;   // a: the newest snapshot at or before t, b: the one after it
    for (let k = 0; k < q.n; k++) { const i = (q.head - 1 - k + RING) % RING; if (q.T[i] <= t) { a = i; break; } b = i; }
    if (a < 0) a = b;     // (all newer than t: the oldest)
    if (b < 0) b = a;     // (a is the newest: held)
    let u = 0;
    if (a !== b && q.T[b] > q.T[a]) u = Math.max(0, Math.min(1, (t - q.T[a]) / (q.T[b] - q.T[a])));
    const d = q.F[b] - q.F[a], df = d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
    out.x = q.X[a] + (q.X[b] - q.X[a]) * u; out.y = q.Y[a] + (q.Y[b] - q.Y[a]) * u; out.z = q.Z[a] + (q.Z[b] - q.Z[a]) * u; out.phi = q.F[a] + df * u;
    out.s = q.S[a]; out.pose = q.P[a]; out.w = q.W[a]; out.ls = q.L[a];
    return out;
  };
  C.sendState = o => transport.send(encode({k: 'st', ...o}));
  C.act = (a, id, o) => transport.send(encode({...o, k: 'act', a, id}));   // (o: the act's own fields: a pick's lvl)
  C.wear = g => transport.send(encode({k: 'gear', g}));
  C.fish = o => transport.send(encode({...o, k: 'fish'}));   // (features/fishing.js: a cast, a landed fish, a lost one)
  C.snow = o => transport.send(encode({...o, k: 'snow'}));   // (features/winter.js: his snowball hit a friend)
  C.pingNow = () => transport.send(encode({k: 'ping', c: performance.now()}));
  C.serverNow = () => performance.now() + (offset || 0);
  C.drain = out => { while (queue.length) out.push(queue.shift()); return out; };
  C.close = () => transport.close();
  return C;
}

// base64 <-> Int16Array (the pose's bones: protocol.js packPose)
export function b64(a) { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
export function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Int16Array(u.buffer, 0, u.length >> 1); }
