// WESTLAND: the West Downs, rolling meadow hills west of the Proving Grounds (the user's brief, 2026-10-06: "rolling hills, tall
// grass that dances in the wind, oak trees, birds, beautiful light, some grass ankle high, grass that moves when walked through
// and in the wind"). Plain data + pure functions of world position, read by:
//   layout.js       the world grows west by the downs (WORLD.x0), they are walkable / roamable / on the nav grid, their hills go
//                   into the terrain field (TERRAIN), their props (oaks, boulders, bushes, two old pillars) into the prop list
//   biomes.js       paints their ground on a canvas of its own (paintWest: the meadow lit by the hills' real slopes, the track)
//   world.js        lays that canvas on a ground patch of its own west of the Proving Grounds' patch
//   features/grass.js grows the sward over it: TALL drifts in the hollows (knee high, the wind's waves roll through them), ANKLE high
//                   grass on the hilltops, the track's verges and under the oaks, the meadow's own height elsewhere
//   features/wildlife.js, features/wind.js: birds and rabbits live here too; the gust fronts cross the downs
// The downs run from WEST.x0 to the Proving Grounds' west edge (x 0); the arena's west road comes out of its gate along y ~15 and
// carries on west as the TRACK. ?west=0: the world as before (it ends at x 0).
// OWNS: nothing at run time (constants and pure functions). READS: core/flags.js, core/mathx.js.
//   WEST_ON, WEST {x0, y0, x1, y1}, LAND (WEST and the painted land past its edges), HILLS / BORDERS (terrain shapes), TRACK /
//   TRAIL_N (polylines), PROPS ([kind, x, y, extra]), FIELD_WALLS / FOUNDATIONS / OLD_WALL_LEGS (the old walls), oldWallD(x, y),
//   trackD(x, y) (m to the nearest track's centre line, minus its half width: < 0 on it), trackK(x, y) (its distance over its half
//   width), zone(x, y, elev, out) -> out {tall, ankle}, STONES_ON (the standing stones on the south-west hill: world/stonecircle.js)
import {flags} from '../core/flags.js';
import {vnoise as vn, smooth} from '../core/mathx.js';

export const WEST_ON = flags.get('west') !== '0';
// the stone circle on the south-west hill (world/stonecircle.js: its own hill there, this one's oak moved off the top); ?stones=0: none
export const STONES_ON = WEST_ON && flags.get('stones') !== '0';
export const WEST = {x0: -48, y0: 0, x1: 0, y1: 30};
// LAND: what is painted and grown: the downs and on past the world's west and north edges (the view sees ~8 m past an edge the
// player stands at: the meadow carries on up the border's banks to a forest edge, instead of stopping at a line)
export const LAND = {x0: -58, y0: -8, x1: 0, y1: 30};

// ---- the hills: raised cosines (terrain.js 'hill'), each walkable on its own (its steepest slope pi h / 2 r stays under ~.6; the
// field's WALK is .7). North of the track the high ones (the old oak's hill the highest), south of it lower ones that flatten toward
// the ravine's rim (layout.js terrainMask), small knolls on the track's shoulders
export const HILLS = !WEST_ON ? [] : [
  {type: 'hill', x: -8.5, y: 7, rx: 7.5, ry: 5.2, h: 1.6, rot: .2},
  {type: 'hill', x: -22.5, y: 6.5, rx: 8.5, ry: 6.8, h: 2.5, rot: -.15},   // the old oak's hill
  {type: 'hill', x: -36, y: 7.5, rx: 7.5, ry: 5.8, h: 2, rot: .3},
  {type: 'hill', x: -45, y: 4, rx: 5, ry: 4.5, h: 1.3},
  {type: 'hill', x: -14, y: 22.5, rx: 6.5, ry: 3.8, h: 1.1, rot: .1},
  ...(STONES_ON ? [] : [{type: 'hill', x: -29, y: 21.5, rx: 7, ry: 4.2, h: 1.4, rot: -.2}]),   // (with the stones: stonecircle.js TERRAIN)
  {type: 'hill', x: -42.5, y: 22, rx: 5.5, ry: 4, h: 1.2},
  {type: 'hill', x: -26, y: 18.2, rx: 3.5, ry: 2.4, h: .55},
  {type: 'hill', x: -4, y: 10.5, rx: 3, ry: 2.2, h: .5},
  {type: 'hill', x: -32.5, y: 11.6, rx: 3, ry: 2.5, h: .6},
];

