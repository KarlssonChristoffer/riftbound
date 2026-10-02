// DESERT: "Red Mesa", the western biome. The same map as the others (layout.js), painted as 1800s desert country: dune
// sand with wind ripples, cracked hardpan in the hollows, red-rock outcrops, sandstone paving with sand drifted into its
// joints, a shallow muddy creek with wet banks (the stream, the pool, the rill and the fall keep their water: a western
// creek and its waterhole), the ravine as a banded red canyon, the plateau as a mesa with striped rock layers and a
// ladder; saguaros for trees, sagebrush / prickly pear / barrel cactus / creosote for bushes, dry grass tufts.
// Registered with biomes.js registerBiome (appended after the four: their keys and indices stay); imported once by
// world/stage.js. The tables keyed by biome id elsewhere carry a 'desert' entry (world.js PAL / WATER_TUNE / FALL_LOOK /
// RAVINE, render/lighting.js GRADE / BG, content/moods.js MOODS, sim/env.js CLIMATE); the features fall back to the ruins.
// OWNS: the desert's style, ground and plant painters.  READS: biomes.js ART + GROUND_KIT, the layout through ctx.
// ART RULES: biomes.js's (4-tone ramps, light from the top-left, selective outlines, calm areas, no dither).
import {registerBiome, GROUND_KIT, ART} from './biomes.js';

const {Pix, build, ramp, hex, hsh, vn, rng, M} = ART;
const {kit, fbm, vor, flagstones, stone, crack, marks, inlayStyle, wallAO, stamp, paintStream, slab, paintPlateau, behindPlateau,
  strata, boulder, narrowRocks, dampBanks, paintRill, paintPool, paintOutflow, chan, fallFoot, dampPool} = GROUND_KIT;

// ---------------------------------------------------------------- the style
const STYLE = {
  id: 'desert', name: 'Red Mesa', wallH: 1.2, lowH: .45,
  // ground: dune sand (the "earth" every shared painter knows), hardpan, dry grass (the "grass"), the creek's wet banks
  earth: ramp('#e6cc98', '#d9bd86', '#c2a372', '#90724e'), pan: ramp('#d2ad7e', '#bf966a', '#a17b54', '#6e5238'),
  grass: ramp('#d8c688', '#bca86e', '#998656', '#665a3a'), damp: ramp('#a48a68', '#8c7458', '#715d48', '#4a3c30'),
  lush: ramp('#a4b06a', '#849450', '#647440', '#3e4a2e'),
  // the arena: sandstone paving, adobe walls, the marks
  floor: ramp('#dcbf92', '#c9aa7c', '#ad8f66', '#7c6448'), floorB: ramp('#d2b386', '#bc9c70', '#9e8058', '#6e573e'),
  inlay: ramp('#eedcb4', '#d8c296', '#b49c74', '#7e6a4c'), pad: ramp('#d0b28a', '#bfa07a', '#a08462', '#705a42'),
  wall: ramp('#d6ad7e', '#bc9064', '#9c724c', '#6a4a30'), wallB: ramp('#cfa070', '#b38356', '#926640', '#62422a'),
  // red sandstone in two bands (the mesa's and the canyon's stripes)
  rock: ramp('#c97e5c', '#ab6246', '#874a36', '#562c22'), rockB: ramp('#d89a70', '#be7e58', '#9a6244', '#643e2c'),
  wood: ramp('#c4ab88', '#a2896a', '#7f684f', '#504131'), metal: ramp('#a87c54', '#83603f', '#5e442e', '#38281b'),
  straw: ramp('#dcc890', '#bea872', '#988456', '#625438'), cloth: ramp('#d2bf9c', '#b4a07e', '#8f7c60', '#5c4e3c'),
  clay: ramp('#d68c5c', '#b46c40', '#8a502e', '#58321e'),
  gem: ramp('#d4fff2', '#6cdac8', '#3c9e9a', '#1e5a60'), gemGlow: ['#e6fffa', '#7af0e0'], gemInner: '#1a4a50',   // turquoise
  brute: ramp('#cdae88', '#ad8e6a', '#896c4e', '#564432'),
  water: ramp('#c2b890', '#a29a72', '#827c58', '#57533c'),   // a muddy creek
  // the plants
  cactus: ramp('#9cb474', '#789a5a', '#587a48', '#344e32'), spine: ramp('#f4ecd0', '#e0d4ac', '#bcae86', '#847a5c'),
  sage: ramp('#c6c69a', '#a4a67c', '#808462', '#565a44'), creosote: ramp('#8c9a58', '#6c7c44', '#4e5c36', '#323c26'),
  leaf: ramp('#b6bf96', '#949f7a', '#727e60', '#4a5442'),   // (the garden's shrubs take the biome's leaf: sage-green)
  fruit: ramp('#f088a8', '#d2507c', '#a0385c', '#5e2236'), bloom: ramp('#fff8e0', '#f6e6a8', '#d8c07a', '#8a7a4e'),
  bark: ramp('#9a8468', '#7a6650', '#5c4c3c', '#3a3026'),
  torch: '#ffc850', braz: ['#ffb04a', '#7fc8ff', '#a8ff6a'],
};
const S = STYLE;

