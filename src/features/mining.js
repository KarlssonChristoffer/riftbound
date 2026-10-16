// MINING (docs/MINING.md): digging the cave's veins with the old pick. The cave's plan (world/caves.js) places the VEINS (marked
// spots at the walls' feet: stone, copper, and iron deeper in, C.veins; a vein's id is its index there, 'v' + i, the same on every
// client and the co-op server) and the old miner's CAMP (C.camp: a rotted crate, a candle stub, a heap of chipped stone, a rusty
// pick driven into the wall). E at the camp takes the pick into the bag (once: pack.store('mining').took; each player his own).
// LMB on a vein (the cursor on it, in reach) or E facing one swings the pick (sim/player/tool.js, the job 'mine': its own swing,
// content/mining.js SWING); each blow BITES (sparks and grit, the vein cracks in three stages as its blows run out) or, rock too
// hard for the pick (iron and the old pick), GLANCES with a dull clang ("needs a better pick"). A press timed to the end of the
// last swing (tool.js rhythm) bites RHYTHM.mul harder. The last bite SPENDS the vein: its chunks pop out and roll to his feet,
// walking over them picks them up; a spent vein is a dark scar until it comes back in the same spot (content/mining.js days,
// the world clock; ?regrow= a factor). The cave's CRYSTALS (C.props 'crystal') break under the pick into Glow Shards (combat's
// break: core.damage). Mining XP for each bite and each vein spent.
// THE LIVING DARK (docs/CAVELIFE.md): NIGHT VEINS (kind 'night', 1-2 in the far half) show only in the dark: while no lit lantern
// (his or a friend's), lamp or burning fire is within content/mining.js TUNE.night.dark m of one (or while he trips on the fly
// agaric broth: features/trip.js), its specks glowing like a night sky; hidden, the pick can't find it. HOLLOW WALLS (kind 'hollow':
// world/caves.js C.hollows) are a rubble plug in a chamber's wall with a sealed room carved behind it (a lid of dark over the room,
// a collider in the neck, until it opens): a blow on it knocks hollow (mine.hit hollow: the audio), its last blow caves it in
// (mine.open) for everyone for good, and each player there gets the room's cache (TUNE.cache and a keepsake) on its floor. The
// tells (the lantern's flame leaning toward it, dust trickling down it) are features/cavelife.js's.
// CO-OP (features/coop.js, server/room.mjs, docs/MULTIPLAYER.md): the server owns the veins' blows left and the spent ones. A blow
// is sent (coop.act('mine', 'v' + i, {pow, lvl, tier})); the server's word comes back in coop.mail: struck (the blows left, for
// everyone's cracks), spent (got: each striker's chunks: everyone who struck it gets his own full share), grown. A late joiner
// gets them in the welcome. The camp's pick is each player's own (his save), crystals and chunks are his own.
// Only in the sandbox on the ruins biome (the persistent world) with the forest's cave. ?mining=0 off; ?gathermarks=1 dev dots.
// OWNS: the veins' blows left and spent set (offline) and their saved part, the chunks, the camp's entities, the vein / camp /
//   chunk meshes, the sparks. Sets the tool's want / aim for the job 'mine'.
// READS: host.world.cave (veins, camp, floor), host.PL.tool, host.entities (near: crystals), host.mods ('mine.*'), host.env.t,
//   pack (the pick, the pouch, XP, the store), coop (online, act, mail, net.id), combat's core (a crystal's damage).
// EMITS: mine.hit, mine.spent, mine.chunk, mine.grow, mine.take, mine.open, tool.whiff.
// API (besides tests'): F.shown(i) (a night vein shows now), F.isSpent(i)
// BUDGET: sim: a grid lookup (veins by 4 m cell) a blow or a press; the chunks (a handful) a step; the regrowth once a second
//   over the spent set. View: a vein's mesh made again only when its stage changes; the camp's once; chunks' matrices while they
//   move; the veins shown or hidden when the camera turns (a dot product each).
import * as THREE from 'three';
import {VEINS, SWING as W, TUNE, blowPower, mineYield, regrowHours} from '../content/mining.js';
import {ITEMS} from '../content/items.js';
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {mulberry32, simRandom, viewRandom} from '../core/rng.js';
import {geoOf, M4, box, along} from '../world/kit3d.js';
import {FAMS} from '../world/world.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';

const ON = flags.get('mining') !== '0';
const REGROW = (v => v > 0 ? v : 1)(parseFloat(flags.get('regrow')));
const CELL = 4, VEIN_R = .4, DEG = Math.PI / 180;   // m a grid cell; m: a vein's half width along its wall (a press, a blow)
const SHOW = .3;   // a vein shows while its way into the open . the way to the camera > SHOW (world/cave3d.js's walls: the same rule)
const key = (i, j) => (i + 4096) * 8192 + j + 4096;
const NEVER = 1e9;   // (a hollow wall's 'comes back' hour: never)

// ORDER (core/features.js): after woodcutting (its LMB on a trunk asks first; neither takes the other's), before the fists, brawl
// and the gun (LMB, RMB and R are the tool's while it's out). Like foraging it reads co-op's mail a step after it came
export const order = {after: ['woodcut'], before: ['fists', 'brawl', 'gun']};

