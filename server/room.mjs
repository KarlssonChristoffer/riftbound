// ROOM: the authoritative co-op session (docs/MULTIPLAYER.md). It owns who is in the world (ids, names, colours), the world's
// SEED (every client builds the same forest from it: src/world/forest.js), and the SHARED WORLD STATE (what has been done to
// the world: a felled tree), which only it changes (an act is a request; it checks it and tells everyone, late joiners get it
// all in their welcome). Each player's movement is simulated by its own client (prediction, no input lag) and checked here:
// a jump faster than a body can move is refused and the client put back (MOVE in the protocol). Snapshots of every player go
// out TICK_HZ times a second.
// Transport-free: a connection is {send(text), close(), onmessage, onclose} (ws.mjs, or any other transport with that shape).
//   const room = createRoom({seed, trees, log}); room.connect(conn); room.stop()
import {VERSION, TICK_HZ, MOVE, REACH, COLORS, encode, decode, num, str} from '../src/net/protocol.js';
import {cleanSet} from '../src/content/gear.js';

export function createRoom({seed, trees = null, log = () => {}, maxPlayers = 8}) {
  const peers = new Map();   // id -> peer (after its hello)
  const world = new Map();   // id -> {s, by, t}: the shared world's changes
  const t0 = Date.now(), now = () => Date.now() - t0;
  let nextId = 1;

  const pub = p => ({id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, phi: p.phi, s: p.s, pose: p.pose, rig: p.rig, w: p.w, wn: p.wn, ls: p.ls, g: p.gear});
  const others = (p, m) => { const t = encode(m); for (const q of peers.values()) if (q !== p) q.conn.send(t); };
  const all = m => { const t = encode(m); for (const q of peers.values()) q.conn.send(t); };

  function hello(conn, m) {
    if (peers.size >= maxPlayers) { conn.send(encode({k: 'deny', a: 'join', why: 'full'})); conn.close(1013, 'full'); return null; }
    if (num(m.v) !== VERSION) { conn.send(encode({k: 'deny', a: 'join', why: 'version ' + VERSION})); conn.close(1002, 'version'); return null; }
    const id = nextId++, used = new Set([...peers.values()].map(q => q.color)), color = COLORS.find(c => !used.has(c)) || COLORS[id % COLORS.length];
    const p = {conn, id, name: str(m.name, 20).replace(/[^\w .'-]/g, '') || 'Player ' + id, color, x: 0, y: 0, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', w: null, wn: null, ls: null, gear: [], gearT: -1e9,
      fresh: false, wNew: false, lastT: 0, placed: false, fixT: -1e9, acts: 0, actT: 0};
    conn.send(encode({k: 'welcome', v: VERSION, id, name: p.name, color, seed, t: now(), world: Object.fromEntries(world), peers: [...peers.values()].map(pub)}));
    peers.set(id, p);
    others(p, {k: 'join', p: pub(p)});
    log(`+ ${p.name} (#${id}) from ${conn.ip} · ${peers.size} in the room`);
    return p;
  }

  function state(p, m) {
    const x = num(m.x, p.x), y = num(m.y, p.y), z = num(m.z, p.z), t = now();
    if (Math.abs(x) > 2000 || Math.abs(y) > 2000 || Math.abs(z) > 200) return;
    // the movement check: the first state places him; after that a move faster than MOVE.maxSpeed (+ slack) is refused
    const dt = Math.min(1, Math.max(1 / TICK_HZ, (t - p.lastT) / 1000)), d = Math.hypot(x - p.x, y - p.y);
    if (p.placed && !m.tp && d > MOVE.maxSpeed * dt + MOVE.slack) {
      if (t - p.fixT > 400) { p.fixT = t; p.conn.send(encode({k: 'fix', x: p.x, y: p.y, z: p.z})); log(`  ${p.name}: a move of ${d.toFixed(1)} m in ${(dt * 1000) | 0} ms refused`); }
    } else { p.x = x; p.y = y; p.z = z; p.placed = true; }
    p.lastT = t;
    p.phi = num(m.phi, p.phi); p.s = str(m.s, 16) || p.s; p.pose = str(m.pose, 32) || p.pose;
    const rig = str(m.rig, 16);
    if (Array.isArray(m.wn) && m.wn.length <= 64) { p.wn = m.wn.map(b => str(b, 32)); others(p, {k: 'wn', id: p.id, wn: p.wn}); }
    if (rig !== p.rig) { p.rig = rig; if (!rig) { p.w = null; p.wn = null; } }
    if (typeof m.w === 'string' && m.w.length < 2048) { p.w = m.w; p.wNew = true; }
    p.ls = Array.isArray(m.ls) && m.ls.length === 5 ? m.ls.map((v, i) => i ? Math.round(num(v) * 100) / 100 : str(v, 8)) : null;
    p.fresh = true;
  }

  function act(p, m) {
    const id = str(m.id, 48), a = str(m.a, 16), t = now();
    if (t - p.actT > 1000) { p.actT = t; p.acts = 0; }
    if (++p.acts > 10) return;   // (a flood: dropped)
    const deny = why => p.conn.send(encode({k: 'deny', a, id, why}));
    if (a !== 'fell') return deny('unknown act');
    if (world.has(id)) return deny('gone');
    if (trees) {
      const tr = trees.get(id); if (!tr) return deny('no such tree');
      if (Math.hypot(tr[0] - p.x, tr[1] - p.y) > REACH) return deny('too far');
    }
    const s = {s: 'felled', by: p.id, t};
    world.set(id, s);
    all({k: 'world', id, s: s.s, by: p.id});
    log(`  ${p.name} felled ${id}`);
  }

  // GEAR (docs/GEAR.md): what a player wears is the server's to say. It takes the set (known pieces, one a slot:
  // content/gear.js cleanSet) and tells everyone, the wearer too. (No inventory yet: any known piece may be worn.)
  function wear(p, m) {
    const t = now(), mine = () => p.conn.send(encode({k: 'gear', id: p.id, g: p.gear}));   // (every ask gets an answer)
    if (t - p.gearT < 100) return mine();   // (a flood: refused, the set stays)
    p.gearT = t;
    const g = cleanSet(m.g);
    if (g.join(',') === p.gear.join(',')) return mine();
    p.gear = g;
    all({k: 'gear', id: p.id, g});
    log(`  ${p.name} wears ${g.join(', ') || 'their own clothes'}`);
  }

  function connect(conn) {
    let p = null;
    conn.onmessage = text => {
      const m = decode(text); if (!m) return;
      if (!p) { if (m.k === 'hello') p = hello(conn, m); return; }
      if (m.k === 'st') state(p, m);
      else if (m.k === 'act') act(p, m);
      else if (m.k === 'gear') wear(p, m);
      else if (m.k === 'ping') conn.send(encode({k: 'pong', c: num(m.c), t: now()}));
    };
    conn.onclose = () => {
      if (!p) return;
      peers.delete(p.id); others(p, {k: 'leave', id: p.id});
      log(`- ${p.name} (#${p.id}) · ${peers.size} in the room`);
      p = null;
    };
  }

  // THE TICK: everyone's latest state to everyone (a client skips its own row); a pose goes out only when it changed
  const timer = setInterval(() => {
    if (!peers.size) return;
    const rows = [];
    for (const p of peers.values()) {
      if (!p.placed) continue;
      rows.push([p.id, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +p.phi.toFixed(3), p.s, p.pose, p.rig, p.wNew ? p.w : 0, p.ls || 0]);
      p.wNew = false;
    }
    if (rows.length) all({k: 'snap', t: now(), p: rows});
  }, 1000 / TICK_HZ);

  return {
    connect, get size() { return peers.size; }, world, seed,
    stop() { clearInterval(timer); for (const p of peers.values()) p.conn.close(1001, 'server stopping'); },
  };
}
