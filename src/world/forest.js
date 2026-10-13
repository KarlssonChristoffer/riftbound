// FOREST: the woods north of the Proving Grounds, grown from a SEED (docs/FOREST.md). The same seed gives the same forest on
// every machine, to the tree: the co-op server sends its seed (core/session.js) and checks acts against the trees it grows
// itself from it (server/room.mjs), so everything here is a pure function of the seed and the place: no Math.random, no DOM,
// no import of the game's state (node runs this file too). Offline: ?seed=N or ?forest=1.
//   RECT      x -48..72 (the world's width: the West Downs, the Proving Grounds, the mesa), y -160..0: 120 x 160 m, its south edge
//             meeting the Proving Grounds' north edge, the ground there held level (the relief fades in over its first metres).
//             HOME, its south part (y -64..0), holds the home woods (the lake, the streams, the esker, the hills, the outcrops);
//             the HIGH COUNTRY north of it the upland, the fell and the canyon
//   CHUNKS    the land is grown in CHUNK m squares on a lattice from 0, 0 (chunk cx, cy covers x cx*CHUNK .. +CHUNK): what grows in
//             one depends on the seed, its own coordinates and the forest's few global features (the lake, the stream), never on
//             its neighbours, so the forest can grow by chunks later (a bigger RECT, or chunks made as you walk) without moving a tree
//   RELIEF    the home woods' ice-age ground (docs/FOREST.md): rolling moraine (three octaves of value noise, 0 .. ~3.2 m) and up to
//             three rounded hills (3.8 .. 5.8 m, wide enough to walk: terrain.js WALK; one or two fit most seeds); a 'field' terrain shape (its height
//             function) + 'hill' shapes, for layout.js's TERRAIN
//   UPLAND    the high country stands 7 .. 8.5 m over the home woods, up a walkable slope (28 m) from a wavering foot just north of
//             them; the fell rises from it, the canyon is cut into it
//   FELL      a rounded massif (12 .. 13 m over the upland, the top ~22 .. 25 m) on one side: straight walkable flanks, longest on
//             the stoss side, shortest on the lee (toward the home woods), a rounded top; CRAGS in its flanks, mostly the lee:
//             shelves level with the slope a little above their middle, so the uphill side lies under the slope and the downhill
//             side drops 2 .. 4 m as a rock face; a TOR or two (blocks of bare rock) on its top. No trees high on it (bare)
//   CANYON    on the other side: a gorge cut into the upland from just past its foot north to a rounded head short of the north
//             edge, wandering, 5 .. 7.5 m across, its walls straight down (rock, world.js: F.canyon.wall), its floor the ground at
//             its mouth rising a little inward. The fell and the upland are part of the field; crags and tors are F.outcrops
//             (kind 'crag' / 'tor'), the canyon a channel in F.shapes (drawn wider: CANYON_IN). Their own generator (mix(seed,
//             4)): the home woods come out the same whatever they do
//   ICE       the way the ice flowed (from the north-west, give or take: the seed's): the esker runs along it, the outcrops face it
//   CLEARING  a flat spot on the lake's shore kept open for the settlement (F.clearing): nothing grows in it but grass
//   ESKER     one long winding gravel ridge (2.2 .. 2.8 m high, 36 .. 64 m, a flat crest kept clear: a path along its top), part of the field
//   OUTCROPS  bedrock humps (roches moutonnees): a gentle slope up from the side the ice came from, a small rock cliff on the side it
//             went (F.outcrops: {h, ctl: [[x, y, bank], ...]}; layout.js makes each a terrace with rock, as its ledges), and BLOCKS:
//             big lone boulders, rock all round. Away from the water, the clearing and the esker's crest
//   BOULDERS  one boulder field in a hollow (F.boulders: {x, y, r}): big and small rocks lying close
//   LAKE      a lake in the lowest hollow the seed's candidates find: a basin cut level into the ground, its floor at the water's
//             surface; the first TUNE.lake.wade m out from the shore are a shelf you wade, past it DEEP water (F.inDeep, inStream:
//             falling in is a respawn, as the river). Its SHORE wanders inside the basin's ellipse (bays and points from a few
//             seeded lobes; full where the stream comes in, where the outflow leaves and toward the clearing): the basin's floor
//             left dry between the two is a STRAND of sand, gravel and stones at the water's height. Still water (sample's speed
//             0: gfx.js WATER_FS wStill), a shallow shelf along the shore that drops off to the deep (depth)
//   STREAM    from a spring on high ground near the north edge it runs down to the lake, wandering, downhill where it can; shallow
//             and wadeable (not water to the sim); its bed is cut into the ground (lay, with layout.js's sampler: never rising
//             downstream, into the lake at its surface)
//   GROWTH    per chunk, on jittered lattices: TREES (3.2 m cells; a density field makes thickets and clearings; conifers on the
//             higher ground and in their own drifts, oaks, birches, aspens, rowans and a dead one now and then elsewhere, willows by
//             the water), the UNDERGROWTH (1.6 m cells: bushes and ferns under the trees, tufts in the clearings, reeds at the
//             water's edge) and ROCKS (boulders on the slopes, stones). Nothing in the water, on its banks or too steep. Each tree has
//             a stable id (fid: 't<cx>.<cy>.<n>'), the handle co-op and the woodcutting use for it
// Uses existing kinds only (tree / bush / fern / tuft / reed / rock / rock_big): the art is the ruins' (trees3d.js, flora3d.js, the kit).
// OWNS: nothing at run time (plain data). READS: core/mathx.js.
//   const F = forestPlan(seed)   F.shapes, F.props, F.lake, F.stream, F.inLake, F.lakeEdge, F.at, F.height, F.trees (Map fid -> [x, y])
//   F.lay(sampler)               the stream's bed from the ground it is cut into (layout.js, once): F.stream.bed, its channel in F.cuts
//   sample(F, x, y, out) / depth(o, x, y) / paint(F, K, S, T)    the water for world.js, waterbed.js, biomes.js
import {vnoise, smooth, clamp, hash3} from '../core/mathx.js';
import {RECIPES} from '../content/recipes.js';   // (the windthrow's bare earth: its ground(p); pure data, no imports)

export const CHUNK = 16;
export const RECT = {x0: -48, y0: -160, x1: 72, y1: 0};
export const HOME = {x0: -48, y0: -64, x1: 72, y1: 0};   // the home woods (the lake, the esker, the hills, the outcrops): the south half; the high country north of it
const FADE = [2, 12];
// the Proving Grounds' river comes out of the north edge here (layout.js STREAM: x 40 at y 0, 2.9 m wide): the lake's outflow runs into it
export const MOUTH = {x: 40, y: -.4, hw: 1.45};          // the relief is 0 within FADE[0] m of the south edge, full FADE[1] m in
const WATER_H = -.18;
const CANYON_IN = .35;         // the canyon is drawn this much wider than walked: the drawn ground's steep cells lie behind its rock (layout.js CLEFT_IN)          // the lake's surface under its basin (world.js WATER_H)
export const TUNE = {
  relief: {amp: 3.2, north: 0, k: 1 / 30, hills: [2, 3], hillH: [3.8, 5.8], hillR: [11, 15], hillK: 2.8},   // (hillK: a hill is at least that x its height across: walkable)
  ice: {spread: .9},
  mountain: {h: [11.5, 13], r: [31, 34], stoss: 1.1, lee: .95, wob: .1, lump: .08, calm: .5, crags: [5, 8], cragL: [6, 13], cragD: [5, 8.5], tors: [1, 3], torN: [3, 5], treeline: .6},
  upland: {h: [7, 8.5], slope: 28},
  canyon: {side: 22, head: 9, wander: 5, hw: [1.7, 2.7], rise: [.6, 1.4], ridge: [5.5, 6.5], rim: 2, fall: 18, in: [14, 40]},
  clearing: {r: 7, off: 4.5},
  esker: {h: [2.2, 2.8], crest: 1.2, w: 8.5, len: [36, 64], taper: .26},
  outcrop: {n: [3, 6], len: [3.5, 7], wid: [2.4, 4.2], rise: [1.1, 2.3]},
  block: {n: [3, 6], r: [1.1, 1.9], rise: [1.5, 2.8]},
  boulders: {r: [4, 5.5], n: [10, 16]},
  lake: {rx: [6.5, 9.5], ry: [4.5, 6.5], depth: .35, rim: 3.2, minBed: .55, shore: .36, shelf: 1.3, wade: 1},   // (shore: how far the bays reach in, a share of the radius; shelf: m of shallows before the drop-off; wade: m of it walked)
  stream: {hw0: .3, hw1: .55, step: .6, depth: .1, bank: 1.25, wander: .3,   // (wander: the width swells and pinches by up to this share along it)
    riffle: {slope: [[.06, .22], [.012, .05]], steps: .4, stones: [.06, .5], r: [.13, .28]}},   // (riffles: the bed's slope from calm to all white, the stream's then the outflow's; steps: how much of a steep stretch runs white (a noise's cut: the rest are its pools); stones: odds a stone stands at a point, in a run .. a riffle; r: its radius, m)
  trees: {cell: 3.2, jitter: .36, base: .12, dense: .78, slope: .5, water: 1.4, edge: 2.2, south: 4},
  under: {cell: 1.6, jitter: .4, p: .2},
  rocks: {big: 3, small: 3},
  // the SMALL THINGS (content/recipes.js, drawn by world/decor3d.js): chances per 2 m cell (DECOR below), x how well the spot suits
  decor: {cell: 2, jitter: .4, stump: .045, log: .022, agaric: .028, chant: .012, berry: .1, lingon: .07, berryS: 1.6, variants: 3, settle: [3, 5],
    windthrow: {cell: 4, p: .45, lone: .006, near: [1, 7], len: [3, 4, 5]},   // (rotvältor: p in the storm's lane, lone elsewhere on the thin soil within near m of rock)
    storm: {half: [22, 34], band: 7, tries: 10, log: 3, stump: 2}},   // (the gale's lane: half its length, its half width (m); more logs / snapped stumps in it)
};

// a seeded generator of its own (mulberry32, as core/rng.js: kept here so node needs nothing else)
function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mix = (seed, a, b = 0) => (hash3(seed | 0, a, b) * 4294967296) | 0;
const fbm = (x, y, s) => vnoise(x, y, s) * .55 + vnoise(x * 2.1 + 17.3, y * 2.1 - 4.1, s + 1) * .3 + vnoise(x * 4.3 - 9.7, y * 4.3 + 2.2, s + 2) * .15;
const southFade = y => smooth((RECT.y1 - y - FADE[0]) / (FADE[1] - FADE[0]));

