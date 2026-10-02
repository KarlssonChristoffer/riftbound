// FIRESIM: real 3D flames for render3d (used by lights.js). OWNER: the lights session.
// A flame is a VOLUME of glowing particles in world space, not a picture: they are born on the fuel bed (a disc), rise
// with buoyancy, are drawn in toward the flame's axis as they climb (the teardrop), swirl round it, and the whole column
// dances (a twist along its height from layered sines + the wind's push). Each particle cools as it ages: white-hot core,
// yellow, the fire's own colour, dark tips; hot ones are fat pixels, cool ones single pixels that dither away. Because
// they live in 3D, turning the camera shows the flame from another side, and the bowl's rim, the player or a post in
// front hides what is behind it (they are depth-tested pixel particles in the G-buffer).
// THE PARTICLES LIVE ON THE GPU (render/flames.js): one is only BORN here (its random draws: where on the bed, how fast, how
// long, which way it swirls), written once into a slot; the shaders place, colour and size every live one each frame from its
// age. Here: each fire's breathing, flares, pops, tongues and the wind's push, the HD glow and heat round the flame, and each
// particle's age (two numbers: the per-fire cap and the slot's release). Until 2026-10-02 the particles were simulated and
// drawn here, ~1000 a frame (~10% of the frame's JS); the GPU's maths is that draw's, term for term.
//
//   const fires = createFires(host)
//   fires.step(dt)                         advance every flame drawn recently (once per update)
//   fires.draw(key, kind, colour, x, y, h, o?)   this frame's flame for key (any object / string): kind = torch | brazier |
//                                          burn | camp | beacon, colour '#rrggbb', (x, y, h) the fuel bed's centre (arena
//                                          frame). o.on (0..1) fades it, o.scale (fuel strength: how many), o.height
//                                          (0..1: a smaller fire, lower: a campfire burning down)
//   fires.ramp(colour) -> [6 x [r, g, b]]  the flame's tones (white-hot .. dark), for sparks and coals
//   fires.TUNE.style                       'pixel' | 'hybrid' | 'soft' (see TUNE)
//   (HD styles: each flame also sends up a column of hot air, gfx.js heat: a rising ripple over it, stronger with the flame)
//   fires.pops                             this step's crackles [{x, y, h, col, kind, k}]: the caller throws sparks, flashes
//                                          the light (lights.js); drained by the caller
import {ART} from '../world/biomes.js';
import {clamp, TAU} from '../core/mathx.js';
import {hex01 as rgb} from '../core/color.js';
import {createFlames} from '../render/flames.js';

// style: 'pixel' (depth-tested pixel particles) | 'hybrid' (those + a soft HD glow round the flame) | 'soft' (the
// whole flame as smooth HD particles: gfx.js fx, display resolution, additive, soft-depth-tested)
// heat: the HD heat ripple over every flame (gfx.js heat: the pixels behind the hot air wobble), its strength
export const TUNE = {density: 1, maxPer: 900, style: 'hybrid', STYLES: ['pixel', 'hybrid', 'soft'], heat: true, heatK: 1};
// kind: bed radius (m), particles / s, life (s), rise speed (m/s), buoyancy (m/s2), flame height (m), swirl (rad/s),
// dance (m of sway at the top), pixel size of the hottest
const KINDS = {
  torch:   {pops: .12, bed: .05, rate: 240, life: [.22, .5], vh: [.7, 1.2], buoy: 1.4, H: .36, swirl: 7, dance: .045, size: 2, tongues: 3},
  brazier: {pops: .35, bed: .2, rate: 720, life: [.28, .62], vh: [.75, 1.45], buoy: 1.6, H: .6, swirl: 5, dance: .09, size: 3, tongues: 4},
  burn:    {pops: .7, bed: .22, rate: 640, life: [.26, .58], vh: [.75, 1.4], buoy: 1.6, H: .56, swirl: 5, dance: .09, size: 3, tongues: 4},
  camp:    {pops: .6, bed: .2, rate: 1000, life: [.3, .72], vh: [.85, 1.6], buoy: 1.8, H: .8, swirl: 4.5, dance: .13, size: 3, tongues: 5},
  beacon:  {pops: .45, bed: .3, rate: 1250, life: [.34, .82], vh: [1, 2], buoy: 2.1, H: 1.12, swirl: 4, dance: .17, size: 4, tongues: 5},
};
const R = Math.random, rr = (a, b) => a + R() * (b - a);
function tones(c) {   // white-hot .. dark tips; warm fires lean yellow in the middle and red at the tips
  const [r, g, b] = rgb(c), warm = r > b + .15 && r >= g, m = ART.mixHex;
  return (warm ? [m(c, '#ffffff', .82), m(c, '#fff3c0', .58), m(c, '#ffd27a', .28), c, m(c, '#b0341a', .45), m(c, '#4a140a', .6)]
    : [m(c, '#ffffff', .8), m(c, '#ffffff', .5), m(c, '#ffffff', .22), c, m(c, '#000000', .3), m(c, '#000000', .55)]).map(rgb);
}

