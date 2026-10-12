// CINEMA (render3d): leave the keys and the mouse alone for a while and the game becomes a film of itself. A director cuts
// between shots through a free PERSPECTIVE camera (gfx.js setCine: the same renderer with a camera and air of its own):
// slow drifts, cranes, pull-backs, push-ins and tracks round the Ranger, a wide look toward a low sun; a bird that just
// landed on a pillar, a fish jumping, a fire at night, a crown in the wind, a tree against the low sun. Letterbox bars, a
// fade in, a dip to black now and then between cuts. Any key, click, wheel or mouse move ends it at once: the game's own
// view in the next frame.
// THE LOOK: the world's art is made for the game's view (one scale, from high up: cards painted for it, the pixelizer's
// texels one art pixel each). Close up and at eye level it falls apart (a sprite's pixels 20 px wide, cards seen as boards,
// low-poly rocks, the sky), so the camera keeps to what the art can take: a LONG LENS from 18-50 m away (near parallel
// rays: about one scale across the frame), 32-50 deg down (the game's proportions are a true camera's at ~41 deg; the sky
// never shows), the film at the game's own pixel (TUNE.px), and each shot's lens set by its MAGNIFICATION m: the frame
// covers what the game's view covers / m (m 1: the game's scale at the subject, a texel a pixel there).
// SHOW ONLY: nothing here touches the sim (the sim reads the screen through the game's view: G.gameToScreen). Draws come
// from its own generator (core/rng.js mulberry32), never Math.random.
// ?cinema=0 never starts it; ?cinema=now starts it at once and keeps it through input (captures, tests); ?cineidle=<s>
// the wait (TUNE.idle). The menu's Game tab: "Cinematic camera" starts it when the menu closes.
// FEATURE CONTRACT (main.js): create(host) -> F: view (what happens: the events worth a look), camera (the shot's clock and
// the pose, before the renderer takes its view), frame (the director: starts, cuts, fades), hd (the bars and fades; cineHd:
// core/loop.js draws only such overlays while the cinema camera is on), menu, toggle, info, start / stop (tests).
// OWNS: the cinema camera's pose and sky (CAM, handed to G.setCine), the shot, its bars and fades, its input listeners.
// READS: host.player / P / yaw / VW / VH / PPM / mood / env / biome / paused / lock / photoOpen / elev / itemOf / entities.near /
//   world.lights / feature('game'), the
//   frame's events. EMITS: nothing. BUDGET: ~0.02 ms a frame (a shot is planned every 6-11 s: ~0.1 ms then).
import {flags} from '../core/flags.js';
import {clamp, hypot2} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {WORLD} from '../world/world.js';

export const TUNE = {
  idle: 45,           // s without a key, a click, the wheel or a mouse move before the film starts
  fadeIn: 1.1,        // s: the game fades to black and the first shot fades in
  dip: .5,            // s: a dip to black between two shots (every few cuts, and after a wide one)
  bars: 2.35,         // the letterbox's aspect (0: none)
  shot: [6.5, 11],    // s a shot lasts
  near: 26,           // m round the player the director looks for subjects
  fresh: 4,           // s an event stays news (a bird that just landed is still there)
  news: 2.5,          // s a shot runs at least before the director cuts away to news (a bird landing, a flock going up)
  newsGap: 20,        // s at least between two such cuts
  air: .0035,         // the air's density (1/m: distance fog) on a clear day; fog and rain add to it. Low: the long lens sees
                      // from 20-50 m and the whole frame lies about that far, so more would only grey everything
  px: 0,              // screen px a pixel of the film: 0 = the game's own art pixel (every texel a pixel at m 1); a smaller
                      // whole number is finer (and the texels bigger than its pixels)
  yaw: .6,            // rad: 3 in 4 shots of the Ranger look from within this of the game's own heading (the player knows
                      // the place from there, and the game's view rect is what culls wildlife and sway)
};

