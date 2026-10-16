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
// burning fires' light (the builds), and put a lantern out (an event to everyone: {k: 'ev', a: 'snuff', id}; one breaking off
// from a Big Tooth's wearer: {k: 'ev', a: 'flinch', i, x, y, h}); their places go
// out in the snapshots (sn: [x, y, h, mode] each). And THE WORKSHOP (docs/WORKSHOP.md: server/workshop.mjs): every made thing's
// record (kept by the browser's key: server/players.mjs), counted from the 'fell' and 'mine' acts that carry its uid; the
// furnaces' heat and charges; fire-setting (an iron vein cracked by a fire burning by it: 'k' + its index in the world).
// out in the snapshots (sn: [x, y, h, mode] each). And the forest's ANIMALS where someone touches them (server/animals.mjs: a claim
// on the one on someone's rope, a calmed roe, a find), the held one's place in its holder's snapshot row (an).
// And every player's SKILLS (docs/SKILLS.md): a player is known by the random key his browser sends in its hello (server/players.mjs
// keeps the records); the room grants XP itself on the acts it already sees (a fell, a pick, a blow on a vein, a landed fish, a
// broken crystal: each x content/skills.js RATE x --xprate) and tells that player alone ({k: 'skills', xp, d}); the levels it
// checks (a pick's yield, a vein's chunks, a cast's roll) are its record's, never the client's word.
// Transport-free: a connection is {send(text), close(), onmessage, onclose} (ws.mjs, or any other transport with that shape).
// The moves (content/skills.js MOVES) that change the sim are checked against the record's levels too (moveLvl: at least
// --movelvl, a test server's pretend level; it goes out in the skills message as ml). A --dev server takes the Sandbox's
// Skills rows (act 'dev': next | reset) for the asker's own record. TITLES (content/skills.js): the room counts (the cave's
// seconds and the metres walked from the accepted moves, trees felled, blueberries picked, fish landed between dusk and dawn,
// veins spent) and grants them (the skills message's ti: {titles, title, got}); the worn one goes out with the player (pub t,
// {k: 'ptitle', id, t} when it changes); {a: 'title', id} wears one he has ('' none).
//   const room = createRoom({seed, trees, decor, veins, cave, regrow, unc, hour, daymin, log, players, xprate, importCap, movelvl, dev}); room.connect(conn);
//   room.stop(); room.clock() -> hours; room.players (the records)
import {VERSION, TICK_HZ, MOVE, REACH, COLORS, CLOCK, encode, decode, num, str} from '../src/net/protocol.js';
import {cleanSet, GEAR_BY_ID} from '../src/content/gear.js';
import {CATCHES, WATERS, BAITS, SPOT, COME, TUNE as FISH, roll, statsOf, castNotes, spotNear, shadowVerdict} from '../src/content/fishing.js';
import {mealNotes, parseCode, codeOf, MEALS, QUALITIES} from '../src/content/meals.js';
import {PLANTS, pickYield, pickStats, levelNotes, regrowHours} from '../src/content/forage.js';
import {VEINS, mineYield, mineStats, regrowHours as veinHours} from '../src/content/mining.js';
import {BUILDS, TUNE as BUILD, POT, fuelAt, stokeFuel, potOpen} from '../src/content/builds.js';
import {WEATHER, createSchedule, seasonAt, TUNE as WXT} from '../src/sim/wxclock.js';
import {TUNE as TH, STRIKE, ironOf} from '../src/content/thunder.js';
import {createThunder, nextSpring} from '../src/sim/thunder.js';
import {TUNE as ICE} from '../src/content/ice.js';
import {createLake, thickAt, refreezeAt} from '../src/sim/ice.js';
import {SKILLS, CURVE, IMPORT_CAP, TITLES, levelOf, fellXP, rateOf, hasMove, nextMoveLvl, needXP, titlesEarned, inCave} from '../src/content/skills.js';
import {TUNE as MINE, chainSkipped} from '../src/content/mining.js';
import {createPlayers, KEY_RE} from './players.mjs';
import {HERON, TOOTH, DOLL, heronRoll, noteOf, isKeepsake} from '../src/content/keepsakes.js';
import {dollTargets, nearestOf, openGround, dollWalk, underground} from '../src/sim/keepsakes.js';
import {nameHash} from '../src/core/rng.js';
import {TUNE as MIRE} from '../src/content/mire.js';
import {nightOf, createWisps} from '../src/sim/mire.js';
import {createSecrets, createStalker} from '../src/sim/uncanny.js';
import {createAnimals} from './animals.mjs';
import {createSoot} from '../src/sim/cavelife.js';
import {mulberry32} from '../src/core/rng.js';
import {createWorkshop} from './workshop.mjs';

const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;   // (a pose's base64: state())
const PART_H = {dawn: 6.4, day: 10, dusk: 19.2, night: 22};   // (sim/env.js setPart's hours)

