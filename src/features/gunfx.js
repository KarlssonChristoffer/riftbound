// GUN FX (view): what a revolver's shots look like. Presentation only: it reads the sim (the player's pose through the
// revolver's barrel(), the bullets in host.arrows) and its events, and writes only its own pools; with ?views=0 or
// switched off nothing in play changes (tools/test/simview.mjs).
//   flash    a pixel-art muzzle flash for ~4 frames (render/flashes.js): a hot core, a flame tongue along the shot,
//            petals either side, in the world at the muzzle's real place (the sim's), so what stands in front of the
//            gun (his own hat, firing away from the camera) hides it; a small soft glow round it (HD, depth-faded); and
//            light thrown forward along the shot (a short chain of pools ahead of the muzzle, no halo: F.lights)
//   blast    world lines (glowing): burning powder grains thrown out of the muzzle along the shot
//   smoke    gunfx/smoke.js: the jet of gun smoke along the shot that stops within a metre, then rolls in eddies,
//            rises and drifts downwind, and a jet out of each side of the cylinder gap; a thin wisp keeps curling off
//            the barrel for a moment after the last shot, and while the gunslinger blows it off (gun_blow). Four looks
//            (pixel | hybrid | strands | soft): Shift+V in dev mode, the menu's Dev tab, ?smoke=
//   tracer   world lines (glowing): each bullet in flight as a streak behind its head; its last step (the impact) as a
//            streak that shrinks into the impact in ~70 ms (a bullet that hit within its first step is seen only so)
//   cases    world points: brass cases dropping from the cylinder on a reload's eject, bouncing, lying a while
//   impacts  by what the bullet met (surfaceOf: bullet.impact's surf, the prop there by its kind, the desert's groundAt):
//            sand / dirt / snow a dust kick and a puff; stone a spray of grey chips, a puff and now and then sparks; adobe
//            tan chips and a dusty puff; wood splinters; metal a burst of sparks. Bits are world points, sparks glowing
//            streaks, puffs the smoke's (tinted). A mark: a scuff in the ground (features/flow.js F.stamp), a hole in a
//            wall, prop or tree (world points just off its face, fading). A body hit is blood's (features/blood.js)
//   others   the desert's gunmen (features/foes): their shots (foe.shoot) flash, spit grains and smoke at the muzzle the
//            event names (a few at once), their reloads drop cases (foe.reload), their bullets end like yours
//            (bullet.impact); their tracers in flight are drawn by their own view with this look (tracer(), exported)
// OWNS: its pools (typed arrays, capped; reused, nothing allocated per frame) and its smoke (gunfx/smoke.js).
// READS: host.P, host.PL.gun, host.weapon, host.arrows, events (player.shoot / reload, foe.shoot / reload, bullet.impact,
// arrow.hit, combat.hit), host.wind (the smoke's drift), host.yaw / zoom, host.mouse / VW / VH (the reticle),
// host.entities.near + host.biome.groundAt (what a bullet hit), flow's F.stamp (the ground's scuffs).
// BUDGET: view ~.03 ms with a fanned cylinder in the air and its impacts (<= 320 bits, 48 holes); flashes: one instanced draw.
import {WEAPONS} from '../content/weapons.js';
import {rgbOf} from '../core/color.js';
import {hypot2, hypot3} from '../core/mathx.js';
import {SMOKE, createSmoke} from './gunfx/smoke.js';
import {createFlashes} from '../render/flashes.js';

