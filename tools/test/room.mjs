// THE ROOM, WITHOUT A BROWSER (docs/SKILLS.md, docs/MULTIPLAYER.md): server/room.mjs driven by fake connections in node. It
// checks what the server owns of the players' skills: the record by the player key, the first join's import (capped), the
// XP it grants on the acts it sees (a fell, a pick, a blow and a spent vein, a landed fish, a crystal), that the levels it
// rolls with are its own (never the client's word), the fall's way in a fell, and that a record outlives a reconnect.
//   node tools/test/room.mjs          (seed 1337's forest: the same plan the server builds)
import {createRoom} from '../../server/room.mjs';
import {createPlayers} from '../../server/players.mjs';
import {forestPlan} from '../../src/world/forest.js';
import {SKILLS, TITLES, needXP, levelOf, fellXP, rateOf, IMPORT_CAP} from '../../src/content/skills.js';
import {VERSION, encode, decode} from '../../src/net/protocol.js';
import {SPOT, SHADOW, shadowAt} from '../../src/content/fishing.js';

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

// 3b. one store for every system (depth-shared): a record the workshop made first with of() still takes the hello's XP once;
// its made things stay in memory (never in toJSON)
{
  const P = createPlayers();
  const r = P.of(KEY_A); r.made.set(1, {u: 1});
  const {rec, fresh} = P.join(KEY_A, {woodcutting: needXP(4)});
  ok(rec === r && fresh && levelOf(rec.xp.woodcutting) === 4, 'of() then join(): the same record, XP imported once');
  ok(!P.join(KEY_A, {woodcutting: needXP(8)}).fresh && levelOf(rec.xp.woodcutting) === 4, 'a second join imports nothing');
  const j = P.toJSON()[KEY_A];
  ok(j && !('made' in j) && !('imp' in j) && P.of('') === null, 'toJSON leaves made out; of() needs a key');
}

// 4. a test server's switches: --movelvl goes out with the record (ml); --dev takes the Sandbox's Skills rows, a plain server refuses
{
  const P = createPlayers({SKILLS}), plain = makeRoom(P), devr = makeRoom(createPlayers({SKILLS}), {dev: true, movelvl: 5});
  const a = join(plain, KEY_A); a.say({k: 'act', a: 'dev', id: 'next'});
  ok(a.last('deny')?.why?.startsWith('not a dev server'), 'a plain server refuses the dev rows');
  const b = join(devr, KEY_B); ok(b.all('skills')[0]?.ml === 5, '--movelvl goes out as ml');
  b.say({k: 'act', a: 'dev', id: 'next'});
  ok(b.last('skills')?.xp.mining === needXP(5) && b.last('skills')?.xp.fishing === needXP(5), 'dev next: every skill to its next move\'s level', JSON.stringify(b.last('skills')));
  b.say({k: 'act', a: 'dev', id: 'reset'});
  ok(b.last('skills')?.xp.mining === 0, 'dev reset: back to 0');
  plain.stop(); devr.stop();
}