const plans = new Map();
export function forestPlan(seed) {
  seed = seed >>> 0;
  let F = plans.get(seed); if (F) return F;
  const S = mix(seed, 1) & 0xffff, R = rng(mix(seed, 2)), T = TUNE;
  F = {seed, rect: RECT, chunk: CHUNK, shapes: [], cuts: [], props: [], trees: new Map(), laid: false};
  // ---- RELIEF: the rolling ground (held lower along the lake's way out to the river: its outflow doesn't cut a gorge), then the hills
  // (away from the south edge)
  const raw = (x, y) => T.relief.amp * smooth((fbm(x * T.relief.k, y * T.relief.k, S) - .3) / .55) * southFade(y) * (1 + T.relief.north * smooth((HOME.y0 - y) / 40));   // (higher ground in the high country)
  let reliefH = raw;
  const hills = [];
  // ---- LAKE: in the lowest hollow of a few candidates (the relief only: the hills keep away from it) whose ground stays high enough
  // for its water to run out downhill to the river (its surface over the river's: OUTFLOW)
  {
    let best = null;
    for (let i = 0; i < 32; i++) {
      const x = RECT.x0 + 16 + R() * (RECT.x1 - RECT.x0 - 32), y = HOME.y0 + 12 + R() * (RECT.y1 - HOME.y0 - 32);
      let m = 0, lo = 1e9; for (let k = 0; k < 17; k++) { const a = k * Math.PI / 8, r = k % 2 ? 1 : .5, h = raw(x + Math.cos(a) * 8 * r, y + Math.sin(a) * 5.5 * r); m += h; lo = Math.min(lo, h); }
      const score = m / 17 + Math.max(0, T.lake.minBed - (lo - T.lake.depth)) * 6 + Math.hypot(x - MOUTH.x, y - MOUTH.y) * .006;   // (low, but not too low; nearer the river wins ties)
      if (!best || score < best.score) best = {x, y, score};
    }
    const rx = T.lake.rx[0] + R() * (T.lake.rx[1] - T.lake.rx[0]), ry = T.lake.ry[0] + R() * (T.lake.ry[1] - T.lake.ry[0]);
    const lx = +best.x.toFixed(2), ly = +best.y.toFixed(2);
    reliefH = (x, y) => raw(x, y) * (.25 + .75 * smooth((segD(x, y, lx, ly, MOUTH.x, MOUTH.y) - 4) / 12));
    let lo = 1e9; for (let k = 0; k < 64; k++) { const a = k * Math.PI / 32, r = (k % 4) / 3 * 1.15; lo = Math.min(lo, reliefH(lx + Math.cos(a) * rx * r, ly + Math.sin(a) * ry * r)); }
    const bed = Math.max(T.lake.minBed, lo - T.lake.depth);
    let rise = 0; for (let k = 0; k < 32; k++) { const a = k * Math.PI / 16; rise = Math.max(rise, reliefH(lx + Math.cos(a) * (rx + 1.5), ly + Math.sin(a) * (ry + 1.5)) - bed); }
    F.lake = {x: lx, y: ly, rx: +rx.toFixed(2), ry: +ry.toFixed(2), bed: +bed.toFixed(3), rim: +Math.max(T.lake.rim, rise * 2.3).toFixed(2)};   // (rim: wide enough to walk down to the water)
  }
  const L = F.lake;
  const lakeD = (x, y) => Math.hypot((x - L.x) / L.rx, (y - L.y) / L.ry);   // 1 at its edge
  F.inLake = (x, y, grow = 0) => { const rx = L.rx + grow, ry = L.ry + grow; if (x < L.x - rx || x > L.x + rx || y < L.y - ry || y > L.y + ry) return false; const u = (x - L.x) / rx, v = (y - L.y) / ry; return u * u + v * v < 1; };
  F.lakeEdge = (x, y) => { const u = (x - L.x) / L.rx, v = (y - L.y) / L.ry, r = Math.hypot(u, v), g = Math.hypot(u / L.rx, v / L.ry); return g > 1e-6 ? (1 - r) * r / g : L.ry; };   // m to its edge (+ inside)
  const ySouth = RECT.y1 - FADE[1];                                        // (the relief fades out south of this: nothing stands proud there)
  let esker = null; const rock = [], eskerH = (x, y) => esker ? esker(x, y) : 0;
  // ---- ICE: the way it flowed, from the west-north-west give or take (Sweden's ice moved south-east)
  const ice = Math.PI / 6 + (R() - .5) * T.ice.spread, ux = Math.cos(ice), uy = Math.sin(ice);
  F.ice = +ice.toFixed(3);
  // ---- ESKER: a ridge along the ice's way, wandering, clear of the lake and the outflow's way to the river (shorter if it must); the
  // hills keep off it, the streams find their way round it or cut through it as streams do
  {
    const E = T.esker, reach = E.crest + E.w;
    for (let t = 0; t < 80 && !esker; t++) {
      const len = E.len[1] - (E.len[1] - E.len[0]) * Math.min(1, t / 40) * R(), a = ice + (R() - .5) * .5, dx = Math.cos(a), dy = Math.sin(a), ph = R() * 6;
      const sx = RECT.x0 + 6 + R() * (RECT.x1 - RECT.x0 - 12) - dx * len * .5, sy = HOME.y0 + 6 + R() * (ySouth - 2 - HOME.y0 - 6) - dy * len * .5;   // (a middle anywhere)
      const ctl = []; for (let i = 0; i <= 5; i++) { const f = i / 5, w = Math.sin(i * 1.3 + ph) * 3 + (R() - .5) * 3; ctl.push([sx + dx * len * f - dy * w, sy + dy * len * f + dx * w]); }
      if (ctl.some(([x, y]) => x < RECT.x0 + 6 || x > RECT.x1 - 6 || y < HOME.y0 + 6 || y > ySouth - 2)) continue;
      const C = course(ctl, 0, 0); let ok = true;
      for (let i = 0; i < C.n && ok; i += 15) {
        const x = C.px[i], y = C.py[i];
        if (-F.lakeEdge(x, y) < reach + 3 || segD(x, y, L.x, L.y, MOUTH.x, MOUTH.y) < reach + 3) ok = false;
      }
      if (!ok) continue;
      esker = ridge(C, E.h[0] + R() * (E.h[1] - E.h[0]), E.crest, E.w, E.taper, S);
      F.esker = {pts: ctl.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), h: +esker.h.toFixed(2)};
    }
  }
  // ---- THE HIGH COUNTRY, north of the home woods (its own generator: the home woods come out the same whatever it does): a FELL on
  // one side, a rounded massif you can walk up most ways, broken by CRAGS (rock shelves where its lee flank drops) and a TOR or two on
  // its top; on the other an UPLAND with a CANYON cut into it from its foot. Both are ground (highH, part of the field), the crags and
  // tors F.outcrops, the canyon a cut with rock walls (F.canyon.wall: world.js)
  const Rm = rng(mix(seed, 4)), west = Rm() < .5, MT = T.mountain, UP = T.upland, CY = T.canyon;
  F.outcrops = [];
  const rockAt = (o, ctl, banks) => {   // a terrace with rock for the field (layout.js) and for F.height
    const pts = ctl.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), b = banks.map(v => +v.toFixed(2));
    o.ctl = pts.map((p, i) => [p[0], p[1], b[i]]); o.h = +o.h.toFixed(3);
    rock.push({h: o.h, pts, banks: b, box: boxOf(pts, Math.max(...b))}); F.outcrops.push(o);
  };
  // the fell: its height over the ground round it, from its middle out to r(angle): widest on the stoss side
  // (where the ice came from), shortest on the lee (toward the home woods: its crags face you), its outline wavering
  const fH = MT.h[0] + Rm() * (MT.h[1] - MT.h[0]), fr = MT.r[0] + Rm() * (MT.r[1] - MT.r[0]), leeA = (ice + Math.PI / 2) / 2 + (Rm() - .5) * .4;
  const uh = UP.h[0] + Rm() * (UP.h[1] - UP.h[0]), uFoot = HOME.y0 - 4;
  const fx = west ? RECT.x0 + fr * .9 + 2 + Rm() * 4 : RECT.x1 - fr * .9 - 2 - Rm() * 4, fy = uFoot - UP.slope * .7 - fr * MT.lee;   // (its lee foot on the upland's slope, near its top)
  const fellR = a => { const c = Math.cos(a - leeA); return fr * (1 + (c > 0 ? MT.lee - 1 : MT.stoss - 1) * c * c) * (1 + MT.wob * (vnoise(Math.cos(a) * 1.4 + 3, Math.sin(a) * 1.4 + 3, S + 31) - .5) * 2); };
  const fellH = (x, y) => {
    const dx = x - fx, dy = y - fy, q = Math.hypot(dx, dy); if (q > fr * MT.stoss * (1 + MT.wob)) return 0;
    const d = q / fellR(Math.atan2(dy, dx)); if (d >= 1) return 0;
    const k = .2, prof = d < k ? 1 - d * d / (2 * k * (1 - k)) : d < 1 - k ? 1 - (d - k / 2) / (1 - k) : (1 - d) * (1 - d) / (2 * k * (1 - k));   // (straight flanks, a rounded top and foot)
    return fH * prof * (1 + MT.lump * (vnoise(x / 11, y / 11, S + 33) - .5)) - reliefH(x, y) * MT.calm * Math.min(1, prof * 2);   // (the rolling ground calmed on it: its slopes would add to the fell's)
  };
  // the upland: the whole high country stands UP.h over the ground round it, from the north edge to its south foot (a walkable slope
  // UP.slope m wide, the foot wavering); the fell rises from it
  const uplandH = (x, y) => { const k = (uFoot - (vnoise(x / 13, 7.7, S + 35) - .5) * 8 - y) / UP.slope; return k <= 0 ? 0 : uh * smooth(Math.min(1, k)); };
  // the CANYON's line: from just out past the upland's foot north into it, wandering, to a rounded head short of the north edge; its
  // floor the ground at its mouth, rising a little inward. Its RIDGE: the land it cleaves rises along it (a flat rim, then falling
  // away walkably), from nothing at the mouth to CY.ridge m a little way in, so its walls stand ~14 m over its floor
  const cy = (() => {
    const xc = west ? RECT.x1 - CY.side : RECT.x0 + CY.side, y0 = uFoot + 3, y1 = RECT.y0 + CY.head, ph = Rm() * 6, ctl = [];
    for (let i = 0; i <= 6; i++) { const f = i / 6; ctl.push([xc + Math.sin(f * 3.4 + ph) * CY.wander * (.4 + .6 * f) + (Rm() - .5) * 2, y0 + (y1 - y0) * f]); }
    const C = course(ctl, 0, 0), pts = [], hw = [], bed = [], at = [], b0 = reliefH(...ctl[0]) + .25, rise = CY.rise[0] + Rm() * (CY.rise[1] - CY.rise[0]), rr = CY.ridge[0] + Rm() * (CY.ridge[1] - CY.ridge[0]);
    for (let i = 0; i < C.n; i += 25) { const t = C.len[i] / C.total; pts.push([+C.px[i].toFixed(2), +C.py[i].toFixed(2)]); at.push(C.len[i]); hw.push(+(CY.hw[0] + (CY.hw[1] - CY.hw[0]) * vnoise(t * 5, 3.3, S + 21)).toFixed(2)); bed.push(+(b0 + rise * smooth(t)).toFixed(3)); }
    return {pts, hw, bed, at, rise, rr, box: boxOf(pts, Math.max(...hw) + CY.rim + CY.fall)};
  })();
  const _cn = [0, 0, 0];   // (the nearest point of the canyon's line: m to it, its segment, the fraction along that)
  const cyNear = (x, y) => { const P = cy.pts; let bd = 1e9, bi = 0, bt = 0; for (let i = 0; i + 1 < P.length; i++) { const [ax, ay] = P[i], [bx, by] = P[i + 1], vx = bx - ax, vy = by - ay, t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1), d = Math.hypot(x - ax - vx * t, y - ay - vy * t); if (d < bd) { bd = d; bi = i; bt = t; } } _cn[0] = bd; _cn[1] = bi; _cn[2] = bt; return _cn; };
  const ridgeH = (x, y) => {
    const B = cy.box; if (x < B[0] || y < B[1] || x > B[2] || y > B[3]) return 0;
    const [d, i, t] = cyNear(x, y), w = cy.hw[i] + (cy.hw[i + 1] - cy.hw[i]) * t, s = cy.at[i] + (cy.at[i + 1] - cy.at[i]) * t, k = d - w - CY.rim;
    return k >= CY.fall ? 0 : cy.rr * smooth((s - CY.in[0]) / CY.in[1]) * (k <= 0 ? 1 : 1 - smooth(k / CY.fall));
  };
  const highH = (x, y) => y > HOME.y0 + 2 ? 0 : uplandH(x, y) + fellH(x, y) + ridgeH(x, y);
  const ground = (x, y) => reliefH(x, y) + highH(x, y);
  // CRAGS: shelves in the fell's flanks, mostly on its lee side: a flat top level with the slope a little above its middle, so its
  // uphill side lies under the slope and its downhill side drops as a rock face; rock wherever the shelf stands above the slope
  {
    const want = MT.crags[0] + Math.floor(Rm() * (MT.crags[1] - MT.crags[0] + 1)), got = [];
    for (let t = 0; t < 80 && got.length < want; t++) {
      const a = t % 4 === 3 ? Rm() * Math.PI * 2 : leeA + (Rm() - .5) * 2.6, f = .3 + Rm() * .45, rr = fellR(a) * f;
      const x = fx + Math.cos(a) * rr, y = fy + Math.sin(a) * rr, e = .7, gx = ground(x + e, y) - ground(x - e, y), gy = ground(x, y + e) - ground(x, y - e), gl = Math.hypot(gx, gy) || 1;
      if (gl / (2 * e) < .3) continue;
      const L = MT.cragL[0] + Rm() * (MT.cragL[1] - MT.cragL[0]), D = MT.cragD[0] + Rm() * (MT.cragD[1] - MT.cragD[0]);
      if (got.some(c => Math.hypot(c.x - x, c.y - y) < (c.L + L) / 2 + 2.5) || y > HOME.y0 - 2) continue;
      const ux2 = -gx / gl, uy2 = -gy / gl, tx = -uy2, ty = ux2, h = ground(x - ux2 * D * .3, y - uy2 * D * .3), ctl = [];   // (u: downhill; its top: the slope there, a little uphill of its middle)
      for (let j = 0; j < 10; j++) { const b = j / 10 * Math.PI * 2, k = 1 + (Rm() - .5) * .3; ctl.push([x + tx * Math.cos(b) * L / 2 * k + ux2 * Math.sin(b) * D / 2 * k, y + ty * Math.cos(b) * L / 2 * k + uy2 * Math.sin(b) * D / 2 * k]); }
      const drop = ctl.map(([px, py]) => h - ground(px, py));
      if (Math.max(...drop) < 1.2) continue;
      got.push({x, y, L});
      rockAt({kind: 'crag', x: +x.toFixed(2), y: +y.toFixed(2), r: L / 2, h}, ctl, drop.map(v => v > .35 ? .12 : 2));   // (where it hardly stands out of the slope: a bank (its rock sinks into it), no kerb of stone)
    }
    // the TORS: a pile or two of big boulders on its top (props, placed with the growth: F.tors)
    const tors = MT.tors[0] + Math.floor(Rm() * (MT.tors[1] - MT.tors[0] + 1));
    F.tors = [];
    for (let i = 0, t = 0; i < tors && t < 30; t++) {
      const a = Rm() * Math.PI * 2, q = 1.5 + Rm() * fr * .16, x = fx + Math.cos(a) * q, y = fy + Math.sin(a) * q, n = MT.torN[0] + Math.floor(Rm() * (MT.torN[1] - MT.torN[0] + 1));
      if (got.some(c => Math.hypot(c.x - x, c.y - y) < c.L / 2 + 3.5)) continue;
      const rocks = []; for (let k = 0; k < n; k++) { const b = Rm() * Math.PI * 2, d = k ? .9 + Rm() * 1.1 : 0; rocks.push([+(x + Math.cos(b) * d).toFixed(2), +(y + Math.sin(b) * d).toFixed(2), Rm() * 3 | 0]); }
      got.push({x, y, L: 5}); F.tors.push({x: +x.toFixed(2), y: +y.toFixed(2), rocks}); i++;
    }
  }
  // the CANYON's cut: walls straight down (no bank: rock up them, world.js)
  {
    const {pts, hw, bed} = cy, cut = {type: 'channel', pts, bed, hw, bank: .06, drawn: {hw: hw.map(v => +(v + CANYON_IN).toFixed(2))}};
    // its wall as one line (cliffs3d.js's way: the floor on its right): up its west side, round the head, down its east side
    const side = sg => pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [p[0] + (b[1] - a[1]) / l * sg * hw[i], p[1] - (b[0] - a[0]) / l * sg * hw[i]]; });
    // (from where it is a wall: at the mouth the ground outside is no higher than the floor, and a run of rock there stands loose)
    const from = sg => { const L = side(sg); let i = 0; while (i < L.length - 2) { const [x, y] = L[i], q = L[i + 1], l = Math.hypot(q[0] - x, q[1] - y) || 1, ox = sg * (q[1] - y) / l, oy = -sg * (q[0] - x) / l; if (ground(x + ox, y + oy) - bed[i] > .3) break; i++; } return L.slice(Math.max(0, i - 1)); };
    const Wl = from(1), El = from(-1), c = pts.at(-1), r = hw.at(-1), ang = q => Math.atan2(q[1] - c[1], q[0] - c[0]);
    let a0 = ang(Wl.at(-1)), a1 = ang(El.at(-1)); while (a1 <= a0) a1 += 2 * Math.PI;
    const ring = []; for (let k = 1; k < 12; k++) { const a = a0 + (a1 - a0) * k / 12; ring.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
    F.canyon = {pts, hw, bed, cut, wall: [...Wl, ...ring, ...El.reverse()].map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), depth: +(uh + cy.rr - cy.rise).toFixed(2)};
  }
  const canyonH = (x, y, h) => {   // the canyon's cut as terrain.js makes it (bank .06: a straight drop), for F.height
    const [bd, bi, bt] = cyNear(x, y), c = F.canyon, w = c.hw[bi] + (c.hw[bi + 1] - c.hw[bi]) * bt, b = c.bed[bi] + (c.bed[bi + 1] - c.bed[bi]) * bt;
    return bd < w + .06 && h > b ? b + (h - b) * smooth(Math.max(0, bd - w) / .06) : h;
  };
  const canyonBox = boxOf(F.canyon.pts, Math.max(...F.canyon.hw) + .1);
  F.mountain = {x: +fx.toFixed(2), y: +fy.toFixed(2), h: 0, r: +fr.toFixed(2), rise: +fH.toFixed(2)};
  const bare = (x, y) => fellH(x, y) > fH * MT.treeline;   // (no trees on the fell's top)
  // how far up the fell / the upland a point is (0 .. 1): the painter's bands (biomes.js: heath and lichen up the fell, drier grass on
  // the upland) and the trees' (stunted birch below the fell's bare top)
  F.fellK = (x, y) => y > HOME.y0 + 2 ? 0 : clamp(fellH(x, y) / fH, 0, 1);
  F.uplandK = (x, y) => y > HOME.y0 + 2 ? 0 : (uplandH(x, y) + ridgeH(x, y)) / uh;
  const crestD = (x, y) => esker ? esker.dist(x, y) - T.esker.crest : 1e9;
  for (let i = 0, tries = 0, want = T.relief.hills[0] + Math.floor(R() * (T.relief.hills[1] - T.relief.hills[0] + 1)); i < want && tries < 60; tries++) {
    const h = T.relief.hillH[0] + R() * (T.relief.hillH[1] - T.relief.hillH[0]), r = Math.max(T.relief.hillR[0] + R() * (T.relief.hillR[1] - T.relief.hillR[0]), h * T.relief.hillK / .88);
    const x = RECT.x0 + r + R() * (RECT.x1 - RECT.x0 - 2 * r), y = HOME.y0 + r * .8 + R() * (RECT.y1 - HOME.y0 - r * .8 - FADE[1] - r);
    if (Math.hypot((x - L.x) / (L.rx + r + 5), (y - L.y) / (L.ry + r + 5)) < 1 || hills.some(q => Math.hypot(q.x - x, q.y - y) < q.rx + r)) continue;
    if (segD(x, y, L.x, L.y, MOUTH.x, MOUTH.y) < r + 3) continue;   // (not across the outflow's way to the river)
    if (crestD(x, y) < r * .55 + 2) continue;   // (not on the esker)
    hills.push({type: 'hill', x: +x.toFixed(2), y: +y.toFixed(2), rx: +r.toFixed(2), ry: +(r * (.88 + R() * .17)).toFixed(2), h: +h.toFixed(2), rot: +(R() * Math.PI).toFixed(3)}); i++;
  }
  const hillH = (x, y) => { let h = 0; for (const s of hills) { const c = Math.cos(s.rot), n = Math.sin(s.rot), dx = x - s.x, dy = y - s.y, u = (dx * c + dy * n) / s.rx, v = (-dx * n + dy * c) / s.ry, d = u * u + v * v; if (d < 1) h += s.h * .5 * (1 + Math.cos(Math.PI * Math.sqrt(d))); } return h; };
  // the ground as this plan sees it (relief + hills, the lake's hollow): placement's slope and height tests. The drawn and walked
  // ground is layout.js's field of these shapes (with its own low swell): within a few cm of this
  // (the rock comes later, away from the water: placed after the watercourses, which walk the ground without it)
  F.height = (x, y) => {
    let h = reliefH(x, y) + highH(x, y) + hillH(x, y) + eskerH(x, y); const d = lakeD(x, y);
    if (d < 1) h = Math.min(h, L.bed); else { const k = (d - 1) * Math.min(L.rx, L.ry) / L.rim; if (k < 1) h = L.bed + (h - L.bed) * smooth(k); }
    for (let i = 0; i < rock.length; i++) { const v = terraceH(rock[i], x, y); if (v > h) h = v; }
    if (x > canyonBox[0] && y > canyonBox[1] && x < canyonBox[2] && y < canyonBox[3]) h = canyonH(x, y, h);
    return h;
  };
  const slope = (x, y) => { const e = .5; return Math.hypot(F.height(x + e, y) - F.height(x - e, y), F.height(x, y + e) - F.height(x, y - e)) / (2 * e); };
  F.shapes.push({type: 'field', reach: [RECT.x0 - 30, RECT.y0 - 30, RECT.x1 + 30, RECT.y1], fn: (x, y) => reliefH(x, y) + highH(x, y) + eskerH(x, y)}, ...hills, F.canyon.cut,
    {type: 'basin', x: L.x, y: L.y, rx: L.rx + .3, ry: L.ry + .3, h: L.bed + WATER_H, rim: L.rim});   // (its floor at the water's surface: the strand and the shelf are walked at it)

  // a watercourse from (x, y) toward (tx, ty): each step mostly toward it, downhill where the ground falls, wandering (the seed's
  // phase and a noise field), until done(x, y) -> [[x, y], ...] (a point every 3 steps)
  const walk = (x, y, tx0, ty0, done, ph) => {
    const pts = [[x, y]]; let dx = tx0 - x, dy = ty0 - y; const l0 = Math.hypot(dx, dy) || 1; dx /= l0; dy /= l0;
    for (let i = 0; i < 500 && !done(x, y); i++) {
      const tx = tx0 - x, ty = ty0 - y, tl = Math.hypot(tx, ty) || 1, e = .7;
      const gx = -(F.height(x + e, y) - F.height(x - e, y)), gy = -(F.height(x, y + e) - F.height(x, y - e)), gl = Math.hypot(gx, gy) || 1;
      const w = Math.sin(i * .11 + ph) * .55 + (vnoise(x * .15, y * .15, S + 9) - .5) * .9, near = Math.min(1, tl / 8);   // (the wander; straighter at the end)
      const nx = tx / tl * (.55 + (1 - near)) + gx / gl * .3 * near + dx * .6 - ty / tl * w * .35 * near, ny = ty / tl * (.55 + (1 - near)) + gy / gl * .3 * near + dy * .6 + tx / tl * w * .35 * near;
      const nl = Math.hypot(nx, ny) || 1; dx = nx / nl; dy = ny / nl;
      x += dx * T.stream.step; y += dy * T.stream.step;
      if (i % 3 === 2) pts.push([x, y]);
    }
    return pts;
  };
  // ---- STREAM: a spring on high ground in the north, down to the lake
  {
    let sp = null;
    for (let i = 0; i < 30; i++) {
      const x = RECT.x0 + 8 + R() * (RECT.x1 - RECT.x0 - 16), y = HOME.y0 + 5 + R() * 10, d = Math.hypot(x - L.x, y - L.y);
      if (d < 22 || d > 60) continue;
      const sc = F.height(x, y) + d * .01; if (!sp || sc > sp.sc) sp = {x, y, sc};
    }
    sp ??= {x: L.x + 20, y: HOME.y0 + 8};
    const pts = walk(sp.x, sp.y, L.x, L.y, (x, y) => lakeD(x, y) < .82, R() * 10), e1 = pts.at(-1), e0 = pts.at(-2) || pts[0];
    pts.push([e1[0] + (e1[0] - e0[0]) * .5, e1[1] + (e1[1] - e0[1]) * .5]);   // (on into the lake a little: no gap at its mouth)
    F.stream = course(pts, T.stream.hw0, T.stream.hw1);
    F.spring = {x: sp.x, y: sp.y, r: .42};
  }
  // ---- OUTFLOW: out of the lake's side nearest the river and down to the river's head (MOUTH), widening into it
  {
    const a = Math.atan2((MOUTH.y - L.y) / L.ry, (MOUTH.x - L.x) / L.rx), x = L.x + Math.cos(a) * L.rx * .85, y = L.y + Math.sin(a) * L.ry * .85;
    const pts = walk(x, y, MOUTH.x, MOUTH.y, (px, py) => Math.hypot(px - MOUTH.x, py - MOUTH.y) < 1.2, R() * 10);
    pts.push([MOUTH.x, MOUTH.y], [MOUTH.x, MOUTH.y + 1.5]);
    F.outflow = course(pts, T.stream.hw1, MOUTH.hw);
  }
  // the courses swell into slow pools and pinch into runs: their width wanders along them (held at both ends: the spring, the lake's
  // mouths, the river's head)
  for (const [C, sd] of [[F.stream, 78], [F.outflow, 79]]) for (let i = 0; i < C.n; i++) {
    const end = smooth(Math.min(C.len[i], C.total - C.len[i]) / 3);
    C.hw[i] *= 1 + (vnoise(C.len[i] * .16, 5.3, sd) - .5) * 2 * T.stream.wander * end;
  }
  // WET: a 1 m mask over the box, 1 within 1.6 m of any water (the painter's water pass skips the rest)
  { const A = F.stream.box, B = F.outflow.box, x0 = Math.floor(Math.min(A[0], B[0], L.x - L.rx - 2)), y0 = Math.floor(Math.min(A[1], B[1], L.y - L.ry - 2));
    const w = Math.ceil(Math.max(A[2], B[2], L.x + L.rx + 2)) - x0 + 1, h = Math.ceil(Math.max(A[3], B[3], L.y + L.ry + 2)) - y0 + 1, d = new Uint8Array(w * h);
    const mark = (x, y, r) => { for (let j = Math.floor(y - r) - y0; j <= Math.floor(y + r) - y0; j++) for (let i = Math.floor(x - r) - x0; i <= Math.floor(x + r) - x0; i++) if (i >= 0 && j >= 0 && i < w && j < h) d[j * w + i] = 1; };
    for (const C of [F.stream, F.outflow]) for (let k = 0; k < C.n; k += 3) mark(C.px[k], C.py[k], C.hw[k] + 2.2);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (Math.hypot((x0 + i + .5 - L.x) / (L.rx + 3), (y0 + j + .5 - L.y) / (L.ry + 3)) < 1) d[j * w + i] = 1;
    F.wet = {x0, y0, w, h, d}; }
  { const A = F.stream.box, B = F.outflow.box; F.box = [Math.min(A[0], B[0], L.x - L.rx - 1.5), Math.min(A[1], B[1], L.y - L.ry - 1.5), Math.max(A[2], B[2], L.x + L.rx + 1.5), Math.max(A[3], B[3], L.y + L.ry + 1.5)]; }
  // the nearer of the two watercourses (out as course().at's; true in its water)
  F.at = (x, y, out) => {
    const a = F.stream.at(x, y, out); if (a) { out.k = 0; return true; }
    const d = out.d - out.hw, b = F.outflow.at(x, y, _q);
    if (_q.d - _q.hw < d) { out.d = _q.d; out.a = _q.a; out.l = _q.l; out.hw = _q.hw; out.i = _q.i; out.k = 1; return b; }
    out.k = 0; return false;
  };
  const courseD = (x, y) => { F.at(x, y, _o); return _o.d - _o.hw; };   // m to the stream's or the outflow's water (1e9 far from both)
  const lakeM = (x, y) => -F.lakeEdge(x, y);                              // m to the lake's water (< 0 in it)

  // ---- CLEARING: the flattest spot round the lake's shore, clear of the streams (the settlement's)
  {
    const C = T.clearing; let best = null;
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, x = L.x + Math.cos(a) * (L.rx + C.off + C.r * .7), y = L.y + Math.sin(a) * (L.ry + C.off + C.r * .7);
      if (x < RECT.x0 + C.r + 3 || x > RECT.x1 - C.r - 3 || y < HOME.y0 + C.r + 3 || y > RECT.y1 - C.r - 2) continue;
      let lo = 1e9, hi = -1e9; for (let j = 0; j < 9; j++) { const b = j * Math.PI / 4, q = j ? C.r * .8 : 0, h = F.height(x + Math.cos(b) * q, y + Math.sin(b) * q); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const score = hi - lo + (courseD(x, y) < C.r + 1.5 ? 10 : 0) + (crestD(x, y) < C.r + 3 ? 10 : 0) + R() * .05;
      if (!best || score < best.score) best = {x, y, score};
    }
    F.clearing = {x: +best.x.toFixed(2), y: +best.y.toFixed(2), r: C.r};
  }
  // ---- SHORE: the lake's edge wanders inside the basin's ellipse (seeded lobes: bays and points; their own generator, so nothing
  // after this changes its draws), held at the ellipse where the stream comes in, where the outflow leaves (no gap at either mouth)
  // and mostly toward the clearing (the settlement's shore). F.inLake / F.lakeEdge from here on are the wandering shore's; what
  // was placed before (the esker, the hills) kept off the ellipse, which holds the whole lake
  {
    const RS = rng(mix(seed, 41)), LS = T.lake.shore, harm = [2, 3, 4, 5, 7].map(k => ({k, a: (.35 + RS()) / k ** .7, p: RS() * Math.PI * 2})), hs = harm.reduce((t, h) => t + h.a, 0);
    const ang = (x, y) => Math.atan2((y - L.y) / L.ry, (x - L.x) / L.rx), sE = F.stream, o0 = F.outflow;
    const mouths = [[ang(sE.px[sE.n - 1], sE.py[sE.n - 1]), .34, 1], [ang(o0.px[0], o0.py[0]), .34, 1], [ang(F.clearing.x, F.clearing.y), .5, .75]];
    const SR = new Float32Array(257);   // the shore's radius (a share of the ellipse's) round the lake, 256 steps: a lookup, not five cosines a call
    for (let i = 0; i <= 256; i++) {
      const th = i / 256 * Math.PI * 2 - Math.PI; let s = 0; for (const h of harm) s += h.a * Math.cos(h.k * th + h.p);
      let k = Math.max(0, Math.min(1, (s / hs + .1) / .8)) ** 1.5; for (const [m, w, q] of mouths) { const d = Math.atan2(Math.sin(th - m), Math.cos(th - m)) / w; k *= 1 - q * Math.exp(-d * d); }
      SR[i] = 1 - LS * k;
    }
    const fOf = (x, y) => { const u = (x - L.x) / L.rx, v = (y - L.y) / L.ry, f = (Math.atan2(v, u) + Math.PI) / (Math.PI * 2) * 256, i = Math.min(255, f | 0); return Math.hypot(u, v) / (SR[i] + (SR[i + 1] - SR[i]) * (f - i)); };
    F.shoreAt = fOf;   // (1 at the shore, < 1 in the water)
    F.inLake = (x, y, grow = 0) => {
      const rx = L.rx + grow, ry = L.ry + grow; if (x < L.x - rx || x > L.x + rx || y < L.y - ry || y > L.y + ry) return false;
      return grow ? F.lakeEdge(x, y) > -grow : fOf(x, y) < 1;
    };
    F.lakeEdge = (x, y) => {   // m to the shore (+ in the water): its value over its slope (exact at the shore, near enough a few m off it)
      const f = fOf(x, y), e = .05, gx = fOf(x + e, y) - fOf(x - e, y), gy = fOf(x, y + e) - fOf(x, y - e), g = Math.hypot(gx, gy) / (2 * e);
      return g > 1e-6 ? Math.min(Math.max(L.rx, L.ry), (1 - f) / g) : L.ry;
    };
    F.strand = (x, y) => lakeD(x, y) < 1 + .3 / Math.min(L.rx, L.ry) && fOf(x, y) >= 1;   // the basin's dry floor between the shore and the ellipse
    F.inDeep = (x, y) => F.inLake(x, y) && F.lakeEdge(x, y) > T.lake.wade;   // past the shelf you wade on: deep water (layout.js inStream)
  }
  const CL = F.clearing, clearD = (x, y) => Math.hypot(x - CL.x, y - CL.y) - CL.r;
  // ---- OUTCROPS (roches moutonnees) and BLOCKS (big boulders): small terraces with rock; the ice made the gentle side and the cliff
  const room = (x, y, r) => lakeM(x, y) > r + 3.5 && courseD(x, y) > r + 3 && clearD(x, y) > r + 2 && crestD(x, y) > r + T.esker.w * .6 &&
    !F.outcrops.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 2.5) && x > RECT.x0 + r + 6 && x < RECT.x1 - r - 6 && y > HOME.y0 + r + 6 && y < ySouth - r - 1;
  const keep = (o, ctl, banks) => {
    const pts = ctl.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]);
    o.ctl = pts.map((p, i) => [p[0], p[1], banks[i]]); o.h = +o.h.toFixed(3);
    rock.push({h: o.h, pts, banks, box: boxOf(pts, Math.max(...banks))}); F.outcrops.push(o);
  };
  {
    const O = T.outcrop, want = O.n[0] + Math.floor(R() * (O.n[1] - O.n[0] + 1));
    for (let t = 0, n = 0; t < 90 && n < want; t++) {
      const a = (O.len[0] + R() * (O.len[1] - O.len[0])) / 2, b = (O.wid[0] + R() * (O.wid[1] - O.wid[0])) / 2, rise = O.rise[0] + R() * (O.rise[1] - O.rise[0]);
      const x = RECT.x0 + R() * (RECT.x1 - RECT.x0), y = HOME.y0 + R() * (RECT.y1 - HOME.y0), jit = []; for (let j = 0; j < 9; j++) jit.push(R());
      if (!room(x, y, a) || slope(x, y) > .35) continue;
      const h = F.height(x, y) + rise, ctl = [], banks = [], bank = Math.max(2.6, 1.55 * h / .62);   // (the gentle side: walkable up to its top)
      for (let j = 0; j < 9; j++) {
        const f = j / 9 * Math.PI * 2, k = 1 + (jit[j] - .5) * .3, lx = Math.cos(f) * a * k, ly = Math.sin(f) * b * k;
        ctl.push([x + lx * ux - ly * uy, y + lx * uy + ly * ux]); banks.push(Math.cos(f) > -.15 ? .12 : +bank.toFixed(2));   // (the lee side, where the ice plucked it: a cliff)
      }
      if (ctl.some(([px, py], j) => banks[j] < 1 && h - F.height(px, py) < .7)) continue;   // (its cliff must show all along)
      keep({kind: 'outcrop', x: +x.toFixed(2), y: +y.toFixed(2), r: a, h}, ctl, banks); n++;
    }
    const B = T.block, wantB = B.n[0] + Math.floor(R() * (B.n[1] - B.n[0] + 1));
    for (let t = 0, n = 0; t < 90 && n < wantB; t++) {
      const r = B.r[0] + R() * (B.r[1] - B.r[0]), rise = B.rise[0] + R() * (B.rise[1] - B.rise[0]), a0 = R() * Math.PI;
      const x = RECT.x0 + R() * (RECT.x1 - RECT.x0), y = HOME.y0 + R() * (RECT.y1 - HOME.y0), jit = []; for (let j = 0; j < 7; j++) jit.push(R());
      if (!room(x, y, r) || slope(x, y) > .3) continue;
      const ctl = []; let g = F.height(x, y);
      for (let j = 0; j < 7; j++) { const f = a0 + j / 7 * Math.PI * 2, k = 1 + (jit[j] - .5) * .5, px = x + Math.cos(f) * r * k, py = y + Math.sin(f) * r * .8 * k; ctl.push([px, py]); g = Math.max(g, F.height(px, py)); }
      keep({kind: 'block', x: +x.toFixed(2), y: +y.toFixed(2), r, h: g + rise}, ctl, ctl.map(() => .12)); n++;
    }
  }
  const inRock = (x, y, m) => F.outcrops.some(o => o.kind === 'block' && Math.hypot(o.x - x, o.y - y) < o.r * 1.25 + m);
  // ---- BOULDERS: a field of them in the deepest hollow the seed's candidates find
  {
    const B = T.boulders; let best = null;
    for (let t = 0; t < 30; t++) {
      const r = B.r[0] + R() * (B.r[1] - B.r[0]), x = RECT.x0 + R() * (RECT.x1 - RECT.x0), y = HOME.y0 + R() * (RECT.y1 - HOME.y0);
      if (!room(x, y, r)) continue;
      let ring = 0; for (let j = 0; j < 8; j++) ring += F.height(x + Math.cos(j * Math.PI / 4) * (r + 3), y + Math.sin(j * Math.PI / 4) * (r + 3));
      const score = F.height(x, y) - ring / 8 + slope(x, y) * 2;
      if (!best || score < best.score) best = {x, y, r, score};
    }
    F.boulders = best ? {x: +best.x.toFixed(2), y: +best.y.toFixed(2), r: +best.r.toFixed(2)} : null;
  }
  const BF = F.boulders;

  // ---- GROWTH, chunk by chunk
  const C0x = Math.floor(RECT.x0 / CHUNK), C1x = Math.ceil(RECT.x1 / CHUNK), C0y = Math.floor(RECT.y0 / CHUNK), C1y = Math.ceil(RECT.y1 / CHUNK);
  F.chunks = [];
  const canyonD = (x, y) => { const B = cy.box; if (x < B[0] || y < B[1] || x > B[2] || y > B[3]) return 1e9; const [d, i, t] = cyNear(x, y); return d - cy.hw[i] - (cy.hw[i + 1] - cy.hw[i]) * t; };   // (m out from its walls)
  const mouth = cy.pts[0], canyonClear = (x, y) => canyonD(x, y) < 1.8 || Math.hypot(x - mouth[0], y - mouth[1]) < 9;   // (no tree in the slot or crowding its mouth: it hid the floor and the way in)
  const keepOut = {clearD, crestD, inRock, eskerH, boulders: BF, bare, fellK: F.fellK, canyonClear};
  { let top = 0; for (let y = fy - fr * MT.stoss; y < fy + fr; y += 1) for (let x = fx - fr * 1.2; x < fx + fr * 1.2; x += 1) top = Math.max(top, F.height(x, y)); F.mountain.h = +top.toFixed(2); }
  for (let cy = C0y; cy < C1y; cy++) for (let cx = C0x; cx < C1x; cx++) { F.chunks.push([cx, cy]); grow(F, cx, cy, S, slope, keepOut); }
  // the fell's tors (each rock in the chunk it lies in)
  for (const t of F.tors) for (const [x, y, v] of t.rocks) {
    const ci = F.chunks.findIndex(([a2, b2]) => a2 === Math.floor(x / CHUNK) && b2 === Math.floor(y / CHUNK)); if (ci < 0) continue;
    F.props.push(['rock_big', x, y, {r: .75, variant: v, chunk: ci}]);
  }
  // the boulder field's rocks (a global feature: their own generator; each in the chunk it lies in)
  if (BF) {
    const Rb = rng(mix(seed, 3)), n = T.boulders.n[0] + Math.floor(Rb() * (T.boulders.n[1] - T.boulders.n[0] + 1)), at = [];
    for (let t = 0; t < n * 4 && at.length < n; t++) {
      const a = Rb() * Math.PI * 2, q = Math.sqrt(Rb()) * BF.r, x = BF.x + Math.cos(a) * q, y = BF.y + Math.sin(a) * q, big = Rb() < .4, v = Rb() * 3 | 0;
      if (at.some(([px, py, pb]) => Math.hypot(px - x, py - y) < (big || pb ? 1.5 : .8)) || slope(x, y) > .55) continue;
      const ci = F.chunks.findIndex(([a2, b2]) => a2 === Math.floor(x / CHUNK) && b2 === Math.floor(y / CHUNK)); if (ci < 0) continue;
      at.push([x, y, big]); F.props.push([big ? 'rock_big' : 'rock', +x.toFixed(2), +y.toFixed(2), {r: big ? .75 : 0, variant: v, chunk: ci}]);
    }
  }
  decorate(F, slope, keepOut);
  plans.set(seed, F);
  return F;
}

