// Proving Grounds: a small test arena for the character, playstyle, lights and biomes, plus an east TRAIL for
// traversal and combat mechanics. Everything is in METRES on the ground plane (x right, y toward the camera), heights
// in metres above the ground. The biome decides how things look; this file decides WHERE things are, what they
// collide with, how high the ground is (elev) and where the traversal features are.
//
//   world 120 x 30 m (WORLD: the bounds of everything; GROUNDS: the Proving Grounds' own rect, 72 x 30; ?terrain=0: 62 x 30)
//   x -48..0  the WEST DOWNS (world/westland.js; ?west=0: none, the world starts at x 0): rolling meadow hills, oaks, a track
//             on from the west gate's road
//   x 7..33   walled arena (movement ring, range lane, pillar grove, light garden, N/S dummies)
//   x 33..60  the trail, out of the east gate:
//               stream   runs N-S at x ~40; 2.9 m wide (sprint-leap only), a 1.4 m narrows in front of the gate
//                        (leap), and 2 stepping stones further south (chained short leaps). Falling in = respawn.
//               plateau  x 43..60, y 2.8..11, 2.4 m high. South face = cliff; walk off any edge to drop down;
//                        climb up / down only at the climb spot (E). Chest, pots and a crystal on top.
//                        WITH TERRAIN (the default) it is the MESA, x 45..67, 2.4 m: cliffs round its south, east and west
//                        sides (natural outlines, 3D rock), ladders up the south and east faces, its north side rising on
//                        into the highland, and a GULLY down its south-west corner: a walkable slope beside the creek, which
//                        comes down it in cascades to the pool (MESA, CLIMBS, CASCADES below; docs/TERRAIN.md step 6)
//               spring   on the plateau's east half (57, 6.9): a shallow RILL (0.5-0.8 m, wadeable: not water to the sim) winds
//                        west across the top and pours over the SOUTH edge near its south-west corner (the FALL, on the face the
//                        default camera sees) into a POOL at the foot: round, deep like the stream (falling in = respawn; arrows
//                        splash; spawns and brutes keep out). A shallow OUTFLOW (wadeable) runs west from the pool to the stream's
//                        east bank, north of the narrows. The ledge between the stream and the west face stays dry.
//               yard     below the cliff: crates, barrels, pots, explosive barrels, a crate wall hiding a cache,
//                        and two sparring dummies that hop at you.
//
//            N gate
//   +--------[   ]-------------------------+ . . . . . . . ~ . . +==== plateau (2.4 m) =====+
//   | range lane: mark -> dummies 4/8/12 m |                ~     | chest   pots   crystal   |
//   |                                       |               ~      +=====[climb]==============+  <- cliff face
//   | pillar      (  movement ring  )  light   -- path --  ~~ narrows (leap)                   |
//  W  grove        sprint / skid / roll   garden  E gate    ~       yard: crates, barrels, pots |
//   |                                       |               ~       explosive barrels, sparring |
//   |  deco strip + N/S shooting dummies   |               o o  stepping stones   crate wall    |
//   +--------[   ]-------------------------+                ~                     [cache]      |
//            S gate
import {flags} from '../core/flags.js';
import {smooth} from '../core/mathx.js';
import {createField, sampler} from './terrain.js';
import {WEST_ON, WEST, LAND as WEST_LAND, HILLS as WEST_HILLS, BORDERS as WEST_BORDERS, PROPS as WEST_PROPS, OLD_WALL_LEGS, WALL_D, SEG as WALL_SEG, oldWallD} from './westland.js';
import {TERRAIN as STONE_TERRAIN, PROPS as STONE_PROPS} from './stonecircle.js';   // the West Downs' standing stones
import {TOWER} from './westland.js';   // the West Downs' watchtower (world/watchtower.js)
import {towerPlan, towerCols, inTower} from './watchtower.js';
import {BROOK, BRIDGE as BROOK_BRIDGE, lay as layBrook, inBrookPool, gapsOn as brookGaps, away as brookAway} from './brook.js';   // the West Downs' brook
import {SESSION} from '../core/session.js';   // the forest's seed (?seed, ?forest=1, or the co-op server's)
import {forestPlan, lay as layForest, RECT as FOREST_RECT} from './forest.js';   // the seeded forest north of the Proving Grounds

// WORLD: the bounds of everything (m): the ground, the camera, the spatial grid, the nav and the renderer's world-wide maps
// cover it. Its origin (x0, y0) may go below 0 when the world grows; WM / HM = its size. GROUNDS: the Proving Grounds' own
// rect, what buildLayout and the biomes' ground painters lay out (today the whole world; it stays at 0, 0: a painted ground
// texel's px / PPM is its world x / y). ?world=big: 40 m more to the west, 60 m to the north and east (the ravine stays the
// south edge): 162 x 90 m, for measuring the engine at that size (the world plan, step 2; step 3 opens and paints the land)
const BIG = flags.get('world') === 'big';
// walkable terrain (docs/TERRAIN.md; on by default, ?terrain=0: the world before it, flat but for the plateau's box, for an A/B).
// With it the Proving Grounds are 10 m wider (the plateau became a mesa: room for its east side)
export const TERRAIN_ON = flags.get('terrain') !== '0';
const GX1 = TERRAIN_ON ? 72 : 62;
// past: how far (m) past its edges the view may go (render/camera.js keeps the player centred up to there; world.js lays ground out to
// past + 2 m, the painted ground mirrored on outward)
// The WEST DOWNS (westland.js, on by default) grow the world west to WEST.x0
const WX0 = WEST_ON ? WEST.x0 : 0;
// THE FOREST (world/forest.js, docs/FOREST.md): grown from a seed north of everything (y -64..0, the world's width); on with a seed
// (core/session.js: ?seed=N, ?forest=1, a co-op server's) and walkable terrain. It takes the world's north edge out to its own
export const FOREST = TERRAIN_ON && SESSION.seed !== null ? forestPlan(SESSION.seed) : null;
export const WORLD = FOREST ? {x0: Math.min(WX0, FOREST_RECT.x0), y0: FOREST_RECT.y0, x1: GX1, y1: 30, WM: GX1 - Math.min(WX0, FOREST_RECT.x0), HM: 30 - FOREST_RECT.y0, past: 12}
  : BIG ? {x0: Math.min(-40, WX0), y0: -60, x1: 122, y1: 30, WM: 122 - Math.min(-40, WX0), HM: 90, past: 12} : {x0: WX0, y0: 0, x1: GX1, y1: 30, WM: GX1 - WX0, HM: 30, past: 12};
export {WEST_ON, WEST, WEST_LAND};
export const GROUNDS = {x0: 0, y0: 0, x1: GX1, y1: 30};
export const PLAY = {x0: 7, y0: 6, x1: 33, y1: 24};
export const SCONCE_D = .21;   // a wall sconce's stick stands this far off the wall face (the east torches; lights.js mounts them)
export const TRAIL = {x0: 33, y0: 2.6, x1: TERRAIN_ON ? 69.5 : 60, y1: 27.5};   // walkable outdoor region east of the arena

// ---- where things may be: the walled arena and the trail (one place; was four copies), each use with its own margins ----
//   walkable(x, y)  the player and pushed props: the arena and 3 m round it (the gates' aprons), the trail
//   roamable(x, y)  enemies (combat's brutes): the arena .35 m in from its edges, the trail .5 m in (.4 m at its south edge)
//   navArea(x, y)   the nav grid's open cells: the arena and .6 m past its east edge (the east gate meets the trail), the trail
// Walls, water and plateaus are tested on top of these by their users
//   the WEST DOWNS (westland.js): from the west border's bank to the arena's west gate apron (the strip west of the arena's wall is
//   theirs: its trees and rocks are solid), from the north bank to short of the ravine's rim
const DOWNS = WEST_ON ? {x0: WEST.x0 + 1.4, y0: .6, x1: PLAY.x0 - 2.5, y1: 26.4} : null;
const inDowns = (x, y, m) => !!DOWNS && x > DOWNS.x0 + m && x < DOWNS.x1 && y > DOWNS.y0 + m && y < DOWNS.y1 - m;
//   the FOREST: from its border banks to the strip north of the arena's wall (FOREST_S: meeting the gates' aprons, the downs, the trail)
const FOREST_S = 3.2;
const inForest = (x, y, m) => !!FOREST && x > WORLD.x0 + 1.4 + m && x < WORLD.x1 - 1 - m && y > WORLD.y0 + 1.4 + m && y < FOREST_S - m;
export const walkable = (x, y) => (x > PLAY.x0 - 3 && x < PLAY.x1 + 3 && y > PLAY.y0 - 3 && y < PLAY.y1 + 3) || (x > TRAIL.x0 && x < TRAIL.x1 && y > TRAIL.y0 && y < TRAIL.y1) || inDowns(x, y, 0) || inForest(x, y, 0);
export const roamable = (x, y) => (x > PLAY.x0 + .35 && x < PLAY.x1 - .35 && y > PLAY.y0 + .35 && y < PLAY.y1 - .35) || (x > TRAIL.x0 + .5 && x < TRAIL.x1 - .5 && y > TRAIL.y0 + .5 && y < TRAIL.y1 - .4)
  || inDowns(x, y, .5) || (!!DOWNS && x >= DOWNS.x1 - .1 && x < PLAY.x0 + .4 && Math.abs(y - (PLAY.y0 + PLAY.y1) / 2) < 1.3)   // (the downs and the west gate between them and the arena)
  || inForest(x, y, .5);
export const navArea = (x, y) => (x > PLAY.x0 && x < PLAY.x1 + .6 && y > PLAY.y0 && y < PLAY.y1) || (x > TRAIL.x0 && x < TRAIL.x1 && y > TRAIL.y0 && y < TRAIL.y1)
  || inDowns(x, y, 0) || (!!DOWNS && x >= DOWNS.x1 - .1 && x <= PLAY.x0 && Math.abs(y - (PLAY.y0 + PLAY.y1) / 2) < 1.6) || inForest(x, y, 0);