export const TUNE = {
  // the flash: s, its length (m along the shot), x its thickness, x for the Navy / a fanned shot; its glow (HD: m, alpha);
  // its light: s it fades over, colour, x brightness, and the chain of pools [m ahead of the muzzle, radius m, x k]
  flash: {life: .065, len: .62, width: 1, navy: 1.3, fan: 1.1, glow: {r: .13, a: .45},
    light: {life: .07, color: '#ffc46a', k: 1.1, chain: [[.6, .8, .8], [1.4, 1.35, .75], [2.4, 1.7, .45]]}},
  blast: {n: 6, navy: 9, foe: 4, speed: [7, 13], spread: .22, life: [.04, .11]},   // powder grains: count, m/s, rad either side, s
  smoke: SMOKE,   // (gunfx/smoke.js)
  tracer: {len: 2.4, head: .45, mid: 1.1, last: .07},
  cases: {max: 36, life: 5, grav: 9.8, bounce: .35},
  bits: {max: 320},
  // where a bullet ends, by what it met (surfaceOf). bits: [palette, n, speed (m/s, back off the face toward the
  // shooter, and sideways), up [lo, hi] m/s, life [lo, hi] s, gravity]; along: x speed carried on along its way;
  // puff: [tint, n, size m, life [lo, hi] s, rise m/s] (HD: a dirt hit spurts up); spark: [chance, n lo, n hi]
  impact: {
    sand:  {bits: ['sand', 16, 1.3, [1.2, 3.4], [.35, .7], 8], along: .45, puff: ['sand', 3, .12, [.5, .9], .8], spark: [0, 0, 0]},
    dirt:  {bits: ['dirt', 13, 1.2, [1, 3], [.3, .6], 8], along: .35, puff: ['dirt', 2, .1, [.4, .7], .6], spark: [0, 0, 0]},
    snow:  {bits: ['snow', 12, 1, [.8, 2.8], [.3, .6], 6], along: .3, puff: ['snow', 3, .1, [.45, .8], .6], spark: [0, 0, 0]},
    stone: {bits: ['stone', 8, 2, [.6, 2.4], [.35, .7], 9], along: .1, puff: ['stone', 2, .07, [.3, .55], .35], spark: [.35, 2, 4]},
    adobe: {bits: ['adobe', 9, 1.8, [.5, 2.2], [.35, .7], 9], along: .1, puff: ['adobe', 2, .09, [.35, .65], .45], spark: [.12, 1, 3]},
    wood:  {bits: ['wood', 7, 1.8, [.6, 2.6], [.4, .8], 9], along: .2, puff: ['wood', 1, .06, [.25, .45], .3], spark: [0, 0, 0]},
    metal: {bits: null, along: .2, puff: ['stone', 1, .05, [.2, .35], .2], spark: [1, 5, 8]},
  },
  sparks: {speed: [2.5, 6.5], up: [.4, 3], life: [.08, .24], grav: 9, streak: .022},   // streak: s of its travel each spark draws
  holes: {max: 48, life: 7, fade: 2, back: .03},   // in walls, props, trees: s shown, the last s fading, m off the face
};
// what a prop is made of, by its kind (a bullet's impact): stone also stands for brick and clay; walls in the desert are adobe
const MAT = {wall_n: 'stone', wall_s: 'stone', wall_w: 'stone', wall_e: 'stone', tower: 'stone', gatepost: 'stone', pillar: 'stone',
  pillar_broken: 'stone', rubble: 'stone', rock: 'stone', rock_big: 'stone', ruin: 'stone', well: 'stone', crystal: 'stone', pot: 'stone',
  campfire: 'stone', beacon: 'stone', crate: 'wood', barrel: 'wood', woodpile: 'wood', stall: 'wood', bench: 'wood', hitch_rail: 'wood',
  trough: 'wood', wanted_board: 'wood', signpost: 'wood', wagon: 'wood', outhouse: 'wood', rail_fence: 'wood', windmill: 'wood',
  mine_portal: 'wood', water_tower: 'wood', tree: 'wood', goods: 'wood', chest: 'wood', dummy: 'wood', merchant: 'wood',
  barrel_x: 'metal', stock_tank: 'metal', ore_cart: 'metal', brazier: 'metal', torch: 'metal'};
const C = {head: rgbOf('#fff6d8'), mid: rgbOf('#ffd27a'), tail: rgbOf('#b8642e'), brass: rgbOf('#d8a93c'), brassHi: rgbOf('#ffe08a')};
// the bits' palettes, light -> dark, flattened once (bk = the colour's index; EMIT: it glows)
// (each with a light and a dark tone against its own surface: chips off adobe show its pale inside and its shadow)
const PALS = {sand: ['#f0e0b8', '#cdb488', '#8e7652'], dirt: ['#cdb894', '#968262', '#6a5a44'], snow: ['#ffffff', '#d8e2f0', '#9aaac4'],
  stone: ['#ece8e0', '#a8a49c', '#5a5650'], adobe: ['#f2e0c4', '#c8a47c', '#6e5038'], wood: ['#ecc890', '#a0743e', '#5a3a22'],
  spark: ['#fffbe8', '#ffd878', '#ff9a3a']};