// ---- the borders: banks rising round the downs' west and north edges (not walkable: the world ends a little before them) with
// WAVY outlines (a straight bank paints as a ruler-straight band of light or shade), the forest edge on top (PROPS). layout.js
// takes them instead of the straight banks it lays round the Proving Grounds (theirs stay behind the arena's north wall)
const wav = (t, s) => 1.3 * Math.sin(t * .41 + s) + .8 * Math.sin(t * .93 + s * 2.1) + .4 * Math.sin(t * 1.9 + s * .7);
export const BORDERS = !WEST_ON ? [] : [
  {type: 'terrace', h: 1.5, bank: 3.6, pts: [...Array.from({length: 49}, (_, i) => { const y = -14 + i * 1.5; return [WEST.x0 - 1.6 - wav(y, 1.3) * .8, y]; }), [WEST.x0 - 60, 60], [WEST.x0 - 60, -14]]},
  {type: 'terrace', h: 1.4, bank: 3.4, pts: [...Array.from({length: 45}, (_, i) => { const x = WEST.x0 - 14 + i * 1.5; return [x, WEST.y0 - 1.4 - wav(x, 4.1) * .7]; }).filter(([x]) => x <= WEST.x1 + 2),
    [WEST.x1 + 2, WEST.y0 - 60], [WEST.x0 - 14, WEST.y0 - 60]].reverse()},
];

// ---- the track: the arena's west road (biomes.js pathD: y ~15 out of the gate) carried on west between the hills, and a foot
// trail up to the old oak. hw: half its width (m)
export const TRACK = {hw: .62, pts: [[1.5, 15], [-2, 15.3], [-6, 16.5], [-10, 17.4], [-14, 17.2], [-18, 15.9], [-22, 14.7], [-26, 14], [-30, 14.2],
  [-34, 15.3], [-38, 16.6], [-42, 17.1], [-46, 16.6], [-52, 16]]};
export const TRAIL_N = {hw: .36, pts: [[-21.2, 14.9], [-21.5, 12.4], [-22.3, 10.1], [-22.6, 8.3]]};
const segD = (x, y, P) => {
  let d = 1e9;
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    const dx = x - ax - vx * t, dy = y - ay - vy * t, q = dx * dx + dy * dy; if (q < d) d = q;
  }
  return Math.sqrt(d);
};
// the track's gentle wander off its polyline (a few dm, slow), so its edges aren't straight between the points
const wander = (x, y) => (vn(x * .35, y * .35, 81) - .5) * .5;
export const trackD = (x, y) => Math.min(segD(x, y + wander(x, y), TRACK.pts) - TRACK.hw, segD(x, y, TRAIL_N.pts) - TRAIL_N.hw);
// the same as a fraction of the track's own half width: 0 on its centre line, 1 at its edge (the painter's worn margin)
export const trackK = (x, y) => Math.min(segD(x, y + wander(x, y), TRACK.pts) / TRACK.hw, segD(x, y, TRAIL_N.pts) / TRAIL_N.hw);

