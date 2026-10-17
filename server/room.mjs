// ROOM: the authoritative co-op session (docs/MULTIPLAYER.md). It owns who is in the world (ids, names, colours), the world's
// SEED (every client builds the same forest from it: src/world/forest.js), and the SHARED WORLD STATE (what has been done to
// the world: a felled tree), which only it changes (an act is a request; it checks it and tells everyone, late joiners get it
// all in their welcome). Each player's movement is simulated by its own client (prediction, no input lag) and checked here:
// a jump faster than a body can move is refused and the client put back (MOVE in the protocol). Snapshots of every player go
// out TICK_HZ times a second.
// It also owns THE CLOCK (in-game hours: everyone's day and night are the server's; clients follow it) and THE UNCANNY FOREST
// (docs/UNCANNY.md): the secrets' states and who opened them, and the night elk (sim/uncanny.js: the same rules the game runs
// offline), from the forest's uncanny plan (world/uncanny.js) when the server gives one. And FISHING's rolls (docs/FISHING.md):
// what bites a cast, how big, when, from the set the player wears and the clock; a landed fish is told to everyone. And the
// FORAGED PATCHES (docs/FORAGING.md): which of the forest floor's plants are picked, a pick's yield, their growing back. And the
// cave's VEINS (docs/MINING.md): the blows left on each, who struck it, each striker's chunks when it breaks, its coming back
// (a hollow wall's plug never comes back). And the cave's SOOT THINGS (docs/CAVELIFE.md: sim/cavelife.js, the same rules the game
// runs offline): they go for the lit lanterns (each player's state says whether theirs burns: lt), keep out of the lamps' and
// burning fires' light (the builds), and put a lantern out (an event to everyone: {k: 'ev', a: 'snuff', id}); their places go
// out in the snapshots (sn: [x, y, h, mode] each).
// Transport-free: a connection is {send(text), close(), onmessage, onclose} (ws.mjs, or any other transport with that shape).
//   const room = createRoom({seed, trees, decor, veins, cave, regrow, unc, hour, daymin, log}); room.connect(conn); room.stop(); room.clock() -> hours
import {VERSION, TICK_HZ, MOVE, REACH, COLORS, CLOCK, encode, decode, num, str} from '../src/net/protocol.js';
import {cleanSet, GEAR_BY_ID} from '../src/content/gear.js';
import {CATCHES, WATERS, BAITS, SPOT, roll, statsOf, castNotes, spotNear} from '../src/content/fishing.js';
import {mealNotes} from '../src/content/meals.js';
import {PLANTS, pickYield, pickStats, levelNotes, regrowHours} from '../src/content/forage.js';
import {VEINS, mineYield, mineStats, regrowHours as veinHours} from '../src/content/mining.js';
import {BUILDS, TUNE as BUILD, fuelAt, stokeFuel} from '../src/content/builds.js';
import {WEATHER, createSchedule, seasonAt, TUNE as WXT} from '../src/sim/wxclock.js';
import {TUNE as TH, STRIKE, ironOf} from '../src/content/thunder.js';
import {createThunder, nextSpring} from '../src/sim/thunder.js';
import {TUNE as ICE} from '../src/content/ice.js';
import {createLake, thickAt, refreezeAt} from '../src/sim/ice.js';
import {TUNE as MIRE} from '../src/content/mire.js';
import {nightOf, createWisps} from '../src/sim/mire.js';
import {eventAt as wrongAt} from '../src/sim/wrongwx.js';
import {TUNE as WRONG} from '../src/content/wrongwx.js';
import {SKILLS, CURVE} from '../src/content/skills.js';
import {createSecrets, createStalker} from '../src/sim/uncanny.js';
import {createSoot} from '../src/sim/cavelife.js';
import {mulberry32} from '../src/core/rng.js';

const PART_H = {dawn: 6.4, day: 10, dusk: 19.2, night: 22};   // (sim/env.js setPart's hours)

