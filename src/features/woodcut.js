// WOODCUT: felling trees with an axe in the persistent world (docs/GATHERING.md). No key takes the axe out: an axe in the bag
// (features/pack.js best('chop')) is what it takes, and LMB on a trunk (the cursor on it, within the lock's reach; not with a foe
// under the cursor or the gun drawn) or E held facing one chops it: the axe comes out, he walks in if he must, swings while the
// press is held (sim/player/tool.js: player.chop at the blow), and puts the axe back a moment after the last swing. A blow meets the nearest trunk in its arc: a BITE (chips; the crown shudders and drops a few leaves: wind.js on
// tree.chop; Woodcutting XP) or, an axe too poor for that wood (an old oak), a GLANCE. The last bite FELLS the tree: the standing
// prop is hidden (the registry), a STUMP prop takes its place (a collider; arrows stop at its top), the tree's own model tips
// over the cut, slowly and then fast, and crashes down at a fixed sim time (tree.land), and a moment later it breaks into LOGS
// on the ground (tree.logs), which come to the player and go in his pouch. The stump grows back into the tree after
// TUNE.regrow.hours of the world clock, out of his way (farther than TUNE.regrow.far). What is felled is saved
// (pack.store('woodcut')): a reload finds the stumps where they were.
//   Sim: the trees' chop counts, the felled set, the stump props, the logs (the feature's own list, not props), the regrowth.
//   View: the falling trees (copies of their own models: world.mesh {sway, autumn}), the stumps' and logs' meshes, the chips.
// CO-OP (features/coop.js, docs/MULTIPLAYER.md): a tree of the seeded forest (it has a fid) is a shared tree. The last bite ASKS the
// server (coop.act('fell')) instead of felling it; when the server says it fell (to everyone, a late joiner too) coop hands it to
// fellShared: the same fall, stump and logs on every client, the XP to who felled it. Shared trees don't grow back while in co-op
// (the server keeps them felled). Without co-op nothing changes.
// Only in the sandbox on the ruins biome (the Proving Grounds and the West Downs: the persistent world), with a live loadout
// (the cowboys hold the axe: view/heldtool.js). ?woodcut=0 off.
// OWNS: the chop counts, the felled set and its saved part, the stump props, the logs, their meshes, the falls, the chips.
// READS: host.PL.tool, host.entities (query 'woodcut.tree', near), host.itemOf (a tree's model: species, scale, bones, crown),
//   host.env.t (the world clock), pack (the tool, XP, the pouch), combat's core (a blow that meets a foe or a dummy).
// EMITS: tree.chop, tree.fell, tree.land, tree.logs, tree.grow, tool.hit, tool.whiff.
// BUDGET: sim: a near() query a blow (and one a step while a swing waits for its aim); the logs (a handful) a step; the
//   regrowth check once a second over the felled set. View: a falling tree's matrix a frame; logs' matrices while they move.
import * as THREE from 'three';
import {TUNE, TREES} from '../content/woodcut.js';
import {ITEMS} from '../content/items.js';
import {XP} from '../content/skills.js';
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {mulberry32, simSeed, viewRandom} from '../core/rng.js';
import {propTop, FAMS} from '../world/world.js';
import {setMaterials} from '../content/materials.js';
import {geoOf, along} from '../world/kit3d.js';

const ON = flags.get('woodcut') !== '0';
const W = TUNE.swing, DEG = Math.PI / 180;
const LAND_T = 1.5, LOGS_T = 2.6;   // s after the fell: the crown hits the ground, the trunk breaks into logs (the view's fall keeps to them)
propTop({stump: TUNE.stump.h});
setMaterials({stump: 'wood'});

// ORDER (core/features.js): before the fists (2 raises them: the axe goes away first), brawl and the gun (LMB, RMB and R are the
// tool's while it's out)
export const order = {before: ['fists', 'brawl', 'gun']};