// ---------------------------------------------------------------- the ground
// the canyon and the mesa: strata (biomes.js) for the tone, the layer's parity for the band's ramp
function band(x, r, fh, s) {
  const ly = r + Math.round((vn(x / 14, s, 94) - .5) * 5), layer = Math.floor(ly / 9);
  return [hsh(layer, 3, s) < .45 ? S.rockB : S.rock, strata(x, r, fh, s)];
}

function groundDesert(q, ctx, B) {
  const K = kit(q, ctx), {G, PLAY, X, Y, PPMH} = K, W = S.water;
  const cliff = mx => K.clampEdge(mx, K.HM - 2.3 + (vn(mx * .27, .5, 191) - .5) * 1.4);
  const F = K.field((mx, my) => fbm(mx * .2, my * .2, 114)), FR = K.field((mx, my) => fbm(mx * .7, my * .7, 124));   // (the rock's own, rougher relief)
  const outcrop = (x, y, mx, my, depth) => {
    if (vn(mx * 1.4, my * 1.4, 123) > .7 + depth * 2) { G.p(x, y, S.earth, 1); return; }   // drifted sand
    const v = vor(mx * 1.1, my * 1.5, 1.7, 118), R = hsh(v.id, 2) < .35 ? S.rockB : S.rock, sl = K.slope(FR, x, y);
    G.p(x, y, R, depth < .025 ? (sl < 0 ? 3 : 2) : v.d2 - v.d1 < .022 ? 3 : sl > .045 ? 0 : sl < -.05 ? 2 : 1);
  };
  K.fill((x, y, mx, my) => {
    const calm = K.calm(mx, my, .4), pd = K.pathD(mx, my), sl = K.slope(F, x, y);
    // red-rock outcrops well away from the arena, the trail and the creek: weathered rock with its own relief, a dark rim
    // where it meets the sand, a few cracks, sand settled in its hollows (big flat plates with outlined joints read as paving)
    const rk = calm ? -1 : fbm(mx * .15, my * .15, 117) - (pd < 2.2 ? .5 : 0) - (K.streamE(mx, my) < 1.6 ? .5 : 0);
    if (rk > .64) { outcrop(x, y, mx, my, rk - .64); return; }
    // cracked hardpan in the hollows (polygon cracks), and under the arena's floor where the paving is gone
    const pan = fbm(mx * .3 + 40, my * .3, 119) + (calm ? -.12 : 0);
    if (pan > .6) {
      const v = vor(mx, my * 1.25, .5, 120), e = v.d2 - v.d1;
      G.p(x, y, S.pan, e < .028 ? 3 : e < .05 ? 2 : sl > .06 ? 0 : 1);
      return;
    }
    // dune sand: the slope shades it, wind ripples on the open dunes (thin shaded lines across the wind)
    const rip = !calm && pd > 1.4 && fbm(mx * .1, my * .1, 122) > .48 && Math.sin((mx * .32 + my * .95 + fbm(mx * .4, my * .4, 121) * 1.6) * 18) > .9;
    G.p(x, y, S.earth, rip ? 2 : sl > .055 ? 0 : sl < -.06 ? 2 : 1);
  });
  // dry grass in sparse clumps, pebbles
  const rt = rng(172);
  for (let i = 0; i < 420; i++) {
    const mx = rt() * K.WM, my = rt() * K.HM, x = X(mx), y = Y(my); if (K.inside(mx, my, .8) || G.mat(x, y) !== S.earth.id) continue;
    for (const [a, b, t] of [[0, 0, 1], [1, -1, 0], [2, 0, 1], [-1, -1, 0], [1, 1, 2], [3, -1, 1]]) G.p(x + a, y + b, S.grass, t);
  }
  const r = rng(171);
  for (let i = 0; i < 300; i++) {
    const mx = r() * K.WM, my = r() * K.HM; if (K.calm(mx, my, 1)) continue;
    const x = X(mx), y = Y(my), w = 2 + (r() * 2 | 0), R = r() < .6 ? S.rock : S.rockB;
    for (let k = 0; k < w; k++) G.p(x + k, y, R, k === 0 ? 0 : 1); for (let k = 0; k < w; k++) G.p(x + k, y + 1, R, 3);
  }
  // old road stones out of the gates, half buried
  for (const s of flagstones(0, 0, K.WM, K.HM, 13, [.6, .8], [.6, 1.1])) {
    const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2;
    if (K.inside(mx, my, .3) || K.pathD(mx, my) > .95 || s.v < .45) continue;
    stone(K, s, s.v > .8 ? S.floorB : S.floor, s.v > .9 ? 0 : 1);
  }
  // the paving: big sandstone flags, sand drifted into the joints toward the walls (no moss out here)
  for (const s of flagstones(PLAY.x0 - .5, PLAY.y0 - .5, PLAY.x1 + .5, PLAY.y1 + .5, 5, [.8, 1.05], [.9, 1.7])) {
    const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2, ed = K.edgeD(mx, my);
    const wear = fbm(mx * .4, my * .4, 3) + Math.max(0, 1.8 - ed) * .2 - (Math.hypot(mx - K.cx, my - K.cy - .5) < 5.5 ? .25 : 0);
    if (wear > .74) continue;
    const drift = ed < 2.6 || wear > .58, sx0 = X(s.x0), sx1 = X(s.x1) - 1, sy0 = Y(s.y0), sy1 = Y(s.y1) - 1;
    const [xa, ya] = stone(K, s, s.v < .2 ? S.floorB : S.floor, s.v > .88 ? 0 : 1, (x, y, j) => {
      if (!drift) return false;
      const dj = Math.min(x - sx0, sx1 - x, (y - sy0) * 1.3, (sy1 - y) * 1.3), mm = vn(x / 7, y / 5, 117) + Math.max(0, 2.6 - ed) * .16 + wear * .2;
      const reach = mm > .96 ? 5 : mm > .86 ? 3 : mm > .76 ? 1.5 : mm > .64 && j ? .5 : -1;
      if (dj <= reach) { G.p(x, y, S.earth, dj >= reach - 1 && dj > .5 ? 0 : 1); return true; }
      return false;
    });
    if (s.v > .45 && s.v < .56) crack(K, xa + 4 + (s.v * 97 % 12 | 0), ya + 2, 7, S.floor, 2, s.r * 31 + s.k);
  }
  marks(K, S, inlayStyle(K, S, {over: {path(x, y, d, hw, mx, my) {   // a trodden track: packed, a shade darker than the sand
    const n = vn(mx * 1.1, my * 1.1, 133);
    G.p(x, y, S.pan, hw - d < .09 ? 2 : n > .7 ? 0 : 1);
  }}}));
  wallAO(K);
  // the stubs of older adobe walls outside the fort, sand heaped against them
  for (const [fx, fy, len] of [[1.2, 3.2, 4.5], [34.2, 1.4, 3.4], [1.5, 11.5, 3.2], [1.2, 26, 3.6], [11, 1.6, 5], [26, 2.2, 3.4]]) {
    let x = X(fx); const y = Y(fy), xe = X(fx + len), bh = 4, td = 3;
    while (x < xe) {
      const w = 12 + (hsh(x, 5) * 9 | 0); if (hsh(x, 9) < .25) { x += w; continue; }
      for (let i = 0; i < w - 1; i++) {
        for (let j = 0; j < td; j++) G.p(x + i, y - bh - td + j, S.wall, i === 0 || j === 0 ? 0 : 1);
        for (let j = 0; j < bh; j++) G.p(x + i, y - bh + j, S.wall, j === bh - 1 ? 3 : i === w - 2 ? 2 : 1);
        if (vn((x + i) / 5, fy, 105) > .55) for (let j = 0; j < 2; j++) G.p(x + i, y - j, S.earth, j ? 1 : 0);   // a drift at its foot
      }
      x += w;
    }
  }
  // the creek: muddy water between wet sand banks; flow streaks; the west bank's shadow on the water
  const riverSt = {
    stop: c => cliff(c) - .02,
    px(x, y, e, side, mx, my, c, hw) {
      if (e >= 0) { if (e < .06) G.p(x, y, S.damp, 3); else if (e < .18) G.p(x, y, S.damp, side < 0 ? 2 : 1); else if (e < .3 && hsh(x, y, 4) < .45) G.p(x, y, S.pan, 2); return; }
      const d = -e, streak = hsh(x, Math.floor(my * 3), 5) < .07;
      G.p(x, y, W, side < 0 && d < .14 ? 3 : side > 0 && d < .05 ? 0 : streak ? 0 : Math.abs(mx - c) < hw * .45 ? 2 : 1);
    },
    stone: st => slab(K, st, S.rock, {ring: (P, E, x, y) => P.p(x, y, W, 0)}),
  };
  paintStream(K, riverSt);
  paintPool(K, riverSt);   // the waterhole at the foot of the mesa
  paintOutflow(K, chan(riverSt));
  fallFoot(K, (x, y, rr) => { if (G.mat(x, y) === W.id && hsh(x, y, 12) < .8 * (1 - Math.max(0, rr - .1) / .45)) G.p(x, y, W, 0); });
  dampBanks(K, S, cliff);
  dampPool(K, S);
  narrowRocks(K, S.rock, S.earth);
  // the south edge: a red canyon, banded walls, the creek falling into it
  const abyss = hex('#2c1a14'), abyss2 = hex('#3a221a'), SM = K.stream;
  for (let x = 0; x < K.WPX; x++) {
    const mx = x / K.PPM, ey = Y(cliff(mx)), fh = Math.round((1.3 + vn(mx * .5, 3, 192) * .8) * PPMH);
    const fall = SM ? Math.abs(mx - SM.cx(cliff(mx))) - SM.w(cliff(mx)) / 2 : 9;
    for (let y = ey; y < K.HPX; y++) {
      const r2 = y - ey;
      if (fall < 0) {
        if (r2 < fh) G.p(x, y, W, fall > -.08 ? 2 : hsh(x, 17) < .3 ? 0 : 1);
        else if (r2 < fh + 5) G.p(x, y, W, hsh(x, y) < .5 ? 0 : 1);
        else G.c(x, y, hsh(x, y, 3) < .15 ? W.c[2] : abyss2);
        continue;
      }
      if (r2 < 2 && hsh(x, 3) < .7 - r2 * .3) { G.p(x, y, S.earth, r2 ? 2 : 0); continue; }   // the sand lip
      if (r2 < fh) { const [R, t] = band(x, r2, fh, 3); G.p(x, y, R, t); }
      else G.c(x, y, vn(x / 26, y / 9, 195) > .62 ? abyss2 : abyss);
    }
  }
  // the plateau: a mesa, sand and red rock on top, striped walls, a ladder at the climb spot
  paintPlateau(K, {
    top(x, y, mx, my, rs, climb) {
      if (rs === 0) { G.p(x, y, S.rock, 0); return; }   // the lit lip
      if (climb && rs < 6) { G.p(x, y, S.pan, 1); return; }
      const rk = fbm(mx * .25, my * .25, 127) - .5;
      if (rk > .06) { outcrop(x, y, mx, my, rk - .06); return; }   // bare rock showing through the mesa's sand
      const sl = fbm(mx * .3, (my + .3) * .3, 126) - fbm(mx * .3, (my - .3) * .3, 126);
      G.p(x, y, S.earth, sl > .08 ? 0 : sl < -.09 ? 2 : 1);
    },
    face(x, y, r, hp) {
      if (r < 2) { G.p(x, y, S.rock, r ? 1 : 0); return; }
      const [R, t] = band(x, r - 2, hp - 2, 5); G.p(x, y, R, t);
    },
    climb(x, y, r, hp, i, n) {
      if (r < 2) return;
      // a wooden ladder pinned to the rock, a rope hanging beside it
      const rail = i === 6 || i === n - 7, inner = i > 6 && i < n - 7, rung = r % 7 === 4 && inner, under = r % 7 === 5 && inner;
      if (rail || rung || under) { G.p(x, y, S.wood, rung ? 0 : under ? 3 : i === 6 ? 1 : 2); return; }
      if (i === n - 4 && (r & 3) !== 3) G.p(x, y, S.straw, (r >> 1) & 1 ? 1 : 2);
    },
  });
  // the mesa's spring and its rill: water welling up between red boulders, a channel to the edge, a foam lip
  const SP = K.layout.spring;
  paintRill(K, {px(x, y, e, side, mx, my, o) {
    if (e >= 0) { if (e < .05) G.p(x, y, S.damp, 3); else if (e < .13) G.p(x, y, S.damp, side < 0 ? 2 : 1); else if (e < .24 && hsh(x, y, 4) < .5) G.p(x, y, S.pan, 1); return; }
    const d = -e, rs = Math.hypot(mx - SP.x, my - SP.y);
    let t;
    if (rs < SP.r + .03) t = rs < .07 || (rs > .15 && rs < .19 && hsh(x, y, 8) < .85) ? 0 : side < 0 && d < .1 ? 3 : rs < .22 ? 2 : 1;
    else {
      t = side < 0 && d < .09 ? 3 : side > 0 && d < .04 ? 0 : Math.abs(o.a) < o.hw * .45 ? 2 : 1;
      if (my > K.layout.fall.y - .1 && hsh(x, y, 13) < .8) t = 0;
    }
    G.p(x, y, W, t);
  }});
  for (const [a, rr, sz, v] of [[-2.25, .56, 1, 1], [-1.55, .52, .9, 2], [-.85, .56, 1.1, 3], [-.1, .6, .9, 4], [.6, .62, 1, 5], [1.3, .62, 1.1, 6], [2.0, .6, .8, 7]])
    boulder(K, SP.x + Math.cos(a) * rr, SP.y + Math.sin(a) * rr, 5 * sz + 1.5, 3.2 * sz + 1, v & 1 ? S.rock : S.rockB, v * 13, S.earth);
  K.finish(B);
  B.hole = (x, y, c) => y > cliff(x) - .3 || K.streamE(x, y) < .4 || (c && behindPlateau(c, x, y));
}

