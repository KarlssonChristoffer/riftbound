// RIVERSIDE (render3d): the river's green banks. Reeds and cattails along the water, a few ferns, two willows leaning over it
// from the west bank, lily pads on the calm stretches. (The damp, lusher ground under them is painted with the ground,
// world/biomes.js dampBanks; the willow's 3D model grows in world/trees3d.js.) ?riverside=0 adds nothing.
//
//   reeds     'reed' props (variants 0 reeds, 1 cattails with brown heads, 2 a mix): ONE card per clump (5-9 stems; the biome
//             paints it: ruins lush, frost dry stalks with snow on the heads, ember / rift none). Soft (r 0): walked through,
//             ignored by navigation and arrows. ~22-26 clumps in the band 0-0.6 m outside the water's edge, in groups with gaps,
//             denser on the inside of each bend. Kept off the narrows (the leap and the paths must read), the stepping stones,
//             the east bank under the plateau (brief B's pool), the glowing mushrooms and whatever else stands on the spot;
//             random scatter in the way is hidden (host.entities.hide), as the garden does
//   ferns     'fern' props (ruins): in the willows' shade and at the ravine's lip
//   willows   'tree' props, variant 3 (trees3d.js: speciesOf 'willow'; the painted card is the trees3d=0 fallback and what the
//             water mirrors): crowns overhanging the water, their curtains hanging to ~0.3 m above the ground
//   pads      lily pads: NOT entities, this file's own list. 8-9 groups of 2-5 on the calm stretches (not the narrows, the
//             stepping stones or the ravine's lip). Each lies flat on the water (host.world.waterH), drawn as a camera-facing
//             card painted as an ellipse (a circle on the ground projects to the same ellipse at every yaw; the notch and the
//             veins are chosen per yaw from a packed atlas), drifting a pixel and turning slowly in the current, bobbing a
//             hair. In spring and summer two carry a flower (host.env.season). F.pads() -> the live list for dragonflies / frogs
// WHERE THINGS STAND is the world's truth: decided once in create() from a fixed seed (core/rng.js mulberry32), so every load
// and ?views=0 give the same props. The pads' motion and drawing are presentation (F.view / F.frame, Math.random never needed).
//
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, biomeChanged, toggle, pads, ms.
// OWNS: the reed / fern / willow props it makes (identity fields only: kind, variant, x, y, z, r), the pads, its atlas.
// READS: layout.stream (STREAM), layout.marks (the paths), layout.plateaus, host.world.waterH, host.env.season, host.yaw, host.G.
// EMITS: nothing.
// BUDGET: view <= 0.03 ms, frame <= 0.05 ms (F3); the props are ~32 painted cards (23 reeds, 7 ferns, 2 willows: draws + the contact / mirror passes): see the commit.
import {flags} from '../core/flags.js';
import {mulberry32} from '../core/rng.js';
import {ART} from '../world/biomes.js';
import {pack} from '../world/kit3d.js';

const TAU = Math.PI * 2;
// ---------------------------------------------------------------- tunables
const TUNE = {
  seed: 11,
  reeds: {
    y: [3.4, 26.4],              // the stretch (m) the clumps may stand on
    band: [.08, .6],             // m outside the water's edge
    gap: [.5, 1.3],              // m of bare bank between groups
    n: [3, 6], step: [.4, .72],  // clumps per group, m between them along the bank
    apart: .36, want: 22,        // m between two clumps; the count the passes along the banks go on until
    narrows: 2.5, stones: 1.55,   // keep-clear half-lengths (m) round the narrows' y and each stepping stone's
    shroom: .8, path: .75,      // clear of a glowing mushroom (1.5 m on its camera side) / of a path's edge (m)
    soft: .5,                    // scatter within this of a clump is hidden; anything solid within it moves the clump on
    shrooms: [[19.6, -1, .5], [25.4, 1, .55], [9.6, -1, .5]],   // lights.js: [y, side, m outside the edge]
  },
  willows: [[5.7, 1.2], [19.9, 1.4]],   // [y, m of the trunk back from the west bank's edge]: the crown reaches east, ~1 m over the water (a third of it). (x picks the tree's shape: trees3d.js seeds it from the spot)
  pads: {
    groups: 9, north: 5, size: [.15, .2, .27],   // 5 groups north of the narrows (in the default view), the rest south
    drift: [.034, .05], turn: .35, bob: .006, flowers: 2,
  },
};
const NOTCHES = 16;   // the pad atlas: notch angles per size

// ORDER (core/features.js): after the garden. It adds its plants to the registry once everything the garden stood there (its stall, its
// plants, the scatter it cleared) is in, so a clump finds the gaps among them; nothing here reads the garden's state
export const order = {after: ['garden']};

