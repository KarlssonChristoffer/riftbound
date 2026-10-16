// THE ROOM, WITHOUT A BROWSER (docs/SKILLS.md, docs/MULTIPLAYER.md): server/room.mjs driven by fake connections in node. It
// checks what the server owns of the players' skills: the record by the player key, the first join's import (capped), the
// XP it grants on the acts it sees (a fell, a pick, a blow and a spent vein, a landed fish, a crystal), that the levels it
// rolls with are its own (never the client's word), the fall's way in a fell, and that a record outlives a reconnect.
//   node tools/test/room.mjs          (seed 1337's forest: the same plan the server builds)
import {createRoom} from '../../server/room.mjs';
import {createPlayers} from '../../server/players.mjs';
import {forestPlan} from '../../src/world/forest.js';
import {SKILLS, needXP, levelOf, fellXP, rateOf, IMPORT_CAP} from '../../src/content/skills.js';
import {VERSION, encode, decode} from '../../src/net/protocol.js';

const SEED = 1337;
const F = forestPlan(SEED);
let fails = 0, passes = 0;
const ok = (c, what, more = '') => { if (c) passes++; else { fails++; console.log('  FAIL', what, more); } };
const nap = ms => new Promise(r => setTimeout(r, ms));

function fakeConn(name) {
  const C = {ip: 'test', inbox: [], closed: false,
    send(t) { C.inbox.push(decode(t)); }, close() { C.closed = true; C.onclose?.(); },
    say(m) { C.onmessage(encode(m)); },
    last(k, pred = () => true) { for (let i = C.inbox.length - 1; i >= 0; i--) if (C.inbox[i]?.k === k && pred(C.inbox[i])) return C.inbox[i]; return null; },
    all(k) { return C.inbox.filter(m => m?.k === k); }, clear() { C.inbox.length = 0; }, name};
  return C;
}
const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(32);
function makeRoom(players, o = {}) {
  return createRoom({seed: SEED, trees: F.trees, decor: F.decor, veins: F.cave?.veins || null, cave: F.cave || null, players, daymin: 0, hour: 10, ...o});
}
function join(room, key, xp = {}, at = null) {
  const c = fakeConn(key.slice(0, 4)); room.connect(c);
  c.say({k: 'hello', v: VERSION, name: c.name, key, xp});
  if (at) c.say({k: 'st', x: at.x, y: at.y, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', tp: 1});
  return c;
}
const xpOf = (c, id) => { let v = 0; for (const m of c.all('skills')) if (m.xp?.[id] !== undefined) v = m.xp[id]; return v; };

console.log(`room: seed ${SEED}, ${F.trees.size} trees, ${F.decor?.length ?? 0} decor, ${F.cave?.veins?.length ?? 0} veins`);

// 1. a first join: the save's XP imported, capped at IMPORT_CAP's level
{
  const P = createPlayers({SKILLS}), room = makeRoom(P);
  const big = needXP(IMPORT_CAP) * 3, small = 300;
  const a = join(room, KEY_A, {woodcutting: big, fishing: small, mining: -5, foraging: 'x'});
  const w = a.last('welcome'), sk = a.all('skills')[0];
  ok(w && w.v === VERSION, 'welcome');
  ok(sk && sk.xp.woodcutting === needXP(IMPORT_CAP), 'import capped at level ' + IMPORT_CAP, JSON.stringify(sk?.xp));
  ok(sk && sk.xp.fishing === small, 'import below the cap kept', JSON.stringify(sk?.xp));
  ok(sk && sk.xp.mining === 0 && sk.xp.foraging === 0, 'junk XP imported as 0', JSON.stringify(sk?.xp));
  // a rejoin with the same key: the record's, not the client's word
  a.close();
  const a2 = join(room, KEY_A, {woodcutting: 1e9});
  ok(a2.all('skills')[0]?.xp.woodcutting === needXP(IMPORT_CAP), 'a rejoin keeps the record (the save not read again)', JSON.stringify(a2.all('skills')[0]?.xp));
  // no key: a record of its own, nothing imported past the cap either
  const n = join(room, 'nope', {fishing: 50});
  ok(n.all('skills')[0]?.xp.fishing === 50, 'a key-less player: a record for the connection');
  room.stop();
}

// 2. grants on the acts it sees
{
  const P = createPlayers({SKILLS}), room = makeRoom(P);
  // a fell: the tree's whole XP (x RATE) to the feller, the fall's way in the message
  const [fid, tr] = [...F.trees].find(([, t]) => t[2] === 'pine') || [...F.trees][0];
  const a = join(room, KEY_A, {}, {x: tr[0] - 2, y: tr[1]});
  const b = join(room, KEY_B, {}, {x: tr[0] + 30, y: tr[1]});
  a.clear(); b.clear();
  a.say({k: 'act', a: 'fell', id: fid});
  const wa = a.last('world', m => m.id === fid), wb = b.last('world', m => m.id === fid);
  ok(wa && wb && wa.s === 'felled', 'the fell told to everyone');
  ok(wb && Math.abs(wb.dx - 1) < .01 && Math.abs(wb.dy) < .01, 'the fall\'s way: away from the feller as the server saw him', JSON.stringify(wb));
  const want = Math.round(fellXP(tr[2], tr[3]) * rateOf('woodcutting') * 1000) / 1000;
  ok(Math.abs(xpOf(a, 'woodcutting') - want) < 1e-6, `fell XP ${want} to the feller`, xpOf(a, 'woodcutting'));
  ok(!b.last('skills'), 'nobody else gets the feller\'s XP');
  ok(a.last('skills')?.d?.woodcutting === want, 'the grant says what it gave (d)');
  // a pick: the plant's XP; the yield rolled at the record's level (the client's lvl ignored)
  const di = F.decor.findIndex(e => e[0] === 'blueberry');
  if (di >= 0) {
    const e = F.decor[di]; a.say({k: 'st', x: e[1], y: e[2] + .5, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', tp: 1});
    a.clear(); a.say({k: 'act', a: 'pick', id: 'd' + di, lvl: 50});
    const w = a.last('world', m => m.id === 'd' + di);
    ok(w && w.s === 'picked' && w.n >= 3 && w.n <= 6, 'pick: yield rolled at the record\'s level (lvl 50 asked, level 1 used)', JSON.stringify(w));
    ok(xpOf(a, 'foraging') > 0, 'pick XP granted');
  } else ok(false, 'a blueberry patch in the plan');
  // a vein: each blow's XP to the blower, the spent vein's x 4 to every striker
  const vi = (F.cave?.veins || []).findIndex(v => v.kind === 'stone');
  if (vi >= 0) {
    const v = F.cave.veins[vi];
    for (const c of [a, b]) c.say({k: 'st', x: v.x + v.nx, y: v.y + v.ny, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', tp: 1});
    a.clear(); b.clear();
    a.say({k: 'act', a: 'mine', id: 'v' + vi, pow: 1, lvl: 50, tier: 1});
    b.say({k: 'act', a: 'mine', id: 'v' + vi, pow: 1, tier: 1});
    a.say({k: 'act', a: 'mine', id: 'v' + vi, pow: 1, tier: 1});
    const sp = b.last('world', m => m.id === 'v' + vi && m.s === 'spent');
    ok(!!sp, 'the vein spent after its blows');
    const r = rateOf('mining'), xa = xpOf(a, 'mining'), xb = xpOf(b, 'mining');
    ok(Math.abs(xa - (2 * 2 + 2 * 4) * r) < 1e-6, 'blower A: two blows + the spent vein', xa);
    ok(Math.abs(xb - (1 * 2 + 2 * 4) * r) < 1e-6, 'striker B: one blow + the spent vein', xb);
    ok(sp && sp.got[1] >= 2 && sp.got[2] >= 2, 'every striker his chunks');
  } else ok(false, 'a stone vein in the plan');
  // a crystal: once, in reach
  const ci = (F.cave?.props || []).findIndex(q => q[0] === 'crystal');
  if (ci >= 0) {
    const q = F.cave.props[ci]; a.say({k: 'st', x: q[1] + 1, y: q[2], z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', tp: 1});
    const x0 = xpOf(a, 'mining'); a.clear();
    a.say({k: 'act', a: 'crystal', id: 'c' + ci}); const x1 = xpOf(a, 'mining');
    a.say({k: 'act', a: 'crystal', id: 'c' + ci});
    ok(x1 > x0, 'a crystal\'s XP');
    ok(a.last('deny')?.why === 'broken', 'a crystal only once', JSON.stringify(a.last('deny')));
    a.say({k: 'act', a: 'crystal', id: 'c' + (F.cave.props.findIndex(q => q[0] === 'rock'))});
    ok(a.last('deny')?.why === 'no such crystal', 'a rock is not a crystal');
  }
  // fishing: the land refused too soon after the bite went out, granted after
  const lk = F.lake;
  if (lk) {
    const LX = lk.x ?? lk.cx ?? lk[0], LY = lk.y ?? lk.cy ?? lk[1];
    if (isFinite(LX) && isFinite(LY)) {
      a.say({k: 'st', x: LX, y: LY + 3, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', tp: 1});
      a.clear(); a.say({k: 'fish', a: 'cast', n: 1, x: LX, y: LY, w: 'lake', deep: 2, lvl: 50});
      const bite = a.last('fish', m => m.a === 'bite');
      ok(!!bite, 'a cast gets a bite');
      a.say({k: 'fish', a: 'land', n: 1});
      ok(!a.last('fish', m => m.a === 'caught'), 'a land at once refused');
      await nap(1600);
      a.say({k: 'fish', a: 'land', n: 1});
      ok(!!a.last('fish', m => m.a === 'caught'), 'a land after 1.5 s told to everyone');
      ok(xpOf(a, 'fishing') > 0, 'fishing XP granted (first catch doubled)');
    }
  }
  room.stop();
}

// 3. the store across rooms: a server restart without --data keeps nothing (the save's XP comes in again, capped); with the
// records loaded (--data) the level is the same
{
  const P1 = createPlayers({SKILLS}), r1 = makeRoom(P1);
  const a = join(r1, KEY_A); P1.grant(P1.get(KEY_A), 'woodcutting', needXP(15)); r1.stop();
  const saved = JSON.parse(JSON.stringify(P1.toJSON()));
  const P2 = createPlayers({SKILLS, load: saved}), r2 = makeRoom(P2);
  const a2 = join(r2, KEY_A, {woodcutting: 0});
  ok(levelOf(a2.all('skills')[0]?.xp.woodcutting) === 15, 'records loaded (--data): the same level after a restart', JSON.stringify(a2.all('skills')[0]?.xp));
  r2.stop();
  void a;
}

console.log(`room: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
