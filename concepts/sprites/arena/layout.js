// Proving Grounds: a small test arena for the character, playstyle, lights and biomes, plus an east TRAIL for
// traversal and combat mechanics. Everything is in METRES on the ground plane (x right, y toward the camera), heights
// in metres above the ground. The biome decides how things look; this file decides WHERE things are, what they
// collide with, how high the ground is (elev) and where the traversal features are.
//
//   world 62 x 30 m
//   x 7..33   walled arena (movement ring, range lane, pillar grove, light garden, N/S dummies)
//   x 33..60  the trail, out of the east gate:
//               stream   runs N-S at x ~40; 2.9 m wide (sprint-leap only), a 1.4 m narrows in front of the gate
//                        (leap), and 2 stepping stones further south (chained short leaps). Falling in = respawn.
//               plateau  x 43..60, y 2.8..11, 2.4 m high. South face = cliff; walk off any edge to drop down;
//                        climb up / down only at the climb spot (E). Chest, pots and a crystal on top.
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
export const WORLD = {WM: 62, HM: 30};
export const PLAY = {x0: 7, y0: 6, x1: 33, y1: 24};
export const TRAIL = {x0: 33, y0: 2.6, x1: 60, y1: 27.5};   // walkable outdoor region east of the arena

// ---- stream: centreline x and width per y (metres) ----
export const STREAM = {
  cx: y => 40 + .9 * Math.sin(y * .33),
  // 2.9 m (a run-leap reaches ~3.0 m and falls in; a sprint-leap ~3.6 m clears it), 1.4 m at the narrows in front of the east gate
  w: y => { const n = Math.abs(y - 15); return n < 1.2 ? 1.4 : n < 2.4 ? 1.4 + (n - 1.2) / 1.2 * 1.5 : 2.9; },
  narrows: {y: 15},
  stones: [{x: 0, y: 23.4, r: .42}, {x: 0, y: 23.4, r: .42}],   // x filled in below (placed across the channel)
};
STREAM.stones[0].x = STREAM.cx(23.4) - .5; STREAM.stones[1].x = STREAM.cx(23.4) + .55;
export const inStream = (x, y) => {
  if (y < -1 || y > 31) return false;
  if (Math.abs(x - STREAM.cx(y)) > STREAM.w(y) / 2) return false;
  return !STREAM.stones.some(s => Math.hypot(x - s.x, (y - s.y) * 1.3) < s.r);   // stones are dry footing
};

// ---- elevation: one plateau with a south cliff face ----
export const PLATEAUS = [{x0: 43, y0: 2.8, x1: 60, y1: 11, h: 2.4,
  climbs: [{x: 51.5, w: 1.2}]}];        // climb spot on the south face (x = centre, w = width)
