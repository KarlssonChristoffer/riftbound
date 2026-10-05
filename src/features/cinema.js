// CINEMA (render3d): leave the keys and the mouse alone for a while and the game becomes a film of itself. A director cuts
// between shots through a free PERSPECTIVE camera (gfx.js setCine: the same renderer at a resolution of its own, with a sky
// and air of its own): the Ranger from behind looking out, low against the sky, a slow orbit; a bird that just landed
// on a pillar, a fish jumping, a fire at night, a crown seen from below, the trees black against a low sun. Letterbox
// bars, a fade in, a dip to black now and then between cuts. Any key, click, wheel or mouse move ends it at once: the
// game's own view in the next frame.
// SHOW ONLY: nothing here touches the sim (the sim reads the screen through the game's view: G.gameToScreen). Draws come
// from its own generator (core/rng.js mulberry32), never Math.random.
// ?cinema=0 never starts it; ?cinema=now starts it at once and keeps it through input (captures, tests); ?cineidle=<s>
// the wait (TUNE.idle). The menu's Game tab: "Cinematic camera" starts it when the menu closes.
// FEATURE CONTRACT (main.js): create(host) -> F: view (what happens: the events worth a look), camera (the shot's clock and
// the pose, before the renderer takes its view), frame (the director: starts, cuts, fades), hd (the bars and fades; cineHd:
// core/loop.js draws only such overlays while the cinema camera is on), menu, toggle, info, start / stop (tests).
// OWNS: the cinema camera's pose and sky (CAM, handed to G.setCine), the shot, its bars and fades, its input listeners.
// READS: host.player / P / mood / env / biome / paused / lock / elev / entities.near / world.lights / feature('game'), the
//   frame's events. EMITS: nothing. BUDGET: ~0.02 ms a frame (a shot is planned every 6-11 s: ~0.1 ms then).
import {flags} from '../core/flags.js';
import {clamp, hypot2} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {WORLD} from '../world/world.js';

export const TUNE = {
  idle: 45,           // s without a key, a click, the wheel or a mouse move before the film starts
  fadeIn: 1.1,        // s: the game fades to black and the first shot fades in
  dip: .5,            // s: a dip to black between two shots (every few cuts, and before a shot far from the last)
  bars: 2.35,         // the letterbox's aspect (0: none)
  shot: [6.5, 11],    // s a shot lasts
  near: 26,           // m round the player the director looks for subjects
  fresh: 4,           // s an event stays news (a bird that just landed is still there)
  news: 2.5,          // s a shot runs at least before the director cuts away to news (a bird landing, a flock going up)
  newsGap: 20,        // s at least between two such cuts
  air: .011,          // the air's density (1/m: the distance fog toward the horizon) on a clear day; fog and rain add to it
  px: 3,              // screen px a pixel of the film (whole: even pixels; at most the game's own scale, its art pixels): smaller is
                      // finer and glides more; on a 1440p ultrawide the game's art pixel is 5
};

// the skies (zenith, horizon) by night / by day / a low sun's, and each biome's tint on them
const SKY = {nz: [.025, .04, .1], nh: [.06, .08, .16], dz: [.27, .47, .85], dh: [.68, .79, .9], wz: [.24, .22, .42], wh: [1, .6, .34]};
const ONE = [1, 1, 1], NOSKY = {}, MOON = [.78, .84, 1], WARM = [.2, .02, -.2];   // the moon's colour; how a low sun warms its own (r, g, b)
const TINT = {ruins: [1, 1, 1], frost: [.9, .97, 1.08], ember: [1.15, .8, .7], rift: [1, .74, 1.25], desert: [1.08, .97, .84]};
// what stands in the way of a camera (a line of sight): the top of each kind (m above its base); a rect is a wall
const TOP = {pillar: 3.6, pillar_broken: 2, tower: 9, tree: 7, wall_n: 3.2, wall_w: 3.2, wall_e: 3.2, gatepost: 3, brazier: 1.3, torch: 2.2, beacon: 3, rock_big: 1.6, mountain: 20, bush: 1};
const SOFT = new Set(['tuft', 'reed', 'leaf', 'snow', 'fern', 'twig', 'limb', 'branch', 'blood', 'spark', 'mote', 'moth', 'dragonfly']);
const FACE = Math.PI / 8;   // a sprite's facing step: the atlases draw 16 (view/hero.js ND)
const NEWSY = {bird: 1, flock: 1, water: 1, fire: 1, weed: 1};   // the shots of news (never cut away from for more news)
const WANT = {'wildlife.bird_perch': 'bird', 'wildlife.birds_scatter': 'flock', 'wildlife.fish_jump': 'water', 'wildlife.frog_jump': 'water', 'fire.ignite': 'fire', 'tumbleweed.bounce': 'weed'};