export async function create(host) {
  const R = simRandom('mining'), VR = viewRandom('mining');   // (its own streams of the session seed: core/rng.js)
  const NEAR = [], PT = {x: 0, y: 0, keep: 0, far: 0};
  const pack = () => host.feature('pack'), game = () => host.feature('game'), ui = () => game()?.ui || null, coop = () => host.feature('coop');
  const core = () => host.feature('combat')?.core || null;
  const online = () => !!coop()?.online;
  const T = () => host.live ? host.PL.tool : null;
  const active = () => ON && host.live && !!C && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const store = () => pack()?.store('mining') || null;

  // ---------------------------------------------------------------- the cave's veins, by grid cell
  let C = null, V = [];
  const NIGHT = [], HID = new Uint8Array(64);   // the night veins' indices; 1: a vein the pick can't find now (a night vein in the light)
  const cells = new Map();   // key(cell) -> [vein index]
  function index() {
    const c = host.world?.cave || null; if (c === C) return;
    C = c; V = c?.veins || []; cells.clear(); left.clear(); spent.clear(); restored = false; ver++;
    NIGHT.length = 0; for (let i = 0; i < V.length; i++) if (V[i].kind === 'night') NIGHT.push(i);
    HID.fill(0); for (const i of NIGHT) HID[i] = 1;   // (a night vein starts hidden until the dark is checked)
    plugsOut(); lids.clear();
    for (const g of GEO.values()) g.dispose(); GEO.clear();   // (another cave: its veins' shapes are other ones)
    for (let i = 0; i < V.length; i++) { const k = key(Math.floor(V[i].x / CELL), Math.floor(V[i].y / CELL)); let L = cells.get(k); if (!L) cells.set(k, L = []); L.push(i); }
  }
  const floorAt = v => host.elev(v.x + v.nx * .45, v.y + v.ny * .45);   // (the floor in front of it)
  // FIRE-SETTING is the workshop's (features/workshop.js cracked(i): a fire burnt by the vein long enough): 1 cracked, else 0
  const cracked = i => host.feature('workshop')?.cracked?.(i) ? 1 : 0;
  const weakWords = i => V[i].kind === 'iron' && !cracked(i) ? 'too hard: fire would crack this' : 'needs a better pick';
  // the vein nearest (x, y) within `reach` m of its face (its middle, VEIN_R either side along the wall) that a blow could take
  // (not spent; on his level); fx, fy: his facing (unit) when it must be ahead of him (0, 0: any way) -> its index | -1
  function veinNear(x, y, z, reach, fx, fy) {
    let best = -1, bd = 1e9;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), r = Math.ceil((reach + 1) / CELL);
    for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      const L = cells.get(key(i, j)); if (!L) continue;
      for (let k = 0; k < L.length; k++) {
        const n = L[k], v = V[n]; if (spent.has(n) || HID[n]) continue;
        const dx = v.x - x, dy = v.y - y, d0 = Math.hypot(dx, dy), d = d0 - VEIN_R;
        if (d > reach || d >= bd) continue;
        if ((fx || fy) && d > .3 && (dx * fx + dy * fy) / (d0 || 1) < .3) continue;
        if (Math.abs(floorAt(v) - z) > 1.2) continue;
        bd = d; best = n;
      }
    }
    return best;
  }
  const veinAhead = () => { const P = host.player, f = P.faceAngle; return veinNear(P.x, P.y, P.z, W.reach + .5, Math.sin(f), Math.cos(f)); };
  // the vein under the cursor: the cursor's line (player.js cursorGround, as woodcut's trunks) passes over its stretch of wall
  // between its foot and 1.6 m up, and he is within a lock's reach of it
  const LOCK_M = 3.5;
  function veinUnderCursor() {
    const gv = host.PL.cursorGround?.(); if (!gv) return -1;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw), gx = gv.x * c + gv.y * s, gy = -gv.x * s + gv.y * c, hg = host.elev(gx, gy), k = host.PPMY / host.PPMH, P = host.player;
    let best = -1, bd = 9;
    const cx = Math.floor(P.x / CELL), cy = Math.floor(P.y / CELL);
    for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      const L = cells.get(key(i, j)); if (!L) continue;
      for (let q = 0; q < L.length; q++) {
        const n = L[q], v = V[n]; if (spent.has(n) || HID[n] || Math.hypot(v.x - P.x, v.y - P.y) > LOCK_M) continue;
        const z = floorAt(v); if (Math.abs(z - P.z) > 1.2) continue;
        const vx = v.x * c - v.y * s, vy = v.x * s + v.y * c, h = hg + (vy - gv.y) * k, dx = Math.abs(vx - gv.x);   // (the line's height over its row)
        if (dx > VEIN_R + .15 || h < z - .2 || h > z + 1.7) continue;
        if (dx < bd) { bd = dx; best = n; }
      }
    }
    return best;
  }
  function crystalNear(x, y, z, reach, fx, fy) {   // a standing cave crystal in reach (ahead of him when fx, fy) -> the prop | null
    let best = null, bd = 1e9;
    for (const p of host.entities.near(x, y, reach + 1, NEAR)) {
      if (p.kind !== 'crystal' || p.broken || p.gone || Math.abs((p.z || 0) - z) > 1.2) continue;
      const dx = p.x - x, dy = p.y - y, d0 = Math.hypot(dx, dy), d = d0 - .4;
      if (d > reach || d >= bd || ((fx || fy) && d > .3 && (dx * fx + dy * fy) / (d0 || 1) < .3)) continue;
      bd = d; best = p;
    }
    return best;
  }
  function crystalUnderCursor() {
    const gv = host.PL.cursorGround?.(); if (!gv) return null;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw), gx = gv.x * c + gv.y * s, gy = -gv.x * s + gv.y * c, hg = host.elev(gx, gy), k = host.PPMY / host.PPMH, P = host.player;
    let best = null, bd = 9;
    for (const p of host.entities.near(P.x, P.y, LOCK_M, NEAR)) {
      if (p.kind !== 'crystal' || p.broken || p.gone || Math.abs((p.z || 0) - P.z) > 1.2) continue;
      const vx = p.x * c - p.y * s, vy = p.x * s + p.y * c, h = hg + (vy - gv.y) * k, dx = Math.abs(vx - gv.x), z = p.z || 0;
      if (dx > .55 || h < z - .2 || h > z + 1.4) continue;
      if (dx < bd) { bd = dx; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------------- the sim's state
  const left = new Map();    // vein -> blows left (a fresh one has none: its full count)
  const spent = new Map();   // vein -> the world hour it comes back (co-op: 1, the server keeps the clock)
  const chunks = [];         // {x, y, h, vx, vy, vh, t, rest, item, yaw, spin, dead}
  let ver = 0, clockT = 0, growT = 0, was = false, wasOnline = false, restored = false, aimSet = false, byE = false, heldSlot = -1, noteT = -9;
  let lockI = -1, lockC = null;   // the vein / crystal a held press is on
  let marks = flags.get('gathermarks') === '1', hopT = 0, hopN = 0;

  function restore() {   // the saved spent veins (offline): this cave's, else none
    restored = true; spent.clear(); left.clear(); ver++;
    const s = store(); if (!s || !C) return;
    if (s.seed !== C.seed) { s.seed = C.seed; s.s = {}; pack()?.dirty(); return; }
    for (const k in s.s || {}) { const i = +k; if (V[i]) spent.set(i, s.s[k]); }
    for (const i of spent.keys()) plugOut(i);
  }
  function save(i, at) {
    if (online()) return;
    const s = store(); if (!s) return;
    s.seed = C.seed; s.s ??= {};
    if (at === undefined) delete s.s[i]; else s.s[i] = +at.toFixed(3);
    pack()?.dirty();
  }
  const stageOf = i => spent.has(i) ? 4 : !left.has(i) ? 0 : clamp(Math.ceil(3 * (1 - left.get(i) / VEINS[V[i].kind].blows)), 1, 3);
  // where the pick meets it: its face, waist high
  const HIT = {x: 0, y: 0, h: 0};
  function hitAt(v) { HIT.x = v.x + v.nx * .1; HIT.y = v.y + v.ny * .1; HIT.h = floorAt(v) + .8; return HIT; }
  function spend(i, n, mine, late) {
    const v = V[i], K = VEINS[v.kind], at = K.hollow ? NEVER : (host.env?.t ?? 0) + regrowHours(REGROW);
    left.delete(i); spent.set(i, online() ? (K.hollow ? NEVER : 1) : at); save(i, at); ver++;
    if (lockI === i) lockI = -1;
    if (n > 0) spawn(v.x + v.nx * .35, v.y + v.ny * .35, floorAt(v) + .7, v.nx, v.ny, K.item, n);
    if (mine) pack()?.gain('mining', K.xp * 4, {x: v.x, y: v.y, h: floorAt(v) + 1.8});
    host.events.push({type: 'mine.spent', x: v.x, y: v.y, i, kind: v.kind, n});
    if (K.hollow) { plugOut(i); if (!late) open(i); }
  }
  // a hollow wall caved in: the sealed room behind it, its cache on the floor (each player there his own: chunks are his)
  function open(i) {
    const h = C.hollows?.find(q => q.vein === i); if (!h) return;
    const z = host.elev(h.cx, h.cy) + .5, k = C.hollows.indexOf(h);
    for (const item in TUNE.cache) spawn(h.cx, h.cy, z, h.nx, h.ny, item, TUNE.cache[item]);
    spawn(h.cx, h.cy, z, h.nx, h.ny, TUNE.keep[k % TUNE.keep.length], 1);
    host.events.push({type: 'mine.open', x: h.x, y: h.y, i, cx: h.cx, cy: h.cy});
    host.shake(3, .3);
  }
  // the plugs' colliders (a hollow wall not yet open: its neck is stopped)
  const plugs = new Map();   // vein -> entity
  function plugsIn() {
    if (!C?.hollows) return;
    for (const h of C.hollows) if (!spent.has(h.vein) && !plugs.has(h.vein)) {
      const e = {kind: 'hollowplug', x: h.x - h.nx * .45, y: h.y - h.ny * .45, z: host.elev(h.x + h.nx * .4, h.y + h.ny * .4), r: .8};
      host.entities.add(e); plugs.set(h.vein, e);
    }
  }
  function plugOut(i) { const e = plugs.get(i); if (e) { host.entities.remove(e); plugs.delete(i); } }
  function plugsOut() { for (const e of plugs.values()) host.entities.remove(e); plugs.clear(); }
  // the night veins in the light: hidden (the pick can't find them) unless it's dark round them or he trips
  const peerLit = (x, y, r) => coop()?.litNear?.(x, y, r) || false;
  const torch = () => !!host.feature('workshop')?.torch;
  function dark() {
    if (!NIGHT.length) return;
    const P = host.player, cv = host.feature('caves'), B = host.feature('builds'), trip = !!host.feature('trip')?.tripping, R0 = TUNE.night.dark;
    for (const i of NIGHT) {
      const v = V[i], lit = ((cv?.lit || torch()) && Math.hypot(P.x - v.x, P.y - v.y) < R0) || B?.shineNear?.(v.x, v.y, R0) || peerLit(v.x, v.y, R0);   // (a lit pine haft is a light: features/workshop.js torch)
      const h = trip || !lit ? 0 : 1;
      if (h !== HID[i]) { HID[i] = h; hidVer++; if (h && lockI === i) lockI = -1; }
    }
  }
  function grow(i) {
    spent.delete(i); left.delete(i); save(i); ver++;
    if (VEINS[V[i].kind].hollow && active()) plugsIn();
    host.events.push({type: 'mine.grow', x: V[i].x, y: V[i].y, i, kind: V[i].kind});
  }

  // ---------------------------------------------------------------- the blow (player.chop of the job 'mine', world coordinates)
  function blow(e) {
    if (e.job !== 'mine') return;
    const tool = ITEMS[e.tool]?.tool; if (!tool) return;
    // the locked vein takes the blow anywhere within reach + assist of its face (he faces it); else the nearest in the blow's arc
    let i = lockI >= 0 && !spent.has(lockI) && !HID[lockI] && Math.hypot(V[lockI].x - e.x, V[lockI].y - e.y) - VEIN_R <= W.reach + W.assist ? lockI : -1;
    if (i < 0) {
      const c0 = Math.cos(W.arc / 2 * DEG); let bd = 9;
      const cx = Math.floor(e.x / CELL), cy = Math.floor(e.y / CELL);
      for (let j = cy - 1; j <= cy + 1; j++) for (let q = cx - 1; q <= cx + 1; q++) {
        const L = cells.get(key(q, j)); if (!L) continue;
        for (const n of L) {
          if (spent.has(n) || HID[n]) continue;
          const v = V[n], dx = v.x - e.x, dy = v.y - e.y, d = Math.hypot(dx, dy) || 1e-6;
          if (d - VEIN_R > W.reach || Math.abs(floorAt(v) - e.z) > 1.2 || ((dx * e.vx + dy * e.vy) / d < c0 && d > VEIN_R + .2)) continue;
          if (d < bd) { bd = d; i = n; }
        }
      }
    }
    if (i >= 0) { strike(i, e, tool); return; }
    const cr = lockC && !lockC.broken && Math.hypot(lockC.x - e.x, lockC.y - e.y) - .4 <= W.reach + W.assist ? lockC : crystalNear(e.x, e.y, e.z, W.reach, e.vx, e.vy);
    if (cr) { crystal(cr, e); return; }
    host.events.push({type: 'tool.whiff', x: e.x + e.vx * .8, y: e.y + e.vy * .8});
  }
  function strike(i, e, tool) {
    const v = V[i], K = VEINS[v.kind], P = host.player, d = Math.hypot(v.x - P.x, v.y - P.y) || 1, ux = (v.x - P.x) / d, uy = (v.y - P.y) / d;
    const at = hitAt(v);
    const crack = cracked(i);   // (fire-setting, features/workshop.js: a cracked vein asks one tier less and gives one chunk more)
    if ((tool.tier || 1) + crack < K.tier) {   // GEAR GATES: iron wants a better pick than the old one
      host.events.push({type: 'mine.hit', x: at.x, y: at.y, h: at.h, i, kind: v.kind, k: 0, rhythm: false, dx: ux, dy: uy});
      if (clockT - noteT > 2.5) { noteT = clockT; ui()?.float(at.x, at.y, at.h + .7, weakWords(i), '#e8a070'); }
      host.hitstop(.03); host.shake(1, .06); return;
    }
    const rhythm = !!e.rhythm, pow = blowPower(tool, {power: host.mods.value('mine.power', 1)}, rhythm);
    pack()?.gain('mining', K.xp);
    const c = coop();
    if (c?.online) {   // CO-OP: the server takes the blow (its word: struck / spent, in mail); the crack shows at once
      c.act('mine', 'v' + i, {pow: +pow.toFixed(3), lvl: pack()?.level('mining') || 1, tier: tool.tier || 1, kind: v.kind});
      left.set(i, Math.max(.001, (left.get(i) ?? K.blows) - pow)); ver++;
    } else {
      const l = (left.get(i) ?? K.blows) - pow;
      if (l > 1e-6) { left.set(i, l); ver++; }
      else spend(i, mineYield(R, v.kind, {extra: host.mods.value('mine.extra', 0)}) + crack, true);
    }
    host.events.push({type: 'mine.hit', x: at.x, y: at.y, h: at.h, i, kind: v.kind, k: Math.min(3, stageOf(i)), rhythm, dx: ux, dy: uy, hollow: !!K.hollow});
    host.hitstop(rhythm ? .07 : .045); host.shake(rhythm ? 2.2 : 1.5, .08);
  }
  // a cave crystal under the pick: combat breaks it (its own shards fly), TUNE.crystal.blows blows; the Glow Shards drop at its foot
  function crystal(p, e) {
    const cr = core(); if (!cr) return;
    const P = host.player, d = Math.hypot(p.x - P.x, p.y - P.y) || 1, ux = (p.x - P.x) / d, uy = (p.y - P.y) / d;
    host.events.push({type: 'mine.hit', x: p.x - ux * .3, y: p.y - uy * .3, h: (p.z || 0) + .6, i: -1, kind: 'crystal', k: 1, rhythm: !!e.rhythm, dx: ux, dy: uy});
    const broke = cr.damage(p, Math.ceil((p.maxHp || 40) / TUNE.crystal.blows) + 1, {canCrit: false, dir: [ux * 2, uy * 2], by: 'melee', ux, uy, quiet: true});
    host.hitstop(.04); host.shake(1.5, .08);
    if (!broke) return;
    if (lockC === p) lockC = null;
    const S = TUNE.crystal.shards, n = S[0] + Math.floor(R() * (S[1] - S[0] + 1));
    spawn(p.x - ux * .3, p.y - uy * .3, (p.z || 0) + .6, -ux, -uy, 'glow_shard', n);
    pack()?.gain('mining', TUNE.crystal.xp, {x: p.x, y: p.y, h: (p.z || 0) + 1.8});
  }

  // ---------------------------------------------------------------- chunks: out of the rock, rolling to his feet, picked up
  function spawn(x, y, h, nx, ny, item, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.atan2(ny, nx) + (R() - .5) * 1.6, v = 1.2 + R() * 1.4;
      chunks.push({x, y, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 1.4 + R() * 1.6, t: 0, rest: false, item, yaw: R() * 6.28, spin: (R() - .5) * 12, dead: false});
    }
  }
  function stepChunks(dt) {
    const P = host.player, G = TUNE.chunk;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const L = chunks[i]; L.t += dt;
      if (!L.rest) {
        L.vh -= 18 * dt; const nx = L.x + L.vx * dt, ny = L.y + L.vy * dt;
        if (host.blocked?.(nx, ny, L.h)) { L.vx *= -.4; L.vy *= -.4; } else { L.x = nx; L.y = ny; }   // (off the wall)
        L.h += L.vh * dt; L.yaw += L.spin * dt;
        const g = host.elev(L.x, L.y);
        if (L.h <= g) { L.h = g; if (L.vh < -2.2) { L.vh *= -.3; L.vx *= .55; L.vy *= .55; L.spin *= .5; } else { L.rest = true; L.vh = L.vx = L.vy = L.spin = 0; } }
      }
      if (L.t < G.delay) continue;
      const dx = P.x - L.x, dy = P.y - L.y, d = Math.hypot(dx, dy);
      if (d < G.pick && Math.abs(P.z - L.h) < 1.2) {
        L.dead = true; chunks.splice(i, 1);
        pack()?.give(L.item, 1, {x: P.x, y: P.y, h: P.z + 1.8});
        host.events.push({type: 'mine.chunk', x: L.x, y: L.y, item: L.item});
      } else if (d < G.magnet && Math.abs(P.z - L.h) < 1.5) {
        const v = Math.min(d, G.speed * dt * (1 + (G.magnet - d) / G.magnet));
        L.x += dx / d * v; L.y += dy / d * v; if (L.rest) L.h = host.elev(L.x, L.y);
      }
    }
  }

  // ---------------------------------------------------------------- the old miner's camp: a crate (it stands in the way) and the pick
  let crate = null, pickEnt = null;
  const took = () => !!store()?.took;
  function campIn() {
    if (crate || !C?.camp) return;
    const m = C.camp, tx = m.ny, ty = -m.nx, z = host.elev(m.x, m.y);   // (tx, ty: along the wall)
    crate = {kind: 'minecrate', x: m.x - tx * .75, y: m.y - ty * .75, z: host.elev(m.x - tx * .75, m.y - ty * .75), r: .32};
    host.entities.add(crate);
    if (!took()) { pickEnt = {kind: 'minepick', x: m.x, y: m.y, z, r: 0, interact: 'minepick'}; host.entities.add(pickEnt); }
  }
  function campOut() {
    if (crate) host.entities.remove(crate); if (pickEnt) host.entities.remove(pickEnt);
    crate = pickEnt = null;
  }
  function takePick() {
    const s = store(); if (!s || s.took) return false;
    const P = host.player;
    if (pack()?.give('pick', 1, {x: P.x, y: P.y, h: P.z + 1.8}) > 0) { ui()?.float(P.x, P.y, P.z + 2, 'no room in the bag', '#e8a070'); return true; }
    s.took = 1; pack()?.dirty();
    if (pickEnt) { host.entities.remove(pickEnt); pickEnt = null; }
    host.events.push({type: 'mine.take', x: P.x, y: P.y}); ver++;
    return true;
  }

  // ---------------------------------------------------------------- the tool's asks: is a press the pick's, where a swing goes
  function wantTool() {
    if (!active() || host.lock) return '';
    const P = host.player; if (P.state === 'draw' || host.aim?.()?.target) return '';
    const i = veinUnderCursor(), cr = i < 0 ? crystalUnderCursor() : null; if (i < 0 && !cr) return '';
    const b = pack()?.best('mine');
    if (!b) {
      if (clockT - noteT > 1.5 && i >= 0) { noteT = clockT; const a = hitAt(V[i]); ui()?.float(a.x, a.y, a.h + .8, 'needs a pick', '#e8a070'); }
      return '';
    }
    byE = false; return b.id;
  }
  const keepOn = (x, y, r) => { PT.x = x; PT.y = y; PT.keep = r + W.keep; PT.far = r + W.reach + .1; return PT; };
  function aimPoint() {
    const t = host.PL.tool, P = host.player;
    PT.keep = PT.far = 0;
    if (lockI >= 0 && t?.S.held && !spent.has(lockI) && Math.hypot(V[lockI].x - P.x, V[lockI].y - P.y) < LOCK_M) return keepOn(V[lockI].x, V[lockI].y, VEIN_R);
    if (lockC && t?.S.held && !lockC.broken && Math.hypot(lockC.x - P.x, lockC.y - P.y) < LOCK_M) return keepOn(lockC.x, lockC.y, .4);
    lockI = -1; lockC = null;
    const i = byE ? (veinAhead() >= 0 ? veinAhead() : veinUnderCursor()) : (veinUnderCursor() >= 0 ? veinUnderCursor() : veinAhead());
    if (i >= 0) { lockI = i; return keepOn(V[i].x, V[i].y, VEIN_R); }
    const f = P.faceAngle, cr = byE ? crystalNear(P.x, P.y, P.z, W.reach + .5, Math.sin(f), Math.cos(f)) : crystalUnderCursor() || crystalNear(P.x, P.y, P.z, W.reach + .5, Math.sin(f), Math.cos(f));
    if (cr) { lockC = cr; return keepOn(cr.x, cr.y, .4); }
    PT.x = P.x + Math.sin(f) * 2; PT.y = P.y + Math.cos(f) * 2; return PT;
  }

  // co-op: the server's word on a vein ({k: 'world', id: 'v' + i, s: struck | spent | grown, left, by, got, late})
  function mail(m) {
    if (m.k !== 'world' || typeof m.id !== 'string' || m.id[0] !== 'v') return;
    const i = +m.id.slice(1); if (!V[i]) return;
    if (m.s === 'struck') {
      if (!spent.has(i)) { left.set(i, Math.max(.001, +m.left || .001)); ver++; }
      if (!m.late && m.by !== coop().net?.id) { const a = hitAt(V[i]); host.events.push({type: 'mine.hit', x: a.x, y: a.y, h: a.h, i, kind: V[i].kind, k: stageOf(i), rhythm: false, dx: 0, dy: -1, other: true, hollow: !!VEINS[V[i].kind].hollow}); }
    } else if (m.s === 'spent') {
      if (spent.has(i)) return;
      if (m.late) { left.delete(i); spent.set(i, 1); plugOut(i); ver++; return; }
      const n = (m.got && m.got[coop().net?.id]) | 0;
      spend(i, n, n > 0);
    } else if (m.s === 'grown' && spent.has(i)) grow(i);
  }

  // ---------------------------------------------------------------- the view: the veins (a mesh each, by stage), the camp, chunks, sparks
  // A vein's shape in its own frame: x along the wall, y up from the floor, z out of the rock into the open. Lumps of ore half
  // out of the rock (their places drawn from the vein's own generator: every client draws the same vein), cracks across them
  // as its blows run out (stages 1-3: some lumps gone), a dark scar and rubble when it's spent (4)
  const ORE = {stone: ['quartz', 'stone', 'quartz'], copper: ['copper', 'rust', 'copper', 'rock'], iron: ['ironore', 'ironore', 'rust'], night: ['plumage', 'plumage', 'rock']};
  const GEO = new Map();   // i * 8 + stage -> geometry
  function veinGeo(i, st) {
    const k = i * 8 + st; let g = GEO.get(k); if (g) return g;
    const v = V[i], Q = mulberry32(((C?.seed ?? 0) ^ (i * 2654435761)) >>> 0), fams = ORE[v.kind] || ORE.stone, parts = [];
    if (v.kind === 'hollow') { g = geoOf(plugParts(Q, st)); GEO.set(k, g); return g; }
    // the seam: a slanting streak up the wall (its ends a, b), the lumps along it
    const a0 = (Q() - .5) * .3, sl = Q() < .5 ? -1 : 1, ax = -.42 * sl + a0, ay = .3 + Q() * .15, bx = .42 * sl + a0, by = 1.15 + Q() * .3;
    const seam = (t, j) => [ax + (bx - ax) * t + (Q() - .5) * j, ay + (by - ay) * t + (Q() - .5) * j];
    if (st === 4) {   // spent: a shallow dark hollow along the seam, rubble at its foot
      for (let r = 0; r < 4; r++) { const [x, y] = seam((r + .5) / 4, .12), s = .16 + Q() * .1; parts.push(box('char', [s, s * .8, .04], [x, y, .01], [0, 0, Q() * 3])); }
      for (let r = 0; r < 4; r++) parts.push(box(fams[r % fams.length] === 'rock' ? 'rock' : 'stone', [.08 + Q() * .07, .06 + Q() * .04, .08 + Q() * .07], [(Q() - .5) * .8, .04, .14 + Q() * .25], [Q(), Q() * 3, Q()]));
    } else {
      const n = v.kind === 'stone' ? 8 : 9, gone = st === 3 ? 4 : st === 2 ? 2 : 0;
      for (let r = 0; r < n; r++) {
        const [x, y] = seam(r / (n - 1), .16), s = (v.kind === 'stone' ? .16 : .13) + Q() * .12, z = .07 + Q() * .08, f = fams[Math.floor(Q() * fams.length)], rot = [Q() * 3, Q() * 3, Q() * 3];
        if ((r * 7 + i) % n < gone) continue;   // (stages: lumps knocked out along the seam)
        parts.push(box(f, [s, s * (.7 + Q() * .5), s], [x, y, z], rot, {bias: f === 'rock' ? 0 : .1}));
      }
      if (v.kind === 'night') for (let r = 0; r < 26 - gone * 4; r++) {   // the night sky in it: specks that light themselves (paleglow)
        const [x, y] = seam(Q(), .5), s = .025 + Q() * .03;
        parts.push(box('paleglow', [s, s, s], [x, y, .17 + Q() * .04], [Q(), Q(), Q()], {fixed: 0}));
      }
      for (let r = 0; r < st; r++) {   // the cracks: dark strokes across the seam
        const [x, y] = seam(.2 + Q() * .6, .1), a = Math.atan2(by - ay, bx - ax) + Math.PI / 2 + (Q() - .5) * .8;
        parts.push(box('crack', [.45 + Q() * .2, .03, .05], [x, y, .13], [0, 0, a]));
      }
    }
    g = geoOf(parts); GEO.set(k, g); return g;
  }
  // a hollow wall's plug: rubble stacked into the neck (x across it, up to the wall's height), cracking as its blows run out;
  // caved in (4): a heap of it on the floor, spilling out of the neck into the chamber
  function plugParts(Q, st) {
    const parts = [], H = C?.wall || 3.4;
    if (st === 4) {
      for (let r = 0; r < 22; r++) { const s = .08 + Q() * .14; parts.push(box(r % 3 ? 'rock' : 'stone', [s * 1.3, s * .7, s], [(Q() - .5) * 1.8, s * .3, -.6 + Q() * 1.4], [Q(), Q() * 3, Q()])); }
      return parts;
    }
    const gone = st === 3 ? 7 : st === 2 ? 3 : st === 1 ? 1 : 0;
    for (let y = 0, r = 0; y < H; r++) {
      const s = .32 + Q() * .2;
      for (let x = -1.05; x < 1.05; r++) {
        const w = .35 + Q() * .25;
        if (!(y < 1.5 && (r * 5 + 3) % 17 < gone)) parts.push(box(Q() < .7 ? 'rock' : 'stone', [w, s, .5 + Q() * .3], [x + w / 2, y + s / 2, -.35 - Q() * .25], [(Q() - .5) * .3, (Q() - .5) * .3, (Q() - .5) * .4]));
        x += w * .9;
      }
      y += s * .85;
    }
    for (let r = 0; r < st * 2; r++) parts.push(box('crack', [.5 + Q() * .3, .035, .05], [(Q() - .5) * 1.2, .3 + Q() * 1.2, -.08], [0, 0, (Q() - .5) * 2]));
    return parts;
  }
  // the LID over a sealed room: a block of the dark filling it from the floor to over the walls' tops, until it opens (the camera
  // looks down over the chamber's wall into the room behind it: a lid at the walls' height alone would leave its floor showing)
  const lids = new Map();   // vein -> mesh
  function syncLids() {
    if (!C?.hollows || !host.world?.mesh) return;
    for (const h of C.hollows) {
      const open = spent.has(h.vein); let m = lids.get(h.vein);
      if (!m && !open) {
        const R = h.r + .9, L = Math.hypot(h.cx - h.x, h.cy - h.y) + R - .6, H = (C.wall || 3.4) + .4;
        const geo = geoOf([box('char', [2 * R, H + .1, L], [0, H / 2 - .1, -L / 2 - .6], [0, 0, 0], {fixed: 0})]);
        m = host.world.mesh(geo, veinMatrix(V[h.vein], MX), {static: true}); lids.set(h.vein, m);
      }
      if (m) m.setVisible(!open);
    }
  }
  const MV = new Map();   // vein -> {m, st, show}
  const MX = new THREE.Matrix4(), BX = new THREE.Vector3(), BY = new THREE.Vector3(0, 1, 0), BZ = new THREE.Vector3();
  function veinMatrix(v, out) {   // its frame: x along the wall (right-handed with up and out), at the wall's foot
    BZ.set(v.nx, 0, v.ny); BX.set(v.ny, 0, -v.nx);
    return out.makeBasis(BX, BY, BZ).setPosition(v.x, floorAt(v), v.y);
  }
  let seenVer = -1, yaw0 = NaN, hidVer = 0, hidSeen = -1;
  function syncVeins() {
    if (!C || !host.world?.mesh || !active()) return;   // (the cave's veins are the forest's: not in another biome's world)
    if (ver !== seenVer) {
      seenVer = ver;
      for (let i = 0; i < V.length; i++) {
        const st = stageOf(i); let o = MV.get(i);
        if (!o) { o = {m: host.world.mesh(veinGeo(i, st), veinMatrix(V[i], MX), {static: true}), st, show: true}; MV.set(i, o); }
        else if (o.st !== st) { o.st = st; o.m.setGeometry(veinGeo(i, st)); }
      }
    }
    const yaw = host.yaw ?? 0;
    if (yaw !== yaw0 || hidVer !== hidSeen) {   // the walls facing away from the camera are cut low (world/cave3d.js): their veins go with them
      yaw0 = yaw; hidSeen = hidVer; const cx = Math.sin(yaw), cz = Math.cos(yaw);
      for (const [i, o] of MV) { const s = V[i].nx * cx + V[i].ny * cz > SHOW && !HID[i]; if (s !== o.show) { o.show = s; o.m.setVisible(s); } }
    }
    // the night veins' specks: a slow twinkle (the paleglow family lights itself on their meshes alone)
    const gf = FAMS.indexOf('paleglow');
    for (const i of NIGHT) { const o = MV.get(i); if (o?.show && !spent.has(i)) o.m.setGlow(0, gf, 1.1 + .5 * Math.sin(clockT * 2.3 + i * 1.7)); }
  }
  // the camp: the crate (its lid fallen in), the candle stub on it, the heap of chipped stone, the pick driven into the wall
  let campM = null, pickM = null, campGeo = null, pickGeo = null;
  function campFrame(out) {
    const m = C.camp; BZ.set(m.nx, 0, m.ny); BX.set(m.ny, 0, -m.nx);
    return out.makeBasis(BX, BY, BZ).setPosition(m.x, host.elev(m.x, m.y), m.y);
  }
  function syncCamp() {
    if (!C?.camp || !host.world?.mesh) return;
    if (!campM) {
      campGeo ??= geoOf([
        box('wood', [.62, .38, .46], [-.75, .19, 0], [0, .12, 0]),
        box('wood', [.66, .04, .26], [-.72, .4, .14], [.18, .12, .1]),       // a board of the lid, sagging
        box('char', [.6, .02, .4], [-.75, .385, -.02], [0, .12, 0]),         // the dark inside
        {...along([-.62, .39, .05], [-.62, .45, .05], .028, .024, 6), fam: 'mushwhite'},   // the candle stub
        {...along([-.62, .45, .05], [-.62, .47, .05], .006, .004, 4), fam: 'char', fixed: 0},
        ...[[.55, .06, -.45, .1], [.7, .05, -.3, .09], [.45, .05, -.25, .08], [.62, .14, -.38, .08], [.8, .04, -.5, .07], [.36, .04, -.48, .07]]
          .map(([x, y, z, r], q) => box(q % 3 ? 'stone' : 'rock', [r * 2, r * 1.6, r * 2], [x, y, z], [q, q * 2, q * .7])),
      ]);
      pickGeo ??= geoOf([   // the old pick: its head in the rock at the wall (z -.9), the haft out and down into the room
        {...along([.1, 1.12, -.82], [.1, .5, -.28], .02, .018, 6), fam: 'wood'},
        box('rust', [.05, .06, .2], [.1, 1.15, -.86], [.35, 0, 0]),
        box('rust', [.04, .22, .05], [.1, 1.02, -.84], [.35, 0, 0]),
      ]);
      campM = host.world.mesh(campGeo, campFrame(MX), {static: true});
      pickM = host.world.mesh(pickGeo, campFrame(MX), {static: true});
    }
    pickM.setVisible(!took());
  }
  // chunks: a lump each, spun as it rolls
  const CHG = {};
  const chunkGeo = item => CHG[item] ??= geoOf(item === 'glow_shard'
    ? [box('gem', [.05, .14, .05], [0, .07, 0], [.2, 0, .3]), box('gem', [.04, .09, .04], [.04, .045, .02], [-.3, 0, -.2])]
    : item === 'tally_stick' ? [{...along([-.16, .03, 0], [.16, .03, .02], .018, .016, 5), fam: 'deadwood'}, ...[-.1, -.05, 0, .05, .1].map(x => box('char', [.012, .04, .04], [x, .035, .006]))]
    : item === 'big_tooth' ? [{...along([0, .02, -.06], [0, .05, .08], .035, .012, 6), fam: 'eye'}, box('antler', [.06, .04, .05], [0, .02, -.07])]
    : item === 'night_ore' ? [box('plumage', [.13, .1, .12], [0, .05, 0], [.3, .5, .2]), box('rock', [.08, .07, .08], [.05, .07, .03], [.6, .2, .4]),
      box('paleglow', [.025, .025, .025], [-.03, .1, .05], [.4, .2, 0]), box('paleglow', [.02, .02, .02], [.04, .09, -.05], [.1, .7, 0])]
    : [box(item === 'copper_ore' ? 'copper' : item === 'iron_ore' ? 'ironore' : 'stone', [.13, .1, .12], [0, .05, 0], [.3, .5, .2]),
      box(item === 'copper_ore' ? 'rust' : 'rock', [.08, .07, .08], [.05, .07, .03], [.6, .2, .4])]);
  const chunkMesh = new Map(), QY = new THREE.Quaternion(), V3 = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1), UPV = new THREE.Vector3(0, 1, 0);
  function syncChunks() {
    for (const [L, m] of chunkMesh) if (L.dead || !chunks.includes(L)) { m.dispose(); chunkMesh.delete(L); }
    for (let i = 0; i < chunks.length; i++) {
      const L = chunks[i]; let m = chunkMesh.get(L);
      if (!m) { m = host.world.mesh(chunkGeo(L.item), new THREE.Matrix4()); chunkMesh.set(L, m); if (L.item === 'night_ore') m.setGlow(0, FAMS.indexOf('paleglow'), 1.2); }
      m.setMatrix(MX.compose(V3.set(L.x, L.h, L.y), QY.setFromAxisAngle(UPV, L.yaw), SC));
    }
  }
  // sparks and grit off a blow (back toward him, brighter on a rhythm blow), dust when a vein breaks open
  const SP = [];
  function sparks(e) {
    const K = VEINS[e.kind], col = e.kind === 'crystal' ? ['#eaffd8', '#8aff6a'] : K?.col || ['#b8b2a6', '#8c867a'];
    const n = e.k === 0 ? 4 : (e.rhythm ? 16 : 9);
    for (let i = 0; i < n && SP.length < 200; i++) {
      const a = Math.atan2(-e.dy, -e.dx) + (VR() - .5) * 2.2, v = 1 + VR() * 2.6, spark = i < (e.k === 0 ? 4 : e.rhythm ? 7 : 3);
      SP.push({x: e.x, y: e.y, h: e.h + (VR() - .5) * .3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: .6 + VR() * 2, t: 0, life: spark ? .18 + VR() * .2 : .45 + VR() * .4,
        col: spark ? (VR() < .5 ? '#fff4c8' : '#ffc860') : col[VR() < .6 ? 0 : 1], g: spark ? 4 : 9});
    }
  }
  function dust(x, y, h, n) {
    for (let i = 0; i < n && SP.length < 200; i++) {
      const a = VR() * Math.PI * 2, r = VR() * .4;
      SP.push({x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, h: h + VR() * .8, vx: Math.cos(a) * .4, vy: Math.sin(a) * .4, vh: .2 + VR() * .5, t: 0, life: .7 + VR() * .6, col: VR() < .5 ? '#a89a80' : '#8a7c66', g: -.2});
    }
  }

  const F = {
    name: 'mining', label: 'Mining', on: ON,
    get left() { return left; }, get spent() { return spent; }, get chunks() { return chunks; }, get veins() { return V; }, get lids() { return lids; },   // (tests, dev)
    veinNear, veinAhead, aimPoint,
    update(dt, evs) {
      clockT += dt;
      if (!ON) return;
      index();
      const on = active();
      if (on !== was) { was = on; ver++; if (on) campIn(); else { campOut(); plugsOut(); for (const L of chunks) L.dead = true; chunks.length = 0; lockI = -1; lockC = null; } }
      if (!on) return;
      const ol = online();
      if (ol !== wasOnline || !restored) { wasOnline = ol; if (ol) { restored = true; spent.clear(); left.clear(); ver++; } else restore(); plugsOut(); }   // (online: the server's word comes in its welcome)
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'player.chop') blow(e);
        else if (e.type === 'pack.reset') { if (!ol) { spent.clear(); left.clear(); ver++; } campOut(); campIn(); }
      }
      const c = coop(); if (ol && c.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
      plugsIn(); dark();
      const t = T(); if (t && !aimSet) { t.aimBy(aimPoint, 'mine'); t.wantBy(wantTool, 'mine'); aimSet = true; }
      if (byE && t && !host.keys.has('e')) { byE = false; t.release(); }
      if ((lockI >= 0 || lockC) && !t?.S.held) { lockI = -1; lockC = null; }
      const slot = t?.S.on && t.S.job === 'mine' ? pack()?.best('mine')?.slot ?? -1 : -1;
      if (slot !== heldSlot) { heldSlot = slot; if (slot >= 0 || !t?.S.on) pack()?.held(slot); }   // (the pack panel marks the pick in hand)
      stepChunks(dt);
      if ((growT += dt) >= 1) {   // regrowth (offline: the world clock; the server's in co-op), once a second
        growT = 0;
        if (!ol && spent.size) { const h = host.env?.t ?? 0; for (const [i, at] of spent) if (h >= at) grow(i); }
      }
    },
    view(dt, evs) {
      if (!ON) return;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'mine.hit') sparks(e);
        else if (e.type === 'mine.spent') { dust(e.x + V[e.i].nx * .3, e.y + V[e.i].ny * .3, floorAt(V[e.i]) + .2, 16); host.shake(2, .15); }
      }
      syncVeins(); if (active()) { syncCamp(); syncLids(); } else { if (pickM) pickM.setVisible(false); for (const m of lids.values()) m.setVisible(false); }
      syncChunks();
      for (let i = SP.length - 1; i >= 0; i--) {
        const c = SP[i]; c.t += dt; if (c.t > c.life) { SP.splice(i, 1); continue; }
        c.vh -= c.g * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.h += c.vh * dt;
        const g = host.elev(c.x, c.y); if (c.h < g) { c.h = g; c.vx *= .3; c.vy *= .3; c.vh = 0; }
      }
    },
    frame() {
      for (let i = 0; i < SP.length; i++) { const c = SP[i]; host.point(c.x, c.y, c.h, c.col); }
      if (!marks || !active()) return;   // ?gathermarks=1: a dot over each vein (red: spent, grey: too hard for his pick)
      const P = host.player, b = pack()?.best('mine');
      for (let i = 0; i < V.length; i++) { const v = V[i]; if (Math.abs(v.x - P.x) > 16 || Math.abs(v.y - P.y) > 12) continue; host.point(v.x + v.nx * .1, v.y + v.ny * .1, floorAt(v) + 1.7, spent.has(i) ? '#e2644d' : (b?.def.tool.tier || 1) < VEINS[v.kind].tier ? '#9a9a9a' : v.kind === 'night' ? (HID[i] ? '#6a5aa0' : '#c8d0ff') : v.kind === 'hollow' ? '#c09a6a' : '#e8c060'); }
    },
    onKey(k) {
      const t = T(); if (!t || k !== 'e' || !active() || host.lock || host.PL.nearInteract?.() || host.BUSY.has(host.player.state)) return false;   // (the camp's pick, a chest, a fire: E is theirs)
      const P = host.player, f = P.faceAngle;
      if (veinAhead() < 0 && !crystalNear(P.x, P.y, P.z, W.reach + .5, Math.sin(f), Math.cos(f))) return false;
      const b = pack()?.best('mine');
      if (!b) { if (veinAhead() >= 0) { ui()?.float(P.x, P.y, P.z + 2, 'needs a pick', '#e8a070'); return true; } return false; }
      byE = true; lockI = -1; lockC = null; t.use(b.id); return true;
    },
    interact(p) { return p.interact === 'minepick' ? takePick() : false; },
    prompt(p) { return p.interact === 'minepick' ? {text: 'E  take the pick', color: '#f2d27a'} : null; },
    hd(q, sc) {   // the prompt over the vein a press would dig (the pixel look: ui/hdpixel.js)
      const t = T(); if (!t || !active() || host.lock || host.hudOff || host.playerHidden || pack()?.open || host.PL.nearInteract?.() || host.BUSY.has(host.player.state) || t.S.mode) return;
      let i = veinUnderCursor(); if (i < 0) i = veinAhead(); if (i < 0) return;
      const b = pack()?.best('mine'), weak = !b || (b.def.tool.tier || 1) + cracked(i) < VEINS[V[i].kind].tier;
      const text = !b ? 'needs a pick' : weak ? weakWords(i) : 'E mine', a = hitAt(V[i]), s = host.G.toScreen(a.x, a.h + .9, a.y);
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, text, s[0] * sc, s[1] * sc, hdUnit(), weak ? '#e8a070' : '#f2d27a');
      q.restore();
    },
    menu() {
      if (!ON || game()?.mode !== 'sandbox') return [];
      return [
        {label: `Mining: marks on the veins ${marks ? '(on)' : '(off)'}`, run: () => { marks = !marks; }},
        {label: 'Mining: every vein back (offline)', run: () => { if (!online()) for (const i of [...spent.keys()]) grow(i); }},
        {label: 'Mining: the old pick back at the camp', run: () => { const s = store(); if (s) { s.took = 0; pack()?.dirty(); } campOut(); if (active()) campIn(); ver++; }},
        {label: 'Mining: to the miner\'s camp', run: () => { if (C?.camp) host.teleport(C.camp.x + C.camp.nx * .6, C.camp.y + C.camp.ny * .6); }},
        {label: 'Mining: open the hollow walls (offline)', run: () => { if (!online()) for (const h of C?.hollows || []) if (!spent.has(h.vein)) spend(h.vein, 0, false); }},
        {label: 'Mining: to a hollow wall', run: () => { const h = C?.hollows?.[hopT++ % (C.hollows.length || 1)]; if (h) host.teleport(h.x + h.nx * 1.2, h.y + h.ny * 1.2); }},
        {label: 'Mining: to a night vein', run: () => { const i = NIGHT[hopN++ % (NIGHT.length || 1)]; if (i !== undefined) host.teleport(V[i].x + V[i].nx * 1.2, V[i].y + V[i].ny * 1.2); }},
      ];
    },
    hud: () => active() ? `mining veins ${V.length} · spent ${spent.size} · struck ${left.size} · chunks ${chunks.length}${NIGHT.length ? ' · night ' + NIGHT.map(i => HID[i] ? 'hid' : 'shows').join(' ') : ''}${T()?.S.job === 'mine' ? ' · pick out' : ''}` : '',
    shown: i => !HID[i], isSpent: i => spent.has(i),
    biomeChanged() {   // (the rebuild disposed the world's meshes: ours are made again)
      MV.clear(); campM = pickM = null; chunkMesh.clear(); lids.clear(); seenVer = -1; yaw0 = NaN;
    },
  };
  return F;
}