export function createFires(host) {
  // PERFORMANCE: per fire per frame a few numbers; per particle a birth (~1-8 a fire a frame) and an age (a typed array). A
  // flame whose bed is off screen keeps simulating but isn't drawn (it's ready the moment the camera turns to it)
  const fires = new Map(), ramps = new Map(), gpu = createFlames(host.G);
  let T = 0, frame = 0;
  const SF = {x: 0, y: 0, h: 0, KH: 1, s1: 0, s2: 0, s3: 0, dance: 0, wx: 0, wy: 0, on: 0, buoy: 0, big: 1, mid: 1, rad: .1, ramp: null};
  const rampOf = c => { let r = ramps.get(c); if (!r) ramps.set(c, r = tones(c)); return r; };

  function fireOf(key, kind) {
    let f = fires.get(key);
    if (!f || f.kind !== kind) {
      if (f) dropGPU(f);
      f = {kind, K: KINDS[kind] || KINDS.brazier, hs: 1, acc: 0, x: 0, y: 0, h: 0, col: null, ramp: null, on: 0, onT: 1, scale: 1, used: frame,
        s1: R() * TAU, s2: R() * TAU, s3: R() * TAU, wx: 0, wy: 0, flare: 0,
        // tongues: a few directions round the axis where the flame licks higher; they wander round it
        tg: Array.from({length: (KINDS[kind] || KINDS.brazier).tongues}, (_, i) => ({th: i / 4 * TAU + R(), v: rr(-1.6, 1.6)}))};
      // its particles: age, life (s) and GPU slot each, in birth order (swap-removed as they die)
      f.row = gpu.fire(); f.live = 0; f.ages = new Float64Array(1024); f.lifes = new Float64Array(1024); f.slots = new Int32Array(1024);
      fires.set(key, f);
    }
    f.used = frame; return f;
  }
  // the column's dance: where the axis is at height z above the bed (layered sines; more sway higher up), plus the wind
  function axis(f, z, out) {
    const K = f.K, u = z / (K.H * f.hs), a = K.dance * f.hs * u * u;
    out[0] = a * (Math.sin(T * 2.9 + f.s1 + z * 5.5) * .65 + Math.sin(T * 6.1 + f.s2 + z * 11) * .35) + f.wx * z * .55;
    out[1] = a * (Math.sin(T * 2.4 + f.s3 + z * 6.3) * .65 + Math.sin(T * 5.3 + f.s1 + z * 9) * .35) + f.wy * z * .55;
  }
  function dropGPU(f) { for (let i = 0; i < f.live; i++) gpu.release(f.slots[i]); f.live = 0; gpu.free(f.row); }   // a fire gone: its slots and row back
  function spawn(f, n, dt) {
    const K = f.K;
    for (let i = 0; i < n && f.live < TUNE.maxPer; i++) {
      if (f.live >= f.ages.length) {   // (a raised maxPer)
        const a = new Float64Array(f.ages.length * 2), b = new Float64Array(a.length), c = new Int32Array(a.length); a.set(f.ages); b.set(f.lifes); c.set(f.slots); f.ages = a; f.lifes = b; f.slots = c;
      }
      const rf = R() ** .8, r = K.bed * rf, th = R() * TAU, hl = f.hs ** .7, hv = f.hs ** .3;
      let tongue = 0; for (const t of f.tg) { let d = Math.abs(((th - t.th) % TAU + TAU) % TAU); d = Math.min(d, TAU - d); tongue = Math.max(tongue, Math.exp(-((d / .45) ** 2))); }
      tongue *= .4 + .6 * rf;   // the licks are the flame's outer sheets
      // born at the step's start (it is aged dt by the step's end), rising at vz, living `life` s; the rest is its look
      const z0 = rr(0, .04), vz = rr(K.vh[0], K.vh[1]) * hv * (.9 + (1 - rf) * .25) * (1 + tongue * .55);
      const life = rr(K.life[0], K.life[1]) * hl * (.8 + (1 - rf) * .4) * (1 + tongue * .45);
      const sw = K.swirl * rr(.6, 1.4) * (R() < .5 ? -1 : 1), wob = R() * TAU, nn = rr(-.07, .07), tb = T - dt;
      f.slots[f.live] = gpu.birth(f.row, tb, life, z0, vz, r, rf, th, sw, wob, nn);
      f.ages[f.live] = 0; f.lifes[f.live++] = life;
    }
  }
  const A = [0, 0], pops = [], WS = {x: 0, y: 0, g: 0};   // WS: the wind at a flame (scratch)
  return {
    TUNE,
    ramp: c => rampOf(c),
    step(dt) {
      T += dt;
      for (const [key, f] of fires) {
        if (frame - f.used > 30) { dropGPU(f); fires.delete(key); continue; }
        f.on += (f.onT - f.on) * Math.min(1, dt * 6);
        // the fuel breathes and now and then flares; now and then it POPS (a crackle: a hard flare, sparks thrown)
        if (R() < dt * .5) f.flare = rr(.25, .5); f.flare *= Math.exp(-dt * 3);
        if (f.on > .8 && R() < dt * (f.K.pops || 0)) { const k = rr(.6, 1); f.flare = Math.max(f.flare, .7 * k); f.pop = 1; pops.push({x: f.x, y: f.y, h: f.h, col: f.col, kind: f.kind, k}); }
        f.pop = (f.pop || 0) * Math.exp(-dt * 9);
        f.acc += f.K.rate * TUNE.density * f.on * (f.scale ?? 1) * (1 + f.flare + Math.sin(T * 7 + f.s2) * .12) * dt;
        const n = f.acc | 0; f.acc -= n; spawn(f, n, dt);
        for (const t of f.tg) { t.v += (R() - .5) * dt * 6; t.v *= Math.exp(-dt * .8); t.th += t.v * dt; }
        const Ag = f.ages, Lf = f.lifes, Sl = f.slots;   // age them; the dead give their slots back (the GPU works out the motion)
        for (let i = f.live - 1; i >= 0; i--) if ((Ag[i] += dt) >= Lf[i]) { gpu.release(Sl[i]); const j = --f.live; Ag[i] = Ag[j]; Lf[i] = Lf[j]; Sl[i] = Sl[j]; }
      }
    },
    draw(key, kind, col, x, y, h, o = {}) {
      const f = fireOf(key, kind); f.x = x; f.y = y; f.h = h; f.onT = o.on ?? 1; f.scale = o.scale ?? 1; f.hs = clamp(o.height ?? 1, .2, 1.5);
      if (f.col !== col) { f.col = col; f.ramp = rampOf(col); }
      // the wind pushes the column (world metres; it leans the same way from every side)
      const a = host.wind?.on && host.wind.at ? host.wind.at(x, y, WS) : null;
      f.wx += ((a ? a.x : 0) * .16 - f.wx) * .08; f.wy += ((a ? a.y : 0) * .16 - f.wy) * .08;
      const K = f.K, KH = K.H * f.hs, ramp = f.ramp, z = host.zoom, big = Math.min(4, K.size * z), mid = Math.min(3, Math.max(1, Math.round(K.size * .66 * z)));
      const style = host.G.fx ? TUNE.style : 'pixel', G = host.G;
      if (G.onScreen && !G.onScreen(x, h + KH * .5, y, (KH * 2 + .6) * host.PPM * z)) return f;   // off screen: simulated, not drawn
      const rad = K.bed * .32 + .025;   // a soft particle's radius (m)
      if (style === 'soft') {   // the glow round the flame: a wide faint halo + a hot heart low in it (bloom, HD)
        axis(f, KH * .35, A); const L = f.on * (.85 + f.flare * .5 + Math.sin(T * 9 + f.s1) * .06);
        G.fx(x + A[0], h + KH * .38, y + A[1], KH * 1.25, ramp[3], .13 * L, 'add');
        G.fx(x + A[0] * .5, h + KH * .2, y + A[1] * .5, KH * .55, ramp[1], .2 * L, 'add');
      } else if (style === 'hybrid') {   // three layers of HD glow that breathe with the flame and flare when it pops:
        // a white-hot heart in the fuel, the warm body, a wide faint halo (the pixel flame stays crisp on top of them)
        const fl = Math.sin(T * 11 + f.s1) * .05 + Math.sin(T * 23 + f.s2) * .03, L = f.on * (.82 + f.flare * .7 + (f.pop || 0) * .6 + fl);
        axis(f, KH * .12, A); G.fx(x + A[0], h + KH * .1, y + A[1], KH * .34 * (1 + (f.pop || 0) * .3), ramp[0], .24 * L, 'add');
        axis(f, KH * .35, A); G.fx(x + A[0], h + KH * .34, y + A[1], KH * .72, ramp[2], .15 * L, 'add');
        axis(f, KH * .5, A); G.fx(x + A[0], h + KH * .45, y + A[1], KH * 1.55 * (1 + f.flare * .25), ramp[3], .085 * L, 'add');
      }
      if (style !== 'pixel' && TUNE.heat && G.heat) {   // the hot air over it: three blobs up the column, swaying with it
        const k = f.on * TUNE.heatK * (f.scale ?? 1) * (1 + f.flare * .4);
        for (let j = 0; j < 3; j++) {
          const zz = KH * (.85 + j * .62); axis(f, Math.min(zz, KH), A);   // (above the flame: the fuel under it stays put)
          G.heat(x + A[0] * (1 + j * .4), h + zz, y + A[1] * (1 + j * .4), KH * (.34 + j * .18) + K.bed * .6, (.5 - j * .13) * k);
        }
      }
      // the particles (render/flames.js): this frame's row for the shaders. A particle's temperature comes from WHERE it is
      // in the flame (hot low and central, cooling up and out: one body with a white core), its age only fades it at the end;
      // it is drawn in toward the axis as it climbs (the teardrop), swirls round it, flutters; the hot core is fat solid
      // pixels (big), the outer sheets thin and dithered; HD styles add soft glows (render/flames.js GLOW_VS)
      SF.x = x; SF.y = y; SF.h = h; SF.KH = KH; SF.s1 = f.s1; SF.s2 = f.s2; SF.s3 = f.s3; SF.dance = K.dance * f.hs; SF.wx = f.wx; SF.wy = f.wy;
      SF.on = f.on; SF.buoy = K.buoy * f.hs; SF.big = big; SF.mid = mid; SF.rad = rad; SF.ramp = ramp;
      gpu.setFire(f.row, SF);
      return f;
    },
    endFrame() { gpu.frame(T, host.G.fx ? TUNE.style : 'pixel'); frame++; },
    pops,
    get count() { let n = 0; for (const f of fires.values()) n += f.live; return n; },
    gpu,   // (render/flames.js)
    _: fires,   // (debug: the live flames)
  };
}
