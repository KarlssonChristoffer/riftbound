// GRASS (render3d): the meadow grows up out of the painted ground. Wherever the biome painted grass (its grass, damp, lush
// and moss ramps: the meadows, the banks, the plateau's top, the moss in the arena's joints), single-pixel blades stand on
// the ground (render/grass.js draws them, as ground). Ruins only for now (frost, ember and the rift have no meadow).
//
//   placing   once per world build, from the painted ground (host.world.groundCanvas, read once) on a jittered grid: a blade
//             where the texel is one of those ramps' colours, its height from the ramp, a tallness field (clumps of long
//             grass in a shorter sward), the arena's joints short; thinner in patches. Never in the ravine, the water or the
//             pool's lowered ring. Each blade keeps the ramp TONE the ground has under it, so its foot melts into it
//   flowers   a few meadow blades carry a flower (white, yellow, violet, pink), by the season: most in spring, gone by autumn
//   moving    each frame: the wind feature's gust field (W.gpu: the fronts the trees feel, evaluated per blade on the GPU),
//             the pushers (the player, brutes, a rolling barrel: blades part round them and lie flattened where they went,
//             recovering in ~10-20 s; a brute's landing flattens a ring) and blasts (combat.explode: a flattened disc)
//   snow      lying snow shortens the grass (env.snowCover); the composite snows on it like on the ground
//   forest    the seeded forest's floor (world/forest.js; its painted tiles: world.forestTiles) grows its OWN cover: grass in
//             tussocks in the clearings and the upland, haircap tufts on the moss, short heath (heather in flower) up the fell, wavy hair-grass
//             in patches on the bare earth under the crowns, and woodland flowers (wood anemone and chickweed wintergreen white,
//             twinflower pink in the moss, cow-wheat yellow, a wood violet now and then). Its first EDGE m (a ragged line) blend from
//             the meadow's sward into it, tuft by tuft, so the meadow does not stop on a line where the forest begins
// ?grass=0 grows nothing. Detail low turns it off (ui/pause.js LOW_OFF).
//
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, biomeChanged, toggle, ms.
// OWNS: the blades (render/grass.js), its per-walker scratch (a WeakMap). READS: host.world.groundCanvas, host.biome (style
// ramps, hole), host.elev / inStream / layout.inPool, world.js steep, host.wind (gpu), host.env (year, snowCover), host.player / P, the
// registry (a live query: brutes, barrels), world.forestTiles + layout.js FOREST (decorClear). EMITS: nothing.
// BUDGET: view ~0, frame ~0.04 ms (F3, measured 2026-10-02: the uniforms, the pushers, the trample pass submitted); the build
// ~40 ms at a world rebuild (~50k blades in the ruins; with the forest ~550k in all, the forest's floor ~390k of them: ~1.5 s
// more in headless software GL, not yet timed on a real GPU machine); the GPU cost is in render/grass.js (12 m chunks the view culls).
import {flags} from '../core/flags.js';
import {mulberry32} from '../core/rng.js';
import {vnoise} from '../core/mathx.js';
import {createGrass, MAX_FRONTS, MAX_PUSH} from '../render/grass.js';
import {steep, WORLD, WEST_ON, WEST_LAND as WEST} from '../world/world.js';   // walkable terrain (docs/TERRAIN.md); the world's bounds, the West Downs
import {zone as westZone, oldWallD, WALL_D} from '../world/westland.js';
import {stoneSward} from '../world/stonecircle.js';   // the standing stones: no blade in a stone, the ring's floor cropped short
import {clear as brookClear} from '../world/brook.js';
import {FOREST} from '../world/layout.js';   // the seeded forest's plan (its windthrows' bare holes: decorClear)

