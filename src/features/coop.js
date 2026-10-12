// CO-OP (docs/MULTIPLAYER.md): playing in one world with friends. ?mp=1 (the page served by node server/server.mjs) or
// ?mp=host:port joins the server's room; without it this feature is an empty shell that costs nothing.
//   the others   each player's own client simulates its body (no input lag) and sends where it is 20 times a second: place,
//                facing, state, the frame it plays and, drawn live, the drawn pose's bones; the room passes everyone's on.
//                The others are drawn from those, a little in the past, interpolated (features/coop/look.js)
//   the world    the server's seed built this forest (core/session.js, world/forest.js), so every client has the same trees
//                with the same ids. Changing the shared world is an ACT: asked of the server, which checks it (the tree is
//                there, the player in reach) and tells everyone, a late joiner included: then (and only then) each client
//                makes it so. Felling a tree today (act('fell', tree)); the woodcutting slice calls the same
//   checks       the server refuses a move faster than a body can go (protocol.js MOVE) and puts this client back (fix)
//   gear         what each player wears is the server's to say (docs/GEAR.md): features/gear.js asks (wear(ids)), the
//                server checks the set and tells everyone; yours comes back here (F.gear: {ver, ids}), the others' look.js dresses
// SIM vs VIEW: the shared world's changes (a felled tree, a fix) are applied in update, at a step, in the order the server sent
// them; what the others look like is view (look.js). Sending reads the player and the drawn pose after the frame's steps.
// OWNS: the connection (net/client.js), the send clock, the look. READS: host.player, host.playerPose (the drawn live pose),
//   the equipment's lasso (features/equip/lasso.js L), host.entities (the forest's trees by their fid).
// EMITS: nothing. BUDGET: update ~0 (a queue); frame: a send 20 times a second (~.02 ms: a pose packed only when it changed),
//   the look's.
import {SESSION} from '../core/session.js';
import {flags} from '../core/flags.js';
import {TICK_HZ, packPose} from '../net/protocol.js';
import {wsTransport} from '../net/transport.js';
import {createNetClient, b64} from '../net/client.js';
import {createPeerLook} from './coop/look.js';