// THE SMALL THINGS on the forest floor (content/recipes.js, docs/ASSETS.md): F.decor = [[recipe, x, y, {v, yaw, s, params, chunk}]],
// v the recipe's variant (its seed, 0 .. variants - 1). View only (world/decor3d.js draws them instanced; no collider, no entity) and
// apart from F.props, so the server's trees and every item the world tracks stay as they were. Their own generator per chunk
// (mix(seed, 5000 + cx, 5000 + cy)) on a 2 m jittered lattice; what suits a spot comes from the trees round it:
//   shade     the crowns within 4 m (0 open .. 1 a dense stand), the pines' share of them, the nearest birch / pine
//   stump     snapped or rotten (style -1) near pines, more in dense old stands; sawn (style 2) only round the settlement's clearing
//   log       a fallen tree lying flat, often a rotten stump by its root end; grey and broken (old) in deep shade and by the water,
//             fresh near the clearing
//   fly agaric  groups of 1-3 under birch and pine in half shade;  chanterelles  a ring in mossy pine shade, often by a stump or log
//   blueberry the floor's filler under pines on the drier ground and the esker's slopes; never by the water or in the clearing
//   lingonberry on the drier, sunnier, poorer ground: open pine, the esker, the thin soil by rock (blueberries and lingon 1.6x: berryS)
//   windthrow a tipped spruce, its root plate on edge: in the storm's lane (F.storm), all fallen downwind and fresh; elsewhere the odd
//             old one near bare rock (thin soil). Solid
// The watcher is its own creature (features/watcher.js); the ant hill is left out
function decorate(F, slope, K) {
  const T = TUNE.decor, out = F.decor = [], C = 4, idx = new Map();   // (F.decorSolid: below)
  for (const p of F.props) if (p[0] === 'tree') { const k = Math.floor(p[1] / C) + ',' + Math.floor(p[2] / C); let a = idx.get(k); if (!a) idx.set(k, a = []); a.push(p); }
  const E = {shade: 0, pine: 0, dPine: 1e9, dBirch: 1e9, dTrunk: 1e9};
  const env = (x, y) => {
    E.shade = 0; E.pine = 0; E.dPine = E.dBirch = E.dTrunk = 1e9;
    const i0 = Math.floor(x / C), j0 = Math.floor(y / C);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) for (const t of idx.get(i + ',' + j) || []) {
      const d = Math.hypot(t[1] - x, t[2] - y), sp = t[3].species; if (d < E.dTrunk) E.dTrunk = d;
      if (sp === 'pine' && d < E.dPine) E.dPine = d; if (sp === 'birch' && d < E.dBirch) E.dBirch = d;
      if (d < 4) { const w = 1 - d / 4; E.shade += w * .42; if (sp === 'pine') E.pine += w; }
    }
    E.pine = E.shade > 0 ? Math.min(1, E.pine * .42 / E.shade) : 0; E.shade = Math.min(1, E.shade);
    return E;
  };
  const inField = (x, y) => K.boulders !== null && Math.hypot(x - K.boulders.x, y - K.boulders.y) < K.boulders.r + 1;
  const ok = (x, y, m) => x > RECT.x0 + 1.5 && x < RECT.x1 - 1.5 && y > RECT.y0 + 1.5 && y < RECT.y1 - TUNE.trees.south && waterD(F, x, y) > m &&
    !K.inRock(x, y, .3) && !inField(x, y) && K.crestD(x, y) > .5 && slope(x, y) < .45;
  const placed = [], room = (x, y, r) => placed.every(([px, py, pr]) => Math.hypot(px - x, py - y) > r + pr);
  const chunkOf = (x, y) => F.chunks.findIndex(([a, b]) => a === Math.floor(x / CHUNK) && b === Math.floor(y / CHUNK));
  const put = (name, x, y, r, R, params, ci) => {   // (params: an object, or v => one: each variant its own, so a recipe stays a few shapes)
    placed.push([x, y, r]); const v = Math.floor(R() * T.variants);
    out.push([name, +x.toFixed(2), +y.toFixed(2), {v, yaw: +(R() * Math.PI * 2).toFixed(3), s: +(.85 + R() * .3).toFixed(2), params: typeof params === 'function' ? params(v) : params, chunk: ci}]);
  };
  const stumpBy = (x, y, R, ci) => { if (ok(x, y, 1) && room(x, y, .5)) put('stump', x, y, .5, R, {style: -1}, ci); };
  const ringBy = (x, y, R, ci) => { const a = R() * Math.PI * 2, d = .9 + R() * .7, u = x + Math.cos(a) * d, w = y + Math.sin(a) * d; if (ok(u, w, 1.5) && room(u, w, .35)) put('chanterelles', u, w, .35, R, null, ci); };
  // the settlement's clearing: a few sawn stumps and a fresh log or two round its edge (their own generator)
  { const Rc = rng(mix(F.seed, 6)), CL = F.clearing, n = T.settle[0] + Math.floor(Rc() * (T.settle[1] - T.settle[0] + 1));
    for (let t = 0, k = 0; t < 40 && k < n; t++) {
      const a = Rc() * Math.PI * 2, x = CL.x + Math.cos(a) * (CL.r + .5 + Rc() * 4), y = CL.y + Math.sin(a) * (CL.r + .5 + Rc() * 4), ci = chunkOf(x, y);
      if (ci < 0 || !ok(x, y, 1.5) || env(x, y).dTrunk < .8 || !room(x, y, .6)) continue;
      if (k < 2 && Rc() < .5) { const yaw = Rc() * Math.PI, hx = Math.cos(yaw) * 1.3, hy = Math.sin(yaw) * 1.3;
        if (ok(x + hx, y + hy, 1.5) && ok(x - hx, y - hy, 1.5)) { put('log', x, y, 1.3, Rc, {old: 0}, ci); out[out.length - 1][3].yaw = +yaw.toFixed(3); k++; continue; } }
      put('stump', x, y, .6, Rc, {style: 2}, ci); k++;
    }
  }
  // WINDTHROWS first (they need the most room): a spruce the wind tipped over, its root plate on edge (the recipe's frame: the plate at
  // its origin facing -x, the pit before it, the trunk along +x, len m), on the thin soil over rock round the outcrops and the boulder
  // field. Big: solid (F.decorSolid, layout.js: a row of round colliders across the plate, 'rootplate', and along the trunk, 'windlog')
  const W = T.windthrow, solid = F.decorSolid = [], clear = F.decorClear = [], earth = F.decorEarth = [];   // (F.decorClear: [x, y, r] where the soft scatter goes, layout.js; F.decorEarth: [x, y, rx, rz, yaw] ellipses of bare earth, biomes.js)
  const WT = RECIPES.windthrow, WT_DEF = Object.fromEntries(Object.entries(WT.params).map(([k, a]) => [k, a[0]]));
  const rockD = (x, y) => { let d = K.boulders ? Math.hypot(x - K.boulders.x, y - K.boulders.y) - K.boulders.r : 1e9; for (const o of F.outcrops) d = Math.min(d, Math.hypot(o.x - x, o.y - y) - o.r); return d; };
  // THE STORM (one a world, its own generator): a gale from the prevailing west / south-west (+- 25 deg) came through and felled a lane
  // of trees, so the windthrows tell it: most of them in a band along its track, every one fallen downwind (the plate on the windward
  // side, the trunk away from it), with more snapped stumps and fresh logs lying the same way among them. Elsewhere only the odd old
  // one, fallen in some earlier gale from the same side. F.storm = {x, y, yaw, half, band}: its middle, the way it blew (forest.js
  // yaw: from +x toward +y; -y is north), half its length, half its width. Its middle: the best of a few draws (the most open ground)
  const ST = T.storm, Rs = rng(mix(F.seed, 7000)), sYaw = -.55 + (Rs() - .5) * .9, sc0 = Math.cos(sYaw), ss0 = Math.sin(sYaw), half = ST.half[0] + Rs() * (ST.half[1] - ST.half[0]);
  let best = null;
  for (let t = 0; t < ST.tries; t++) {
    const mx = RECT.x0 + 15 + Rs() * (RECT.x1 - RECT.x0 - 30), my = RECT.y0 + 15 + Rs() * (RECT.y1 - RECT.y0 - 30); let n = 0;
    for (let u = -half; u <= half; u += 4) for (let w = -ST.band; w <= ST.band; w += 3.5) { const x = mx + u * sc0 - w * ss0, y = my + u * ss0 + w * sc0; if (ok(x, y, 1.5) && K.clearD(x, y) > 3 && !K.bare(x, y)) n++; }
    if (!best || n > best.n) best = {n, x: mx, y: my};
  }
  const storm = F.storm = {x: +best.x.toFixed(2), y: +best.y.toFixed(2), yaw: +sYaw.toFixed(3), half: +half.toFixed(1), band: ST.band};
  const inStorm = (x, y) => { const dx = x - storm.x, dy = y - storm.y, u = dx * sc0 + dy * ss0, w = -dx * ss0 + dy * sc0, e = Math.abs(u) / half;   // (its ends taper)
    return e < 1 && Math.abs(w) < ST.band * (1 - e * e * .6) * (.75 + vnoise(x * .15, y * .15, F.seed + 71) * .5); };
  for (let ci = 0; ci < F.chunks.length; ci++) {
    const [cx, cy] = F.chunks[ci], R = rng(mix(F.seed, 6000 + cx, 6000 + cy)), n = Math.round(CHUNK / W.cell);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = cx * CHUNK + (i + .2 + R() * .6) * W.cell, y = cy * CHUNK + (j + .2 + R() * .6) * W.cell, roll = R(), turn = R(), v0 = Math.floor(R() * T.variants), sc = .9 + R() * .2;
      const lane = inStorm(x, y); if (!ok(x, y, 1.5) || K.clearD(x, y) < 3 || K.bare(x, y)) continue;
      if (lane ? roll > W.p : roll > W.lone || rockD(x, y) < W.near[0] || rockD(x, y) > W.near[1]) continue;
      // downwind: the lane's within +-14 deg of the gale, an old lone one +-34; in the lane a few turns and a shorter tree are tried
      // (a fallen tree lies where it found room between the standing ones)
      const fits = (yaw, v) => {
        const len = W.len[v] * sc, c = Math.cos(yaw), sn = Math.sin(yaw), at = (lx, lz) => [x + (lx * c - lz * sn) * sc, y + (lx * sn + lz * c) * sc];
        let fit = room(x + c * len / 2, y + sn * len / 2, len / 2 + .6);
        for (let lx = -1.4; fit && lx <= W.len[v]; lx += .7) { const [px, py] = at(lx, 0); fit = ok(px, py, 1) && env(px, py).dTrunk > .7 && Math.abs(F.height(px, py) - F.height(x, y)) < .6; }
        for (const lz of [-1, 1]) { const [px, py] = at(-.6, lz); fit = fit && ok(px, py, 1) && env(px, py).dTrunk > .6; }
        return fit;
      };
      let yaw = sYaw + (turn - .5) * (lane ? .5 : 1.2), v = v0, fit = fits(yaw, v);
      if (lane) for (const [dy, dv] of [[.22, 0], [-.22, 0], [0, -1], [.22, -1], [-.22, -1], [0, -2]]) { if (fit) break; const y2 = sYaw + Math.max(-.3, Math.min(.3, (turn - .5) * .5 + dy)), v2 = v0 + dv; if (v2 >= 0 && fits(y2, v2)) { yaw = y2; v = v2; fit = true; } }
      if (!fit) continue;
      const len = W.len[v] * sc, c = Math.cos(yaw), sn = Math.sin(yaw), at = (lx, lz) => [x + (lx * c - lz * sn) * sc, y + (lx * sn + lz * c) * sc];
      placed.push([x + c * len / 2, y + sn * len / 2, len / 2 + .6]);
      // the hole it tore out (the recipe's ground(p): ellipses in its frame): bare earth (F.decorEarth, the ground painter, biomes.js
      // forestRuins), nothing grows in it (F.decorClear, layout.js: no grass tufts or ferns; no decor here)
      const params = {len: W.len[v], old: lane ? 0 : 1};   // (the storm's are fresh, a lone one is from an older gale: grey)
      for (const e of WT.ground({...WT_DEF, ...params})) {
        const [ex, ey] = at(e.x, e.z), rx = e.rx * sc, rz = e.rz * sc;
        earth.push([+ex.toFixed(2), +ey.toFixed(2), +rx.toFixed(2), +rz.toFixed(2), +yaw.toFixed(3)]);
        placed.push([ex, ey, Math.max(rx, rz)]); clear.push([+ex.toFixed(2), +ey.toFixed(2), +Math.max(rx, rz).toFixed(2)]);
      }
      for (let lx = .5; lx < W.len[v]; lx += .8) { const [px, py] = at(lx, 0); clear.push([+px.toFixed(2), +py.toFixed(2), +(.45 * sc).toFixed(2)]); }   // (and nothing poking up through the trunk)
      out.push(['windthrow', +x.toFixed(2), +y.toFixed(2), {v, yaw: +yaw.toFixed(3), s: +sc.toFixed(2), params, chunk: ci}]);
      for (let lz = -.85; lz <= .86; lz += .425) { const [px, py] = at(-.05, lz); solid.push(['rootplate', +px.toFixed(2), +py.toFixed(2), +(.3 * sc).toFixed(2)]); }
      for (let lx = .45; lx < W.len[v] - .1; lx += .45) { const [px, py] = at(lx, 0); solid.push(['windlog', +px.toFixed(2), +py.toFixed(2), +(.27 * sc).toFixed(2)]); }
    }
  }
  for (let ci = 0; ci < F.chunks.length; ci++) {
    const [cx, cy] = F.chunks[ci], R = rng(mix(F.seed, 5000 + cx, 5000 + cy)), n = Math.round(CHUNK / T.cell);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = cx * CHUNK + (i + .5 + (R() - .5) * 2 * T.jitter) * T.cell, y = cy * CHUNK + (j + .5 + (R() - .5) * 2 * T.jitter) * T.cell, roll = R(), pick = R();
      if (!ok(x, y, .8) || K.clearD(x, y) < 1.5 || K.bare(x, y)) continue;
      const e = env(x, y); if (e.dTrunk < .75) continue;   // (not in a trunk)
      const wd = waterD(F, x, y), old = e.shade > .4 || wd < 5, nearPine = e.dPine < 5, sh = e.shade;
      // the kinds in turn on one roll: a spot gets at most one
      let acc = 0;
      const lane = inStorm(x, y), sk = lane ? ST.stump : 1;   // (the storm's lane: more snapped stumps and fresh logs, fallen its way)
      if (roll < (acc += T.stump * sk * (nearPine ? .5 + sh : .25 * sh))) { if (room(x, y, .5)) { put('stump', x, y, .5, R, {style: -1}, ci); if (pick < .25) ringBy(x, y, R, ci); } continue; }
      if (roll < (acc += T.log * (lane ? ST.log : 1) * (.3 + sh))) {
        const y0 = R() * Math.PI, yaw = lane ? sYaw + (y0 / Math.PI - .5) * .5 : y0, L = 1.25, hx = Math.cos(yaw) * L, hy = Math.sin(yaw) * L;   // (lying flat: both ends on the same ground, clear of trunks)
        if (!ok(x + hx, y + hy, 1) || !ok(x - hx, y - hy, 1) || env(x + hx, y + hy).dTrunk < .6 || env(x - hx, y - hy).dTrunk < .6 || !room(x, y, 1.3) ||
          Math.abs(F.height(x + hx, y + hy) - F.height(x - hx, y - hy)) > .35) continue;
        put('log', x, y, 1.3, R, {old: !lane && old && K.clearD(x, y) > 10 ? 1 : 0}, ci); out[out.length - 1][3].yaw = +yaw.toFixed(3);
        if (pick < .5) stumpBy(x + Math.cos(yaw) * 2.1, y + Math.sin(yaw) * 2.1, R, ci);   // (its stump by the root end)
        else if (pick < .7) ringBy(x, y, R, ci);
        continue;
      }
      if (roll < (acc += T.agaric * (sh > .35 && sh < .9 && (e.dBirch < 4 || e.dPine < 4) ? 1 : 0))) { if (room(x, y, .4)) put('fly_agaric', x, y, .4, R, v => ({n: 1 + v}), ci); continue; }
      if (roll < (acc += T.chant * (sh > .45 && nearPine ? 1 : 0))) { if (room(x, y, .35)) put('chanterelles', x, y, .35, R, null, ci); continue; }
      const dry = wd > 3.5, esk = K.eskerH(x, y) > .3;
      if (roll < (acc += T.berry * (dry && (nearPine || esk) && sh > .12 && sh < .85 ? .4 + e.pine + (esk ? .4 : 0) : 0))) { if (room(x, y, .7)) { put('blueberry', x, y, .7, R, v => ({n: 3 + v}), ci); out[out.length - 1][3].s = +(out[out.length - 1][3].s * T.berryS).toFixed(2); } continue; }
      // lingon: the drier, sunnier, poorer ground (open pine, the esker, the thin soil by rock); after the rest, so it only takes spots none of them wanted
      if (roll < (acc += T.lingon * (dry && sh < .55 && (nearPine || esk || rockD(x, y) < 6) ? .6 + (esk ? .4 : 0) + (sh < .3 ? .3 : 0) : 0))) { if (room(x, y, .6)) { put('lingonberry', x, y, .6, R, v => ({n: 7 + v * 3}), ci); out[out.length - 1][3].s = +(out[out.length - 1][3].s * T.berryS).toFixed(2); } continue; }
    }
  }
}

