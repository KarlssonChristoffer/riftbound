// LASSO SIM: the truth of the equipment experiment's lasso (a gun loadout's gadget: features/equip/sim.js hands it F while
// the lasso is in the slot). The cowboy's body is sim/player/lasso.js (PL.lasso: the spin, the throw, the haul, the yank,
// the swing); this module is the loop and the rope: what it aims at, its flight, what it catches and what then happens.
//   SPIN     F held: the loop overhead; the aim each step: an enemy or a barrel / crate under the cursor, else a high
//            anchor near the cursor on screen (a 3D tree's limb, the lasso's own anchors, a tall prop's top), else the ground
//   THROW    F let go: the throw clip; at its release mark (lasso.loose) the loop flies from the hand in an arc to the aim,
//            following a moving target; sub-stepped, it catches the first body, movable prop or anchor its opening meets
//   MISS     it lies a moment and is reeled back in; the cooldown starts when it's home
//   HOLD     a body or a prop on the rope: an enemy can't fight (combat's hold: no hops; a gunman's gun goes away), the
//            rope's length is the distance at the catch; walking away drags it (by its give; the rest holds you back: the
//            player's leash), a barrel / crate is towed through the prop physics. It slips after a few s, on a roll, a knock
//            or LMB (the gun). A CHAMPION is a tug of war: it heaves you toward it, then slackens: yank in the slack
//   YANK     tap F: it flies at you off its feet (combat's / the gunmen's fling: a tumble, whoever it meets bowled over),
//            lands a little short of you, takes the impact and lies stunned; a prop is shoved at you
//   SWING    an anchor: PL.lasso.hang (the pendulum is the player's); F or Space lets go; then the loop comes home
//   ZIP      an anchor caught well under his hand and away (TUNE.zip: thrown from up high, the watchtower's lookout, the mesa):
//            PL.lasso.zip: he hitches his end and slides down the line to it (docs/exp/brawl.md)
//   ROPE UP  an anchor at the lip of a top he can stand on (the lookout's low parapet, a tree on a ledge), him near the face's
//            foot below it (TUNE.ropeup): PL.lasso.ropeup: he climbs the rope up the face and over onto the top
//   STONES   the top of a stone wall's broken stretch too high to vault (TUNE.pull): caught as a hold; a tap of F pulls its top
//            course down toward you (world.pullWall: now it can be vaulted), the stones hurting whoever stands under them
// Fixed 1/60 s steps; every random draw from the equipment sim's generator (passed in); nothing read back from the view.
// OWNS: L (the phase, the aim, the loop's flight, what's held, the anchor, the stunned list), the anchor segments' scratch.
// READS: host.player / aim / mouse / G (gameToScreen: the cursor's anchors through the game's view, as the game's hover does) / entities (near) /
//   elev / inStream / items (3D trees' bones), PL.lasso (mode, hand), the combat core (BS), the gunmen (sim), the lasso's
//   own anchors (features/equip/anchors.js).
// CALLS: PL.lasso spin / face / throwAt / haul / leash / yank / hang / letGo / stop; combat core hold / shift / fling;
//   the gunmen's roped / shift / fling; combat's prop physics shove; host.knock / shake.
// EMITS: lasso.throw / catch / miss / yank / slam / slip / swing / home (core/events.js).
// BUDGET: sim; spinning ~.02-.06 ms a step (the aim: the cursor's anchors among the trees in reach, a few hundred
//   projections), flying a handful of grid queries a step, holding a few multiplies.
import {TUNE, ANCHOR_TOP} from '../../content/lasso.js';
import {GADGETS} from '../../content/gadgets.js';
import {clamp, hypot2, hypot3, TAU} from '../../core/mathx.js';
import {topOfProp, walkable, vaultTop} from '../../world/world.js';
import {TOWER_PLAN} from '../../world/layout.js';   // (the watchtower's lookout: its low parapet is a rope-up anchor)

const MOVABLE = new Set(['crate', 'barrel', 'barrel_x']);
const TOP = {lasso_snag: 4.3, crate: .8, barrel: .9, barrel_x: .9, pot: .5, rock: .5, rock_big: 1.1, brazier: 1.1, torch: 1.7, well: .9, bench: .5, stall: 2, woodpile: .4,
  campfire: .15, beacon: 1.5, chest: .6, dummy: 1.4, crystal: 1.2, pillar: 2.6, pillar_broken: 1.4, tree: 6, ruin: 2, scarecrow: 1.5, merchant: 1.6, goods: .7,
  bush: 0, tuft: 0, fern: 0, reed: 0, gadget: 0, gadget_cache: .7};
const SEGMAX = 640;
const ZIP = TUNE.zip, RU = TUNE.ropeup, PULL = TUNE.pull, WALLK = new Set(['wall_n', 'wall_s', 'wall_w', 'wall_e']);