export async function create(host) {
  const F = {name: 'riverside', label: 'Riverside (reeds, willows, lily pads)', ambient: true, on: true, ms: 0, pads: () => PADS, _: {}};
  const PADS = [];
  if (flags.get('riverside') === '0') { F.on = false; return F; }
  const S = host.layout.stream, R = mulberry32(TUNE.seed), mine = [];
  const T0 = TUNE.reeds, hypot = Math.hypot;

  // ================================================================ where the plants stand (the sim: once, from a fixed seed)
  const marks = (host.layout.marks || []).filter(m => m.type === 'path'), plateaus = host.layout.plateaus || [];
  const segD = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); return hypot(x - ax - dx * t, y - ay - dy * t); };
  const pathD = (x, y) => { let d = 1e9; for (const m of marks) for (let i = 0; i + 1 < m.pts.length; i++) d = Math.min(d, segD(x, y, m.pts[i][0], m.pts[i][1], m.pts[i + 1][0], m.pts[i + 1][1]) - m.w / 2); return d; };
  const shrooms = T0.shrooms.map(([y, side, m]) => [S.cx(y) + side * (S.w(y) / 2 + m), y]);
  // a stretch of a bank is off limits: the narrows (both banks: the leap, the paths), the stepping stones, and the east bank
  // beside a plateau (the pool under its west face)
  function keepClear(side, y, x) {
    if (Math.abs(y - S.narrows.y) < T0.narrows) return true;
    for (const s of S.stones) if (Math.abs(y - s.y) < T0.stones) return true;
    if (side > 0) for (const q of plateaus) if (x > q.x0 - 2 && y > q.y0 - .5 && y < q.y1 + 1.5) return true;
    return false;
  }
  const NEAR = [];
  // a spot for a plant at (x, y): clear of mushrooms, paths and anything solid; scatter in the way is hidden
  function spotOk(x, y, apart = T0.apart) {
    for (const [sx, sy] of shrooms) if (hypot(x - sx, (y - sy) * (y > sy ? .55 : 1)) < T0.shroom) return false;   // (a clump south of one would stand in front of it: keep further from that side)
    if (pathD(x, y) < T0.path) return false;
    for (const p of mine) if (hypot(p.x - x, p.y - y) < apart) return false;
    for (const q of host.entities.near(x, y, T0.soft + 1, NEAR)) {
      if (q.gone) continue;
      const d = hypot(q.x - x, q.y - y);
      if (q.rect ? (x > q.rect[0] - T0.soft && x < q.rect[2] + T0.soft && y > q.rect[1] - T0.soft && y < q.rect[3] + T0.soft) : d < T0.soft && !(q.kind === 'tuft' || q.kind === 'bush' || q.kind === 'rock')) return false;
    }
    return true;
  }
  const clearScatter = (x, y) => { for (const q of host.entities.near(x, y, T0.soft + 1, NEAR)) if (!q.gone && (q.kind === 'tuft' || q.kind === 'bush' || q.kind === 'rock') && !(q.r > 0) && hypot(q.x - x, q.y - y) < T0.soft) host.entities.hide(q, true); };
  function plant(kind, x, y, variant, r = 0) {
    clearScatter(x, y);
    const p = host.entities.add({kind, x, y, z: host.elev(x, y), variant, r}); mine.push(p); return p;
  }
  const rr = (a, b) => a + R() * (b - a);

  // reeds: groups along each bank, thinned by how far the bank is on the inside of a bend (the water slows there: the
  // centreline curves toward that bank). cx'' = -.9 k^2 sin(k y) for cx = 40 + .9 sin(k y): the west bank is inside where sin > 0
  const K = .33;
  for (let pass = 0; pass < 4 && mine.length < T0.want; pass++) {   // (a pass that leaves the bank thin is followed by another, over the gaps)
    for (const side of [-1, 1]) {
      for (let y = T0.y[0] + rr(0, 1.4); y < T0.y[1];) {
        const dens = .88 + .22 * (side < 0 ? 1 : -1) * Math.sin(K * y), n = T0.n[0] + (R() * (T0.n[1] - T0.n[0] + 1) | 0), v0 = R() * 3 | 0, take = R() < dens, step = rr(...T0.step);
        if (take) {
          for (let k = 0, yy = y; k < n; k++, yy += step * rr(.8, 1.2)) {
            if (yy > T0.y[1]) break;
            const x = S.cx(yy) + side * (S.w(yy) / 2 + rr(...T0.band));
            if (keepClear(side, yy, x) || !spotOk(x, yy)) continue;
            plant('reed', x, yy, R() < .55 ? v0 : R() * 3 | 0);
          }
        }
        y += (take ? (n - 1) * step : 0) + rr(...T0.gap);
      }
    }
  }
  // the willows: on the west bank, the trunk back from the edge, the crown (trees3d.js leans it east) overhanging the water
  const willows = TUNE.willows.map(([y, back]) => { const x = S.cx(y) - S.w(y) / 2 - back; clearScatter(x, y); return plant('tree', x, y, 3, .3); });
  // ferns: in each willow's shade (west and north of the trunk) and at the ravine's lip, both banks
  for (const w of willows) for (const [dx, dy, v] of [[-.75, .35, 0], [-.3, -.75, 1]]) { if (spotOk(w.x + dx, w.y + dy, .5)) plant('fern', w.x + dx, w.y + dy, v); }
  for (const [y, side, m, v] of [[25.7, -1, 1.2, 1], [26.4, -1, 1.7, 0], [25.9, 1, 1.3, 0], [26.5, 1, 1.9, 1]]) {
    const x = S.cx(y) + side * (S.w(y) / 2 + m); if (spotOk(x, y, .5)) plant('fern', x, y, v);
  }
  await Promise.all(mine.map(p => host.world.addItem(p)));   // their cards / meshes (a world built before this feature)
  F._.mine = mine; F._.willows = willows;

  // ================================================================ lily pads (presentation: this file's own list)
  const WATER_H = () => host.world.waterH ?? -.18, P0 = TUNE.pads;
  const GROUPS = [];
  {
    const used = [], pick = (lo, hi) => { for (let t = 0; t < 60; t++) { const y = rr(lo, hi); if (used.every(u => Math.abs(u - y) > 1.5)) { used.push(y); return y; } } return null; };
    const calm = y => Math.abs(y - S.narrows.y) > 3 && S.stones.every(s => Math.abs(y - s.y) > 1.7);
    const ys = [];
    for (let i = 0; i < P0.north; i++) { const y = pick(3.6 + i * 1.7, 5.0 + i * 1.7); if (y !== null && calm(y)) ys.push(y); }
    for (let i = 0; ys.length < P0.groups; i++) { const y = pick(18, 26.1); if (y === null) break; if (calm(y)) ys.push(y); }
    for (const y of ys) {
      const hw = S.w(y) / 2, side = R() < .5 ? -1 : 1, n = 2 + (R() * 4 | 0), g = {x: S.cx(y) + side * hw * rr(.18, .5), y, first: PADS.length, n: 0};
      for (let k = 0; k < n; k++) {
        const size = R() < .25 ? 2 : R() < .55 ? 1 : 0, r = P0.size[size];
        for (let t = 0; t < 12; t++) {
          const a = R() * TAU, d = k === 0 ? 0 : rr(.3, .75), x = g.x + Math.cos(a) * d, y2 = y + Math.sin(a) * d * 1.1;
          // on the water, the shadow-side margin from either bank (the card stands above it), clear of the others
          if (Math.abs(x - S.cx(y2)) > S.w(y2) / 2 - r - .5 || !calm(y2) || PADS.some(q => hypot(q.x0 - x, q.y0 - y2) < q.r + r + .06)) continue;
          PADS.push({x0: x, y0: y2, x, y: y2, h: 0, r, size, ang0: R() * TAU, ang: 0, ph: R() * TAU, w: .5 + R() * .5, flower: false, fi: 0, notch: 0}); g.n++; break;
        }
      }
      if (g.n) GROUPS.push(g);
    }
    for (let k = 0, got = 0; got < P0.flowers && k < 60 && PADS.length; k++) { const q = PADS[R() * PADS.length | 0]; if (!q.flower && q.size > 0) { q.flower = true; q.fi = got % 2; got++; } }
  }
  F._.groups = GROUPS;

  // the atlas: every pad size x NOTCHES notch angles (veins turn with the notch), two flowers
  const rp = (...h) => ART.ramp(...h);
  const PAD = rp('#9fcb6b', '#6ea64d', '#4b7f3f', '#2f5232'), LILY = rp('#fbf8ee', '#e4dfd2', '#b9b4aa', '#7c7a78'), LILYP = rp('#fbd9e4', '#f0a9c0', '#c9708f', '#7c3c58'), HEART = rp('#fff0a0', '#f2cc4a', '#c08a28', '#7a5018');
  const items = [], frames = [];
  const PPM = host.PPM, PPMY = host.PPMY;
  for (let s = 0; s < P0.size.length; s++) {
    frames[s] = [];
    const rx = P0.size[s] * PPM, ry = P0.size[s] * PPMY, w = Math.ceil(rx * 2) + 3, h = Math.ceil(ry * 2) + 3, cx = w / 2, cy = ry + 1.5;
    for (let k = 0; k < NOTCHES; k++) {
      const P = new ART.Pix(w, h), phi = k / NOTCHES * TAU;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + .5 - cx) / rx, v = (y + .5 - cy) / ry, r2 = u * u + v * v;
        if (r2 > 1) continue;
        const da = Math.abs(Math.atan2(Math.sin(Math.atan2(v, u) - phi), Math.cos(Math.atan2(v, u) - phi)));
        if (r2 > .03 && da < .3 + (1 - Math.sqrt(r2)) * .1) continue;   // the notch: a wedge cut to the middle
        const lit = -.55 * u - .62 * v;
        let vein = false; for (let q = 0; q < 5; q++) { const dv = Math.abs(Math.atan2(Math.sin(Math.atan2(v, u) - phi - (q + .5) * TAU / 5), Math.cos(Math.atan2(v, u) - phi - (q + .5) * TAU / 5))); if (dv < .1 && r2 > .06 && r2 < .6) vein = true; }
        P.p(x, y, PAD, vein ? 2 : lit > .5 && r2 > .3 ? 0 : lit < -.5 && r2 > .3 ? 2 : 1);
      }
      P.outline();
      const name = `pad_${s}_${k}`; items.push({name, img: P.canvas(), pivot: [w / 2, h - 1]}); frames[s][k] = name;
    }
  }
  const FLOWER = [['.....a.....', '.b..aAa..b.', '..bAaAaAb..', '.bBAhHhABb.', '..bAHHHAb..', '...bAhAb...', '....sss....', '.....s.....'], ['....aa.....', '.b.aAAa..b.', '.bBAAAAAB..', '..AAhHhAA..', '..bAHHHAb..', '...bAAAb...', '....sss....', '.....s.....']];
  FLOWER.forEach((rows, i) => {
    const Pf = new ART.Pix(11, rows.length), ramp = i ? LILYP : LILY;
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '.') return; Pf.p(x, y, ch === 'h' || ch === 'H' ? HEART : ch === 's' ? PAD : ramp, ch === 'a' || ch === 'h' ? 0 : ch === 'A' ? 1 : ch === 'H' ? 1 : ch === 'b' ? 2 : ch === 'B' ? 3 : ch === 's' ? 1 : 1); }));
    items.push({name: `flower_${i}`, img: Pf.canvas(), pivot: [5, rows.length - 1]});
  });
  const atlas = pack(items, 512), A = atlas.fr, FR = frames.map(row => row.map(n => A[n]));

  // ================================================================ the show
  let T = 0, padsOn = false;
  const syncBiome = () => { padsOn = host.biome.id === 'ruins'; };
  syncBiome();
  const SPR = {img: atlas.img, sx: 0, sy: 0, sw: 1, sh: 1, px: 0, py: 0, x: 0, y: 0, z: 0, type: 3, shadow: false, alpha: 1};
  F.view = dt => {
    const t0 = performance.now(); T += dt; syncBiome();
    if (padsOn) for (let i = 0; i < PADS.length; i++) {   // the current: a pixel or two of drift, a slow turn, a hair of bob
      const q = PADS[i], a = T * q.w + q.ph;
      q.x = q.x0 + Math.sin(a * .53) * P0.drift[0]; q.y = q.y0 + Math.sin(a * .37 + 1.3) * P0.drift[1];
      q.ang = q.ang0 + Math.sin(a * .3 + q.ph) * P0.turn; q.h = Math.sin(a * 1.7) * P0.bob;
    }
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.frame = () => {
    syncBiome(); if (!padsOn) return;
    const G = host.G, yaw = host.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw), wh = WATER_H() + .012, sea = host.env?.season, bloom = sea === 'spring' || sea === 'summer';
    for (let i = 0; i < PADS.length; i++) {
      const q = PADS[i];
      if (!G.onScreen(q.x, wh, q.y, 24)) continue;
      const k = Math.round((((q.ang + yaw) % TAU) + TAU) % TAU / TAU * NOTCHES) % NOTCHES, f = FR[q.size][k], d = q.r + .04;   // (the card stands on the pad's south edge: its bottom row)
      SPR.sx = f.sx; SPR.sy = f.sy; SPR.sw = f.sw; SPR.sh = f.sh; SPR.px = f.px; SPR.py = f.py;
      SPR.x = q.x + sy * d; SPR.y = wh + q.h; SPR.z = q.y + cy * d; G.sprite(SPR);
      if (q.flower && bloom) {
        const fl = A[`flower_${q.fi}`];
        SPR.sx = fl.sx; SPR.sy = fl.sy; SPR.sw = fl.sw; SPR.sh = fl.sh; SPR.px = fl.px; SPR.py = fl.py; SPR.x = q.x; SPR.y = wh + q.h + .01; SPR.z = q.y; G.sprite(SPR);
      }
    }
  };
  F.biomeChanged = async () => {
    syncBiome();
    for (const p of mine) if (!host.itemOf(p)) await host.world.addItem(p);   // (a rebuilt world already made them; only a prop it skipped is re-offered)
  };
  F.toggle = () => { F.on = !F.on; };
  F._.PADS = PADS; F._.atlas = atlas;
  return F;
}