// a terrace's height at a point as terrain.js evaluates it (a bank per point, interpolated along each edge): h inside, falling
// to 0 over the bank outside (the ground wins where it is higher). For placement's slope and height tests here
const boxOf = (pts, m) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0 - m, y0 - m, x1 + m, y1 + m]; };
function terraceH(t, x, y) {
  const b0 = t.box; if (x < b0[0] || y < b0[1] || x > b0[2] || y > b0[3]) return 0;
  const P = t.pts, n = P.length; let d = 1e9, e = 0, f = 0, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i], vx = bx - ax, vy = by - ay, u = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1), q = Math.hypot(x - ax - vx * u, y - ay - vy * u);
    if (q < d) { d = q; e = j; f = u; }
    if ((ay > y) !== (by > y) && x < vx * (y - ay) / vy + ax) inside = !inside;
  }
  if (inside) return t.h;
  const b = Math.max(.02, t.banks[e] + (t.banks[(e + 1) % n] - t.banks[e]) * f);
  return d < b ? t.h * (1 - smooth(d / b)) : 0;
}
// a ridge along a course: a flat crest crest m either side, falling (raised cosine) to the ground over w m; tapering to nothing over
// its ends' first `taper` of its length; its height wanders a little along it. -> (x, y) => m, with .dist(x, y) (m to its line,
// 1e9 far from it) and .h. The nearest of its samples (every .5 m) from a 2 m cell index
function ridge(C, H, crest, w, taper, S) {
  const reach = crest + w, xs = [], ys = [], ts = [];
  for (let i = 0; i < C.n; i += 5) { xs.push(C.px[i]); ys.push(C.py[i]); ts.push(C.len[i] / C.total); }
  const G = 2, x0 = Math.min(...xs) - reach - G, y0 = Math.min(...ys) - reach - G, gw = Math.ceil((Math.max(...xs) + reach + G - x0) / G), gh = Math.ceil((Math.max(...ys) + reach + G - y0) / G);
  const cells = Array.from({length: gw * gh}, () => []), R2 = reach + G * .75;
  for (let k = 0; k < xs.length; k++) for (let j = Math.max(0, Math.floor((ys[k] - R2 - y0) / G)); j <= Math.min(gh - 1, Math.floor((ys[k] + R2 - y0) / G)); j++)
    for (let i = Math.max(0, Math.floor((xs[k] - R2 - x0) / G)); i <= Math.min(gw - 1, Math.floor((xs[k] + R2 - x0) / G)); i++)
      if (Math.hypot(x0 + (i + .5) * G - xs[k], y0 + (j + .5) * G - ys[k]) < R2) cells[j * gw + i].push(k);
  let qt = 0;
  const dist = (x, y) => {
    const i = Math.floor((x - x0) / G), j = Math.floor((y - y0) / G); if (i < 0 || j < 0 || i >= gw || j >= gh) return 1e9;
    const c = cells[j * gw + i]; let bd = 1e18;
    for (let m = 0; m < c.length; m++) { const k = c[m], dx = x - xs[k], dy = y - ys[k], d = dx * dx + dy * dy; if (d < bd) { bd = d; qt = ts[k]; } }
    return c.length ? Math.sqrt(bd) : 1e9;
  };
  const fn = (x, y) => {
    const d = dist(x, y); if (d >= reach) return 0;
    const prof = d <= crest ? 1 : .5 * (1 + Math.cos(Math.PI * (d - crest) / w));
    return H * (.88 + .24 * vnoise(qt * 6, 2.5, S + 11)) * smooth(Math.min(qt, 1 - qt) / taper) * prof;
  };
  fn.dist = dist; fn.h = H;
  return fn;
}

