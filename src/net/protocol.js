// PROTOCOL: the co-op wire format (docs/MULTIPLAYER.md), shared by the browser (net/client.js, features/coop.js) and the server
// (server/room.mjs): plain data and pure functions, no DOM and no node, so both sides import this one file.
// Messages are JSON objects {k: kind, ...}. The transport under them (net/transport.js: a WebSocket today) only carries text.
//
// client -> server
//   hello    {v, name}                                   the first message; the server answers with welcome
//   st       {x, y, z, phi, s, pose, rig, w?, wn?, ls?, tp?}   the local player 20 times a second: world metres (x east, y south,
//            z up), facing phi (rad, the arena's atan2(x, y)), s = his state (idle, move, roll, ...), pose = the frame drawn,
//            rig = the live model he wears (gunslinger | outlaw | ''), w = the drawn pose's bones (encodePose) when it changed
//            (wn: its bone names, once per rig), ls = the lasso [phase, x, y, h, r] or absent, tp = a respawn / teleport
//   act      {a, id}                                      ask the server to change the shared world: a 'fell' (id: a forest tree),
//            'secret' (id: one of the forest's secrets whose own condition holds for this player: sim/uncanny.js), 'time' (id:
//            dawn | day | dusk | night: dev, the world's clock to the next such hour)
//   gear     {g: [id]}                                    what you want to wear (content/gear.js ids); the server checks it
//   fish     {a: 'cast', n, x, y, w, deep, rain, perfect, lvl, spot, bait, meal}   a cast fell on water (docs/FISHING.md): n = his
//            cast count, w = lake | stream | river, deep = m from the shore, lvl = his Fishing level, spot = on a fishing spot
//            (the server checks it), bait / meal = the bait on the hook, the meal eaten (ids); the server rolls what bites. {a: 'land', n}: he
//            landed it (told to everyone); {a: 'lost', n}: it got away. {a: 'jab', n, x, y, w, lvl}: the Heron Feather's jab
//            into the shallows at his feet (docs/KEEPSAKES.md; n = his jab count), rolled at once
//   ping     {c}                                         c = the client's clock (ms), echoed
// server -> client
//   welcome  {v, id, name, color, seed, t, world, peers, clock, unc}   world = {id: state} (what's been done to the world so far),
//            peers = [peer], clock (below), unc = {sec: {id: {s, by, n}}, shift} (the uncanny forest: its secrets' states, the
//            night shift's strength: docs/UNCANNY.md; null when the server runs without it)
//   join     {p: peer}   leave {id}                      peer = {id, name, color, ...st's fields, wn, g (the gear worn)}
//   snap     {t, p: [[id, x, y, z, phi, s, pose, rig, w|0, ls|0], ...], c?}   every tick; w only when it changed since the last snap;
//            c = the night elk [x, y, phi, mode, quarry id] (sim/uncanny.js createStalker: the server runs it)
//   wn       {id, wn}                                    a peer's bone names (its rig changed)
//   world    {id, s, by}                                 a change to the shared world (s: 'felled'), by = who did it
//   clock    {t, h, rate}                                the world's clock (the server owns it): at server time t (ms) it was h
//            in-game hours since the start (sim/env.js E.t), going on at rate hours per ms (0: stopped). In welcome too
//   sec      {id, s, by, n}                              a secret's state changed (sleeping / awake / triggered / spent), by =
//            who opened it (ids), n = on which night
//   ev       {a: 'knock', id, vx, vy}                    the night elk knocked player id down (vx, vy m/s): they drop something
//   deny     {a, id, why}                                an act refused
//   gear     {id, g}                                     what a player wears now (to everyone, the wearer too: his set as
//                                                        the server took it; docs/GEAR.md)
//   fish     {a: 'bite', n, id, cm, kg, wait, nibbles, two}   to the caster: what bites cast n (content/fishing.js roll), when
//            (wait s, the nibbles' s before it), two = a double catch. {a: 'caught', id, name, c, cm, kg, two}: to everyone,
//            player id landed catch c. {a: 'jabbed', n, id, cm, kg}: to the jabber, what jab n came up with (id '': nothing)
//   fix      {x, y, z}                                   the server didn't accept your position: you are here
//   pong     {c, t}                                      t = the server's clock (ms)
export const VERSION = 2;
export const TICK_HZ = 20;          // the server's snapshot rate; a client sends its state at the same rate
export const INTERP_MS = 110;       // remote players are drawn this far behind the newest snapshot (two ticks and a little)
export const PATH = '/mp';          // the WebSocket's path on the server, and the HTTP session endpoint (PATH + '/session')
export const PORT = 8320;           // the server's default port
// the server's movement check (room.mjs): faster than MAX_SPEED over a tick (+ SLACK m) is refused and the client put back
export const MOVE = {maxSpeed: 26, slack: 2.5};
// what an act may reach: a tree is felled from within REACH m of it
export const REACH = 4;
// the world's clock when a server starts (in-game hours since the start; 9: the first morning) and real minutes per in-game day
// (sim/env.js TUNE.dayMinutes; node server/server.mjs --hour / --daymin)
export const CLOCK = {hour: 9, daymin: 20};
export const COLORS = ['#f0c060', '#7ec8e3', '#e98aa8', '#9ad07a', '#c9a0ff', '#ff9f5a', '#6fe0c0', '#e0e070'];

export const encode = m => JSON.stringify(m);
export function decode(text) { try { const m = JSON.parse(text); return m && typeof m.k === 'string' ? m : null; } catch { return null; } }
export const num = (v, d = 0) => typeof v === 'number' && Number.isFinite(v) ? v : d;
export const str = (v, n = 32) => typeof v === 'string' ? v.slice(0, n) : '';

// THE POSE: a live body's drawn bones (view/livehero.js DRAWN.w: 7 numbers a bone, quaternion x y z w then position x y z in
// body space, metres) as 16-bit integers (the quaternion x 32767, the position x POS_Q: +-4 m at .12 mm), base64 in the JSON.
// b64 / unb64 are the side's own (btoa / atob in the browser, Buffer on the server: it never decodes one, it only forwards it)
const POS_Q = 8000;
export function packPose(w, nb, out) {   // -> Int16Array (out reused when it fits)
  const a = out && out.length === nb * 7 ? out : new Int16Array(nb * 7);
  for (let i = 0; i < nb * 7; i++) { const k = i % 7, v = k < 4 ? w[i] * 32767 : w[i] * POS_Q; a[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v); }
  return a;
}
export function unpackPose(a, w) {   // Int16Array -> w (Float64Array, nb x 7)
  const n = Math.min(a.length, w.length);
  for (let i = 0; i < n; i++) w[i] = i % 7 < 4 ? a[i] / 32767 : a[i] / POS_Q;
  return w;
}