// ---- the props: [kind, x, y, extra]. Oaks (trees3d.js 'oak': variants 0 / 1, scale: a big old one is 1.7 x) with a trunk collider,
// mossy boulders, bushes (rabbits hide by them, butterflies visit), two broken pillars of the old ruins near the oak's hilltop
const oak = (x, y, scale, variant = 0, seed = 0) => ['tree', x, y, {variant, scale, r: .45 * scale, seed}];
export const OAKS = !WEST_ON ? [] : [
  oak(-22.4, 6.4, 1.7, 0, 3),                                   // the old oak, on the highest hill
  oak(-8.8, 6.5, 1.3, 1, 1), oak(-36.4, 7.2, 1.4, 0, 5), oak(-15.5, 11.2, 1.05, 1, 2), STONES_ON ? oak(-24, 17, 1.05, 0, 6) : oak(-29.6, 21.2, 1.25, 0, 6),
  oak(-13.2, 22.8, 1.1, 1, 4), oak(-10.6, 24.4, .95, 0, 7), oak(-43, 21.6, 1.2, 1, 0), oak(-4.2, 21.5, 1, 0, 2),
  oak(-27.5, 10.4, .9, 1, 1), oak(-2.6, 5.5, 1, 1, 6),
  // the grove in the north-west
  oak(-41.5, 3.2, 1.15, 0, 4), oak(-44.2, 6.2, 1, 1, 3), oak(-39.2, 1.8, .95, 1, 7), oak(-46.4, 2.6, 1.1, 0, 5),
];
export const PROPS = !WEST_ON ? [] : [
  ...OAKS,
  ['rock_big', -17.5, 19.8, {variant: 0, r: .75}], ['rock_big', -32.3, 11.3, {variant: 1, r: .75}], ['rock_big', -6.3, 12.2, {variant: 2, r: .75}],
  ['rock_big', -38.6, 20.7, {variant: 1, r: .75}], ['rock_big', -24.8, 24.5, {variant: 0, r: .75}],
  ['bush', -12.2, 19.6, {variant: 0}], ['bush', -19.6, 12.4, {variant: 1}], ['bush', -24.3, 17.9, {variant: 2}], ['bush', -31.3, 17.6, {variant: 0}],
  ['bush', -37.7, 12.5, {variant: 1}], ['bush', -45.5, 19.3, {variant: 2}], ['bush', -7.4, 19.9, {variant: 1}], ['bush', -40.4, 9.6, {variant: 0}],
  ['pillar_broken', -20.1, 4.4, {r: .42}], ['pillar_broken', -25.1, 8.9, {r: .42}],
  // the forest edge past the world's west and north borders (unreachable, no colliders: outside; their species by grove, trees3d.js)
  ...[[-51.5, 2.5], [-53.5, 6.8], [-51, 10.4], [-54.2, 13.6], [-52, 19.8], [-55, 23.4], [-51.8, 26.4], [-56.5, 9.5], [-56, 18],
    [-44, -3.2], [-37.5, -2.4], [-30.4, -4.6], [-24, -2.8], [-16.8, -4.2], [-10.5, -2.6], [-4.2, -4.8], [-50.5, -3.5]]
    .map(([x, y], i) => ['tree', x, y, {variant: i % 3 === 2 ? 1 : 0, outside: true}]),
];

// ---- THE OLD WALLS (world/walls3d.js builds them; ?walls=old: none): dry-stone FIELD WALLS (~1 m, following the hills, broken in
// places) bounding the meadows either side of the track, and the FOUNDATIONS of two old buildings (low walls round a room, a doorway,
// a flagstone floor: biomes.js westRuins paints it): one on the old oak's hill round its broken pillar, a barn's by the track in the
// west. layout.js lays a 'fieldwall' segment every SEG m along each leg (a round collider: vaulted, stepped over where it's rubble,
// sim/player/adapter.js); world.js hands each its piece of its leg
export const FIELD_ON = WEST_ON && flags.get('walls') !== 'old';
export const FIELD_WALLS = !FIELD_ON ? [] : [
  {pts: [[-5, 10.3], [-10.5, 12.3], [-14, 13.6]], h: .95, ruin: .45, seed: 201},
  {pts: [[-29.5, 12.9], [-34.5, 12.3], [-40, 13.1]], h: 1, ruin: .5, seed: 203},
  {pts: [[-17, 22.4], [-20.5, 23.8], [-23, 26]], h: .9, ruin: .6, seed: 205},
];
export const FOUNDATIONS = !FIELD_ON ? [] : [
  {x0: -21, y0: 1.8, x1: -16.8, y1: 5.4, door: {side: 's', at: -19.1, w: 1}, h: .75, ruin: .6, seed: 211},
  {x0: -40.4, y0: 19.6, x1: -36.6, y1: 23, door: {side: 'n', at: -38.5, w: 1}, h: .7, ruin: .55, seed: 213},
];
export const WALL_D = .48, SEG = .6;
// both as LEGS, straight runs for walls3d.js: {a, b (the leg's own line), ext: [m added at a, at b] (a polyline's legs overlap a
// little at a bend; a foundation's north / south walls run past its corners, its east / west ones stop inside them), h, ruin, seed,
// gaps: [[s0, s1]] (m from a: a doorway, no stones), rough (how unevenly the stones lie)}
export const OLD_WALL_LEGS = [];
for (const [k, W] of FIELD_WALLS.entries()) for (let i = 0; i + 1 < W.pts.length; i++)
  OLD_WALL_LEGS.push({a: W.pts[i], b: W.pts[i + 1], ext: [i > 0 ? WALL_D / 2 : 0, i + 2 < W.pts.length ? WALL_D / 2 : 0], h: W.h, ruin: W.ruin, seed: W.seed + i * 2, gaps: [], rough: 2.2});