// the skies (zenith, horizon) by night / by day / a low sun's, and each biome's tint on them (the frame never shows the
// sky now: they colour the air)
const SKY = {nz: [.025, .04, .1], nh: [.06, .08, .16], dz: [.27, .47, .85], dh: [.68, .79, .9], wz: [.24, .22, .42], wh: [1, .6, .34]};
const ONE = [1, 1, 1], NOSKY = {}, MOON = [.78, .84, 1], WARM = [.2, .02, -.2];   // the moon's colour; how a low sun warms its own (r, g, b)
const TINT = {ruins: [1, 1, 1], frost: [.9, .97, 1.08], ember: [1.15, .8, .7], rift: [1, .74, 1.25], desert: [1.08, .97, .84]};
// what stands in the way of a camera (a line of sight): the top of each kind (m above its base); a rect is a wall
const TOP = {pillar: 3.6, pillar_broken: 2, tower: 9, tree: 7, wall_n: 3.2, wall_w: 3.2, wall_e: 3.2, gatepost: 3, brazier: 1.3, torch: 2.2, beacon: 3, rock_big: 1.6, mountain: 20, bush: 1};
const SOFT = new Set(['tuft', 'reed', 'leaf', 'snow', 'fern', 'twig', 'limb', 'branch', 'blood', 'spark', 'mote', 'moth', 'dragonfly']);
const FACE = Math.PI / 8;   // a sprite's facing step: the atlases draw 16 (view/hero.js ND)
const DEG = Math.PI / 180;
const NEWSY = {bird: 1, flock: 1, water: 1, fire: 1, weed: 1};   // the shots of news (never cut away from for more news)
const WANT = {'wildlife.bird_perch': 'bird', 'wildlife.birds_scatter': 'flock', 'wildlife.fish_jump': 'water', 'wildlife.frog_jump': 'water', 'fire.ignite': 'fire', 'tumbleweed.bounce': 'weed'};

