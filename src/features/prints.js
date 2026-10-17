// PRINTS (docs/WINTER.md "Tracks"): the one owner of footprints and tracks in the world. Everything that walks leaves its prints
// here: him (his steps), every friend (their snapshots), the forest's ground animals (features/fauna.js's, read), and any other
// feature that stamps its own (a meal's glowing prints, a living animal's muddy track). Kinds and knobs: content/prints.js.
//   THE RING   TUNE.max prints in typed arrays, the oldest overwritten first; no object per print, nothing allocated a frame
//   WEAR       a print goes from 0 (fresh) to 1 (gone) by its surface's wear clock (snow: snowfall fills it, or the thaw takes
//              it; mud: in-game hours; glow: seconds). One clock a surface, never a tick per print
//   VIEW       presentation only (each client its own prints, as the brief says: a late joiner doesn't see old tracks): stamped
//              in view, drawn in frame into the ground layer (G.glayer('ground'), GPU quads: the shade replaces the ground's colour
//              before the light, so the lying snow and the light fall on it as on the ground round it)
// Only in the persistent world (the sandbox's ruins biome: the forest); ?tracks=0: none.
// API (host.feature('prints')):
//   F.stamp(x, y, z, dx, dy, shape, surf = 'snow', o?) -> index | -1   one print at (x, y, z) facing (dx, dy) (need not be a unit);
//        shape a content/prints.js SHAPES name; o: {deep (wear starts at 0, else at TUNE's walking shade), col ('#rrggbb', this
//        print's own colour on a surface with one), key (any number of yours: near() hands it back)}
//   F.walk(key, x, y, z, shape, surf?, o?)   a walker's prints: call it every frame with where it is (key: anything that stays the
//        same for that walker: an object, a string); it stamps one each stride along the way it went, left / right by the shape.
//        surf omitted: the surface under it by F.surfaceAt (none there: no print, the walk restarts). Off the ground (z over it): none
//   F.forget(key)   drop a walker's state (it left)
//   F.surfaceAt(x, y, z) -> 'snow' | null   the default surface (snow lying, not on water, not in the cave); F.rule(fn) adds a rule
//        tried first (fn(x, y, z) -> a surface name or null: a living animal's mud on wet ground)
//   F.surface(name, def)   another feature's surface, at load (SURF's fields)
//   F.wear(surf, k)   wear every print on that surface by k (1 = a whole print's worth: heavy rain washing mud out)
//   F.near(x, y, r, out) -> out   the live prints within r m: indices into F.X, F.Y, F.DX, F.DY (its way, a unit), F.SH (shape's
//        index in F.shapes), F.SU (surface's index in F.surfs), F.KEY (o.key); F.wearOf(i) 0..1. For "is there a track here",
//        not every frame over a big r (it walks the ring)
//   F.clear(surf?)   all prints (or that surface's) gone
// OWNS: the ring, the walkers' state, the wear clocks. READS: host.player, host.env (snowCover, sky.snow, t), host.elev, host.inStream,
//   caves (down), coop (the peers' snapshots), fauna (animals: x, y, z, h, sp, gone). EMITS: nothing.
// BUDGET: view ~.02 ms (a walker each friend and animal near); frame ~.1 ms at 1000 prints on screen (a few quads each).
import {SHAPES, SURF, TRACK, TUNE, SNOW_SHADE} from '../content/prints.js';
import {flags} from '../core/flags.js';
import {hex255} from '../core/color.js';

const ON = flags.get('tracks') !== '0';

// ORDER (core/features.js): after the animals and co-op moved this frame (their walkers stamp where they are now)
export const order = {after: ['fauna', 'coop', 'caves']};