// ---------------------------------------------------------------- tunables
const TUNE = {
  seed: 23,
  grid: .14,            // m: one candidate tuft per cell, jittered (at most ~51 tufts a square metre)
  ramps: {              // the ground ramps grass grows on: tufts per m2 where it's thickest, height range (m)
    grass: {d: 30, h: [.16, .32]},
    damp: {d: 24, h: [.2, .38]},
    lush: {d: 30, h: [.22, .42]},
    moss: {d: 14, h: [.05, .1]},
  },
  // a tuft: 3-5 blades from one root, fanned out (their rest lean, in blade heights); some spots carry a single blade
  tuft: {single: .3, n: [3, 5], r: .035, fan: [.16, .4], lone: [0, .2]},
  clump: {k: .32, lo: .45, hi: 1.35},   // the tallness field: value noise (k per m), lo .. hi x the height
  thin: {k: .21, lo: .35},              // the density field: patches thin down to lo of it
  arena: .45,                           // inside the walls (moss in the joints): this much of the height
  highlight: .8,                        // the tone above a ramp's lightest: that tone + this x (its step from the next)
  // wildflowers grow in PATCHES (value noise k per m above lo, full at hi), up to p of the tufts there carry one, mostly the
  // patch's own colour (by a second noise), now and then another
  flowers: {k: .55, lo: .6, hi: .82, p: .26, other: .08, cols: ['#dcd6c4', '#e2c04c', '#a084d0', '#d888a6'], w: [.3, .34, .2, .16]},
  bloom: [[0, .45], [.4, 1], [1.2, .75], [1.9, .25], [2.4, 0], [3.85, 0], [4, .45]],   // flowers shown by env.year (0 spring .. 4)
  snowShrink: .7,                       // lying snow 1 = the grass this much shorter
  // [radius m, live push (blade heights at the centre)]; trample: how flat the grass lies where they went (0..1)
  push: {player: [.5, 1.25], brute: [.62, 1.25], barrel: [.38, 1]},
  trample: {walk: .38, run: .65, roll: .95, land: .85, brute: .5, barrel: .55, blast: 1, blastR: 1.35},
  max: 700000,   // (the meadows ~165k, the forest's floor ~390k with the default seed)
  // THE WEST DOWNS (world/westland.js zone()): TALL drifts, knee high, in the 'lush' ramp (lighter, yellower blades than the ground,
  // in its light): tufts per m2, height range (m), blades a tuft; ANKLE high grass (the track's verges, round the oaks, the hilltops)
  west: {seed: 61, tall: {d: 24, h: [.42, .82], n: [4, 7], r: .06, fan: [.12, .42]}, ankle: {d: 36, h: [.05, .12]}},
  // THE FOREST's floor (world.forestTiles): its own ramps (blade ramps 4 .. 6, after the meadow's four), tufts per m2 where thickest
  // and height range (m) on each painted ramp; its grass grows in TUSSOCKS (clump: a noise k per m, nothing below lo, full at hi: no
  // even lawn); 'earth' is the bare floor under the crowns: wavy hair-grass in patches (hair: the same kind of noise), drawn in the
  // lush ramp a tone down (light against the dark earth), wispier tufts; the moss carries short haircap tufts. Flowers in patches
  // (k, lo .. hi as the meadow's), up to p of the tufts, their colours weighted [white, yellow, violet, pink] per ground: the floor
  // (anemone, wintergreen, cow-wheat, violet, twinflower), the moss (twinflower), the heath (heather), the upland. edge: the band (m)
  // south of y 0 that blends from the meadow, its line ragged by jag m
  forest: {seed: 89, edge: 9, jag: 5,
    ramps: {grass: {d: 18, h: [.14, .34]}, damp: {d: 16, h: [.18, .38]}, lush: {d: 18, h: [.2, .4]}, moss: {d: 7, h: [.06, .12]},
      hgrass: {d: 14, h: [.12, .28]}, heath: {d: 14, h: [.05, .12]}, dgrass: {d: 12, h: [.12, .3]}, earth: {d: 10, h: [.2, .42]}},
    clump: {k: .7, lo: .42, hi: .66, grass: ['grass', 'hgrass']},
    own: ['hgrass', 'heath', 'dgrass'],
    hair: {k: .28, lo: .3, hi: .62, tuft: {single: .45, n: [2, 4], r: .03, fan: [.2, .5]}},
    flowers: {k: .5, lo: .52, hi: .76, p: .5,
      floor: [.5, .14, .08, .28], moss: [.3, .04, .06, .6], heath: [0, 0, .45, .55], upland: [.3, .4, .2, .1]},
  },
};
// the cool palette (the default; ?palette=old, world/biomes.js): the wildflowers mostly a bright lavender, a few more of them (the references)
if (flags.get('palette') !== 'old') Object.assign(TUNE.flowers, {p: .4, lo: .56, cols: ['#e6e0d2', '#e8c650', '#c49cf2', '#e898bc'], w: [.22, .16, .46, .16]});

export const order = {after: ['wind']};   // reads the wind's gust fronts after its view has stepped them