export async function create(host) {
  // (the sim's generator seeded at its first draw, not at load: a draw from Math.random here shifts every later one, and the
  // golden tour's seeded frames with them)
  let rng = null; const R = () => (rng ??= mulberry32(simSeed()))(), VR = viewRandom('woodcut');
  const NEAR = [], PT = {x: 0, y: 0, keep: 0, far: 0};
  const pack = () => host.feature('pack');
  const game = () => host.feature('game');
  const ui = () => game()?.ui || null;
  const core = () => host.feature('combat')?.core || null;
  const T = () => host.live ? host.PL.tool : null;
  const trees = host.entities.query('woodcut.tree', p => p.kind === 'tree' && !p.outside);
  const active = () => ON && host.live && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const keyOf = p => p.x.toFixed(2) + ',' + p.y.toFixed(2);
  const store = () => { const s = pack()?.store('woodcut'); if (s) s.felled ??= {}; return s; };

  // ---------------------------------------------------------------- a tree as the axe sees it (its model: world.js item.pose)
  // {species, def (TREES), s (scale), cut (m up the model where it's cut: the trunk's second bone's end), tr (the trunk's
  // radius at the cut, m), hp, tier (the axe it asks for), logs, it, pose} | null (not one to fell: rigid, painted, unknown)
  const INFO = new WeakMap();
  function infoOf(p) {
    const it = host.itemOf(p), ps = it?.pose; if (!ps || ps.rigid) return null;
    let I = INFO.get(it); if (I !== undefined) return I;
    const def = TREES[ps.species];
    if (!def) I = null;
    else {
      const b = ps.bones || [], s = ps.scale || 1, cut = b.length > 1 && b[1][4] > .2 && b[1][4] < .9 ? b[1][4] : .4;
      I = {species: ps.species, def, s, cut, tr: (b[1] ? b[1][6] : .2) * s, hp: Math.max(2, Math.round(def.hp * s ** 1.5)),
        tier: def.tier + (def.old && s >= def.old ? 1 : 0), logs: Math.max(1, Math.round(def.logs * s)), it, pose: ps};
    }
    INFO.set(it, I); return I;
  }

  // ---------------------------------------------------------------- the sim's state
  const hp = new Map();       // tree -> blows left (a fresh tree has none: its full count)
  const asked = new Map();    // co-op: a shared tree whose fell was asked of the server -> when (clockT): asked again after 3 s (a refusal)
  const shared = p => typeof p.fid === 'string' && !!host.feature('coop')?.online;
  const felled = new Map();   // tree -> {key, at (env.t it grows back), stump (its prop)}
  const falls = [];           // {p, I, t, dx, dy (the way it falls), landed}
  const logs = [];            // {x, y, h, vx, vy, vh, t, rest, yaw, spin, dead}
  let was = false, tick = 0, appliedN = -1, ver = 0, noteT = -9, clockT = 0, aimSet = false, byE = false, heldSlot = -1;
  // a press (LMB) is the axe's when the cursor is on a trunk within the lock's reach, nothing hostile is under the cursor, the gun
  // isn't drawn and there's an axe in the bag -> its id | '' (the gun's then). Called from the input, between steps
  function wantTool() {
    if (!active() || host.lock) return '';
    const P = host.player; if (P.state === 'draw' || host.aim?.()?.target) return '';
    const tree = trunkUnderCursor(P); if (!tree) return '';
    const b = pack()?.best('chop');
    if (!b) { if (clockT - noteT > 1.5) { noteT = clockT; ui()?.float(tree.x, tree.y, (tree.z || 0) + 1.8, 'needs an axe', '#e8a070'); } return ''; }
    byE = false; return b.id;
  }

  function fellNow(p, I, at) {   // hidden, its stump standing (no fall: a saved one, or the fell's sim side)
    if (felled.has(p)) return;
    host.entities.hide(p, true);
    const st = {kind: 'stump', x: p.x, y: p.y, z: p.z || 0, r: clamp(I.tr * 1.35, .2, .5), tree: p};
    host.entities.add(st);
    felled.set(p, {key: keyOf(p), at, stump: st}); ver++;
  }
  function grow(p, quiet = false) {
    const f = felled.get(p); if (!f) return;
    host.entities.remove(f.stump); host.entities.hide(p, false); felled.delete(p); hp.delete(p); ver++;
    const s = store(); if (s && !quiet) { delete s.felled[f.key]; pack()?.dirty(); }
    if (!quiet) host.events.push({type: 'tree.grow', x: p.x, y: p.y, who: p});
  }
  // the saved felled set onto the world (on entering the persistent world; again when trees joined since: the garden's oaks)
  function apply() {
    const s = store(); appliedN = trees.length; if (!s) return;
    const byKey = new Map(); for (const p of trees) byKey.set(keyOf(p), p);
    for (const k in s.felled) { const p = byKey.get(k), I = p && infoOf(p); if (I) fellNow(p, I, s.felled[k]); }
  }
  // leaving it (another biome, a run, the title): the trees stand again (the save keeps them felled); logs on the ground go in
  // the pouch, a fall in progress ends
  function unapply() {
    for (const p of [...felled.keys()]) grow(p, true);
    falls.length = 0; hp.clear();
    let n = 0; for (const L of logs) if (!L.dead) { L.dead = true; n++; } logs.length = 0;
    if (n) pack()?.give('log', n);
    const t = T(); if (t?.on) { t.put(); pack()?.held(-1); heldSlot = -1; }
  }
  function reset() {   // a new world (pack.reset): every tree back, no logs
    for (const p of [...felled.keys()]) grow(p, true);
    falls.length = 0; hp.clear(); for (const L of logs) L.dead = true; logs.length = 0;
  }

  // ---------------------------------------------------------------- the swing's aim -> PT (world). A trunk in reach under the
  // cursor (its trunk, foot to TRUNK_H m up: pointing at a tree points at its trunk,
  // whose ground point lies under another part of the screen), else the tree right in front of him (treeAhead), else the
  // nearest trunk / foe / dummy in reach within W.snap deg of the cursor's way on the ground, else that way 2 m out. A trunk
  // once swung at is LOCKED while LMB stays down (he faces it as he steps round it: sim/player/tool.js footwork), till it
  // falls or he is LOCK_M m off
  // (the cursor as the sim reads it, the gun's aim's way (player.js cursorGround / pickGround): a line through the world, its
  // ground point g (his view frame); a point h m higher on it lies (h - ground) PPMH / PPMY m further toward the camera. A
  // trunk is under the cursor where that line passes within its radius + .25 m between its foot and TRUNK_H m up)
  const LOCK_M = 3.5, TRUNK_H = 2.2;
  let lock = null;
  function trunkUnderCursor(P) {
    const gv = host.PL.cursorGround?.(); if (!gv) return null;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw), gx = gv.x * c + gv.y * s, gy = -gv.x * s + gv.y * c, hg = host.elev(gx, gy), k = host.PPMY / host.PPMH;
    let best = null, bd = 9;
    for (const p of host.entities.near(P.x, P.y, LOCK_M, NEAR)) {   // (as far as a lock holds: one out of reach he walks in to)
      if (p.kind !== 'tree' || p.gone || p.outside || Math.abs((p.z || 0) - P.z) > 1) continue;
      const I = infoOf(p); if (!I) continue;
      const vx = p.x * c - p.y * s, vy = p.x * s + p.y * c, h = hg + (vy - gv.y) * k, z = p.z || 0;   // (the line's height over the trunk's row)
      const dx = Math.abs(vx - gv.x); if (dx > I.tr + .25 || h < z - .2 || h > z + TRUNK_H) continue;
      if (dx < bd) { bd = dx; best = p; }
    }
    return best;
  }
  const keepOf = p => { const I = infoOf(p); PT.keep = (I ? I.tr : .2) + W.keep; PT.far = (I ? I.tr : .2) + W.reach + .1; };   // (the sweet spot; past `far` he walks in)
  function aimPoint() {
    const T = host.PL.tool, P = host.player;
    PT.keep = PT.far = 0;
    if (lock && T?.S.held && !lock.gone && Math.hypot(lock.x - P.x, lock.y - P.y) < LOCK_M) { PT.x = lock.x; PT.y = lock.y; keepOf(lock); return PT; }
    lock = null;
    const tree = byE ? treeAhead() || trunkUnderCursor(P) : trunkUnderCursor(P) || treeAhead();   // (E: the tree he faces first)
    if (tree) { lock = tree; PT.x = tree.x; PT.y = tree.y; keepOf(tree); return PT; }
    const a = host.aim(), gv = a.target ? null : host.PL.cursorGround(), c = Math.cos(host.yaw), s = Math.sin(host.yaw);
    const ax = gv ? gv.x * c + gv.y * s : a.x, ay = gv ? -gv.x * s + gv.y * c : a.y;
    let dx = ax - P.x, dy = ay - P.y, d = Math.hypot(dx, dy);
    if (d < .1) { const f = P.faceAngle; dx = Math.sin(f); dy = Math.cos(f); d = 1; }
    dx /= d; dy /= d;
    const cs = Math.cos(W.snap * DEG); let best = null, bd = 9;
    for (const p of host.entities.near(P.x, P.y, W.reach + 1.2, NEAR)) {
      if (p.gone || p.broken) continue;
      const I = p.kind === 'tree' && !p.outside ? infoOf(p) : null;
      if (!I && !(p.hunter || p.sparring || p.target)) continue;
      const ex = p.x - P.x, ey = p.y - P.y, l = Math.hypot(ex, ey), r = I ? I.tr : p.r || .3;
      if (l < .05 || l - r > W.reach + .3 || Math.abs((p.z || 0) - P.z) > 1) continue;
      if ((ex * dx + ey * dy) / l >= (l < 1 ? cs - .35 : cs) && l < bd) { best = p; bd = l; }
    }
    if (best) { PT.x = best.x; PT.y = best.y; if (best.kind === 'tree') lock = best; } else { PT.x = P.x + dx * 2; PT.y = P.y + dy * 2; }
    return PT;
  }

  // ---------------------------------------------------------------- the blow (player.chop, world coordinates)
  function blow(e) {
    const tool = ITEMS[e.tool]?.tool; if (!tool || tool.job !== 'chop') return;
    if (lock && !lock.gone) {   // ASSIST: the locked trunk takes the blow anywhere within reach + assist of its bark (he faces it)
      const I = infoOf(lock);
      if (I && Math.hypot(lock.x - e.x, lock.y - e.y) - I.tr <= W.reach + W.assist && Math.abs((lock.z || 0) - e.z) <= 1) { chop(lock, I, e, tool); return; }
    }
    const c0 = Math.cos(W.arc / 2 * DEG);
    let best = null, bI = null, bd = 9;
    for (const p of host.entities.near(e.x, e.y, W.reach + 1, NEAR)) {   // the nearest trunk in its arc (right against one: any way)
      if (p.kind !== 'tree' || p.gone || p.outside) continue;
      const I = infoOf(p); if (!I || Math.abs((p.z || 0) - e.z) > 1) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1e-6;
      if (d - I.tr > W.reach || ((dx * e.vx + dy * e.vy) / d < c0 && d > I.tr + .2)) continue;
      if (d < bd) { bd = d; best = p; bI = I; }
    }
    if (best) { chop(best, bI, e, tool); return; }
    // a foe or a dummy in the way takes the blow (combat's damage: the axe isn't a weapon yet, one plain hit)
    const cr = core(); let hit = null, hb = false, hd = 9;
    for (const p of host.entities.near(e.x, e.y, W.reach + 1, NEAR)) {
      if (p.broken || p.gone || p.held) continue;
      const body = !!(p.hunter || p.sparring) && !p.retired && (p.kind === 'gunman' || !!cr?.BS?.has(p));
      const thing = !body && (p.hp > 0 || p.target) && (p.breakable || p.target) && !p.hunter && p.kind !== 'gunman' && !p.wall && !p.rect;
      if (!body && !thing) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1e-6, r = p.hitR ?? p.r ?? .3;
      if (d - r > W.reach || Math.abs((p.z || 0) - e.z) > 1 || (dx * e.vx + dy * e.vy) / d < c0) continue;
      if (d - r < hd) { hd = d - r; hit = p; hb = body; }
    }
    if (hit && cr) {
      cr.damage(hit, W.dmg, {canCrit: false, dir: [e.vx * 3, e.vy * 3], by: 'melee', ux: e.vx, uy: e.vy});
      host.events.push({type: 'tool.hit', x: hit.x, y: hit.y, who: hit, kind: hb ? 'body' : hit.kind});
      host.hitstop(.05); host.shake(2, .1);
    } else host.events.push({type: 'tool.whiff', x: e.x + e.vx * .8, y: e.y + e.vy * .8});
  }
  function chop(p, I, e, tool) {
    const P = host.player, d = Math.hypot(p.x - P.x, p.y - P.y) || 1, ux = (p.x - P.x) / d, uy = (p.y - P.y) / d;   // from him to the trunk
    const x = p.x - ux * I.tr, y = p.y - uy * I.tr, h = (p.z || 0) + Math.min(1.05, I.cut * I.s + .5);   // the bite: the trunk's near side, waist high
    if (tool.tier < I.tier) {   // GEAR GATES: this wood wants a better axe
      host.events.push({type: 'tree.chop', x, y, h, who: p, k: 0, left: 1, dx: ux, dy: uy});
      if (clockT - noteT > 2.5) { noteT = clockT; ui()?.float(x, y, h + .7, I.def.old && I.s >= I.def.old ? 'an old oak: it needs a better axe' : 'too hard for this axe', '#e8a070'); }
      host.hitstop(.03); host.shake(1, .06); return;
    }
    const left0 = hp.get(p) ?? I.hp, left = left0 - tool.power * (host.mods?.value('woodcut.power', 1) ?? 1);
    pack()?.gain('woodcutting', XP.chop);
    host.events.push({type: 'tree.chop', x, y, h, who: p, k: clamp(.35 + .65 * (1 - Math.max(0, left) / I.hp), .1, 1), left: Math.max(0, left), dx: ux, dy: uy});
    host.hitstop(.04); host.shake(1.5, .08);
    if (left > 1e-6) { hp.set(p, left); return; }
    if (shared(p)) {   // CO-OP: the server fells it, for everyone (fellShared)
      if (!(clockT - (asked.get(p) ?? -9) < 3)) { asked.set(p, clockT); hp.set(p, 0); host.feature('coop').act('fell', p); }
      return;
    }
    hp.delete(p); fell(p, I, ux, uy);
  }
  function fell(p, I, ux, uy, xp = true, fall = true) {
    const at = (host.env?.t ?? 0) + TUNE.regrow.hours;
    fellNow(p, I, at);
    const s = store(); if (s) { s.felled[keyOf(p)] = at; pack()?.dirty(); }
    if (fall) {
      falls.push({p, I, t: 0, dx: ux, dy: uy, landed: false});
      host.events.push({type: 'tree.fell', x: p.x, y: p.y, who: p, vx: ux, vy: uy, species: I.species, scale: I.s});
    }
    if (xp) pack()?.gain('woodcutting', Math.round(XP.fell * I.def.xp * I.s), {x: p.x, y: p.y, h: (p.z || 0) + 2.6});
  }
  // CO-OP: the server says a shared tree fell (features/coop.js, in its update: a sim step). by: who felled it (here: his XP); late: it
  // was felled before we joined (a stump, no fall). It falls away from the one who felled it if we see him, else away from us.
  // -> false when it isn't a tree the axe knows (coop removes it then)
  function fellShared(p, mine, late, fx, fy) {
    if (felled.has(p)) return true;
    const I = infoOf(p); if (!I) return false;
    asked.delete(p); hp.delete(p);
    const P = host.player, ox = fx ?? P.x, oy = fy ?? P.y, d = Math.hypot(p.x - ox, p.y - oy) || 1;
    fell(p, I, (p.x - ox) / d, (p.y - oy) / d, mine && !late, !late);
    return true;
  }
  const crownMid = I => { const C = I.pose.crown; return C ? ((C.y0 + C.y1) / 2) * I.s : 3 * I.s; };
  function stepFalls(dt) {
    for (let i = falls.length - 1; i >= 0; i--) {
      const f = falls[i]; f.t += dt;
      if (!f.landed && f.t >= LAND_T) {
        f.landed = true; const L = crownMid(f.I);
        host.events.push({type: 'tree.land', x: f.p.x + f.dx * L, y: f.p.y + f.dy * L, who: f.p, r: (f.I.pose.crown?.r || 1.3) * f.I.s});
      }
      if (f.t >= LOGS_T) { spawnLogs(f); falls.splice(i, 1); }
    }
  }
  function spawnLogs(f) {   // along the fallen trunk, popped up a little: they settle, then come to him
    const extra = host.mods?.value('woodcut.extra', 0) ?? 0, n = f.I.logs + (R() < extra ? 1 : 0);
    const len = Math.max(1.2, (f.I.pose.crown?.y0 || 2) * f.I.s * 1.05);
    for (let i = 0; i < n; i++) {
      const k = (i + .5) / n, d = .6 + k * len, side = (R() - .5) * .5;
      let x = f.p.x + f.dx * d - f.dy * side, y = f.p.y + f.dy * d + f.dx * side;
      if (host.blocked?.(x, y, host.elev(x, y))) { x = f.p.x + f.dx * .7; y = f.p.y + f.dy * .7; }   // (into a wall: by the stump)
      logs.push({x, y, h: host.elev(x, y) + .3 + R() * .3, vx: (R() - .5) * 1.2, vy: (R() - .5) * 1.2, vh: 1.6 + R() * 1.4, t: 0, rest: false,
        yaw: Math.atan2(f.dy, f.dx) + (R() - .5) * .9, spin: (R() - .5) * 9, dead: false});
    }
    const L = crownMid(f.I) * .5;
    host.events.push({type: 'tree.logs', x: f.p.x + f.dx * L, y: f.p.y + f.dy * L, who: f.p, n});
  }
  function stepLogs(dt) {
    const P = host.player, G = TUNE.log;
    for (let i = logs.length - 1; i >= 0; i--) {
      const L = logs[i]; L.t += dt;
      if (!L.rest) {
        L.vh -= 18 * dt; L.x += L.vx * dt; L.y += L.vy * dt; L.h += L.vh * dt;
        const g = host.elev(L.x, L.y);
        if (L.h <= g) { L.h = g; if (L.vh < -2.5) { L.vh *= -.25; L.vx *= .5; L.vy *= .5; L.spin *= .5; } else { L.rest = true; L.vh = L.vx = L.vy = L.spin = 0; } }
      }
      if (L.t < G.delay) continue;
      const dx = P.x - L.x, dy = P.y - L.y, d = Math.hypot(dx, dy);
      if (d < G.pick && Math.abs(P.z - L.h) < 1.2) {
        L.dead = true; logs.splice(i, 1);
        pack()?.give('log', 1, {x: P.x, y: P.y, h: P.z + 1.8}); pack()?.gain('woodcutting', XP.gather);
      } else if (d < G.magnet && Math.abs(P.z - L.h) < 1.5) {   // drawn in to him, faster as it nears
        const v = Math.min(d, G.speed * dt * (1 + (G.magnet - d) / G.magnet));
        L.x += dx / d * v; L.y += dy / d * v; if (L.rest) L.h = host.elev(L.x, L.y);
      }
    }
  }
  function regrow(dt) {
    if ((tick += dt) < 1) return; tick = 0;
    if (trees.length !== appliedN) apply();
    const P = host.player, t = host.env?.t ?? 0;
    for (const [p, f] of felled) if (t >= f.at && !shared(p) && Math.hypot(p.x - P.x, p.y - P.y) > TUNE.regrow.far && !falls.some(q => q.p === p)) grow(p);
  }

  // ---------------------------------------------------------------- the view: falls, stumps, logs, chips
  const GEOS = new WeakMap();
  // a tree's model cut at its cut: {fall (the trunk above it, the limbs, the crown: every attribute, for the swaying material),
  // stump (the trunk's foot and the roots: the plain one's)}; each with a pale end-grain cap on the cut. Per model, once
  function geosOf(I) {
    const g0 = I.pose.geo; let o = GEOS.get(g0); if (o) return o;
    const P = g0.attributes.position, b = I.pose.bones?.[1], cx = b ? b[3] : 0, cy = I.cut, cz = b ? b[5] : 0, cr = (b ? b[7] : .18) * 1.04;
    const up = [], down = [];
    for (let i = 0; i < P.count; i += 3) (P.getY(i) + P.getY(i + 1) + P.getY(i + 2) > cy * 3 ? up : down).push(i);
    const rope = Math.max(0, FAMS.indexOf('rope'));
    function part(list, names, capY) {   // the triangles of list (first corners) and a cap (a 7-sided fan facing capY's way)
      const g = new THREE.BufferGeometry(), N = list.length * 3 + 7 * 3;
      for (const nm of names) {
        const a = g0.attributes[nm]; if (!a) continue;
        const k = a.itemSize, A = new a.array.constructor(N * k);
        list.forEach((i, j) => A.set(a.array.subarray(i * k, (i + 3) * k), j * 3 * k));
        for (let s = 0; s < 7; s++) for (let c = 0; c < 3; c++) {   // the cap's corners: the centre, then two round the rim
          const o = (list.length * 3 + s * 3 + c) * k, ang = -(s + (c === 1 ? 0 : 1)) / 7 * Math.PI * 2 * capY, rim = c > 0;   // (turning so it faces capY's way)
          const v = nm === 'position' ? [cx + (rim ? Math.cos(ang) * cr : 0), cy, cz + (rim ? Math.sin(ang) * cr : 0)]
            : nm === 'normal' ? [0, capY, 0] : nm === 'aFam' ? [rope] : nm === 'aFixed' ? [1] : nm === 'aBias' ? [.15] : nm === 'aPart' ? [63]
            : nm === 'aFlex' ? [0] : nm === 'aPhase' ? [-1] : nm === 'aSpray' ? [0, 0, 0, -127] : new Array(k).fill(0);
          for (let q = 0; q < k; q++) A[o + q] = v[q] ?? 0;
        }
        g.setAttribute(nm, new THREE.BufferAttribute(A, k, a.normalized));
      }
      g.computeBoundingSphere(); g.computeBoundingBox(); return g;
    }
    o = {fall: part(up, Object.keys(g0.attributes), -1), stump: part(down, ['position', 'normal', 'aPart', 'aFam', 'aBias', 'aFixed'], 1)};
    GEOS.set(g0, o); return o;
  }
  const M = new THREE.Matrix4(), MR = new THREE.Matrix4(), MT = new THREE.Matrix4(), V3 = new THREE.Vector3(), SC = new THREE.Vector3(), Q = new THREE.Quaternion(), QY = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0), ZV = new THREE.Vector3(0, 0, 1);
  const treeMatrix = (p, I, out) => out.makeRotationY(I.pose.yaw).scale(SC.setScalar(I.s)).setPosition(p.x, p.z || 0, p.y);   // (world.js placeOf)
  const VF = [];   // the falls drawn: {p, I, f (the sim's record), m, M0, axis, hinge, th1, gone}
  const stumpMesh = new Map(), logMesh = new Map();
  let logGeo = null, seenVer = -1;
  function startFall(f) {
    const p = f.p, I = f.I, e = {vx: f.dx, vy: f.dy};
    const M0 = treeMatrix(p, I, new THREE.Matrix4());
    const m = host.world.mesh(geosOf(I).fall, M0, {sway: true, autumn: I.pose.autumn});
    m.setSprayFrame?.(M0);   // (its leaves keep the colours they had standing while it turns: gfx.js sprayM)
    // where it comes to rest: the angle at which the crown's side meets the ground there
    const hingeY = (p.z || 0) + I.cut * I.s, Lc = crownMid(I) - I.cut * I.s, rc = (I.pose.crown?.r || 1.2) * .72 * I.s;
    const gx = p.x + e.vx * Lc, gy = p.y + e.vy * Lc, rise = host.elev(gx, gy) - hingeY;
    const th1 = Math.acos(clamp((rc + rise) / Math.max(.5, Lc), -.25, .85));
    VF.push({p, I, f, m, M0, axis: new THREE.Vector3(e.vy, 0, -e.vx).normalize(), hinge: new THREE.Vector3(p.x, hingeY, p.y), th1, dx: e.vx, dy: e.vy, drop: I.cut * I.s, landed: false});
  }
  function fallAngle(F, t) {
    if (t < LAND_T) { const u = t / LAND_T, k = 3.1; return F.th1 * (Math.exp(k * u) - 1) / (Math.exp(k) - 1); }   // a slow lean that runs away
    const s = t - LAND_T;   // the crash: a rebound off the crown, then it settles a little lower as the crown gives
    return F.th1 + .05 * (1 - Math.exp(-7 * s)) - (s < .34 ? .085 * Math.sin(Math.PI * s / .34) : 0);
  }
  function poseFall(F, t) {
    const th = fallAngle(F, t), s = Math.max(0, t - LAND_T), k = Math.min(1, s / .3), slide = k * (2 - k);   // (after the crash the butt slips off the stump)
    MR.makeRotationAxis(F.axis, th);
    M.makeTranslation(-F.hinge.x, -F.hinge.y, -F.hinge.z).premultiply(MR).premultiply(MT.makeTranslation(F.hinge.x - F.dx * .18 * slide, F.hinge.y - F.drop * .7 * slide, F.hinge.z - F.dy * .18 * slide));
    M.multiply(F.M0); F.m.setMatrix(M);
  }
  function syncStumps() {
    if (seenVer === ver) return; seenVer = ver;
    const live = new Set(); for (const f of felled.values()) live.add(f.stump);
    for (const [st, m] of stumpMesh) if (!live.has(st)) { m.dispose(); stumpMesh.delete(st); }
    for (const [p, f] of felled) {
      if (stumpMesh.has(f.stump)) continue;
      const I = infoOf(p); if (!I) continue;
      stumpMesh.set(f.stump, host.world.mesh(geosOf(I).stump, treeMatrix(p, I, new THREE.Matrix4()), {static: true}));
    }
  }
  function syncLogs() {
    if (!logs.length && !logMesh.size) return;   // (nothing on the ground: no iterators a frame)
    logGeo ??= geoOf([{...along([0, -.27, 0], [0, .27, 0], .072, .066, 7), fam: 'bark'},
      {g: new THREE.CylinderGeometry(.064, .066, .01, 7), m: new THREE.Matrix4().makeTranslation(0, -.272, 0), fam: 'rope', fixed: 1},
      {g: new THREE.CylinderGeometry(.058, .06, .01, 7), m: new THREE.Matrix4().makeTranslation(0, .272, 0), fam: 'rope', fixed: 1}]);
    for (const [L, m] of logMesh) if (L.dead) { m.dispose(); logMesh.delete(L); }
    for (let i = 0; i < logs.length; i++) {
      const L = logs[i]; let m = logMesh.get(L);
      if (!m) { m = host.world.mesh(logGeo, new THREE.Matrix4()); logMesh.set(L, m); }
      const roll = L.t * L.spin;
      QY.setFromAxisAngle(UPV, -L.yaw); Q.setFromAxisAngle(ZV, Math.PI / 2 + roll * .1); QY.multiply(Q);
      m.setMatrix(M.compose(V3.set(L.x, L.h + .07, L.y), QY, SC.setScalar(1)));   // (setMatrix returns at once when it didn't move)
    }
  }
  // chips: wood flakes off a bite (back toward him), a few grey grains off a glance; dust when a trunk breaks into logs
  const CH = [];
  function chips(e) {
    const n = e.k > 0 ? 6 + Math.round(e.k * 6) : 3;
    for (let i = 0; i < n && CH.length < 160; i++) {
      const a = Math.atan2(-e.dy, -e.dx) + (VR() - .5) * 1.8, v = 1.2 + VR() * 2.4;
      CH.push({x: e.x, y: e.y, h: e.h + (VR() - .5) * .2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 1 + VR() * 2.2, t: 0, life: .5 + VR() * .5,
        col: e.k > 0 ? (VR() < .6 ? '#e2c48e' : '#7a5232') : '#b8b2a6', g: 9});
    }
  }
  function dust(x, y, n, r) {
    for (let i = 0; i < n && CH.length < 160; i++) {
      const a = VR() * Math.PI * 2, d = Math.sqrt(VR()) * r;
      CH.push({x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, h: host.elev(x, y) + .1 + VR() * .3, vx: Math.cos(a) * .5, vy: Math.sin(a) * .5, vh: .4 + VR() * .7, t: 0, life: .7 + VR() * .6,
        col: VR() < .5 ? '#a89a80' : '#8a7c66', g: -.2});
    }
  }

  // ---------------------------------------------------------------- the prompt: what 3 / LMB do at a tree in front of him
  function treeAhead() {
    const P = host.player, f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f);
    let best = null, bd = 1.9;
    const L = host.entities.near(P.x, P.y, 2.2, NEAR);
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (p.kind !== 'tree' || p.gone || p.outside || Math.abs((p.z || 0) - P.z) > 1) continue;
      const I = infoOf(p); if (!I) continue;
      const dx = p.x - P.x, dy = p.y - P.y, d = Math.hypot(dx, dy) - I.tr;
      if (d < bd && (d < .5 || (dx * fx + dy * fy) / (Math.hypot(dx, dy) || 1) > .3)) { bd = d; best = p; }
    }
    return best;
  }

  const F = {
    name: 'woodcut', label: 'Woodcutting', on: ON,
    get felled() { return felled; }, get logs() { return logs; }, infoOf, aimPoint,   // (aimPoint: tests)
    fellShared,   // (co-op: features/coop.js)
    update(dt, evs) {
      clockT += dt;
      const on = active();
      if (on !== was) { was = on; if (on) apply(); else unapply(); }
      if (!on) return;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'player.chop') blow(e);
        else if (e.type === 'pack.reset') reset();
      }
      const t = T(); if (t && !aimSet) { t.aimBy(aimPoint); t.wantBy(wantTool); aimSet = true; }   // (the swing asks as it starts: inside the player's step)
      if (byE && t && !host.keys.has('e')) { byE = false; t.release(); }   // (E let go)
      if (lock && !t?.S.held) lock = null;   // (LMB / E up: the trunk let go)
      const slot = t?.S.on && t.S.job === 'chop' ? pack()?.best('chop')?.slot ?? -1 : -1; if (slot !== heldSlot) { heldSlot = slot; if (slot >= 0 || !t?.S.on) pack()?.held(slot); }   // (the pack panel marks the axe in hand; another tool's job marks its own: features/mining.js)
      stepFalls(dt); stepLogs(dt); regrow(dt);
    },
    view(dt, evs) {
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'tree.chop') chips(e);
        else if (e.type === 'tree.land') {
          host.shake(3, .25);
          host.wind?.leafBurst?.(e.who, e.x, e.y, host.elev(e.x, e.y) + .2, 36, e.r * .9);
          dust(e.x, e.y, 14, e.r);
        } else if (e.type === 'tree.logs') { dust(e.x, e.y, 18, 1.4); host.wind?.leafBurst?.(e.who, e.x, e.y, host.elev(e.x, e.y) + .3, 14, 1.2); }
      }
      for (let i = 0; i < falls.length; i++) { const f = falls[i]; let seen = false; for (let j = 0; j < VF.length; j++) if (VF[j].f === f) seen = true; if (!seen) startFall(f); }   // (from the sim's list: the copy shows in the frame the tree went)
      for (let i = VF.length - 1; i >= 0; i--) {   // the falls, by the sim's own clock (slow motion, hitstop: the same)
        const F2 = VF[i];
        if (!falls.includes(F2.f)) { F2.m.dispose(); VF.splice(i, 1); continue; }
        poseFall(F2, F2.f.t);
      }
      syncStumps(); syncLogs();
      for (let i = CH.length - 1; i >= 0; i--) {
        const c = CH[i]; c.t += dt; if (c.t > c.life) { CH.splice(i, 1); continue; }
        c.vh -= c.g * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.h += c.vh * dt;
        const g = host.elev(c.x, c.y); if (c.h < g) { c.h = g; c.vx *= .3; c.vy *= .3; c.vh = 0; }
      }
    },
    frame() { for (let i = 0; i < CH.length; i++) { const c = CH[i]; host.point(c.x, c.y, c.h, c.col); } },
    onKey(k) {
      const t = T(); if (!t) return false;
      if (k === 'e' && active() && !host.lock && !host.PL.nearInteract?.() && !host.BUSY.has(host.player.state) && treeAhead()) {   // (a chest, a sign, a fire: E is theirs)
        const b = pack()?.best('chop');
        if (!b) { ui()?.float(host.player.x, host.player.y, host.player.z + 2, 'needs an axe', '#e8a070'); return true; }
        byE = true; lock = null; t.use(b.id); return true;
      }
      if ((k === '1' || k === '2') && t.on) { t.put(); return false; }   // (and on: the gun, the fists)
      if (t.on && (k === 'r' || k === 'y')) return true;   // (the gun's reload and twirl: not with an axe in his hand)
      return false;
    },
    ability(slot) { return !!(T()?.on && slot === 'rmb'); },   // (RMB with the axe out: nothing yet; not the gun's fan)
    hd(q, sc) {
      const t = T(); if (!t || !active() || host.lock || host.PL.nearInteract?.() || host.BUSY.has(host.player.state)) return;
      if (t.S.mode) return;   // (chopping: no prompt over the work)
      const p = trunkUnderCursor(host.player) || treeAhead(); if (!p) return;   // (the tree a press would go for)
      const I = infoOf(p), b = pack()?.best('chop'), weak = !b || (I && (b.def.tool.tier ?? 0) < I.tier);
      const text = !b ? 'needs an axe' : weak ? 'too hard for this axe' : 'LMB · E  chop';
      const s = host.G.toScreen(p.x, (p.z || 0) + 1.6, p.y), dpr = devicePixelRatio || 1;
      q.save(); host.G.hdShift?.(q, sc);
      q.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`; q.textAlign = 'center';
      const w = q.measureText(text).width + 12 * dpr;
      q.fillStyle = 'rgba(14,16,15,.8)'; q.fillRect(s[0] * sc - w / 2, s[1] * sc - 16 * dpr, w, 18 * dpr);
      q.fillStyle = weak ? '#e8a070' : '#f2d27a'; q.fillText(text, s[0] * sc, s[1] * sc - 3 * dpr);
      q.restore();
    },
    hud: () => active() ? `woodcut ${T()?.on ? 'axe out' : 'axe in the bag'} felled ${felled.size} logs ${logs.length}${falls.length ? ' falling ' + falls.length : ''}` : '',
    biomeChanged() {   // (the rebuild disposed the world's meshes: ours are made again; the feature's state follows active())
      stumpMesh.clear(); logMesh.clear(); for (const F2 of VF) F2.f = null; VF.length = 0; seenVer = -1;
    },
  };
  return F;
}
