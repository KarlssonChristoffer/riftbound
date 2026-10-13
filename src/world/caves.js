// CAVES: the woods' caves, grown from the forest's seed (docs/CAVES.md). A cave MOUTH in the home woods is a slot cut down into the
// ground between rock walls, its far end under an overhang of the ground (a rock brow, dark under it); you walk down it and the world
// above goes dark round you, and somewhere down the slot you are in the CAVE: passages and chambers in the dark, the floor and the walls
// that face the camera, nothing over them. Pure functions of the seed and the place, like world/forest.js (no Math.random, no DOM, no
// game state: node runs this file too, and every co-op client grows the same cave from the server's seed).
//   UNDER     the cave lies in a BAND of its own north of the forest (band(rect): the forest's width, `depth` m deep, `gap` m north of
//             its north edge, out of the view from anywhere in the woods). The ground is one height per place (world/terrain.js), so a
//             cave can't lie under the woods themselves: it lies there, and the mouth's slot is in both places. The band holds a COPY
//             of the slot (the mouth moved by OFF: the same x, a y in the band); where the slot's floor is WARP m down it, the player is
//             moved by OFF (features/caves.js: down the slot in the woods -> on down the copy in the band, and back up the same way),
//             on the same ground at the same height, so the step is seamless but for the woods round him, which are dark by then
//   MOUTH     placeMouth(seed, ctx): in the home woods, on level ground away from the water, the clearing, the esker and the rock, heading
//             north give or take (so you walk up the screen into it at the default yaw): a straight slot `len` m long, `w` wide, its
//             floor falling evenly `depth` m from the ground at its head. The ground over its last metres (from `brow`) is DRAWN uncut:
//             an overhang with the rock brow under its edge, dark under it (world/terrain.js 'cave' shape, drawn)
//   NETWORK   cavePlan(seed, mouth, rect): from the slot's foot in the band, chambers (rooms, `room` m) and the passages between them
//             (`hw` m half-wide, wandering), grown outward from the entry like roots: each new node a `step` away from one already
//             there, kept apart from the others (rock between), falling a little each step; a loop or two where two ends meet. Its
//             ground is a 'cave' terrain shape over the band: the floor in the open, the floor + WALL m of rock everywhere else (a
//             straight drop: steep, a wall to walkers)
//   WALLS     the open's outline (marching squares on its distance grid), as loops whose outside is the open (world/cliffs3d.js's way:
//             the floor on the run's right); world/cave3d.js lays the rock along them and hides the ones that face away from the camera
//   PROPS     crystals in the walls' feet of some chambers (breakable, they light the dark), loose rock
// OWNS: nothing at run time (plain data). READS: core/mathx.js, core/rng.js.
//   const M = placeMouth(seed, {height, room, slope, home})      null when no spot fits (no cave)
//   const C = cavePlan(seed, M, rect)   C.band, C.off, C.mouth, C.shape (terrain), C.slot (terrain: the woods' cut), C.walls, C.grid,
//                                       C.inside(x, y) (m: < 0 in the open), C.floor(x, y), C.warp (the line), C.props, C.slotAt(x, y, out)
import {vnoise, smooth, clamp, hash3} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';

export const TUNE = {
  band: {gap: 18, depth: 64, margin: 6},
  mouth: {len: 11, w: 3.4, depth: 3.6, warp: 7.6, hyst: .8, brow: 9.6, south: 18, flat: .7, rise: 2.5},
  net: {nodes: [10, 14], step: [7.5, 12], hw: [.95, 1.4], room: [2.8, 5.4], bend: .35, fall: [-.15, .7], sep: 2.4, wob: .9, loops: 2, floor: 4.6},
  wall: 3.4,       // m: the rock stands this much over the floor at the walls (what the camera sees of them)
  rough: .55,      // m: how far the walls wander in and out of the plan's line
  crystals: [5, 9],
};
const CELL = .25;  // the grid (world/terrain.js CELL: the field's own lattice, so the field reads it exactly)
const PORTAL = {r: 22};  // m round the slot copy's foot: the cave drawn under the woods too (C.inPortal; as far as the view reaches from the step)
const DRAWN_IN = .35;   // m: the woods' slot is drawn this much wider than walked (layout.js CLEFT_IN's way)

const mix = (seed, a, b = 0) => (hash3(seed | 0, a, b) * 4294967296) | 0;
const segT = (x, y, ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay; return clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1); };
const segD = (x, y, ax, ay, bx, by) => { const t = segT(x, y, ax, ay, bx, by); return Math.hypot(x - ax - (bx - ax) * t, y - ay - (by - ay) * t); };