// ---- stream: centreline x and width per y (metres) ----
export const STREAM = {
  cx: y => 40 + .9 * Math.sin(y * .33),
  // 2.9 m (a run-leap reaches ~3.0 m and falls in; a sprint-leap ~3.6 m clears it), 1.4 m at the narrows in front of the east gate
  w: y => { const n = Math.abs(y - 15); return n < 1.2 ? 1.4 : n < 2.4 ? 1.4 + (n - 1.2) / 1.2 * 1.5 : 2.9; },
  narrows: {y: 15},
  y0: -1, y1: 31,   // its span: north of y0 / south of y1 there is no stream (inStream)
  stones: [{x: 0, y: 23.4, r: .42}, {x: 0, y: 23.4, r: .42}],   // x filled in below (placed across the channel)
  // dry footing added during play (a crate sunk to its lid: combat/props.js) and taken away again (it broke, reset)
  addStone(o) { STREAM.stones.push(o); },
  removeStone(o) { const i = STREAM.stones.indexOf(o); if (i >= 0) STREAM.stones.splice(i, 1); },
};
STREAM.stones[0].x = STREAM.cx(23.4) - .5; STREAM.stones[1].x = STREAM.cx(23.4) + .55;
export const inStream = (x, y) => {
  if (FOREST !== null && y < 0) return FOREST.inLake(x, y);   // (the forest's lake: deep water, world/forest.js)
  if (y < STREAM.y0 || y > STREAM.y1) return false;
  if (Math.abs(x - STREAM.cx(y)) > STREAM.w(y) / 2) return inPool(x, y) || inBrookPool(x, y);   // (the plateau's pool is deep water too; so is the brook's, brook.js)
  return !STREAM.stones.some(s => Math.hypot(x - s.x, (y - s.y) * 1.3) < s.r);   // stones are dry footing
};

// ---- elevation. ?terrain=0: one plateau, a box with a south cliff face (PLATEAUS). With terrain (the default) the plateau is part
// of the field (below): the MESA, a terrace whose sides are cliffs (rock) but for a gully down its south-west corner, where the creek
// comes down in CASCADES beside a walkable slope; ladders (CLIMBS) up its south and east faces
const BOX = {x0: 43, y0: 2.8, x1: 60, y1: 11, h: 2.4,
  climbs: [{x: 51.5, w: 1.2}]};         // climb spot on the south face (x = centre, w = width)
export const PLATEAUS = TERRAIN_ON ? [] : [BOX];
export const elev = (x, y) => { for (const p of PLATEAUS) if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return p.h; if (!TERRAIN_ON) return 0; const h = terrainField().H(x, y), d = deckAt(x, y); return d > h ? d : h; };
// too steep to walk up (walkable terrain: a terrace's cliff, a ramp's side); never on flat ground, the plateau's top or a bridge's deck
export const steep = (x, y) => TERRAIN_ON && !PLATEAUS.some(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) && terrainField().steep(x, y) && deckAt(x, y) < -1e8;
// BRIDGES (walkable terrain): footbridges, a deck from a to b (its ends on the banks) w m wide, rising arch m in the middle; deckAt(x, y)
// -> the deck's height there or -1e9 off every deck. elev takes the deck where it lies above the ground (what is under it stays: a
// creek runs on below; nothing walks under a deck). Set up with the creek's bed (below): ends, heights, the box to test first
export const BRIDGES = [];
function deckAt(x, y) {
  for (let i = 0; i < BRIDGES.length; i++) {
    const B = BRIDGES[i]; if (x < B.box[0] || x > B.box[2] || y < B.box[1] || y > B.box[3]) continue;
    const u = ((x - B.a[0]) * B.ux + (y - B.a[1]) * B.uy) / B.len, v = (x - B.a[0]) * -B.uy + (y - B.a[1]) * B.ux;
    if (u < 0 || u > 1 || Math.abs(v) > B.w / 2) continue;
    return B.h0 + (B.h1 - B.h0) * u + B.arch * Math.sin(Math.PI * u);
  }
  return -1e9;
}
// on the open ground: not a plateau's top, not a cliff (spawn spots, scatter, caches: "where elev === 0" in the flat world, exactly)
export const onGround = (x, y) => TERRAIN_ON ? !PLATEAUS.some(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) && !terrainField().steep(x, y) : elev(x, y) === 0;
// two heights the same level: equal in the flat world, within `tol` m on walkable terrain
export const sameLevel = (a, b, tol = .3) => TERRAIN_ON ? Math.abs(a - b) <= tol : a === b;

// ---- WALKABLE TERRAIN (docs/TERRAIN.md). The shapes (world/terrain.js) and the MASK that holds the ground flat where the world
// needs it level: the walled arena with its gates' aprons, the stream and its banks, the pool and its outflow, the ground in front of
// the climbs, the ravine's rim
// THE MESA (the plateau as terrain): its outline [x, y, bank (m: under ~.6 a cliff, rock), firm (the edge to the next point stays
// straight: the desert's mine in the south face, the ladders)], clockwise. Its north side lies under the HIGHLAND's bank (the ground
// rises on north of the trail into higher land, beyond reach); the gully's sides are grass banks down to the walk and the creek.
// Between the points the edge wanders a little (mesaOutline), so no cliff is ruler-straight
const MESA_H = 2.4;
const MESA_CTL = [
  [45.0, .6, 1.5], [55.5, .6, 1.5], [66.2, .6, 1.5],
  // east: steep from the north-east bend, rock round the south-east corner; the east ladder's stretch straight
  [66.7, 2.6, .5], [66.3, 4.5, .12, 1], [66.3, 6.9, .12], [66.0, 8.4, .12], [65.0, 9.9, .12], [63.3, 11.0, .12],
  // south: the cliff the camera looks at; the mine's stretch (the desert) and the ladder's straight
  [61.1, 11.4, .12], [59.2, 11.2, .12], [57.3, 10.95, .12], [56.0, 11.0, .12, 1], [53.0, 11.0, .12, 1], [52.3, 11.2, .12, 1], [50.7, 11.2, .12, 1],
  [49.8, 10.9, .3],
  // the gully's sides: grass banks
  [49.4, 9.6, 2.5], [49.0, 8.1, 3.5], [48.1, 6.9, 4.5], [46.8, 6.1, 4.5], [45.8, 5.3, 3.0],
  // west: the cliff over the ledge by the stream
  [45.2, 4.2, .12], [44.8, 2.9, .12], [45.1, 1.7, .12],
];
// the outline with its wander: every edge cut into pieces under ~.9 m whose inner points stand off the line by up to .16 m (a hash
// of their place: the same every build); a firm edge stays straight. -> {pts, banks, firm: per point, its edge to the next is firm,
// cliffs: [{pts, nrm, core}] the stretches of cliff (rock: world.js; ledges for birds: wildlife.js): the edges whose banks are under
// CLIFF_BANK, carried on one edge into the banks either side (the rock sinks into the slope there, its foot rising with the bank,
// instead of ending in a bare block), each travelled with the outside on its (-ty, tx) side (cliffs3d.js's way); nrm[i] = the outward
// normal at pts[i], core[i] = a cliff point proper (its bank under CLIFF_BANK)}
const CLIFF_BANK = .6, CLIFF_TAPER = 2.2;
function mesaCliffs(P, banks) {
  const n = P.length, hi = i => Math.max(banks[i], banks[(i + 1) % n]), core = i => hi(i) <= CLIFF_BANK, out = [];
  const rock = i => core(i) || (hi(i) <= CLIFF_TAPER && (core((i + n - 1) % n) || core((i + 1) % n)));   // (a cliff edge, or one next to one)
  let area = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  let i0 = 0; while (i0 < n && rock(i0)) i0++;   // (start after a bank: no stretch wraps round the start)
  let cur = null;
  for (let k = 1; k <= n; k++) {
    const i = (i0 + k) % n;
    if (rock(i)) (cur ??= []).push(i); else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map(E => {   // E: the stretch's edges
    const idx = [E[0], ...E.map(i => (i + 1) % n)], pts = idx.map(i => P[i]), core = idx.map(i => banks[i] <= CLIFF_BANK);
    if (area > 0) { pts.reverse(); core.reverse(); }
    const nrm = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; });
    return {pts, nrm, core};
  });
}
function mesaOutline(ctl) {
  const pts = [], banks = [], firm = [], hs = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < ctl.length; i++) {
    const [ax, ay, ab, af] = ctl[i], [bx, by, bb] = ctl[(i + 1) % ctl.length], l = Math.hypot(bx - ax, by - ay), n = af ? 1 : Math.max(1, Math.ceil(l / .9));
    for (let k = 0; k < n; k++) {
      const t = k / n, o = k ? (hs(ax + k, ay - k) - .5) * .32 * Math.sin(Math.PI * t) ** .5 : 0;
      pts.push([ax + (bx - ax) * t - (by - ay) / l * o, ay + (by - ay) * t + (bx - ax) / l * o]); banks.push(ab + (bb - ab) * t); firm.push(!!af);
    }
  }
  return {pts, banks, firm, cliffs: mesaCliffs(pts, banks), ground: inset(pts, banks)};
}
// the GROUND's outline: the face outline drawn in by CLIFF_IN m where it is a cliff. The ground mesh's steep cells (a .25 m lattice:
// a drop between two lattice points slants across up to one cell) then lie behind the rock's face, under its cap, instead of in front
// of it; the rock (world.js) stands on the face outline
const CLIFF_IN = .4;
function inset(P, banks) {
  const n = P.length; let area = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sg = area > 0 ? 1 : -1;   // (the left normal (-ty, tx) points in when the area is > 0)
  return P.map((p, i) => {
    if (banks[i] > CLIFF_BANK) return p;
    const a = P[(i + n - 1) % n], b = P[(i + 1) % n], la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    let nx = -(p[1] - a[1]) / la - (b[1] - p[1]) / lb, ny = (p[0] - a[0]) / la + (b[0] - p[0]) / lb; const l = Math.hypot(nx, ny) || 1;
    return [p[0] + sg * nx / l * CLIFF_IN, p[1] + sg * ny / l * CLIFF_IN];
  });
}
export const MESA = TERRAIN_ON ? {h: MESA_H, ...mesaOutline(MESA_CTL)} : null;
// LEDGES: the low rock the same way (a terrace with a natural outline, rock round it, drawn in behind it): the yard's lookout (stone
// steps up its west side: the steps' stretch straight) and shelves on the slopes, low enough to scramble up (player.js VAULT_H)
const LEDGE_CTL = [
  {h: 1.15, ctl: [[56.8, 14.75, .12], [58.4, 14.6, .12], [60.2, 14.8, .12], [60.75, 16.3, .12], [60.55, 18.4, .12], [60.1, 20.0, .12],
    [58.6, 20.3, .12], [57.0, 20.05, .12], [56.6, 18.6, .12], [56.65, 16.85, .12, 1], [56.65, 15.15, .12]]},   // the lookout
  // a step in the gully's west slope (its uphill side opens into the slope: rock only where it drops), one under the mesa's east side
  // (its back a grass bank)
  {h: .9, ctl: [[43.7, 7.7, .12], [44.9, 7.25, 1.6], [45.7, 7.9, 1.6], [45.4, 9.0, .12], [44.4, 9.4, .12], [43.6, 8.7, .12]]},
  {h: .8, ctl: [[67.9, 8.7, .12], [69.1, 8.4, 1.6], [69.7, 9.6, 1.6], [69.0, 10.8, .12], [67.8, 10.4, .12]]},
];
export const LEDGES = TERRAIN_ON ? LEDGE_CTL.map(L => ({h: L.h, ...mesaOutline(L.ctl)})) : [];
// CLEFTS: a slot cut into the mesa at ground level from its south face, opening into a small chamber (a chest in it): pts = its axis from
// the mouth (just outside the face) in, hw = half its width, chamber {x, y, r}. The cut is a channel and a basin at 0 (walls: world.js
// rock along walls(c)); drawn CLEFT_IN wider, so the drawn ground's steep cells lie behind the rock, like the mesa's
const CLEFT_IN = .35;
export const CLEFTS = TERRAIN_ON ? [{pts: [[60.15, 11.85], [60.3, 10.6], [60.7, 9.6], [61.1, 9.0]], hw: .62, chamber: {x: 61.2, y: 8.55, r: 1.05}}] : [];
// a cleft's wall as one line (cliffs3d.js's way: the open floor on its right): up its west side, round the chamber's far side, down its
// east side
export function cleftWall(c) {
  const P = c.pts, n = P.length, side = (k, sg) => P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
    return [p[0] + ty * sg * k, p[1] - tx * sg * k];   // (sg 1: the left of the way in)
  });
  const W = side(c.hw, 1).slice(0, -1), E = side(c.hw, -1).slice(0, -1), C = c.chamber, ang = q => Math.atan2(q[1] - C.y, q[0] - C.x);
  let a0 = ang(W.at(-1)), a1 = ang(E.at(-1)); while (a1 <= a0) a1 += 2 * Math.PI;
  const ring = []; for (let k = 1; k < 12; k++) { const a = a0 + (a1 - a0) * k / 12; ring.push([C.x + Math.cos(a) * C.r, C.y + Math.sin(a) * C.r]); }
  return [...W, ...ring, ...E.reverse()];
}
// within m of a cleft's floor (the mesa's own rock stops at its mouth)
export const inCleft = (x, y, m = 0) => CLEFTS.some(c => { if (Math.hypot(x - c.chamber.x, y - c.chamber.y) < c.chamber.r + m) return true;
  for (let i = 0; i + 1 < c.pts.length; i++) { const [ax, ay] = c.pts[i], [bx, by] = c.pts[i + 1], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy))); if (Math.hypot(x - ax - vx * t, y - ay - vy * t) < c.hw + m) return true; }
  return false; });