// ---------------------------------------------------------------- the plants
// shade a cactus already filled with tone 1: cylinders lit from the left (runShade), ribs every 3 px down the columns,
// a few spine dots on the lit edge, then the outline
function cactusFinish(P, R, ribs = true) {
  P.runShade([R]);
  if (ribs) for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.mat(x, y) === R.id && P.tone(x, y) < 2 && x % 3 === 0 && hsh(x, y >> 2, 31) < .85) P.shift(x, y, 1);
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.mat(x, y) === R.id && !P.on(x - 1, y) && hsh(x, y, 32) < .22) P.p(x - 1, y, S.spine, 1);
  P.outline({only: [R.id]});
}
// a saguaro: a ribbed column, arms that elbow out and turn up. Variants: 0 two arms, 1 three, 2 a young one without arms,
// 3 the old giant (the river's tree slot) with four arms, one drooping
function saguaro(p, ctx) {
  const v = p.variant | 0, m = M(ctx), H = m.H([3.6, 4.2, 2.4, 4.8][v]), W = 64, cx = 32, b = H - 3, C = S.cactus;
  const tw = Math.max(7, m.W(.4)), aw = Math.max(5, Math.round(tw * .72));
  return build(W, H, [cx, H - 2], P => {
    const column = (x0, y0, y1, w) => {
      for (let y = Math.round(y0); y <= y1; y++) for (let x = Math.round(x0 - w / 2); x < Math.round(x0 + w / 2); x++) P.p(x, y, C, 1);
      P.disk(x0, y0, w / 2, (x, y) => P.p(x, y, C, 1));
    };
    const arm = (side, yj, out, up, droop = false) => {
      const xe = cx + side * (tw / 2 + out);
      for (let y = Math.round(yj - aw / 2); y < Math.round(yj + aw / 2); y++) for (let x = Math.min(cx, Math.round(xe)); x <= Math.max(cx, Math.round(xe)); x++) P.p(x, y, C, 1);
      P.disk(xe, yj, aw / 2, (x, y) => P.p(x, y, C, 1));
      if (droop) column(xe, yj, yj + up, aw); else column(xe, yj - up, yj, aw);
    };
    const top = Math.round(H - m.H([3.6, 4.2, 2.4, 4.8][v]) + tw / 2 + 1);
    column(cx, top, b, tw);
    const A = [[[-1, .55, 5, .28], [1, .42, 6, .3]], [[-1, .6, 5, .25], [1, .5, 6, .3], [-1, .36, 4, .16]], [],
      [[-1, .62, 6, .3], [1, .55, 7, .32], [1, .32, 5, .14], [-1, .4, 5, .2, true]]][v];
    for (const [side, f, out, up, droop] of A) arm(side, b - (b - top) * f, out, (b - top) * up, droop);
    cactusFinish(P, C);
    if (v === 1) for (const [x, y] of [[cx - 1, top - 1], [cx + 2, top], [cx - 3, top + 1]]) P.p(x, y, S.bloom, 0);   // white blossoms on the crown
    for (const [x, w] of [[cx - tw / 2 - 2, 3], [cx + tw / 2, 3]]) for (let i = 0; i < w; i++) P.p(Math.round(x) + i, b + 1, S.earth, i === 1 ? 1 : 2);   // sand at its foot
  });
}
// bushes. 0 sagebrush (silvery, soft), 1 prickly pear (flat pads, magenta fruit), 2 barrel cactus (yellow crown), 3 creosote
function desertBush(p) {
  const v = p.variant | 0;
  return build(28, 22, [14, 21], P => {
    const r = rng(v * 17 + 105);
    if (v === 0) {
      // a broken, twiggy clump: many small tufts with gaps between them, grey twigs at the foot (smooth blobs read as rocks)
      for (let i = 0; i < 9; i++) { const x = 6 + r() * 16, y = 9 + r() * 9, a = 2.4 + r() * 2.2; P.blob(x, y, a, a * .8, S.sage, {s: i * 7 + v, j: .55, edge: 1.1, bias: -(y - 12) * .04}); }
      for (let y = 0; y < 22; y++) for (let x = 0; x < 28; x++) if (P.mat(x, y) === S.sage.id && vn(x / 1.6, y / 1.6, 44) > .7) P.off(x, y);   // gaps
      for (let i = 0; i < 7; i++) { const x = 8 + (r() * 12 | 0), h = 2 + (r() * 4 | 0); for (let j = 0; j < h; j++) P.p(x + (j > 1 ? (i & 1 ? 1 : -1) : 0), 20 - j, S.bark, j ? 1 : 2); }
      P.outline();
      for (let i = 0; i < 10; i++) { const x = 7 + (r() * 15 | 0), y = 8 + (r() * 9 | 0); if (P.mat(x, y) === S.sage.id && P.tone(x, y) < 2) P.p(x, y, S.sage, 0); }
    } else if (v === 1) {
      const pads = [[14, 16, 5, 4.2], [9, 12, 4, 3.4], [19, 11, 4.2, 3.6], [14, 8, 3.6, 3], [6, 17, 3.4, 2.8], [21, 17, 3.6, 3]];
      for (const [x, y, a, b] of pads) P.blob(x, y, a, b, S.cactus, {s: x * 3 + y, j: .15, hi: .6});
      P.outline();
      for (const [x, y, a, b] of pads) { for (let k = 0; k < 3; k++) P.p(Math.round(x - a / 2 + r() * a), Math.round(y - b / 2 + r() * b), S.spine, 0); if (r() < .6) { P.p(Math.round(x - 1), Math.round(y - b), S.fruit, 1); P.p(Math.round(x), Math.round(y - b), S.fruit, 0); } }
    } else if (v === 2) {
      P.blob(14, 14, 6, 7, S.cactus, {s: 7, j: 0});
      for (let y = 0; y < 22; y++) for (let x = 0; x < 28; x++) if (P.mat(x, y) === S.cactus.id && (x - 14 + 40) % 3 === 0) P.shift(x, y, 1);
      P.outline();
      for (const [x, y, t] of [[12, 7, 1], [13, 6, 0], [15, 6, 0], [16, 7, 1], [14, 6, 0]]) P.p(x, y, S.bloom, t);
      for (let y = 8; y < 21; y += 2) { P.p(7, y, S.spine, 1); P.p(21, y, S.spine, 2); }
    } else {
      const tw = (x, y, a, l, d) => { const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l; P.line(x, y, ex, ey, (px, py) => P.p(px, py, S.bark, d ? 1 : 2)); if (d < 2) { tw(ex, ey, a - .45, l * .62, d + 1); tw(ex, ey, a + .4, l * .58, d + 1); } else P.blob(ex, ey, 2.2, 1.8, S.creosote, {s: ex * 7 + ey, j: .3}); };
      for (let k = 0; k < 4; k++) tw(14 + k - 2, 21, -Math.PI / 2 + (k - 1.5) * .42, 6 + r() * 3, 0);
      P.outline();
    }
  });
}
// dry grass: a few stiff straw blades fanning out (variant 2: a pebble with a tuft behind it)
function dryTuft(p) {
  const v = p.variant | 0;
  return build(11, 9, [5, 8], P => {
    const bl = [[1, 4, -1], [3, 6, -1], [5, 7, 0], [6, 6, 1], [8, 5, 1], [9, 3, 1]].slice(v % 2, 6 - (v === 2 ? 2 : 0));
    for (const [x, h, lean] of bl) for (let j = 0; j < h; j++) P.p(x + (j > 2 ? lean : 0) + (j > 4 ? lean : 0), 8 - j, S.grass, j === h - 1 ? 0 : j < 2 ? 2 : 1);
    if (v === 2) { P.blob(7, 7, 2.6, 1.8, S.rock, {s: 3}); P.outline({only: [S.rock.id]}); }
  });
}

registerBiome(STYLE, groundDesert, {tree: saguaro, bush: desertBush, tuft: dryTuft, reed: () => null, fern: () => null});