const COLS = [], BASE = {}, EMIT = [];
for (const [k, list] of Object.entries(PALS)) { BASE[k] = COLS.length; for (const c of list) { COLS.push(rgbOf(c)); EMIT.push(k === 'spark' ? 1 : 0); } }
// a hole: its dark middle (2 px across) and a pale rim pixel above it, by material
const HOLE = {stone: ['#34302e', '#d8d2c8'], adobe: ['#4a3628', '#e4cca8'], wood: ['#2a1c12', '#d8b080'], metal: ['#26262a', '#d0d4dc']};
const HOLES = Object.keys(HOLE), HCOL = HOLES.map(k => HOLE[k].map(rgbOf));
const R = Math.random, RR = (a, b) => a + R() * (b - a);   // presentation's randomness
// a bullet in flight as a streak behind its head (x, y, h; u: its unit direction), L m long at most (how far it has
// come: a fresh one is short): a white-hot head, a gold middle (both glowing), a dull copper tail. Other shooters' bullets
// (features/foes) are drawn with it too
export function tracer(host, x, y, h, ux, uy, uh, L) {
  const T = TUNE.tracer; L = Math.min(T.len, L);
  seg(host, x, y, h, ux, uy, uh, 0, Math.min(L, T.head), C.head, true);
  if (L > T.head) seg(host, x, y, h, ux, uy, uh, T.head, Math.min(L, T.mid), C.mid, true);
  if (L > T.mid) seg(host, x, y, h, ux, uy, uh, T.mid, L, C.tail, false);
}
function seg(host, x, y, h, ux, uy, uh, d0, d1, col, emit) {
  host.line(x - ux * d0, y - uy * d0, h - uh * d0, x - ux * d1, y - uy * d1, h - uh * d1, col, emit);
}

