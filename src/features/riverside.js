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
//             stepping stones or the ravine's lip). Each lies flat on the water (host.world.waterH), drifting a pixel and turning
//             slowly in the current, bobbing a hair. In spring and summer two carry a flower (host.env.season). F.pads() -> the
//             live list for dragonflies / frogs. TRUE 3D (the pivot; ?props2d=1: the old camera-facing ellipse cards, the notch
//             and veins picked per yaw from a packed atlas): every pad a flat disc in the moss-green family with its notch cut
//             out, in five sectors (the seams between them draw the veins), the lilies' petals in two rings round a gold heart;
//             ALL of them one mesh whose vertices are rewritten from the pads' drift and turn PAD3.hz times a second while the
//             river is near the view (the motion steps a pixel at a time, like the water's), casting nothing
// WHERE THINGS STAND is the world's truth: decided once in create() from a fixed seed (core/rng.js mulberry32), so every load
// and ?views=0 give the same props. The pads' motion and drawing are presentation (F.view / F.frame, Math.random never needed).
//
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, biomeChanged, toggle, pads, ms.
// OWNS: the reed / fern / willow props it makes (identity fields only: kind, variant, x, y, z, r), the pads, its atlas.
// READS: layout.stream (STREAM), layout.brook (the West Downs' brook: world/brook.js), layout.marks (the paths), layout.plateaus, host.world.waterH,
// host.env.season, host.yaw, host.G.
// EMITS: nothing.
// BUDGET: view <= 0.03 ms, frame <= 0.05 ms (F3); the props are ~32 painted cards (23 reeds, 7 ferns, 2 willows: draws + the contact / mirror passes): see the commit.
import {flags} from '../core/flags.js';
import {mulberry32} from '../core/rng.js';
import {ART} from '../world/biomes.js';
import {pack, geoOf, M4} from '../world/kit3d.js';

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
const PAD3 = {hz: 10, sectors: 5, seg: 15, notch: .32};   // the 3D pads: updates a second, vein sectors, rim segments, the notch's half angle (rad)

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
  const outMouth = host.layout.mesa && host.layout.outflow ? host.layout.outflow.pts.at(-1)[1] : null;
  const segD = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); return hypot(x - ax - dx * t, y - ay - dy * t); };
  const pathD = (x, y) => { let d = 1e9; for (const m of marks) for (let i = 0; i + 1 < m.pts.length; i++) d = Math.min(d, segD(x, y, m.pts[i][0], m.pts[i][1], m.pts[i + 1][0], m.pts[i + 1][1]) - m.w / 2); return d; };
  const shrooms = T0.shrooms.map(([y, side, m]) => [S.cx(y) + side * (S.w(y) / 2 + m), y]);
  // a stretch of a bank is off limits: the narrows (both banks: the leap, the paths), the stepping stones, and the east bank
  // beside a plateau (the pool under its west face)
  function keepClear(side, y, x) {
    if (Math.abs(y - S.narrows.y) < T0.narrows) return true;
    for (const s of S.stones) if (Math.abs(y - s.y) < T0.stones) return true;
    if (side > 0) for (const q of plateaus) if (x > q.x0 - 2 && y > q.y0 - .5 && y < q.y1 + 1.5) return true;
    if (side > 0 && outMouth !== null && Math.abs(y - outMouth) < .9) return true;   // (walkable terrain: the pool's outflow meets the bank there)
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
  // ---- the West Downs' BROOK (world/brook.js): reeds in groups along its banks and round its pool, clear of its head, the bridge, the
  // stepping stones and the lip; ferns by its spring, beside the bridge and at the lip. Its own generator (the river's draws stay as they were)
  const BK = host.layout.brook, RB = mulberry32(TUNE.seed + 101), rb = (a, b) => a + RB() * (b - a), BPADS = [];
  if (BK) {
    const {px, py, hw, n} = BK, tx = BK.C.tx, ty = BK.C.ty;
    const off = (l, side, m) => {   // the bank m out from its water at l (the pool's rim where it widens)
      const i = Math.max(0, Math.min(n - 1, Math.round(l / BK.ds))), nx = -ty[i] * side, ny = tx[i] * side;
      let d = hw[i] + m; while (BK.inPool(px[i] + nx * d, py[i] + ny * d, m * .8) && d < 3) d += .08;
      return [px[i] + nx * d, py[i] + ny * d];
    };
    const busy = l => l < 1.7 || Math.abs(l - BK.bridgeL) < 2.4 || BK.stones.some(s => Math.abs(l - s.l) < 1.2) || l > BK.fallL - 1.2;
    for (const side of [-1, 1]) for (let l = 1.7 + rb(0, 1.5); l < BK.fallL - 1;) {
      const k = 2 + (RB() * 3 | 0), take = RB() < .66, step = rb(.36, .58), v0 = RB() * 3 | 0;
      if (take) for (let j = 0, ll = l; j < k; j++, ll += step * rb(.8, 1.2)) {
        if (busy(ll)) continue;
        const [x, y] = off(ll, side, rb(.1, .5));
        if (spotOk(x, y)) plant('reed', x, y, RB() < .55 ? v0 : RB() * 3 | 0);
      }
      l += (take ? (k - 1) * step : 0) + rb(.9, 2.2);
    }
    const S0 = BK.spring, fern = (x, y, v) => { if (spotOk(x, y, .45)) plant('fern', x, y, v); };
    fern(S0.x - .85, S0.y + .2, 0); fern(S0.x + .9, S0.y + .35, 1);
    for (const [dl, side, v] of [[-1.6, -1, 1], [-1.7, 1, 0], [1.6, -1, 0], [1.75, 1, 1]]) { const [x, y] = off(BK.bridgeL + dl, side, .45); fern(x, y, v); }
    for (const [side, v] of [[-1, 0], [1, 1]]) { const [x, y] = off(BK.fallL - .6, side, .5); fern(x, y, v); }
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
    // and a few on the brook's pool (its own generator), one in flower
    if (BK) for (let k = 0, t = 0; k < 5 && t < 80; t++) {
      const size = k === 0 ? 2 : RB() < .5 ? 1 : 0, r = P0.size[size], a = RB() * TAU, d = Math.sqrt(RB()), x = BK.pool.x + Math.cos(a) * BK.pool.rx * d, y = BK.pool.y + Math.sin(a) * BK.pool.ry * d;
      if (BK.poolEdge(x, y) < r + .22 || BPADS.some(q => hypot(q.x0 - x, q.y0 - y) < q.r + r + .06)) continue;
      const q = {x0: x, y0: y, x, y, h: 0, r, size, ang0: RB() * TAU, ang: 0, ph: RB() * TAU, w: .5 + RB() * .5, flower: k === 0, fi: 1, notch: 0}; PADS.push(q); BPADS.push(q); k++;
    }
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

  // ================================================================ the true-3D pads (see the header)
  const P2D = flags.get('props2d') === '1', THREE = host.THREE;
  let pad3 = null, pad3T = 0, pad3Bloom = null;   // {mesh, geo, ranges: [start, count, flowerStart] per pad, L0: local positions, N0: local normals}
  function padParts(q) {   // local: y up, the pad's centre on the water; the notch along +x (q.ang turns it)
    const L = [], r = q.r, S = PAD3.sectors, n = PAD3.seg, a0 = PAD3.notch, span = Math.PI * 2 - 2 * a0;
    for (let k = 0; k < S; k++) {   // a fan of triangles per sector, each sector its own part
      const g = new THREE.BufferGeometry(), P = [], m = Math.ceil(n / S);
      for (let j = 0; j < m; j++) {
        const t0 = a0 + span * (k * m + j) / (S * m), t1 = a0 + span * (k * m + j + 1) / (S * m);
        P.push(0, 0, 0, Math.cos(t0) * r, 0, -Math.sin(t0) * r, Math.cos(t1) * r, 0, -Math.sin(t1) * r);   // (counter-clockwise from above: it faces up)
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
      L.push({g, m: new THREE.Matrix4(), fam: 'cover', fixed: 0});   // (the moss green's light tone: as bright as the painted pads)
    }
    const fl = L.length;
    if (q.flower) {   // the lily: a gold heart, five inner petals standing up, eight outer ones opening out
      const pet = q.fi ? 'berryCream' : 'bone';
      L.push({g: new THREE.CylinderGeometry(.028, .032, .04, 6), m: M4([0, .025, 0]), fam: 'gold', fixed: 1});
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; L.push({g: new THREE.BoxGeometry(.05, .014, .11), m: M4([Math.sin(a) * .065, .026, Math.cos(a) * .065], [0, a, 0]).multiply(M4([0, 0, 0], [-.55, 0, 0])), fam: pet, fixed: i & 1}); }   // (turned out to a, its tip lifted)
      for (let i = 0; i < 5; i++) { const a = (i + .5) / 5 * Math.PI * 2; L.push({g: new THREE.BoxGeometry(.04, .012, .08), m: M4([Math.sin(a) * .04, .05, Math.cos(a) * .04], [0, a, 0]).multiply(M4([0, 0, 0], [-.9, 0, 0])), fam: pet, fixed: 0}); }
    }
    return {L, fl};
  }
  function build3() {   // one geometry for every pad (and lily), their local shapes kept to turn and place them
    const pos = [], nrm = [], part = [], fam = [], bias = [], fix = [], ranges = [];
    for (const q of PADS) {
      const {L, fl} = padParts(q), gp = geoOf(L.slice(0, fl)), gf = fl < L.length ? geoOf(L.slice(fl)) : null, start = pos.length / 3;
      for (const g of gf ? [gp, gf] : [gp]) {
        const A = g.attributes; pos.push(...A.position.array); nrm.push(...A.normal.array); part.push(...A.aPart.array); fam.push(...A.aFam.array); bias.push(...A.aBias.array); fix.push(...A.aFixed.array);
        g.dispose();
      }
      ranges.push([start, pos.length / 3 - start, gf ? start + gp.attributes.position.count : -1]);
    }
    const geo = new THREE.BufferGeometry(), A = (k, a, n) => { const b = new THREE.Float32BufferAttribute(a, n); geo.setAttribute(k, b); return b; };
    A('position', pos, 3).setUsage(THREE.DynamicDrawUsage); A('normal', nrm, 3).setUsage(THREE.DynamicDrawUsage); A('aPart', part, 1); A('aFam', fam, 1); A('aBias', bias, 1); A('aFixed', fix, 1);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of PADS) { x0 = Math.min(x0, q.x0); x1 = Math.max(x1, q.x0); y0 = Math.min(y0, q.y0); y1 = Math.max(y1, q.y0); }
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, WATER_H(), (y0 + y1) / 2), Math.hypot(x1 - x0, y1 - y0) / 2 + 1);   // (all the pads, the drift in it)
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - 1, WATER_H() - .5, y0 - 1), new THREE.Vector3(x1 + 1, WATER_H() + .5, y1 + 1));
    return {mesh: host.world.mesh(geo, null, {shadow: false}), geo, ranges, L0: Float32Array.from(pos), N0: Float32Array.from(nrm)};
  }
  function place3(bloom) {   // every pad turned and placed (its lily folded away out of season)
    const P = pad3.geo.attributes.position.array, N = pad3.geo.attributes.normal.array, L0 = pad3.L0, N0 = pad3.N0, wh = WATER_H() + .006;
    for (let i = 0; i < PADS.length; i++) {
      const q = PADS[i], rg = pad3.ranges[i], s = rg[0], n = rg[1], f = rg[2], c = Math.cos(q.ang), sn = Math.sin(q.ang), py = wh + q.h, end = f >= 0 && !bloom ? f : s + n;
      for (let v = s, j = s * 3; v < end; v++, j += 3) {
        const x = L0[j], z = L0[j + 2], nx = N0[j], nz = N0[j + 2];
        P[j] = q.x + x * c + z * sn; P[j + 1] = py + L0[j + 1]; P[j + 2] = q.y - x * sn + z * c;
        N[j] = nx * c + nz * sn; N[j + 1] = N0[j + 1]; N[j + 2] = -nx * sn + nz * c;
      }
      for (let v = end, j = end * 3; v < s + n; v++, j += 3) { P[j] = q.x; P[j + 1] = py; P[j + 2] = q.y; }   // (out of season: the lily's triangles all on one point)
    }
    pad3.geo.attributes.position.needsUpdate = true; pad3.geo.attributes.normal.needsUpdate = true;
  }

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
    syncBiome();
    if (!P2D) {   // the 3D pads: shown in the ruins, re-placed PAD3.hz times a second while the river is near (and when the season turns)
      if (!pad3 && padsOn && PADS.length) { pad3 = build3(); pad3T = -1; }
      if (!pad3) return;
      pad3.mesh.setVisible(padsOn && F.on); if (!padsOn) return;
      const sea = host.env?.season, bloom = sea === 'spring' || sea === 'summer', t = host.G.view.T;
      if (bloom !== pad3Bloom || (Math.floor(T * PAD3.hz) !== pad3T && Math.abs(t.x - S.cx(t.z)) < 22)) { pad3Bloom = bloom; pad3T = Math.floor(T * PAD3.hz); place3(bloom); }
      return;
    }
    if (!padsOn) return;
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
    syncBiome(); pad3 = null;   // (the rebuilt world disposed the pads' mesh: made again on the next frame in the ruins)
    for (const p of mine) if (!host.itemOf(p)) await host.world.addItem(p);   // (a rebuilt world already made them; only a prop it skipped is re-offered)
  };
  F.toggle = () => { F.on = !F.on; pad3?.mesh.setVisible(F.on && padsOn); };
  F._.PADS = PADS; F._.atlas = atlas;
  return F;
}
