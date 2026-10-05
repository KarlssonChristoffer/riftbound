// BELLS AND PLATES, the SIM (features/bells.js): what is true. Where the stands are, found at RUNTIME on open, flat,
// walkable ground (the map is reworked often: nothing here knows today's coordinates), seeded by the biome (the same layout
// every load of a biome; placed again on a biome change); their props in the registry (the posts are solids; each plate
// and each bell is a DEFLECTOR in sim/projectiles.js: a bullet or an arrow always glances off it, mirror-true); the note
// each bell is tuned to (one pentatonic scale); what rings them (a shot glancing off, an explosion's shock, the pistol whip,
// a tossed can); the CHAINS (one shot off several plates / bells, counted until the shot is gone) and the session's best.
// NESTS: a few stands placed together on purpose: from a standing spot 5-7.5 m off, a shot at the plate glances into a
// bell (bank), or off a second plate into a bell (zigzag), or into a bell and on to another (double: a precise shot).
// Deterministic: its draws come from its own generator (seeded by the biome's name), never Math.random.
//   const S = createBellsSim(host); S.build() / teardown() / update(dt, evs) (one fixed step)
//   S.active, S.ver (bumps on every build), S.stands (plates and bells), S.bells, S.nests, S.rec, S.pending (stands that wait
//   for the player to step off their spot)
// OWNS: its props (kinds bells_plate: a plate's post, a solid; bells_post: a bell's gallows post, a solid; bells_bell: the
//   bell, no collider) and their deflector shapes (sim/projectiles.js setDeflector), the layout, the notes, the chains, the best.
// READS: host (entities near / add / remove, elev, inStream, layout, biome, player, events, ctxO.bounds), world.js (walkable,
//   steep, the water), layout.js TERRAIN (its ramps: kept clear), the trick-shot range's anchor (trickshot/sim.js TUNE.at).
// EMITS: bells.ring / ping / chain (core/events.js).
// BUDGET: off or out of the sandbox: nothing. Standing: per step a pass over the step's events, <= 8 chain records, the cans
//   (only while the trick-shot range stands) x the bells. A build (a biome): ~1-3 ms of placement, once.
import * as W from '../../world/world.js';
import * as LAYOUT from '../../world/layout.js';
import {setMaterials} from '../../content/materials.js';
import {setDeflector} from '../../sim/projectiles.js';
import {mulberry32, nameHash} from '../../core/rng.js';
import {clamp, hypot2, hypot3, TAU} from '../../core/mathx.js';
import {TUNE as TRICK} from '../trickshot/sim.js';
import {SHAPE, bellHitR, bellDrop, plateBasis} from './models.js';

const P = SHAPE.plate, B = SHAPE.bell;
// how high each solid stops arrows and bullets (world.js PROP_TOP: a plate's post ends under its plate; a gallows post at its
// arm); what each is made of (gunfx's impacts; audio)
W.propTop({bells_plate: P.mid - P.h / 2 - .01, bells_post: 1.75});
setMaterials({bells_plate: 'wood', bells_post: 'wood', bells_bell: 'metal'});

export const TUNE = {
  plates: 10, bells: 8,     // stands in all (the nests' included), as many as fit
  // C major pentatonic, two octaves' worth from G4 (Hz; the forge's bell cases, audio/forge/recipes/bell.js NOTES)
  notes: [392, 440, 523.25, 587.33, 659.25, 783.99, 880],
  tilt: 7,                  // deg: a free plate leans this much at most, up or down (the nests' stand straight)
  face: 70,                 // deg: a free plate faces south (the default camera) give or take this: assorted angles you can see
  flat: .12,                // m: the ground round a stand within this of its middle (a terrace's edge, a ramp: no)
  gap: {stand: 3.2, line: 1.1, prop: 1.05, soft: .45, gate: 2.4, spawn: 3.8, mark: 2, ring: .9, lane: 1.6, path: .8, ramp: .8, post: .5, player: .9},
  range: [-4.8, -1.8, 4.8, 6.8],   // m round the trick-shot range's anchor (its fence, crate, plate frame, the mark and the lane between)
  nest: {
    kinds: ['zigzag', 'double', 'bank'],
    shoot: [5, 7.5],        // m from the first plate to the standing spot
    south: 1.05,            // rad either side of due south of the first plate: where the standing spot is (the default camera
                            // looks north: the shot goes up the screen, the plates turn their faces toward you)
    leg: [2.4, 3.6],        // m from a plate to what it sends the shot to
    muzzle: 0,              // m right of the standing spot where the shot's line starts (measured, tmp/xbel: the gunslinger's
                            // aimed shot at a plate passes within 4 cm of the line from where he stands, either side)
    pair: .12,              // m between a double's two bells
    past: 1.3,              // m a kept line runs on past a bell (a near miss flies on: no gallows post there)
    open: [70, 135],        // deg between the way in and the way out at a plate (not face-on, not grazing)
    glance: .5,             // x a bell's radius: how far off its middle the shot is sent (it glances on, not straight back)
    glance2: .76,           // the same for a double's first bell (the middle of the way into the second, beside it)
    level: .3,              // m: the nest's ground within this of the first plate's
  },
  tries: {nest: 2000, free: 1500},
  k: {bullet: 1, arrow: .65, blast: .95, melee: .7, can: .45},   // how hard each rings a bell (x)
  blastR: 1.7,              // x an explosion's r: the bells and plates it rings
};
const SOFT = new Set(['tuft', 'bush', 'rock', 'fern', 'reed', 'grass', 'flower']);
const DEG = Math.PI / 180;