// CLIMBS: where a cliff is climbed (a ladder). x, y = the middle of its foot on the face's line, nx, ny = the face's outward normal (you
// stand there to climb up), w = its width, h0 / h1 = the ground at its foot / the top, reach = how far in from the face the top's level
// ground starts (where the mantle puts him: the mesa's ground lies behind its rock, CLIFF_IN); yaw = the camera's yaw that looks
// straight at the face (the climb runs in the camera's frame at that yaw: sim/player/adapter.js eases the camera there)
export const CLIMBS = (TERRAIN_ON ? [{x: 51.5, y: 11.2, nx: 0, ny: 1, w: 1.2, h0: 0, h1: MESA_H, reach: .9}, {x: 66.3, y: 5.7, nx: 1, ny: 0, w: 1.2, h0: 0, h1: MESA_H, reach: .9}]
  : BOX.climbs.map(c => ({x: c.x, y: BOX.y1, nx: 0, ny: 1, w: c.w, h0: 0, h1: BOX.h, reach: .45}))).map(c => ({...c, yaw: Math.atan2(c.nx, c.ny)}));
// THE PROVING GROUNDS' TERRAIN (step 4). rock: true = its steep edges are 3D rock (world.js: cliffs3d.js runs along a terrace's
// edges, a ramp's sides); the rest are grass banks. Kept clear of the yard's props and the frontier's pads
const W_ = WORLD;
export const TERRAIN = !TERRAIN_ON ? [] : [
  // the meadows' low roll (the mask holds it flat round the arena, the water, the climbs, the ravine's rim and the pads)
  {type: 'swell', amp: .28, k: .16, seed: 5},
  // the world's borders rise in grass banks: behind the arena's north wall, along the west and east edges (not walkable: they frame
  // the grounds); behind the mesa, higher land
  // (with the West Downs the north bank starts at their east edge and theirs, wavy, take over west of it: westland.js BORDERS)
  // (the FOREST: the north bank along its own north edge, the whole width; the downs' north bank gone, a west bank of its own north of theirs)
  {type: 'terrace', pts: [[WEST_ON && !FOREST ? WEST.x1 : W_.x0 - 30, W_.y0 - 30], [W_.x1 + 30, W_.y0 - 30], [W_.x1 + 30, W_.y0 - .3], [WEST_ON && !FOREST ? WEST.x1 : W_.x0 - 30, W_.y0 - .3]], h: 1.4, bank: 3.2},
  ...(WEST_ON ? (FOREST ? WEST_BORDERS.slice(0, 1) : WEST_BORDERS) : [{type: 'terrace', pts: [[W_.x0 - 30, W_.y0 - 30], [W_.x0 - .3, W_.y0 - 30], [W_.x0 - .3, W_.y1 + 30], [W_.x0 - 30, W_.y1 + 30]], h: 1.2, bank: 3}]),
  ...(FOREST && WEST_ON ? [{type: 'terrace', pts: [[W_.x0 - 30, W_.y0 - 30], [W_.x0 - .3, W_.y0 - 30], [W_.x0 - .3, -6], [W_.x0 - 30, -6]], h: 1.2, bank: 3}] : []),
  {type: 'terrace', pts: [[W_.x1 + .3, W_.y0 - 30], [W_.x1 + 30, W_.y0 - 30], [W_.x1 + 30, W_.y1 + 30], [W_.x1 + .3, W_.y1 + 30]], h: 1.3, bank: 2.6},
  ...(FOREST ? [] : [{type: 'terrace', pts: [[45, -30], [69.5, -30], [69.5, 1.4], [45, 1.4]], h: 3.4, bank: 2}]),   // the highland (the forest's ground there instead)
  // the mesa, and the walk down its gully: a ramp from its top to the ground by the pool, beside the creek (its sides blend into the
  // gully's banks)
  {type: 'terrace', pts: MESA.pts, drawn: {pts: MESA.ground}, banks: MESA.banks, h: MESA_H, rock: true, cliffs: MESA.cliffs},
  {type: 'ramp', pts: [[49.9, 6.2], [48.5, 8.4], [47.6, 10.6], [47.4, 12.8]], w: 2.8, h0: MESA_H, h1: null, shoulder: 2.2},
  // the yard: a lookout terrace in the east, rock all round, stone steps up from the west (onto a landing level with its top: the
  // terrace is drawn in behind its rock), and the low shelves (LEDGES)
  ...LEDGES.map(L => ({type: 'terrace', pts: L.pts, drawn: {pts: L.ground}, banks: L.banks, h: L.h, rock: true, cliffs: L.cliffs})),
  {type: 'ramp', pts: [[53, 16], [56.65, 16]], w: 1.5, h0: 0, h1: 1.15, shoulder: .12, rock: true, steps: true},   // (h0 given: the stones' heights are the treads')
  {type: 'ramp', pts: [[56.65, 16], [57.4, 16]], w: 1.5, h0: 1.15, h1: 1.15, shoulder: .12, rock: true},
  // the clefts: cut down to the ground (their rock: world.js)
  ...CLEFTS.flatMap(c => [
    {type: 'channel', pts: c.pts, bed: c.pts.map(() => 0), hw: c.pts.map(() => c.hw), bank: .06, drawn: {hw: c.pts.map(() => c.hw + CLEFT_IN)}},
    {type: 'basin', x: c.chamber.x, y: c.chamber.y, rx: c.chamber.r, ry: c.chamber.r, h: 0, rim: .06, drawn: {rx: c.chamber.r + CLEFT_IN, ry: c.chamber.r + CLEFT_IN}}]),
  // hills where the sparring brutes live, and a knoll between the paths
  {type: 'hill', x: 47.8, y: 23.6, rx: 2.9, ry: 2.1, h: .75},
  {type: 'hill', x: 52.8, y: 24.6, rx: 2.2, ry: 1.6, h: .55},
  {type: 'hill', x: 49.6, y: 15.4, rx: 1.8, ry: 1.3, h: .45},
  // the west border: low mounds round the old foundations
  {type: 'hill', x: 1.6, y: 11.5, rx: 2.4, ry: 3.2, h: .5},
  {type: 'hill', x: 1.6, y: 26, rx: 2.2, ry: 2.4, h: .4},
  // the West Downs' rolling hills (westland.js)
  ...WEST_HILLS,
  ...STONE_TERRAIN,   // the standing stones' hill on the south-west (stonecircle.js; ?stones=0: westland.js's dome)
  ...(FOREST ? FOREST.shapes : []),   // the forest's relief, hills and the lake's basin (world/forest.js; its stream's cut is laid below)
  // the forest's outcrops and big boulders (forest.js OUTCROPS): terraces with rock where they drop, the ledges' way (mesaOutline)
  ...(FOREST ? FOREST.outcrops.map(o => { const M = mesaOutline(o.ctl); return {type: 'terrace', pts: M.pts, drawn: {pts: M.ground}, banks: M.banks, h: o.h, rock: true, cliffs: M.cliffs}; }) : []),
];
// PADS: things built at a fixed height that the ground must meet (features place them at 0): [x, y, r (held flat), fade]
const PADS = [[50.8, 19.4, 1.5, 1.2],   // the campfire and its woodpile (features/lights.js)
  // the desert's frontier pieces (features/frontier.js: built at 0): the windmill and its tank, the street, the wagon, the outhouse,
  // the water tower, the mine's mouth and its cart
  [35.6, 9.6, 2.2, 1], [35.9, 18.3, 2.6, 1], [35.6, 22.95, 1.6, 1], [5.2, 21.75, 1, 1], [58.45, 13.35, 1.8, 1], [54.5, 11.9, 1.6, 1]];