// m from (x, y) to the stream's water (< 0 in it), the lake's (< 0 in it): the nearer
const _o = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0}, _q = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0};
const segD = (x, y, ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(x - ax - vx * t, y - ay - vy * t); };
function waterD(F, x, y) { F.at(x, y, _o); return Math.min(_o.d - _o.hw, -F.lakeEdge(x, y)); }

// one chunk's trees, undergrowth and rocks (its own generator: mix(seed, cx, cy))
const DECID = [['oak', .45], ['birch', .2], ['aspen', .14], ['rowan', .15], ['dead', .06]];
function grow(F, cx, cy, S, slope, K) {
  const ci = F.chunks.length - 1, T = TUNE, R = rng(mix(F.seed, 1000 + cx, 1000 + cy)), x0 = cx * CHUNK, y0 = cy * CHUNK, out = F.props;
  const inside = (x, y, m) => x > RECT.x0 + m && x < RECT.x1 - m && y > RECT.y0 + m && y < RECT.y1 - T.trees.south;
  const dens = (x, y) => smooth((vnoise(x / 15, y / 15, S + 3) * .75 + vnoise(x / 6, y / 6, S + 4) * .25 - .28) / .5);   // thickets and clearings
  const conifer = (x, y) => vnoise(x / 34, y / 34, S + 5) * .8 + F.height(x, y) / 4 * .35 + K.eskerH(x, y) * .1 > .55;   // (pines on the high, dry ground and the esker)
  const inField = (x, y, m) => K.boulders !== null && Math.hypot(x - K.boulders.x, y - K.boulders.y) < K.boulders.r + m;
  // TREES
  const tc = T.trees.cell, nt = Math.round(CHUNK / tc), trees = [];
  for (let j = 0; j < nt; j++) for (let i = 0; i < nt; i++) {
    const x = x0 + (i + .5 + (R() - .5) * 2 * T.trees.jitter) * tc, y = y0 + (j + .5 + (R() - .5) * 2 * T.trees.jitter) * tc, roll = R(), pick = R(), sc = R(), v = R();
    if (!inside(x, y, T.trees.edge) || K.clearD(x, y) < 0 || K.crestD(x, y) < .6 || K.inRock(x, y, .8) || inField(x, y, .5) || K.canyonClear(x, y)) continue;   // (the clearing, the esker's path, a block, the boulders, the canyon)
    const wd = waterD(F, x, y); if (wd < T.trees.water || slope(x, y) > T.trees.slope || K.bare(x, y)) continue;   // (none on the fell's top)
    const fk = K.fellK(x, y);   // (up the fell: thinner, stunted mountain birch, a pine now and then)
    if (roll > (T.trees.base + T.trees.dense * dens(x, y)) * (1 - fk * 1.1)) continue;
    let species;
    if (fk > .25) species = pick < .78 ? 'birch' : 'pine';
    else if (wd < 4.5 && pick < .45) species = 'willow';
    else if (conifer(x, y)) species = pick < .9 ? 'pine' : 'birch';
    else { let a = pick; species = DECID.find(([, w]) => (a -= w) < 0)?.[0] || 'oak'; }
    const fid = `t${cx}.${cy}.${trees.length}`, s = (species === 'pine' ? .95 + sc * .4 : species === 'dead' ? .8 + sc * .3 : .85 + sc * .35) * (1 - Math.max(0, fk - .2) * .6);
    const p = ['tree', +x.toFixed(2), +y.toFixed(2), {species, fid, scale: +s.toFixed(2), r: .45, variant: v * 3 | 0, chunk: ci}];
    trees.push(p); out.push(p); F.trees.set(fid, [p[1], p[2]]);
  }
  // UNDERGROWTH: under and round the trees bushes and ferns, tufts in the open, reeds where the water meets the bank
  const uc = T.under.cell, nu = Math.round(CHUNK / uc);
  for (let j = 0; j < nu; j++) for (let i = 0; i < nu; i++) {
    const x = x0 + (i + .5 + (R() - .5) * 2 * T.under.jitter) * uc, y = y0 + (j + .5 + (R() - .5) * 2 * T.under.jitter) * uc, roll = R(), pick = R(), v = R() * 3 | 0;
    if (!inside(x, y, 1.2) || K.inRock(x, y, .2) || inField(x, y, 0)) continue;
    const wd = waterD(F, x, y);
    if (wd > -.05 && wd < .55) { if (roll < .75) out.push(['reed', +x.toFixed(2), +y.toFixed(2), {r: 0, variant: v, chunk: ci}]); continue; }
    if (wd < .7 || slope(x, y) > .6) continue;
    const d = dens(x, y);
    if (roll > T.under.p * (.45 + d)) continue;
    const kind = d > .45 ? (pick < .55 ? 'fern' : 'bush') : (pick < .7 ? 'tuft' : pick < .9 ? 'bush' : 'fern');
    if (kind !== 'tuft' && (K.clearD(x, y) < 0 || K.bare(x, y))) continue;   // (only grass in the clearing and on the fell's top)
    if (trees.some(t => Math.hypot(t[1] - x, t[2] - y) < .7)) continue;   // (not in a trunk)
    out.push([kind, +x.toFixed(2), +y.toFixed(2), {r: 0, variant: v, chunk: ci}]);
  }
  // ROCKS: a boulder or two on the slopes (solid), stones about
  for (let k = 0; k < T.rocks.big + T.rocks.small; k++) {
    const big = k < T.rocks.big, x = x0 + R() * CHUNK, y = y0 + R() * CHUNK, roll = R(), v = R() * 3 | 0;
    if (!inside(x, y, 2) || waterD(F, x, y) < (big ? 1.6 : .4) || K.clearD(x, y) < 1 || K.inRock(x, y, .5)) continue;
    if (big ? roll > .25 + slope(x, y) * 1.2 : roll > .55) continue;
    if (trees.some(t => Math.hypot(t[1] - x, t[2] - y) < (big ? 1.6 : .8))) continue;
    out.push([big ? 'rock_big' : 'rock', +x.toFixed(2), +y.toFixed(2), {r: big ? .75 : 0, variant: v, chunk: ci}]);
  }
}