export function createLassoSim(host, eq) {
  const ents = host.entities, P = host.player, events = host.events, G = GADGETS.lasso;
  let combat = null, foesF = null;
  const core = () => (combat ??= host.feature('combat'))?.core || null;
  const phys = () => (combat ??= host.feature('combat'))?.phys || null;
  const foes = () => (foesF ??= host.feature('foes'))?.sim || null;
  const lz = () => host.PL.lasso;
  let lightsF = null;
  const lights = () => lightsF ??= host.feature('lights');
  const nearA = [], nearB = [];

  // ---------------------------------------------------------------- state
  const L = {
    phase: '',   // '' | spin | wind (the throw clip, before its release) | fly | lie | hold | yanked | swing | back
    t: 0, spinT: 0, fPress: false, fHeld: false, fT: 0, simT: 0,
    aim: {kind: 'ground', who: null, x: 0, y: 0, h: 0, d: 0, ok: true, gx: 0, gy: 0},   // kind: enemy | prop | anchor | ground
    loop: {x: 0, y: 0, h: 0, lx: 0, ly: 0, lh: 0, x0: 0, y0: 0, h0: 0, tx: 0, ty: 0, th: 0, T: 1, t: 0, arc: 0, r: .36, who: null, kind: '', open: 1},
    who: null, kind: '', boss: false, elite: false, len: 0, held: 0, slip: 0, give: 1, taut: false, bossT: 0, heave: true,
    anchor: {x: 0, y: 0, h: 0, src: null},
    stun: [],   // {p, until (L.simT)}: who lies stunned after a yank (the view's stars)
  };
  const HP = [0, 0, 0];   // the hand (world)

  // ---------------------------------------------------------------- what's what
  const creature = eq.creature;
  const movable = p => !!p && MOVABLE.has(p.kind) && !p.wall && !p.broken && !p.gone && !p.sink && !p.float;
  // a brazier standing lit (lights.js): the loop pulls it over
  const brazier = p => !!p && p.kind === 'brazier' && !p.gone && !p.unlit;
  function brazierAt(x, y) { for (const p of ents.near(x, y, 1.2, nearA)) if (brazier(p) && hypot2(p.x - x, p.y - y) < .75) return p; return null; }
  const bodyMid = p => (p.z || 0) + (p.h || 0) + (p.hitH ?? 1.6) * .55;
  const topOf = p => topOfProp(p) ?? TOP[p.kind] ?? 1.2;
  // (a tower's or a gatepost's own top where the world built it its own: a broken one, a stump: world.js topOfProp)
  const anchorTop = p => p.kind === 'tower' || p.kind === 'gatepost' ? topOfProp(p) ?? ANCHOR_TOP[p.kind] : ANCHOR_TOP[p.kind];

  // ---------------------------------------------------------------- anchor segments (world): the 3D trees' limbs high enough,
  // the lasso's own anchors (eq.anchors()), tall props' tops (ANCHOR_TOP). A flat scratch: x0 y0 h0 x1 y1 h1 r; src per segment
  const SEG = new Float64Array(SEGMAX * 7), SRC = new Array(SEGMAX).fill(null);
  let nSeg = 0;
  const treeSegs = new WeakMap();   // a tree's pose -> its high bones (local), made once
  function highBones(pose) {
    let a = treeSegs.get(pose); if (a) return a;
    const out = []; const minH = (TUNE.anchorMin - .3) / pose.scale;
    for (const b of pose.bones) if (Math.min(b[1], b[4]) >= minH && Math.max(b[6], b[7]) >= .06) out.push(b);
    treeSegs.set(pose, a = out); return a;
  }
  function addSeg(x0, y0, h0, x1, y1, h1, r, src) {
    if (nSeg >= SEGMAX) return; const i = nSeg * 7;
    SEG[i] = x0; SEG[i + 1] = y0; SEG[i + 2] = h0; SEG[i + 3] = x1; SEG[i + 4] = y1; SEG[i + 5] = h1; SEG[i + 6] = r; SRC[nSeg++] = src;
  }
  function gather(x, y, r) {
    nSeg = 0;
    for (const p of ents.near(x, y, r + 4, nearB)) {
      if (p.gone || p.broken) continue;
      if (p.kind === 'tree') {
        const it = host.itemOf(p), pose = it?.pose; if (!pose || !it.live) continue;
        if (hypot2(p.x - x, p.y - y) > r + 4) continue;
        const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), k = pose.scale, z = p.z || 0;
        for (const b of highBones(pose)) addSeg(p.x + (b[0] * c + b[2] * s) * k, p.y + (-b[0] * s + b[2] * c) * k, z + b[1] * k,
          p.x + (b[3] * c + b[5] * s) * k, p.y + (-b[3] * s + b[5] * c) * k, z + b[4] * k, Math.max(b[6], b[7]) * k, p);
      } else if (ANCHOR_TOP[p.kind] !== undefined && hypot2(p.x - x, p.y - y) < r + 1) {
        const h = (p.z || 0) + anchorTop(p); addSeg(p.x, p.y, h, p.x, p.y, h, .3, p);
      } else if (p.kind === 'towerwall' && TOWER_PLAN && Math.abs((p.z || 0) - TOWER_PLAN.F) < .05 && hypot2(p.x - x, p.y - y) < r + 1) {   // (the lookout's parapet where it's low)
        const t = topOfProp(p) ?? 9; if (t <= 1.6) { const h = (p.z || 0) + t; addSeg(p.x, p.y, h, p.x, p.y, h, .25, p); }
      }
    }
    const A = eq.anchors?.(); if (A) for (let i = 0; i < A.n; i++) { const a = A.seg, j = i * 7; if (hypot2((a[j] + a[j + 3]) / 2 - x, (a[j + 1] + a[j + 4]) / 2 - y) < r + 4) addSeg(a[j], a[j + 1], a[j + 2], a[j + 3], a[j + 4], a[j + 5], a[j + 6], A.src[i]); }
  }
  // the closest point of segment i to (x, y, h) -> its distance; Q = the point
  const Q = {x: 0, y: 0, h: 0, t: 0};
  function segDist(i, x, y, h) {
    const j = i * 7, ax = SEG[j], ay = SEG[j + 1], ah = SEG[j + 2], dx = SEG[j + 3] - ax, dy = SEG[j + 4] - ay, dh = SEG[j + 5] - ah, L2 = dx * dx + dy * dy + dh * dh;
    const t = L2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy + (h - ah) * dh) / L2, 0, 1) : 0;
    Q.x = ax + dx * t; Q.y = ay + dy * t; Q.h = ah + dh * t; Q.t = t;
    return hypot3(x - Q.x, y - Q.y, h - Q.h);
  }
  const high = (x, y, h, src) => h - host.elev(x, y) >= TUNE.anchorMin || src?.kind === 'towerwall';   // (the lookout's parapet: a lip over its deck, high over the downs)

  // ---------------------------------------------------------------- the aim (while spinning)
  const SA = [0, 0, 0], SB = [0, 0, 0];
  function pickAnchor(A) {   // the anchor point nearest the cursor on screen (within `pick` px), in reach
    const Gx = host.G; if (!Gx?.gameToScreen) return false;
    const z = host.zoom, mx = host.VW / 2 + (host.mouse.x - host.VW / 2) * z, my = host.VH / 2 + (host.mouse.y - host.VH / 2) * z;
    let best = -1, bd = TUNE.pick * z, bx = 0, by = 0, bh = 0;
    for (let i = 0; i < nSeg; i++) {
      const j = i * 7;
      Gx.gameToScreen(SEG[j], SEG[j + 2], SEG[j + 1], SA); Gx.gameToScreen(SEG[j + 3], SEG[j + 5], SEG[j + 4], SB);
      const ex = SB[0] - SA[0], ey = SB[1] - SA[1], l2 = ex * ex + ey * ey, t = l2 > 0 ? clamp(((mx - SA[0]) * ex + (my - SA[1]) * ey) / l2, 0, 1) : 0;
      const d = hypot2(SA[0] + ex * t - mx, SA[1] + ey * t - my);
      if (d >= bd) continue;
      const x = SEG[j] + (SEG[j + 3] - SEG[j]) * t, y = SEG[j + 1] + (SEG[j + 4] - SEG[j + 1]) * t, h = SEG[j + 2] + (SEG[j + 5] - SEG[j + 2]) * t;
      if (!high(x, y, h, SRC[i]) || hypot3(x - HP[0], y - HP[1], h - HP[2]) > (HP[2] - h > ZIP.drop ? ZIP.range : TUNE.range)) continue;   // (a zip line reaches further down)
      best = i; bd = d; bx = x; by = y; bh = h;
    }
    if (best < 0) return false;
    A.kind = 'anchor'; A.who = SRC[best]; A.x = bx; A.y = by; A.h = bh; A.d = hypot3(bx - HP[0], by - HP[1], bh - HP[2]); A.ok = true;
    return true;
  }
  function aimAt(A) {
    lz().hand(false, HP);
    if (pinned) return aimPinned(A);
    const a = host.aim(), t = a.target, R = TUNE.range;
    A.who = null;
    if (t && (creature(t) || movable(t))) {
      A.kind = creature(t) ? 'enemy' : 'prop'; A.who = t; A.x = t.x; A.y = t.y; A.h = creature(t) ? bodyMid(t) : (t.z || 0) + topOf(t) * .6;
      A.d = hypot2(t.x - P.x, t.y - P.y); A.ok = A.d <= R + (t.hitR ?? .3);
      if (A.ok) return A;
    }
    gather(P.x, P.y, Math.max(R, ZIP.range));
    if (pickAnchor(A)) return A;
    if (pickWall(A)) return A;   // the top of a broken stretch of stone wall (STONES)
    // the ground under the cursor (host.aim reads it at chest height: the ground is that much further up the screen)
    let gx = a.x, gy = a.y;
    if (!t) { const k = (a.h - host.elev(a.x, a.y)) * host.PPMH / host.PPMY; gx -= Math.sin(host.yaw) * k; gy -= Math.cos(host.yaw) * k; }
    // a lit brazier there: the loop goes for it (pulled over)
    const br = brazierAt(gx, gy) || brazierAt(a.x, a.y);
    if (br) { A.kind = 'prop'; A.who = br; A.x = br.x; A.y = br.y; A.h = (br.z || 0) + .95; A.d = hypot2(br.x - P.x, br.y - P.y); A.ok = A.d <= R + .4; if (A.ok) return A; }
    let dx = gx - P.x, dy = gy - P.y, d = hypot2(dx, dy);
    if (d < .05) { const f = P.faceAngle; dx = Math.sin(f); dy = Math.cos(f); d = 1; } else { dx /= d; dy /= d; }
    d = clamp(d, 1, R);
    A.kind = 'ground'; A.x = P.x + dx * d; A.y = P.y + dy * d; A.h = host.elev(A.x, A.y); A.d = d; A.ok = true;
    return A;
  }

  // A PINNED AIM (a test handle, pin(x, y, h)): the aim at a world point instead of the cursor (the cursor is read through
  // a camera that eases differently at another frame rate: tools' frame-rate checks pin it). What's there, as the cursor
  // would find it: a body or a prop within .6 m, else an anchor point within .6 m (the closest on its segment), else the ground
  const PIN = {x: 0, y: 0, h: 0}; let pinned = false;
  function aimPinned(A) {
    const R = TUNE.range;
    A.who = null;
    for (const p of ents.near(PIN.x, PIN.y, 1.2, nearA)) if (!p.gone && !p.broken && (creature(p) || movable(p) || brazier(p)) && hypot2(p.x - PIN.x, p.y - PIN.y) < .6) {
      A.kind = creature(p) ? 'enemy' : 'prop'; A.who = p; A.x = p.x; A.y = p.y; A.h = creature(p) ? bodyMid(p) : (p.z || 0) + topOf(p) * .6;
      A.d = hypot2(p.x - P.x, p.y - P.y); A.ok = A.d <= R + (p.hitR ?? .3); return A;
    }
    gather(P.x, P.y, Math.max(R, ZIP.range));
    let best = -1, bd = .6, bx = 0, by = 0, bh = 0;
    for (let i = 0; i < nSeg; i++) { const d = segDist(i, PIN.x, PIN.y, PIN.h); if (d < bd && high(Q.x, Q.y, Q.h, SRC[i])) { bd = d; best = i; bx = Q.x; by = Q.y; bh = Q.h; } }
    if (best >= 0) { A.kind = 'anchor'; A.who = SRC[best]; A.x = bx; A.y = by; A.h = bh; A.d = hypot3(bx - HP[0], by - HP[1], bh - HP[2]); A.ok = A.d <= (HP[2] - bh > ZIP.drop ? ZIP.range : R); return A; }
    for (const p of ents.near(PIN.x, PIN.y, 1, nearA)) if (pullable(p) && hypot2(p.x - PIN.x, p.y - PIN.y) < .7) {   // (a wall's top to pull)
      const t = vaultTop(p) ?? topOfProp(p) ?? 2.4; A.kind = 'wall'; A.who = p; A.x = p.x; A.y = p.y; A.h = (p.z || 0) + t; A.d = hypot3(p.x - HP[0], p.y - HP[1], A.h - HP[2]); A.ok = A.d <= R; return A;
    }
    let dx = PIN.x - P.x, dy = PIN.y - P.y, d = hypot2(dx, dy) || 1; dx /= d; dy /= d; d = clamp(d, 1, R);
    A.kind = 'ground'; A.x = P.x + dx * d; A.y = P.y + dy * d; A.h = host.elev(A.x, A.y); A.d = d; A.ok = true;
    return A;
  }

  // ---------------------------------------------------------------- STONES: a stone wall's broken top (docs/exp/brawl.md)
  // pullable: a segment of the arena's stone walls broken below its full height but still over PULL.min (too high to vault)
  function pullable(p) {
    if (!p || p.gone || !WALLK.has(p.kind)) return false;
    const t = topOfProp(p); return t !== undefined && t > PULL.min && t <= PULL.max;
  }
  function pickWall(A) {   // a pullable top near the cursor on screen (within `pick` px), in reach
    const Gx = host.G; if (!Gx?.gameToScreen) return false;
    const z = host.zoom, mx = host.VW / 2 + (host.mouse.x - host.VW / 2) * z, my = host.VH / 2 + (host.mouse.y - host.VH / 2) * z;
    let best = null, bd = TUNE.pick * z, bh = 0;
    for (const p of ents.near(P.x, P.y, TUNE.range + 1, nearB)) {
      if (!pullable(p)) continue;
      const h = (p.z || 0) + topOfProp(p); Gx.gameToScreen(p.x, h, p.y, SA);
      const d = hypot2(SA[0] - mx, SA[1] - my); if (d >= bd || hypot3(p.x - HP[0], p.y - HP[1], h - HP[2]) > TUNE.range) continue;
      best = p; bd = d; bh = h;
    }
    if (!best) return false;
    A.kind = 'wall'; A.who = best; A.x = best.x; A.y = best.y; A.h = bh; A.d = hypot3(best.x - HP[0], best.y - HP[1], bh - HP[2]); A.ok = true;
    return true;
  }
  function catchWall(p) {
    const Z = lz(); L.who = p; L.kind = 'wall'; L.boss = false; L.elite = false;
    L.len = clamp(hypot2(p.x - P.x, p.y - P.y), 1.2, TUNE.hold.len); L.held = 0; L.slip = TUNE.hold.slip * 1.5; L.give = 0; L.fHeld = false;
    Z.haul(true); Z.leash(p.x, p.y, L.len + TUNE.hold.stretch);
    L.phase = 'hold'; L.t = 0; L.taut = true;
    events.push({type: 'lasso.catch', x: p.x, y: p.y, h: L.loop.h, what: 'wall', who: p});
    host.shake(1, .06);
  }
  // the yank on a wall: its top comes down toward you (world.pullWall), the stones on whoever stands under them on your side
  function pullIt() {
    const p = L.who; if (!p) { back(); return; }
    const dx = P.x - p.x, dy = P.y - p.y, d = hypot2(dx, dy) || 1, ok = !!host.world.pullWall?.(p, PULL.dh, PULL.w, PULL.floor, P.x, P.y);
    events.push({type: 'lasso.yank', x: p.x, y: p.y, who: p, ok});
    if (ok) {
      host.shake(4, .3); host.hitstop(.08);
      const c = core(), k = eq.dmgK(), z = p.z || 0;
      for (const q of ents.near(p.x, p.y, PULL.hit + 1, nearA)) {   // (your side of the wall: the stones come down toward you)
        if (!creature(q) || Math.abs((q.z || 0) - z) > 1 || hypot2(q.x - p.x, q.y - p.y) > PULL.hit || (q.x - p.x) * dx + (q.y - p.y) * dy < -.2) continue;
        c?.damage(q, PULL.dmg * k, {dir: [dx / d * 2, dy / d * 2]});
      }
      c?.part && c.puff?.(p.x + dx / d * .5, p.y + dy / d * .5, z, 16, 1);
      events.push({type: 'lasso.stones', x: p.x, y: p.y, z, who: p});
    }
    if (lz().mode === 'haul') lz().haul(false);
    back();
  }

  // ---------------------------------------------------------------- spin, throw, flight
  function startSpin() {
    if (!lz()?.spin(true)) return false;
    L.phase = 'spin'; L.spinT = 0; L.t = 0; eq.S.aiming = true; eq.S.aimT = 0;
    return true;
  }
  function throwIt() {
    aimAt(L.aim);
    lz().throwAt(L.aim.x, L.aim.y);
    L.loop.r = TUNE.spin.r * clamp(.55 + .45 * L.spinT / TUNE.spin.grow, .55, 1);
    L.phase = 'wind'; L.t = 0; eq.S.aiming = false; eq.S.cast = .9;
  }
  function launch() {
    const O = L.loop, A = L.aim;
    lz().hand(false, HP);
    O.x = O.lx = O.x0 = HP[0]; O.y = O.ly = O.y0 = HP[1]; O.h = O.lh = O.h0 = HP[2];
    O.who = A.kind === 'enemy' || A.kind === 'prop' ? A.who : null; O.kind = A.kind; O.wall = A.kind === 'wall' ? A.who : null;
    O.tx = A.x; O.ty = A.y; O.th = A.kind === 'ground' ? A.h + .04 : A.h;
    const d = hypot3(O.tx - O.x0, O.ty - O.y0, O.th - O.h0), Th = TUNE.throw;
    O.T = clamp(Th.t0 + Th.tk * d, Th.t0, Th.tMax); O.arc = Th.arc * d / 10 + .15 + (A.kind === 'anchor' ? .5 : 0); O.t = 0; O.open = 1;
    if (A.kind === 'anchor') gather(P.x, P.y, TUNE.range + 2);
    L.phase = 'fly'; L.t = 0;
    events.push({type: 'lasso.throw', x: O.x, y: O.y, h: O.h, at: A.kind});
  }
  function stepLoop(dt) {
    const O = L.loop; O.t += dt; O.lx = O.x; O.ly = O.y; O.lh = O.h;
    if (O.who) {
      if (O.who.broken || O.who.gone) O.who = null;
      else { O.tx = O.who.x; O.ty = O.who.y; O.th = creature(O.who) ? bodyMid(O.who) : (O.who.z || 0) + topOf(O.who) * .6; }
    }
    const k = Math.min(1, O.t / O.T), nx = O.x0 + (O.tx - O.x0) * k, ny = O.y0 + (O.ty - O.y0) * k, nh = O.h0 + (O.th - O.h0) * k + O.arc * 4 * k * (1 - k);
    const d = hypot3(nx - O.x, ny - O.y, nh - O.h), n = Math.max(1, Math.ceil(d / TUNE.throw.sub));
    for (let i = 1; i <= n; i++) {
      const f = i / n, x = O.lx + (nx - O.lx) * f, y = O.ly + (ny - O.ly) * f, h = O.lh + (nh - O.lh) * f;
      if (catchAt(x, y, h, k)) return;
      const g = host.elev(x, y);
      const over = O.kind === 'anchor' && hypot2(x - O.tx, y - O.ty) < 1.6;   // (dropping over its anchor: the lip it's on doesn't stop it)
      if (h <= g + .02 && !over || (k > .2 && !over && solid(x, y, h, h, .05, O.kind === 'anchor' || O.kind === 'wall' ? L.aim.who : null, L.aim.who?.kind === 'towerwall'))) {   // (at the lookout: past the tower's walls)
        if (O.kind === 'wall' && O.wall && hypot2(x - O.wall.x, y - O.wall.y) < .9) { O.x = x; O.y = y; O.h = h; catchWall(O.wall); return; }   // (the loop over its stones)
        O.x = x; O.y = y; O.h = Math.max(g + .02, Math.min(h, O.lh)); miss(); return;
      }
    }
    O.x = nx; O.y = ny; O.h = nh;
    if (k >= 1) {   // there: what it was thrown at, if it's still there
      if (O.kind === 'anchor') { catchAnchor(L.aim.x, L.aim.y, L.aim.h, L.aim.who); return; }
      if (O.kind === 'wall' && O.wall && !O.wall.gone) { catchWall(O.wall); return; }
      if (O.who && hypot2(O.who.x - O.x, O.who.y - O.y) < (O.who.hitR ?? O.who.r ?? .4) + TUNE.throw.catchR + .2) { catchThing(O.who); return; }
      O.h = host.elev(O.x, O.y) + .02; miss();
    }
  }
  // the loop's opening at (x, y, h): a body, a movable prop, an anchor (high enough). k: how far through its flight
  function catchAt(x, y, h, k) {
    const R = TUNE.throw.catchR;
    if (k > .08) for (const p of ents.near(x, y, R + .8, nearA)) {
      if (p.gone || p.broken) continue;
      const dd = hypot2(p.x - x, p.y - y);
      if (creature(p)) {
        const rel = h - (p.z || 0) - (p.h || 0);
        if (rel > -.1 && rel < (p.hitH ?? 1.6) + .1 && dd < (p.hitR ?? .4) + R) { L.loop.x = x; L.loop.y = y; L.loop.h = h; catchThing(p); return true; }
      } else if ((movable(p) || brazier(p)) && dd < (p.r || .3) + R && h < (p.z || 0) + topOf(p) + .3) { L.loop.x = x; L.loop.y = y; L.loop.h = h; catchThing(p); return true; }
    }
    // anchors: a loop thrown at one drops over it there (k = 1: stepLoop), not over a limb it passes on the way; any other
    // throw is caught by a limb late in its flight (thrown at the ground under one)
    if (L.loop.kind === 'anchor' || k < .5) return false;
    for (let i = 0; i < nSeg; i++) {
      if (segDist(i, x, y, h) > R + SEG[i * 7 + 6]) continue;
      if (!high(Q.x, Q.y, Q.h, SRC[i])) continue;
      catchAnchor(Q.x, Q.y, Q.h, SRC[i]); return true;
    }
    return false;
  }
  function miss() {
    const O = L.loop; L.phase = 'lie'; L.t = 0; O.open = 1;
    events.push({type: 'lasso.miss', x: O.x, y: O.y, h: O.h});
  }

  // ---------------------------------------------------------------- holding something
  // a lit brazier caught: pulled over toward you at once (lights.js topple: it goes out), its coals spill burning; the loop
  // slips off as it falls
  function topple(p) {
    const dx = P.x - p.x, dy = P.y - p.y, d = hypot2(dx, dy) || 1, B = TUNE.brazier;
    if (!lights()?.topple?.(p, dx, dy)) { miss(); return; }
    eq.spill?.(p.x + dx / d * B.spill, p.y + dy / d * B.spill, B.r, B.dur);
    events.push({type: 'lasso.catch', x: p.x, y: p.y, h: L.loop.h, what: 'prop', who: p});
    events.push({type: 'lasso.yank', x: p.x, y: p.y, who: p, ok: true}); host.shake(2, .12);
    back();
  }
  function catchThing(p) {
    if (p.kind === 'brazier') { topple(p); return; }
    const c = core(), Z = lz(), T2 = TUNE.hold;
    L.who = p; L.kind = c?.BS.has(p) ? 'brute' : p.kind === 'gunman' ? 'gunman' : 'prop';
    L.boss = !!p.boss; L.elite = !!p.elite;
    L.len = clamp(hypot2(p.x - P.x, p.y - P.y), 1.2, T2.len);
    L.held = 0; L.slip = L.boss ? T2.slipBoss : L.elite ? T2.slipElite : T2.slip; L.give = L.boss ? 0 : L.kind === 'prop' ? TUNE.prop.towMax : L.elite ? T2.dragElite : T2.drag;
    L.bossT = 0; L.heave = true; L.fHeld = false;
    holdIt(.2);
    Z.haul(true); Z.leash(p.x, p.y, L.len + T2.stretch);
    L.phase = 'hold'; L.t = 0; L.taut = false;
    events.push({type: 'lasso.catch', x: p.x, y: p.y, h: L.loop.h, what: L.kind === 'prop' ? 'prop' : 'enemy', who: p});
    host.shake(1, .06);
  }
  function holdIt(sec) {
    const p = L.who; if (L.kind === 'wall') return;
    if (L.kind === 'brute') core()?.hold(p, sec); else if (L.kind === 'gunman') foes()?.roped(p, sec);
  }
  function stepHold(dt) {
    const p = L.who, Z = lz(), T2 = TUNE.hold;
    if (!p || p.broken || p.gone || (L.kind === 'prop' && (p.sink || p.float))) { slip('gone'); return; }
    if (L.kind === 'wall') {   // (the stones hold: the rope's taut till a tap of F pulls them)
      if (Z.mode !== 'haul') { slip('drop'); return; }
      L.held += dt; L.t += dt; if (L.held >= L.slip) { slip('slip'); return; }
      Z.leash(p.x, p.y, L.len + T2.stretch); L.taut = true; L.loop.x = p.x; L.loop.y = p.y; L.loop.h = (p.z || 0) + (topOfProp(p) ?? 2) - .05;
      return;
    }
    if (Z.mode !== 'haul') { slip('drop'); return; }
    L.held += dt; L.t += dt;
    if (L.held >= L.slip) { slip('slip'); return; }
    // a long press: the hammer throw (a body, not a champion): it's swung off its feet round you
    if (L.fHeld && (L.fT += dt) > TUNE.hammer.hold && L.kind !== 'prop' && !L.boss) { startHammer(); return; }   // (a prop / a champion: still a yank on release)
    holdIt(.12);
    let dx = P.x - p.x, dy = P.y - p.y, d = hypot2(dx, dy) || 1e-6;
    const ux = dx / d, uy = dy / d;
    if (L.boss) {   // the champion's tug of war: it heaves (backs off, dragging you by the leash), then slackens
      L.bossT += dt; const B = TUNE.boss, per = B.heave + B.slack, ph = L.bossT % per; L.heave = ph < B.heave;
      if (L.heave) core()?.shift(p, -ux * B.pull * dt, -uy * B.pull * dt);
    } else {
      const over = d - L.len;   // past the rope's length: it comes along, at most at its drag speed (L.give m/s)
      if (over > 0) {
        const m = Math.min(over, L.give * dt);
        if (L.kind === 'prop') phys()?.shove(p, ux * m / dt, uy * m / dt);
        else if (L.kind === 'brute') core()?.shift(p, ux * m, uy * m);
        else foes()?.shift(p, ux * m, uy * m);
      }
    }
    dx = P.x - p.x; dy = P.y - p.y; d = hypot2(dx, dy);
    L.taut = d >= L.len - .06;
    Z.leash(p.x, p.y, L.len + T2.stretch);
    L.loop.x = p.x; L.loop.y = p.y; L.loop.h = L.kind === 'prop' ? (p.z || 0) + (p.h || 0) + topOf(p) * .55 : (p.z || 0) + (p.h || 0) + (p.hitH ?? 1.6) * .5;
  }
  // THE HAMMER THROW (hold F while roped): the body is swung off its feet round you, the rope's length growing to `r` m
  // and the turns to `rps` a second; it bowls over whoever it meets (both hurt); let go of F (or after `max` s) and it's
  // flung out along its way at `v` m/s, landing hard (`dmg`, stunned). A wall in the way stops the swing: it's dropped there
  function startHammer() {
    const p = L.who; lz().hammer();
    L.phase = 'hammer'; L.t = 0; L.fHeld = true; L.ham = L.ham || {a: 0, w: 0, r: 0, hit: []};
    L.ham.a = Math.atan2(p.y - P.y, p.x - P.x); L.ham.w = 0; L.ham.r = clamp(hypot2(p.x - P.x, p.y - P.y), 1.2, TUNE.hammer.r); L.ham.hit.length = 0; L.ham.turn = 0;
    events.push({type: 'lasso.yank', x: p.x, y: p.y, who: p, ok: true}); host.shake(1, .08);
  }
  function stepHammer(dt, up) {
    const p = L.who, Hm = TUNE.hammer, Z = lz();
    if (!p || p.broken || p.gone) { back(); return; }
    L.t += dt; const H = L.ham;
    H.w = Math.min(Hm.rps * TAU, H.w + Hm.rps * TAU * dt / Hm.spinUp); H.r += (Hm.r - H.r) * Math.min(1, dt * 6);
    const da = H.w * dt; H.a += da; H.turn += da; if (H.turn > TAU) { H.turn -= TAU; H.hit.length = 0; }   // (each turn may hit someone again)
    const x = P.x + Math.cos(H.a) * H.r, y = P.y + Math.sin(H.a) * H.r, h = Hm.h * Math.min(1, L.t / .25);
    const ok = L.kind === 'brute' ? core()?.carry(p, x, y, h) : foes()?.carry(p, x, y, h);
    Z.face(p.x, p.y);
    L.loop.x = p.x; L.loop.y = p.y; L.loop.h = (p.z || 0) + (p.h || 0) + (p.hitH ?? 1.6) * .5; L.taut = true;
    if (!ok) { fling(.25); return; }
    // whoever it swings into: both take a knock
    const k = eq.dmgK();
    for (const q of ents.near(p.x, p.y, Hm.bowl + .6, nearA)) {
      if (q === p || q.broken || q.gone || !creature(q) || H.hit.includes(q) || hypot2(q.x - p.x, q.y - p.y) > Hm.bowl + (q.hitR ?? .35)) continue;
      H.hit.push(q); core()?.damage(q, Hm.dmg * k, {dir: [(q.x - p.x) * 3, (q.y - p.y) * 3]}); core()?.damage(p, Hm.dmg * .5 * k, {quiet: true});
      events.push({type: 'combat.bowl', x: q.x, y: q.y, who: q, by: p}); host.shake(2, .1);
      if (core()?.BS.has(q)) core().hold(q, .6);
    }
    if (up || L.t > Hm.max) fling(1);
  }
  // let go of the hammer: flung along its way (k: x the speed; a wall stop throws it weakly)
  function fling(k) {
    const p = L.who, Hm = TUNE.hammer, Y = TUNE.yank, H = L.ham, s = Math.sign(H.w) || 1;
    const tx = -Math.sin(H.a) * s, ty = Math.cos(H.a) * s, d = Hm.v * k * Hm.dur;
    const o = {dur: Hm.dur, h: .8 * k + .2, h0: p.h || 0, dmg: Hm.dmg * eq.dmgK(), dmgFly: Hm.dmg * eq.dmgK(), bowl: Hm.bowl, stun: L.elite ? Y.stunElite : Y.stun,
      spin: s * TAU * 1.5, onLand: landed};
    const ok = L.kind === 'brute' ? core()?.fling(p, p.x + tx * d, p.y + ty * d, o) : foes()?.fling(p, p.x + tx * d, p.y + ty * d, o);
    lz().yank(p.x + tx * d, p.y + ty * d);
    events.push({type: 'lasso.yank', x: p.x, y: p.y, who: p, ok: !!ok}); host.shake(2, .12);
    L.stunFor = o.stun; L.fHeld = false;
    if (!ok) { back(); return; }
    L.phase = 'yanked'; L.t = 0;
  }
  // the yank: the clip starts (he heaves); at its pull mark (lasso.pull) what he holds comes off its feet
  function startYank() { const p = L.who; lz().yank(p.x, p.y); L.phase = 'pull'; L.t = 0; }
  function yank() {
    const p = L.who, Y = TUNE.yank;
    if (!p || p.broken || p.gone) { back(); return; }
    const dx = P.x - p.x, dy = P.y - p.y, d = hypot2(dx, dy) || 1, ux = dx / d, uy = dy / d;
    if (L.kind === 'wall') { pullIt(); return; }   // (STONES: its top comes down)
    if (L.kind === 'prop') {   // (the speed that brings it to your feet: a barrel rolls, a crate slides, each its own friction)
      const PT = phys()?.T, fr = PT ? (p.tip || p.kind !== 'crate' ? PT.rollFric : PT.slideFric) : 3;
      const v = clamp(Math.sqrt(2 * fr * Math.max(0, d - TUNE.prop.stop)) * 1.05, 1.5, TUNE.prop.yankV);
      phys()?.shove(p, ux * v, uy * v);
      events.push({type: 'lasso.yank', x: p.x, y: p.y, who: p, ok: true}); host.shake(1, .08);
      back(); return;
    }
    if (L.boss && L.heave) {   // against a heave: it holds, and jerks you off your feet toward it (the rope is lost)
      events.push({type: 'lasso.yank', x: p.x, y: p.y, who: p, ok: false});
      host.knock(-ux * TUNE.boss.jolt, -uy * TUNE.boss.jolt); host.shake(3, .16);
      slip('jolt'); return;
    }
    const k = eq.dmgK(), o = {dur: Y.dur, h: Y.h, dmg: Y.dmg * k, dmgFly: Y.dmgFly * k, bowl: Y.bowl, stun: L.boss ? Y.stunBoss : L.elite ? Y.stunElite : Y.stun,
      spin: (eq.R() < .5 ? -1 : 1) * TAU * (1.25 + eq.R() * .5), onLand: landed};
    const st = L.kind === 'gunman' ? Y.stopMan : Y.stop, tx = P.x - ux * st, ty = P.y - uy * st;
    const ok = L.kind === 'brute' ? core()?.fling(p, tx, ty, o) : foes()?.fling(p, tx, ty, o);
    events.push({type: 'lasso.yank', x: p.x, y: p.y, who: p, ok: !!ok});
    host.shake(2, .1);
    if (!ok) { back(); return; }
    L.phase = 'yanked'; L.t = 0; L.stunFor = o.stun;
  }
  function landed(b) {
    events.push({type: 'lasso.slam', x: b.x, y: b.y, who: b});
    L.stun.push({p: b, until: L.simT + (L.stunFor || TUNE.yank.stun)});
    if (L.phase === 'yanked' && L.who === b) back();
  }
  function slip(why) {
    const p = L.who;
    events.push({type: 'lasso.slip', x: p ? p.x : L.loop.x, y: p ? p.y : L.loop.y, who: p, why});
    if (lz().mode === 'haul') lz().haul(false);
    back();
  }

  // ---------------------------------------------------------------- swinging
  // the world as the swing sees it (the player's pendulum: sim/player/lasso.js): the ground, the water, what's solid
  const W = {
    elev: (x, y) => host.elev(x, y),
    water: (x, y) => host.inStream(x, y),
    solid: (x, y, h0, h1, r) => !walkable(x, y) || solid(x, y, h0, h1, r),
  };
  // something solid in the column (x, y) between h0 and h1 within r: higher ground (a cliff's face), a wall, a trunk, a prop
  // up to its top (world.js PROP_TOP, else TOP above)
  function solid(x, y, h0, h1, r, skip = null, tower = false) {   // (skip: the tree / snag a loop is thrown at: it flies past its own trunk; tower: the watchtower's walls)
    if (host.elev(x, y) > h0 + .3) return true;
    for (const p of ents.near(x, y, r + .8, nearA)) {
      if (p === skip || p.broken || p.gone || creature(p) || p.kind === 'gadget' || !(p.rect || p.r > .15) || (tower && p.kind === 'towerwall')) continue;
      const z0 = p.z || 0, top = z0 + topOf(p); if (h1 < z0 || h0 > top) continue;
      if (p.rect ? x > p.rect[0] - r && x < p.rect[2] + r && y > p.rect[1] - r && y < p.rect[3] + r : hypot2(p.x - x, p.y - y) < p.r + r) return true;
    }
    return false;
  }
  function catchAnchor(x, y, h, src) {
    const O = L.loop; O.x = x; O.y = y; O.h = h;
    events.push({type: 'lasso.catch', x, y, h, what: 'anchor', who: src && src.kind ? src : null});
    L.anchor.x = x; L.anchor.y = y; L.anchor.h = h; L.anchor.src = src;
    lz().hand(false, HP);
    const drop = HP[2] - h, run = hypot2(x - HP[0], y - HP[1]);
    if (drop > ZIP.drop && run > ZIP.min && lz().zip(HP[0], HP[1], HP[2], x, y, h, W)) {   // ZIP: from up here down to it
      L.zip = L.zip || {ax: 0, ay: 0, ah: 0}; L.zip.ax = HP[0]; L.zip.ay = HP[1]; L.zip.ah = HP[2];
      L.phase = 'zip'; L.t = 0; events.push({type: 'lasso.swing', x, y, h, zip: true}); return;
    }
    const R2 = ledge(x, y, h);
    if (R2 && lz().ropeup(x, y, h, R2.fx, R2.fy, R2.tx, R2.ty, R2.tz, W)) { L.phase = 'ropeup'; L.t = 0; events.push({type: 'lasso.swing', x, y, h, up: true}); return; }   // ROPE UP
    if (!lz().hang(x, y, h, W)) { miss(); return; }
    L.phase = 'swing'; L.t = 0;
    events.push({type: 'lasso.swing', x, y, h});
  }
  // ROPE UP: a top he can stand on by the anchor (within RU.reach, at most RU.under under it, RU.high over his feet), and the foot of
  // its face on his side (where the ground first falls a metre under the top) within RU.near of him -> {tx, ty, tz (the top), fx, fy
  // (the foot: a hand out from the face)} or null
  const RUP = {tx: 0, ty: 0, tz: 0, fx: 0, fy: 0};
  function ledge(ax, ay, ah) {
    const pz = P.z, el = (x, y) => host.elev(x, y);
    let best = -1e9, tx = 0, ty = 0, tz = 0;
    for (let r = .3; r <= RU.reach; r += .3) for (let k = 0; k < 12; k++) {   // the highest standable spot round the anchor, under it
      const a = k / 12 * TAU, x = ax + Math.cos(a) * r, y = ay + Math.sin(a) * r, e = el(x, y);
      if (e > ah + .2 || e < ah - RU.under || e < pz + RU.high || !walkable(x, y) || solid(x, y, e + .1, e + 1.5, .2)) continue;
      const sc = e - r * .3; if (sc > best) { best = sc; tx = x; ty = y; tz = e; }
    }
    if (best < -1e8) return null;
    // the face's foot: from the top toward him, the first spot down at his own level (a hand out from the face)
    const dx = P.x - tx, dy = P.y - ty, d = hypot2(dx, dy); if (d < .3) return null;
    const ux = dx / d, uy = dy / d;
    for (let s = .2; s <= d; s += .1) {
      const x = tx + ux * s, y = ty + uy * s;
      if (el(x, y) < tz - 1) {   // (past the face: its foot, wherever the ground is there; he walks to it)
        const fx = x + ux * .32, fy = y + uy * .32;
        if (hypot2(fx - P.x, fy - P.y) > RU.near || !walkable(fx, fy)) return null;
        RUP.tx = tx; RUP.ty = ty; RUP.tz = tz; RUP.fx = fx; RUP.fy = fy; return RUP;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- home again
  function back() { L.phase = 'back'; L.t = 0; L.who = null; L.kind = ''; L.fHeld = false; }
  function reel(dt) {
    const O = L.loop; lz().hand(false, HP); L.t += dt;
    O.lx = O.x; O.ly = O.y; O.lh = O.h;
    const dx = HP[0] - O.x, dy = HP[1] - O.y, dh = HP[2] - O.h, d = hypot3(dx, dy, dh), st = TUNE.miss.reel * dt;
    if (d <= st + .25 || L.t > 2) { home(); return; }
    O.x += dx / d * st; O.y += dy / d * st; O.h = Math.max(host.elev(O.x, O.y) + .03, O.h + dh / d * st);
  }
  function home() {
    L.phase = ''; L.t = 0;
    const sl = eq.S.slot; if (sl && sl.id === 'lasso') sl.cd = G.cd;
    events.push({type: 'lasso.home', x: P.x, y: P.y});
  }
  // drop everything (the feature off, a stage change, the gadget swapped): nothing left held, the hands free
  function clear() {
    const Z = lz(); if (L.phase && Z) Z.stop();
    L.phase = ''; L.who = null; L.kind = ''; L.stun.length = 0; L.fHeld = false; L.fPress = false; eq.S.aiming = false;
  }

  // ---------------------------------------------------------------- the step
  function update(dt, evs) {
    L.simT += dt;
    for (let i = L.stun.length - 1; i >= 0; i--) if (L.stun[i].until <= L.simT || L.stun[i].p.broken) L.stun.splice(i, 1);
    const Z = lz(); if (!Z) return;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'lasso.loose') { if (L.phase === 'wind') launch(); }
      else if (e.type === 'lasso.pull') { if (L.phase === 'pull') yank(); }
      else if (e.type === 'lasso.drop') {
        if (L.phase === 'spin' || L.phase === 'wind') { L.phase = ''; eq.S.aiming = false; }
        else if (L.phase === 'hold') slip(e.why === 'gun' ? 'gun' : 'drop');
        else if (L.phase === 'swing' || L.phase === 'zip' || L.phase === 'ropeup') back();
      } else if ((e.type === 'lasso.letgo' || e.type === 'lasso.bump') && (L.phase === 'swing' || L.phase === 'zip' || L.phase === 'ropeup')) back();
    }
    const press = L.fPress, up = eq.S.fUp; L.fPress = false; eq.S.fUp = false;
    const sl = eq.S.slot;
    if (host.lock && (L.phase === 'spin' || L.phase === 'wind')) { Z.stop(); L.phase = ''; eq.S.aiming = false; return; }
    switch (L.phase) {
      case '':
        if (press) { if (sl && sl.cd <= 0 && host.weapon?.kind === 'gun') startSpin(); else eq.S.deny = .3; }
        break;
      case 'spin':
        L.spinT += dt; L.t += dt; eq.S.aimT = L.spinT;
        if (Z.mode !== 'spin') { L.phase = ''; eq.S.aiming = false; break; }
        aimAt(L.aim); Z.face(L.aim.x, L.aim.y);
        if (up && L.spinT >= TUNE.spin.min) throwIt();
        else if (up) L.fUpLate = true;
        if (L.fUpLate && L.spinT >= TUNE.spin.min) { L.fUpLate = false; throwIt(); }
        break;
      case 'wind':
        L.t += dt; if (L.t > .8 || Z.mode !== 'throw') launch();   // (a safety: the clip's release never came)
        break;
      case 'fly': stepLoop(dt); break;
      case 'lie': L.t += dt; if (L.t >= TUNE.miss.lie) back(); break;
      case 'hold':
        if (press) { L.fHeld = true; L.fT = 0; }
        if (up && L.fHeld) { L.fHeld = false; startYank(); break; }
        stepHold(dt);
        break;
      case 'hammer': stepHammer(dt, up); break;
      case 'pull':   // (the yank clip, until its pull mark: it's still held)
        L.t += dt; holdIt(.12);
        if (!L.who || L.who.broken || L.who.gone) back(); else if (L.t > .4 || Z.mode !== 'yank') yank();
        break;
      case 'yanked': {
        L.t += dt; const p = L.who;
        if (!p || p.broken || p.gone || L.t > 1.2) { back(); break; }
        L.loop.x = p.x; L.loop.y = p.y; L.loop.h = (p.z || 0) + (p.h || 0) + (p.hitH ?? 1.6) * .5;
        break;
      }
      case 'swing':   // F held climbs the rope, let go of it (or Space) lets go of the rope
        L.t += dt;
        if (press) { L.fHeld = true; Z.climb(true); }
        if (up) { L.fHeld = false; Z.climb(false); Z.letGo(); }
        if (Z.mode !== 'hang') back();
        break;
      case 'zip': case 'ropeup':   // (F or Space lets go)
        L.t += dt;
        if (press) Z.letGo();
        if (Z.mode !== 'zip' && Z.mode !== 'ropeup') back();
        break;
      case 'back': reel(dt); break;
    }
    if (L.fUpLate && L.phase !== 'spin') L.fUpLate = false;
  }

  return {
    L, update, clear, aimAt, gather, solid,
    get busy() { return L.phase !== ''; },
    press() { L.fPress = true; },
    // Space while swinging lets go (features/equip.js onKey): true when it took the key
    space() { if (L.phase !== 'swing' && L.phase !== 'zip' && L.phase !== 'ropeup') return false; lz()?.letGo(); return true; },
    seg: () => ({SEG, n: nSeg}),
    // (tests) pin the aim to a world point (null: the cursor again)
    pin(x, y, h) { pinned = x !== null && x !== undefined; if (pinned) { PIN.x = x; PIN.y = y; PIN.h = h || 0; } },
  };
}