export function createBellsSim(host) {
  const ents = host.entities, events = host.events, NEAR = [];
  const stands = [], bells = [], nests = [], pending = [], byProp = new Map();
  const rec = {best: 0, chains: 0, rings: 0, pings: 0};   // the session's (not stored)
  const chains = [];   // live chain records (pooled): {shot, bells, plates, x, y, h, by, t}
  const pool = [];
  let active = false, ver = 0, cans = null, canMask = null;
  const emit = (type, x, y, o) => { const e = {type, x, y}; if (o) Object.assign(e, o); events.push(e); return e; };
  const L = () => host.layout || {};

  // ================================================================ where things may stand
  // open ground: walkable, dry, not a slope's face
  const wet = (x, y) => host.inStream(x, y) || !!L().inRill?.(x, y) || !!L().inOutflow?.(x, y);
  const open = (x, y) => W.walkable(x, y) && !wet(x, y) && !W.steep?.(x, y);
  const soft = p => SOFT.has(p.kind) && !p.rect && !(p.r > 0);
  const distTo = (p, x, y) => p.rect ? Math.hypot(Math.max(p.rect[0] - x, 0, x - p.rect[2]), Math.max(p.rect[1] - y, 0, y - p.rect[3])) : hypot2(p.x - x, p.y - y) - (p.r > 0 ? p.r : 0);
  function segDist(x, y, x0, y0, x1, y1) {
    const ex = x1 - x0, ey = y1 - y0, l2 = ex * ex + ey * ey, t = l2 > 0 ? clamp(((x - x0) * ex + (y - y0) * ey) / l2, 0, 1) : 0;
    return hypot2(x - x0 - ex * t, y - y0 - ey * t);
  }
  const polyDist = (x, y, pts) => { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])); return d; };
  // the layout's marks, the spawn, the trick-shot range, the climbs, the terrain's ramps: kept clear by m (extra: the stand's reach)
  function marksClear(x, y, ext) {
    const G = TUNE.gap, lay = L();
    for (const m of lay.marks || []) {
      let d = 1e9, need = G.mark;
      if (m.type === 'ring') { d = hypot2(x - m.x, y - m.y) - m.r; need = G.ring; }
      else if (m.type === 'lane') { d = segDist(x, y, m.x0, m.y, m.x1, m.y); need = G.lane; }
      else if (m.type === 'rail') { d = segDist(x, y, m.x0, m.y, m.x1, m.y); need = G.lane; }
      else if (m.type === 'pad') { d = hypot2(x - m.x, y - m.y) - (m.r || 0); need = G.ring; }
      else if (m.type === 'path' && m.pts) { d = polyDist(x, y, m.pts) - (m.w || 1.4) / 2; need = G.path; }
      else if (m.pts) d = polyDist(x, y, m.pts);
      else if (m.x !== undefined && m.y !== undefined) d = hypot2(x - m.x, y - m.y);
      if (d < need + ext) return false;
    }
    if (lay.spawn && hypot2(x - lay.spawn.x, y - lay.spawn.y) < G.spawn + ext) return false;
    const A = TRICK.at, R = TUNE.range;
    if (x > A.x + R[0] - ext && x < A.x + R[2] + ext && y > A.y + R[1] - ext && y < A.y + R[3] + ext) return false;
    for (const q of lay.plateaus || []) for (const c of q.climbs || []) {
      if (Math.abs(x - c.x) < c.w / 2 + 1.6 + ext && y > q.y1 - 1.5 - ext && y < q.y1 + 3.5 + ext) return false;
    }
    for (const t of LAYOUT.TERRAIN || []) if (t.type === 'ramp' && t.pts && polyDist(x, y, t.pts) < (t.w || 1.5) / 2 + TUNE.gap.ramp + ext) return false;
    return true;
  }
  // no solid prop within `gap` of (x, y) + r (soft scatter: within TUNE.gap.soft)
  function propsClear(x, y, r, gap) {
    for (const p of ents.near(x, y, r + gap + 1, NEAR)) {
      if (p.gone || byProp.has(p)) continue;
      if (distTo(p, x, y) < r + (soft(p) ? TUNE.gap.soft : p.kind === 'gatepost' ? TUNE.gap.gate : gap)) return false;
    }
    return true;
  }
  // a stand's spot: open and level round it, clear of props, marks, other stands and the kept lines
  const nw = {}, nf = k => { nw[k] = (nw[k] || 0) + 1; return false; };   // (why nests were turned down: probes)
  const why = {open: 0, marks: 0, level: 0, props: 0, stands: 0, lines: 0, ok: 0};   // (why spots were turned down: probes)
  function spot(x, y, foot, lines, mine = null) {
    if (!open(x, y)) { why.open++; return false; }
    if (!marksClear(x, y, foot)) { why.marks++; return false; }
    const z = host.elev(x, y);
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8, qx = x + Math.cos(a) * (foot + .45), qy = y + Math.sin(a) * (foot + .45);
      if (!open(qx, qy) || Math.abs(host.elev(qx, qy) - z) > TUNE.flat) { why.level++; return false; }
    }
    if (!propsClear(x, y, foot, TUNE.gap.prop)) { why.props++; return false; }
    for (const s of plan) if (!mine?.includes(s) && hypot2(s.x - x, s.y - y) < TUNE.gap.stand) { why.stands++; return false; }
    for (const l of lines) if (segDist(x, y, l[0], l[1], l[2], l[3]) < TUNE.gap.line + foot * .5) { why.lines++; return false; }
    why.ok++;
    return true;
  }
  // a shot from (x0, y0) to (x1, y1) at chest height over ground z: no solid, no higher ground in the way
  function lineClear(x0, y0, x1, y1, z) {
    const n = Math.max(1, Math.ceil(hypot2(x1 - x0, y1 - y0) / .4));
    for (let i = 1; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (host.elev(x, y) > z + .55) return false;
      for (const p of ents.near(x, y, .9, NEAR)) if (!p.gone && !soft(p) && !byProp.has(p) && distTo(p, x, y) < .4) return false;
      for (const s of plan) if (hypot2(s.x - x, s.y - y) < .45 && !(hypot2(s.x - x0, s.y - y0) < .05 || hypot2(s.x - x1, s.y - y1) < .05)) return false;
      for (const s of plan) if (s.kind === 'bell' && s.px && hypot2(s.px - x, s.py - y) < .4) return false;   // (a gallows' post)
    }
    return true;
  }
  // a spot to stand and shoot from: open, nothing solid on it
  function standable(x, y) {
    if (!open(x, y) || !propsClear(x, y, .3, .35)) return false;
    const z = host.elev(x, y);   // (room to stand: not on a ledge's lip)
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6, qx = x + Math.cos(a) * .6, qy = y + Math.sin(a) * .6; if (!open(qx, qy) || Math.abs(host.elev(qx, qy) - z) > .15) return false; }
    return true;
  }

  // ================================================================ the layout (a biome's: the same every time)
  let plan = [], lines = [], R = null;
  const lerpR = (a, b) => a + (b - a) * R();
  function samplePoint(out) {
    const b = host.ctxO?.bounds || {x0: 0, y0: 0, x1: 62, y1: 30};
    for (let k = 0; k < 80; k++) {
      const x = b.x0 + R() * (b.x1 - b.x0), y = b.y0 + R() * (b.y1 - b.y0);
      if (W.walkable(x, y)) { out[0] = x; out[1] = y; return true; }
    }
    return false;
  }
  const plateOf = (x, y, z, yaw, tilt) => ({kind: 'plate', x, y, z, yaw, tilt, basis: plateBasis(yaw, tilt), h: z + P.mid, nest: null});
  function bellOf(x, y, z, note, mid) {
    const drop = bellDrop(note);
    return {kind: 'bell', x, y, z, note, r: bellHitR(note), h: z + mid, pivot: z + mid + drop, px: 0, py: 0, pz: 0, nest: null};
  }
  // the gallows' post: on a side of the bell clear of every kept line, open, nothing solid there
  const POST_WAYS = [0, Math.PI, .4, Math.PI - .4, -.4, Math.PI + .4, .8, Math.PI - .8, -.8, Math.PI + .8, Math.PI / 2, -Math.PI / 2];
  function postFor(s, mine) {
    const flip = R() < .5 ? Math.PI : 0;   // (east or west of the bell first: its arm reads across the default camera's view)
    for (let k = 0; k < POST_WAYS.length; k++) {
      const a = POST_WAYS[k] + flip, qx = s.x + Math.cos(a) * B.arm, qy = s.y + Math.sin(a) * B.arm;
      if (!open(qx, qy) || Math.abs(host.elev(qx, qy) - s.z) > TUNE.flat || !propsClear(qx, qy, .1, .5)) continue;
      let ok = true;
      for (const l of lines) if (segDist(qx, qy, l[0], l[1], l[2], l[3]) < TUNE.gap.post) { ok = false; break; }
      if (ok) for (const o of plan) if (o !== s && !mine?.includes(o) && hypot2(o.x - qx, o.y - qy) < 1.2) { ok = false; break; }
      if (ok && mine) for (const o of mine) if (o !== s && o.kind === 'bell' && (segDist(o.x, o.y, qx, qy, s.x, s.y) < o.r + .1 || (o.px && hypot2(o.px - qx, o.py - qy) < .4))) { ok = false; break; }
      if (!ok) continue;
      s.px = qx; s.py = qy; s.pz = host.elev(qx, qy);
      return true;
    }
    return false;
  }
  // the plate at (px, py) facing so that a shot from (ax, ay) glances to (bx, by): its yaw (the normal's way), or NaN
  function aim(px, py, ax, ay, bx, by) {
    let ix = px - ax, iy = py - ay, l = hypot2(ix, iy); ix /= l; iy /= l;           // the way in
    let ox = bx - px, oy = by - py; l = hypot2(ox, oy); ox /= l; oy /= l;            // the way out
    const c = -(ix * ox + iy * oy), open = Math.acos(clamp(c, -1, 1)) / DEG;        // between the way back and the way out
    if (open < TUNE.nest.open[0] || open > TUNE.nest.open[1]) return NaN;
    return Math.atan2(oy - iy, ox - ix);   // the normal: (out - in), the mirror's
  }
  // where a level shot from (x0, y0) along (ux, uy) meets a bell (cx, cy, r) and its way on (mirrored about the normal there)
  const RAY = {x: 0, y: 0, ux: 0, uy: 0};
  function offBell(x0, y0, ux, uy, cx, cy, r) {
    const fx = x0 - cx, fy = y0 - cy, b = fx * ux + fy * uy, c = fx * fx + fy * fy - r * r, D = b * b - c;
    if (D < 0) return false;
    const t = -b - Math.sqrt(D), hx = x0 + ux * t, hy = y0 + uy * t, nx = (hx - cx) / r, ny = (hy - cy) / r, vn = ux * nx + uy * ny;
    RAY.x = hx; RAY.y = hy; RAY.ux = ux - 2 * vn * nx; RAY.uy = uy - 2 * vn * ny;
    return true;
  }
  const PT = [0, 0];
  // one nest of `kind` (the first plate at a sampled spot; a few standing spots round it, a few ways on from each): its stands
  // and kept lines into plan / lines, or false
  function tryNest(kind) {
    const N = TUNE.nest, PF = .35;
    if (!samplePoint(PT)) return false;
    const px = PT[0], py = PT[1], z = host.elev(px, py);
    if (!spot(px, py, PF, lines)) return nf('p1');
    for (let i = 0; i < 8; i++) {   // the standing spot
      const a0 = Math.PI / 2 + (R() * 2 - 1) * N.south, ds = lerpR(N.shoot[0], N.shoot[1]), sx = px + Math.cos(a0) * ds, sy = py + Math.sin(a0) * ds;
      if (!standable(sx, sy)) { nf('stand'); continue; }
      if (Math.abs(host.elev(sx, sy) - z) > N.level) { nf('standLevel'); continue; }
      if (!lineClear(sx, sy, px, py, z)) { nf('standLine'); continue; }
      let near = false; for (const s of plan) if (hypot2(s.x - sx, s.y - sy) < 1.6) near = true;
      for (const l of lines) if (segDist(sx, sy, l[0], l[1], l[2], l[3]) < 1) near = true;   // (not on another nest's shot)
      if (near) { nf('standNear'); continue; }
      for (let j = 0; j < 6; j++) if (nestFrom(kind, px, py, z, sx, sy, a0)) return true;
    }
    return false;
  }
  function nestFrom(kind, px, py, z, sx, sy, a0) {
    const N = TUNE.nest, PF = .35, BF = .5, mine = [], tag = {kind};
    const level = (x, y) => Math.abs(host.elev(x, y) - z) <= N.level;
    const side = () => R() < .5 ? -1 : 1, turn = () => lerpR(N.open[0], N.open[1]) * DEG * side();
    const NL = [];   // the nest's lines [x0, y0, x1, y1]
    const p1 = plateOf(px, py, z, 0, 0); mine.push(p1);
    // the shot's line starts a little right of where you stand (the gun's muzzle, the gunslinger's, aiming): the sums start there
    const fl = hypot2(px - sx, py - sy), mx = sx - (py - sy) / fl * N.muzzle, my = sy + (px - sx) / fl * N.muzzle;
    let fromX = mx, fromY = my, at = p1, a = a0;   // `a`: the way from the current plate back to where the shot came from
    // zigzag: a second plate first
    if (kind === 'zigzag') {
      const a2 = a + turn(), d = lerpR(N.leg[0], N.leg[1]), qx = px + Math.cos(a2) * d, qy = py + Math.sin(a2) * d;
      if (!level(qx, qy) || !spot(qx, qy, PF, lines, mine) || !lineClear(px, py, qx, qy, z)) return nf('p2');
      const yaw = aim(px, py, mx, my, qx, qy); if (Number.isNaN(yaw)) return nf('aim1');
      p1.yaw = yaw; p1.basis = plateBasis(yaw, 0);
      const p2 = plateOf(qx, qy, z, 0, 0); mine.push(p2); NL.push([px, py, qx, qy]);
      fromX = px; fromY = py; at = p2; a = Math.atan2(py - qy, px - qx);
    }
    // the bell the last plate sends it to (sent glance x r off its middle, so it glances on)
    const a3 = a + turn(), d3 = lerpR(N.leg[0], N.leg[1]), bx = at.x + Math.cos(a3) * d3, by = at.y + Math.sin(a3) * d3;
    if (!level(bx, by) || !spot(bx, by, BF, lines, mine) || !lineClear(at.x, at.y, bx, by, z)) return nf('b1');
    if (segDist(bx, by, sx, sy, px, py) < 1.2) return nf('b1');   // (not by the way in)
    const note1 = kind === 'double' ? (R() * 3) | 0 : 1 + ((R() * 5) | 0), r1 = bellHitR(note1), off = (kind === 'double' ? N.glance2 : N.glance) * r1 * side();
    const ux = (bx - at.x) / d3, uy = (by - at.y) / d3, tx = bx - uy * off, ty = by + ux * off;
    const yaw = aim(at.x, at.y, fromX, fromY, tx, ty); if (Number.isNaN(yaw)) return nf('aim2');
    at.yaw = yaw; at.basis = plateBasis(yaw, 0);
    const b1 = bellOf(bx, by, host.elev(bx, by), note1, z + P.mid - host.elev(bx, by)); mine.push(b1); NL.push([at.x, at.y, bx + ux * N.past, by + uy * N.past]);   // (on past it: a shot that misses it flies on)
    // off the bell: where it goes on (a double: to the second bell, sent glance x r off its middle too)
    let wx = tx - at.x, wy = ty - at.y; const wl = hypot2(wx, wy); wx /= wl; wy /= wl;
    if (!offBell(at.x, at.y, wx, wy, bx, by, r1)) return nf('off');
    if (kind === 'double') {
      // the second hangs right beside the first, where the glance goes (a pair: the nearer it is, the wider the way in)
      const note2 = Math.min(6, note1 + 2 + ((R() * 2) | 0)), r2 = bellHitR(note2), off2 = N.glance * .6 * r2 * side();
      let cx = 0, cy = 0;
      for (let t = r2; t < 1.5; t += .02) {
        cx = RAY.x + RAY.ux * t + RAY.uy * off2; cy = RAY.y + RAY.uy * t - RAY.ux * off2;
        if (hypot2(cx - bx, cy - by) >= r1 + r2 + N.pair) break;
      }
      if (!level(cx, cy) || !spot(cx, cy, BF, lines, mine)) return nf('b2');
      if (segDist(cx, cy, mx, my, px, py) < 1.2 || hypot2(cx - px, cy - py) < 1.8) return nf('b2');
      const b2 = bellOf(cx, cy, host.elev(cx, cy), note2, z + P.mid - host.elev(cx, cy)); mine.push(b2);
      const qx = cx - RAY.x, qy = cy - RAY.y, ql = hypot2(qx, qy) || 1; NL.push([RAY.x, RAY.y, cx + qx / ql * N.past, cy + qy / ql * N.past]);
    }
    NL.push([mx, my, px, py]);   // the shot's way in (nothing else stands where it flies)
    for (const l of NL) { l.nest = tag; lines.push(l); }
    for (const s of mine) { s.nest = tag; plan.push(s); }
    for (const s of mine) if (s.kind === 'bell' && !postFor(s, mine)) { plan.length -= mine.length; lines.length -= NL.length; return nf('post'); }
    nests.push({kind, sx, sy, a: Math.atan2(py - sy, px - sx), stands: mine});
    return true;
  }
  function tryFree(kind) {
    if (!samplePoint(PT)) return false;
    const x = PT[0], y = PT[1], z = host.elev(x, y);
    if (!spot(x, y, kind === 'plate' ? .35 : .5, lines)) return false;
    if (kind === 'plate') { plan.push(plateOf(x, y, z, Math.PI / 2 + (R() * 2 - 1) * TUNE.face * DEG, (R() * 2 - 1) * TUNE.tilt * DEG)); return true; }
    const b = bellOf(x, y, z, (R() * TUNE.notes.length) | 0, B.mid);
    plan.push(b);
    if (!postFor(b, null)) { plan.pop(); return false; }
    return true;
  }
  function layoutFor(id) {
    R = mulberry32(nameHash('bells:' + id));
    plan = []; lines = []; nests.length = 0;
    for (const kind of TUNE.nest.kinds) for (let k = 0; k < TUNE.tries.nest && !tryNest(kind); k++);
    let np = 0, nb = 0;
    for (const s of plan) if (s.kind === 'plate') np++; else nb++;
    for (let k = 0; k < TUNE.tries.free && nb < TUNE.bells; k++) if (tryFree('bell')) nb++;
    for (let k = 0; k < TUNE.tries.free && np < TUNE.plates; k++) if (tryFree('plate')) np++;
    return plan;
  }

  // ================================================================ build / tear down
  const R_BODY = .3;
  function playerOn(s) {
    const pl = host.player, near = (x, y, r) => hypot2(pl.x - x, pl.y - y) < r + R_BODY + TUNE.gap.player;
    return s.kind === 'plate' ? near(s.x, s.y, .05) : near(s.px, s.py, .05) || near(s.x, s.y, s.r);
  }
  function addStand(s) {
    if (s.kind === 'plate') {
      const h = P.post / 2;
      s.p = {kind: 'bells_plate', x: s.x, y: s.y, z: s.z, h: 0, rect: [s.x - h, s.y - h, s.x + h, s.y + h]};
      ents.add(s.p); byProp.set(s.p, s);
      const b = s.basis;
      s.shape = {kind: 'plate', x: s.x, y: s.y, h: s.h, nx: b.nx, ny: b.ny, nh: b.nh, ux: b.ux, uy: b.uy, uh: b.uh, vx: b.vx, vy: b.vy, vh: b.vh, hw: P.w / 2, hh: P.h / 2};
      setDeflector(s.p, s.shape);
    } else {
      const h = B.post / 2;
      s.post = {kind: 'bells_post', x: s.px, y: s.py, z: s.pz, h: 0, rect: [s.px - h, s.py - h, s.px + h, s.py + h]};
      s.p = {kind: 'bells_bell', x: s.x, y: s.y, z: s.z, h: 0, r: s.r};   // (r: you bump into it; arrows and bullets glance off its sphere)
      ents.add(s.post); ents.add(s.p); byProp.set(s.p, s); byProp.set(s.post, s);
      s.shape = {kind: 'bell', x: s.x, y: s.y, h: s.h, r: s.r};
      setDeflector(s.p, s.shape);
      s.i = bells.length; bells.push(s);
    }
    stands.push(s); s.up = true;
  }
  function build() {
    if (active) return;
    active = true; ver++;
    const id = host.biome?.id || 'ruins';
    for (const s of layoutFor(id)) { s.up = false; if (playerOn(s)) pending.push(s); else addStand(s); }
    rec.layout = id;
  }
  function teardown() {
    if (!active) return;
    active = false; ver++;
    for (const s of stands) {
      setDeflector(s.p, null); ents.remove(s.p); byProp.delete(s.p);
      if (s.post) { ents.remove(s.post); byProp.delete(s.post); }
      s.up = false;
    }
    stands.length = bells.length = pending.length = 0; nests.length = 0;
    for (const c of chains) pool.push(c); chains.length = 0;
  }

  // ================================================================ what rings them
  function ring(s, k, by, dx, dy) {
    rec.rings++;
    emit('bells.ring', s.x, s.y, {h: s.h, k: clamp(k, .05, 1), note: s.note, who: s.p, by, dx, dy});
  }
  function ping(s, x, y, h, k, by) { rec.pings++; emit('bells.ping', x, y, {h, k: clamp(k, .05, 1), who: s.p, by}); }
  // a chain record for a shot (found or begun)
  function chainOf(shot, by) {
    for (let i = 0; i < chains.length; i++) if (chains[i].shot === shot) return chains[i];
    const c = pool.pop() || {shot: null, bells: 0, plates: 0, x: 0, y: 0, h: 0, by: '', t: 0};
    c.shot = shot; c.bells = c.plates = 0; c.by = by; c.t = 0; chains.push(c);
    return c;
  }
  function finish(c) {
    const n = c.bells + c.plates;
    if (c.bells >= 2 || n >= 2) {
      const best = c.by !== 'blast' && n > rec.best;
      if (best) rec.best = n;
      rec.chains++;
      emit('bells.chain', c.x, c.y, {h: c.h, bells: c.bells, plates: c.plates, n, by: c.by, best, rec: rec.best});
    }
    c.shot = null;
  }
  function deflected(e, by) {
    const s = byProp.get(e.who); if (!s || s.p !== e.who) return;
    const c = e.shot ? chainOf(e.shot, by) : null;
    if (s.kind === 'bell') {
      const k = by === 'bullet' ? TUNE.k.bullet * clamp(1.08 - .08 * (e.n || 1), .5, 1) : TUNE.k.arrow * clamp((e.v || 15) / 22, .4, 1.2);
      ring(s, k, by, e.dx || 0, e.dy || 0);
      if (c) c.bells++;
    } else {
      ping(s, e.x, e.y, e.h, by === 'bullet' ? 1 : .6, by);
      if (c) c.plates++;
    }
    if (c) { c.x = e.x; c.y = e.y; c.h = e.h; }
  }
  function blast(e) {
    const r = (e.r || 2) * TUNE.blastR, c = chainOf(e, 'blast');   // (the event stands for its blast: one record, finished below)
    for (const s of stands) {
      if (!s.up) continue;
      const d = hypot2(s.x - e.x, s.y - e.y); if (d > r) continue;
      const k = TUNE.k.blast * (1 - d / r) * .85 + .15;
      if (s.kind === 'bell') { const l = d || 1; ring(s, k, 'blast', (s.x - e.x) / l, (s.y - e.y) / l); c.bells++; c.x = s.x; c.y = s.y; c.h = s.h + .3; }
      else ping(s, s.x, s.y, s.h, k * .7, 'blast');
    }
    finish(c); chains.splice(chains.indexOf(c), 1); pool.push(c);
  }
  function whip(e) {
    const ux = e.vx || 0, uy = e.vy || 0, reach = (e.reach || 1.5) + .25, cosA = Math.cos((e.arc || 80) / 2 * DEG), chest = (e.z || 0) + 1.2;
    for (const s of stands) {
      if (!s.up) continue;
      const dx = s.x - e.x, dy = s.y - e.y, d = hypot2(dx, dy);
      if (d > reach + (s.r || .22) || Math.abs(s.h - chest) > .7) continue;
      if (d > .2 && (dx * ux + dy * uy) / d < cosA) continue;
      if (s.kind === 'bell') ring(s, TUNE.k.melee, 'melee', ux, uy); else ping(s, s.x, s.y, s.h, .5, 'melee');
    }
  }
  // a tossed can (the trick-shot range's) through a bell: rung once as it goes in
  function stepCans() {
    if (!cans || !cans.length || !bells.length) return;
    if (!canMask || canMask.length < bells.length) canMask = new Uint8Array(16);
    for (let j = 0; j < cans.length && j < 8; j++) {
      const q = cans[j], bit = 1 << j;
      for (let i = 0; i < bells.length; i++) {
        const s = bells[i];
        const inside = !q.gone && s.up && hypot3(q.x - s.x, q.y - s.y, (q.h || 0) + .05 - s.h) < s.r + .1;
        if (inside && !(canMask[i] & bit)) { canMask[i] |= bit; ring(s, TUNE.k.can, 'can', 0, 0); }
        else if (!inside) canMask[i] &= ~bit;
      }
    }
  }

  // ================================================================ the aim (the player's hover chain: adapter.js hoverTarget)
  // The cursor over a plate or a bell aims AT it (a shot at open ground slopes down to ~.6 of the muzzle's height at the
  // cursor: it would pass under a plate). A plate: its middle (a mirror: where on it doesn't matter, and a nest's sums
  // assume it). A bell: the point under the cursor on it (where it is struck sets where the shot glances to). The front-most
  // under the cursor; the cursor read through the camera, as every aim is (sim input)
  const AT = {x: 0, y: 0, h: 0, target: null}, S0 = [0, 0, 0], SX = [0, 0, 0], SY = [0, 0, 0], SH = [0, 0, 0];
  function aimTarget() {
    if (!active || !stands.length) return null;
    const G = host.G, z = host.zoom || 1, mx = host.VW / 2 + (host.mouse.x - host.VW / 2) * z, my = host.VH / 2 + (host.mouse.y - host.VH / 2) * z;
    let best = null, near = -1e9, bm = 0, bh = 0, wx = 0, wy = 0;
    for (let i = 0; i < stands.length; i++) {
      const s = stands[i]; if (!s.up) continue;
      G.toScreenInto(s.x, s.h, s.y, S0);
      const dx = mx - S0[0], dy = my - S0[1]; if (dx * dx + dy * dy > 2500 * z * z) continue;   // (well off it: no more sums)
      // the screen's axes here: metres along the view's right (level) per px, metres up per px
      G.toScreenInto(s.x + 1, s.h, s.y, SX); G.toScreenInto(s.x, s.h, s.y + 1, SY); G.toScreenInto(s.x, s.h + 1, s.y, SH);
      const ax = SX[0] - S0[0], ay = SX[1] - S0[1], bx = SY[0] - S0[0], by = SY[1] - S0[1], cy = SH[1] - S0[1];
      let rx = by, ry = -ay; const rl = hypot2(rx, ry) || 1; rx /= rl; ry /= rl;
      let px = ax * rx + bx * ry; if (px < 0) { rx = -rx; ry = -ry; px = -px; }
      if (!(px > 1e-6) || !(Math.abs(cy) > 1e-6)) continue;
      const dm = dx / px, dh = dy / cy;   // m along the right, m up
      let hit;
      if (s.kind === 'plate') hit = Math.abs(dm) <= P.w / 2 * Math.abs(s.basis.ux * rx + s.basis.uy * ry) + .07 && Math.abs(dh) <= P.h / 2 + .05;
      else hit = dm * dm + dh * dh <= s.r * s.r * 1.3;
      if (!hit) continue;
      G.toScreenInto(s.x, s.z, s.y, S0);   // nearer the camera: lower on the screen
      if (S0[1] <= near) continue;
      near = S0[1]; best = s; bm = dm; bh = dh; wx = rx; wy = ry;
    }
    if (!best) return null;
    const s = best;
    if (s.kind === 'plate') { AT.x = s.x; AT.y = s.y; AT.h = s.h; }
    else { const l = Math.hypot(bm, bh), k = l > s.r * .9 ? s.r * .9 / l : 1; AT.x = s.x + wx * bm * k; AT.y = s.y + wy * bm * k; AT.h = s.h + bh * k; }
    AT.target = s.p;
    return AT;
  }

  // ================================================================ the step
  function update(dt, evs) {
    if (pending.length) for (let i = pending.length - 1; i >= 0; i--) if (!playerOn(pending[i])) { addStand(pending[i]); pending.splice(i, 1); }
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      switch (e.type) {
        case 'bullet.ricochet': if (e.defl) deflected(e, 'bullet'); break;
        case 'arrow.deflect': deflected(e, 'arrow'); break;
        case 'combat.explode': blast(e); break;
        case 'player.melee': whip(e); break;
      }
    }
    stepCans();
    for (let i = chains.length - 1; i >= 0; i--) {
      const c = chains[i]; c.t += dt;
      const a = c.shot;
      if (a.life <= -9 || a.stuck || a.life <= 0 || c.t > 3) { finish(c); chains.splice(i, 1); pool.push(c); }
    }
  }
  return {
    build, teardown, update, aimTarget, TUNE,
    set cans(q) { cans = q; },
    get active() { return active; }, get ver() { return ver; },
    stands, bells, nests, pending, rec, byProp, why, nw,
    get lines() { return lines; },
  };
}