export function createRoom({seed, trees = null, decor = null, veins = null, cave = null, forest = null, plan = null, strikes = 1, treefire = true, snuffers = undefined, regrow = 1, unc = null, hour = CLOCK.hour, daymin = CLOCK.daymin, log = () => {}, maxPlayers = 8, workshop = {}, fauna = null, thief = '',
  players = null, xprate = 1, importCap = IMPORT_CAP, movelvl = 0, dev = false}) {
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

  const pub = p => ({id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, phi: p.phi, s: p.s, pose: p.pose, rig: p.rig, w: p.w, wn: p.wn, ls: p.ls, g: p.gear, t: p.rec?.title || ''});
  const others = (p, m) => { const t = encode(m); for (const q of peers.values()) if (q !== p) q.conn.send(t); };
  const all = m => { const t = encode(m); for (const q of peers.values()) q.conn.send(t); };
  // SKILLS (docs/SKILLS.md): XP granted here (x the skill's RATE x --xprate), told to that player alone; his levels are his record's
  const PL = players || createPlayers({SKILLS, importCap});
  const lvlOf = (p, id) => levelOf(p.rec.xp[id] || 0);
  const ML = Math.max(0, movelvl | 0), mvl = {}, SHV = {x: 0, y: 0, sx: 0, sy: 0, hx: 0, hy: 0, cls: '', len: 0};
  const moveOK = (p, move) => { for (const id in SKILLS) mvl[id] = Math.max(lvlOf(p, id), ML); return hasMove(mvl, move); };   // (a move the sim checks: the chain, the nose cast)
  function grant(p, id, n) {
    const g = Math.round(n * rateOf(id, xprate) * 1000) / 1000; if (!(g > 0)) return;
    p.conn.send(encode({k: 'skills', xp: {[id]: PL.grant(p.rec, id, g)}, d: {[id]: g}}));
  }

  // TITLES: a counter of his record up by n; a title it earns is his (and worn: the newest), told to him and his title to the others
  const tiMsg = (p, got = []) => ({k: 'skills', xp: {}, ti: {titles: p.rec.titles, title: p.rec.title, got}});
  function count(p, name, n) {
    const got = titlesEarned(name, PL.count(p.rec, name, n), p.rec.titles); if (!got.length) return;
    for (const id of got) { p.rec.titles.push(id); p.rec.title = id; }
    PL.changed(); p.conn.send(encode(tiMsg(p, got))); others(p, {k: 'ptitle', id: p.id, t: p.rec.title});
    log(`  ${p.name} is ${got.map(id => TITLES[id].name).join(', ')}`);
  }

  // THE WORKSHOP: the made things' records (by the browser's key), the furnaces (server/workshop.mjs)
  const ws = createWorkshop({world, peers, all, log, clock, secs: () => now() / 1000, players: PL, veins, heat: workshop.heat, smelt: workshop.smelt, wardrobe: !!workshop.wardrobe});
  const animals = createAnimals({world, all, send: (p, m) => p.conn.send(encode(m)), log: (...a) => log(...a), now, clock, plan: fauna, thief, players: () => peers.values(),
    fires: () => { const sec = now() / 1000, out = []; for (const e of world.values()) if (e.s === 'built' && BUILDS[e.kind]?.fire && fuelAt(e, sec) > 0) out.push(e); return out; }});   // (the fox: server/animals.mjs, sim/foxden.js)

  function hello(conn, m) {
    if (peers.size >= maxPlayers) { conn.send(encode({k: 'deny', a: 'join', why: 'full'})); conn.close(1013, 'full'); return null; }
    if (num(m.v) !== VERSION) { conn.send(encode({k: 'deny', a: 'join', why: 'version ' + VERSION})); conn.close(1002, 'version'); return null; }
    const id = nextId++, used = new Set([...peers.values()].map(q => q.color)), color = COLORS.find(c => !used.has(c)) || COLORS[id % COLORS.length];
    const {rec} = PL.join(KEY_RE.test(m.key) ? m.key : '#' + id, m.xp);   // (no key: a record for this connection alone; the workshop's fallback too)
    const p = {conn, id, name: str(m.name, 20).replace(/[^\w .'-]/g, '') || 'Player ' + id, color, x: 0, y: 0, z: 0, phi: 0, s: 'idle', pose: 'idle.0', rig: '', w: null, wn: null, ls: null, gear: [], gearT: -1e9, fishT: -1e9, fishN: -1, fishR: null, an: null, sc: '',
      fresh: false, wNew: false, lastT: 0, placed: false, fixT: -1e9, acts: 0, actT: 0, lit: false, lt: 0, md: '', rec, biteT: -1e9, crystals: new Set(), chain: {id: '', n: 0, t: -1e9}, walkM: 0, caveS: 0};
    const made = ws.hello(p, m);   // (his records: the server's, the hello's copy filling in)
    conn.send(encode({k: 'welcome', v: VERSION, id, name: p.name, color, seed, t: now(), world: Object.fromEntries(world), peers: [...peers.values()].map(pub),
      clock: clockMsg(), unc: unc ? {sec: secState(), shift: unc.strength} : null, made}));
    peers.set(id, p);
    p.conn.send(encode({k: 'skills', xp: rec.xp, ml: ML, ti: {titles: rec.titles, title: rec.title, got: []}}));   // (his record: the client takes its levels from it; ml: --movelvl)
    others(p, {k: 'join', p: pub(p)});
    animals.joined(p);
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
    } else {
      // (the titles' walking and cave clocks: the accepted moves, gathered and counted every few metres / seconds)
      if (p.placed && !m.tp) { p.walkM += Math.min(d, MOVE.maxSpeed); if (cave && inCave(cave, x, y)) p.caveS += dt; }
      if (p.walkM >= 5) { count(p, 'walked', Math.round(p.walkM * 100) / 100); p.walkM = 0; }
      if (p.caveS >= 5) { count(p, 'cave', Math.round(p.caveS * 100) / 100); p.caveS = 0; }
      p.x = x; p.y = y; p.z = z; p.placed = true;
    }
    p.lastT = t;
    p.phi = num(m.phi, p.phi); p.s = str(m.s, 16) || p.s; p.pose = str(m.pose, 32) || p.pose;
    const rig = str(m.rig, 16);
    if (Array.isArray(m.wn) && m.wn.length <= 64) { p.wn = m.wn.map(b => str(b, 32)); others(p, {k: 'wn', id: p.id, wn: p.wn}); }
    if (rig !== p.rig) { p.rig = rig; if (!rig) { p.w = null; p.wn = null; } }
    if (typeof m.w === 'string' && m.w.length < 2048 && B64.test(m.w)) { p.w = m.w; p.wNew = true; }   // (the cloth's pose: base64 or nothing, passed on to everyone)
    p.ls = Array.isArray(m.ls) && m.ls.length === 5 ? m.ls.map((v, i) => i ? Math.round(num(v) * 100) / 100 : str(v, 8)) : null;
    p.lt = m.lt === 1 || m.lt === 2 ? m.lt : 0; p.lit = p.lt > 0;   // (his lantern burns in the cave, 2: a burnt eel's shining eyes: sim/cavelife.js reads p.lit)
    p.md = str(m.md, 24);   // (the meal in him: content/meals.js codeOf; friends see its mood, the fishing grab checks it)
    p.bd = num(m.bd, 0) & 0x7ff;   // (his body's look: content/body.js packBody, passed on in the snapshots)
    p.an = animals.an(m.an, p);   // (the animal on his rope: server/animals.mjs checks it's his claim)
    p.sc = str(m.sc, 32);   // (his scene: the snapshots go to the players in the same one; '' an old client's)
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
    if (!(a === 'take' && id[0] === 'b') && animals.act(p, a, m, id, deny)) return;   // rope, free, calm, find, the fox's (server/animals.mjs; a 'take' of a build 'b' id is the workshop's bar)
    if (a === 'pick') return pick(p, m, id, t, deny);
    if (a === 'mine') return mine(p, m, id, t, deny);
    if (a === 'crystal') return crystal(p, id, deny);
    if (a === 'title') {   // the title he wears: one of his, or none ('')
      if (id && !p.rec.titles.includes(id)) return deny('not yours');
      p.rec.title = id; PL.changed(); p.conn.send(encode(tiMsg(p))); others(p, {k: 'ptitle', id: p.id, t: id}); return;
    }
    if (a === 'dev') {   // dev (--dev): the Sandbox's Skills rows on his own record (every skill to its next move's level | back to 0)
      if (!dev) return deny('not a dev server (--dev)');
      if (id === 'titles') { for (const tid in TITLES) { const T = TITLES[tid]; count(p, T.n, Math.max(0, T.at - (p.rec.n[T.n] || 0))); } return; }   // (every title earned)
      if (id === 'notitles') { p.rec.titles.length = 0; p.rec.title = ''; p.rec.n = {}; PL.changed(); p.conn.send(encode(tiMsg(p))); others(p, {k: 'ptitle', id: p.id, t: ''}); return; }
      for (const sk in SKILLS) {
        if (id === 'reset') PL.set(p.rec, sk, 0);
        else if (id === 'next') { const n = nextMoveLvl(sk, lvlOf(p, sk)); if (n) PL.set(p.rec, sk, needXP(n)); }
      }
      p.conn.send(encode({k: 'skills', xp: p.rec.xp, ml: ML})); log(`  ${p.name}: dev skills ${id}`); return;
    }
    if (a === 'build' || a === 'stoke' || a === 'unbuild' || a === 'pot' || a === 'spoon') return build(p, a, m, id, t, deny);
    if (a === 'ignite' || a === 'wood') return thunderAct(p, a, id, deny);
    if (a === 'hole') return iceHole(p, m, deny);
    if (ws.ACTS.has(a)) return ws.act(p, a, m, id, deny);
    if (a === 'shelve' || a === 'unshelve' || a === 'fetch') return shelf(p, a, m, id, deny);
    if (a === 'dig') return mireDig(p, id, deny);
    if (a !== 'fell') return deny('unknown act');
    if (world.has(id)) return deny('gone');
    let tr = null, dx = 0, dy = 0;
    if (trees) {
      tr = trees.get(id); if (!tr) return deny('no such tree');
      let tx = tr[0], ty = tr[1];
      const i = unc?.fidIndex.get(id); if (i !== undefined) { unc.posOf(i, clock(), tpos); tx = tpos[0]; ty = tpos[1]; }   // (it may have walked tonight)
      const d = Math.hypot(tx - p.x, ty - p.y); if (d > REACH) return deny('too far');
      if (d > .01) { dx = +((tx - p.x) / d).toFixed(3); dy = +((ty - p.y) / d).toFixed(3); }   // (the fall's way: away from the feller, as the server saw him)
    }
    const s = {s: 'felled', by: p.id, t};
    world.set(id, s);
    all(dx || dy ? {k: 'world', id, s: s.s, by: p.id, dx, dy} : {k: 'world', id, s: s.s, by: p.id});
    ws.count(p, m.u, m.old === 1 ? ['fell', 'oldoak'] : ['fell']);   // (the axe's record: u; old: an old oak)
    if (tr?.[2]) { grant(p, 'woodcutting', fellXP(tr[2], tr[3] || 1)); count(p, 'trees', 1); }   // (the whole tree's XP to the feller: its bites, the fell, the logs)
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
    const lvl = lvlOf(p, 'foraging'), notes = levelNotes(SKILLS.foraging.per, lvl);
    for (const g of p.gear) for (const q of GEAR_BY_ID[g]?.mods || []) notes.push(q);
    const n = pickYield(pickRng, kind, pickStats(notes)), s = {s: 'picked', by: p.id, t, at: clock() + regrowHours(kind, regrow)};
    world.set(id, s);
    all({k: 'world', id, s: s.s, by: p.id, n});
    grant(p, 'foraging', PLANTS[kind].xp);
    if (kind === 'blueberry' && n > 0) count(p, 'berries', n);
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
    const crack = ws.cracked(id) ? 1 : 0;   // (fire-setting: a cracked vein asks one tier less, gives one chunk more: server/workshop.mjs)
    const V = VEINS[kind]; if ((num(m.tier, 1) | 0) + crack < V.tier) return deny('too hard');
    const pow = Math.max(.25, Math.min(3, num(m.pow, 1)));
    const by = cur?.by ? [...cur.by] : []; if (!by.includes(p.id)) by.push(p.id);
    const us = {...cur?.us}; if (typeof m.u === 'string' && m.u) us[p.id] = str(m.u, 24);   // (each striker's pick's record: the workshop counts the vein into it)
    let left = Math.max(0, (cur?.left ?? V.blows) - pow);
    grant(p, 'mining', V.xp);   // (a blow that bites: his)
    // THE CHAIN (Mining 5, docs/SKILLS.md): his rhythm blows in a row on this vein, each within TUNE.chain.gap of the last (counted
    // here: the client's count is never asked); the n-th, with the move, cracks it at once (the XP of the blows it skipped)
    const C = MINE.chain, ch = p.chain, dt = (t - ch.t) / 1000;
    ch.n = m.rh === 1 && ch.id === id && dt >= C.gap[0] && dt <= C.gap[1] ? ch.n + 1 : m.rh === 1 ? 1 : 0; ch.id = id; ch.t = t;
    let chain = false;
    if (ch.n >= C.n && moveOK(p, 'chain')) { ch.n = 0; if (left > 1e-6) { grant(p, 'mining', V.xp * chainSkipped(left, pow)); left = 0; chain = true; } }
    if (left > 1e-6) {
      const s = {s: 'struck', left: +left.toFixed(3), by, t, us};
      world.set(id, s); all({k: 'world', id, s: 'struck', left: s.left, by: p.id}); return;
    }
    const got = {};
    for (const q of by) {
      const pq = peers.get(q); if (!pq) continue;
      const notes = levelNotes(SKILLS.mining.per, lvlOf(pq, 'mining'));
      for (const g of pq.gear) for (const n of GEAR_BY_ID[g]?.mods || []) notes.push(n);
      got[q] = mineYield(mineRng, kind, mineStats(notes)) + crack;
      ws.count(pq, us[q], kind === 'iron' ? ['veins', 'iron'] : ['veins']);
      grant(pq, 'mining', V.xp * 4); count(pq, 'veins', 1);   // (the spent vein: every striker's)
    }
    world.set(id, V.hollow ? {s: 'spent', by: p.id, t} : {s: 'spent', by: p.id, t, at: clock() + veinHours(regrow)});   // (a hollow wall: open for good)
    all({k: 'world', id, s: 'spent', by: p.id, got, ...(chain ? {chain: 1} : {})});
  }
  // A CAVE CRYSTAL broken under the pick ({a: 'crystal', id: 'c' + its index in the cave plan's props}): the crystals are each
  // player's own (combat breaks them in his world); the room checks it's one of the plan's, in reach and not already his, and
  // grants its Mining XP (content/mining.js TUNE.crystal.xp)
  function crystal(p, id, deny) {
    const i = /^c\d+$/.test(id) ? +id.slice(1) : -1, c = cave?.props?.[i];
    if (cave && (!c || c[0] !== 'crystal')) return deny('no such crystal');
    if (c && Math.hypot(c[1] - p.x, c[2] - p.y) > REACH) return deny('too far');
    if (p.crystals.has(i)) return deny('broken');
    p.crystals.add(i); grant(p, 'mining', MINE.crystal.xp);
  }
  // BUILDING (docs/BUILDING.md): a build put down ({a: 'build', id: its kind (content/builds.js), x, y}: within reach of him,
  // clear of the other builds, no more of the kind standing than its `most` for him) gets an id here ('b' + n) and is told to
  // everyone ({k: 'world', id, s: 'built', kind, x, y, by, fuel, t0}); a fire's fuel burns on this server's clock (s: t0), a log
  // on it ({a: 'stoke', id}) is told the same way (s: 'stoked', fuel, t0, by); one's own lamp taken back ({a: 'unbuild', id}):
  // s 'gone'. Builds stay for the room's life; a late joiner gets them in the welcome. The pouch is the client's (it pays when
  // it hears its build stands).
  // THE SHARED POT (content/builds.js POT): its cook plays the slow game on his client and puts it on a burning fire with no pot
  // ({a: 'pot', id: the fire, dish, q}: paid on his side when it went over; a deny gives it back): s 'pot' with the fire's pot
  // {dish, q, left, t0, took}. A spoon ({a: 'spoon', id}): one a player while there are spoons: s 'spoon', by, left (the eater eats
  // it). The pot goes (s 'potgone') with its last spoon, when its fire is cold or POT.life s after (the tick)
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
    if (a === 'pot') {
      const dish = str(m.dish, 32), q = str(m.q, 8);
      if (!def.fire || !(fuelAt(e, secs()) > 0)) return deny('not burning');
      if (!MEALS[dish] || !QUALITIES.includes(q)) return deny('no such dish');
      if (potOpen(e, secs(), def)) return deny('a pot is on it');
      e.pot = {dish, q, left: POT.spoons, t0: +secs().toFixed(3), took: [], by: p.id};
      all({k: 'world', id, s: 'pot', pot: e.pot, by: p.id}); log(`  ${p.name} put a pot of ${dish} (${q}) on ${id}`); return;
    }
    if (a === 'spoon') {
      if (!potOpen(e, secs(), def)) return deny('no pot');
      if (e.pot.took.includes(p.id)) return deny('had one');
      e.pot.took.push(p.id); e.pot.left--;
      all({k: 'world', id, s: 'spoon', by: p.id, left: e.pot.left});
      if (e.pot.left <= 0) { delete e.pot; all({k: 'world', id, s: 'potgone'}); }
      return;
    }
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
  // KEEPSAKE SHELVES (docs/KEEPSAKES.md): a shelf is a build (kind keep_shelf); what stands on it is its entry's `on`
  // ([[item, by]], at most its places) and a Bark Doll that walked off it its `doll` ({x, y, by, n: walks so far}). Anyone puts
  // a keepsake on ({a: 'shelve', id: the shelf, item}); only who put it there takes it back ({a: 'unshelve', id, item}); anyone
  // brings a walked doll back ({a: 'fetch', id}: within reach of it). Told to everyone as {k: 'world', id, s: 'shelf', on,
  // doll, by, a, item} (the pouch is the client's: it pays or gets it back when it hears). At each dawn a shelf's doll on the
  // surface may walk toward the nearest secret (sim/keepsakes.js dollWalk: drawn from the seed, the day, the shelf), at most
  // DOLL.most times before it waits to be fetched.
  function shelf(p, a, m, id, deny) {
    const e = world.get(id); if (!e || e.s !== 'built' || !BUILDS[e.kind]?.shelf) return deny('no such shelf');
    e.on ??= []; e.doll ??= null;
    const item = str(m.item, 24), tell = () => all({k: 'world', id, s: 'shelf', on: e.on, doll: e.doll, by: p.id, a, item});
    if (a === 'fetch') {
      if (!e.doll || Math.hypot(e.doll.x - p.x, e.doll.y - p.y) > DOLL.fetch + 2) return deny('no doll there');
      e.on.push(['bark_doll', e.doll.by]); e.doll = null; e.walks = 0; return tell();
    }
    if (Math.hypot(e.x - p.x, e.y - p.y) > BUILD.reach) return deny('too far');
    if (a === 'shelve') {
      if (!isKeepsake(item) || e.on.length >= BUILDS[e.kind].shelf.places) return deny('no place');
      if (e.on.some(o => o[0] === item) || (item === 'bark_doll' && e.doll)) return deny('one is there');
      e.on.push([item, p.id]); return tell();
    }
    const i = e.on.findIndex(o => o[0] === item && o[1] === p.id); if (i < 0) return deny('not yours');
    e.on.splice(i, 1); tell();
  }
  let dawnN = null;   // (plan: createRoom's forest plan, also set by room.usePlan: the dolls' open ground and the spring)
  const DT_LIST = [];
  const DOLL_O = {U: unc, C: cave, spring: null, spent: id => { const s = secrets?.st[id]?.s; return s === 'spent' || s === 'triggered'; }, opened: i => world.get('v' + (cave?.hollows?.[i]?.vein ?? -1))?.s === 'spent', extra: null};
  const okAt = (x, y) => openGround(plan, cave, x, y);
  function dawnTick() {   // a new dawn (06:00 on the clock): the shelves' dolls may walk
    const n = Math.floor((clock() - 6) / 24);
    if (n === dawnN) return; const first = dawnN === null; dawnN = n; if (first) return;
    for (const [id, e] of world) {
      if (e.s !== 'built' || !BUILDS[e.kind]?.shelf || underground(cave, e.x, e.y)) continue;
      const onI = e.on?.findIndex(o => o[0] === 'bark_doll') ?? -1; if (onI < 0 && !e.doll) continue;
      if ((e.walks || 0) >= DOLL.most) continue;
      const fx = e.doll ? e.doll.x : e.x, fy = e.doll ? e.doll.y : e.y;
      const to = nearestOf(dollTargets(DOLL_O, fx, fy, DT_LIST), fx, fy);
      const w = dollWalk({seed, day: n, key: nameHash(id), x: fx, y: fy, to, ok: okAt}); if (!w) continue;
      const by = e.doll ? e.doll.by : e.on[onI][1]; if (onI >= 0) e.on.splice(onI, 1);
      e.walks = (e.walks || 0) + 1; e.doll = {x: w.x, y: w.y, by, n: e.walks};
      all({k: 'world', id, s: 'shelf', on: e.on, doll: e.doll, by: 0, a: 'walk', item: 'bark_doll'});
      log(`  the doll of shelf ${id} walked to ${w.x}, ${w.y}`);
    }
  }
  let growT = 0;
  function regrowTick(dt) {   // once a second: the picked patches and spent veins whose time has come grow back, for everyone
    if ((growT += dt) < 1) return;
    growT = 0; const h = clock();
    for (const [id, s] of world) if (s.at !== undefined && h >= s.at) { world.delete(id); if (id[0] === 'z') thunder?.charred.delete(id.slice(1)); all({k: 'world', id, s: 'grown'}); }   // (z: a charred tree whole again in the spring)
    // the rain on the open fires (each burning one's wet seconds; one out: 'doused', everyone's fire goes out with it)
    const sec = secs();   // (pots: gone when their fire is cold or their time is up)
    for (const [id, s] of world) if (s.pot && !potOpen(s, sec, BUILDS[s.kind])) { delete s.pot; all({k: 'world', id, s: 'potgone'}); }
    const rain = (weatherNow().rain ?? 0) >= BUILD.douse.rain;
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
  // content/gear.js cleanSet) and tells everyone, the wearer too. Only what he owns (server/workshop.mjs owns: the free kinds,
  // his made clothes; anything with --wardrobe)
  function wear(p, m) {
    const t = now(), mine = () => p.conn.send(encode({k: 'gear', id: p.id, g: p.gear}));   // (every ask gets an answer)
    if (t - p.gearT < 100) return mine();   // (a flood: refused, the set stays)
    p.gearT = t;
    const g = cleanSet(m.g).filter(id => ws.owns(p, id));
    if (g.join(',') === p.gear.join(',')) return mine();
    p.gear = g;
    p.shun = noteOf(g, 'cave.shun', 0) > 0 ? TOOTH.shun : 0; p.kin = noteOf(g, 'cave.kin', 0) > 0;   // (the keepsakes' rules for the soot things: sim/cavelife.js)
    all({k: 'gear', id: p.id, g});
    log(`  ${p.name} wears ${g.join(', ') || 'their own clothes'}`);
  }

  // FISHING (docs/FISHING.md): a cast that fell on water asks what bites ({a: 'cast', n, x, y, w, deep, rain, perfect, lvl,
  // spot, bait, meal}); the server rolls it (content/fishing.js roll: the same rules the game runs offline) from the set he
  // wears (its fish.* notes and the angler's set), his Fishing level, his bait and his meal (as the client says them: the
  // save is his), a fishing spot (checked against the spots' hash on its own clock) and the clock's part of the day, and answers him alone
  // ({a: 'bite', n, id, cm, kg, wait, nibbles, two}). The fight is the client's; a landed one ({a: 'land', n}) is told to
  // everyone ({a: 'caught', id: who, name, c: the catch, cm, kg, two}); a lost one ({a: 'lost', n}) forgets the roll.
  // A jab ({a: 'jab', n, x, y, w, lvl}: the Heron Feather's jab into the shallows by hand, docs/KEEPSAKES.md) from one who
  // wears the feather, at his feet: rolled at once with HERON's limits (content/keepsakes.js heronRoll), answered
  // ({a: 'jabbed', n, id, cm, kg}, id '' for nothing) and a fish told to everyone like a landed one.
  const fishRng = mulberry32((seed ^ 0xf15f) >>> 0), FISH_REACH = 20, FISH_WATERS = new Set(Object.values(WATERS));
  const partOf = h => { h = ((h % 24) + 24) % 24; return h < 5.6 || h >= 20.3 ? 'night' : h < 7.2 ? 'dawn' : h < 18 ? 'day' : 'dusk'; };
  // the fish.* stats a cast or a grab is rolled with: the set he wears, his level, the angler's set, his meal (his word: the save is his)
  function fishStats(p, m) {
    const lvl = lvlOf(p, 'fishing'), notes = [];   // (his record's level, never the client's word)
    for (const id of p.gear) for (const q of GEAR_BY_ID[id]?.mods || []) notes.push(q);
    const pieces = p.gear.filter(id => GEAR_BY_ID[id]?.kind === 'fishing').length;
    notes.push(...castNotes({lvl, pieces, meal: mealNotes(str(m.meal, 24)), per: SKILLS.fishing.per}));
    return statsOf(notes);
  }
  // FISH COME TO YOU (content/fishing.js COME): the lingon in him (not burnt: p.md, his state's word), or a friend with it burnt within
  // COME.friend (their fish come to him)
  const PC = {id: '', q: 'done'}, LINGON_BURNT = codeOf('fish_lingon', 'burnt');
  const lingonIn = p => parseCode(p.md, PC).id === 'fish_lingon' && PC.q !== 'burnt';
  function burntLingonNear(p) { for (const q of peers.values()) if (q !== p && q.md === LINGON_BURNT && Math.hypot(q.x - p.x, q.y - p.y) <= COME.friend) return true; return false; }
  // a snowball hit someone (docs/WINTER.md): the thrower's word, passed on to everyone else (gentle: nothing to check but the numbers)
  function snowball(p, m) {
    const id = num(m.id, -1); if (!peers.has(id)) return;
    const c = v => Math.max(-6, Math.min(6, num(v)));
    others(p, {k: 'snow', by: p.id, id, vx: c(m.vx), vy: c(m.vy), hat: m.hat ? 1 : 0});
  }
  function fish(p, m) {
    const a = str(m.a, 8), n = num(m.n, -1), t = now();
    if (a === 'jab') return jab(p, m, n, t);   // (below)
    if (a === 'cast') {
      if (t - p.fishT < 500) return;   // (a flood: dropped; the client rolls it itself after a wait)
      const x = num(m.x, NaN), y = num(m.y, NaN), w = str(m.w, 8);
      if (!FISH_WATERS.has(w) || !(Math.hypot(x - p.x, y - p.y) < FISH_REACH)) return;
      p.fishT = t;
      const bait = str(m.bait, 24);
      // a spot: the spots' hash on its clock, or the lingon's fish round his legs (a cast within COME.rod of him)
      const spot = !!m.spot && (spotNear(x, y, Math.floor(t / 1000 / SPOT.slot), seed | 0) || (lingonIn(p) && Math.hypot(x - p.x, y - p.y) <= COME.rod + .5));
      // SHADOWS (Fishing 5, docs/SKILLS.md): the bobber at a shadow's nose (computed here from the seed and this clock, a little
      // latency back) is a quick bite of its class; on it, the fish bolts and the wait grows. Only with the move
      const ts = t / 1000, sv = moveOK(p, 'shadows') ? shadowVerdict(x, y, Math.floor(ts / SPOT.slot), seed | 0, [ts, ts - .25, ts - .5], SHV) : '';
      const st = fishStats(p, m), rain = !!m.rain;
      const r = roll(fishRng, {water: w, part: partOf(clock()), rain, deep: Math.max(0, Math.min(40, num(m.deep, 0))), luck: st['fish.luck'] + (rain ? st['fish.rain'] : 0),
        find: st['fish.find'], size: st['fish.size'], lure: st['fish.lure'], night: st['fish.night'], perfect: !!m.perfect,
        spot, bait: BAITS[bait] ? bait : '', season: seasonAt(clock(), WXT.seasonDays), cls: sv === 'nose' ? SHV.cls : '', quick: sv === 'nose'});
      if (sv === 'spook') r.wait = Math.round((r.wait + FISH.spook) * 100) / 100;
      if (sv) r.sh = sv;   // (the client's view: it saw the same, or close)
      r.two = fishRng() < st['fish.double'];
      p.fishN = n; p.fishR = r; p.fishPerfect = !!m.perfect; p.biteT = t;
      p.conn.send(encode({k: 'fish', a: 'bite', n, ...r}));
    } else if (a === 'land') {
      const r = p.fishR; if (!r || n !== p.fishN) return;
      if (t - p.biteT < 1500) return;   // (sooner than any fish can be fought in: refused, the roll kept)
      p.fishR = null;
      all({k: 'fish', a: 'caught', id: p.id, name: p.name, c: r.id, cm: r.cm, kg: r.kg, two: r.two});
      const first = !p.rec.caught[r.id]; p.rec.caught[r.id] = (p.rec.caught[r.id] || 0) + (r.two && !CATCHES[r.id].find ? 2 : 1);
      grant(p, 'fishing', Math.round(CATCHES[r.id].xp * (first ? 2 : 1) * (p.fishPerfect ? 1.2 : 1)));   // (features/fishing.js give: the same sum)
      log(`  ${p.name} caught a ${CATCHES[r.id].name}${CATCHES[r.id].find ? '' : ` (${r.cm} cm)`}`);
      if (!CATCHES[r.id].find && partOf(clock()) !== 'day') count(p, 'night_fish', r.two ? 2 : 1);
    } else if (a === 'lost' && n === p.fishN) p.fishR = null;
    else if (a === 'grab') {   // {a: 'grab', n, x, y, w, lvl, rain, meal}: a fish grabbed by hand where he stands (common and fine only)
      if (t - p.fishT < 500) return;
      const x = num(m.x, NaN), y = num(m.y, NaN), w = str(m.w, 8);
      if (!FISH_WATERS.has(w) || !(Math.hypot(x - p.x, y - p.y) < COME.reach) || !(lingonIn(p) || burntLingonNear(p))) return;
      p.fishT = t;
      const st = fishStats(p, m), rain = !!m.rain;
      const r = roll(fishRng, {water: w, part: partOf(clock()), rain, deep: 0, luck: st['fish.luck'] + (rain ? st['fish.rain'] : 0), size: st['fish.size'], lure: 1, hand: true});
      p.conn.send(encode({k: 'fish', a: 'grabbed', n, ...r}));
      all({k: 'fish', a: 'caught', id: p.id, name: p.name, c: r.id, cm: r.cm, kg: r.kg, two: false});
      log(`  ${p.name} grabbed a ${CATCHES[r.id].name} (${r.cm} cm) by hand`);
    }
  }

  function jab(p, m, n, t) {
    if (t - (p.jabT || 0) < 600 || !p.gear.includes('heron_feather')) return;   // (a flood, or no feather: dropped; the client rolls it after a wait)
    const x = num(m.x, NaN), y = num(m.y, NaN), w = str(m.w, 8);
    if (!FISH_WATERS.has(w) || !(Math.hypot(x - p.x, y - p.y) < HERON.reach + 1.5)) return;
    p.jabT = t;
    const r = heronRoll(fishRng, {water: w, part: partOf(clock()), lvl: lvlOf(p, 'fishing')});
    p.conn.send(encode({k: 'fish', a: 'jabbed', n, id: r ? r.id : '', cm: r ? r.cm : 0, kg: r ? r.kg : 0}));
    if (r) { all({k: 'fish', a: 'caught', id: p.id, name: p.name, c: r.id, cm: r.cm, kg: r.kg, two: false}); log(`  ${p.name} jabbed a ${CATCHES[r.id].name} (${r.cm} cm)`); }
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
      peers.delete(p.id); others(p, {k: 'leave', id: p.id}); animals.left(p);
      log(`- ${p.name} (#${p.id}) · ${peers.size} in the room`);
      p = null;
    };
  }

  // THE TICK: everyone's latest state to everyone (a client skips its own row); a pose goes out only when it changed
  const DT = 1 / TICK_HZ;
  const rowSc = new Map(), scenes = new Set();   // (the tick's rows' scenes, by row index)
  let anT = 0;
  const timer = setInterval(() => {
    if (!peers.size) return;
    regrowTick(DT); dawnTick();
    thunderTick(DT);
    ws.tick(DT);
    if ((anT += DT) >= 1) { anT = 0; animals.tick(); }   // (lapsed claims, past calms)
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
    // (by scene: a player in a run isn't drawn in the forest, nor the other way; each scene's rows encoded once)
    const rows = [];
    for (const p of peers.values()) {
      if (!p.placed) continue;
      rowSc.set(rows.length, p.sc || '');
      rows.push([p.id, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +p.phi.toFixed(3), p.s, p.pose, p.rig, p.wNew ? p.w : 0, p.ls || 0, p.lt || 0, p.md || '', p.bd | 0, p.an || 0]);
      p.wNew = false;
    }
    if (rows.length) {
      const m = {k: 'snap', t: now(), p: rows}; if (c) m.c = c; if (sn) m.sn = sn;
      scenes.clear(); for (const q of peers.values()) scenes.add(q.sc || '');
      let one = scenes.size === 1; for (const v of rowSc.values()) if (!scenes.has(v)) one = false;   // (everyone in one scene: as before)
      if (one) all(m);
      else for (const sc of scenes) {
        m.p = rows.filter((r, i) => rowSc.get(i) === sc); if (!m.p.length) continue;
        const t = encode(m); for (const q of peers.values()) if ((q.sc || '') === sc) q.conn.send(t);
      }
    }
    rowSc.clear();
  }, 1000 / TICK_HZ);

  return {
    connect, get size() { return peers.size; }, world, seed, clock, secrets, elk, soot, players: PL,
    stop() { clearInterval(timer); for (const p of peers.values()) p.conn.close(1001, 'server stopping'); },
    usePlan(F) { plan = F || null; DOLL_O.spring = plan?.spring || null; },   // (the keepsakes' shelves: docs/KEEPSAKES.md)
  };
}