// the band north of the forest (rect: its {x0, y0, x1, y1}) where the caves lie
export function band(rect) {
  const B = TUNE.band, y1 = rect.y0 - B.gap;
  return {x0: rect.x0, y0: y1 - B.depth, x1: rect.x1, y1};
}

// ---- the MOUTH: ctx = {height(x, y), room(x, y, r) (nothing in the way within r), home: {x0, y0, x1, y1}}
export function placeMouth(seed, {height, room, home}) {
  const R = mulberry32(mix(seed >>> 0, 7)), M = TUNE.mouth;
  let best = null;
  for (let t = 0; t < 900 && !(best && t >= 300); t++) {   // (no spot in the first 300 tries: the rules loosen, a little more every 300)
    const k = 1 + Math.floor(t / 300) * .6;
    const a = -Math.PI / 2 + (R() - .5) * .9, ux = Math.cos(a), uy = Math.sin(a);   // its way in: north, give or take
    const x = home.x0 + 14 + R() * (home.x1 - home.x0 - 28), y = home.y0 + 8 + M.len + R() * (home.y1 - home.y0 - M.south - 8 - M.len), jit = R();
    if (![0, .5, 1].every(f => room(x + ux * M.len * f, y + uy * M.len * f, (M.w / 2 + 2) / k))) continue;
    // the ground along it: level across (its walls the same height both sides), never falling much along it (it is cut into the
    // ground: into a slope is best, a hillside); not rising more than `rise`
    const g = height(x, y); let across = 0, fall = 0, rise = 0;
    for (let s = -1; s <= M.len + 1; s += 1) {
      const l = height(x + ux * s + uy * (M.w / 2 + 1.2), y + uy * s - ux * (M.w / 2 + 1.2)), r = height(x + ux * s - uy * (M.w / 2 + 1.2), y + uy * s + ux * (M.w / 2 + 1.2)), c = height(x + ux * s, y + uy * s);
      across = Math.max(across, Math.abs(l - r)); fall = Math.max(fall, g - Math.min(l, r, c)); rise = Math.max(rise, c - g);
    }
    if (across > M.flat * k || fall > .35 * k || rise > M.rise * k) continue;
    const score = across + fall - rise * .3 + jit * .2;
    if (!best || score < best.score) best = {x, y, ux, uy, score, g};
  }
  if (!best) return null;
  const {x, y, ux, uy} = best;
  return {x: +x.toFixed(2), y: +y.toFixed(2), ux: +ux.toFixed(4), uy: +uy.toFixed(4), len: M.len, w: M.w, depth: M.depth, g0: +best.g.toFixed(3), warp: M.warp, hyst: M.hyst, brow: M.brow, ns: mix(seed >>> 0, 11) & 0xffff};
}
// the slot's NATURAL shape: a gully, not a cut. Its line wanders (bend m either way), it starts narrow and rounded at its head (a dip in
// the ground that deepens and opens over `head` m), it swells and pinches along its length (wide: x its width), and its two sides are
// ragged each on their own (rag m). All in the slot's own frame (s along, q across, noise seeded by the mouth's ns), so the woods'
// slot and its copy in the band are the same shape to the mm. Near the foot it straightens and settles to its plain width (into the
// cave's entry passage). round: m its head's rounding reaches down the slot at the sides
const SLOT = {bend: 1.1, head: 3, headW: .45, wide: .22, rag: .3, round: 1.6, arch: .8, bank: 2.2, bankK: .45};
// its BANKS: the woods' ground sags toward its rim (bankK of the slot's depth there at the rim, none bank m out), so the rock shows only
// in its lower part, under grassy slopes; none toward the brow (the overhang stays whole). d: m out from the slot (slotD)
const slotSag = (m, s, d) => (m.g0 - slotFloor(m, clamp(s, 0, m.len))) * SLOT.bankK * (1 - smooth(clamp(d / SLOT.bank, 0, 1))) * (1 - smooth(clamp((s - m.brow + 1.5) / 1.5, 0, 1)));
// the slot in its own frame: s along it from its head (0 .. len), q across (+ to the right of the way in), measured from its wandering
// line and scaled by its width there (|q| = w / 2 on its sides, everywhere)
export function slotFrame(m, x, y, out) {
  const dx = x - m.x, dy = y - m.y, s = dx * m.ux + dy * m.uy, q = -dx * m.uy + dy * m.ux, ns = m.ns || 0;
  const tail = smooth(clamp((m.len - s) / 3, 0, 1));
  const c = (vnoise(s * .16, .5, ns) - .5) * 2 * SLOT.bend * tail, side = q >= c ? 1 : -1;
  const open = SLOT.headW + (1 - SLOT.headW) * smooth(clamp(s / SLOT.head, 0, 1));
  const hw = m.w / 2 * open * (1 + (vnoise(s * .3, 3.5, ns) - .5) * 2 * SLOT.wide * tail) + (vnoise(s * .7, 5.5 + side * 2, ns) - .5) * 2 * SLOT.rag * (.4 + .6 * tail);
  out[0] = s; out[1] = (q - c) / Math.max(.3, hw) * (m.w / 2); return out;
}
const slotSQ = slotFrame;
// where the slot begins at q across (its head rounded: further down at the sides)
export const slotHead = (m, q) => SLOT.round * Math.min(1.5, (q / (m.w / 2)) ** 2);
// the woods' overhang's edge at q across (an arch: it reaches back furthest over the middle)
export const slotBrow = (m, q) => m.brow + SLOT.arch * (1 - Math.min(1, (q / (m.w / 2)) ** 2));
const slotFloor = (m, s) => m.g0 - m.depth * clamp(s / m.len, 0, 1);
// m outside the slot (< 0 inside it: about the most it can move before it leaves)
const slotD = (m, s, q) => Math.max(Math.abs(q) - m.w / 2, slotHead(m, q) - s, s - m.len);