export async function create(host) {
  const game = () => host.feature('game');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const N = TUNE.max;
  const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), DX = new Float32Array(N), DY = new Float32Array(N);
  const W0 = new Float64Array(N), SH = new Uint8Array(N), SU = new Uint8Array(N), C = new Uint32Array(N), KEY = new Float64Array(N);
  const LIVE = new Uint8Array(N);
  let head = 0, count = 0;
  // shapes and surfaces by index (the ring keeps bytes)
  const shapes = [], shapeIx = new Map(), surfs = [], surfIx = new Map();
  for (const [name, s] of Object.entries(SHAPES)) { shapeIx.set(name, shapes.length); shapes.push({name, ...s, n: s.dots ? s.dots.length : 0}); }
  const WEAR = [];   // each surface's wear clock (grows only)
  function surface(name, def) {
    if (surfIx.has(name)) return surfIx.get(name);
    const i = surfs.length, c = def.col ? hex255(def.col) : null;
    surfs.push({name, ...def, rgb: c ? (c[0] << 16 | c[1] << 8 | c[2]) : 0}); surfIx.set(name, i); WEAR.push(0);
    return i;
  }
  for (const [name, d] of Object.entries(SURF)) surface(name, d);
  const SNOW = surfIx.get('snow');
  const SHADE = SNOW_SHADE.map(([w, c]) => [w, hex255(c)]);
  const rules = [];
  let caves = null, coop = null, fauna = null;

  const F = {name: 'prints', label: 'Footprints and tracks', on: true, X, Y, DX, DY, SH, SU, KEY, shapes, surfs, count: 0, drawn: 0};
  const wearOf = i => Math.min(1, WEAR[SU[i]] - W0[i]);
  F.wearOf = wearOf;

  F.surfaceAt = (x, y, z) => {
    for (const r of rules) { const s = r(x, y, z); if (s) return s; }
    const E = host.env;
    if (!E || E.snowCover < TUNE.snow || caves?.down) return null;
    if (host.inStream?.(x, y)) return null;   // (water: the lake ice's walkable snow comes back with the ice: features/ice.js stops inStream there)
    return 'snow';
  };
  F.rule = fn => { rules.push(fn); };
  F.surface = (name, def) => surface(name, def);
  F.wear = (surf, k) => { const i = surfIx.get(surf); if (i !== undefined && k > 0) WEAR[i] += k; };

  F.stamp = (x, y, z, dx, dy, shape, surf = 'snow', o) => {
    if (!ON) return -1;
    const sh = shapeIx.get(shape), su = surfIx.get(surf); if (sh === undefined || su === undefined) return -1;
    const l = Math.hypot(dx, dy) || 1, i = head;
    head = (head + 1) % N; if (count < N) count++;
    X[i] = x; Y[i] = y; Z[i] = z; DX[i] = dx / l; DY[i] = dy / l; SH[i] = sh; SU[i] = su; KEY[i] = o?.key ?? 0;
    // a walked print starts one shade in (a run or a landing goes in deep: o.deep)
    W0[i] = WEAR[su] - (o?.deep || su !== SNOW ? 0 : SNOW_SHADE[0][0] + .01);
    const c = o?.col ? hex255(o.col) : null; C[i] = c ? (c[0] << 16 | c[1] << 8 | c[2]) + 1 : 0;   // (+1: 0 is "the surface's")
    LIVE[i] = 1;
    return i;
  };

  // ---- WALKERS: where each was at its last print, and which foot is next
  const walkers = new Map();
  F.walk = (key, x, y, z, shape, surf, o) => {
    if (!ON) return;
    const S = SHAPES[shape]; if (!S) return;
    let w = walkers.get(key);
    if (!w) { w = {x, y, foot: 1, t: T, on: false, seen: T}; walkers.set(key, w); return; }
    w.seen = T;
    const g = host.elev(x, y);
    if (z - g > .15) { w.on = false; return; }   // (in the air: the landing starts it again)
    const dx = x - w.x, dy = y - w.y, d = Math.hypot(dx, dy);
    if (!w.on) { w.x = x; w.y = y; w.t = T; w.on = true; return; }
    if (d < S.stride) return;
    if (d > S.stride * 6) { w.x = x; w.y = y; w.t = T; return; }   // (a jump of the snapshot, a teleport: no line of prints across it)
    const ux = dx / d, uy = dy / d, sp = d / Math.max(1e-3, T - w.t);
    w.x = x; w.y = y; w.t = T;
    const side = S.pair ? (w.foot = -w.foot) * S.side : 0, px = x + uy * side, py = y - ux * side;   // (left of the way: (dy, -dx))
    const su = surf || F.surfaceAt(px, py, g); if (!su) return;
    DEEP.deep = sp > TUNE.run; DEEP.col = o?.col; DEEP.key = o?.key;
    F.stamp(px, py, g, ux, uy, shape, su, DEEP);
  };
  const DEEP = {deep: false, col: undefined, key: undefined};
  F.forget = key => { walkers.delete(key); };

  F.near = (x, y, r, out) => {
    const r2 = r * r;
    for (let k = 0; k < count; k++) { const i = (head - 1 - k + N) % N; if (!LIVE[i]) continue; const ax = X[i] - x, ay = Y[i] - y; if (ax * ax + ay * ay <= r2 && wearOf(i) < 1) out.push(i); }
    return out;
  };
  F.clear = surf => {
    if (surf === undefined) { LIVE.fill(0); walkers.clear(); count = 0; head = 0; return; }
    const su = surfIx.get(surf); if (su === undefined) return;
    for (let i = 0; i < N; i++) if (SU[i] === su) LIVE[i] = 0;
  };

  // ---- the wear clocks: the snow's by the snowfall and the thaw, the others by their own time
  let T = 0, lastH = NaN;
  function wearClocks(dt) {
    const E = host.env, h = E?.t ?? 0; let dh = Number.isFinite(lastH) ? h - lastH : 0; lastH = h;
    if (!(dh > 0) || dh > 6) dh = 0;   // (a jump of the clock: the replayed ground's snow cover decides below, not the jump)
    const snow = E?.sky?.snow || 0;
    WEAR[SNOW] += snow * dh / TUNE.fill + (!E || E.snowCover < TUNE.snow ? dt / TUNE.thaw : 0);
    for (let s = 0; s < surfs.length; s++) { const d = surfs[s]; if (d.life) WEAR[s] += dt / d.life; if (d.hours) WEAR[s] += dh / d.hours; }
  }

  const PL = {x: 0, y: 0, z: 0, phi: 0};
  F.view = (dt, evs) => {
    if (!active()) return;
    dt = Math.min(.1, Math.max(0, dt || 0)); T += dt;
    caves ??= host.feature('caves') || false; coop ??= host.feature('coop') || false; fauna ??= host.feature('fauna') || false;
    wearClocks(dt);
    // him: his own steps (the foot's moment, its side)
    const P = host.player, sp = Math.hypot(P.vx, P.vy);
    if (sp > .3) { dirX = P.vx / sp; dirY = P.vy / sp; }
    for (const e of evs || []) {
      if (e.type !== 'player.step' && e.type !== 'player.land') continue;
      const z = e.z ?? host.elev(e.x, e.y), side = e.foot === 'R' ? -1 : e.foot === 'L' ? 1 : 0, x = e.x + dirY * side * SHAPES.boot.side, y = e.y - dirX * side * SHAPES.boot.side;
      const su = F.surfaceAt(x, y, z); if (!su) continue;
      ME.deep = e.type === 'player.land' || sp > TUNE.run;
      F.stamp(x, y, z, dirX, dirY, 'boot', su, ME);
    }
    // friends: from their snapshots
    const Cn = coop?.net;
    if (Cn) for (const q of Cn.peers.values()) { if (!q.n) continue; Cn.sample(q, PL); F.walk(q, PL.x, PL.y, PL.z, 'boot'); }
    // the forest's ground animals, near him (fauna simulates those)
    const A = fauna?.on ? fauna.animals : null;
    if (A) for (const a of A) { const s = TRACK[a.sp]; if (!s || a.gone || a.h > .05 || Math.abs(a.x - P.x) > 40 || Math.abs(a.y - P.y) > 40) continue; F.walk(a, a.x, a.y, a.z, s); }
    if ((sweep -= dt) <= 0) { sweep = 5; for (const [k, w] of walkers) if (T - w.seen > 5) walkers.delete(k); }   // (a friend who left, an animal out of range)
    F.count = count;
  };
  let sweep = 5;
  let dirX = 1, dirY = 0;
  const ME = {deep: false};

  // ---- DRAW: each live print on screen, its shape turned with its way as seen on screen, in the ground layer
  let VW = 1, VH = 1;
  F.resize = (w, h) => { VW = w; VH = h; };
  const V = {ox: 0, oy: 0, xx: 1, xy: 0, yx: 0, yy: 1, hx: 0, hy: -1, z: 1};
  F.frame = () => {
    F.drawn = 0;
    if (!active() || !count) return;
    const o = host.toView(0, 0, 0), a = host.toView(1, 0, 0), b = host.toView(0, 1, 0), hh = host.toView(0, 0, 1);
    V.ox = o[0]; V.oy = o[1]; V.xx = a[0] - o[0]; V.xy = a[1] - o[1]; V.yx = b[0] - o[0]; V.yy = b[1] - o[1]; V.hx = hh[0] - o[0]; V.hy = hh[1] - o[1]; V.z = host.zoom || 1;
    const z = V.z, m = 4 * z;
    let q = null, qe = null, drawn = 0;
    for (let k = 0; k < count && drawn < TUNE.draw; k++) {
      const i = (head - 1 - k + N) % N; if (!LIVE[i]) continue;
      const wr = wearOf(i); if (wr >= 1) { LIVE[i] = 0; continue; }
      const Xs = Math.floor(V.ox + X[i] * V.xx + Y[i] * V.yx + Z[i] * V.hx), Ys = Math.floor(V.oy + X[i] * V.xy + Y[i] * V.yy + Z[i] * V.hy);
      if (Xs < -m || Ys < -m || Xs > VW + m || Ys > VH + m) continue;
      const S = surfs[SU[i]];
      let rgb = C[i] ? C[i] - 1 : S.rgb, al = 1;
      if (!S.col && !C[i]) { let t = SHADE[SHADE.length - 1][1]; for (const sd of SHADE) if (wr < sd[0]) { t = sd[1]; break; } rgb = t[0] << 16 | t[1] << 8 | t[2]; }
      else if (S.fade && wr > 1 - S.fade) al = Math.max(0, (1 - wr) / S.fade);
      q ??= host.glayer('ground');
      q.globalAlpha = al;
      // its way on screen, snapped to eight
      const sx = DX[i] * V.xx + DY[i] * V.yx, sy = DX[i] * V.xy + DY[i] * V.yy, sl = Math.hypot(sx, sy) || 1, ux = Math.round(sx / sl), uy = Math.round(sy / sl);
      const r = rgb >> 16 & 255, g = rgb >> 8 & 255, bl = rgb & 255, sh = shapes[SH[i]];
      if (!sh.n) {   // the boot: 3 x 1 across the screen, 1 x 2 up it, two px on a slant
        if (ux !== 0 && uy === 0) q.fillRectRGB(Xs - z, Ys, 3 * z, z, r, g, bl);
        else if (ux === 0) q.fillRectRGB(Xs, Ys - z, z, 2 * z, r, g, bl);
        else { q.fillRectRGB(Xs, Ys, z, z, r, g, bl); q.fillRectRGB(Xs - ux * z, Ys - uy * z, z, z, r, g, bl); }
      } else for (let j = 0; j < sh.n; j++) {   // dots: [along, across] (across = the way turned left on screen: (uy, -ux))
        const d = sh.dots[j]; q.fillRectRGB(Xs + (d[0] * ux + d[1] * uy) * z, Ys + (d[0] * uy - d[1] * ux) * z, z, z, r, g, bl);
      }
      if (S.emit) { qe ??= host.glayer('emit'); qe.globalAlpha = al * .8; qe.fillRectRGB(Xs, Ys, z, z, r, g, bl); }
      drawn++;
    }
    if (q) q.globalAlpha = 1; if (qe) qe.globalAlpha = 1;
    F.drawn = drawn;
  };
  F.biomeChanged = () => F.clear();
  F.hud = () => '';
  F.counts = () => ({prints: count, drawn: F.drawn, walkers: walkers.size});
  F.menu = () => active() ? [{label: `Tracks: clear all (${count} prints)`, run: () => F.clear()}] : [];
  return F;
}