export async function create(host) {
  const G = host.G, THREE = host.THREE, mode = flags.get('cinema'), HOLD = mode === 'now';
  const F = {name: 'cinema', label: 'Cinematic camera', ambient: true, on: mode !== '0', cineHd: true, TUNE, shots: 0, only: ''};   // only: tests, the one kind of shot to plan
  const idleS = +flags.get('cineidle') > 0 ? +flags.get('cineidle') : TUNE.idle;
  const R = mulberry32((Date.now() ^ 0x5bd1e995) >>> 0), rr = (a, b) => a + R() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t, ease = t => t * t * (3 - 2 * t);

  // ---- the people at the keys: any key, click, wheel or mouse move (more than a nudge) is someone back
  let lastIn = performance.now(), mx = NaN, my = NaN;
  const poke = () => { lastIn = performance.now(); };
  addEventListener('keydown', poke, true); addEventListener('mousedown', poke, true);
  addEventListener('wheel', poke, {capture: true, passive: true}); addEventListener('touchstart', poke, {capture: true, passive: true});
  addEventListener('mousemove', e => {
    if (mx === mx && Math.abs(e.screenX - mx) + Math.abs(e.screenY - my) <= 4) return;
    if (mx === mx) poke(); mx = e.screenX; my = e.screenY;
  }, true);

  // ---- what happens: a ring of recent moments worth a look (the frame's events, from the views of the frame before)
  const NEWS = Array.from({length: 24}, () => ({kind: '', x: 0, y: 0, h: 0, t: -1e9, used: false})); let newsI = 0;

  // ---- the camera handed to the renderer (G.setCine reads it at every setView), and its sky
  const CAM = {pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, near: .15, far: 400, air: TUNE.air, px: TUNE.px,
    sky: {zen: [0, 0, 0], hor: [0, 0, 0], sun: [1, 1, 1], dir: [0, 1, 0], disk: .032}};
  // the shot: a move (p0 -> p1, looking from l0 -> l1) or an orbit round its subject (angle a0 -> a1, radius, height), in
  // the arena's axes (x, y on the ground, h up); `follow`: the subject is the player (his feet, read every frame)
  const S = {kind: '', type: 'move', t: 0, dur: 8, follow: false, f0: 40, f1: 40, side: 0,   // side: m the look goes to the camera's right (the subject off the middle)
    c: {x: 0, y: 0, h: 0}, p0: {x: 0, y: 0, h: 0}, p1: {x: 0, y: 0, h: 0}, l0: {x: 0, y: 0, h: 0}, l1: {x: 0, y: 0, h: 0},
    a0: 0, a1: 0, r0: 4, r1: 4, h0: 1, h1: 1, lh0: 1, lh1: 1};
  let state = 'off', fadeK = 0, barK = 0, phase = '', tStart = 0, pending = false, cuts = 0, lastKinds = ['', ''], newsT = -1e9;

  const game = () => host.feature('game');
  const allowed = () => F.on && !host.paused && !host.lock && game()?.mode === 'sandbox' && (HOLD || host.P.state === 'idle');
  const feet = o => { const p = host.player; o.x = p.x; o.y = p.y; o.h = host.P.z || 0; return o; };
  const ground = (x, y) => host.elev(x, y) || 0;

  // ---- where a camera may stand: inside the world, above the ground, out of walls and crowns, with a clear line to (sx, sy, sh)
  const NEAR = [];
  function solidAt(x, y, h, sx, sy, cam) {
    if (ground(x, y) > h) return true;
    for (const p of host.entities.near(x, y, cam ? 2.4 : 1, NEAR)) {
      if (p.broken || p.gone || SOFT.has(p.kind) || hypot2(p.x - sx, p.y - sy) < 1.1) continue;   // (the subject's own prop)
      const z = p.z || 0, top = z + (TOP[p.kind] ?? (p.rect ? 3 : 1.5));
      if (h > top || h < z - .2) continue;
      if (cam && p.kind === 'tree' && h > 1.5 && hypot2(p.x - x, p.y - y) < 2.4) return true;   // (inside a crown)
      const m = cam ? .9 : .3;   // (a camera keeps clear of a pillar or a wall: right by the lens it fills half the frame)
      if (p.rect ? x > p.rect[0] - m && x < p.rect[2] + m && y > p.rect[1] - m && y < p.rect[3] + m : (p.r || 0) > .12 && hypot2(p.x - x, p.y - y) < p.r + m) return true;
    }
    return false;
  }
  function okCam(x, y, h, sx, sy, sh) {
    if (x < WORLD.x0 + 1.5 || x > WORLD.x1 - 1.5 || y < WORLD.y0 + 1.5 || y > WORLD.y1 - 1.5) return false;
    if (h < ground(x, y) + .15 || solidAt(x, y, h, sx, sy, true)) return false;
    for (let i = 1; i < 12; i++) { const t = i < 10 ? i / 10 : i === 10 ? .94 : .975; if (solidAt(x + (sx - x) * t, y + (sy - y) * t, h + (sh - h) * t, sx, sy, false)) return false; }
    return true;
  }
  const at = (o, c, a, d, h) => { o.x = c.x + Math.sin(a) * d; o.y = c.y + Math.cos(a) * d; o.h = c.h + h; return o; };   // a: 0 = from the south
  const P0 = {x: 0, y: 0, h: 0}, P1 = {x: 0, y: 0, h: 0}, PM = {x: 0, y: 0, h: 0}, C0 = {x: 0, y: 0, h: 0};
  // an orbit of c: tried from a few angles round `a` (spread), the camera checked at both ends and the middle
  // (round the Ranger, `follow`: an orbit is centred on one of his sprite's facings and turns less than a facing step, so
  // he never flips to the next drawing mid-shot. The camera's heading round c is its angle a, less atan(side / r) when the
  // look goes `side` m to the right (thirds); the game's yaw is his sprite's frame)
  function orbit(kind, c, a, spread, turn, r0, r1, h0, h1, lh0, lh1, fov, dur, follow, side = 0) {
    const dl = Math.atan2(side, (r0 + r1) / 2);
    if (follow) { turn = clamp(turn, -FACE * .85, FACE * .85); a = host.yaw + Math.round((a + turn / 2 - dl - host.yaw) / FACE) * FACE + dl - turn / 2; }
    for (let k = 0; k < 8; k++) {
      const a0 = a + (k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (follow ? FACE : spread / 4) : 0), a1 = a0 + turn;
      at(P0, c, a0, r0, h0); at(P1, c, a1, r1, h1); at(PM, c, (a0 + a1) / 2, (r0 + r1) / 2, (h0 + h1) / 2);
      const lh = c.h + (lh0 + lh1) / 2;
      if (!okCam(P0.x, P0.y, P0.h, c.x, c.y, lh) || !okCam(P1.x, P1.y, P1.h, c.x, c.y, lh) || !okCam(PM.x, PM.y, PM.h, c.x, c.y, lh)) continue;
      return {kind, type: 'orbit', c: {...c}, a0, a1, r0, r1, h0, h1, lh0, lh1, f0: fov, f1: fov * .97, dur, follow, side};
    }
    return null;
  }
  // a move: from p0 to p1 looking from l0 to l1; both ends need a clear line to `of` (what the shot is of: by default where
  // it looks at the end; a vista: a few metres out, past which walls may stand)
  function move(kind, p0, p1, l0, l1, f0, f1, dur, of = null) {
    const a = of || l0, b = of || l1, mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, mh = (p0.h + p1.h) / 2;
    if (!okCam(p0.x, p0.y, p0.h, a.x, a.y, a.h) || !okCam(p1.x, p1.y, p1.h, b.x, b.y, b.h) || !okCam(mx, my, mh, b.x, b.y, b.h)) return null;
    return {kind, type: 'move', p0: {...p0}, p1: {...p1}, l0: {...l0}, l1: {...l1}, f0, f1, dur, follow: false, c: {...l1}, side: 0};
  }

  // ---- the director: everything worth a shot now, weighted; never the same kind three times running
  function sunDirH() { const d = CAM.sky.dir, l = Math.hypot(d[0], d[2]) || 1; return {x: d[0] / l, y: d[2] / l, el: Math.asin(clamp(d[1], -1, 1))}; }
  // one piece of news as a candidate shot (true when it is fresh and near enough to be one)
  function news(e, me, now, add) {
    if (e.used || now - e.t > TUNE.fresh || hypot2(e.x - me.x, e.y - me.y) > TUNE.near) return false;
    const c = {x: e.x, y: e.y, h: e.kind === 'bird' ? e.h : ground(e.x, e.y)};
    // a bird: from just above its perch (a crenellation or a pillar's lip hides it from below), close, a long lens
    if (e.kind === 'bird') add(5, 'bird', () => { const s = orbit('bird', c, rr(0, 6.28), 6.28, (R() < .5 ? -1 : 1) * .15, 2.6, 2.2, .55, .5, .1, .1, 28, rr(5.5, 7.5), false); if (s) e.used = true; return s; });
    else if (e.kind === 'flock') add(3, 'flock', () => { const a = rr(0, 6.28); at(P0, c, a, 7.5, 1); at(P1, c, a, 7, 1.1); const s = move('flock', P0, P1, {x: c.x, y: c.y, h: c.h + 1}, {x: c.x, y: c.y, h: c.h + 4.5}, 52, 50, rr(5.5, 7)); if (s) e.used = true; return s; });
    else if (e.kind === 'water') add(2.5, 'water', () => { const s = orbit('water', c, rr(0, 6.28), 6.28, (R() < .5 ? -1 : 1) * .2, 3.4, 3, 1.25, 1.05, .1, .1, 40, rr(6, 8), false); if (s) e.used = true; return s; });
    else if (e.kind === 'fire' || e.kind === 'weed') add(2.5, e.kind, () => { const s = orbit(e.kind, c, rr(0, 6.28), 6.28, .25, 3.2, 2.7, .6, .5, .4, .4, 40, rr(6, 8), false); if (s) e.used = true; return s; });
    return true;
  }
  function plan(first, only = null) {
    const C = [], add = (w, kind, f) => { if (w > 0) C.push({w, kind, f}); };
    const me = feet({x: 0, y: 0, h: 0}), fa = host.player.faceAngle, fx = Math.sin(fa), fy = Math.cos(fa), now = performance.now() / 1000;
    const sun = sunDirH(), lowSun = sun.el > -.03 && sun.el < .38 && host.env.part !== 'night', night = host.env.part === 'night';
    const d = () => rr(TUNE.shot[0], TUNE.shot[1]);
    if (only) return news(only, me, now, add) ? pickOf(C) : null;
    // the Ranger
    add(first ? 4 : 2, 'hero_behind', () => {   // over his shoulder, out where he looks
      const r = (R() < .5 ? -1 : 1) * 1.25, b = {x: me.x - fx * 2.8 + fy * r, y: me.y - fy * 2.8 - fx * r, h: me.h + 1.5}, b1 = {x: me.x - fx * 2.3 + fy * r, y: me.y - fy * 2.3 - fx * r, h: me.h + 1.45};
      const s = move('hero_behind', b, b1, {x: me.x + fx * 7, y: me.y + fy * 7, h: me.h + 1.2}, {x: me.x + fx * 8, y: me.y + fy * 8, h: me.h + 1.05}, 46, 44, d(), {x: me.x, y: me.y, h: me.h + 1.2});
      if (s) s.side = r * .55; return s;
    });
    const third = m => (R() < .5 ? -1 : 1) * m;   // (the subject off the middle, to one side or the other)
    add(1.6, 'hero_low', () => orbit('hero_low', me, fa + (R() < .5 ? -1 : 1) * rr(.5, 1.1), 1.2, (R() < .5 ? -1 : 1) * .3, 2.3, 2.1, .22, .25, 1.25, 1.2, 52, d(), true, third(.35)));
    add(1.8, 'hero_orbit', () => orbit('hero_orbit', me, rr(0, 6.28), 6.28, (R() < .5 ? -1 : 1) * .75, 4.6, 4.2, 1.9, 1.7, 1, 1, 40, d() + 1, true, third(.7)));
    add(.8, 'hero_crane', () => orbit('hero_crane', me, rr(0, 6.28), 6.28, (R() < .5 ? -1 : 1) * .35, 2.8, 5.5, .5, 4.8, 1, .9, 42, d() + 1, true));
    add(1.2, 'hero_profile', () => {   // from his side, the room in front of him (lead room)
      const sgn = R() < .5 ? -1 : 1;
      return orbit('hero_profile', me, fa + sgn * Math.PI / 2, .6, sgn * .12, 3.4, 3, 1.25, 1.2, 1.2, 1.2, 34, d(), true, sgn * .55);
    });
    add(first ? 3 : 1.4, 'hero_far', () => orbit('hero_far', me, rr(0, 6.28), 6.28, (R() < .5 ? -1 : 1) * .3, 15, 14, 5.5, 4.8, 1, 1, 38, d() + 2, true));
    // what just happened round here
    for (const e of NEWS) news(e, me, now, add);
    // fires (the lights of braziers, torches, beacons, campfires): by night and at dusk
    const W = host.world, fires = [];
    if (W?.lights) for (const l of W.lights) if (l.c && l.c[0] > l.c[2] * 1.3 && hypot2(l.x - me.x, l.z - me.y) < TUNE.near) fires.push(l);
    if (fires.length) add(night ? 3 : lowSun ? 1.5 : .3, 'fire', () => {
      const l = fires[Math.floor(R() * fires.length)], c = {x: l.x, y: l.z, h: l.y};
      return orbit('fire', c, rr(0, 6.28), 6.28, (R() < .5 ? -1 : 1) * .22, 2.7, 2.3, -.25, -.3, 0, 0, 36, d(), false);
    });
    // the trees: a crown from below against the sky; black against a low sun
    const trees = []; for (const p of host.entities.near(me.x, me.y, TUNE.near, NEAR)) if (p.kind === 'tree' && !p.gone && !p.broken) trees.push(p);
    if (trees.length) {
      const wind = host.wind, gust = wind?.strength > 1.4 ? 1.5 : 1, autumn = host.env.leafFall > .2 ? 1.4 : 1;
      add(1.4 * gust * autumn, 'tree_up', () => {
        const p = trees[Math.floor(R() * trees.length)], c = {x: p.x, y: p.y, h: ground(p.x, p.y)}, a = rr(0, 6.28);
        for (let k = 0; k < 6; k++) {
          const s = move('tree_up', at(P0, c, a + k, 3, .4), at(P1, c, a + k + .08, 2.9, .45), {x: c.x, y: c.y, h: c.h + 2.2}, {x: c.x, y: c.y, h: c.h + 4.4}, 56, 54, d());
          if (s) return s;
        }
        return null;
      });
      if (lowSun) add(4, 'tree_sun', () => {   // a tree between the camera and the sun (the trees in reach in turn, from a random one)
        const sx = sun.x, sy = sun.y, px = -sy, py = sx, o = rr(-1.2, 1.2), i0 = Math.floor(R() * trees.length);
        for (let k = 0; k < Math.min(trees.length, 6) * 3; k++) {
          const p = trees[(i0 + Math.floor(k / 3)) % trees.length], c = {x: p.x, y: p.y, h: ground(p.x, p.y)}, back = 5 + (k % 3) * 2;
          const s = move('tree_sun', {x: c.x - sx * back + px * (o - .8), y: c.y - sy * back + py * (o - .8), h: c.h + 1.2}, {x: c.x - sx * back + px * (o + .8), y: c.y - sy * back + py * (o + .8), h: c.h + 1.3},
            {x: c.x + sx * 5, y: c.y + sy * 5, h: c.h + 2.8}, {x: c.x + sx * 5, y: c.y + sy * 5, h: c.h + 2.6}, 46, 46, d() + 1, {x: c.x, y: c.y, h: c.h + 2.4});
          if (s) return s;
        }
        return null;
      });
    }
    // the view: where he stands, out across the world (toward a low sun), a slow pan
    add(lowSun ? 3 : 1, 'vista', () => {
      const a = lowSun ? Math.atan2(sun.x, sun.y) : fa + rr(-1, 1), turn = (R() < .5 ? -1 : 1) * .3;
      const p = {x: me.x + Math.sin(a) * .7, y: me.y + Math.cos(a) * .7, h: me.h + 1.75};   // (just in front of him: he is behind the camera)
      return move('vista', p, p, {x: p.x + Math.sin(a - turn) * 40, y: p.y + Math.cos(a - turn) * 40, h: me.h + 3}, {x: p.x + Math.sin(a + turn) * 40, y: p.y + Math.cos(a + turn) * 40, h: me.h + 3}, 55, 52, d() + 1,
        {x: p.x + Math.sin(a) * 4, y: p.y + Math.cos(a) * 4, h: me.h + 1.8});
    });
    if (F.only) { const k = C.filter(c => c.kind === F.only); if (k.length) { const s = pickOf(k); if (s) return s; } }   // (tests: F.only = a kind)
    const s = pickOf(C); if (s) return s;
    return orbit('hero_orbit', me, rr(0, 6.28), 6.28, .6, 5, 4.6, 2, 1.8, 1, 1, 40, 9, true) || orbit('hero_far', me, 0, 6.28, .3, 9, 8, 6, 5, 1, 1, 40, 9, true);
  }
  // a weighted pick (the kind just shown at a third of its weight; never the same kind three times running); each maker
  // may find no place for its camera: then the next pick
  function pickOf(C) {
    const wOf = c => c.kind === lastKinds[0] ? (lastKinds[0] === lastKinds[1] ? 0 : c.w / 3) : c.w;
    while (C.length) {
      let tot = 0; for (const c of C) tot += wOf(c);
      if (tot <= 0) break;
      let u = R() * tot, i = 0; for (; i < C.length - 1; i++) { u -= wOf(C[i]); if (u <= 0) break; }
      const s = C[i].f(); C.splice(i, 1);
      if (s) return s;
    }
    return null;
  }
  function begin(s) {
    if (!s) return false;
    Object.assign(S, {kind: s.kind, type: s.type, t: 0, dur: s.dur, follow: !!s.follow, f0: s.f0, f1: s.f1, side: s.side || 0});
    Object.assign(S.c, s.c);
    if (s.type === 'orbit') Object.assign(S, {a0: s.a0, a1: s.a1, r0: s.r0, r1: s.r1, h0: s.h0, h1: s.h1, lh0: s.lh0, lh1: s.lh1});
    else { Object.assign(S.p0, s.p0); Object.assign(S.p1, s.p1); Object.assign(S.l0, s.l0); Object.assign(S.l1, s.l1); }
    lastKinds[1] = lastKinds[0]; lastKinds[0] = s.kind; F.shots++; cuts++;
    return true;
  }
  // the camera at this moment of the shot (no allocation: into CAM)
  function pose() {
    const u = ease(clamp(S.t / S.dur, 0, 1)), c = S.follow ? feet(C0) : S.c;
    if (S.type === 'orbit') {
      const a = lerp(S.a0, S.a1, u), r = lerp(S.r0, S.r1, u);
      CAM.pos.set(c.x + Math.sin(a) * r, c.h + lerp(S.h0, S.h1, u), c.y + Math.cos(a) * r);
      CAM.look.set(c.x, c.h + lerp(S.lh0, S.lh1, u), c.y);
    } else {
      CAM.pos.set(lerp(S.p0.x, S.p1.x, u), lerp(S.p0.h, S.p1.h, u), lerp(S.p0.y, S.p1.y, u));
      CAM.look.set(lerp(S.l0.x, S.l1.x, u), lerp(S.l0.h, S.l1.h, u), lerp(S.l0.y, S.l1.y, u));
    }
    if (S.side) {   // the subject off the middle: the look goes S.side m to the camera's right (ground plane)
      const dx = CAM.look.x - CAM.pos.x, dz = CAM.look.z - CAM.pos.z, l = Math.hypot(dx, dz) || 1;
      CAM.look.x -= dz / l * S.side; CAM.look.z += dx / l * S.side;
    }
    // a breath of a hand-held camera (a few mm: the low resolution turns more into a shimmer)
    const T = S.t; CAM.look.x += Math.sin(T * .7) * .012; CAM.look.y += Math.sin(T * .53 + 1.3) * .009;
    CAM.fov = lerp(S.f0, S.f1, u);
  }
  // the sky from the clock's mood: zenith / horizon by night, day and a low sun, greyed by cloud, rain, snow and fog;
  // the sun (by night the moon: the night mood's light) where the light comes from
  function sky() {
    const m = host.mood, env = host.env, sk = env.sky || NOSKY, o = CAM.sky, amb = m.amb, c = m.sun.c || ONE;
    const la = .3 * amb[0] + .55 * amb[1] + .15 * amb[2], day = clamp((la - .3) / .55, 0, 1), night = env.part === 'night';
    const warm = night ? 0 : clamp((c[0] - c[2] - .2) * 2.2, 0, 1) * (1 - .4 * day);
    const cloud = clamp(Math.max(sk.cloud || 0, sk.fog || 0, sk.rain || 0, sk.snow || 0), 0, 1), tint = TINT[host.biome.id] || TINT.ruins;
    for (let i = 0; i < 3; i++) {
      let z = lerp(SKY.nz[i], SKY.dz[i], day), h = lerp(SKY.nh[i], SKY.dh[i], day);
      z = lerp(z, SKY.wz[i], warm * .6); h = lerp(h, SKY.wh[i], warm * .85);
      const g = la * (.74 + .04 * i);
      o.zen[i] = lerp(z, g * .85, cloud * .8) * tint[i]; o.hor[i] = lerp(h, g, cloud * .8) * tint[i];
      o.sun[i] = (night ? MOON[i] * .75 : Math.min(1, c[i] * (1 + WARM[i] * warm))) * (1 - cloud * .8);
    }
    const az = m.sun.az * Math.PI / 180, el = m.sun.el * Math.PI / 180;
    o.dir[0] = Math.sin(az) * Math.cos(el); o.dir[1] = Math.sin(el); o.dir[2] = -Math.cos(az) * Math.cos(el);
    o.disk = cloud > .55 ? 0 : night ? .022 : .032;
    CAM.air = TUNE.air + (sk.fog || 0) * .05 + (sk.rain || 0) * .015 + (sk.snow || 0) * .02;
  }

  // ---- on and off
  function start() { state = 'in'; phase = 'out'; fadeK = 0; tStart = performance.now(); cuts = 0; lastKinds[0] = lastKinds[1] = ''; CAM.px = TUNE.px; }
  function stop() { if (state === 'off') return; state = 'off'; phase = ''; fadeK = barK = 0; G.setCine(null); }
  function cutTo(first) { sky(); if (begin(plan(first))) { pose(); return true; } return false; }

  Object.assign(F, {
    view(dt, evs) {
      if (!evs) return;
      const now = performance.now() / 1000;
      for (let i = 0; i < evs.length; i++) {
        const ev = evs[i], kind = WANT[ev.type]; if (!kind || (kind === 'bird' && ev.off)) continue;
        const n = NEWS[newsI]; newsI = (newsI + 1) % NEWS.length;
        n.kind = kind; n.x = ev.x; n.y = ev.y; n.h = ev.h || 0; n.t = now; n.used = false;
      }
    },
    frame({dt}) {
      dt = clamp(dt || 0, 0, .1);
      const now = performance.now();
      if (state === 'off') {
        if (pending && allowed()) { pending = false; start(); }
        else if (F.on && (HOLD || (now - lastIn) / 1000 >= idleS) && allowed()) start();
        if (state === 'off') return;
      }
      if ((!HOLD && lastIn > tStart) || !allowed()) { stop(); return; }   // someone is back (or the game needs its view)
      barK = Math.min(1, barK + dt / TUNE.fadeIn);
      if (state === 'in') {   // the game fades to black, the first shot fades in
        if (phase === 'out') { fadeK = Math.min(1, fadeK + dt * 2 / TUNE.fadeIn); if (fadeK >= 1) { if (!cutTo(true)) { stop(); return; } G.setCine(CAM); phase = 'in'; } return; }
        fadeK = Math.max(0, fadeK - dt * 2 / TUNE.fadeIn); if (fadeK <= 0) { state = 'on'; phase = ''; }
      }
      // news worth a cut now (a bird landing, a flock going up), once the shot has run a little and isn't news itself
      if (state === 'on' && phase === '' && S.t > TUNE.news && !NEWSY[S.kind] && now - newsT > TUNE.newsGap * 1000) {
        const ts = now / 1000;
        for (const e of NEWS) if (!e.used && (e.kind === 'bird' || e.kind === 'flock') && ts - e.t < 1.5) {
          sky(); const shot = plan(false, e); e.used = true;   // (tried once: a bird with no place for a camera stays unfilmed)
          if (begin(shot)) { pose(); newsT = now; break; }
        }
      }
      // the end of a shot: a cut, or every few cuts a dip to black
      const dip = cuts % 3 === 0 || S.kind === 'vista' || S.kind === 'hero_far';
      if (state === 'on' && phase === '' && S.t >= S.dur - (dip ? TUNE.dip / 2 : 0)) { if (dip) phase = 'dipOut'; else if (!cutTo(false)) S.t = 0; }
      if (phase === 'dipOut') { fadeK = Math.min(1, fadeK + dt * 2 / TUNE.dip); if (fadeK >= 1) { if (!cutTo(false)) S.t = 0; phase = 'dipIn'; } }
      else if (phase === 'dipIn') { fadeK = Math.max(0, fadeK - dt * 2 / TUNE.dip); if (fadeK <= 0) phase = ''; }
    },
    // the shot's clock and the camera's pose: here, not in frame(), because this runs before the renderer takes its view
    // for the frame (render/camera.js follow -> G.setView): posed in frame() it drew every frame with the last one's camera,
    // and the halos placed through it lagged the flames by a frame
    camera(dt) {
      if (state === 'off' || !G.cine) return null;
      S.t += clamp(dt || 0, 0, .1); sky(); pose();
      return null;
    },
    hd(q) {
      if (state === 'off' || (barK <= 0 && fadeK <= 0)) return;
      const W = q.canvas.width, H = q.canvas.height;
      q.fillStyle = '#000';
      if (TUNE.bars > 0 && G.cine) { const bh = Math.round(Math.max(0, (H - W / TUNE.bars) / 2) * ease(barK)); if (bh > 0) { q.fillRect(0, 0, W, bh); q.fillRect(0, H - bh, W, bh); } }
      if (fadeK > 0) { q.globalAlpha = ease(fadeK); q.fillRect(0, 0, W, H); q.globalAlpha = 1; }
    },
    menu() { return F.on ? [{label: 'Cinematic camera', run: () => { pending = true; }}] : []; },
    toggle() { F.on = !F.on; if (!F.on) { stop(); pending = false; } return F.on; },
    start() { pending = true; }, stop,
    info() { let news = 0; for (const e of NEWS) if (e.t > -1e8) news++; return {state, phase, kind: S.kind, news, t: +S.t.toFixed(2), dur: +S.dur.toFixed(2), shots: F.shots, idle: +((performance.now() - lastIn) / 1000).toFixed(1),
      pos: [+CAM.pos.x.toFixed(2), +CAM.pos.y.toFixed(2), +CAM.pos.z.toFixed(2)], look: [+CAM.look.x.toFixed(2), +CAM.look.y.toFixed(2), +CAM.look.z.toFixed(2)], fov: +CAM.fov.toFixed(1)}; },
  });
  return F;
}