const _tm = {d: 0, a: 0, l: 0, hw: 0};
function terrainMask(x, y) {
  const fade = (d, w) => d <= 0 ? 0 : d >= w ? 1 : smooth(d / w);
  let m = fade(Math.max(PLAY.x0 - 3.2 - x, x - PLAY.x1 - 3.2, PLAY.y0 - 3.2 - y, y - PLAY.y1 - 3.2), 2);   // the arena
  if (m === 0) return 0;
  if (y > STREAM.y0 - 2 && y < STREAM.y1 + 2) m = Math.min(m, fade(Math.abs(x - STREAM.cx(y)) - STREAM.w(y) / 2 - 1.1, 1.6));   // the stream
  m = Math.min(m, fade(Math.hypot((x - POOL.x) / (POOL.rx + 1.2), (y - POOL.y) / (POOL.ry + 1.2)) - 1, .9));            // the pool
  outflowAt(x, y, _tm); if (_tm.d < 9) m = Math.min(m, fade(_tm.d - _tm.hw - .8, 1.2));                                // its outflow
  for (const c of CLIMBS) { if (c.hill) continue; const dx = x - c.x, dy = y - c.y, o = dx * c.nx + dy * c.ny, a = dy * c.nx - dx * c.ny; m = Math.min(m, fade(Math.max(Math.abs(a) - c.w / 2 - .9, o - 2.6, -o - .3), 1.2)); }   // the climbs' feet
  m = Math.min(m, fade(GROUNDS.y1 - 3.9 - y, 1.5));   // the ravine's rim
  for (const [px, py, r, f] of PADS) m = Math.min(m, fade(Math.hypot(x - px, y - py) - r, f));
  return m;
}
let FIELD = null, DRAWN = null;
export function terrainField() {   // baked on the first read (the shapes and the mask are this module's: no import order to mind)
  return FIELD ??= createField({bounds: {x0: WORLD.x0 - 8, y0: WORLD.y0 - 8, x1: WORLD.x1 + 8, y1: WORLD.y1 + 8}, shapes: TERRAIN, mask: terrainMask});
}
// the DRAWN ground's height (the ground mesh, its painter, its shadow): the field, but where a shape says how it is drawn (`drawn`: its
// own values for that, the mesa's outline drawn in behind its rock (CLIFF_IN), a cleft's cut wider) those. Walkers, props and
// everything else stand on the field (terrainField: its top runs to the rock's face); the drawn ground falls away under the rock's
// cap. A small second bake over those shapes only
export function groundDrawn() {
  if (DRAWN) return DRAWN;
  const F = terrainField(), own = TERRAIN.filter(s => s.drawn);
  if (!own.length) return (DRAWN = F.H);
  // the field's own lattice over those shapes, its values copied, re-worked only where a drawn shape differs from its walked one: near a
  // terrace's outline, along a cut's edges (most of the box is the same: the mesa's top, the open ground)
  const S = sampler(TERRAIN.map(s => s.drawn ? {...s, ...s.drawn} : s), terrainMask), c = F.cell, seg = [0, 0, 0, 0];
  const lineD = (x, y, P, closed) => { let d = 1e9; for (let i = 0, n = P.length; i < (closed ? n : n - 1); i++) { const [ax, ay] = P[i], [bx, by] = P[(i + 1) % n], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1))); d = Math.min(d, Math.hypot(x - ax - vx * t, y - ay - vy * t)); } return d; };
  const near = (s, x, y) => s.type === 'terrace' ? lineD(x, y, s.pts, true) < CLIFF_IN + Math.max(...s.banks.filter(b => b <= CLIFF_BANK), .12) + .6
    : s.type === 'channel' ? lineD(x, y, s.pts, false) < Math.max(...s.drawn.hw) + s.bank + .5
    : Math.hypot((x - s.x) / (s.drawn.rx + s.rim + .5), (y - s.y) / (s.drawn.ry + s.rim + .5)) < 1;
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  for (const s of own) for (const [x, y] of s.pts || [[s.x - s.rx, s.y - s.ry], [s.x + s.rx, s.y + s.ry]]) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  const i0 = Math.max(0, Math.floor((bx0 - 2 - F.x0) / c)), j0 = Math.max(0, Math.floor((by0 - 2 - F.y0) / c)), i1 = Math.min(F.nx - 1, Math.ceil((bx1 + 2 - F.x0) / c)), j1 = Math.min(F.ny - 1, Math.ceil((by1 + 2 - F.y0) / c));
  const W = i1 - i0 + 1, D = new Float32Array(W * (j1 - j0 + 1));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = F.x0 + i * c, y = F.y0 + j * c;
    D[(j - j0) * W + i - i0] = own.some(s => near(s, x, y)) ? S(x, y) : F.data[j * F.nx + i];
  }
  const X0 = F.x0 + i0 * c, Y0 = F.y0 + j0 * c, X1 = F.x0 + i1 * c, Y1 = F.y0 + j1 * c;
  return (DRAWN = (x, y) => {   // (bilinear on the same lattice: away from the edges it is the field exactly)
    if (x < X0 || y < Y0 || x >= X1 || y >= Y1) return F.H(x, y);
    const fx = (x - X0) / c, fy = (y - Y0) / c, ii = fx | 0, jj = fy | 0, u = fx - ii, v = fy - jj, k = jj * W + ii;
    const a = D[k], b = D[k + 1], d0 = D[k + W], d1 = D[k + W + 1];
    return a + (b - a) * u + (d0 - a) * v + (a - b - d0 + d1) * u * v;
  });
}
export const plateauAt = (x, y) => PLATEAUS.find(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) || null;
// on the mesa's top (terrain): inside its outline and level with it (not down the gully). False without terrain
export function mesaAt(x, y) {
  if (!MESA) return false;
  const P = MESA.pts; let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[j][1] > y) !== (P[i][1] > y) && x < (P[i][0] - P[j][0]) * (y - P[j][1]) / (P[i][1] - P[j][1]) + P[j][0]) inside = !inside;
  return inside && terrainField().H(x, y) > MESA.h - .06;
}