export async function create(host) {
  const F = {name: 'grass', label: 'Grass', ambient: true, on: true, ms: 0, _: {TUNE}};
  if (flags.get('grass') === '0') { F.on = false; return F; }
  // (the trample map covers the world's bounds, + 1 m: the West Downs too)
  const G = host.G, grass = createGrass(G, {x0: WORLD.x0 - 1, z0: WORLD.y0 - 1, w: WORLD.WM + 2, d: WORLD.HM + 2, ppm: 6});
  F._.grass = grass;
  if (flags.get('palette') !== 'old') grass.setFlowerShape(1);   // (V heads with the cool palette's lavender: the references' flowers)
  grass.setCalm(flags.get('calm') !== '0');   // a calm sward: the blades in the ground's tone, light tips (render/grass.js setCalm)
  const WBUF = new Float32Array(8 + 16 * MAX_FRONTS), PBUF = new Float32Array(8 * MAX_PUSH), BL = new Float32Array(12);   // BL: this frame's blasts (x, y, r) x 4
  let nbl = 0;
  const walkers = host.entities.query('grass.walkers', p => p.kind === 'brute' || p.sparring || p.kind === 'barrel' || p.kind === 'barrel_x');
  const last = new WeakMap();   // walker -> {x, y} where it was last frame (its own speed)

  // ---- placing (per world build)
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function build() {
    const S = host.biome.style, names = Object.keys(TUNE.ramps);
    if (host.biome.id !== 'ruins' || !names.every(n => S[n]?.h)) { grass.setBlades(null, null, 0, [], []); return 0; }
    const t0 = performance.now();
    // each ramp as [highlight, tone 0 .. 3] (0..1): the blades step up from the ground's tone, even on its lightest
    const ramps = names.map(n => { const c = S[n].h.map(h => rgb(h).map(v => v / 255)); return [c[0].map((v, i) => Math.min(1, v + (v - c[1][i]) * TUNE.highlight)), ...c]; });
    const look = new Map();
    names.forEach((n, ri) => S[n].h.forEach((h, t) => { const [r, g, b] = rgb(h); if (!look.has(r << 16 | g << 8 | b)) look.set(r << 16 | g << 8 | b, ri * 4 + t); }));
    const gc = host.world.groundCanvas, W = gc.width, H = gc.height, {WM, HM, PLAY} = host.ctxO, ppm = W / WM;
    const px = gc.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, W, H).data;
    const R = mulberry32(TUNE.seed), c = TUNE.grid, dMax = 1 / (c * c), lay = host.layout, hole = host.biome.hole, Tf = TUNE.tuft, Fl = TUNE.flowers;
    const A = new Float32Array(TUNE.max * 4), B = new Float32Array(TUNE.max * 4);
    const fw = Fl.w, fsum = fw.reduce((a, b) => a + b, 0), pick = u => { u *= fsum; let f = 1; while (f < 4 && (u -= fw[f - 1]) > 0) f++; return f; };
    const code = (x, y) => { const tx = Math.floor(x * ppm), ty = Math.floor(y * ppm); if (tx < 0 || ty < 0 || tx >= W || ty >= H) return undefined; const k = (ty * W + tx) * 4; return look.get(px[k] << 16 | px[k + 1] << 8 | px[k + 2]); };
    let n = 0;
    for (let gy = 0; gy < HM / c && n < TUNE.max - 8; gy++) for (let gx = 0; gx < WM / c && n < TUNE.max - 8; gx++) {
      const x = (gx + R()) * c, y = (gy + R()) * c, r1 = R(), r2 = R(), r3 = R(), r4 = R(), r5 = R();
      const cd = code(x, y); if (cd === undefined) continue;
      const ri = cd >> 2, Rm = TUNE.ramps[names[ri]];
      const thin = TUNE.thin.lo + (1 - TUNE.thin.lo) * vnoise(x * TUNE.thin.k, y * TUNE.thin.k, 41);
      if (r1 * dMax > Rm.d * thin) continue;
      if (hole?.(x, y) || host.inStream(x, y) || lay.inPool?.(x, y, .01, .45) || steep(x, y)) continue;   // (walkable terrain: none on a cliff's face)
      const inArena = x > PLAY.x0 && x < PLAY.x1 && y > PLAY.y0 && y < PLAY.y1;
      const tall = TUNE.clump.lo + (TUNE.clump.hi - TUNE.clump.lo) * vnoise(x * TUNE.clump.k, y * TUNE.clump.k, 42);
      const h = (Rm.h[0] + (Rm.h[1] - Rm.h[0]) * r2) * tall * (inArena ? TUNE.arena : 1);
      // a wildflower on this tuft? (meadow grass outside the walls, in a patch)
      let fl = 0;
      if (names[ri] === 'grass' && !inArena) {
        const pf = Math.min(1, Math.max(0, (vnoise(x * Fl.k, y * Fl.k, 43) - Fl.lo) / (Fl.hi - Fl.lo)));
        if (r3 < pf * Fl.p) fl = r4 < Fl.other ? pick(R()) : pick(vnoise(x * Fl.k * .5 + 7, y * Fl.k * .5, 44));
      }
      const k = r5 < Tf.single ? 1 : Tf.n[0] + Math.floor(R() * (Tf.n[1] - Tf.n[0] + 1)), a0 = R() * Math.PI * 2;
      for (let i = 0; i < k; i++) {
        const a = a0 + i * Math.PI * 2 / k + (R() - .5) * .9, rr = k === 1 ? 0 : Tf.r * (.3 + .7 * R());
        const bx = x + Math.cos(a) * rr, by = y + Math.sin(a) * rr, bc = k === 1 ? cd : code(bx, by) ?? cd;
        const lean = k === 1 ? Tf.lone[0] + (Tf.lone[1] - Tf.lone[0]) * R() : Tf.fan[0] + (Tf.fan[1] - Tf.fan[0]) * R(), la = k === 1 ? R() : ((a / (Math.PI * 2)) % 1 + 1) % 1;
        const o = n * 4;
        A[o] = bx; A[o + 1] = host.elev(bx, by); A[o + 2] = by; A[o + 3] = h * (k === 1 ? 1 : .72 + .28 * R());
        B[o] = bc; B[o + 1] = R(); B[o + 2] = i === 0 ? fl : 0; B[o + 3] = Math.floor(Math.min(.9, lean) * 32) + Math.min(.999, la);
        n++;
      }
    }
    n = buildWest(A, B, n, look, names, pick);
    n = buildForest(A, B, n, names, pick);
    const own = TUNE.forest.own.map(nm => { const c = S[nm]?.h.map(h => rgb(h).map(v => v / 255)); return c ? [c[0].map((v, i) => Math.min(1, v + (v - c[1][i]) * TUNE.highlight)), ...c] : null; });
    grass.setBlades(A, B, n, [...ramps, ...own], Fl.cols.map(h => rgb(h).map(v => v / 255)));
    F._.built = {n, ms: +(performance.now() - t0).toFixed(1)};
    return n;
  }
  // ---- the West Downs' sward (world/westland.js), after the Proving Grounds' (its own generator: theirs stays as it was): over the
  // downs' own painted ground over their LAND (world.westCanvas, origin WEST_LAND.x0 / y0: on past the world's edges; the same ramps, so the same colour lookup), by westZone():
  // a cell grows a TALL tuft (knee high, the lush ramp, 4-7 blades fanned out), an ANKLE high one or the meadow's own, each
  // at its zone's density; wildflowers in the meadow and the tall grass alike
  const ZN = {tall: 0, ankle: 0};
  function buildWest(A, B, n, look, names, pick) {
    const wc = WEST_ON && host.world.westCanvas; if (!wc) return n;
    const W = wc.width, H = wc.height, ppm = W / (WEST.x1 - WEST.x0), px = wc.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, W, H).data;
    const code = (x, y) => { const tx = Math.floor((x - WEST.x0) * ppm), ty = Math.floor((y - WEST.y0) * ppm); if (tx < 0 || ty < 0 || tx >= W || ty >= H) return undefined; const k = (ty * W + tx) * 4; return look.get(px[k] << 16 | px[k + 1] << 8 | px[k + 2]); };
    const T = TUNE.west, R = mulberry32(T.seed), c = TUNE.grid, dMax = 1 / (c * c), hole = host.biome.hole, Tf = TUNE.tuft, Fl = TUNE.flowers, LUSH = names.indexOf('lush');
    const fNorth = !!host.world.forestTiles?.some(t => t.canvas);
    for (let gy = 0; gy < (WEST.y1 - WEST.y0) / c && n < TUNE.max - 8; gy++) for (let gx = 0; gx < (WEST.x1 - WEST.x0) / c && n < TUNE.max - 8; gx++) {
      const x = WEST.x0 + (gx + R()) * c, y = WEST.y0 + (gy + R()) * c, r1 = R(), r2 = R(), r3 = R(), r4 = R(), r5 = R();
      if (fNorth && y < 0) continue;   // (north of the grounds the forest's ground is drawn, not the downs': buildForest grows there)
      const cd = code(x, y); if (cd === undefined) continue;
      if (hole?.(x, y) || steep(x, y) || oldWallD(x, y) < WALL_D / 2 + .04 || brookClear(x, y)) continue;   // (none inside an old wall's stones, in the brook or under its bridge)
      const ri = cd >> 2, Rm = TUNE.ramps[names[ri]], h0 = host.elev(x, y), Z = westZone(x, y, h0, ZN);
      if (stoneSward(x, y, Z)) continue;
      const thin = TUNE.thin.lo + (1 - TUNE.thin.lo) * vnoise(x * TUNE.thin.k, y * TUNE.thin.k, 41);
      const d = Z.tall * T.tall.d + Z.ankle * T.ankle.d + (1 - Z.tall - Z.ankle) * Rm.d;
      if (r1 * dMax > d * thin) continue;
      const kind = r3 < Z.tall ? 2 : r3 < Z.tall + Z.ankle ? 1 : 0;   // 2 tall, 1 ankle, 0 the meadow's own
      const tallK = TUNE.clump.lo + (TUNE.clump.hi - TUNE.clump.lo) * vnoise(x * TUNE.clump.k, y * TUNE.clump.k, 42);
      const h = kind === 2 ? (T.tall.h[0] + (T.tall.h[1] - T.tall.h[0]) * r2) * (.82 + .18 * tallK) : kind === 1 ? T.ankle.h[0] + (T.ankle.h[1] - T.ankle.h[0]) * r2 : (Rm.h[0] + (Rm.h[1] - Rm.h[0]) * r2) * tallK;
      const bc0 = kind === 2 && LUSH >= 0 ? LUSH * 4 + Math.min(2, cd & 3) : cd;   // (tall: the lush ramp in the ground's light)
      let fl = 0;
      if (kind !== 1 && names[ri] === 'grass') {
        const pf = Math.min(1, Math.max(0, (vnoise(x * Fl.k, y * Fl.k, 43) - Fl.lo) / (Fl.hi - Fl.lo)));
        if (r4 < pf * Fl.p) fl = R() < Fl.other ? pick(R()) : pick(vnoise(x * Fl.k * .5 + 7, y * Fl.k * .5, 44));
      }
      const k = kind === 2 ? T.tall.n[0] + Math.floor(R() * (T.tall.n[1] - T.tall.n[0] + 1)) : r5 < Tf.single ? 1 : Tf.n[0] + Math.floor(R() * (Tf.n[1] - Tf.n[0] + 1));
      const a0 = R() * Math.PI * 2, rT = kind === 2 ? T.tall.r : Tf.r, fan = kind === 2 ? T.tall.fan : Tf.fan;
      for (let i = 0; i < k && n < TUNE.max; i++) {
        const a = a0 + i * Math.PI * 2 / k + (R() - .5) * .9, rr = k === 1 ? 0 : rT * (.3 + .7 * R());
        const bx = x + Math.cos(a) * rr, by = y + Math.sin(a) * rr, bc = k === 1 || kind === 2 ? bc0 : code(bx, by) ?? cd;
        const lean = k === 1 ? Tf.lone[0] + (Tf.lone[1] - Tf.lone[0]) * R() : fan[0] + (fan[1] - fan[0]) * R(), la = k === 1 ? R() : ((a / (Math.PI * 2)) % 1 + 1) % 1;
        const o = n * 4;
        A[o] = bx; A[o + 1] = host.elev(bx, by); A[o + 2] = by; A[o + 3] = h * (k === 1 ? 1 : .72 + .28 * R());
        B[o] = bc; B[o + 1] = R(); B[o + 2] = i === 0 ? fl : 0; B[o + 3] = Math.floor(Math.min(.9, lean) * 32) + Math.min(.999, la);
        n++;
      }
    }
    return n;
  }
  // ---- THE FOREST's floor (world.forestTiles: forestRuins' tiles, each with its canvas and FM m margin), after the downs' (its own
  // generator). Each tile's own square (not its margin) on the meadow's jittered grid; a texel's colour says which ramp (or the bare
  // earth) the cell stands on. In the EDGE band the meadow's rules hold for a share (1 - t) of the tufts (the West Downs' tall and
  // ankle grass too, west of the grounds), so the sward thins and changes into the forest's over metres
  function buildForest(A, B, n, names, pick) {
    const tiles = host.world.forestTiles; if (!tiles?.some(t => t.canvas)) return n;
    const S = host.biome.style, T = TUNE.forest, FR = T.ramps, Fl = TUNE.flowers, FF = T.flowers, Tf = TUNE.tuft, TW = TUNE.west;
    const fnames = [...names, ...T.own], EARTH = 7;   // codes: ramp * 4 + tone; ramp 7 = the bare earth (its hair-grass drawn in the lush ramp)
    const lookF = new Map();
    fnames.forEach((nm, ri) => S[nm]?.h.forEach((h, t) => { const [r, g, b] = rgb(h); if (!lookF.has(r << 16 | g << 8 | b)) lookF.set(r << 16 | g << 8 | b, ri * 4 + t); }));
    S.earth.h.forEach((h, t) => { const [r, g, b] = rgb(h); if (t < 3 && !lookF.has(r << 16 | g << 8 | b)) lookF.set(r << 16 | g << 8 | b, EARTH * 4 + t); });   // (tone 3: the roots' ring, a windthrow's hole: none)
    const rules = fnames.map(nm => FR[nm]), wsum = w => w.reduce((a, b) => a + b, 0);
    const pickW = (u, w) => { u *= wsum(w); let f = 1; while (f < 4 && (u -= w[f - 1]) > 0) f++; return f; };
    const FC = new Int32Array(8);   // blades per ramp (F._.forest: the dev's count)
    const R = mulberry32(T.seed), c = TUNE.grid, dMax = 1 / (c * c), hole = host.biome.hole, clear = flags.get('decor') !== '0' ? FOREST?.decorClear || [] : [];
    const CLUMPED = fnames.map(nm => T.clump.grass.includes(nm));
    const GRASS = names.indexOf('grass'), MOSS = names.indexOf('moss'), LUSH = names.indexOf('lush'), HEATH = fnames.indexOf('heath'), HG = fnames.indexOf('hgrass');
    for (const tl of tiles) {
      if (!tl.canvas) continue;
      const W = tl.canvas.width, H = tl.canvas.height, ppm = W / (tl.x1 - tl.x0 + 2 * (tl.x0 - tl.cx0)), px = tl.canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, W, H).data;
      const code = (x, y) => { const tx = Math.floor((x - tl.cx0) * ppm), ty = Math.floor((y - tl.cz0) * ppm); if (tx < 0 || ty < 0 || tx >= W || ty >= H) return undefined; const k = (ty * W + tx) * 4; return lookF.get(px[k] << 16 | px[k + 1] << 8 | px[k + 2]); };
      const NX = Math.round((tl.x1 - tl.x0) / c), NZ = Math.round((tl.z1 - tl.z0) / c);
      for (let gy = 0; gy < NZ && n < TUNE.max - 8; gy++) for (let gx = 0; gx < NX && n < TUNE.max - 8; gx++) {
        const x = tl.x0 + (gx + R()) * c, y = tl.z0 + (gy + R()) * c, r1 = R();
        if (x >= tl.x1 || y >= tl.z1) continue;
        const cd = code(x, y); if (cd === undefined) continue;
        const ri = cd >> 2, tn = cd & 3, earth = ri === EARTH;
        // the band: t 0 at the meadow's edge (y 0) .. 1 EDGE m in, its line ragged
        const t = Math.min(1, Math.max(0, (-y + (vnoise(x * .23, y * .23, 97) - .5) * T.jag) / T.edge)), meadow = ri < 4 && !earth && R() >= t * t * (3 - 2 * t);
        let Rm = meadow ? TUNE.ramps[names[ri]] : rules[ri] || FR.earth;
        let dHere = Rm.d;
        if (earth) {   // wavy hair-grass: in patches (light gaps), none outside them
          const pe = (vnoise(x * T.hair.k, y * T.hair.k, 98) - T.hair.lo) / (T.hair.hi - T.hair.lo);
          if (pe <= 0) continue; dHere *= Math.min(1, pe);
        } else if (!meadow && CLUMPED[ri]) {   // the forest's grass in tussocks
          const pc = (vnoise(x * T.clump.k, y * T.clump.k, 96) - T.clump.lo) / (T.clump.hi - T.clump.lo);
          if (pc <= 0) continue; dHere *= Math.min(1, pc);
        }
        if (r1 * dMax > dHere) continue;   // (cheap first: the thinning below only lowers it)
        const thin = TUNE.thin.lo + (1 - TUNE.thin.lo) * vnoise(x * TUNE.thin.k, y * TUNE.thin.k, 41);
        if (r1 * dMax > dHere * thin) continue;
        if (hole?.(x, y) || host.inStream(x, y) || steep(x, y)) continue;
        let bare = false; for (const [cx, cy, r] of clear) if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) { bare = true; break; }
        if (bare) continue;
        const r2 = R(), r3 = R(), r4 = R(), r5 = R(), h0 = host.elev(x, y);
        // the West Downs' drifts carry on into the band (west of the grounds), as buildWest grows them
        let kind = 0;
        if (meadow && WEST_ON && x < WEST.x1) { const Z = westZone(x, y, h0, ZN); kind = r3 < Z.tall ? 2 : r3 < Z.tall + Z.ankle ? 1 : 0; }
        const tallK = TUNE.clump.lo + (TUNE.clump.hi - TUNE.clump.lo) * vnoise(x * TUNE.clump.k, y * TUNE.clump.k, 42);
        const h = kind === 2 ? (TW.tall.h[0] + (TW.tall.h[1] - TW.tall.h[0]) * r2) * (.82 + .18 * tallK) : kind === 1 ? TW.ankle.h[0] + (TW.ankle.h[1] - TW.ankle.h[0]) * r2 : (Rm.h[0] + (Rm.h[1] - Rm.h[0]) * r2) * tallK;
        // (the forest's own tufts a tone LIGHTER than the ground they stand on: the calm sward draws a blade in its ground's tone, which
        // on the forest's open floor reads as nothing; a tussock should show)
        const lift = !meadow && !earth ? 1 : 0;
        const bc0 = earth ? (LUSH >= 0 ? LUSH : GRASS) * 4 + Math.min(3, tn + 1) : kind === 2 && LUSH >= 0 ? LUSH * 4 + Math.min(2, tn) : cd - Math.min(lift, tn);
        // a flower: the meadow's in the band, the forest's own beyond it (by what the ground is)
        let fl = 0;
        if (meadow) {
          if (kind !== 1 && ri === GRASS) { const pf = Math.min(1, Math.max(0, (vnoise(x * Fl.k, y * Fl.k, 43) - Fl.lo) / (Fl.hi - Fl.lo))); if (r4 < pf * Fl.p) fl = R() < Fl.other ? pick(R()) : pick(vnoise(x * Fl.k * .5 + 7, y * Fl.k * .5, 44)); }
        } else {
          const w = ri === HEATH ? FF.heath : ri === MOSS ? FF.moss : ri === HG ? FF.upland : ri === LUSH ? null : FF.floor;
          if (w) { const pf = Math.min(1, Math.max(0, (vnoise(x * FF.k, y * FF.k, 45) - FF.lo) / (FF.hi - FF.lo))); if (r4 < pf * FF.p) fl = pickW(vnoise(x * FF.k * .5 + 3, y * FF.k * .5, 46) * .8 + R() * .2, w); }
        }
        const tf = earth ? T.hair.tuft : Tf, rT = kind === 2 ? TW.tall.r : tf.r, fan = kind === 2 ? TW.tall.fan : tf.fan;
        const k = kind === 2 ? TW.tall.n[0] + Math.floor(R() * (TW.tall.n[1] - TW.tall.n[0] + 1)) : r5 < tf.single ? 1 : tf.n[0] + Math.floor(R() * (tf.n[1] - tf.n[0] + 1)), a0 = R() * Math.PI * 2;
        for (let i = 0; i < k && n < TUNE.max; i++) {
          const a = a0 + i * Math.PI * 2 / k + (R() - .5) * .9, rr = k === 1 ? 0 : rT * (.3 + .7 * R());
          const bx = x + Math.cos(a) * rr, by = y + Math.sin(a) * rr;
          let bc = bc0; if (k > 1 && kind !== 2 && !earth) { const c2 = code(bx, by); if (c2 !== undefined && c2 >> 2 !== EARTH) bc = c2 - Math.min(lift, c2 & 3); }
          const lean = k === 1 ? Tf.lone[0] + (Tf.lone[1] - Tf.lone[0]) * R() : fan[0] + (fan[1] - fan[0]) * R(), la = k === 1 ? R() : ((a / (Math.PI * 2)) % 1 + 1) % 1;
          const o = n * 4;
          A[o] = bx; A[o + 1] = host.elev(bx, by); A[o + 2] = by; A[o + 3] = h * (k === 1 ? 1 : .72 + .28 * R());
          B[o] = bc; B[o + 1] = R(); B[o + 2] = i === 0 ? fl : 0; B[o + 3] = Math.floor(Math.min(.9, lean) * 32) + Math.min(.999, la);
          n++; FC[ri]++;
        }
      }
    }
    F._.forest = {n: FC.reduce((a, b) => a + b, 0), by: Object.fromEntries([...fnames, 'earth'].map((nm, i) => [nm, FC[i]]))};
    return n;
  }
  build();

  // ---- the season's flowers (piecewise linear over env.year)
  function bloom(y) {
    const T = TUNE.bloom; y = ((y % 4) + 4) % 4;
    for (let i = 1; i < T.length; i++) if (y <= T[i][0]) { const [a, va] = T[i - 1], [b, vb] = T[i]; return va + (vb - va) * (y - a) / (b - a || 1); }
    return T[T.length - 1][1];
  }

  // ---- the pushers, nearest the player first (up to MAX_PUSH): [x, z, r, live, dir x, dir z, trample, 0]
  let np = 0, px0 = NaN, py0 = NaN, pvx = 0, pvy = 0;
  function add(x, y, r, live, dx, dy, tr) {
    if (np >= MAX_PUSH) return;
    const o = np * 8; PBUF[o] = x; PBUF[o + 1] = y; PBUF[o + 2] = r; PBUF[o + 3] = live; PBUF[o + 4] = dx; PBUF[o + 5] = dy; PBUF[o + 6] = tr; PBUF[o + 7] = 0; np++;
  }
  function pushers(dt) {
    np = 0;
    const pl = host.player, P = host.P, x = pl.x, y = pl.y;
    if (dt > 0 && px0 === px0) { const k = Math.min(1, dt * 12); pvx += ((x - px0) / dt - pvx) * k; pvy += ((y - py0) / dt - pvy) * k; }
    px0 = x; py0 = y;
    const onGround = pl.z - host.elev(x, y) < .2 && P.state !== 'climb', sp = Math.hypot(pvx, pvy);
    if (onGround && sp < 20) {
      const T = TUNE.trample, roll = P.state === 'roll' || P.state === 'backstep';
      const tr = roll ? T.roll : sp > 3.2 ? T.run : sp > .4 ? T.walk * Math.min(1, sp / 1.5) : 0;
      add(x, y, TUNE.push.player[0], TUNE.push.player[1], sp > .05 ? pvx / sp : 0, sp > .05 ? pvy / sp : 0, tr);
    }
    for (const p of walkers) {
      if (p.gone || p.broken || np >= MAX_PUSH || Math.abs(p.x - x) > 14 || Math.abs(p.y - y) > 9) continue;
      let L = last.get(p); if (!L) last.set(p, L = {x: p.x, y: p.y});
      const vx = dt > 0 ? (p.x - L.x) / dt : 0, vy = dt > 0 ? (p.y - L.y) / dt : 0, v = Math.hypot(vx, vy); L.x = p.x; L.y = p.y;
      const dx = v > .05 ? vx / v : 0, dy = v > .05 ? vy / v : 0;
      if (p.kind === 'barrel' || p.kind === 'barrel_x') { if (v > .3) add(p.x, p.y, TUNE.push.barrel[0], TUNE.push.barrel[1], dx, dy, TUNE.trample.barrel); continue; }
      if (p.air) continue;   // a brute in the air presses nothing
      const land = p.squash > .6;
      add(p.x, p.y, TUNE.push.brute[0] * (land ? 1.6 : 1), TUNE.push.brute[1], dx, dy, land ? TUNE.trample.land : v > .3 ? TUNE.trample.brute : 0);
    }
  }

  F.view = (dt, evs) => {
    if (!F.on || !grass.count) return;
    for (const e of evs) if (e.type === 'combat.explode' && nbl < 4) { BL[nbl * 3] = e.x; BL[nbl * 3 + 1] = e.y; BL[nbl * 3 + 2] = (e.r || 2) * TUNE.trample.blastR; nbl++; }
  };
  F.frame = f => {
    if (!F.on || !grass.count) return;
    const t0 = performance.now(), dt = f.dt || 0;
    const W = host.wind, nf = W?.gpu ? W.gpu(WBUF, MAX_FRONTS) : -1;
    grass.setWind(nf >= 0 ? WBUF : null);
    const env = host.env;
    grass.setLook(1 - TUNE.snowShrink * Math.min(1, env?.snowCover || 0), env ? bloom(env.year || 0) : .6);
    pushers(dt); grass.setPushers(PBUF, np);
    for (let i = 0; i < nbl; i++) grass.blast(BL[i * 3], BL[i * 3 + 1], BL[i * 3 + 2], TUNE.trample.blast);
    nbl = 0;
    grass.step(dt);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.biomeChanged = () => { build(); px0 = NaN; };
  F.toggle = () => { F.on = !F.on; grass.setVisible(F.on); return F.on; };
  F.hud = () => F.on && grass.count ? `grass ${grass.count} blades` : '';
  F.dispose = () => grass.dispose();
  return F;
}