// ---- the CAVE: the band, the network, its ground, its walls
export function cavePlan(seed, m, rect, height = null) {
  seed >>>= 0;
  const T = TUNE, N = T.net, R = mulberry32(mix(seed, 8)), S = mix(seed, 9) & 0xffff, B = band(rect), mg = T.band.margin;
  // the copy of the slot: the same x, its foot 16 m into the band from its south edge
  const footY = m.y + m.uy * m.len, oy = (B.y1 - 16) - footY, off = [0, +oy.toFixed(2)];
  const cm = {...m, y: +(m.y + oy).toFixed(2)};   // (the copy: the same slot, OFF away)
  const foot = [cm.x + cm.ux * cm.len, cm.y + cm.uy * cm.len], hFoot = slotFloor(cm, cm.len);
  // NODES and EDGES: from an entry chamber past the slot's foot, grown outward
  const nodes = [], edges = [];
  const r0 = 3.4;
  nodes.push({x: foot[0] + cm.ux * (r0 + .2), y: foot[1] + cm.uy * (r0 + .2), r: r0, h: hFoot - .05, room: true, deg: 1});
  edges.push({a: -1, b: 0, pts: [[foot[0] - cm.ux * .4, foot[1] - cm.uy * .4], [nodes[0].x, nodes[0].y]], hw: cm.w / 2, h0: hFoot, h1: hFoot - .05});   // (the slot's foot into the entry: as wide as the slot)
  const want = N.nodes[0] + Math.floor(R() * (N.nodes[1] - N.nodes[0] + 1)), hMin = hFoot - N.floor;
  const inBand = (x, y, r) => x > B.x0 + mg + r && x < B.x1 - mg - r && y > B.y0 + mg + r && y < B.y1 - mg - r - 4;
  const clearOf = (ax, ay, bx, by, hw, skip) => {   // the passage a-b keeps rock between it and the other passages and rooms
    for (let k = 0; k < nodes.length; k++) {
      if (k === skip) continue;
      const n = nodes[k], d = segD(n.x, n.y, ax, ay, bx, by); if (d < n.r + hw + N.sep) return false;
    }
    for (const e of edges) {
      if (e.a === skip || e.b === skip) continue;
      for (let i = 0; i + 1 < e.pts.length; i++) for (let k = 0; k <= 6; k++) {
        const f = k / 6, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        if (segD(x, y, ...e.pts[i], ...e.pts[i + 1]) < hw + e.hw + N.sep) return false;
      }
    }
    // (and off the slot: its walls stay whole)
    for (let k = 0; k <= 8; k++) { const f = k / 8, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, sq = slotSQ(cm, x, y, [0, 0]); if (slotD(cm, sq[0], sq[1]) < hw + N.sep) return false; }
    return true;
  };
  const roomClear = (x, y, r, skip) => {   // a new room keeps rock between it and the passages (but its own) and the slot
    for (const e of edges) { if (e.a === skip || e.b === skip) continue; for (let i = 0; i + 1 < e.pts.length; i++) if (segD(x, y, ...e.pts[i], ...e.pts[i + 1]) < r + e.hw + N.sep) return false; }
    const sq = slotSQ(cm, x, y, [0, 0]); return slotD(cm, sq[0], sq[1]) > r + N.sep;
  };
  for (let t = 0; t < 400 && nodes.length < want; t++) {
    // grow from a node with few passages (the young ends), more often than from the old middles
    let pi = Math.floor(R() * nodes.length); if (nodes[pi].deg > 2 && R() < .7) continue;
    const p = nodes[pi], room = R() < .55, r = room ? N.room[0] + R() * (N.room[1] - N.room[0]) : N.hw[1] * 1.25, hw = N.hw[0] + R() * (N.hw[1] - N.hw[0]);
    const away = Math.atan2(p.y - foot[1], p.x - foot[0]), a = (nodes.length === 1 ? Math.atan2(cm.uy, cm.ux) : away) + (R() - .5) * 2.4;
    const L = N.step[0] + R() * (N.step[1] - N.step[0]) + p.r + r, x = p.x + Math.cos(a) * L, y = p.y + Math.sin(a) * L;
    if (!inBand(x, y, r)) continue;
    if (nodes.some(n => Math.hypot(n.x - x, n.y - y) < n.r + r + N.sep + 2)) continue;
    const ax = p.x + Math.cos(a) * p.r * .6, ay = p.y + Math.sin(a) * p.r * .6, bx = x - Math.cos(a) * r * .6, by = y - Math.sin(a) * r * .6;
    if (!clearOf(ax, ay, bx, by, hw, pi) || !roomClear(x, y, r, pi)) continue;
    const fall = N.fall[0] + R() * (N.fall[1] - N.fall[0]), n = {x, y, r, h: Math.max(hMin, p.h - fall), room, deg: 1};
    nodes.push(n); edges.push(wobbly(p, n, pi, nodes.length - 1, hw, R)); p.deg++;
  }
  // LOOPS: two nodes near each other but not joined (a short way round)
  for (let k = 0, made = 0; k < 60 && made < N.loops; k++) {
    const i = 1 + Math.floor(R() * (nodes.length - 1)), j = 1 + Math.floor(R() * (nodes.length - 1)); if (i === j) continue;
    const A = nodes[i], Bn = nodes[j], d = Math.hypot(A.x - Bn.x, A.y - Bn.y);
    if (d > A.r + Bn.r + N.step[1] || edges.some(e => (e.a === i && e.b === j) || (e.a === j && e.b === i))) continue;
    if (Math.abs(A.h - Bn.h) > d * .25) continue;
    const a = Math.atan2(Bn.y - A.y, Bn.x - A.x), hw = N.hw[0] + R() * (N.hw[1] - N.hw[0]);
    const ax = A.x + Math.cos(a) * A.r * .6, ay = A.y + Math.sin(a) * A.r * .6, bx = Bn.x - Math.cos(a) * Bn.r * .6, by = Bn.y - Math.sin(a) * Bn.r * .6;
    // (clear of everything but its two ends)
    const keepI = nodes[i], keepJ = nodes[j]; nodes[i] = nodes[j] = {x: 1e9, y: 1e9, r: 0};
    const ok = clearOf(ax, ay, bx, by, hw, -2); nodes[i] = keepI; nodes[j] = keepJ;
    if (!ok) continue;
    edges.push(wobbly(A, Bn, i, j, hw, R)); A.deg++; Bn.deg++; made++;
  }
  // ---- the open's distance (m outside it; < 0 inside) and its floor, on the grid over the cave's box
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  const grow = (x, y, r) => { bx0 = Math.min(bx0, x - r); by0 = Math.min(by0, y - r); bx1 = Math.max(bx1, x + r); by1 = Math.max(by1, y + r); };
  for (const n of nodes) grow(n.x, n.y, n.r * 1.3 + 3);
  for (const e of edges) for (const [x, y] of e.pts) grow(x, y, e.hw + 3);
  grow(cm.x, cm.y, cm.w + 3); grow(foot[0], foot[1], cm.w + 3);
  for (const e of edges) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of e.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } e.box = [x0 - e.hw - 4, y0 - e.hw - 4, x1 + e.hw + 4, y1 + e.hw + 4]; }
  const gx0 = Math.floor(Math.max(B.x0, bx0) / CELL) * CELL, gy0 = Math.floor(Math.max(B.y0, by0) / CELL) * CELL;
  const nx = Math.ceil((Math.min(B.x1, bx1) - gx0) / CELL) + 1, ny = Math.ceil((Math.min(B.y1, by1) - gy0) / CELL) + 1;
  const D = new Float32Array(nx * ny), Hf = new Float32Array(nx * ny), Hr = new Float32Array(nx * ny), tmp = [0, 0];
  const rough = (x, y) => (vnoise(x * .55, y * .55, S) - .5) * T.rough * 2 + (vnoise(x * 1.7, y * 1.7, S + 1) - .5) * T.rough * .5;
  const roomR = (n, x, y) => { const a = Math.atan2(y - n.y, x - n.x); return n.r * (1 + .22 * (vnoise(Math.cos(a) * 1.3 + n.x, Math.sin(a) * 1.3 + n.y, S + 2) - .5) * 2); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = gx0 + i * CELL, y = gy0 + j * CELL;
    let d = 1e9, hs = 0, ws = 0;
    const take = (dd, h) => { if (dd < d) d = dd; const w = Math.exp(-4 * clamp(dd, -1.5, 3)); hs += h * w; ws += w; };
    // the slot (no roughness: the woods' copy is straight-walled)
    slotSQ(cm, x, y, tmp); const sd = slotD(cm, tmp[0], tmp[1]);
    if (sd < 3) { if (sd < d) d = sd; }
    let dn = 1e9;
    for (const n of nodes) { const q = Math.hypot(x - n.x, y - n.y); if (q > n.r * 1.4 + 4) continue; take(q - roomR(n, x, y), n.h + bumps(x, y, S) * (n.room ? 1 : .3)); dn = Math.min(dn, q - n.r); }
    for (const e of edges) {
      const eb = e.box; if (x < eb[0] || y < eb[1] || x > eb[2] || y > eb[3]) continue;
      let bd = 1e9, bh = 0;
      for (let k = 0; k + 1 < e.pts.length; k++) {
        const [ax, ay] = e.pts[k], [qx, qy] = e.pts[k + 1], t = segT(x, y, ax, ay, qx, qy), q = Math.hypot(x - ax - (qx - ax) * t, y - ay - (qy - ay) * t);
        if (q < bd) { bd = q; bh = e.h0 + (e.h1 - e.h0) * (k + t) / (e.pts.length - 1); }
      }
      if (bd < e.hw + 4) take(bd - e.hw, bh);
    }
    // the slot's floor where it is the slot (its copy matches the woods' to the cm); elsewhere the network's, blended
    const net = ws > 0 ? hs / ws : hFoot;
    const inSlot = sd < .02 && tmp[0] < cm.len - .3;
    const dr = d === sd || inSlot ? d : d + rough(x, y);   // (the walls wander; the slot's stay straight)
    const bySlot = inSlot || (sd < .6 && tmp[0] < cm.len);
    D[j * nx + i] = inSlot ? Math.min(sd, d) : Math.min(sd, dr);
    Hf[j * nx + i] = bySlot ? slotFloor(cm, tmp[0]) : net;
    const byBank = !bySlot && sd < SLOT.bank && tmp[0] < cm.brow;   // (its banks: the woods' sagging ground, as the woods' slot has: caves.js C.slot)
    Hr[j * nx + i] = bySlot ? Math.max((height ? height(x, y - oy) : cm.g0) - slotSag(cm, tmp[0], Math.max(0, sd)), slotFloor(cm, tmp[0]) + .4)
      : byBank ? Math.max((height ? height(x, y - oy) : cm.g0) - slotSag(cm, tmp[0], sd), Hf[j * nx + i] + .4) : Hf[j * nx + i] + T.wall;   // (by the slot: the woods' ground over it)
  }
  const at = (G, x, y) => { const i = Math.round((x - gx0) / CELL), j = Math.round((y - gy0) / CELL); return i < 0 || j < 0 || i >= nx || j >= ny ? null : G[j * nx + i]; };
  const lerp = (G, x, y) => {   // (bilinear: the floor's painter and the walls' outline agree on a line, not a .25 m staircase)
    const u = (x - gx0) / CELL, v = (y - gy0) / CELL, i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i + 1 >= nx || j + 1 >= ny) return null;
    const a = u - i, b = v - j, k = j * nx + i;
    return (G[k] * (1 - a) + G[k + 1] * a) * (1 - b) + (G[k + nx] * (1 - a) + G[k + nx + 1] * a) * b;
  };
  const inside = (x, y) => lerp(D, x, y) ?? 1e9;
  const floor = (x, y) => at(Hf, x, y) ?? hFoot;
  const C = {seed, band: B, off, mouth: m, copy: cm, nodes, edges, grid: {x0: gx0, y0: gy0, nx, ny, cell: CELL, D, H: Hf, top: Hr}, inside, floor, top: (x, y) => at(Hr, x, y) ?? hFoot + T.wall, wall: T.wall};
  // its GROUND (world/terrain.js 'cave', set): the floor in the open, rock WALL m over it elsewhere (the band past the grid: solid)
  const rockTop = hFoot + T.wall + 2;
  C.shape = {type: 'cave', mode: 'set', reach: [B.x0 - .01, B.y0 - .01, B.x1 + .01, B.y1 + .01], fn: (x, y) => { const d = at(D, x, y); if (d === null) return rockTop; return d < 0 ? at(Hf, x, y) : at(Hr, x, y); }};
  // the woods' SLOT (world/terrain.js 'cave', cut: it only lowers), drawn uncut past the brow: the overhang
  const sb = slotBox(m);
  const bankAt = (x, y, d) => d < SLOT.bank && tmp[0] < m.brow && height ? height(x, y) - slotSag(m, tmp[0], Math.max(0, d)) : NaN;   // (tmp: its s, set by the caller)
  C.slot = {type: 'cave', mode: 'cut', reach: sb, pts: [[sb[0], sb[1]], [sb[2], sb[3]]], fn: (x, y) => { slotSQ(m, x, y, tmp); const d = slotD(m, tmp[0], tmp[1]); return d <= 0 ? slotFloor(m, tmp[0]) : bankAt(x, y, d); },
    drawn: {fn: (x, y) => { slotSQ(m, x, y, tmp); return Math.abs(tmp[1]) <= m.w / 2 + DRAWN_IN && tmp[0] >= slotHead(m, tmp[1]) - DRAWN_IN && tmp[0] < m.brow ? slotFloor(m, tmp[0]) : bankAt(x, y, slotD(m, tmp[0], tmp[1])); }}};   // (drawn wider than walked: its ground falls away behind the rock, world.js, as a cleft's)
  // where you cross: s = warp along the slot, either copy (features/caves.js)
  C.slotAt = (x, y, out) => {   // out = [s, q, which: 0 none / 1 the woods' / 2 the band's]
    slotSQ(m, x, y, out); if (slotD(m, out[0], out[1]) < .6) { out[2] = 1; return out; }
    slotSQ(cm, x, y, out); if (slotD(cm, out[0], out[1]) < .6) { out[2] = 2; return out; }
    out[2] = 0; return out;
  };
  C.inBand = (x, y) => x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1;
  // the PORTAL (band coords): the copy's slot (past `from` m down it: default all of it) and the cave within PORTAL.r of its foot.
  // world/cave3d.js draws it a second time in the woods (moved back by OFF): the slot you walk down there IS the copy's, and the cave
  // lies under the woods' overhang, so nothing round him changes at the step (features/caves.js sinks the surface away round it);
  // world.js keeps the woods' ground over it out of the shadows' and the lights' casters (light falls in)
  C.portalR = PORTAL.r;
  C.slotSides = SLOT.round + .4;   // (m down the slot: past its head's rounding, its two sides (world/cave3d.js shows them whole in it))
  const fx = cm.x + cm.ux * cm.len, fy = cm.y + cm.uy * cm.len, PQ = [0, 0, 0];
  C.inPortal = (x, y, from = -1) => C.slotAt(x, y, PQ)[2] === 2 ? PQ[0] > from : Math.hypot(x - fx, y - fy) < PORTAL.r;
  C.walls = contour(C.grid);
  // PROPS: crystals at the walls' feet in some rooms (they light the dark), loose rock in the passages
  C.props = [];
  // the RIM: boulders on the slot's banks and round its head, in the woods (world/forest.js lays them as its own rocks): [x, y, big, variant]
  const Rr = mulberry32(mix(seed, 12)), RQ = [0, 0]; C.rim = [];
  for (let t = 0; t < 200 && C.rim.length < 9; t++) {
    const x = sb[0] + Rr() * (sb[2] - sb[0]), y = sb[1] + Rr() * (sb[3] - sb[1]), big = Rr() < .45, v = Rr() * 3 | 0;
    slotSQ(m, x, y, RQ); const d = slotD(m, RQ[0], RQ[1]);
    if (d < (big ? 1 : .35) || d > SLOT.bank || RQ[0] > m.brow - .8 || C.rim.some(r => Math.hypot(r[0] - x, r[1] - y) < (big || r[2] ? 1.8 : 1))) continue;
    C.rim.push([+x.toFixed(2), +y.toFixed(2), big, v]);
  }
  const Rp = mulberry32(mix(seed, 10)), wantC = T.crystals[0] + Math.floor(Rp() * (T.crystals[1] - T.crystals[0] + 1)), rooms = nodes.filter((n, k) => k > 0 && n.room);
  for (let t = 0, got = 0; t < 200 && got < wantC && rooms.length; t++) {
    const n = rooms[Math.floor(Rp() * rooms.length)], a = Rp() * Math.PI * 2;
    let x = n.x, y = n.y; for (let q = 0; q < n.r * 1.6; q += .1) { x = n.x + Math.cos(a) * q; y = n.y + Math.sin(a) * q; if (inside(x, y) > -1.05) break; }   // (a metre off the wall: its rock stands out)
    if (inside(x, y) > -.9 || C.props.some(p => Math.hypot(p[1] - x, p[2] - y) < 1.4)) continue;
    C.props.push(['crystal', +x.toFixed(2), +y.toFixed(2), {breakable: 'crystal', hp: 40, maxHp: 40, stage: 0, r: .4}]); got++;
  }
  for (let t = 0, got = 0; t < 120 && got < 14; t++) {
    const e = edges[1 + Math.floor(Rp() * (edges.length - 1))]; if (!e) break;
    const k = Math.floor(Rp() * (e.pts.length - 1)), f = Rp(), [ax, ay] = e.pts[k], [qx, qy] = e.pts[k + 1], side = Rp() < .5 ? -1 : 1, l = Math.hypot(qx - ax, qy - ay) || 1;
    const x = ax + (qx - ax) * f + (ay - qy) / l * side * (e.hw - .3), y = ay + (qy - ay) * f + (qx - ax) / l * side * (e.hw - .3);
    if (inside(x, y) > -.25 || C.props.some(p => Math.hypot(p[1] - x, p[2] - y) < 1.2)) continue;
    C.props.push(['rock', +x.toFixed(2), +y.toFixed(2), {r: 0, variant: Rp() * 3 | 0}]); got++;
  }
  return C;
}
// a passage from node A to node B (indices ia, ib): its line wandering off the straight a little (a point every ~1.5 m), its floor
// falling evenly from A's to B's
function wobbly(A, Bn, ia, ib, hw, R) {
  const a = Math.atan2(Bn.y - A.y, Bn.x - A.x), ax = A.x + Math.cos(a) * A.r * .5, ay = A.y + Math.sin(a) * A.r * .5, bx = Bn.x - Math.cos(a) * Bn.r * .5, by = Bn.y - Math.sin(a) * Bn.r * .5;
  const L = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(L / 1.5)), ph = R() * 6, amp = TUNE.net.wob * (.5 + R()), pts = [];
  for (let k = 0; k <= n; k++) { const f = k / n, w = Math.sin(f * Math.PI) * Math.sin(f * 4.1 + ph) * amp; pts.push([ax + (bx - ax) * f - Math.sin(a) * w, ay + (by - ay) * f + Math.cos(a) * w]); }
  return {a: ia, b: ib, pts, hw, h0: A.h, h1: Bn.h};
}
// a gentle unevenness in a chamber's floor (m, -.08 .. .14)
const bumps = (x, y, S) => (vnoise(x * .5, y * .5, S + 5) - .4) * .22;
function slotBox(m) {
  const P = [[m.x - m.ux * SLOT.bank, m.y - m.uy * SLOT.bank], [m.x + m.ux * m.len, m.y + m.uy * m.len]], hw = m.w / 2 * (1 + SLOT.wide) + SLOT.bend + SLOT.rag + SLOT.bank + .5;   // (its widest, wandered furthest, and its banks)
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of P) for (const s of [-1, 1]) { const px = x - m.uy * hw * s, py = y + m.ux * hw * s; x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  return [x0 - .3, y0 - .3, x1 + .3, y1 + .3];
}