// a course through [x, y] points: Catmull-Rom between them, resampled every DS m; the half width easing from hw0 to hw1; at(x, y,
// out) its nearest point (out.d, a (+ to the left of the flow), l, hw, i) via a 1 m cell index of the samples near each cell
const DS = .1;
function course(ctl, hw0, hw1) {
  const dense = [];
  for (let k = 0; k + 1 < ctl.length; k++) {
    const p0 = ctl[Math.max(0, k - 1)], p1 = ctl[k], p2 = ctl[k + 1], p3 = ctl[Math.min(ctl.length - 1, k + 2)];
    for (let i = 0; i < 24; i++) {
      const t = i / 24, t2 = t * t, t3 = t2 * t, cr = (a, b, c, d) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      dense.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(ctl.at(-1));
  const X = [dense[0][0]], Y = [dense[0][1]], Ls = [0];
  for (let i = 1, run = 0; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let next = Ls.length * DS; next <= run + l + 1e-9; next = Ls.length * DS) { const t = l > 0 ? (next - run) / l : 0; X.push(a[0] + (b[0] - a[0]) * t); Y.push(a[1] + (b[1] - a[1]) * t); Ls.push(next); }
    run += l;
  }
  const n = X.length, C = {n, px: Float32Array.from(X), py: Float32Array.from(Y), len: Float32Array.from(Ls), hw: new Float32Array(n), bed: new Float32Array(n), total: Ls[n - 1]};
  for (let i = 0; i < n; i++) { const u = i / (n - 1); C.hw[i] = hw0 + (hw1 - hw0) * smooth(u) + (vnoise(i * .03, 1.7, 77) - .5) * .12; }
  const REACH = 2.5; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[i]); y0 = Math.min(y0, Y[i]); x1 = Math.max(x1, X[i]); y1 = Math.max(y1, Y[i]); }
  const gx0 = Math.floor(x0 - REACH), gy0 = Math.floor(y0 - REACH), gw = Math.ceil(x1 + REACH) - gx0, gh = Math.ceil(y1 + REACH) - gy0, near = new Int32Array(gw * gh).fill(-1), nd = new Float32Array(gw * gh).fill(1e9);
  for (let i = 0; i < n; i++) for (let cy = Math.floor(Y[i] - REACH) - gy0; cy <= Math.floor(Y[i] + REACH) - gy0; cy++) for (let cx = Math.floor(X[i] - REACH) - gx0; cx <= Math.floor(X[i] + REACH) - gx0; cx++) {
    const k = cy * gw + cx, d = Math.hypot(cx + gx0 + .5 - X[i], cy + gy0 + .5 - Y[i]); if (d < nd[k]) { nd[k] = d; near[k] = i; }
  }
  C.box = [x0 - REACH, y0 - REACH, x1 + REACH, y1 + REACH];
  C.at = (x, y, out) => {
    out.d = 1e9; out.a = 0; out.l = 0; out.hw = 0; out.i = 0;
    const cx = Math.floor(x) - gx0, cy = Math.floor(y) - gy0; if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return false;
    const i0 = near[cy * gw + cx]; if (i0 < 0) return false;
    let bd = 1e18, bj = -1, bt = 0;
    for (let j = Math.max(0, i0 - 20), e = Math.min(n - 2, i0 + 20); j <= e; j++) {
      const ax = X[j], ay = Y[j], vx = X[j + 1] - ax, vy = Y[j + 1] - ay, u = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), t = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = x - ax - vx * t, dy = y - ay - vy * t, d = dx * dx + dy * dy; if (d < bd) { bd = d; bj = j; bt = t; }
    }
    if (bj < 0) return false;
    const j = bj, t = bt, vx = X[j + 1] - X[j], vy = Y[j + 1] - Y[j], d = Math.sqrt(bd), qx = X[j] + vx * t, qy = Y[j] + vy * t;
    out.d = d; out.l = Ls[j] + (Ls[j + 1] - Ls[j]) * t; out.hw = C.hw[j] + (C.hw[j + 1] - C.hw[j]) * t; out.a = vx * (y - qy) - vy * (x - qx) < 0 ? d : -d; out.i = t < .5 ? j : j + 1;
    return d < out.hw;
  };
  return C;
}