export const elev = (x, y) => { for (const p of PLATEAUS) if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return p.h; return 0; };
export const plateauAt = (x, y) => PLATEAUS.find(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) || null;

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
  add('torch', x1 - .6, cy - 3.2, {r: 0});   // wall torches on the east wall
  add('torch', x1 - .6, cy + 5.4, {r: 0});

  // ---- south: deco strip + a column of dummies straight south of the ring (shots toward / away from camera) ----
  for (const x of [cx - 3, cx, cx + 3]) add('dummy', x, y1 - 1.6, {r: .3, wob: 0, target: true});
  for (let i = 0; i < 7; i++) add(rnd() < .5 ? 'bush' : 'rock', x0 + 1 + rnd() * 5, y1 - .8 - rnd() * 2.4, {r: .25, variant: rnd() * 3 | 0});
  for (let i = 0; i < 6; i++) add(rnd() < .5 ? 'bush' : 'rock', x1 - 6 + rnd() * 5, y1 - .8 - rnd() * 2, {r: .25, variant: rnd() * 3 | 0});

  // ---- small scatter inside (no collision) ----
  for (let i = 0; i < 26; i++) {
    const x = x0 + .8 + rnd() * (x1 - x0 - 1.6), y = y0 + .8 + rnd() * (y1 - y0 - 1.6);
    if (Math.hypot(x - cx, (y - cy - .5)) < 5.2) continue;      // keep the ring clear
    add('tuft', x, y, {variant: rnd() * 3 | 0});
  }

  // ================= the trail (east of the arena) =================
  // path out of the east gate to the narrows; after the stream it forks north (climb spot) and south (yard)
  const path = [[x1 + .5, cy], [38.2, cy], [41.8, cy], [45, 13.4], [51.5, 11.8]];
  marks.push({type: 'path', pts: path, w: 1.6});
  marks.push({type: 'path', pts: [[41.8, cy], [46, 18.5], [50, 21]], w: 1.4});
  const wantsClear = (x, y) => path.some(([px, py]) => Math.hypot(x - px, y - py) < 1.4);

  // breakables: hp = hits of ~10 damage; `breakable` = what it is; biome paints `stage` 0 intact / 1 damaged / 2 broken
  const brk = (type, x, y, hp, extra = {}) => add(type, x, y, {breakable: type, hp, maxHp: hp, stage: 0, r: extra.r ?? .32, ...extra});
  // plateau top: chest (interact), pots, a crystal cluster, all reached by the climb
  add('chest', 55.5, 5.4, {r: .45, interact: 'open', opened: false});
  for (const [x, y] of [[49, 4.6], [49.7, 4.2], [58.2, 8.4]]) brk('pot', x, y, 10, {r: .22});
  brk('crystal', 46, 6, 40, {r: .4});
  add('tree', 59, 3.6, {variant: 1, r: .5});   // a lone tree on the plateau
  // yard below the cliff
  for (const [x, y] of [[46.2, 14.2], [46.9, 14.6], [46.5, 15.3]]) brk('crate', x, y, 20);
  for (const [x, y] of [[55, 14.3], [55.6, 14.9]]) brk('barrel', x, y, 25, {r: .3});
  for (const [x, y] of [[49, 17], [49.5, 17.5], [52.8, 16.4], [44.6, 21.5], [45.1, 22.1]]) brk('pot', x, y, 10, {r: .22});
  for (const [x, y] of [[53.6, 19.2], [55.3, 18.2], [57.6, 16.9]]) brk('barrel_x', x, y, 10, {r: .3, explode: {r: 2.4, dmg: 40}});   // explosive, spaced to chain
  for (const [x, y] of [[54.4, 17.2], [56.2, 17.6]]) brk('crate', x, y, 20);   // caught in the blast
  // a crate wall across the SE corner; the cache behind it is only reachable by breaking through
  for (let y = 21.6; y <= 27.4; y += .8) brk('crate', 55.2, y, 20, {r: .38, wall: true});
  for (let x = 55.2 + .8; x <= 59.6; x += .8) brk('crate', x, 21.6, 20, {r: .38, wall: true});
  add('chest', 58, 25.5, {r: .45, interact: 'open', opened: false});
  brk('crate', 57, 24, 20); brk('pot', 59, 23.6, 10, {r: .22});
  // sparring dummies: hop toward the player once hit or when close, knock back on contact, respawn when broken
  add('brute', 51, 23.5, {r: .35, hp: 60, maxHp: 60, target: true, sparring: true, home: [51, 23.5]});
  add('brute', 48, 25.5, {r: .35, hp: 60, maxHp: 60, target: true, sparring: true, home: [48, 25.5]});
  // trail scatter: bushes / rocks / tufts, kept off the paths and the water
  for (let i = 0; i < 40; i++) {
    const x = TRAIL.x0 + 1 + rnd() * (TRAIL.x1 - TRAIL.x0 - 2), y = TRAIL.y0 + .5 + rnd() * (TRAIL.y1 - TRAIL.y0 - 1);
    if (inStream(x, y) || Math.abs(x - STREAM.cx(y)) < STREAM.w(y) / 2 + .5 || wantsClear(x, y) || props.some(p => Math.hypot(p.x - x, p.y - y) < 1)) continue;
    if (elev(x, y) === 0 && y < 12 && x > 42.5) continue;   // right under the cliff lip
    const k = rnd(); add(k < .45 ? 'tuft' : k < .75 ? 'bush' : 'rock', x, y, {variant: rnd() * 3 | 0, r: k < .45 ? 0 : .25});
  }

  // ---- surroundings outside the walls and the trail (unreachable; big shapes that set the biome mood) ----
  const {WM, HM} = WORLD;
  for (let i = 0; i < 110; i++) {
    const x = rnd() * WM, y = rnd() * HM;
    if (x > x0 - 1.5 && x < x1 + 1.5 && y > y0 - 1.5 && y < y1 + 1.5) continue;
    if (x > TRAIL.x0 - 1 && x < TRAIL.x1 + 1 && y > TRAIL.y0 - 1.2 && y < TRAIL.y1 + 1) continue;
    if (Math.abs(x - STREAM.cx(y)) < STREAM.w(y) / 2 + .6) continue;
    add(rnd() < .55 ? 'tree' : 'rock_big', x, y, {variant: rnd() * 3 | 0, outside: true});
  }
  return {props, marks, lights, lane, rail, lightGarden: lg, ring: {x: cx, y: cy + .5, r: 4.5}, spawn: {x: cx, y: cy + .5},
    trail: TRAIL, stream: STREAM, inStream, plateaus: PLATEAUS, elev, plateauAt};
}