export function createRoom({seed, trees = null, decor = null, veins = null, cave = null, forest = null, strikes = 1, treefire = true, snuffers = undefined, regrow = 1, unc = null, hour = CLOCK.hour, daymin = CLOCK.daymin, log = () => {}, maxPlayers = 8}) {
  const peers = new Map();   // id -> peer (after its hello)
  const world = new Map();   // id -> {s, by, t, at?}: the shared world's changes (at: the clock's hour a picked patch grows back)
  const t0 = Date.now(), now = () => Date.now() - t0;
  let nextId = 1;
  // THE CLOCK: h0 hours at server time c0, going on at rate hours per ms
  let h0 = hour, c0 = 0;
  const rate = daymin > 0 ? 24 / (daymin * 60000) : 0;
  const clock = () => h0 + (now() - c0) * rate;
  const clockMsg = () => ({k: 'clock', t: now(), h: +clock().toFixed(5), rate});
  // THE UNCANNY FOREST: its secrets and the night elk (none without a plan)
  const secrets = unc ? createSecrets(unc) : null;
  const elk = unc ? createStalker(unc, mulberry32(seed ^ 0x5e1c)) : null;
  const secState = () => secrets ? Object.fromEntries(Object.entries(secrets.st).map(([id, q]) => [id, {s: q.s, by: q.by, n: q.n}])) : {};
  const where = [], tpos = [0, 0];   // (the placed players for the rules: [{id, x, y}], reused)
  // THE CAVE'S SOOT THINGS (none without the cave's plan)
  const soot = cave ? createSoot(cave, mulberry32((seed ^ 0x5007) >>> 0), snuffers) : null, shine = [], snRow = [];

  const pub = p => ({id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, phi: p.phi, s: p.s, pose: p.pose, rig: p.rig, w: p.w, wn: p.wn, ls: p.ls, g: p.gear});
  const others = (p, m) => { const t = encode(m); for (const q of peers.values()) if (q !== p) q.conn.send(t); };
  const all = m => { const t = encode(m); for (const q of peers.values()) q.conn.send(t); };

  function hello(conn, m) {
    if (peers.size >= maxPlayers) { conn.send(encode({k: 'deny', a: 'join', why: 'full'})); conn.close(1013, 'full'); return null; }
    if (num(m.v) !== VERSION) { conn.send(encode({k: 'deny', a: 'join', why: 'version ' + VERSION})); conn.close(1002, 'version'); return null; }
    const id = nextId++, used = new Set([...peers.values()].map(q => q.color)), color = COLORS.find(c => !used.has(c)) || COLORS[id % COLORS.length];
    const p = {conn, id, name: str(m.name, 20).replace(/[^\w .'-]/g, '') || 'Player ' + id, color, x: 0, y: 0, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', w: null, wn: null, ls: null, gear: [], gearT: -1e9, fishT: -1e9, fishN: -1, fishR: null,
      fresh: false, wNew: false, lastT: 0, placed: false, fixT: -1e9, acts: 0, actT: 0, lit: false};
    conn.send(encode({k: 'welcome', v: VERSION, id, name: p.name, color, seed, t: now(), world: Object.fromEntries(world), peers: [...peers.values()].map(pub),
      clock: clockMsg(), unc: unc ? {sec: secState(), shift: unc.strength} : null}));
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
    p.lit = m.lt === 1;   // (his lantern burns in the cave: sim/cavelife.js reads p.lit)
    p.bd = num(m.bd, 0) & 0x7ff;   // (his body's look: content/body.js packBody, passed on in the snapshots)
    p.fresh = true;
  }

  function act(p, m) {
    const id = str(m.id, 48), a = str(m.a, 16), t = now();
    if (t - p.actT > 1000) { p.actT = t; p.acts = 0; }
    if (++p.acts > 10) return;   // (a flood: dropped)
    const deny = why => p.conn.send(encode({k: 'deny', a, id, why}));
    if (a === 'secret') {   // a secret's own condition holds for this player (the rules check it's awake and they are there)
      if (!secrets) return deny('no secrets here');
      const c = secrets.ask(id, p, clock());
      if (typeof c === 'string') return deny(c);
      all({k: 'sec', ...c}); log(`  ${p.name} opened the secret ${id}`); return;
    }
    if (a === 'time') {   // dev: the world's clock to the next dawn / day / dusk / night
      const ph = PART_H[id]; if (ph === undefined) return deny('no such time');
      const h = clock(), d0 = Math.floor(h / 24) * 24; h0 = d0 + ph + (ph < h - d0 ? 24 : 0); c0 = now();
      all(clockMsg()); log(`  ${p.name} set the clock to ${id}`); return;
    }
    if (a === 'pick') return pick(p, m, id, t, deny);
    if (a === 'mine') return mine(p, m, id, t, deny);
    if (a === 'build' || a === 'stoke' || a === 'unbuild') return build(p, a, m, id, t, deny);
    if (a === 'ignite' || a === 'wood') return thunderAct(p, a, id, deny);
    if (a === 'hole') return iceHole(p, m, deny);
    if (a === 'dig') return mireDig(p, id, deny);
    if (a === 'cloud') return cloudAct(p, m, id, deny);
    if (a !== 'fell') return deny('unknown act');
    if (world.has(id)) return deny('gone');
    if (trees) {
      const tr = trees.get(id); if (!tr) return deny('no such tree');
      let tx = tr[0], ty = tr[1];
      const i = unc?.fidIndex.get(id); if (i !== undefined) { unc.posOf(i, clock(), tpos); tx = tpos[0]; ty = tpos[1]; }   // (it may have walked tonight)
      if (Math.hypot(tx - p.x, ty - p.y) > REACH) return deny('too far');
    }
    const s = {s: 'felled', by: p.id, t};
    world.set(id, s);
    all({k: 'world', id, s: s.s, by: p.id});
    log(`  ${p.name} felled ${id}`);
  }

  // FORAGING (docs/FORAGING.md): a pick ({a: 'pick', id: 'd' + the forest decor's index, lvl: his Foraging level, as the client
  // says it: the save is his). The patch must be a plant of the plan (without one, the client's word for the kind), not picked,
  // in reach. The yield is rolled here (content/forage.js: the same rules the game runs offline) from his gear's forage.* notes
  // and his level, and told to everyone ({k: 'world', id, s: 'picked', by, n}); it grows back on the clock (the tick: s 'grown')
  const pickRng = mulberry32((seed ^ 0xf0a6e) >>> 0);
  function pick(p, m, id, t, deny) {
    if (world.has(id)) return deny('picked');
    let kind = str(m.kind, 16);
    if (decor) {
      const e = /^d\d+$/.test(id) ? decor[+id.slice(1)] : null; if (!e || !PLANTS[e[0]]) return deny('no such patch');
      if (Math.hypot(e[1] - p.x, e[2] - p.y) > REACH) return deny('too far');
      kind = e[0];
      if (PLANTS[kind].season && seasonAt(clock(), WXT.seasonDays) !== PLANTS[kind].season) return deny('not in season');   // (the cloudberries: summer)
    } else if (!PLANTS[kind] || !/^d\d+$/.test(id)) return deny('no such patch');
    const lvl = Math.max(1, Math.min(CURVE.max, num(m.lvl, 1) | 0)), notes = levelNotes(SKILLS.foraging.per, lvl);
    for (const g of p.gear) for (const q of GEAR_BY_ID[g]?.mods || []) notes.push(q);
    const n = pickYield(pickRng, kind, pickStats(notes)), s = {s: 'picked', by: p.id, t, at: clock() + regrowHours(kind, regrow)};
    world.set(id, s);
    all({k: 'world', id, s: s.s, by: p.id, n});
  }
  // MINING (docs/MINING.md): a blow on a vein ({a: 'mine', id: 'v' + the cave plan's vein index, pow: what the blow takes off
  // (his pick, his meal, his level and a rhythm blow: content/mining.js blowPower, as the client says it, held to 0.25 .. 3),
  // lvl: his Mining level, tier: his pick's). The vein must be one of the plan's (without one, the client's kind), not spent,
  // in reach, and soft enough for the pick. Its blows left go down for everyone ({k: 'world', id, s: 'struck', left, by}); the
  // blow that empties it SPENDS it: every player who struck it gets their own roll of chunks (their gear and level), told to
  // everyone in one message ({s: 'spent', got: {id: n}}); it comes back on the clock (the tick: s 'grown')
  const mineRng = mulberry32((seed ^ 0x313e5) >>> 0);
  function mine(p, m, id, t, deny) {
    const cur = world.get(id); if (cur?.s === 'spent') return deny('spent');
    let kind = str(m.kind, 16);
    if (veins) {
      const v = /^v\d+$/.test(id) ? veins[+id.slice(1)] : null; if (!v) return deny('no such vein');
      if (Math.hypot(v.x - p.x, v.y - p.y) > REACH) return deny('too far');
      kind = v.kind;
    } else if (!VEINS[kind] || !/^v\d+$/.test(id)) return deny('no such vein');
    const V = VEINS[kind]; if ((num(m.tier, 1) | 0) < V.tier) return deny('too hard');
    const pow = Math.max(.25, Math.min(3, num(m.pow, 1)));
    p.mineLvl = Math.max(1, Math.min(CURVE.max, num(m.lvl, 1) | 0));   // (his level for the others' last blows too)
    const by = cur?.by ? [...cur.by] : []; if (!by.includes(p.id)) by.push(p.id);
    const left = Math.max(0, (cur?.left ?? V.blows) - pow);
    if (left > 1e-6) {
      const s = {s: 'struck', left: +left.toFixed(3), by, t};
      world.set(id, s); all({k: 'world', id, s: 'struck', left: s.left, by: p.id}); return;
    }
    const got = {};
    for (const q of by) {
      const pq = peers.get(q); if (!pq) continue;
      const lvl = pq.mineLvl || 1, notes = levelNotes(SKILLS.mining.per, lvl);
      for (const g of pq.gear) for (const n of GEAR_BY_ID[g]?.mods || []) notes.push(n);
      got[q] = mineYield(mineRng, kind, mineStats(notes));
    }
    world.set(id, V.hollow ? {s: 'spent', by: p.id, t} : {s: 'spent', by: p.id, t, at: clock() + veinHours(regrow)});   // (a hollow wall: open for good)
    all({k: 'world', id, s: 'spent', by: p.id, got});
  }
  // BUILDING (docs/BUILDING.md): a build put down ({a: 'build', id: its kind (content/builds.js), x, y}: within reach of him,
  // clear of the other builds, no more of the kind standing than its `most` for him) gets an id here ('b' + n) and is told to
  // everyone ({k: 'world', id, s: 'built', kind, x, y, by, fuel, t0}); a fire's fuel burns on this server's clock (s: t0), a log
  // on it ({a: 'stoke', id}) is told the same way (s: 'stoked', fuel, t0, by); one's own lamp taken back ({a: 'unbuild', id}):
  // s 'gone'. Builds stay for the room's life; a late joiner gets them in the welcome. The pouch is the client's (it pays when
  // it hears its build stands)
  let nextB = 1;
  const secs = () => now() / 1000;
  function build(p, a, m, id, t, deny) {
    if (a === 'build') {
      const def = BUILDS[id], x = num(m.x, NaN), y = num(m.y, NaN); if (!def || !isFinite(x) || !isFinite(y)) return deny('no such build');
      if (Math.hypot(x - p.x, y - p.y) > BUILD.reach) return deny('too far');
      let mine = 0;
      for (const [, e] of world) if (e.s === 'built') { if (e.kind === id && e.by === p.id) mine++; if (Math.hypot(e.x - x, e.y - y) < BUILD.apart + def.r + (BUILDS[e.kind]?.r || 0)) return deny('no room'); }
      if (mine >= def.most) return deny('too many');
      const bid = 'b' + nextB++, s = {s: 'built', kind: id, x: +x.toFixed(2), y: +y.toFixed(2), by: p.id, t, fuel: def.fire ? def.fire.start * def.fire.log : 0, t0: +secs().toFixed(3)};
      world.set(bid, s); all({k: 'world', id: bid, ...s}); return;
    }
    const e = world.get(id); if (!e || e.s !== 'built') return deny('no such build');
    const def = BUILDS[e.kind];
    if (Math.hypot(e.x - p.x, e.y - p.y) > BUILD.reach) return deny('too far');
    if (a === 'stoke') {
      if (!def.fire) return deny('not a fire');
      const left = fuelAt(e, secs()); if (left >= (def.fire.max - .5) * def.fire.log) return deny('full');
      e.fuel = +stokeFuel(left, def).toFixed(2); e.t0 = +secs().toFixed(3);
      all({k: 'world', id, s: 'stoked', fuel: e.fuel, t0: e.t0, by: p.id}); return;
    }
    if (!def.lamp?.takeBack || e.by !== p.id) return deny('not yours');
    world.delete(id); all({k: 'world', id, s: 'gone', by: p.id});
  }
  // THE WEATHER (sim/wxclock.js, docs/WEATHER.md): the same spells every client computes from the seed and this clock (the forest's
  // ruins climate). The server doesn't send it; it reads it for what it owns: a fire in heavy rain goes out (BUILD.douse)
  const sky = createSchedule(seed >>> 0 | 0), weatherNow = () => WEATHER[sky.at('ruins', clock(), WXT.seasonDays).w] || WEATHER.fair;
  let growT = 0;
  function regrowTick(dt) {   // once a second: the picked patches and spent veins whose time has come grow back, for everyone
    if ((growT += dt) < 1) return;
    growT = 0; const h = clock();
    for (const [id, s] of world) if (s.at !== undefined && h >= s.at) { world.delete(id); if (id[0] === 'z') thunder?.charred.delete(id.slice(1)); all({k: 'world', id, s: 'grown'}); }   // (z: a charred tree whole again in the spring)
    // the rain on the open fires (each burning one's wet seconds; one out: 'doused', everyone's fire goes out with it)
    const rain = (weatherNow().rain ?? 0) >= BUILD.douse.rain, sec = secs();
    for (const [id, e] of world) {
      if (e.s !== 'built') continue;
      const f = BUILDS[e.kind]?.fire; if (!f || f.rainproof || fuelAt(e, sec) <= 0 || cave?.inBand?.(e.x, e.y)) { e.wetT = 0; continue; }
      e.wetT = rain ? (e.wetT || 0) + 1 : Math.max(0, (e.wetT || 0) - 1);
      if (e.wetT >= BUILD.douse.s) { e.wetT = 0; e.fuel = 0; e.t0 = +sec.toFixed(3); all({k: 'world', id, s: 'doused', t0: e.t0, by: 0}); log(`  the rain put out ${id}`); }
    }
  }

  // THUNDER (sim/thunder.js, content/thunder.js, docs/WEATHER.md): natural lightning and the trees it sets alight. The server owns it
  // online: while the clock's spell is a storm it aims a bolt now and then near a placed player (in turn), marks what it picked
  // ({k: 'bolt', a: 'mark'}: everyone sees the warning), and TH.tele s later strikes it ({k: 'bolt', a: 'strike'}: everyone draws
  // it; a player under it is hurt by his own client, by where he stands then: he can get off the spot). The trees' fires are its
  // too: 'z' + fid in the world: {s: 'burning', t0, t1} (s of its clock), then {s: 'charred', at: the next spring's hour, tw: 1 while
  // a splinter of thunderwood lies at its foot}. Acts: 'ignite' (a brand from a campfire: ?firestart=1), 'wood' (the splinter taken)
  const thunder = forest ? createThunder(forest) : null, thR = mulberry32((seed ^ 0x7d3a) >>> 0), marks = [], tPl = [], AIM = {};
  let boltT = TH.every[1], boltN = 0, fireT = 0;
  const wetNow = () => (weatherNow().rain ?? 0) > .1 || (WEATHER[sky.at('ruins', clock() - 1, WXT.seasonDays).w]?.rain ?? 0) > .1 ? 1 : 0;   // (rained this hour or the last: the ground's wet)
  function burn(fid, by) {
    const b = thunder.burning.get(fid), e = {s: 'burning', t0: +b.at.toFixed(2), t1: +b.t1.toFixed(2), tw: world.get('z' + fid)?.tw | 0};
    world.set('z' + fid, e); all({k: 'world', id: 'z' + fid, ...e, by});
  }
  function charred(fid) {
    const e = {s: 'charred', at: +nextSpring(clock(), WXT.seasonDays).toFixed(3), tw: world.get('z' + fid)?.tw | 0};
    world.set('z' + fid, e); all({k: 'world', id: 'z' + fid, ...e});
  }
  function strike(m, sec) {
    const S = STRIKE[m.kind] || STRIKE.ground;
    if (m.kind === 'tree') {   // the tree: it catches (a splinter of thunderwood at its foot, now and then), or straight to charred
      world.set('z' + m.id, {s: 'struck', tw: thR() < (S.wood || 0) ? 1 : 0});
      if (S.burn && treefire && thunder.ignite(m.id, sec, thR)) burn(m.id, 0);
      else { thunder.charred.add(m.id); charred(m.id); }
    }
    all({k: 'bolt', a: 'strike', n: m.n, kind: m.kind, id: m.id, x: m.x, y: m.y, h: m.h});
    log(`  lightning struck ${m.kind} ${m.id}`);
  }
  function thunderTick(dt) {
    if (!thunder) return;
    const sec = secs(), W = weatherNow();
    if ((W.storm ?? 0) >= TH.storm) {
      if ((boltT -= dt * strikes) <= 0) {
        boltT = TH.every[0] + thR() * (TH.every[1] - TH.every[0]);
        tPl.length = 0; let open = 0;
        for (const p of peers.values()) if (p.placed) { const safe = !!cave?.inBand?.(p.x, p.y); tPl.push({id: p.id, x: p.x, y: p.y, z: p.z, iron: ironOf(p.gear, GEAR_BY_ID), safe}); if (!safe) open++; }
        let k = open ? thR() * open | 0 : -1;
        for (const c of tPl) if (!c.safe && k-- === 0) {   // (a bolt somewhere round this one)
          const a = thR() * Math.PI * 2, d = Math.sqrt(thR()) * TH.reach, t = thunder.aim(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, tPl, thR, AIM);
          if (t) { const mk = {n: ++boltN, kind: t.kind, id: t.kind === 'player' ? +t.id : t.id, x: +t.x.toFixed(2), y: +t.y.toFixed(2), h: +t.h.toFixed(2), at: sec + TH.tele}; marks.push(mk); all({k: 'bolt', a: 'mark', n: mk.n, kind: mk.kind, id: mk.id, x: mk.x, y: mk.y, h: mk.h, tele: TH.tele}); }
          break;
        }
      }
    } else boltT = Math.max(boltT, 2);
    for (let i = marks.length - 1; i >= 0; i--) if (sec >= marks[i].at) { const m = marks[i]; marks.splice(i, 1); strike(m, sec); }
    if ((fireT += dt) >= TH.fire.tick) { fireT = 0; thunder.tick(sec, W.rain ?? 0, wetNow(), thR, fid => burn(fid, 0), charred); }
  }
  function thunderAct(p, a, id, deny) {
    if (!thunder) return deny('no forest');
    const t = thunder.tree(id); if (!t) return deny('no such tree');
    if (Math.hypot(t.x - p.x, t.y - p.y) > TH.brand.reach + 1.5) return deny('too far');
    if (a === 'ignite') {   // a brand from a campfire (?firestart=1 on his page): it catches unless the ground is wet
      if (world.get('z' + id)?.s === 'charred') return deny('charred');
      if (wetNow()) return deny('too wet');
      if (!thunder.ignite(id, secs(), thR)) return deny('it won\'t catch');
      burn(id, p.id); log(`  ${p.name} set ${id} alight`); return;
    }
    const e = world.get('z' + id); if (!e?.tw) return deny('none');   // 'wood': the splinter at a struck tree's foot
    e.tw = 0; all({k: 'world', id: 'z' + id, ...e, by: p.id});
  }

  // THE LAKE ICE (sim/ice.js, content/ice.js, docs/WINTER.md): its thickness is the clock's (no state); the holes in it are the
  // server's: 'i' + n in the world {s: 'hole', x, y, r, at: the hour it's frozen over} (regrowTick lets them go: 'grown'). Act
  // 'hole' {x, y, b}: a pick's or an axe's last blow (b 0), or a player going through (b 1: a wider one)
  const lake = forest ? createLake(forest) : null; let holeN = 0;
  function iceHole(p, m, deny) {
    if (!lake) return deny('no lake');
    const x = num(m.x, NaN), y = num(m.y, NaN); if (!Number.isFinite(x) || !Number.isFinite(y)) return deny('where');
    if (!lake.inLake(x, y)) return deny('not on the lake');
    if (Math.hypot(x - p.x, y - p.y) > REACH) return deny('too far');
    if (lake.localAt(x, y, thickAt(clock(), WXT.seasonDays)) < ICE.crack) return deny('no ice');
    let n = 0; for (const id of world.keys()) if (id[0] === 'i') n++;
    if (n >= ICE.hole.max) { let o = null, oa = Infinity; for (const [id, e] of world) if (id[0] === 'i' && e.at < oa) { oa = e.at; o = id; } world.delete(o); all({k: 'world', id: o, s: 'grown'}); }
    const id = 'i' + (++holeN), e = {s: 'hole', x: +x.toFixed(2), y: +y.toFixed(2), r: m.b ? ICE.hole.breakR : ICE.hole.r, at: +refreezeAt(clock(), WXT.seasonDays).toFixed(3)};
    world.set(id, e); all({k: 'world', id, ...e, by: p.id}); log(`  ${p.name} ${m.b ? 'went through the ice' : 'cut a hole in the ice'} (${id})`);
  }

  // WRONG WEATHER (sim/wrongwx.js, content/wrongwx.js, docs/WEATHER.md): when and where is the seed's (every client works it out);
  // only whom the following cloud follows is the server's: 'x' + n in the world {s: 'cloud', who (0: lost), at (its end: the
  // tick clears it)}. Act 'cloud': w 'ask' (the cloud of event n began on his clock: the first ask picks a placed player at random;
  // a later one gets the pick back), 'pass' (to: a friend within reach of him, he being its pick), 'lose' (he sheltered it off).
  // Ids 'x' 9000 and up are the sandbox menu's (dev: no check against the schedule)
  const wrR = mulberry32((seed ^ 0x3c1d) >>> 0);
  function cloudAct(p, m, id, deny) {
    if (!/^x\d{1,6}$/.test(id)) return deny('bad id');
    const n = +id.slice(1), w = str(m.w, 8), e = world.get(id);
    if (w === 'ask') {
      if (e) { p.conn.send(encode({k: 'world', id, ...e})); return; }
      let at = clock() + WRONG.cloud.dur;
      if (n < 9000) {
        const h = clock(), ev = wrongAt(seed >>> 0, h, WXT.seasonDays, null) || wrongAt(seed >>> 0, h, WXT.seasonDays, null, true);
        if (!ev || ev.n !== n || ev.kind !== 'cloud') return deny('no cloud');
        at = ev.t1;
      }
      const pl = [...peers.values()].filter(q => q.placed), q = pl[Math.floor(wrR() * pl.length)] || p;
      const s = {s: 'cloud', who: q.id, at: +at.toFixed(3)};
      world.set(id, s); all({k: 'world', id, ...s}); log(`  a cloud follows ${q.name} (${id})`); return;
    }
    if (!e || e.s !== 'cloud' || e.who !== p.id) return deny('not yours');
    if (w === 'lose') { e.who = 0; all({k: 'world', id, ...e}); return; }
    if (w === 'pass') {
      const q = peers.get(+m.to) || peers.get(m.to);
      if (!q || !q.placed || Math.hypot(q.x - p.x, q.y - p.y) > WRONG.cloud.pass + 1) return deny('too far');
      e.who = q.id; all({k: 'world', id, ...e}); log(`  ${p.name} passed the cloud to ${q.name}`); return;
    }
    deny('no such');
  }

  // THE MIRE (docs/MIRE.md): a dig at the night's find ({a: 'dig', id: 'w' + the night}). The night must be tonight's (or,
  // for ?wisps=often, today's), the digger within reach of where its true wisp stopped (sim/mire.js: the seed's, nothing kept but
  // who dug), once a night each; everyone is told ({k: 'world', id, s: 'dug', by}) and the digger takes the find
  const wisps = forest?.mire ? createWisps(seed >>> 0, forest.mire) : null, dugBy = new Set();
  function mireDig(p, id, deny) {
    if (!wisps) return deny('no mire');
    const n = /^w\d+$/.test(id) ? +id.slice(1) : -1, h = clock();
    if (n < 0 || (n !== nightOf(h) && n !== nightOf(h, true))) return deny('not tonight');
    const N = wisps.night(n), k = n + ':' + p.name;
    if (Math.hypot(N.find[0] - p.x, N.find[1] - p.y) > MIRE.wisps.reach + 1) return deny('too far');
    if (dugBy.has(k)) return deny('dug');
    dugBy.add(k); if (dugBy.size > 512) dugBy.clear();
    all({k: 'world', id, s: 'dug', by: p.id}); log(`  ${p.name} dug up the mire's find (${N.kind}, night ${n})`);
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

  // FISHING (docs/FISHING.md): a cast that fell on water asks what bites ({a: 'cast', n, x, y, w, deep, rain, perfect, lvl,
  // spot, bait, meal}); the server rolls it (content/fishing.js roll: the same rules the game runs offline) from the set he
  // wears (its fish.* notes and the angler's set), his Fishing level, his bait and his meal (as the client says them: the
  // save is his), a fishing spot (checked against the spots' hash on its own clock) and the clock's part of the day, and answers him alone
  // ({a: 'bite', n, id, cm, kg, wait, nibbles, two}). The fight is the client's; a landed one ({a: 'land', n}) is told to
  // everyone ({a: 'caught', id: who, name, c: the catch, cm, kg, two}); a lost one ({a: 'lost', n}) forgets the roll.
  const fishRng = mulberry32((seed ^ 0xf15f) >>> 0), FISH_REACH = 20, FISH_WATERS = new Set(Object.values(WATERS));
  const partOf = h => { h = ((h % 24) + 24) % 24; return h < 5.6 || h >= 20.3 ? 'night' : h < 7.2 ? 'dawn' : h < 18 ? 'day' : 'dusk'; };
  // a snowball hit someone (docs/WINTER.md): the thrower's word, passed on to everyone else (gentle: nothing to check but the numbers)
  function snowball(p, m) {
    const id = num(m.id, -1); if (!peers.has(id)) return;
    const c = v => Math.max(-6, Math.min(6, num(v)));
    others(p, {k: 'snow', by: p.id, id, vx: c(m.vx), vy: c(m.vy), hat: m.hat ? 1 : 0});
  }
  function fish(p, m) {
    const a = str(m.a, 8), n = num(m.n, -1), t = now();
    if (a === 'cast') {
      if (t - p.fishT < 500) return;   // (a flood: dropped; the client rolls it itself after a wait)
      const x = num(m.x, NaN), y = num(m.y, NaN), w = str(m.w, 8);
      if (!FISH_WATERS.has(w) || !(Math.hypot(x - p.x, y - p.y) < FISH_REACH)) return;
      p.fishT = t;
      const lvl = Math.max(1, Math.min(CURVE.max, num(m.lvl, 1) | 0)), notes = [];
      for (const id of p.gear) for (const q of GEAR_BY_ID[id]?.mods || []) notes.push(q);
      const pieces = p.gear.filter(id => GEAR_BY_ID[id]?.kind === 'fishing').length, meal = str(m.meal, 24), bait = str(m.bait, 24);
      notes.push(...castNotes({lvl, pieces, meal: mealNotes(meal), per: SKILLS.fishing.per}));
      const spot = !!m.spot && spotNear(x, y, Math.floor(t / 1000 / SPOT.slot), seed | 0);
      const st = statsOf(notes), rain = !!m.rain;
      const r = roll(fishRng, {water: w, part: partOf(clock()), rain, deep: Math.max(0, Math.min(40, num(m.deep, 0))), luck: st['fish.luck'] + (rain ? st['fish.rain'] : 0),
        find: st['fish.find'], size: st['fish.size'], lure: st['fish.lure'], night: st['fish.night'], perfect: !!m.perfect,
        spot, bait: BAITS[bait] ? bait : '', season: seasonAt(clock(), WXT.seasonDays)});
      r.two = fishRng() < st['fish.double'];
      p.fishN = n; p.fishR = r;
      p.conn.send(encode({k: 'fish', a: 'bite', n, ...r}));
    } else if (a === 'land') {
      const r = p.fishR; if (!r || n !== p.fishN) return;
      p.fishR = null;
      all({k: 'fish', a: 'caught', id: p.id, name: p.name, c: r.id, cm: r.cm, kg: r.kg, two: r.two});
      log(`  ${p.name} caught a ${CATCHES[r.id].name}${CATCHES[r.id].find ? '' : ` (${r.cm} cm)`}`);
    } else if (a === 'lost' && n === p.fishN) p.fishR = null;
  }

  function connect(conn) {
    let p = null;
    conn.onmessage = text => {
      const m = decode(text); if (!m) return;
      if (!p) { if (m.k === 'hello') p = hello(conn, m); return; }
      if (m.k === 'st') state(p, m);
      else if (m.k === 'act') act(p, m);
      else if (m.k === 'gear') wear(p, m);
      else if (m.k === 'fish') fish(p, m);
      else if (m.k === 'snow') snowball(p, m);
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
  const DT = 1 / TICK_HZ;
  const timer = setInterval(() => {
    if (!peers.size) return;
    regrowTick(DT);
    thunderTick(DT);
    // the uncanny forest: the secrets' clocks and the heron's ring, the night elk (the placed players only)
    let c = 0;
    if (unc) {
      const h = clock(); where.length = 0;
      for (const p of peers.values()) if (p.placed) where.push(p);
      for (const ch of secrets.tick(DT, h, where)) { all({k: 'sec', ...ch}); if (ch.s === 'triggered') log(`  the secret ${ch.id} opened for ${ch.by.join(', ')}`); }
      if (elk) { for (const e of elk.step(DT, h, where)) { all({k: 'ev', ...e}); log(`  the night elk knocked #${e.id} down`); } c = elk.row(); }
    }
    let sn = null;
    if (soot && soot.things.length) {   // the soot things: the placed players, the lamps and the burning fires (the builds that shine)
      if (!unc) { where.length = 0; for (const p of peers.values()) if (p.placed) where.push(p); }
      shine.length = 0; const sec = secs();
      for (const e of world.values()) if (e.s === 'built' && (BUILDS[e.kind]?.lamp || (BUILDS[e.kind]?.fire && fuelAt(e, sec) > 0))) shine.push(e);
      for (const e of soot.step(DT, where, shine)) all({k: 'ev', ...e});
      sn = soot.rows(snRow);
    }
    const rows = [];
    for (const p of peers.values()) {
      if (!p.placed) continue;
      rows.push([p.id, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +p.phi.toFixed(3), p.s, p.pose, p.rig, p.wNew ? p.w : 0, p.ls || 0, p.lit ? 1 : 0, p.bd | 0]);
      p.wNew = false;
    }
    if (rows.length) { const m = {k: 'snap', t: now(), p: rows}; if (c) m.c = c; if (sn) m.sn = sn; all(m); }
  }, 1000 / TICK_HZ);

  return {
    connect, get size() { return peers.size; }, world, seed, clock, secrets, elk, soot,
    stop() { clearInterval(timer); for (const p of peers.values()) p.conn.close(1001, 'server stopping'); },
  };
}