export async function create(host) {
  const G = host.G, THREE = host.THREE, mode = flags.get('cinema'), HOLD = mode === 'now';
  const F = {name: 'cinema', label: 'Cinematic camera', ambient: true, on: mode !== '0', cineHd: true, TUNE, shots: 0, only: ''};   // only: tests, the one kind of shot to plan
  const idleS = +flags.get('cineidle') > 0 ? +flags.get('cineidle') : TUNE.idle;
  const R = mulberry32((Date.now() ^ 0x5bd1e995) >>> 0), rr = (a, b) => a + R() * (b - a), sgn = () => R() < .5 ? -1 : 1;
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
  const CAM = {pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 20, near: 2, far: 400, air: TUNE.air, px: TUNE.px,
    sky: {zen: [0, 0, 0], hor: [0, 0, 0], sun: [1, 1, 1], dir: [0, 1, 0], disk: .032}};
  // the shot: an orbit round its subject c, in the arena's axes (x, y on the ground, h up): the camera's angle round it a0 ->
  // a1 (0 = from the south: then a is the camera's heading, as the game's yaw), d0 -> d1 m away, p0 -> p1 rad down, looking
  // at lh0 -> lh1 m above c, magnification m0 -> m1; side0 -> side1: the look goes that share of the frame's width to the
  // camera's right (the subject off the middle), `slide`: the camera goes with it (a track: its heading stays);
  // `follow`: the subject is the player (his feet, read every frame)
  const S = {kind: '', t: 0, dur: 8, follow: false, slide: false, c: {x: 0, y: 0, h: 0},
    a0: 0, a1: 0, d0: 30, d1: 30, p0: .7, p1: .7, lh0: 1, lh1: 1, m0: 1.3, m1: 1.3, side0: 0, side1: 0};
  let state = 'off', fadeK = 0, barK = 0, phase = '', tStart = 0, pending = false, cuts = 0, lastKinds = ['', ''], newsT = -1e9;

  const game = () => host.feature('game');
  const allowed = () => F.on && !host.paused && !host.lock && !host.photoOpen && game()?.mode === 'sandbox' && (HOLD || host.P.state === 'idle');   // (photo mode: its own camera)
  const feet = o => { const p = host.player; o.x = p.x; o.y = p.y; o.h = host.P.z || 0; return o; };
  const ground = (x, y) => host.elev(x, y) || 0;
  // the frame's size at magnification m (m across, m high, at the subject): the game's view / m
  const frameW = m => host.VW / (host.PPM * m), frameH = m => host.VH / (host.PPM * m);

  // a tree's crown: its 3D model's bounds (the world item's pose.crown, read as wind.js does); a painted card: a guess
  const CROWNS = new WeakMap();
  function crownOf(p) {
    const it = host.itemOf?.(p), key = it || p; let cr = CROWNS.get(key); if (cr) return cr;
    const ps = it?.pose, C = ps?.crown, z = p.z || 0;
    if (C) { const c = Math.cos(ps.yaw), s = Math.sin(ps.yaw), k = ps.scale; cr = {x: p.x + (C.x * c + C.z * s) * k, y: p.y + (-C.x * s + C.z * c) * k, h0: z + C.y0 * k, h1: z + C.y1 * k, r: C.r * k}; }
    else cr = {x: p.x, y: p.y, h0: z + 2, h1: z + TOP.tree, r: 2.2};
    CROWNS.set(key, cr); return cr;
  }

  // ---- where a camera may stand: above the ground, out of walls and crowns, with a clear line to (sx, sy, sh)
  const NEAR = [];
  function solidAt(x, y, h, sx, sy, cam) {
    if (ground(x, y) > h) return true;
    for (const p of host.entities.near(x, y, 3.2, NEAR)) {
      if (p.broken || p.gone || SOFT.has(p.kind) || hypot2(p.x - sx, p.y - sy) < 1.1) continue;   // (the subject's own prop)
      if (p.kind === 'tree') { const cr = crownOf(p); if (h > cr.h0 && h < cr.h1 && hypot2(cr.x - x, cr.y - y) < cr.r + (cam ? .8 : .15)) return true; }   // (a crown in the way)
      const z = p.z || 0, top = z + (TOP[p.kind] ?? (p.rect ? 3 : 1.5));
      if (h > top || h < z - .2) continue;
      const m = cam ? .9 : .3;
      if (p.rect ? x > p.rect[0] - m && x < p.rect[2] + m && y > p.rect[1] - m && y < p.rect[3] + m : (p.r || 0) > .12 && hypot2(p.x - x, p.y - y) < p.r + m) return true;
    }
    return false;
  }
  function okCam(x, y, h, sx, sy, sh) {
    if (x < WORLD.x0 - 40 || x > WORLD.x1 + 40 || y < WORLD.y0 - 40 || y > WORLD.y1 + 40) return false;   // (it stands well back: past the world's edge is fine, it looks in)
    if (h < ground(x, y) + .5 || solidAt(x, y, h, sx, sy, true)) return false;
    const n = clamp(Math.ceil(hypot2(sx - x, sy - y) / .8), 12, 64);   // (a sample every 0.8 m across the ground: no wall slips between)
    for (let i = 1; i < n; i++) { const t = i / n; if (solidAt(x + (sx - x) * t, y + (sy - y) * t, h + (sh - h) * t, sx, sy, false)) return false; }
    return true;
  }
  // does the whole frame land on ground the game shows (the world and the WORLD.past m round it, where the ground goes on;
  // world.js draws 2 m more, past that nothing)? Its four corners from the camera at (x, y, h), looking at (lx, ly, lh)
  // from d m at magnification m, met with the land (from the level gh)
  function seen(x, y, h, lx, ly, lh, d, m, gh) {
    const pa = (WORLD.past || 0) - 1, fl = Math.hypot(lx - x, ly - y, lh - h) || 1, fx = (lx - x) / fl, fy = (ly - y) / fl, fh = (lh - h) / fl;
    const rl = Math.hypot(fx, fy) || 1, rx = fy / rl, ry = -fx / rl, ux = ry * fh, uy = -rx * fh, uh = rx * fy - ry * fx;   // (right = f x up, up' = right x f)
    const tw = frameW(m) / (2 * d), th = frameH(m) / (2 * d);
    for (let k = 0; k < 4; k++) {
      const sx = k & 1 ? tw : -tw, sy = k & 2 ? th : -th, dx = fx + sx * rx + sy * ux, dy = fy + sx * ry + sy * uy, dh = fh + sy * uh;
      if (dh > -.02) return false;   // (a corner at or above the horizon: never)
      let t = (gh - h) / dh, gx = x + dx * t, gy = y + dy * t;
      for (let i = 0; i < 3; i++) { t = (ground(gx, gy) - h) / dh; gx = x + dx * t; gy = y + dy * t; }   // (onto the land there: past a hill it falls away, the corner goes further)
      if (gx < WORLD.x0 - pa || gx > WORLD.x1 + pa || gy < WORLD.y0 - pa || gy > WORLD.y1 + pa) return false;
    }
    return true;
  }
  // the camera at angle a round c, d m away, p rad down, looking lh m above c; on a track (slide) moved `side` m to its right
  function place(o, c, a, d, p, lh, side, slide) {
    const r = d * Math.cos(p), sa = Math.sin(a), ca = Math.cos(a);
    o.x = c.x + sa * r; o.y = c.y + ca * r; o.h = c.h + lh + d * Math.sin(p);
    if (slide) { o.x += ca * side; o.y -= sa * side; }
    return o;
  }
  // the frame from camera P at angle a round c (looking lh m above c, w m to its right), all on shown ground? (from the
  // ground under c, not c itself: a bird on a tower's top would bring the far corners 9 m nearer)
  const seenAt = (P, c, a, d, lh, w, m) => seen(P.x, P.y, P.h, c.x + Math.cos(a) * w, c.y - Math.sin(a) * w, c.h + lh, d, m, Math.min(c.h, ground(c.x, c.y)));
  const P0 = {x: 0, y: 0, h: 0}, P1 = {x: 0, y: 0, h: 0}, PM = {x: 0, y: 0, h: 0}, C0 = {x: 0, y: 0, h: 0};
  let loose = false;   // (the last resort: a frame may reach past the shown ground)
  // an orbit of c: tried from a few angles round `a` (spread), the camera checked at both ends and the middle. o: {d, p (deg),
  // m, lh, side}, each [start, end] (or [both]). Round the Ranger (`follow`) an orbit is centred on one of his sprite's
  // facings and turns less than a facing step, so he never flips to the next drawing mid-shot (the camera's heading is its
  // angle a, less atan(side / r) when the look goes `side` m to the right; the game's yaw is his sprite's frame)
  function orbit(kind, c, a, spread, turn, o, dur, follow, slide = false) {
    const d0 = o.d[0], d1 = o.d[1] ?? d0, p0 = o.p[0] * DEG, p1 = (o.p[1] ?? o.p[0]) * DEG, m0 = o.m[0], m1 = o.m[1] ?? m0;
    const lh0 = o.lh?.[0] ?? 1, lh1 = o.lh?.[1] ?? lh0, s0 = o.side?.[0] ?? 0, s1 = o.side?.[1] ?? s0;
    const w0 = s0 * frameW(m0), w1 = s1 * frameW(m1), wm = (w0 + w1) / 2;
    const dl = slide ? 0 : Math.atan2(wm, (d0 * Math.cos(p0) + d1 * Math.cos(p1)) / 2);
    if (follow) { turn = clamp(turn, -FACE * .85, FACE * .85); a = host.yaw + Math.round((a + turn / 2 - dl - host.yaw) / FACE) * FACE + dl - turn / 2; }
    for (let k = 0; k < 8; k++) {
      const a0 = a + (k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (follow ? FACE : spread / 4) : 0), a1 = a0 + turn;
      place(P0, c, a0, d0, p0, lh0, w0, slide); place(P1, c, a1, d1, p1, lh1, w1, slide); place(PM, c, (a0 + a1) / 2, (d0 + d1) / 2, (p0 + p1) / 2, (lh0 + lh1) / 2, wm, slide);
      const sh = c.h + (lh0 + lh1) / 2;
      if (!okCam(P0.x, P0.y, P0.h, c.x, c.y, sh) || !okCam(P1.x, P1.y, P1.h, c.x, c.y, sh) || !okCam(PM.x, PM.y, PM.h, c.x, c.y, sh)) continue;
      if (!loose && (!seenAt(P0, c, a0, d0, lh0, w0, m0) || !seenAt(P1, c, a1, d1, lh1, w1, m1) || !seenAt(PM, c, (a0 + a1) / 2, (d0 + d1) / 2, (lh0 + lh1) / 2, wm, (m0 + m1) / 2))) continue;
      return {kind, c: {...c}, a0, a1, d0, d1, p0, p1, m0, m1, lh0, lh1, side0: s0, side1: s1, slide, dur, follow};
    }
    return null;
  }

  // ---- the director: everything worth a shot now, weighted; never the same kind three times running
  function sunDirH() { const d = CAM.sky.dir, l = Math.hypot(d[0], d[2]) || 1; return {x: d[0] / l, y: d[2] / l, el: Math.asin(clamp(d[1], -1, 1))}; }
  // where a shot looks from: mostly near the game's own heading (TUNE.yaw), now and then from anywhere
  const aim = (spread = TUNE.yaw) => R() < .75 ? host.yaw + rr(-spread, spread) : rr(0, 6.28);
  // one piece of news as a candidate shot (true when it is fresh and near enough to be one)
  function news(e, me, now, add) {
    if (e.used || now - e.t > TUNE.fresh || hypot2(e.x - me.x, e.y - me.y) > TUNE.near) return false;
    const c = {x: e.x, y: e.y, h: e.kind === 'bird' ? e.h : ground(e.x, e.y)}, a = aim(1), s = sgn();
    const go = (w, o, turn, dur) => add(w, e.kind, () => { const sh = orbit(e.kind, c, a, 6.28, s * turn, o, dur, false); if (sh) e.used = true; return sh; });
    if (e.kind === 'bird') go(5, {d: [19, 18], p: [36, 37], m: [1.7, 1.75], lh: [0]}, .12, rr(5.5, 7.5));   // (close, from above its perch: a crenellation hides it from below)
    else if (e.kind === 'flock') go(3, {d: [28], p: [32, 34], m: [1.05, 1], lh: [1, 4]}, .1, rr(5.5, 7));   // (the look rises after them)
    else if (e.kind === 'water') go(2.5, {d: [21, 20], p: [42, 43], m: [1.6, 1.65], lh: [0]}, .15, rr(6, 8));
    else if (e.kind === 'fire' || e.kind === 'weed') go(2.5, {d: [22, 21], p: [36, 39], m: [1.5, 1.55], lh: [.3]}, .2, rr(6, 8));
    return true;
  }
  function plan(first, only = null) {
    const C = [], add = (w, kind, f) => { if (w > 0) C.push({w, kind, f}); };
    const me = feet({x: 0, y: 0, h: 0}), now = performance.now() / 1000;
    const sun = sunDirH(), lowSun = sun.el > -.03 && sun.el < .38 && host.env.part !== 'night', night = host.env.part === 'night';
    const toSun = Math.atan2(-sun.x, -sun.y);   // (the angle round a subject that looks toward the sun)
    const d = () => rr(TUNE.shot[0], TUNE.shot[1]);
    if (only) return news(only, me, now, add) ? pickOf(C) : null;
    // the Ranger: a drift round him (him off the middle), a crane rising over him, a pull-back from him to the place, a
    // push-in, a track past him (the camera slides, he crosses the frame), a wide look out (toward a low sun)
    add(2.2, 'drift', () => orbit('drift', me, aim(), 1.2, sgn() * rr(.22, .33), {d: [30, 28], p: [40, 42], m: [1.3, 1.35], side: [sgn() * .12]}, d() + 1, true));
    add(1.2, 'crane', () => orbit('crane', me, aim(), 1.2, sgn() * .18, {d: [33, 27], p: [33, 49], m: [1.2, 1.4], lh: [1, .9]}, d() + 1, true));
    add(first ? 4 : 1.2, 'pullback', () => orbit('pullback', me, aim(), 1.2, sgn() * .12, {d: [22, 36], p: [45, 38], m: [1.65, 1.05]}, d() + 1.5, true));
    add(1, 'pushin', () => orbit('pushin', me, aim(), 1.2, sgn() * .15, {d: [38, 25], p: [36, 43], m: [1.05, 1.55]}, d() + 1, true));
    add(1.2, 'track', () => { const s = sgn() * .17; return orbit('track', me, aim(), 1.2, 0, {d: [29], p: [39, 40], m: [1.35], side: [s, -s]}, d() + 1, true, true); });
    add(first ? 3 : lowSun ? 2.5 : 1.2, 'wide', () => orbit('wide', me, lowSun ? toSun + rr(-.3, .3) : aim(), 1.6, sgn() * .1, {d: [44, 48], p: [35, 33], m: [.95, .9]}, d() + 2, true));   // (m < 1: more than the game's view; at .8 it drew 2.5x the game's draws)
    // what just happened round here
    for (const e of NEWS) news(e, me, now, add);
    // fires (the lights of braziers, torches, beacons, campfires): by night and at dusk
    const W = host.world, fires = [];
    if (W?.lights) for (const l of W.lights) if (l.c && l.c[0] > l.c[2] * 1.3 && hypot2(l.x - me.x, l.z - me.y) < TUNE.near) fires.push(l);
    if (fires.length) add(night ? 3 : lowSun ? 1.5 : .3, 'fire', () => {
      const l = fires[Math.floor(R() * fires.length)], c = {x: l.x, y: l.z, h: l.y};
      return orbit('fire', c, aim(), 6.28, sgn() * .2, {d: [24, 23], p: [35, 38], m: [1.45, 1.5], lh: [-.3]}, d(), false);
    });
    // the trees: a crown in the wind (more in a gust or when the leaves fall); one against a low sun, looking into the light
    const trees = []; for (const p of host.entities.near(me.x, me.y, TUNE.near, NEAR)) if (p.kind === 'tree' && !p.gone && !p.broken) trees.push(p);
    if (trees.length) {
      const wind = host.wind, gust = wind?.strength > 1.4 ? 1.5 : 1, autumn = host.env.leafFall > .2 ? 1.4 : 1;
      add(1.2 * gust * autumn, 'tree', () => {
        const p = trees[Math.floor(R() * trees.length)], cr = crownOf(p), c = {x: cr.x, y: cr.y, h: p.z || ground(p.x, p.y)};
        return orbit('tree', c, aim(), 3, sgn() * .2, {d: [27, 26], p: [40, 42], m: [1.3, 1.35], lh: [(cr.h0 + cr.h1) / 2 - (p.z || 0)]}, d(), false);
      });
      if (lowSun) add(3, 'backlit', () => {
        const p = trees[Math.floor(R() * trees.length)], c = {x: p.x, y: p.y, h: p.z || ground(p.x, p.y)};
        return orbit('backlit', c, toSun + rr(-.25, .25), .8, sgn() * .08, {d: [36], p: [33, 34], m: [1.05], lh: [2], side: [sgn() * .12]}, d() + 1, false);
      });
    }
    if (F.only) { const k = C.filter(c => c.kind === F.only); if (k.length) { const s = pickOf(k); if (s) return s; } }   // (tests: F.only = a kind)
    const s = pickOf(C); if (s) return s;
    // nothing fits (by the world's edge, in a thicket): a drift from anywhere, closer in, and at last one past the shown ground
    let f = orbit('drift', me, rr(0, 6.28), 6.28, .3, {d: [30, 28], p: [40, 42], m: [1.5, 1.6]}, 9, true);
    if (!f) { loose = true; f = orbit('drift', me, rr(0, 6.28), 6.28, .3, {d: [30, 28], p: [42, 44], m: [1.5, 1.6]}, 9, true); loose = false; }
    return f;
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
    const c = S.c; Object.assign(S, s); S.c = c; Object.assign(c, s.c); S.t = 0;
    lastKinds[1] = lastKinds[0]; lastKinds[0] = s.kind; F.shots++; cuts++;
    return true;
  }
  // the camera at this moment of the shot (no allocation: into CAM); its lens from the magnification: the frame covers
  // frameH(m) m at the distance it looks
  function pose() {
    const u = ease(clamp(S.t / S.dur, 0, 1)), c = S.follow ? feet(C0) : S.c;
    const a = lerp(S.a0, S.a1, u), d = lerp(S.d0, S.d1, u), p = lerp(S.p0, S.p1, u), m = lerp(S.m0, S.m1, u), lh = lerp(S.lh0, S.lh1, u);
    const r = d * Math.cos(p), sa = Math.sin(a), ca = Math.cos(a), side = lerp(S.side0, S.side1, u) * frameW(m);
    CAM.look.set(c.x + ca * side, c.h + lh, c.y - sa * side);   // (the subject off the middle: the look `side` m to the camera's right)
    CAM.pos.set(c.x + sa * r, c.h + lh + d * Math.sin(p), c.y + ca * r);
    if (S.slide) { CAM.pos.x += ca * side; CAM.pos.z -= sa * side; }
    CAM.fov = 2 * Math.atan(frameH(m) / (2 * d)) / DEG;
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
    CAM.air = TUNE.air + (sk.fog || 0) * .016 + (sk.rain || 0) * .005 + (sk.snow || 0) * .007;
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
      if (state === 'on' && phase === '' && cuts > 1 && S.t > TUNE.news && !NEWSY[S.kind] && now - newsT > TUNE.newsGap * 1000) {   // (never the opening shot)
        const ts = now / 1000;
        for (const e of NEWS) if (!e.used && (e.kind === 'bird' || e.kind === 'flock') && ts - e.t < 1.5) {
          sky(); const shot = plan(false, e); e.used = true;   // (tried once: a bird with no place for a camera stays unfilmed)
          if (begin(shot)) { pose(); newsT = now; break; }
        }
      }
      // the end of a shot: a cut, or every few cuts a dip to black
      const dip = cuts % 3 === 0 || S.kind === 'wide';
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
      pos: [+CAM.pos.x.toFixed(2), +CAM.pos.y.toFixed(2), +CAM.pos.z.toFixed(2)], look: [+CAM.look.x.toFixed(2), +CAM.look.y.toFixed(2), +CAM.look.z.toFixed(2)], fov: +CAM.fov.toFixed(1), m: +lerp(S.m0, S.m1, ease(clamp(S.t / S.dur, 0, 1))).toFixed(2)}; },
  });
  return F;
}