// the trees' ids and places (the co-op server's check: server/room.mjs)
export const forestTrees = seed => forestPlan(seed).trees;

// ---- LAY (layout.js, once, with its sampler: the ground the shapes make before these cuts): the beds, the ground less their depth,
// never rising downstream. The stream meets the lake at its surface; the outflow leaves the lake at its surface and comes down to the
// river's (WATER_H: the river is its ground lowered by that). The channels cut along them and the spring's hollow (F.cuts)
export function lay(F, G) {
  if (F.laid) return; F.laid = true;
  const T = TUNE.stream, L = F.lake, surf = L.bed + WATER_H;
  const bedOf = (C, top, lo) => {
    for (let i = 0; i < C.n; i++) { const g = G(C.px[i], C.py[i]) - T.depth; C.bed[i] = Math.max(lo, Math.min(g, i ? C.bed[i - 1] : top)); }
  };
  bedOf(F.stream, 1e9, surf);
  bedOf(F.outflow, surf, WATER_H - .02);
  for (const C of [F.stream, F.outflow]) {
    const keep = []; for (let k = 0; k < C.n; k++) if (k % 3 === 0 || k === C.n - 1) keep.push(k);
    F.cuts.push({type: 'channel', pts: keep.map(k => [C.px[k], C.py[k]]), bed: keep.map(k => F.inLake(C.px[k], C.py[k], .4) ? 9 : C.bed[k]), hw: keep.map(k => C.hw[k] + .06), bank: T.bank});
  }
  F.cuts.push({type: 'basin', x: F.spring.x, y: F.spring.y, rx: F.spring.r + .08, ry: F.spring.r + .08, h: F.stream.bed[0] - .07, rim: .45});
  // RIFFLES (C.rif, 0..1 a point): where the bed drops fast the water runs white; a steep stretch breaks into steps by a noise along
  // it, a riffle then a POOL (C.pool: steep but calm, deeper; on the gentle stretches a noise digs the odd slow hole too). STONES (F.stones: {x, y, r} m) stand in the riffles, now and then in
  // the runs: painted dry (paint), the water's foam rings them (world.js: waterbed's dry). Their own generator, from the seed
  const R = TUNE.stream.riffle, RS = rng(mix(F.seed, 43)); F.stones = [];
  [F.stream, F.outflow].forEach((C, c) => {
    const [s0, s1] = R.slope[c], rif = C.rif = new Float32Array(C.n), pool = C.pool = new Float32Array(C.n);
    for (let i = 0; i < C.n; i++) {
      const a = Math.max(0, i - 6), b = Math.min(C.n - 1, i + 6), sl = smooth(((C.bed[a] - C.bed[b]) / Math.max(.1, C.len[b] - C.len[a]) - s0) / (s1 - s0));
      const st = smooth((vnoise(C.len[i] * .45, 2.3 + c, 79) - R.steps) / .15), off = F.inLake(C.px[i], C.py[i], .3) ? 0 : 1;
      const slow = (1 - sl) * smooth((vnoise(C.len[i] * .2, 6.1 + c, 80) - .5) / .18);   // (a gentle stretch has its deep holes too)
      rif[i] = sl * st * off; pool[i] = Math.max(sl * (1 - st), slow) * off;
    }
    for (let i = 4; i < C.n - 4; i += 3) {
      if (RS() > R.stones[0] + (R.stones[1] - R.stones[0]) * rif[i] || F.inLake(C.px[i], C.py[i], .5) || Math.hypot(C.px[i] - F.spring.x, C.py[i] - F.spring.y) < F.spring.r + .4) continue;
      const dx = C.px[i + 1] - C.px[i - 1], dy = C.py[i + 1] - C.py[i - 1], l = Math.hypot(dx, dy) || 1, u = (RS() * 2 - 1) * .6 * C.hw[i];
      const r = Math.min(C.hw[i] * .45, R.r[0] + RS() * (R.r[1] - R.r[0]) * (1 + rif[i])), x = C.px[i] - dy / l * u, y = C.py[i] + dx / l * u;
      if (F.stones.some(q => Math.hypot(q.x - x, q.y - y) < q.r + r + .12)) continue;
      F.stones.push({x: +x.toFixed(3), y: +y.toFixed(3), r: +r.toFixed(3)});
    }
  });
}