// ---- the plateau's water (river brief B, moved to the south face by B2; with terrain, the mesa's creek): a spring, a shallow rill across
// the top, a waterfall down the SOUTH face (terrain: the creek down the gully in cascades), a pool at its foot, an outflow to the river ----
// Plain data and functions (the sim: no randomness, nothing allocated per call). world.js waterSample says what the water does,
// biomes.js paints it, features read it from here. (The south face is the one the default camera looks at: a face on x = const has no
// width on screen at yaw 0, which is where B's west-face waterfall was lost.)
//   SPRING   where the water wells up: a round basin (r m) at the rill's head
//   RILL     the shallow stream from the spring west across the top, then south to the plateau's south edge near its south-west corner,
//            .5-.85 m wide. WADEABLE: not part of inStream (you walk through it; no slowdown yet). pts[i] = [x, y] every .1 m of x from
//            the spring (i 0) to the lip (the flow runs west: x falls as i grows), hw[i] = half the width there, len[i] = metres of rill
//            from the spring. It stays >= .6 m from every prop on the plateau and from the climb spot's arrival.
//            Terrain: the CREEK, west across the mesa's top and down its gully to the pool: pts every .1 m ALONG it (any direction),
//            hw, len as above; at(x, y, out) its lookup; box its reach; headL = metres from the spring to where it starts down; pace(l) its
//            speed (the shader's 1 = the river's); riffle(l, w) / foam(l) the white water that stays put (below a cascade, on its lip)
//   CASCADES (terrain) where the creek's bed steps down (a reach falls gently to a LIP, drops, the next reach starts lower): {l, x, y (the
//            sheet's foot, a little downstream of the lip), dx, dy (downstream), hw, top, bot (the water's height above and below), last}
//   FALL     where the rill goes over the south edge: the waterfall down the south face (x = its centre, y = the face line, hw = half its
//            width along the face, h = the drop); foot = where it lands in the pool. Terrain: the creek's last cascade, into the pool
//            (h = the height it falls from)
//   POOL     a rounded pool at the foot of the south face: an ellipse centred south of the face line (it meets the face at an obtuse
//            angle), clipped at the face (y < clip: the plateau's top is not water). DEEP: part of inStream. >= .4 m from the path's edge.
//            Terrain: at the gully's foot, clipped under the last cascade's lip
//   OUTFLOW  a shallow channel (.7-1.0 m wide) from the pool west to the stream's east bank, joining it north of the narrows. WADEABLE like
//            the rill (not part of inStream: the ledge north of it stays connected to the path). pts / hw / len as the rill's, from the pool
//            (i 0, x = x0) to a little inside the stream's band (x = x1); the flow runs west
export const SPRING = TERRAIN_ON ? {x: 62.2, y: 6.0, r: .46} : {x: 57, y: 6.85, r: .46};
// a curve y(x) through [x, y, half width] points (x strictly falling): cubic Hermite with each point's slope from its neighbours, sampled
// every dx m of x. pts / hw / len as above
function curve(ctl, dx = .1) {
  const m = ctl.map((c, i) => { const a = ctl[Math.max(0, i - 1)], b = ctl[Math.min(ctl.length - 1, i + 1)]; return (b[1] - a[1]) / (b[0] - a[0]); });
  const x0 = ctl[0][0], x1 = ctl[ctl.length - 1][0], n = Math.round((x0 - x1) / dx), pts = [], hw = [], len = [0];
  for (let i = 0, k = 0; i <= n; i++) {
    const x = i === n ? x1 : x0 - i * dx;
    while (k < ctl.length - 2 && x < ctl[k + 1][0]) k++;
    const a = ctl[k], b = ctl[k + 1], w = b[0] - a[0], t = Math.max(0, Math.min(1, (x - a[0]) / w)), t2 = t * t, t3 = t2 * t;
    pts.push([x, (2 * t3 - 3 * t2 + 1) * a[1] + (t3 - 2 * t2 + t) * m[k] * w + (3 * t2 - 2 * t3) * b[1] + (t3 - t2) * m[k + 1] * w]);
    hw.push(a[2] + (b[2] - a[2]) * t2 * (3 - 2 * t));
    if (i) len.push(len[i - 1] + Math.hypot(x - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return {pts, hw, len, dx, x0, x1, lo: null, hi: null};
}
// lo[i] / hi[i]: the y band within which something within hw + .5 m of the curve can lie, for a point whose x index is i (the window of win samples
// either side): curveAt leaves anything outside it alone, which is most of the bounding box
function bands(C, win) {
  const n = C.pts.length, m = Math.max(...C.hw) + .5; C.lo = new Float32Array(n); C.hi = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 1e9, b = -1e9; for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { a = Math.min(a, C.pts[j][1]); b = Math.max(b, C.pts[j][1]); } C.lo[i] = a - m; C.hi[i] = b + m; }
  return C;
}
// out.d = metres to the curve's axis, out.a = across it (signed: + = to the left of the flow, the south of a westward one), out.l =
// metres along it from its start to the nearest point, out.hw = half the width there. True in the water. Its ends are round caps.
// win = how many samples either side of the x index to test (steeper stretches need more)
function curveAt(C, win, x, y, out) {
  out.d = 1e9; out.a = 0; out.l = 0; out.hw = 0;
  const P = C.pts, H = C.hw, L = C.len, n = P.length - 1, c = Math.max(0, Math.min(n, Math.round((C.x0 - x) / C.dx)));
  if (y < C.lo[c] || y > C.hi[c]) return false;
  for (let j = Math.max(0, c - win), e = Math.min(n - 1, c + win - 1); j <= e; j++) {
    const ax = P[j][0], ay = P[j][1], vx = P[j + 1][0] - ax, vy = P[j + 1][1] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy))), px = ax + vx * t, py = ay + vy * t, d = Math.hypot(x - px, y - py);
    if (d < out.d) { out.d = d; out.l = L[j] + (L[j + 1] - L[j]) * t; out.hw = H[j] + (H[j + 1] - H[j]) * t; out.a = vx * (y - py) - vy * (x - px) < 0 ? d : -d; }
  }
  return out.d < out.hw;
}
// a path through [x, y, half width] points in ANY direction (the creek turns down the gully): Catmull-Rom through the points, the width
// eased between them, resampled every ds m along it. pts / hw / len as curve()'s (len[i] = i ds), box = its reach (x0, y0, x1, y1:
// hw + .6 m round it); at(x, y, out) as curveAt, its start a round cap, its END square (nothing past the last point: the lip). The
// segments near each 1 m cell are listed once, so a lookup tests a few of them
function path(ctl, ds = .1) {
  const dense = [];
  for (let k = 0; k + 1 < ctl.length; k++) {
    const p0 = ctl[Math.max(0, k - 1)], p1 = ctl[k], p2 = ctl[k + 1], p3 = ctl[Math.min(ctl.length - 1, k + 2)];
    for (let i = 0; i < 48; i++) {
      const t = i / 48, t2 = t * t, t3 = t2 * t, cr = (a, b, c, d) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      dense.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), p1[2] + (p2[2] - p1[2]) * t2 * (3 - 2 * t)]);
    }
  }
  dense.push(ctl.at(-1));
  const pts = [[dense[0][0], dense[0][1]]], hw = [dense[0][2]], len = [0];
  for (let i = 1, run = 0; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let next = len.length * ds; next <= run + l + 1e-9; next = len.length * ds) {
      const t = l > 0 ? (next - run) / l : 0;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); hw.push(a[2] + (b[2] - a[2]) * t); len.push(next);
    }
    run += l;
    if (i === dense.length - 1 && run - len.at(-1) > ds * .25) { pts.push([b[0], b[1]]); hw.push(b[2]); len.push(run); }   // (the very end)
  }
  const m = Math.max(...hw) + .6; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x - m); y0 = Math.min(y0, y - m); x1 = Math.max(x1, x + m); y1 = Math.max(y1, y + m); }
  const gx0 = Math.floor(x0), gy0 = Math.floor(y0), gw = Math.ceil(x1) - gx0, gh = Math.ceil(y1) - gy0, cells = Array.from({length: gw * gh}, () => []);
  for (let j = 0; j + 1 < pts.length; j++) {
    const ax = Math.min(pts[j][0], pts[j + 1][0]) - m, bx = Math.max(pts[j][0], pts[j + 1][0]) + m, ay = Math.min(pts[j][1], pts[j + 1][1]) - m, by = Math.max(pts[j][1], pts[j + 1][1]) + m;
    for (let cy = Math.max(0, Math.floor(ay) - gy0); cy <= Math.min(gh - 1, Math.floor(by) - gy0); cy++)
      for (let cx = Math.max(0, Math.floor(ax) - gx0); cx <= Math.min(gw - 1, Math.floor(bx) - gx0); cx++) cells[cy * gw + cx].push(j);
  }
  const C = {pts, hw, len, ds, box: [x0, y0, x1, y1]};
  C.at = (x, y, out) => {
    out.d = 1e9; out.a = 0; out.l = 0; out.hw = 0;
    const cx = Math.floor(x) - gx0, cy = Math.floor(y) - gy0; if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return false;
    let end = false;
    for (const j of cells[cy * gw + cx]) {
      const ax = pts[j][0], ay = pts[j][1], vx = pts[j + 1][0] - ax, vy = pts[j + 1][1] - ay, u = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy);
      const t = Math.max(0, Math.min(1, u)), px = ax + vx * t, py = ay + vy * t, d = Math.hypot(x - px, y - py);
      if (d < out.d) { out.d = d; out.l = len[j] + (len[j + 1] - len[j]) * t; out.hw = hw[j] + (hw[j + 1] - hw[j]) * t; out.a = vx * (y - py) - vy * (x - px) < 0 ? d : -d; end = j === pts.length - 2 && u > 1; }
    }
    return out.d < out.hw && !end;
  };
  return C;
}
// the creek (terrain): from the spring at the mesa's east end, west across its top (clear of the chest, the pots and the ladders' tops),
// then down the gully's west half (the walk is its east half) to the lip over the pool
const CREEK_CTL = [[62.2, 6.0, .46], [60.9, 6.5, .27], [59.0, 6.75, .3], [57.0, 7.4, .33], [55.0, 7.7, .35], [53.0, 7.2, .36], [51.2, 6.5, .37],
  [49.6, 6.4, .38], [48.4, 7.2, .36], [47.4, 8.6, .34], [46.5, 10.0, .35], [46.1, 10.8, .37], [45.95, 11.35, .4]];
const RILL_CTL = [[57, 6.85, .46], [56, 7.05, .27], [54.8, 7.55, .3], [53.4, 7.45, .33], [52, 6.95, .36], [50.6, 6.85, .38], [49.2, 7.35, .38],
  [47.8, 8, .37], [46.5, 8.9, .38], [45.5, 9.8, .4], [44.85, 10.4, .41], [44.58, 10.78, .4], [44.5, BOX.y1, .4]];   // [x, y, half width]
let CASC_L = [], HEAD_L = 1e9;   // (terrain: the lips' l and where the gully starts, once the bed is worked out below)
const nearLip = (l, a, b) => { for (let k = 0; k < CASC_L.length; k++) if (l > CASC_L[k] - a && l < CASC_L[k] + b) return true; return false; };
export const RILL = TERRAIN_ON ? Object.assign(path(CREEK_CTL), {
  pace: l => .5 + 1.2 * smooth(Math.max(0, Math.min(1, (l - HEAD_L + .6) / 1.2))),
  foam: l => nearLip(l, .08, .04) ? .8 : nearLip(l, -.04, .4) ? .5 : 0,   // (the share of white: on a lip, in the churn below it)
  riffle: l => nearLip(l, .1, .4),
}) : Object.assign(bands(curve(RILL_CTL), 9), {riffle: (l, w) => w < .3 && l > 1.2});   // riffle(l, hw): the narrow stretches, where the water breaks white and stays put
if (!TERRAIN_ON) Object.assign(RILL, {box: [RILL.x1 - .6, 5.8, RILL.x0 + .6, BOX.y1], at: (x, y, out) => curveAt(RILL, 9, x, y, out)});
// rillAt(x, y, out): see curveAt; false off the plateau's top (the rill ends at the south edge; the creek at the lip of its last cascade)
export function rillAt(x, y, out) {
  const B = RILL.box;
  if (x < B[0] || x > B[2] || y < B[1] || y > B[3]) { out.d = 1e9; out.a = 0; out.l = 0; out.hw = 0; return false; }
  return RILL.at(x, y, out);
}
const _rill = {d: 0, a: 0, l: 0, hw: 0};
export const inRill = (x, y) => rillAt(x, y, _rill);
const _end = RILL.pts[RILL.pts.length - 1], _prev = RILL.pts[RILL.pts.length - 2], _slope = Math.abs((_end[1] - _prev[1]) / (_end[0] - _prev[0]));
// (terrain: FALL's x, y, h are the last cascade's, set with the bed below; the pool is clipped .15 m past its lip)
export const FALL = TERRAIN_ON ? {x: _end[0], y: _end[1] + .12, hw: RILL.hw.at(-1) + .03, h: 0, foot: {x: _end[0], y: _end[1] + .4}}
  : {x: _end[0], y: BOX.y1, hw: RILL.hw[RILL.hw.length - 1] * Math.hypot(1, 1 / _slope), h: BOX.h, foot: {x: _end[0], y: BOX.y1 + .2}};