// 5. the chain (Mining 5): three rhythm blows in a row, each 0.5-1.4 s after the last, crack a vein at once; not without the
// level, not too fast
{
  const vi = (F.cave?.veins || []).findIndex(v => v.kind === 'copper'), v = F.cave?.veins?.[vi];
  if (v) {
    const at = {k: 'st', x: v.x + v.nx, y: v.y + v.ny, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', tp: 1};
    const blows = async (c, gap) => { for (let k = 0; k < 3; k++) { if (k) await nap(gap); c.say({k: 'act', a: 'mine', id: 'v' + vi, pow: 1, tier: 1, rh: 1}); } };
    const r1 = makeRoom(createPlayers({SKILLS})), a = join(r1, KEY_A, {mining: needXP(5)}); a.say(at); a.clear();
    await blows(a, 700);
    const sp = a.last('world', m => m.id === 'v' + vi && m.s === 'spent');
    ok(sp && sp.chain === 1, 'the chain: three rhythm blows crack a copper vein (5 blows) at once', JSON.stringify(a.last('world')));
    ok(Math.abs(xpOf(a, 'mining') - (needXP(5) + (3 * 4 + 2 * 4 + 4 * 4) * rateOf('mining'))) < 1e-6, 'the chain: the XP of the blows it skipped', xpOf(a, 'mining'));
    r1.stop();
    const r2 = makeRoom(createPlayers({SKILLS})), b = join(r2, KEY_B, {mining: needXP(4)}); b.say(at); b.clear();
    await blows(b, 700);
    ok(!b.last('world', m => m.id === 'v' + vi && m.s === 'spent'), 'no chain below Mining 5');
    r2.stop();
    const r3 = makeRoom(createPlayers({SKILLS})), c = join(r3, KEY_A, {mining: needXP(5)}); c.say(at); c.clear();
    await blows(c, 150);
    ok(!c.last('world', m => m.id === 'v' + vi && m.s === 'spent'), 'no chain from blows too close together');
    r3.stop();
  } else ok(false, 'a copper vein in the plan');
}

// 6. the shadows (Fishing 5): a cast just ahead of a shadow's nose (the server's own shadow: the seed and its clock) is a quick
// bite; on the shadow the wait grows; without the level neither
{
  const q = {x: 0, y: 0, sx: 0, sy: 0, hx: 0, hy: 0, cls: '', len: 0};
  let a0 = 0, b0 = 0; for (let a = -20; a < 20 && !a0; a++) for (let b = -20; b < 20; b++) if (shadowAt(a, b, 0, SEED, 1, q)) { a0 = a; b0 = b; break; }
  if (a0) {
    const cast = async (xp, where) => {
      const room = makeRoom(createPlayers({SKILLS})), t0 = Date.now(), c = join(room, KEY_A, {fishing: xp});
      await nap(400); const ts = (Date.now() - t0) / 1000;
      shadowAt(a0, b0, Math.floor(ts / SPOT.slot), SEED, ts, q);
      const x = where === 'nose' ? q.x + q.hx * (q.len / 2 + .8) : q.x, y = where === 'nose' ? q.y + q.hy * (q.len / 2 + .8) : q.y;
      c.say({k: 'st', x, y: y + 3, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', tp: 1}); c.clear();
      c.say({k: 'fish', a: 'cast', n: 1, x, y, w: 'lake', deep: 2});
      room.stop(); return c.last('fish', m => m.a === 'bite');
    };
    const nose = await cast(needXP(5), 'nose');
    ok(nose && nose.sh === 'nose' && nose.wait >= SHADOW.bite[0] && nose.wait <= SHADOW.bite[1] && !nose.nibbles.length, 'a cast at a shadow\'s nose: a quick bite', JSON.stringify(nose));
    const spook = await cast(needXP(5), 'on');
    ok(spook && spook.sh === 'spook' && spook.wait >= 3.5 + 2.5 - 1e-6, 'a cast on a shadow: it bolts, the wait grows', JSON.stringify(spook));
    const low = await cast(needXP(4), 'nose');
    ok(low && !low.sh && low.wait >= 3.5, 'no shadows below Fishing 5', JSON.stringify(low));
  } else ok(false, 'a spot near the start');
}

// 7. titles: the room counts (walking from the accepted moves, a fell), grants (all six with --dev's row), the worn one goes to
// the others (ptitle, and in a join), wearing one he hasn't is refused
{
  const P = createPlayers({SKILLS}), room = makeRoom(P, {dev: true});
  const [fid, tr] = [...F.trees][0];
  const a = join(room, KEY_A, {}, {x: tr[0] - 2, y: tr[1]}), b = join(room, KEY_B, {}, {x: tr[0] + 30, y: tr[1]});
  a.say({k: 'act', a: 'fell', id: fid});
  for (let k = 1; k <= 4; k++) { await nap(60); a.say({k: 'st', x: tr[0] - 2 - k * 2, y: tr[1], z: 0, phi: 0, s: 'run', pose: 'idle.0', rig: ''}); }
  const rec = P.get(KEY_A);
  ok(rec.n.walked >= 5 && rec.n.walked <= 8.5, 'the metres he walked (accepted moves)', JSON.stringify(rec.n));
  ok(rec.n.trees === 1, 'a fell counted', JSON.stringify(rec.n));
  a.say({k: 'act', a: 'title', id: 'mole'});
  ok(a.last('deny')?.why === 'not yours', 'a title he hasn\'t: refused');
  b.clear(); a.say({k: 'act', a: 'dev', id: 'titles'});
  const ti = a.last('skills', m => m.ti)?.ti;
  ok(ti && ti.titles.length === Object.keys(TITLES).length && TITLES[ti.title], 'dev: every title earned, the newest worn', JSON.stringify(ti));
  ok(b.last('ptitle')?.t === ti?.title, 'the others see his title', JSON.stringify(b.last('ptitle')));
  a.say({k: 'act', a: 'title', id: ''});
  ok(b.last('ptitle')?.t === '' && rec.title === '', 'none worn');
  a.say({k: 'act', a: 'title', id: 'owl'});
  const c = join(room, 'c'.repeat(32));
  ok(c.last('welcome')?.peers.find(q => q.id === a.last('welcome').id)?.t === 'owl', 'a late joiner sees his title in the welcome');
  room.stop();
}

console.log(`room: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