// ---- THE WATER for world.js waterSample (kinds 6 the stream, 7 the lake, 8 its outflow): as brook.js sample. a: m across (+ left of
// the flow; the lake: m south of its middle), s: the pattern's travel (.55 x m along a course; the lake: a slow drift east), speed,
// hold (the spring's rings stay as painted). False off it
const K_S = .55, _w = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0}, _d = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0};
export function sample(F, x, y, out) {
  if (F.inLake(x, y)) {
    const L = F.lake; out.kind = 7; out.a = y - L.y; out.hw = L.ry; out.edge = F.lakeEdge(x, y); out.s = (x - L.x) * .3; out.speed = 0; out.hold = 0;   // (speed 0: still water, gfx.js wStill)
    return true;
  }
  const B = F.box; if (x < B[0] || x > B[2] || y < B[1] || y > B[3] || !F.at(x, y, _w)) return false;
  const out8 = _w.k === 1, C = out8 ? F.outflow : F.stream, rf = C.rif ? C.rif[_w.i] : 0;
  out.kind = out8 ? 8 : 6; out.a = _w.a; out.hw = _w.hw; out.edge = _w.hw - _w.d; out.s = _w.l * K_S + (out8 ? 300 : 0);
  out.speed = out8 ? .85 + .3 * smooth((_w.l - F.outflow.total + 6) / 6) : _w.l < 1.2 ? .45 : .75 + .25 * vnoise(_w.l * .2, 3.1, 41);
  out.speed += (1.85 - out.speed) * Math.sqrt(rf);   // (a riffle runs white: gfx.js wTexel's white water from 1.3)
  out.hold = !out8 && Math.hypot(x - F.spring.x, y - F.spring.y) < F.spring.r ? 1 : 0;
  return true;
}
// how deep its bed lies, 0 (the waterline) .. 1 (waterbed.js): the streams shallow and clear, the spring a well, the lake a bowl
export function depth(F, o, x, y) {
  let d;
  if (o.kind === 7) {   // the lake: a shallow shelf along the shore (the bed in sight), then the drop-off to the deep, a few holes and humps
    const sh = TUNE.lake.shelf * (.75 + .5 * vnoise(x * .35, y * .35, 37));
    d = .05 + .2 * smooth(o.edge / sh) + .75 * smooth((o.edge - sh) / 1.4) + (vnoise(x * 1.3, y * 1.3, 36) - .5) * .1;
  }
  else {
    d = .05 + .22 * smooth(o.edge / Math.max(.08, o.hw)) + (vnoise(x * 3, y * 3, 34) - .5) * .08;
    if (F.at(x, y, _d)) { const C = _d.k === 1 ? F.outflow : F.stream; if (C.rif) d = d * (1 - .5 * C.rif[_d.i]) + .5 * C.pool[_d.i] * smooth(o.edge / Math.max(.08, o.hw)); }   // (a riffle runs shallow over its stones, the pool below it is deep)
    const rs = Math.hypot(x - F.spring.x, y - F.spring.y) / F.spring.r; if (o.kind === 6 && rs < 1) d = Math.max(d, .2 + .6 * smooth((1 - rs) / .7));
  }
  return clamp(d, 0, 1);
}
// the water's box (m: x0, y0, x1, y1), what world.js bakes the moving water over
export function waterBox(F) { return F.box; }

// ---- PAINT (biomes.js forestRuins): the streams and the lake on the forest's canvas, as brook.js paints its own: the water in the
// river's four tones exactly (world.js bakeWater moves only texels painted in them), a shadow line under one bank and a lit edge
// on the other, a deeper middle; earth banks with a damp, lush band; the spring in a ring of mossy stones. K: the painter's kit
// (G the pixels, PPM, X0 / Y0 the canvas's world origin, WPX / HPX); S the ruins' style; T = {hsh, vn, hex, boulder}
export function paint(F, K, S, T) {
  const {G, PPM, X0, Y0, WPX, HPX} = K, {hsh, vn: n2, hex} = T, W = S.water, o = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0}, L = F.lake;
  const FL = [hex('#f1ecde'), hex('#f0d968'), hex('#c8a6e8'), hex('#f2b9c9')];
  const box = F.box, xa = Math.max(0, Math.floor((box[0] - X0) * PPM)), xb = Math.min(WPX - 1, Math.ceil((box[2] - X0) * PPM));
  const ya = Math.max(0, Math.floor((box[1] - Y0) * PPM)), yb = Math.min(HPX - 1, Math.ceil((box[3] - Y0) * PPM));
  const M = F.wet;
  for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) {
    const mx = X0 + (x + .5) / PPM, my = Y0 + (y + .5) / PPM;
    if (!M.d[(Math.floor(my) - M.y0) * M.w + Math.floor(mx) - M.x0]) continue;   // (far from any water: most of the box)
    const inS = F.at(mx, my, o), eL = -F.lakeEdge(mx, my);
    let e = o.d - o.hw, side = o.a < 0 ? -1 : 1, deep = Math.abs(o.a) < o.hw * .45, lake = false;
    if (eL < e) { e = eL; lake = true; const u = (mx - L.x) / L.rx, v = (my - L.y) / L.ry; side = u + v < 0 ? -1 : 1; deep = Math.hypot(u, v) < .7; }
    if (!inS && e > 1.2) continue;
    if (lake && e >= 0 && F.strand(mx, my)) {   // the STRAND: the basin's floor the water left, at its height: wet sand at the water, then sand,
      const g = n2(x / 6, y / 5, 81), pe = hsh(x, y, 82);   // gravel in drifts, pebbles; moss creeping in from the land side
      const out = (Math.hypot((mx - L.x) / L.rx, (my - L.y) / L.ry) - 1) * Math.min(L.rx, L.ry);   // m inside the ellipse's rim (< 0)
      if (e < .05) G.p(x, y, S.earth, 3);
      else if (e < .16) G.p(x, y, S.earth, hsh(x, y, 83) < .6 ? 2 : 1);
      else if (out > -.35 + n2(x / 3, y / 3, 84) * .3 && hsh(x, y, 85) < .7) G.p(x, y, S.moss, hsh(x, y, 86) < .5 ? 2 : 1);
      else if (pe < .035) { G.p(x, y, S.rock, 0); G.p(x + 1, y, S.rock, 1); G.p(x, y + 1, S.rock, 2); G.p(x + 1, y + 1, S.rock, 3); }   // a pebble, lit from the up-left
      else if (g > .55) G.p(x, y, S.floor, pe < .45 ? 1 : pe < .8 ? 2 : 3);
      else G.p(x, y, S.inlay, g < .3 && pe < .5 ? 1 : 2);
      continue;
    }
    e += (n2(x / 4, y / 3, 73) - .5) * (lake ? .12 : .05);
    if (e >= 1.05) continue;
    if (e >= 0) {   // the banks: an earth lip, damp ground, then the lusher band
      if (e < .05) G.p(x, y, S.earth, 3);
      else if (e < .14) G.p(x, y, S.earth, side < 0 ? 2 : 1);
      else if (e < .26) { if (hsh(x, y, 4) < .5) G.p(x, y, S.damp, 1); }
      else if (e < .5 + n2(x / 9, y / 7, 62) * .5) {
        if (e < .38 && hsh(x, y, 63) < .45) continue;
        G.p(x, y, S.damp, Math.min(2, Math.max(0, G.tone(x, y))));
        if (hsh(x, y, 65) < .013) { G.p(x, y, S.lush, 0); G.p(x + 1, y, S.lush, 1); G.p(x, y + 1, S.lush, 2); }
        else if (hsh(x, y, 66) < .0035) G.c(x, y, FL[hsh(x, y, 67) * 4 | 0]);
      }
      continue;
    }
    const d = -e, rs = Math.hypot(mx - F.spring.x, my - F.spring.y), sr = F.spring.r;
    let t;
    if (!lake && o.k === 0 && rs < sr + .03) t = rs < .07 || (rs > .14 && rs < .18 && hsh(x, y, 8) < .85) || (rs > .27 && rs < .31 && hsh(x, y, 9) < .6) ? 0 : side < 0 && d < .1 ? 3 : side > 0 && d < .04 ? 0 : rs < .2 ? 2 : 1;
    else t = side < 0 && d < (lake ? .14 : .09) ? 3 : side > 0 && d < (lake ? .06 : .04) ? 0 : deep ? 2 : 1;
    G.p(x, y, W, t);
  }
  // a few big stones on the strand where it is wide (the bays' floors), seeded by their spot round the lake
  for (let k = 0; k < 48; k++) {
    const a = k / 48 * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a); if (hsh(k, 5, F.seed & 255) > .3) continue;
    let r0 = 0; for (let r = .5; r <= 1.02; r += .01) if (F.strand(L.x + cx * L.rx * r, L.y + cy * L.ry * r)) { r0 = r; break; }
    if (!r0 || (1.02 - r0) * Math.min(L.rx, L.ry) < .7) continue;   // (the strand too narrow here)
    const r = r0 + (1.02 - r0) * (.35 + .3 * hsh(k, 6, 9)), sz = .6 + hsh(k, 7, 11) * .6;
    T.boulder(K, L.x + cx * L.rx * r - X0, L.y + cy * L.ry * r - Y0, 4 * sz + 1.5, 2.8 * sz + 1, S.rock, k * 31 + 7, S.moss);
  }
  // the stones standing in the streams (lay's F.stones): dry, so the water flows round them and its foam rings them
  for (const s of F.stones || []) { const rx = s.r * PPM, h = hsh(s.x * 16 | 0, s.y * 16 | 0, 7); T.boulder(K, s.x - X0, s.y + s.r * .6 - Y0, rx, rx * .72, S.rock, h * 997 | 0, h < .25 ? S.moss : null); }   // (washed bare: a quarter keep a cap of moss)
  // the spring: a ring of mossy stones round where it wells up, open downstream
  const C = F.stream, dx = C.px[Math.min(C.n - 1, 8)] - C.px[0], dy = C.py[Math.min(C.n - 1, 8)] - C.py[0], a0 = Math.atan2(dy, dx);
  for (let k = 0; k < 7; k++) {
    const a = a0 + .7 + k * (Math.PI * 2 - 1.4) / 6, sz = .8 + hsh(k, 3, F.seed & 255) * .25;
    T.boulder(K, F.spring.x + Math.cos(a) * .52 - X0, F.spring.y + Math.sin(a) * .47 - Y0, 4.5 * sz + 1.5, 3 * sz + 1, S.rock, k * 17 + 3, S.moss);
  }
}