export const POOL = TERRAIN_ON ? {x: _end[0] - .2, y: _end[1] + .78, rx: 1.05, ry: .75, clip: _end[1] + .15} : {x: 44.5, y: 11.4, rx: 1.1, ry: .75, clip: BOX.y1};
// in the pool (ext widens the clip: world.js lowers the ground mesh's vertex ON the face's line too, so no gap shows at the foot; grow = metres the
// ellipse is grown by, for the same: the lowered vertices then cover the whole painted pool, so its outline is drawn as painted, not as the coarse mesh)
export const inPool = (x, y, ext = 0, grow = 0) => {
  const rx = POOL.rx + grow, ry = POOL.ry + grow;
  if (y < POOL.clip - ext || y > POOL.y + ry || x < POOL.x - rx || x > POOL.x + rx) return false;
  const u = (x - POOL.x) / rx, v = (y - POOL.y) / ry;
  return u * u + v * v < 1;
};
// metres from (x, y) to the pool's edge (first order; + inside, - outside), the face counting as an edge
export const poolEdge = (x, y) => {
  const u = (x - POOL.x) / POOL.rx, v = (y - POOL.y) / POOL.ry, rho = Math.hypot(u, v), g = Math.hypot(u / POOL.rx, v / POOL.ry);
  return Math.min(y - POOL.clip, g > 1e-6 ? (1 - rho) * rho / g : POOL.ry);
};
const OUT_CTL = TERRAIN_ON ? [[45.0, 12.3, .38], [43.9, 12.45, .4], [42.8, 12.68, .42], [41.7, 12.85, .45], [40.2, 12.85, .5]]
  : [[44.2, 11.5, .38], [43.3, 11.58, .4], [42.4, 11.85, .42], [41.6, 11.98, .45], [40.5, 11.9, .5]];
export const OUTFLOW = bands(curve(OUT_CTL), 6);
const OUT_Y = TERRAIN_ON ? [Math.min(...OUTFLOW.lo), Math.max(...OUTFLOW.hi)] : [11, 13.4];   // (the y it can reach)
// outflowAt(x, y, out): see curveAt; out.l = metres from the pool end
export function outflowAt(x, y, out) {
  if (x < OUTFLOW.x1 - .6 || x > OUTFLOW.x0 + .6 || y < OUT_Y[0] || y > OUT_Y[1]) { out.d = 1e9; out.a = 0; out.l = 0; out.hw = 0; return false; }
  return curveAt(OUTFLOW, 6, x, y, out);
}
export const inOutflow = (x, y) => outflowAt(x, y, _rill);

// ---- the creek's bed (terrain): cut into the ground it runs over (a channel shape), level on the mesa's top, then down the gully in
// steps: a reach falling gently (REACH m per m) to a LIP, a drop (a cascade) into the next reach, the last into the pool. Worked out from
// the ground the shapes make before the cut (terrain.js sampler): every lip lies DEPTH under its banks and no reach rises above them.
// The pool's hollow and the outflow's bed are cut too (both at 0: the mask holds the ground round them flat)
export const CASCADES = [];
const POOL_WATER = -.18;   // the pool's water under the ground (world.js WATER_H)
if (TERRAIN_ON) {
  const G = sampler(TERRAIN, terrainMask), P = RILL.pts, L = RILL.len, n = P.length, DEPTH = .06, REACH = .07, STEP = 1.15;
  const g = P.map(([x, y]) => G(x, y) - DEPTH), at = l => Math.min(n - 1, Math.round(l / RILL.ds));
  let head = 0; while (head < n - 1 && g[head] > g[0] - .05) head++;   // where the ground starts down the gully
  HEAD_L = RILL.headL = L[head];
  for (let l = HEAD_L + .3; l < L[n - 1] - .55; l += STEP) CASC_L.push(l);
  CASC_L.push(L[n - 1]);
  const lip = CASC_L.map(at), bed = new Float32Array(n);
  for (let i = 0; i <= lip[0]; i++) bed[i] = i ? Math.min(g[i], bed[i - 1]) : g[0];
  for (let k = 0; k + 1 < lip.length; k++) { const e = lip[k + 1]; for (let i = lip[k] + 1; i <= e; i++) bed[i] = Math.min(g[i], g[e] + REACH * (L[e] - L[i]), bed[i - 1]); }
  lip.forEach((i, k) => {
    const last = k === lip.length - 1, a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / tl, dy = (b[1] - a[1]) / tl;
    CASCADES.push({l: L[i], x: P[i][0] + dx * .12, y: P[i][1] + dy * .12, dx, dy, hw: RILL.hw[i] + .03, top: bed[i], bot: last ? POOL_WATER : bed[i + 1], last});
  });
  const F = CASCADES.at(-1); FALL.x = F.x; FALL.y = F.y; FALL.h = F.top; FALL.foot.x = F.x; FALL.foot.y = POOL.clip + .25;
  // a footbridge across the creek in the gully, between its third and fourth cascades: from the walk (east) to the west slope, its ends
  // 1.05 m out from the creek's axis on the ground the creek is cut into
  { const i = at((CASC_L[2] + CASC_L[3]) / 2), a = P[Math.max(0, i - 2)], b = P[Math.min(n - 1, i + 2)], tl = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = (b[1] - a[1]) / tl, ny = -(b[0] - a[0]) / tl;
    const A = [P[i][0] - nx * 1.05, P[i][1] - ny * 1.05], Bq = [P[i][0] + nx * 1.05, P[i][1] + ny * 1.05], len = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), w = .95;
    BRIDGES.push({a: A, b: Bq, w, len, ux: (Bq[0] - A[0]) / len, uy: (Bq[1] - A[1]) / len, h0: G(A[0], A[1]) + .04, h1: G(Bq[0], Bq[1]) + .04, arch: .1,
      box: [Math.min(A[0], Bq[0]) - w, Math.min(A[1], Bq[1]) - w, Math.max(A[0], Bq[0]) + w, Math.max(A[1], Bq[1]) + w]}); }
  // the cut: every third sample, and both sides of every drop
  const keep = []; for (let i = 0; i < n; i++) if (i % 3 === 0 || i === n - 1 || lip.includes(i) || lip.includes(i - 1)) keep.push(i);
  TERRAIN.push({type: 'channel', pts: keep.map(i => P[i]), bed: keep.map(i => bed[i]), hw: keep.map(i => RILL.hw[i] + .08), bank: .45},
    {type: 'basin', x: POOL.x, y: POOL.y, rx: POOL.rx + .3, ry: POOL.ry + .3, h: 0, rim: .35, clip: POOL.clip - .05, clipRim: .1},
    {type: 'channel', pts: OUTFLOW.pts.filter((p, i) => i % 3 === 0), bed: OUTFLOW.pts.filter((p, i) => i % 3 === 0).map(() => 0), hw: OUTFLOW.hw.filter((p, i) => i % 3 === 0).map(w => w + .1), bank: .5});
}
// ---- the West Downs' BROOK (brook.js; ?brook=0: none): its bed worked out from the ground it is cut into, its cuts, its bridge's deck and
// its stepping stones (decks: elev, steep)
if (BROOK) { layBrook(sampler(TERRAIN, terrainMask)); TERRAIN.push(...BROOK.shapes); BRIDGES.push(...BROOK.decks); }
// ---- the FOREST's stream (forest.js): its bed from the ground it is cut into, then the cut
if (FOREST) { layForest(FOREST, sampler(TERRAIN, terrainMask)); TERRAIN.push(...FOREST.cuts); }

// ---- THE WATCHTOWER on the West Downs' western hill (westland.js TOWER, world/watchtower.js; ?tower=0: none): its plan on the ground the
// shapes make (the terrain field, before any deck), its lookout a deck over its whole footprint (elev: from below the tower is solid,
// on top the floor; drawn by its own mesh, not as a bridge), a ladder up its south face into the breach (a climb: the camera turns to
// face it; the hill in front of it keeps its slope: terrainMask). buildLayout adds its colliders and the prop that carries its mesh
export const TOWER_PLAN = TOWER && TERRAIN_ON ? towerPlan(TOWER, sampler(TERRAIN, terrainMask)) : null;
if (TOWER_PLAN) { BRIDGES.push(TOWER_PLAN.deck); CLIMBS.push(TOWER_PLAN.climb); }