// ---- the WALLS: the open's outline (D = 0) by marching squares, chained into loops, each travelled so its outside (the open) lies
// at (-ty, tx) of the way along it (cliffs3d.js: the floor on the right), thinned to a point every ~.45 m
function contour(Gd) {
  const {x0, y0, nx, ny, cell, D} = Gd, v = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 1 : D[j * nx + i]);
  const segs = [];
  const P = (i0, j0, i1, j1) => { const a = v(i0, j0), b = v(i1, j1), t = a / (a - b); return [x0 + (i0 + (i1 - i0) * t) * cell, y0 + (j0 + (j1 - j0) * t) * cell]; };
  for (let j = -1; j < ny; j++) for (let i = -1; i < nx; i++) {
    const a = v(i, j) < 0, b = v(i + 1, j) < 0, c = v(i + 1, j + 1) < 0, d = v(i, j + 1) < 0, k = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (k === 0 || k === 15) continue;
    const T = () => P(i, j, i + 1, j), Rr = () => P(i + 1, j, i + 1, j + 1), Bt = () => P(i, j + 1, i + 1, j + 1), L = () => P(i, j, i, j + 1);
    // each segment goes so the open (inside: D < 0) lies on its right (-ty, tx) in these axes (x east, y south)
    switch (k) {
      case 1: segs.push([L(), T()]); break; case 2: segs.push([T(), Rr()]); break; case 3: segs.push([L(), Rr()]); break;
      case 4: segs.push([Rr(), Bt()]); break; case 5: segs.push([L(), T()], [Rr(), Bt()]); break; case 6: segs.push([T(), Bt()]); break;
      case 7: segs.push([L(), Bt()]); break; case 8: segs.push([Bt(), L()]); break; case 9: segs.push([Bt(), T()]); break;
      case 10: segs.push([T(), Rr()], [Bt(), L()]); break; case 11: segs.push([Bt(), Rr()]); break; case 12: segs.push([Rr(), L()]); break;
      case 13: segs.push([Rr(), T()]); break; case 14: segs.push([T(), L()]); break;
    }
  }
  // which way round: the open must lie at (-ty, tx); flip every segment if the sample says otherwise (one test decides for all: the
  // table is consistent)
  const key = p => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
  const okSide = s => { const [[ax, ay], [bx, by]] = s, tx = bx - ax, ty = by - ay, l = Math.hypot(tx, ty) || 1, mx = (ax + bx) / 2 - ty / l * .3, my = (ay + by) / 2 + tx / l * .3;
    const i = Math.round((mx - x0) / cell), j = Math.round((my - y0) / cell); return v(i, j) < 0; };
  let good = 0; for (let k = 0; k < Math.min(segs.length, 200); k++) if (okSide(segs[k])) good++;
  if (good < Math.min(segs.length, 200) / 2) for (const s of segs) s.reverse();
  const from = new Map(), to = new Map(); for (const s of segs) { from.set(key(s[0]), s); to.set(key(s[1]), s); }
  const loops = [], used = new Set();
  for (const s0 of segs) {
    if (used.has(s0)) continue;
    // (back up to where its line begins first: the scan meets a line running against it from its far end, one segment at a time)
    let s = s0, p, n = segs.length; while (n-- > 0 && (p = to.get(key(s[0]))) && !used.has(p) && p !== s0) s = p;   // (n: a loop that doesn't come back round to s0)
    const L = [s[0]]; let cur = s;
    while (cur && !used.has(cur)) { used.add(cur); L.push(cur[1]); cur = from.get(key(cur[1])); }
    if (L.length < 6) continue;
    loops.push(thin(L, .45));
  }
  return loops;
}
// a point every ~step m along a polyline (its corners eased a little by a moving average)
function thin(L, step) {
  const out = [L[0]]; let acc = 0;
  for (let i = 1; i < L.length; i++) { acc += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); if (acc >= step) { out.push(L[i]); acc = 0; } }
  const closed = Math.hypot(L[0][0] - L.at(-1)[0], L[0][1] - L.at(-1)[1]) < .01;
  if (closed && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) > .01) out.push(out[0]);
  const sm = out.map((p, i) => { if (!closed && (i === 0 || i === out.length - 1)) return p; const a = out[(i - 1 + out.length - 1) % (out.length - 1)], b = out[(i + 1) % (out.length - 1)]; return [+((a[0] + 2 * p[0] + b[0]) / 4).toFixed(3), +((a[1] + 2 * p[1] + b[1]) / 4).toFixed(3)]; });
  if (closed) sm[sm.length - 1] = sm[0];
  return sm;
}