for (const F of FOUNDATIONS) {
  const {x0, y0, x1, y1, door: dr} = F, e = WALL_D / 2;
  const sides = {n: [[x0, y0], [x1, y0], e], e: [[x1, y0], [x1, y1], -e], s: [[x1, y1], [x0, y1], e], w: [[x0, y1], [x0, y0], -e]};
  for (const [side, [a, b, ext]] of Object.entries(sides)) {
    const gaps = [];
    if (dr.side === side) { const at = side === 'n' ? dr.at - x0 : side === 's' ? x1 - dr.at : side === 'e' ? dr.at - y0 : y1 - dr.at; gaps.push([at - dr.w / 2, at + dr.w / 2]); }
    OLD_WALL_LEGS.push({a, b, ext: [ext, ext], h: F.h, ruin: F.ruin, seed: F.seed + side.charCodeAt(0), gaps, rough: 1.5});
  }
}
// m from (x, y) to the nearest old wall's line (its legs as drawn, ext included); Infinity without them
export function oldWallD(x, y) {
  let d = Infinity;
  for (const L of OLD_WALL_LEGS) {
    const [ax, ay] = L.a, [bx, by] = L.b, l = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / l, uy = (by - ay) / l;
    const t = Math.max(-L.ext[0], Math.min(l + L.ext[1], (x - ax) * ux + (y - ay) * uy)), dx = x - ax - ux * t, dy = y - ay - uy * t;
    d = Math.min(d, Math.hypot(dx, dy));
  }
  return d;
}

// ---- the sward's zones at (x, y) (h: the ground's height there): tall (0..1) knee-high drifts, ankle (0..1) short grass. Tall grass
// gathers in the hollows and on the lower slopes in big drifts (a slow noise), never on the track, thinning toward the hilltops;
// ankle-high: the track's verges, round the oaks' feet (their shade, the animals' lying-up places), the hilltops (wind-cropped)
const OAK_R = OAKS.map(([, x, y, e]) => [x, y, 2.4 * e.scale]);
export function zone(x, y, h, out) {
  const td = trackD(x, y);
  let ankle = td < 1.3 ? 1 : td < 2.1 ? 1 - (td - 1.3) / .8 : 0;
  for (const [ox, oy, r] of OAK_R) { const d = Math.hypot(x - ox, y - oy); if (d < r) ankle = Math.max(ankle, d < r * .7 ? 1 : 1 - (d - r * .7) / (r * .3)); }
  ankle = Math.max(ankle, smooth((h - 1.5) / .6));
  const n = vn(x * .085, y * .11, 83) * .68 + vn(x * .3, y * .3, 84) * .32 + Math.max(0, .9 - h) * .14;
  out.tall = smooth((n - .5) / .1) * (1 - ankle);
  out.ankle = ankle;
  return out;
}