export function buildLayout(seed = 7) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const props = [], marks = [], lights = [];
  const add = (kind, x, y, extra = {}) => { const p = {kind, x, y, variant: 0, ...extra}; p.z = elev(x, y); props.push(p); return p; };
  const {x0, y0, x1, y1} = PLAY, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

  // ---- border walls, 1 m segments, a 3 m gate in the middle of each side ----
  // north wall + side walls are full height; the SOUTH wall is low (the camera looks over it at the player)
  const gate = (a, mid) => Math.abs(a - mid) < 1.5;
  for (let x = x0; x < x1; x++) {
    if (!gate(x + .5, cx)) add('wall_n', x + .5, y0 - .25, {rect: [x, y0 - .5, x + 1, y0]});
    if (!gate(x + .5, cx)) add('wall_s', x + .5, y1 + .25, {rect: [x, y1, x + 1, y1 + .5]});
  }
  for (let y = y0; y < y1; y++) {
    if (!gate(y + .5, cy)) add('wall_w', x0 - .25, y + .5, {rect: [x0 - .5, y, x0, y + 1]});
    if (!gate(y + .5, cy)) add('wall_e', x1 + .25, y + .5, {rect: [x1, y, x1 + .5, y + 1]});
  }
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) add('tower', x, y, {r: .7});
  // the walls as RUNS for world/walls3d.js (?walls=old: the kit's 1 m segments): its line, full height, thickness, how much of it is
  // broken (ruin) and the stretches it keeps whole (keep: m along it from a). Each 1 m segment above stays the wall's logic (collision,
  // arrows, perches, sounds); world.js gives it its piece of the run as its mesh. The NORTH wall (the range lane's backdrop): two runs
  // from the corner towers to the gate's posts, broken in their middles, whole by the towers and by the gate (its torches and banners
  // hang there: features/lights.js, wind.js)
  // The WEST wall: whole by the west gate (its sconces, lights.js: cy +- 2.6), broken toward the south-west tower, which fell. The
  // EAST wall, the trail's face (its banners outside at cy +- 2.6, wind.js; torches inside at cy - 3.2 and cy + 5.4): mostly whole.
  // The SOUTH wall stays low (the camera looks over it), broken here and there. TOWERS (type 'tower', at a tower prop): the north-east
  // nearly whole, the north-west and south-east broken round their parapets, the south-west fallen to a stump, its stones out over
  // the corner; GATEPOSTS (type 'post'): the west gate's south one broken, its capstone at its foot
  const walls = [
    {kind: 'wall_n', a: [x0, y0 - .25], b: [cx - 1, y0 - .25], h: 2.4, d: .5, ruin: .55, keep: [[0, 1.3], [cx - 1 - x0 - 3.2, 99]], seed: 31},
    {kind: 'wall_n', a: [cx + 1, y0 - .25], b: [x1, y0 - .25], h: 2.4, d: .5, ruin: .55, keep: [[0, 3], [x1 - cx - 1 - 1.3, 99]], seed: 37},
    {kind: 'wall_w', a: [x0 - .25, y0], b: [x0 - .25, cy - 1], h: 2.4, d: .5, ruin: .6, keep: [[0, 1.3], [cy - 1 - y0 - 3.4, 99]], seed: 41},
    {kind: 'wall_w', a: [x0 - .25, cy + 1], b: [x0 - .25, y1], h: 2.4, d: .5, ruin: .7, keep: [[0, 3]], seed: 43},
    {kind: 'wall_e', a: [x1 + .25, y0], b: [x1 + .25, cy - 1], h: 2.4, d: .5, ruin: .45, keep: [[0, 1.3], [cy - 1 - y0 - 4.3, 99]], seed: 47},
    {kind: 'wall_e', a: [x1 + .25, cy + 1], b: [x1 + .25, y1], h: 2.4, d: .5, ruin: .45, keep: [[0, 3], [3.6, 5.2], [y1 - cy - 1 - 1.3, 99]], seed: 53},
    {kind: 'wall_s', a: [x0, y1 + .25], b: [cx - 1, y1 + .25], h: .9, d: .5, ruin: .6, keep: [[cx - 1 - x0 - 1.5, 99]], seed: 59},
    {kind: 'wall_s', a: [cx + 1, y1 + .25], b: [x1, y1 + .25], h: .9, d: .5, ruin: .5, keep: [[0, 1.5], [x1 - cx - 1 - 1.3, 99]], seed: 61},
    {type: 'tower', at: [x0, y0], S: 1.5, h: 3, d: .42, ruin: .45, seed: 71}, {type: 'tower', at: [x1, y0], S: 1.5, h: 3, d: .42, ruin: .15, seed: 73},
    {type: 'tower', at: [x1, y1], S: 1.5, h: 3, d: .42, ruin: .55, seed: 79}, {type: 'tower', at: [x0, y1], S: 1.5, h: 3, d: .42, stump: 1.25, out: [-.7, .7], seed: 83},
    ...[[cx - 1.6, y0], [cx + 1.6, y0], [cx - 1.6, y1], [cx + 1.6, y1], [x0, cy - 1.6], [x0, cy + 1.6], [x1, cy - 1.6], [x1, cy + 1.6]]
      .map((at, i) => ({type: 'post', at, S: .72, h: 2.6, broken: i === 5, seed: 91 + i})),
  ];
  for (const [x, y] of [[cx - 1.6, y0], [cx + 1.6, y0], [cx - 1.6, y1], [cx + 1.6, y1], [x0, cy - 1.6], [x0, cy + 1.6], [x1, cy - 1.6], [x1, cy + 1.6]])
    add('gatepost', x, y, {r: .35});

  // ---- centre: movement ring (kept clear) ----
  marks.push({type: 'ring', x: cx, y: cy + .5, r: 4.5});

  // ---- north: range lane. Stand on the mark, dummies at 4 / 8 / 12 m to the east; a rail dummy for leading ----
  const lane = {x: x0 + 3, y: y0 + 2.6};
  marks.push({type: 'mark', x: lane.x, y: lane.y});
  marks.push({type: 'lane', x0: lane.x, y: lane.y, x1: lane.x + 13, ticks: [4, 8, 12]});
  for (const d of [4, 8, 12]) add('dummy', lane.x + d, lane.y, {r: .3, wob: 0, target: true});
  const rail = {x0: x1 - 9, x1: x1 - 1.5, y: y0 + 1.1};
  marks.push({type: 'rail', x0: rail.x0, x1: rail.x1, y: rail.y});
  add('dummy', rail.x0, rail.y, {r: 0, wob: 0, target: true, rail: {...rail, speed: 2.2, dir: 1}});

  // ---- west: pillar grove (walk behind tall things: occlusion, y-sorting, collision, cover) ----
  for (const [x, y] of [[x0 + 2.2, cy - 2.5], [x0 + 4.6, cy - .8], [x0 + 2.0, cy + 1.6], [x0 + 4.9, cy + 3.4], [x0 + 2.6, cy + 5.2]])
    add('pillar', x, y, {r: .45, occluder: true});
  add('pillar_broken', x0 + 6.4, cy + 1.2, {r: .45});
  add('rubble', x0 + 5.8, cy + 2.2);

  // ---- east: light garden. A dark pocket ringed by light sources of different colours ----
  const lg = {x: x1 - 3.8, y: cy + 1.2};
  marks.push({type: 'pad', x: lg.x, y: lg.y, r: 2.4});
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
    add('brazier', lg.x + Math.cos(a) * 2.4, lg.y + Math.sin(a) * 2.4 * .8, {r: .35, light: i});
  }
  // wall torches on the east wall: in a sconce whose stick stands SCONCE_D off the wall face (lights.js mounts them)
  add('torch', x1 - SCONCE_D, cy - 3.2, {r: 0});
  add('torch', x1 - SCONCE_D, cy + 5.4, {r: 0});

  // ---- south: deco strip + a column of dummies straight south of the ring (shots toward / away from camera) ----
  for (const x of [cx - 3, cx, cx + 3]) add('dummy', x, y1 - 1.6, {r: .3, wob: 0, target: true});
  // (plants are soft: bushes, small rocks and tufts have no collider; you walk through them)
  for (let i = 0; i < 7; i++) add(rnd() < .5 ? 'bush' : 'rock', x0 + 1 + rnd() * 5, y1 - .8 - rnd() * 2.4, {r: 0, variant: rnd() * 3 | 0});
  for (let i = 0; i < 6; i++) add(rnd() < .5 ? 'bush' : 'rock', x1 - 6 + rnd() * 5, y1 - .8 - rnd() * 2, {r: 0, variant: rnd() * 3 | 0});

  // ---- small scatter inside (no collision) ----
  for (let i = 0; i < 26; i++) {
    const x = x0 + .8 + rnd() * (x1 - x0 - 1.6), y = y0 + .8 + rnd() * (y1 - y0 - 1.6);
    if (Math.hypot(x - cx, (y - cy - .5)) < 5.2) continue;      // keep the ring clear
    add('tuft', x, y, {variant: rnd() * 3 | 0});
  }

  // ================= the trail (east of the arena) =================
  // path out of the east gate to the narrows; after the stream it forks north (climb spot) and south (yard)
  const path = TERRAIN_ON ? [[x1 + .5, cy], [38.2, cy], [41.8, cy], [44.6, 14.4], [47.8, 13.4], [51.5, 11.95]]   // (past the pool, by the gully's foot)
    : [[x1 + .5, cy], [38.2, cy], [41.8, cy], [45, 13.4], [51.5, 11.8]];
  marks.push({type: 'path', pts: path, w: 1.6});
  marks.push({type: 'path', pts: [[41.8, cy], [46, 18.5], [50, 21]], w: 1.4});
  const wantsClear = (x, y) => path.some(([px, py]) => Math.hypot(x - px, y - py) < 1.4);

  // breakables: hp = hits of ~10 damage; `breakable` = what it is; biome paints `stage` 0 intact / 1 damaged / 2 broken
  const brk = (type, x, y, hp, extra = {}) => add(type, x, y, {breakable: type, hp, maxHp: hp, stage: 0, r: extra.r ?? .32, ...extra});
  // plateau top: chest (interact), pots, a crystal cluster, all reached by the climb
  add('chest', 55.5, 5.4, {r: .45, interact: 'open', opened: false});
  for (const [x, y] of [[49, 4.6], [49.7, 4.2], [58.2, 8.4]]) brk('pot', x, y, 10, {r: .22});
  brk('crystal', TERRAIN_ON ? 47.4 : 46, TERRAIN_ON ? 4 : 6, 40, {r: .4});   // (terrain: the gully's head is where it stood)
  for (const c of CLEFTS) add('chest', c.chamber.x + .15, c.chamber.y - .3, {r: .45, interact: 'open', opened: false});   // (in the cleft's chamber)
  if (TERRAIN_ON) {   // at the gully's head: knock one over and it rolls down the gully (combat/props.js: a lying barrel rolls downhill)
    brk('barrel', 50.6, 5.5, 25, {r: .3});
    brk('barrel_x', 51.3, 5.1, 10, {r: .3, explode: {r: 2.4, dmg: 40}});
  }
  add('tree', 59, 3.6, {variant: 1, r: .5});   // a lone tree on the plateau
  // yard below the cliff
  for (const [x, y] of [[46.2, 14.2], [46.9, 14.6], [46.5, 15.3]]) brk('crate', x, y, 20);
  for (const [x, y] of [[55, 14.3], [55.6, 14.9]]) brk('barrel', x, y, 25, {r: .3});
  for (const [x, y] of [[49, 17], [49.5, 17.5], TERRAIN_ON ? [52.45, 17.05] : [52.8, 16.4], [44.6, 21.5], [45.1, 22.1]]) brk('pot', x, y, 10, {r: .22});   // (terrain: one pot steps aside off the foot of the lookout's steps)
  for (const [x, y] of [[53.6, 19.2], [55.3, 18.2], [57.6, 16.9]]) brk('barrel_x', x, y, 10, {r: .3, explode: {r: 2.4, dmg: 40}});   // explosive, spaced to chain
  for (const [x, y] of [[54.4, 17.2], [56.2, 17.6]]) brk('crate', x, y, 20);   // caught in the blast
  // a crate wall across the SE corner; the cache behind it is only reachable by breaking through
  for (let y = 21.6; y <= 27.4; y += .8) brk('crate', 55.2, y, 20, {r: .38, wall: true});
  for (let x = 55.2 + .8; x <= 59.6; x += .8) brk('crate', x, 21.6, 20, {r: .38, wall: true});
  if (TERRAIN_ON) for (let y = 21.6; y <= 27.4; y += .8) brk('crate', 60.4, y, 20, {r: .38, wall: true});   // (the grown world: land east of it too)
  add('chest', 58, 25.5, {r: .45, interact: 'open', opened: false});
  brk('crate', 57, 24, 20); brk('pot', 59, 23.6, 10, {r: .22});
  // sparring dummies: hop toward the player once hit or when close, knock back on contact, respawn when broken
  add('brute', 51, 23.5, {r: .35, hp: 60, maxHp: 60, target: true, sparring: true, home: [51, 23.5]});
  add('brute', 48, 25.5, {r: .35, hp: 60, maxHp: 60, target: true, sparring: true, home: [48, 25.5]});
  // trail scatter: bushes / rocks / tufts, kept off the paths and the water
  for (let i = 0; i < 40; i++) {
    const x = TRAIL.x0 + 1 + rnd() * (TRAIL.x1 - TRAIL.x0 - 2), y = TRAIL.y0 + .5 + rnd() * (TRAIL.y1 - TRAIL.y0 - 1);
    if (inStream(x, y) || Math.abs(x - STREAM.cx(y)) < STREAM.w(y) / 2 + .5 || wantsClear(x, y) || props.some(p => Math.hypot(p.x - x, p.y - y) < 1)) continue;
    if (TERRAIN_ON ? steep(x - .6, y) || steep(x + .6, y) || steep(x, y - .6) || steep(x, y + .6) : onGround(x, y) && y < 12 && x > 42.5) continue;   // right under (or on) a cliff's lip
    const k = rnd(); add(k < .45 ? 'tuft' : k < .75 ? 'bush' : 'rock', x, y, {variant: rnd() * 3 | 0, r: 0});   // (soft)
  }

  // ---- surroundings outside the walls and the trail, over the Proving Grounds (unreachable; big shapes that set the biome mood) ----
  const WM = GROUNDS.x1 - GROUNDS.x0, HM = GROUNDS.y1 - GROUNDS.y0;
  for (let i = 0; i < 110; i++) {
    const x = GROUNDS.x0 + rnd() * WM, y = GROUNDS.y0 + rnd() * HM;
    if (x > x0 - 1.5 && x < x1 + 1.5 && y > y0 - 1.5 && y < y1 + 1.5) continue;
    if (x > TRAIL.x0 - 1 && x < TRAIL.x1 + 1 && y > TRAIL.y0 - 1.2 && y < TRAIL.y1 + 1) continue;
    if (Math.abs(x - STREAM.cx(y)) < STREAM.w(y) / 2 + .6) continue;
    add(rnd() < .55 ? 'tree' : 'rock_big', x, y, {variant: rnd() * 3 | 0, outside: true});
  }

  // ---- the plateau's spring (river brief B). Added last, so no random draw and no earlier prop depends on it. Soft scatter that
  // landed in the water (the rill, the spring's basin, the pool and a hand of margin) is taken out; three stones stand round the spring
  const wet = p => {
    rillAt(p.x, p.y, _rill); if (_rill.d < _rill.hw + .4) return true;
    if (Math.hypot(p.x - SPRING.x, p.y - SPRING.y) < SPRING.r + .55) return true;
    outflowAt(p.x, p.y, _rill); if (_rill.d < _rill.hw + .35) return true;
    const u = (p.x - POOL.x) / (POOL.rx + .35), v = (p.y - POOL.y) / (POOL.ry + .35); return p.y >= POOL.clip && u * u + v * v < 1;
  };
  for (let i = props.length - 1; i >= 0; i--) { const p = props[i]; if (!p.outside && !(p.r > 0) && (p.kind === 'tuft' || p.kind === 'bush' || p.kind === 'rock') && wet(p)) props.splice(i, 1); }
  for (const [x, y, v] of TERRAIN_ON ? [[.75, -.6, 0], [.7, .65, 1], [-.55, -.65, 2]].map(([dx, dy, v]) => [SPRING.x + dx, SPRING.y + dy, v])
    : [[57.75, 6.25, 0], [57.7, 7.5, 1], [56.45, 6.2, 2]]) add('rock', x, y, {r: 0, variant: v});
  // ---- the West Downs (westland.js): their oaks, boulders, bushes and pillars (added last: no random draw above moves). The strip
  // between the downs and the arena's west wall became walkable: the trees and rocks standing there (unreachable surroundings
  // before) are solid now, and those on the west road's line out of the gate are taken away
  if (WEST_ON) {
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i]; if (!p.outside || p.x > PLAY.x0 - 1.5 || p.y < DOWNS.y0 || p.y > DOWNS.y1 + 1) continue;
      if (Math.abs(p.y - cy) < 1.9) { props.splice(i, 1); continue; }
      p.outside = false; p.r = p.kind === 'tree' ? .45 : .75;
    }
    for (const [kind, x, y, extra] of WEST_PROPS) { const q = kind === 'bush' ? brookAway(x, y, .55) : null; add(kind, q ? q[0] : x, q ? q[1] : y, {...extra}); }   // (a bush on the brook's bank steps back)
    // the old walls (westland.js OLD_WALL_LEGS): a 'fieldwall' segment every WALL_SEG m along each leg, a round collider (touching its
    // neighbours: no way through), none in a doorway; the leg as a run for world/walls3d.js (its a / b moved by ext). A bush or a
    // stone lying on a wall's line goes
    for (let i = props.length - 1; i >= 0; i--) { const p = props[i]; if ((p.kind === 'bush' || p.kind === 'tuft' || p.kind === 'rock') && !(p.r > 0) && oldWallD(p.x, p.y) < .8) props.splice(i, 1); }
    for (const L of OLD_WALL_LEGS) {
      const [ax, ay] = L.a, l = Math.hypot(L.b[0] - ax, L.b[1] - ay), ux = (L.b[0] - ax) / l, uy = (L.b[1] - ay) / l, gaps = [...L.gaps, ...brookGaps(L)];   // (+ where the brook runs through it)
      const n = Math.max(1, Math.round(l / WALL_SEG)), step = l / n;
      for (let k = 0; k < n; k++) {
        const s = (k + .5) * step; if (gaps.some(([g0, g1]) => s > g0 - .1 && s < g1 + .1)) continue;
        add('fieldwall', ax + ux * s, ay + uy * s, {r: .3});
      }
      walls.push({kind: 'fieldwall', a: [ax - ux * L.ext[0], ay - uy * L.ext[0]], b: [L.b[0] + ux * L.ext[1], L.b[1] + uy * L.ext[1]], h: L.h, d: WALL_D, ruin: L.ruin,
        keep: [], seed: L.seed, gaps: gaps.map(([g0, g1]) => [g0 + L.ext[0], g1 + L.ext[0]]), sink: -.16, rough: L.rough, tol: .06});
    }
    // the brook's bridge: its parapets' colliders (round, touching: no way through; nothing drawn: the bridge is world.js's mesh), and
    // stones round its spring and by its water
    if (BROOK) {
      for (const [x, y] of BROOK.parapets) add('parapet', x, y, {r: BROOK_BRIDGE.para.r});
      for (const [dx, dy, v] of [[-.62, -.12, 0], [.6, -.2, 1], [-.5, .5, 2]]) add('rock', BROOK.spring.x + dx, BROOK.spring.y + dy, {r: 0, variant: v});
      for (const q of BROOK.rocks) add('rock', q.x, q.y, {r: 0, variant: q.variant});   // (and a few at its water's edge)
    }
    // the standing stones (stonecircle.js): a 'menhir' per stone, a round collider (a lying one a row of them); world.js builds their stone
    for (const [kind, x, y, extra] of STONE_PROPS) add(kind, x, y, {...extra});
  }
  // ---- THE FOREST (forest.js): the surroundings north of the arena that are walkable now (FOREST_S) get colliders; then its trees,
  // undergrowth and rocks (added last: no random draw above moves; a tree carries its fid, its species and size)
  if (FOREST) {
    for (const p of props) if (p.outside && p.y < FOREST_S + .5 && !(p.r > 0)) { p.outside = false; p.r = p.kind === 'tree' ? .45 : .75; }
    for (const [kind, x, y, extra] of FOREST.props) add(kind, x, y, {...extra});
  }
  // ---- the watchtower (TOWER_PLAN): soft scatter in its footprint goes; the prop that carries its mesh (world.js: its geometry, perches
  // on its broken tops), and its colliders, 'towerwall': a ring round its foot at the ground's height, a ring on the lookout at the floor's
  if (TOWER_PLAN) {
    for (let i = props.length - 1; i >= 0; i--) { const p = props[i]; if (!(p.r > 0) && inTower(TOWER_PLAN, p.x, p.y, .5)) props.splice(i, 1); }
    add('watchtower', TOWER_PLAN.x, TOWER_PLAN.y, {r: 0});
    for (const c of towerCols(TOWER_PLAN, terrainField().H)) add('towerwall', c.x, c.y, {r: c.r}).z = c.z;
  }
  return {props, marks, lights, lane, rail, lightGarden: lg, ring: {x: cx, y: cy + .5, r: 4.5}, spawn: {x: cx, y: cy + .5}, west: WEST_ON ? WEST : null, walls,
    trail: TRAIL, stream: STREAM, inStream, plateaus: PLATEAUS, elev, plateauAt, spring: SPRING, rill: RILL, fall: FALL, pool: POOL, outflow: OUTFLOW, inRill, rillAt, inPool, poolEdge, inOutflow, outflowAt,
    mesa: MESA, mesaAt, climbs: CLIMBS, cascades: CASCADES, clefts: CLEFTS, inCleft, bridges: BRIDGES, brook: BROOK, forest: FOREST};
}