// ORDER (core/features.js): after the equipment (the lasso's phase this step) and the combat (a felled tree's world is settled)
export const order = {after: ['equip', 'combat']};
export async function create(host) {
  if (!SESSION.mp) return SESSION.error ? offline(host) : {name: 'coop', on: false, online: false, act: () => false};
  let name = flags.get('name') || ''; try { name ||= localStorage.getItem('rb.coop.name') || ''; } catch {}
  const C = createNetClient({transport: wsTransport(SESSION.ws), name});
  const look = createPeerLook(host, C);
  const msgs = [], WH = Math.PI * 2;
  // the forest's trees by id (world/forest.js gives each its fid): a live list, a map made on a change
  const trees = host.entities.query('coop.trees', p => typeof p.fid === 'string');
  let byFid = null, byVer = -1;
  const treeOf = id => { if (byVer !== host.propsVersion || !byFid) { byFid = new Map(trees.map(p => [p.fid, p])); byVer = host.propsVersion; } return byFid.get(id) || null; };
  function fell(id) {
    const p = treeOf(id); if (!p) return;
    host.world.removeItem?.(p); host.entities.remove(p);
  }
  const gear = {ver: 0, ids: null};   // your set as the server last took it (features/gear.js wears it)
  let note = '', noteT = 0;
  const BYS = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null};   // (where the one who felled a tree is: its fall's way)
  const say = (t, s = 4) => { note = t; noteT = s; };

  // ---------------------------------------------------------------- sending: 20 times a second, after the frame's steps
  let sendT = 0, lastN = -1, lastRig = '', lastX = NaN, lastY = NaN, packed = null, sentW = null, pinged = 0;
  const ST = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', rig: '', w: undefined, wn: undefined, ls: undefined, tp: undefined};
  const LS = ['', 0, 0, 0, 0];
  function send(now) {
    if (C.status !== 'online' || now - sendT < 1000 / TICK_HZ) return;
    sendT = now;
    const P = host.player, pp = host.playerPose?.() || null;
    ST.x = +P.x.toFixed(3); ST.y = +P.y.toFixed(3); ST.z = +P.z.toFixed(3);
    ST.phi = +((pp ? pp.phi : P.faceAngle) % WH).toFixed(3); ST.s = P.state; ST.pose = P.frame || 'idle.0';
    ST.rig = pp ? pp.rig : ''; ST.w = ST.wn = ST.ls = ST.tp = undefined;
    if (ST.rig !== lastRig) { lastRig = ST.rig; lastN = -1; sentW = null; if (pp) ST.wn = pp.BN; }
    if (pp && pp.n !== lastN) {   // a new drawn frame: its bones, if they changed from what was sent
      lastN = pp.n; packed = packPose(pp.w, pp.BN.length, packed);
      if (!sentW || !same(packed, sentW)) { sentW = (sentW && sentW.length === packed.length) ? sentW : new Int16Array(packed.length); sentW.set(packed); ST.w = b64(packed); }
    }
    if (Math.hypot(ST.x - lastX, ST.y - lastY) > 4) ST.tp = 1;   // (a respawn, a teleport: the server lets that one through)
    lastX = ST.x; lastY = ST.y;
    const L = host.feature('equip')?.sim?.lasso?.L, ph = L?.phase;
    if (ph) {
      const sw = ph === 'swing' || ph === 'zip' || ph === 'ropeup', A = sw ? L.anchor : L.loop;
      LS[0] = ph; LS[1] = +A.x.toFixed(2); LS[2] = +A.y.toFixed(2); LS[3] = +A.h.toFixed(2); LS[4] = sw ? 0 : +(L.loop.r * (L.loop.open ?? 1)).toFixed(2); ST.ls = LS;
    }
    C.sendState(ST);
    if (now - pinged > 2000) { pinged = now; C.pingNow(); }
  }
  const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) return false; return true; };

  // the woodcutting slice (and the test row below) asks for a tree to come down: true when asked
  function act(a, p) {
    if (a !== 'fell' || !p || typeof p.fid !== 'string' || C.status !== 'online') return false;
    C.act('fell', p.fid); return true;
  }
  function nearestTree() {
    const P = host.player; let best = null, bd = 1e9;
    for (const p of trees) { const d = Math.hypot(p.x - P.x, p.y - P.y); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  const F = {
    name: 'coop', label: 'Co-op', on: true, net: C, look, act, gear,
    get online() { return C.status === 'online'; },
    wear(ids) { if (C.status !== 'online') return false; C.wear(ids); return true; },   // (features/gear.js: ask for a set)
    update() {
      C.drain(msgs);
      for (const m of msgs) {
        if (m.k === 'world' && m.s === 'felled') {   // the woodcutting fells it (its fall, stump, logs), else it just goes
          const p = treeOf(m.id), by = C.peers.get(m.by), o = by ? C.sample(by, BYS) : null;
          if (!p || !host.feature('woodcut')?.fellShared?.(p, m.by === C.id, !!m.late, o?.x, o?.y)) fell(m.id);
        }
        else if (m.k === 'fix') { host.teleport(m.x, m.y); say('the server put you back (moving too fast)'); }
        else if (m.k === 'deny') say(`the server said no: ${m.a} ${m.id || ''} (${m.why})`);
        else if (m.k === 'gear') { gear.ids = m.g; gear.ver++; }
      }
      msgs.length = 0;
      for (const q of C.joined) say(`${q.name} joined`); C.joined.length = 0;
    },
    frame(f) {
      send(performance.now());
      if (noteT > 0) noteT -= f.dt;
      look.frame(f);
    },
    hd(q2, sc) {
      look.hd(q2, sc);
      const msg = C.status === 'online' ? (noteT > 0 ? note : '') : C.status === 'connecting' ? 'co-op: connecting…' : `co-op: disconnected (${C.why})`;
      if (msg) banner(q2, host.hudScale, msg);
    },
    hud: () => `co-op ${C.status} · you #${C.id} ${C.name} · ${C.peers.size + 1} in the world · seed ${SESSION.seed} · ping ${C.ping | 0} ms`,
    menu: () => [{label: `Co-op: fell the nearest forest tree (test; ${C.peers.size + 1} players)`, run: () => { const p = nearestTree(); if (!p) say('no forest trees here'); else if (!act('fell', p)) say('not online'); }}],
    dispose() { C.close(); },
  };
  addEventListener('pagehide', () => C.close());
  return F;
}

// asked for co-op but no server answered: say so for a while (the page plays offline)
function offline(host) {
  let t = 12;
  return {name: 'coop', on: true, online: false, act: () => false,
    frame(f) { t -= f.dt; },
    hd(q2) { if (t > 0) banner(q2, host.hudScale, 'co-op: ' + SESSION.error + ' · playing offline'); },
    hud: () => 'co-op: offline (' + SESSION.error + ')'};
}
function banner(q2, s, text) {
  q2.save(); q2.setTransform(1, 0, 0, 1, 0, 0);
  q2.font = `600 ${Math.round(6 * s)}px "Segoe UI", system-ui, sans-serif`; q2.textAlign = 'center'; q2.textBaseline = 'top';
  const w = q2.measureText(text).width + 16 * s / 2.4, x = q2.canvas.width / 2, y = 10 * s / 2.4;
  q2.fillStyle = 'rgba(14,16,15,.78)'; q2.fillRect(x - w / 2, y, w, 9 * s); q2.fillStyle = '#f0e2c0'; q2.fillText(text, x, y + 1.5 * s);
  q2.restore();
}