// ORDER (core/features.js): after combat (its hits' chunks first; nothing reads ours)
export const order = {after: ['combat']};
export async function create(host) {
  const gun = () => host.weapon?.kind === 'gun' ? host.PL.gun : null;
  const MZ = {x: 0, y: 0, a: 0}, W3 = {x: 0, y: 0, h: 0}, SC = [0, 0, 0], NEAR = [], AT = {x: 0, y: 0, h: 0};
  const view = (x, y, h) => host.G.toScreenInto(x, h, y, SC);   // world -> view px, no allocation (host.toView's maths)
  // the muzzle in the world this frame: the pose's muzzle (sprite px from the feet) put back through the camera at the
  // player's depth: exact on screen, which is all the HD layers need
  function muzzleWorld(g) {
    const P = host.P; if (!g.barrel(P.frame, P.face, MZ)) return null;
    const pl = host.player, dx = MZ.x / host.PPM, c = Math.cos(host.yaw), s = Math.sin(host.yaw);
    W3.x = pl.x + dx * c; W3.y = pl.y - dx * s; W3.h = P.z - MZ.y / host.PPMH; return W3;
  }

  // ---- state: the flashes (render/flashes.js), the smoke (gunfx/smoke.js), tracers' last streaks, cases, bits, holes ----
  const flashes = createFlashes(host.G, 8);
  // a flash: t its time left (it runs on below 0 while its light fades), v its variant, k x its size, a its angle on
  // screen, s art px a metre along the shot there, the muzzle (x, y, h: the sim's), the shot's way (ux, uy)
  const mkFlash = () => ({t: -9, v: 0, k: 1, a: 0, s: 1, x: 0, y: 0, h: 0, ux: 1, uy: 0});
  const FL = mkFlash();   // yours
  const OF = []; for (let i = 0; i < 6; i++) OF.push(mkFlash());   // other shooters' (foe.shoot): the newest one lights
  let ofI = 0, OFL = OF[0];
  const mkChain = id => TUNE.flash.light.chain.map((c, i) => ({x: 0, y: 0, h: 0, color: TUNE.flash.light.color, radius: 1, intensity: 0, flicker: 0, id: id + i, halo: false}));
  const LCH = mkChain(7450), OCH = mkChain(7460), LITS = [], GLOW = [1, .78, .42];
  // a shot's flash from its event (x, y, h the muzzle; vx, vy its way): where, which way on screen, how big
  function flashOf(Q, e, k) {
    Q.t = TUNE.flash.life; Q.v = (R() * 3) | 0; Q.k = k; Q.x = e.x; Q.y = e.y; Q.h = e.h; Q.ux = e.vx; Q.uy = e.vy;
    view(e.x, e.y, e.h); const x0 = SC[0], y0 = SC[1]; view(e.x + e.vx, e.y + e.vy, e.h);
    Q.a = Math.atan2(SC[1] - y0, SC[0] - x0); Q.s = Math.hypot(SC[0] - x0, SC[1] - y0) / (host.zoom || 1);
  }
  function drawFlash(Q) {   // (frame) the pixel flash and its glow
    const T = TUNE.flash, k = Q.t / T.life;
    flashes.put(Q.x, Q.y, Q.h, T.len * Q.s * Q.k * (.7 + .3 * k), Q.a, k, Q.v, T.width);
    if (host.G.fx) for (let i = 0; i < 2; i++) {
      const d = (.08 + i * .22) * Q.k;
      host.G.fx(Q.x + Q.ux * d, Q.h, Q.y + Q.uy * d, T.glow.r * Q.k * (i ? .75 : 1) * (.6 + .4 * k), GLOW, T.glow.a * k * (i ? .6 : 1), 'add');
    }
  }
  function chain(L, Q) {   // the light thrown forward along the shot: on full at the flash, gone life s later
    const T = TUNE.flash, k = Math.max(0, Math.min(1, (Q.t + T.light.life - T.life) / T.light.life));
    for (let i = 0; i < L.length; i++) {
      const c = T.light.chain[i], o = L[i], d = c[0] * Q.k;
      o.x = Q.x + Q.ux * d; o.y = Q.y + Q.uy * d; o.h = Q.h; o.radius = c[1] * Q.k * (.75 + .25 * k); o.intensity = T.light.k * c[2] * k * Q.k;
      LITS.push(o);
    }
  }
  const smoke = createSmoke(host);
  let wispT = 0, wispFor = 0;
  const TR = [], TRN = 16; for (let i = 0; i < TRN; i++) TR.push({x0: 0, y0: 0, h0: 0, x1: 0, y1: 0, h1: 0, t: 9});
  let trI = 0;
  const CM = TUNE.cases.max, cx = new Float32Array(CM), cy = new Float32Array(CM), ch = new Float32Array(CM), cvx = new Float32Array(CM),
    cvy = new Float32Array(CM), cvh = new Float32Array(CM), ct = new Float32Array(CM);
  let cN = 0, cI = 0;
  const BM = TUNE.bits.max, bx = new Float32Array(BM), by = new Float32Array(BM), bh = new Float32Array(BM), bvx = new Float32Array(BM),
    bvy = new Float32Array(BM), bvh = new Float32Array(BM), bt = new Float32Array(BM), bl = new Float32Array(BM), bk = new Uint8Array(BM), bg = new Float32Array(BM);
  let bN = 0;
  function bit(x, y, h, vx, vy, vh, life, col, grav) {   // col: COLS's index
    if (bN >= BM) return;
    const i = bN++; bx[i] = x; by[i] = y; bh[i] = h; bvx[i] = vx; bvy[i] = vy; bvh[i] = vh; bt[i] = 0; bl[i] = life; bk[i] = col; bg[i] = grav;
  }
  const HM_ = TUNE.holes.max, hx = new Float32Array(HM_), hy = new Float32Array(HM_), hh = new Float32Array(HM_), ht = new Float32Array(HM_).fill(99), hk = new Uint8Array(HM_);
  let hI = 0;
  function hole(x, y, h, mat) { const i = hI; hI = (hI + 1) % HM_; hx[i] = x; hy[i] = y; hh[i] = h; ht[i] = 0; hk[i] = Math.max(0, HOLES.indexOf(mat)); }

  // ---- what a bullet met ----
  const inside = (p, x, y) => p.rect ? x > p.rect[0] && x < p.rect[2] && y > p.rect[1] && y < p.rect[3] : hypot2(p.x - x, p.y - y) < (p.r || 0);
  // the prop at a bullet's end: for 'hit', the target / hp prop whose hit circle it's in (a killed gunman is already out of
  // the world: null); for 'prop', the solid it stopped inside (a box, else the nearest circle)
  function propAt(e, body) {
    let best = null, bd = 1e9;
    for (const p of host.entities.near(e.x, e.y, .8, NEAR)) {
      if (body) { if (!(p.target || p.hp > 0 || p.broken)) continue; const d = hypot2(p.x - e.x, p.y - e.y); if (d < (p.hitR ?? .45) + .1 && d < bd) { bd = d; best = p; } }
      else if (inside(p, e.x, e.y)) { const d = p.rect ? 0 : hypot2(p.x - e.x, p.y - e.y); if (d < bd) { bd = d; best = p; } }
    }
    return best;
  }
  let hitProp = null;   // (surfaceOf's prop, for the hole)
  // the material a bullet.impact ended on: sand | dirt | snow | stone | adobe | wood | metal, 'flesh' (a body: blood's),
  // 'water' (the splash is atmos's), '' (the air)
  function surfaceOf(e) {
    hitProp = null;
    switch (e.surf) {
      case 'ground': {
        const g = host.biome.groundAt?.(e.x, e.y);
        if (g) return g === 'sand' ? 'sand' : g === 'pan' ? 'dirt' : g === 'water' ? 'water' : 'stone';   // (stone: the fort's paving; rock)
        return host.biome.id === 'frost' ? 'snow' : e.h > .05 ? 'stone' : 'dirt';   // (a plateau's top is rock)
      }
      case 'tree': return 'wood';
      case 'water': return 'water';
      case 'player': return 'flesh';
      case 'hit': case 'prop': {
        const p = hitProp = propAt(e, e.surf === 'hit');
        if (!p) return e.surf === 'hit' ? 'flesh' : 'stone';
        if (p.hunter || p.sparring || p.kind === 'gunman') return 'flesh';
        const m = MAT[p.kind] || 'stone';
        return m === 'stone' && host.biome.id === 'desert' && p.kind.startsWith('wall') ? 'adobe' : m;
      }
    }
    return '';
  }
  // the bullet's end is up to a sub-step inside a solid: back along its way out to the face it came through
  function face(p, e, out) {
    const ux = e.dx || 0, uy = e.dy || 0; let x = e.x, y = e.y;
    for (let k = 0; k < 16 && inside(p, x, y); k++) { x -= ux * .025; y -= uy * .025; }
    out.x = x - ux * TUNE.holes.back; out.y = y - uy * TUNE.holes.back; out.h = e.h; return out;
  }
  function impact(e) {
    const m = surfaceOf(e), I = TUNE.impact[m]; if (!I) return;
    const ux = e.dx || 0, uy = e.dy || 0;
    let x = e.x, y = e.y, h = e.h;
    if (e.surf === 'prop' && hitProp) { face(hitProp, e, AT); x = AT.x; y = AT.y; }
    else if (e.surf === 'tree') { x -= ux * TUNE.holes.back; y -= uy * TUNE.holes.back; }
    const ground = e.surf === 'ground', lift = ground ? .02 : 0;
    if (I.bits) {   // dust / chips / splinters: back off the face toward the shooter, sideways, up; some carried on along its way
      const [pal, n, sp, up, life, grav] = I.bits, b0 = BASE[pal];
      for (let i = 0; i < n; i++) {
        const back = sp * RR(.2, 1), side = sp * RR(-.6, .6), on = I.along * sp * RR(0, 2);
        bit(x, y, h + lift, -ux * back + ux * on - uy * side, -uy * back + uy * on + ux * side, RR(up[0], up[1]), RR(life[0], life[1]), b0 + i % 3, grav);
      }
    }
    if (I.puff) { const [tint, n, size, life, rise] = I.puff; smoke.dust(x, y, h, ux, uy, tint, n, size, life, rise); }
    const [pS, n0, n1] = I.spark;
    if (pS && R() < pS) {   // sparks: glowing streaks bouncing back off the face
      const S = TUNE.sparks, n = Math.round(RR(n0, n1)), b0 = BASE.spark;
      for (let i = 0; i < n; i++) {
        const v = RR(S.speed[0], S.speed[1]), back = v * RR(.3, 1), side = v * RR(-.8, .8);
        bit(x, y, h + lift, -ux * back - uy * side, -uy * back + ux * side, RR(S.up[0], S.up[1]), RR(S.life[0], S.life[1]), b0 + (i % 3), S.grav);
      }
    }
    // the mark: a scuff in the ground (flow's), a hole in a wall / prop / tree (ours)
    if (ground) host.feature('flow')?.stamp?.('bullet', e.x, e.y, ux, uy);
    else if (e.surf === 'prop' || e.surf === 'tree') hole(x, y, h, m);
  }
  // a shot's burning powder: grains out of the muzzle along the shot (ux, uy unit), n of them
  function blast(x, y, h, ux, uy, n) {
    const B = TUNE.blast, b0 = BASE.spark;
    for (let i = 0; i < n; i++) {
      const a = RR(-B.spread, B.spread), c = Math.cos(a), s = Math.sin(a), v = RR(B.speed[0], B.speed[1]);
      bit(x, y, h, (ux * c - uy * s) * v, (uy * c + ux * s) * v, RR(-.4, .8), RR(B.life[0], B.life[1]), b0 + (i % 3), 0);
    }
  }

  const F = {
    name: 'gunfx', label: 'Gun fx', on: true, TUNE,
    toggle() { F.on = !F.on; return F.on; },
    surfaceOf,   // (bullet.impact -> its material: for anything that wants it, e.g. a sound per surface)
    count() { let h = 0; for (let i = 0; i < HM_; i++) if (ht[i] < TUNE.holes.life) h++; return {bits: bN, smoke: smoke.n, holes: h, cases: cN}; },   // (tests)
    // the smoke's look (gunfx/smoke.js): Shift+V cycles it (a dev key), the menu's Dev tab picks it
    settings: () => [{label: 'Smoke', options: SMOKE.STYLES, get: () => SMOKE.style, set: v => { SMOKE.style = v; }}],
    onKey(k, e) { if (k !== 'v' || !e?.shiftKey) return false; const S = SMOKE.STYLES; SMOKE.style = S[(S.indexOf(SMOKE.style) + 1) % S.length]; return true; },
    view(dt, evs) {
      const g = gun();
      for (const e of evs) {
        if (e.type === 'foe.shoot') {   // a gunman's shot: the flash at its muzzle along the shot, grains, the smoke
          const navy = e.gun === 'coach' || e.gun === 'navy', Q = OF[ofI]; ofI = (ofI + 1) % OF.length;   // (coach: the bruiser's coach gun, the big flash)
          flashOf(Q, e, navy ? TUNE.flash.navy * 1.15 : 1); OFL = Q;
          blast(e.x, e.y, e.h, e.vx, e.vy, TUNE.blast.foe + (navy ? 2 : 0));
          smoke.shot(e.x, e.y, e.h, e.vx, e.vy, SMOKE.puffs + (navy ? 2 : 0), navy ? 1.4 : 1, navy ? 1.3 : 1.1, false);
        } else if (e.type === 'player.shoot') {
          const w = WEAPONS[e.gun] || {}, navy = e.gun === 'brass_navy';
          // the flash at the shot's muzzle (where the sim put it: the pose's muzzle on screen, the aim's depth), along the
          // shot, not the barrel of the frame showing: that one is already kicking up
          flashOf(FL, e, (navy ? TUNE.flash.navy : 1) * (e.fan ? TUNE.flash.fan : 1));
          blast(e.x, e.y, e.h, e.vx, e.vy, navy ? TUNE.blast.navy : TUNE.blast.n);
          smoke.shot(e.x, e.y, e.h, e.vx, e.vy, SMOKE.puffs + (navy ? 1 : 0), navy ? 1.25 : 1, w.push ? 1 + w.push : 1, true);   // (+ the cylinder gap's jets)
          wispFor = SMOKE.wisp;
        } else if (e.type === 'bullet.impact') {
          const T = TR[trI]; trI = (trI + 1) % TRN;
          T.x0 = e.x0 ?? e.x; T.y0 = e.y0 ?? e.y; T.h0 = e.h0 ?? e.h; T.x1 = e.x; T.y1 = e.y; T.h1 = e.h; T.t = 0;
          impact(e);
        } else if ((e.type === 'player.reload' || e.type === 'foe.reload') && e.phase === 'eject' && e.n > 0) {
          for (let i = 0; i < e.n; i++) {
            const k = cI; cI = (cI + 1) % CM; if (cN < CM) cN++;
            cx[k] = e.x + RR(-.08, .08); cy[k] = e.y + RR(-.08, .08); ch[k] = e.z + RR(1.05, 1.25);
            cvx[k] = RR(-.7, .7); cvy[k] = RR(-.7, .7); cvh[k] = RR(-.2, .6); ct[k] = -i * .03;
          }
        }
      }
      if (FL.t > -TUNE.flash.light.life) FL.t -= dt;   // (past 0 too: the light outlives the flash)
      for (const Q of OF) if (Q.t > -TUNE.flash.light.life) Q.t -= dt;
      // the wisp off the barrel after a shot, and while the gunslinger blows on it
      const blowing = !!g && g.blowing;
      if (g && (wispFor > 0 || blowing)) {
        wispFor -= dt; wispT -= dt;
        if (wispT <= 0) {
          wispT = SMOKE.wispGap * (blowing ? .6 : 1);
          const m = muzzleWorld(g);
          if (m) smoke.wisp(m.x, m.y, m.h, blowing);
        }
      }
      // smoke: slows, rolls in its eddies, rises, goes with the wind where it is and is torn up by it; puffs past their life
      // are swapped out
      const Wd = host.wind; smoke.step(dt, Wd?.on && Wd.at ? Wd : null);
      for (const T of TR) if (T.t < 9) T.t += dt;
      // cases: fall, bounce, lie, then go
      const CS = TUNE.cases;
      for (let i = 0; i < cN; i++) {
        if ((ct[i] += dt) < 0 || ct[i] > CS.life) continue;
        if (cvh[i] === 0 && cvx[i] === 0 && cvy[i] === 0) continue;   // resting
        cvh[i] -= CS.grav * dt; cx[i] += cvx[i] * dt; cy[i] += cvy[i] * dt; ch[i] += cvh[i] * dt;
        const gz = host.elev(cx[i], cy[i]);
        if (ch[i] <= gz) { ch[i] = gz; if (cvh[i] < -1.2) { cvh[i] = -cvh[i] * CS.bounce; cvx[i] *= .5; cvy[i] *= .5; } else cvh[i] = cvx[i] = cvy[i] = 0; }
      }
      // bits: dust, chips, splinters, sparks, powder grains
      for (let i = bN - 1; i >= 0; i--) {
        bt[i] += dt;
        if (bt[i] >= bl[i]) { bN--; bx[i] = bx[bN]; by[i] = by[bN]; bh[i] = bh[bN]; bvx[i] = bvx[bN]; bvy[i] = bvy[bN]; bvh[i] = bvh[bN]; bt[i] = bt[bN]; bl[i] = bl[bN]; bk[i] = bk[bN]; bg[i] = bg[bN]; continue; }
        const d = Math.exp(-3 * dt); bvx[i] *= d; bvy[i] *= d; bvh[i] -= bg[i] * dt;
        bx[i] += bvx[i] * dt; by[i] += bvy[i] * dt; bh[i] += bvh[i] * dt;
        const gz = host.elev(bx[i], by[i]); if (bh[i] < gz) { bh[i] = gz; bvh[i] = 0; bvx[i] *= .5; bvy[i] *= .5; }
      }
      for (let i = 0; i < HM_; i++) if (ht[i] < 99) ht[i] += dt;
    },
    frame() {
      smoke.frame();
      if (FL.t > 0) drawFlash(FL);
      for (const Q of OF) if (Q.t > 0) drawFlash(Q);
      flashes.frame();
      // tracers: every bullet in flight, a streak behind its head (length capped by how far it has come)
      const T = TUNE.tracer;
      for (const a of host.arrows) {
        if (a.kind !== 'bullet' || a.life <= -9) continue;
        const w = WEAPONS[a.gun], v = hypot3(a.vx, a.vy, a.vh) || 1, ux = a.vx / v, uy = a.vy / v, uh = a.vh / v;
        tracer(host, a.x, a.y, a.h, ux, uy, uh, w ? (w.range / w.speed - a.life) * w.speed + .3 : T.len);
      }
      for (const S of TR) {   // a bullet's last step, shrinking into where it ended
        if (S.t >= T.last) continue;
        const k = S.t / T.last, x0 = S.x0 + (S.x1 - S.x0) * k, y0 = S.y0 + (S.y1 - S.y0) * k, h0 = S.h0 + (S.h1 - S.h0) * k;
        host.line(x0, y0, h0, S.x1, S.y1, S.h1, k < .5 ? C.head : C.mid, true);
      }
      const z = host.zoom, O = PT;
      for (let i = 0; i < cN; i++) {
        if (ct[i] < 0 || ct[i] > TUNE.cases.life) continue;
        O.size = z; O.emit = false; O.alpha = ct[i] > TUNE.cases.life - .6 ? .5 : 1;
        host.point(cx[i], cy[i], ch[i] + .01, (Math.floor(ct[i] * 9 + i) & 3) === 0 ? C.brassHi : C.brass, O);
      }
      const sk0 = TUNE.sparks.streak;
      for (let i = 0; i < bN; i++) {   // sparks and grains as glowing streaks along their flight, the rest as points
        const k = bk[i];
        if (EMIT[k]) { host.line(bx[i], by[i], bh[i], bx[i] - bvx[i] * sk0, by[i] - bvy[i] * sk0, bh[i] - bvh[i] * sk0, COLS[bt[i] / bl[i] > .6 ? Math.min(k + 1, BASE.spark + 2) : k], true); continue; }
        O.size = z; O.alpha = bt[i] / bl[i] > .6 ? .5 : 1; O.emit = false;
        host.point(bx[i], by[i], bh[i], COLS[k], O);
      }
      const H = TUNE.holes, rx = Math.cos(host.yaw) / host.PPM, ry = -Math.sin(host.yaw) / host.PPM;   // (one art px to the right on screen)
      for (let i = 0; i < HM_; i++) {   // holes: the dark middle 2 px across, a pale rim pixel above it, fading at the end
        if (ht[i] >= H.life) continue;
        O.size = z; O.emit = false; O.alpha = ht[i] > H.life - H.fade ? Math.max(.15, (H.life - ht[i]) / H.fade) : 1;
        const cs = HCOL[hk[i]]; host.point(hx[i], hy[i], hh[i], cs[0], O); host.point(hx[i] + rx, hy[i] + ry, hh[i], cs[0], O); host.point(hx[i], hy[i], hh[i] + 1 / host.PPMH, cs[1], O);
      }
      O.alpha = 1; O.emit = false;
    },
    lights() {   // the flashes' light, thrown forward along the shot: yours, and the newest gunman's
      const on = TUNE.flash.life - TUNE.flash.light.life;
      LITS.length = 0;
      if (FL.t > on) chain(LCH, FL);
      if (OFL.t > on) chain(OCH, OFL);
      return LITS;
    },
    hd(q, sc) { smoke.hd(q, sc); },   // (the soft smoke look's puffs; the flashes are in the world now)
  };
  const PT = {size: 1, alpha: 1, emit: false};
  return F;
}
