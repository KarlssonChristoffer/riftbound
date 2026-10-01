// FLOW: motion and feel on what the player already does. OWNER: ambience session ("Game demo improvements
// brainstorm"), flow agent. SHOW ONLY: the player's movement, aim and arrows are untouched.
//
//   camera      a spring instead of the plain ease: leans toward the aim while drawing the bow, a small kick back on
//               release, a dip on hard landings (land big / fall), a little overshoot before settling. Pixel-snapped
//               like before (the host draws the world at integer cam.x / cam.y, the player at round(pxs - cam.fx))
//   motion      sprint speed streaks (1 px lines peeling off the body, in the biome's light tone), a short afterimage
//               trail on the dodge roll (2-3 flat-tinted silhouettes of earlier frames, behind the player)
//   arrow light at dusk / night a flying arrow carries a small warm light that sweeps over the ground (at most 2 arrows
//               at once, small radius: every point light also casts shadows, capped at 6 per surface). The arrow's AIR
//               STREAK already exists (player.js drawPixelArrow + the host's AE emitter layer): don't add a second one
//   marks       ground decals that stay a minute or two and fade in steps: skid scuffs (P.skid), roll scrapes, turn
//               plants, scorch rings (explode events), splinters / holes where arrows struck (stuck arrows, walls),
//               wet footprints and drips for a while after leaving the stream (splash events). atmos.js already makes
//               snow footprints (frost) and step dust: don't duplicate those
//   the Ranger  breath puffs in the cold (frost, and at night elsewhere; faster after sprinting), drips after a
//               splash, sparks lifting off the cloak in ember
//
// CONTRACT (the host, arena.html, calls exactly these):
//   export function createFlow(ctx, host) -> F
//   F.on / F.toggle()            key 8; ?flow=0 starts off (off = the old camera ease, no marks / trails)
//   F.ms                         rolling average cost per frame (ms)
//   F.setBiome(id), F.setTime(name)
//   F.update(dt, evs)            every simulation step (evs: this frame's events: step / land / jump / splash / hit /
//                                break / explode / ...)
//   F.camera(cam, tx, ty, dt) -> bool
//                                move cam.fx / cam.fy toward the host's target (tx, ty: view px of the top-left, already
//                                clamped to the world, with the host's velocity look-ahead) and return true; return false
//                                to let the host run its old ease. Keep the result inside [0, WPX - VW] x [0, HPX - VH].
//   F.drawGround(g, cam)         after the ground (before shadows / sprites): decals
//   F.sortables(cam) -> [{y, draw(g)}]   depth-sorted with props / player (afterimages: just behind the player's y)
//   F.drawFront(g, cam)          after sprites, before lighting: streaks, breath, drips, sparks (they get lit)
//   F.emitters(cam) -> [{img, x, y}]     glowing bits after lighting (ember sparks)
//   F.lights() -> [...]          arrow lights (dusk / night only)
//
// host: see the AMBIENCE HOST block in arena.html (P, mouse, cursorAim(), shots(), player(), drawPlayer(q, x, y),
// arrows, time(), biome(), mood(), elev, inStream). ctx = {PPM, PPMY, PPMH, toS(x, y, h), WM, HM, WPX, HPX, VW, VH, ...}.
//
// ART RULES (same as biomes.js / atmos.js): 1 texel = 1 screen px, no AA / dither / gradients on the pixel canvas;
// fading = stepping through darker / closer-to-ground palette entries; glow only through emitters().
//
// HOW IT WORKS
//   Camera    two springs, integrated in 1/120 s substeps: a FOLLOW spring (omega CAM.w, zeta CAM.z) toward the host's
//             target + the aim lean + a sprint / roll lead, with a fraction (CAM.ff) of the player's own measured view
//             velocity fed into its damping so the running framing matches the old ease (lag ~ 0.11 x speed, same as
//             exp(-9 dt)); and a stiff PUNCH spring (CAM.pw / CAM.pz) that only carries impulses (bow kick, landing dip)
//             and rings back to 0. Output: the player's screen offset round(pxs - cam.fx) is held with a hysteresis of
//             CAM.hyst px (it only changes when the spring has moved > 0.5 + hyst px away), and cam.fx = pxs - offset. At
//             any steady speed the player keeps his screen pixel and the world scrolls in whole pixels with him: no
//             +-1 px toggling, sub-pixel overshoot never shows. dt >= CAM.snap (sheet modes pass 10) snaps.
//   Marks     decals in world px (per-pixel tone index into a biome multiply ramp, deep -> faint), each stepping one
//             tone fainter every `st` seconds until gone. They are baked into ONE world-sized layer (white = no change;
//             marks go in with 'darken', so overlapping marks never stack darker than their darkest tone) and only the
//             pixels of decals that changed are repainted (dirty rects); each frame
//             draws the view's part of that layer with 'multiply' (one drawImage) when a decal is on screen. Every pixel
//             is checked at creation: not on the stream, same terrain level (no marks hanging over the cliff lip).
//   Particles world-space, 1 px, palette-stepped: sprint streaks, breath, drips (+ a tiny splash), ember sparks, and
//             fresh embers in a new scorch (opaque base pixel + an emitter pixel so they glow at night).
//   Ghosts    during a roll, every GHOST.every s (and >= 6 px apart) the current frame (host.drawPlayer: body + cloak)
//             is drawn into a pooled scratch canvas in drawGround (before the player's own draw) and flattened with
//             'source-in' to a biome tint; the newest 3 are sortables just behind the player, stepped alpha .35/.2/.1.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const hsh = (a, b = 0, c = 0) => {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296;
};
const vn = (x, y, s = 0) => {   // value noise (blobby clusters, never per-pixel dither)
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hsh(xi, yi, s), b = hsh(xi + 1, yi, s), c = hsh(xi, yi + 1, s), d = hsh(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

// ---------------- tunables (live: __demo.flow.T) ----------------
const TUNE = {
  cam: {w: 9, z: .8, ff: .38,             // follow spring: omega (rad/s), damping ratio, fed-forward share of the player's speed
    pw: 24, pz: .55,                      // punch spring (kicks / dips): stiff, rings back fast
    hyst: .35, snap: .25,                 // screen-offset hysteresis (px over the 0.5 rounding); dt >= snap: jump to the target
    leanX: 22, leanY: 14, leanRX: 150, leanRY: 90, leanIn: 2.6, leanOut: 2.2,   // aim lean: max px, cursor px for full lean, 1/s
    kick: 2.6, dip: 3, dipSoft: 1.2,      // px peaks: bow kick (opposite the shot), hard landing dip, a leap's landing
    sprintLead: 12, rollLead: 16, leadRate: 5},   // extra px ahead at a full sprint / in a roll, ease rate 1/s
  streak: {rate: 18, speed: 5.5, life: [.15, .25], len: [3, 6]},
  ghost: {every: .05, keep: .18, gap: 6, alpha: [.35, .2, .1]},
  light: {radius: 1.8, dusk: .38, night: .5, max: 2},
  marks: {cap: 250},
  breath: {every: [2, 3], fast: .8, heat: 4},
  wet: {prints: 8, drips: 4},
};

// ---------------- palettes ----------------
// marks: MULTIPLY tones, deep -> faint. A pixel's tone index grows by one each stage; past the end it is gone.
const MARK = {
  ruins: ['#7a6e60', '#948878', '#aea496', '#c6beb2', '#ddd8d0'],
  ember: ['#5a504e', '#766c68', '#948c88', '#b2acaa', '#cecac8'],
  frost: ['#7e8ea8', '#96a4bc', '#aebacc', '#c6cedc', '#dce2ec'],   // blue-grey slush
  rift: ['#726290', '#8a7ca6', '#a498bc', '#beb4d0', '#d8d0e4'],
};
const SCORCH = {
  ruins: ['#857a6e', '#9a9084', '#aea69a', '#c2bcb2', '#d6d2ca', '#e8e6e0'],
  ember: ['#6a5e5c', '#7e7472', '#948c8a', '#aca6a4', '#c4c0be', '#dcd8d6'],
  frost: ['#7686a2', '#8a9ab4', '#a0acc4', '#b6c0d2', '#ccd4e0', '#e0e6ee'],   // melted: wet blue-grey slush
  rift: ['#665888', '#7a6e9a', '#9086ae', '#a8a0c2', '#c0bad4', '#d8d4e4'],
};
const WET = {   // footprints after falling in (ember: charred soles out of the lava)
  ruins: ['#6a7a92', '#8694aa', '#a4aec0', '#c4cad6'],
  ember: ['#3a2c2a', '#5a4a46', '#80726e', '#a89e9a'],
  frost: ['#5e7092', '#7a8cac', '#9caac4', '#bec8da'],
  rift: ['#56467a', '#726496', '#9286b2', '#b4aace'],
};
const CHIP = {ruins: '#b4a27c', ember: '#8c8078', frost: '#eef4fc', rift: '#9c8cc4'};   // splinter / crumb by an arrow hole
const STREAK = {ruins: ['#e6dcc4', '#c8b894', '#a8987a'], ember: ['#c8beb4', '#a39a92', '#7c746e'],
  frost: ['#e8f0fa', '#c4d0e4', '#98a8c4'], rift: ['#c8b0ec', '#9a7ed4', '#6e56a8']};
const GHOST = {ruins: '#a8c4d8', ember: '#e09a70', frost: '#c0dcf8', rift: '#7c66b4'};
const BREATH = {cold: ['#eef4fc', '#b8c6dc'], faint: ['#a4b0c2', '#7c889c'], night: ['#2e3848', '#1c2432']};   // night: a dim emitter lift (moonlit)
const DRIP = {ruins: {pal: ['#d8eef4', '#8cb8c8']}, frost: {pal: ['#e8f4ff', '#a0b8d4']},
  ember: {pal: ['#b8481c', '#5e200e'], emit: ['#ffd070', '#f08a30']}, rift: {pal: ['#7448c4', '#40247a'], emit: ['#e4c8ff', '#ac80f2']}};
const EMBER = ['#ffd27e', '#f28a36', '#b8481c', '#5e200e'];   // hot -> cold
const ALIGHT = {ruins: '#ffd8a0', ember: '#ffc890', frost: '#ffe4c0', rift: '#f4c8ff'};
const CHEST = 1.25, MOUTH = 1.55;   // metres: the arrows' height (aim lean origin), breath height

export function createFlow(ctx, host) {
  const Q = new URLSearchParams(location.search);
  const F = {on: Q.get('flow') !== '0', ms: 0, T: TUNE};
  const K = TUNE.cam;
  let biome = 'ruins', time = 'day', acc = 0, simT = 0;
  let s = 71;
  const R = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = (a, b) => a + R() * (b - a);
  const tick = t0 => { acc += performance.now() - t0; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d'); q.imageSmoothingEnabled = false; return [c, q]; };
  const bk = new Map();   // colour buckets: batch fillRects by colour
  const put = (c, x, y, w = 1, h = 1) => { let a = bk.get(c); if (!a) bk.set(c, a = []); a.push(x, y, w, h); };
  function flush(q) { for (const [c, a] of bk) { if (!a.length) continue; q.fillStyle = c; for (let i = 0; i < a.length; i += 4) q.fillRect(a[i], a[i + 1], a[i + 2], a[i + 3]); a.length = 0; } }
  const windAt = (x, y) => host.wind?.at?.(x, y) || {x: 0, y: 0, g: 0};
  const scr = (ux, uy) => { const x = ux * ctx.PPM, y = uy * ctx.PPMY, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };   // ground dir -> view dir

  // ============================================================ camera
  const C = {init: false, x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, pvx: 0, pvy: 0, ox: 0, oy: 0, outX: NaN, outY: NaN,
    lpx: null, lpy: null, vpx: 0, vpy: 0, lean: 0, ax: 0, ay: 0, dx: 0, dy: 0};
  // velocity for a punch that peaks at `px` pixels (impulse response of the damped punch spring)
  const punchV = px => { const z = K.pz, w = K.pw, q = Math.sqrt(1 - z * z); return px * w / Math.exp(-z / q * Math.atan2(q, z)); };
  function camera(cam, tx, ty, dt) {
    if (!F.on) { C.init = false; C.lpx = null; return false; }
    const t0 = performance.now();
    F.ms = F.ms * .95 + acc * .05; acc = 0;   // one sample per rendered frame: last frame's draws + this frame's update
    const P = host.P, [pxs, pys] = ctx.toS(P.x, P.y, P.z);
    const maxX = Math.max(0, ctx.WPX - ctx.VW), maxY = Math.max(0, ctx.HPX - ctx.VH);
    // the player's velocity on the view, MEASURED (px/s): right in rolls and leaps (P.vx is stale there), 0 in hitstop
    let vpx = 0, vpy = 0;
    if (C.lpx !== null && dt > 1e-4 && dt < K.snap) {
      const ddx = pxs - C.lpx, ddy = pys - C.lpy;
      if (Math.abs(ddx) < 40 && Math.abs(ddy) < 40) { vpx = ddx / dt; vpy = ddy / dt; }   // bigger = a teleport (respawn)
    }
    C.lpx = pxs; C.lpy = pys; C.vpx = vpx; C.vpy = vpy;
    // aim lean: toward the cursor (from the chest on screen), eased in while the bow is drawn, out after
    const drawing = P.state === 'draw';
    C.lean = clamp(C.lean + (drawing ? K.leanIn : -K.leanOut) * dt, 0, 1);
    let gx = tx, gy = ty;
    if (C.lean > 0) {
      if (drawing) {
        const m = host.mouse, sx = pxs - cam.fx, sy = pys - CHEST * ctx.PPMH - cam.fy;
        C.ax = clamp((m.x - sx) / K.leanRX, -1, 1); C.ay = clamp((m.y - sy) / K.leanRY, -1, 1);
      }   // (released: keep the last aim while it eases back)
      const e = C.lean * C.lean * (3 - 2 * C.lean);
      gx += C.ax * K.leanX * e; gy += C.ay * K.leanY * e;
    }
    // lead: a little further ahead in a roll and at a full sprint
    const mps = Math.hypot(vpx / ctx.PPM, vpy / ctx.PPMY), vl = Math.hypot(vpx, vpy);
    let want = 0;
    if (P.state === 'roll') want = K.rollLead;
    else if (P.state === 'move' && !P.skid && (P.gait === 'sprint' || P.gait === 'drive')) want = K.sprintLead * clamp((mps - 5) / 2, 0, 1);
    const kl = 1 - Math.exp(-dt * K.leadRate);
    C.dx += ((vl > 1 ? vpx / vl * want : 0) - C.dx) * kl; C.dy += ((vl > 1 ? vpy / vl * want * .7 : 0) - C.dy) * kl;
    gx = clamp(gx + C.dx, 0, maxX); gy = clamp(gy + C.dy, 0, maxY);
    // (re)start: first frame, the host reset the camera (cam.fx = null -> its target), or flow was off
    if (!C.init || cam.fx !== C.outX || cam.fy !== C.outY || dt >= K.snap) {
      const snap = dt >= K.snap;
      C.x = snap ? gx : cam.fx; C.y = snap ? gy : cam.fy; C.vx = C.vy = C.px = C.py = C.pvx = C.pvy = 0;
      C.ox = Math.round(pxs - C.x); C.oy = Math.round(pys - C.y); C.init = true;
    } else if (dt > 0) {
      const n = Math.ceil(dt * 120), h = dt / n, w2 = K.w * K.w, z2 = 2 * K.z * K.w;
      // fed-forward speed only where the target is free (at a world edge it would push the spring past the clamp)
      const fx = gx > 0 && gx < maxX ? K.ff * vpx : 0, fy = gy > 0 && gy < maxY ? K.ff * vpy : 0;
      for (let i = 0; i < n; i++) {
        C.vx += (w2 * (gx - C.x) + z2 * (fx - C.vx)) * h; C.x += C.vx * h;
        C.vy += (w2 * (gy - C.y) + z2 * (fy - C.vy)) * h; C.y += C.vy * h;
      }
      // punch: the exact damped-oscillator step (its peaks are what punchV promises)
      const zw = K.pz * K.pw, wd = K.pw * Math.sqrt(1 - K.pz * K.pz), e = Math.exp(-zw * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
      for (const [x, v] of [['px', 'pvx'], ['py', 'pvy']]) {
        const x0 = C[x], v0 = C[v];
        C[x] = e * (x0 * c + (v0 + zw * x0) / wd * sn); C[v] = e * (v0 * c - (zw * v0 + K.pw * K.pw * x0) / wd * sn);
      }
    }
    // pixel output: hold the player's screen offset until the follow spring has really moved (no +-1 px toggling);
    // the punch goes on top in whole pixels (a kick reads crisp, its small rebound rounds away)
    const H = .5 + K.hyst;
    if (Math.abs(pxs - C.x - C.ox) > H) C.ox = Math.round(pxs - C.x);
    if (Math.abs(pys - C.y - C.oy) > H) C.oy = Math.round(pys - C.y);
    cam.fx = C.outX = clamp(pxs - C.ox + Math.round(C.px), 0, maxX); cam.fy = C.outY = clamp(pys - C.oy + Math.round(C.py), 0, maxY);
    tick(t0);
    return true;
  }
  function kick(ux, uy, px) { const v = punchV(px); C.pvx -= ux * v; C.pvy -= uy * v; }   // camera goes AGAINST (ux, uy)

  // ============================================================ marks (decals)
  const decals = [];   // {pix: [x, y, tone, ...] world px, set, ramp, st, z, t, stage, min, x0, y0, x1, y1, chips}
  let layer = null, lq = null, layerKey = '', layerPPMY = 0, dirty = [];
  // world px on the surface at height z: not on the water, not over the cliff lip
  const valid = (wx, wy, z) => {
    const mx = (wx + .5) / ctx.PPM, my = (wy + .5 + z * ctx.PPMH) / ctx.PPMY;
    return host.elev(mx, my) === z && !(z === 0 && host.inStream(mx, my));
  };
  function decal(ramp, st, z) { return {pix: [], set: new Map(), ramp, st, z, t: 0, stage: 0, min: 9, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, d: null}; }
  function dot(d, x, y, tone) {   // add one pixel (deduped, the darkest tone wins)
    const k = x * 4096 + y, i = d.set.get(k);
    if (i !== undefined) { if (tone < d.pix[i + 2]) d.pix[i + 2] = tone; }
    else { if (!valid(x, y, d.z)) return; d.set.set(k, d.pix.length); d.pix.push(x, y, tone); }
    if (tone < d.min) d.min = tone;
    if (x < d.x0) d.x0 = x; if (y < d.y0) d.y0 = y; if (x + 1 > d.x1) d.x1 = x + 1; if (y + 1 > d.y1) d.y1 = y + 1;
    const r = d.d || (d.d = [x, y, x + 1, y + 1]);
    if (x < r[0]) r[0] = x; if (y < r[1]) r[1] = y; if (x + 1 > r[2]) r[2] = x + 1; if (y + 1 > r[3]) r[3] = y + 1;
  }
  function line(d, x0, y0, x1, y1, tone, skip) {   // Bresenham; skip(i) -> true leaves a gap
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy, i = 0;
    for (;;) { if (!skip || !skip(i)) dot(d, x0, y0, tone); i++; if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  function commit(d, keep) {   // queue its new pixels for the layer; one-shot marks drop the dedupe map
    if (d.d) { dirty.push(d.d); d.d = null; }
    if (!keep) d.set = null;
    if (!d.pix.length) return null;
    if (!decals.includes(d)) { decals.push(d); while (decals.length > TUNE.marks.cap) { const o = decals.shift(); dirty.push([o.x0, o.y0, o.x1, o.y1]); } }
    return d;
  }
  function ensureLayer() {
    const key = ctx.WPX + 'x' + ctx.HPX;
    if (layer && key === layerKey && layerPPMY === ctx.PPMY) return;
    if (layerPPMY && layerPPMY !== ctx.PPMY) { decals.length = 0; gEmb.length = 0; }   // projection switched: marks were in old px
    if (!layer) [layer, lq] = mk(ctx.WPX, ctx.HPX); else if (layer.width !== ctx.WPX || layer.height !== ctx.HPX) { layer.width = ctx.WPX; layer.height = ctx.HPX; lq.imageSmoothingEnabled = false; }
    layerKey = key; layerPPMY = ctx.PPMY;
    lq.globalCompositeOperation = 'source-over'; lq.fillStyle = '#fff'; lq.fillRect(0, 0, layer.width, layer.height);
    lq.globalCompositeOperation = 'darken';
    for (const d of decals) queue(d, -1e9, -1e9, 1e9, 1e9);
    flush(lq); lq.globalCompositeOperation = 'source-over'; dirty.length = 0;
  }
  function queue(d, x0, y0, x1, y1) {
    const P = d.pix, rp = d.ramp, st = d.stage, n = rp.length;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1]; if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      const k = P[i + 2] + st; if (k < n) put(rp[k], x, y);
    }
  }
  function paintRect(r) {   // repaint one dirty rect of the layer from every mark that touches it
    const x0 = Math.max(0, r[0]), y0 = Math.max(0, r[1]), x1 = Math.min(layer.width, r[2]), y1 = Math.min(layer.height, r[3]);
    if (x1 <= x0 || y1 <= y0) return;
    lq.globalCompositeOperation = 'source-over'; lq.fillStyle = '#fff'; lq.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (const d of decals) if (d.x1 > x0 && d.x0 < x1 && d.y1 > y0 && d.y0 < y1) queue(d, x0, y0, x1, y1);
    lq.globalCompositeOperation = 'darken'; flush(lq); lq.globalCompositeOperation = 'source-over';
  }
  function ageDecals(dt) {
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i]; d.t += dt;
      const st = Math.floor(d.t / d.st);
      if (st === d.stage) continue;
      d.stage = st; dirty.push([d.x0, d.y0, d.x1, d.y1]);
      if (st + d.min >= d.ramp.length) decals.splice(i, 1);
    }
  }
  const ground = (x, y) => host.elev(x, y);
  const wpx = (x, y, z) => { const [a, b] = ctx.toS(x, y, z); return [Math.round(a), Math.round(b)]; };
  // a crescent of soil pushed up at a foot, bulging toward (ux, uy) (ground dir). rx, ry px, span rad either side
  function crescent(x, y, ux, uy, o = {}) {
    const z = ground(x, y), d = decal(MARK[biome], o.st || 18, z), [cx, cy] = ctx.toS(x, y, z), [vx, vy] = scr(ux, uy), a0 = Math.atan2(vy, vx);
    const rx = o.rx || 2.6, ry = o.ry || 1.7, span = o.span || 1.25, tone = o.tone ?? 1;
    for (let a = -span; a <= span + 1e-6; a += .16) dot(d, Math.round(cx + Math.cos(a0 + a) * rx), Math.round(cy + Math.sin(a0 + a) * ry), tone);
    if (o.dent !== false) dot(d, Math.round(cx), Math.round(cy), tone + 1);   // the heel's dent
    return commit(d);
  }
  // explosion scorch: ragged soot disc, a dark burnt ring, radial cracks; fresh embers glow in it for a while
  function scorch(x, y, r) {
    const z = ground(x, y), R0 = clamp(r * .36, .5, 1.1), [cx, cy] = ctx.toS(x, y, z), rx = R0 * ctx.PPM, ry = R0 * ctx.PPMY;
    const d = decal(SCORCH[biome], 20, z), sd = (R() * 9e5) | 0, emb = [];
    for (let py = Math.floor(cy - ry * 1.2); py <= Math.ceil(cy + ry * 1.2); py++) for (let qx = Math.floor(cx - rx * 1.2); qx <= Math.ceil(cx + rx * 1.2); qx++) {
      const ex = (qx + .5 - cx) / rx, ey = (py + .5 - cy) / ry, d0 = Math.hypot(ex, ey); if (d0 > 1.2) continue;
      const dd = d0 + (vn(qx / 7, py / 5, sd) - .5) * .36, b = vn(qx / 2.6, py / 2, sd + 3);   // ragged edge, soot blobs
      let tone = -1;
      if (dd < .42) tone = b > .66 ? 1 : 2;
      else if (dd < .76) tone = b > .6 ? 0 : 1;
      else if (dd < .96) tone = 0;
      else if (dd < 1.12 && vn(qx / 3, py / 3, sd + 5) > .52) tone = 3;
      if (tone < 0) continue;
      dot(d, qx, py, tone);
      if (dd < .8 && R() < .012) emb.push([qx, py]);
    }
    const nC = 5 + (R() * 3 | 0);   // cracks: jagged rays from inside the ring out past it, a few short branches
    for (let k = 0; k < nC; k++) {
      let a = (k + R() * .7) / nC * TAU, dd = .6 + R() * .15, lx = Math.round(cx + Math.cos(a) * dd * rx), ly = Math.round(cy + Math.sin(a) * dd * ry);
      const end = 1.08 + R() * .3;
      while (dd < end) {
        a += (R() - .5) * .3; dd += .07;
        const nx = Math.round(cx + Math.cos(a) * dd * rx), ny = Math.round(cy + Math.sin(a) * dd * ry);
        line(d, lx, ly, nx, ny, dd > 1.05 ? 1 : 0); lx = nx; ly = ny;
        if (R() < .07) { const b = a + (R() < .5 ? -.7 : .7); line(d, lx, ly, Math.round(lx + Math.cos(b) * 3), Math.round(ly + Math.sin(b) * 2), 1); }
      }
    }
    if (!commit(d)) return;
    const n = biome === 'ember' ? 16 : biome === 'frost' ? 4 : 9, life = biome === 'ember' ? [4, 9] : [1.5, 4];
    for (let i = 0; i < n && emb.length; i++) { const [ex, ey] = emb.splice(R() * emb.length | 0, 1)[0]; gEmb.push({x: ex, y: ey, t: 0, life: rr(life[0], life[1]), ph: R()}); }
  }
  // arrow hole: a dark pinhole + a gouge toward where it came from, a pale splinter / crumb chip beside it
  function hole(h) {
    const d = decal(MARK[biome], 20, h.z), [X, Y] = wpx(h.x, h.y, h.z), [ux, uy] = scr(h.vx, h.vy);
    dot(d, X, Y, 0); dot(d, Math.round(X - ux * 1.2), Math.round(Y - uy * 1.2), 1);
    if (!commit(d)) return;
    const side = R() < .5 ? -1 : 1, cxp = Math.round(X - uy * side * 2 - ux), cyp = Math.round(Y + ux * side * 2 - uy);
    if (valid(cxp, cyp, h.z)) d.chips = [cxp, cyp];
  }
  // a wet (charred, violet) footprint: a small sole along the stride, the heel a tone lighter
  const SOLE = {h: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 1]], v: [[0, -1, 0], [0, 0, 0], [1, -1, 1]],
    d1: [[-1, -1, 0], [0, 0, 0], [1, 1, 1]], d2: [[1, -1, 0], [0, 0, 0], [-1, 1, 1]]};
  function print(x, y, tone) {
    const z = ground(x, y), d = decal(WET[biome], 2.5, z), [X, Y] = wpx(x, y, z), ax = Math.abs(dirX), ay = Math.abs(dirY);
    const S = ax > .85 ? SOLE.h : ay > .85 ? SOLE.v : dirX * dirY > 0 ? SOLE.d1 : SOLE.d2;
    for (const [i, j, k] of S) dot(d, X + i, Y + j, Math.min(3, tone + k));
    if (commit(d) && biome === 'ember' && tone === 0 && R() < .6) gEmb.push({x: X, y: Y, t: 0, life: rr(1.2, 2.2), ph: R()});   // hot soles
  }
  // continuous marks: the skid (two parallel streaks under the feet) and the roll scrape grow while they last
  const SK = {d: null, last: null, n: 0, sd: 0}, RL = {d: null, last: null, len: 0, next: 0};
  function trackSkid(P, speed) {
    if (!(P.skid && P.state === 'move' && speed > .7)) { if (SK.d) { SK.d.set = null; SK.d = null; } return; }
    // the heels dig in hardest at the start; the streaks thin out as he slows, wander a pixel, break up now and then
    const z = ground(P.x, P.y), ux = P.vx / speed, uy = P.vy / speed, tone = speed > 6 ? 0 : speed > 3.2 ? 1 : 2, pts = [];
    for (const side of [-1, 1]) { const o = side * (.1 + (vn(SK.n / 9, side + 3, SK.sd) - .5) * .07); pts.push(wpx(P.x + uy * o, P.y - ux * o, z)); }
    if (!SK.d || SK.d.z !== z) { SK.d = decal(MARK[biome], 20, z); SK.n = 0; SK.sd = (R() * 9e5) | 0; for (const [x, y] of pts) dot(SK.d, x, y, tone); }
    else {
      const n0 = SK.n;
      for (let k = 0; k < 2; k++) line(SK.d, SK.last[k][0], SK.last[k][1], pts[k][0], pts[k][1], tone, i => i > 0 && hsh((n0 + i) >> 1, k, SK.sd) < .13);
      SK.n += Math.max(Math.abs(pts[0][0] - SK.last[0][0]), Math.abs(pts[0][1] - SK.last[0][1]));
    }
    SK.last = pts; commit(SK.d, true);
  }
  function trackRoll(P) {   // scuffed ground along the roll: short drag dashes scattered across a ~5 px band
    const on = P.state === 'roll' && P.t > .1 && P.t < .42;   // shoulders / back on the ground
    if (!on) { if (RL.d) { RL.d.set = null; RL.d = null; } return; }
    const z = ground(P.x, P.y), [X, Y] = wpx(P.x, P.y, z);
    if (!RL.d || RL.d.z !== z) { RL.d = decal(MARK[biome], 20, z); RL.len = 0; RL.next = 0; RL.last = [X, Y]; }
    const [lx, ly] = RL.last, seg = Math.hypot(X - lx, Y - ly), L0 = RL.len;
    RL.len += seg;
    if (seg > 0) {
      const dx = (X - lx) / seg, dy = (Y - ly) / seg;
      while (RL.next <= RL.len) {
        const k = (RL.next - L0) / seg, cx = lx + (X - lx) * k, cy = ly + (Y - ly) * k, o = Math.round(rr(-2.5, 2.5)), n = 2 + (R() < .4 ? 1 : 0), tone = R() < .3 ? 1 : 2;
        for (let j = 0; j < n; j++) dot(RL.d, Math.round(cx - dy * o + dx * j), Math.round(cy + dx * o + dy * j), tone);
        RL.next += rr(2.5, 4.5);
      }
    }
    RL.last = [X, Y]; commit(RL.d, true);
  }
  // stuck arrows: remember the ones in the ground; when one is gone, leave its hole
  const stuck = new Map();
  function trackArrows() {
    const A = host.arrows;
    for (const a of A) if (a.stuck && !stuck.has(a)) { const z = ground(a.x, a.y); stuck.set(a, a.h - z < .25 ? {x: a.x, y: a.y, z, vx: a.vx, vy: a.vy} : null); }
    if (!stuck.size) return;
    const live = new Set(A);
    for (const [a, h] of stuck) if (!live.has(a)) { stuck.delete(a); if (h) hole(h); }
  }

  // ============================================================ particles (world space)
  // k: 0 streak (world px, static), 1 breath, 2 drip, 3 drip splash, 4 spark (metres)
  const ps = [], gEmb = [];
  let streakAcc = 0, breathT = 1.5, heat = 0, dripAcc = 0, sparkAcc = 0, splashT = -99, wetFrom = -99;
  function spawnStreak(P, vx, vy) {
    const [dx, dy] = scr(vx, vy), [sx, sy] = ctx.toS(P.x, P.y, P.z), hp = rr(10, 44);
    const ox = Math.abs(dx) > .45 ? -Math.sign(dx) * rr(6, 9) : (R() < .5 ? -1 : 1) * rr(8, 10);   // trailing edge / a side
    // (shown from t = 0: ~2 frames after it peels off, when the body has moved clear of it: never a line across the bow)
    ps.push({k: 0, x: sx + ox - dx * rr(0, 3), y: sy - hp, dx: -dx, dy: -dy, len: Math.round(rr(TUNE.streak.len[0], TUNE.streak.len[1] + .99)), t: -.035, life: rr(TUNE.streak.life[0], TUNE.streak.life[1])});
  }
  function breathe(P) {
    const nd = host.player().nd || 16, a = P.face * TAU / nd, fx = Math.sin(a), fy = Math.cos(a);
    if (fy < -.55) return;   // facing away: the mouth is behind the head
    // it starts just past the face (never as specks ON it); facing the viewer it leaves past a cheek, downwind
    let ox = fx * .3, oy = fy * .3, lx = 0;
    if (fy > .7) { const w = windAt(P.x, P.y).x; lx = w > .05 ? 1 : w < -.05 ? -1 : R() < .5 ? -1 : 1; ox = lx * .24; oy = .1; }
    const cold = biome === 'frost', n = 3 + (R() < .5) + (cold && R() < .5 ? 1 : 0), x = P.x + ox, y = P.y + oy, h = P.z + MOUTH;
    for (let i = 0; i < n; i++) {
      const sp = rr(.35, .75);
      ps.push({k: 1, x: x + (R() - .5) * .05, y, h: h + (R() - .5) * .05, vx: fx * sp + lx * sp * .6 + (R() - .5) * .14, vy: fy * sp * (lx ? .4 : .8) + (R() - .5) * .1, vh: rr(.02, .16),
        t: -i * .035, life: rr(.55, .9), pal: cold ? BREATH.cold : BREATH.faint});
    }
  }
  function stepParticles(dt) {
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]; p.t += dt;
      if (p.t >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      if (p.k === 0 || p.t < 0) continue;
      if (p.k === 1) {   // breath: forward, slowing, a little up, carried off by the wind
        const w = windAt(p.x, p.y), dmp = Math.exp(-dt * 2.4);
        p.vx *= dmp; p.vy *= dmp; p.x += (p.vx + w.x * .5) * dt; p.y += (p.vy + w.y * .5) * dt; p.h += p.vh * dt;
      } else if (p.k === 2) {   // drip: falls, a tiny splash where it lands (nothing on the water)
        p.vh -= 9.8 * dt; p.h += p.vh * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96;
        const z = ground(p.x, p.y);
        if (p.h <= z) { if (z === 0 && host.inStream(p.x, p.y)) p.life = 0; else { p.k = 3; p.h = z; p.t = 0; p.life = .14; } }
      } else if (p.k === 4) {   // spark: rises, wobbles, drifts with the wind
        const w = windAt(p.x, p.y);
        p.h += p.vh * dt; p.vh *= Math.exp(-dt * .6); p.x += (w.x * .6 + Math.sin(p.t * 7 + p.ph * TAU) * .28) * dt; p.y += w.y * .6 * dt;
      }
    }
    for (let i = gEmb.length - 1; i >= 0; i--) if ((gEmb[i].t += dt) >= gEmb[i].life) { gEmb[i] = gEmb[gEmb.length - 1]; gEmb.pop(); }
  }

  // ============================================================ afterimages
  const GH = {list: [], pool: [], acc: 0, due: false, lx: 1e9, ly: 1e9};
  function capture() {
    const P = host.P, pl = host.player(), w = pl.w + 96, h = pl.h + 80;
    let c = GH.pool.pop(); if (!c) { const [cv, q] = mk(w, h); c = {c: cv, q}; }
    if (c.c.width !== w || c.c.height !== h) { c.c.width = w; c.c.height = h; c.q.imageSmoothingEnabled = false; }
    const q = c.q; q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, w, h);
    host.drawPlayer(q, 48, 40);   // body + cloak, frame top-left at (48, 40): the cloth's raster margins around it
    q.globalCompositeOperation = 'source-in'; q.fillStyle = GHOST[biome] || GHOST.ruins; q.fillRect(0, 0, w, h);
    q.globalCompositeOperation = 'source-over';
    GH.list.push({...c, x: P.x, y: P.y, z: P.z, t: 0, piv: pl.pivot});
    const [sx, sy] = ctx.toS(P.x, P.y, P.z); GH.lx = sx; GH.ly = sy;
  }

  // ============================================================ the frame
  let dirX = 1, dirY = 0, prevState = 'idle', lastShots = null;
  const seen = new WeakSet();
  const ids = new WeakMap(); let nextId = 0;
  function update(dt, evs) {
    const P = host.P;
    if (!F.on) { lastShots = host.shots(); for (const a of host.arrows) seen.add(a); prevState = P.state; SK.d = RL.d = null; return; }
    const t0 = performance.now();
    dt = Math.min(.05, Math.max(0, dt || 0)); simT += dt;
    const speed = Math.hypot(P.vx, P.vy);
    // ---- the bow's kick: a new arrow leaving the player (a shot or an ability; not rain from the sky) ----
    const shots = host.shots(); let kx = 0, ky = 0, kn = 0;
    for (const a of host.arrows) {
      if (seen.has(a)) continue; seen.add(a);
      if (a.stuck || Math.hypot(a.x - P.x, a.y - P.y) > 1.5 || a.h > P.z + 2.5) continue;
      const vx = a.vx * ctx.PPM, vy = a.vy * ctx.PPMY - (a.vh || 0) * ctx.PPMH, l = Math.hypot(vx, vy) || 1; kx += vx / l; ky += vy / l; kn++;
    }
    if (kn || (lastShots !== null && shots > lastShots)) {
      const l = Math.hypot(kx, ky); if (l > 1e-3) kick(kx / l, ky / l, K.kick * (kn > 1 ? 1.2 : 1));
    }
    lastShots = shots;
    // ---- events ----
    let dip = 0;
    const side = (e, s0) => { const s1 = (e.foot || s0) === 'R' ? -1 : 1; return [e.x + dirY * s1 * .09, e.y - dirX * s1 * .09]; };   // left of travel = (dy, -dx)
    // the PLAYER's own events: props3d pushes land / splash / ... too (with a kind); his carry P's position of that step
    const mine = e => !e.prop && !e.kind && Math.hypot(e.x - P.x, e.y - P.y) < .4;
    for (const e of evs || []) {
      if ((e.type === 'land' || e.type === 'step' || e.type === 'jump' || e.type === 'splash') && !mine(e)) continue;
      if (e.type === 'land' && P.state === 'land') {   // a real landing (sprint footfalls are 'land' too, big 2, state 'move')
        if (e.big >= 3) { dip = Math.max(dip, K.dip); crescent(e.x, e.y, dirX, dirY, {rx: 5, ry: 3, span: 2.5, tone: 1, st: 20, dent: false}); }
        else if (e.big === 2) {
          const drop = prevState === 'fall' ? (P.fall0 ?? P.z) - P.z : 0;
          dip = Math.max(dip, prevState === 'fall' ? K.dipSoft + (K.dip - K.dipSoft) * clamp((drop - .3) / 1.5, 0, 1) : K.dipSoft);
          for (const s0 of ['L', 'R']) { const [x, y] = side({...e, foot: s0}); crescent(x, y, dirX, dirY, {tone: 1}); }
        }
      } else if (e.type === 'land' && e.big === 2 && P.turn && /a$/.test(P.frame)) {   // turn plant: soil pushed toward the old momentum
        const [x, y] = side(e); crescent(x, y, dirX, dirY, {tone: 1});
      } else if (e.type === 'jump') {   // take-off: a faint crescent behind the push
        const L = P.leap; if (L) crescent(e.x - L.dx * .12, e.y - L.dy * .12, -L.dx, -L.dy, {tone: 2});
      } else if (e.type === 'splash' && !e.small && P.state === 'splash') { splashT = simT; wetFrom = -99; }   // HIS splash (a sinking crate's has no player in 'splash' beside it)
      else if (e.type === 'explode') scorch(e.x, e.y, e.r || 2);
      if ((e.type === 'step' || e.type === 'land') && P.state !== 'splash' && wetFrom > -99 && simT - wetFrom < TUNE.wet.prints) {   // (sprint footfalls are 'land')
        const age = simT - wetFrom, [x, y] = side(e); print(x, y, age < TUNE.wet.prints * .45 ? 0 : age < TUNE.wet.prints * .8 ? 1 : 2);
      }
    }
    if (dip) C.pvy += punchV(dip);
    if (splashT > -99 && P.state !== 'splash' && prevState === 'splash') wetFrom = simT;   // back on the bank: dripping
    // ---- direction of travel (after the events: a turn plant wants the momentum from before the turn) ----
    if (P.state === 'roll' && P.rollDir) { dirX = P.rollDir[0]; dirY = P.rollDir[1]; }
    else if (speed > .3) { dirX = P.vx / speed; dirY = P.vy / speed; }
    // ---- marks ----
    trackSkid(P, speed); trackRoll(P); trackArrows(); ageDecals(dt);
    // ---- particles ----
    const sprint = P.state === 'move' && !P.skid && (P.gait === 'sprint' || P.gait === 'drive') && speed > TUNE.streak.speed;
    if (sprint) { heat = TUNE.breath.heat; for (streakAcc += TUNE.streak.rate * dt; streakAcc >= 1; streakAcc--) spawnStreak(P, P.vx, P.vy); }
    else { streakAcc = 0; heat = Math.max(0, heat - dt); }
    if ((biome === 'frost' || time === 'night') && !P.sink && P.state !== 'splash') {
      breathT -= dt;
      if (breathT <= 0) { breathe(P); breathT = heat > 0 ? TUNE.breath.fast * rr(.85, 1.15) : rr(TUNE.breath.every[0], TUNE.breath.every[1]); }
    }
    const wetAge = simT - wetFrom;
    if (wetAge < TUNE.wet.drips && P.state !== 'splash') {   // dripping: often at first, then now and then
      const D = DRIP[biome] || DRIP.ruins;
      for (dripAcc += (.6 + 14 * (1 - wetAge / TUNE.wet.drips) ** 1.4) * dt; dripAcc >= 1; dripAcc--)
        ps.push({k: 2, x: P.x + (R() - .5) * .34, y: P.y + .03 + (R() - .5) * .08, h: P.z + rr(.3, 1.3), vx: P.vx * .5, vy: P.vy * .5, vh: rr(-.3, 0), t: 0, life: 2, pal: D.pal, emit: D.emit});
    }
    if (biome === 'ember' && !P.sink) {   // sparks lifting off the cloak / body
      for (sparkAcc += (speed > 1 ? 2.6 : 1.1) * dt; sparkAcc >= 1; sparkAcc--)
        ps.push({k: 4, x: P.x + (R() - .5) * .36, y: P.y + .04, h: P.z + rr(.45, 1.5), vh: rr(.5, 1.05), t: 0, life: rr(.6, 1.3), ph: R()});
    }
    stepParticles(dt);
    // ---- afterimages ----
    for (let i = GH.list.length - 1; i >= 0; i--) if ((GH.list[i].t += dt) > TUNE.ghost.keep) GH.pool.push(GH.list.splice(i, 1)[0]);
    if (P.state === 'roll') {
      GH.acc += dt; const [sx, sy] = ctx.toS(P.x, P.y, P.z);
      if (GH.acc >= TUNE.ghost.every && Math.hypot(sx - GH.lx, sy - GH.ly) >= TUNE.ghost.gap) { GH.due = true; GH.acc = 0; }
    } else { GH.acc = TUNE.ghost.every; GH.lx = GH.ly = 1e9; GH.due = false; }
    prevState = P.state;
    tick(t0);
  }

  function drawGround(g, cam) {
    if (!F.on) return;
    const t0 = performance.now(), VW = ctx.VW, VH = ctx.VH;
    if (decals.length || layer) ensureLayer();
    if (layer && dirty.length) for (const r of dirty.splice(0, 32)) paintRect(r);   // (the rest next frame)
    const vx0 = cam.x, vy0 = cam.y, vx1 = vx0 + VW, vy1 = vy0 + VH;
    let vis = false;
    for (const d of decals) {
      if (d.x1 <= vx0 || d.x0 >= vx1 || d.y1 <= vy0 || d.y0 >= vy1) continue;
      vis = true;
      if (d.chips && d.stage < 2) put(CHIP[biome] || CHIP.ruins, d.chips[0] - vx0, d.chips[1] - vy0);
    }
    if (vis) { g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(layer, vx0, vy0, VW, VH, 0, 0, VW, VH); g.restore(); }
    for (const e of gEmb) {   // fresh embers: an opaque base pixel (reads by day; the emitter makes it glow at night)
      const x = e.x - vx0, y = e.y - vy0; if (x < 0 || y < 0 || x >= VW || y >= VH) continue;
      put(EMBER[emberTone(e) + 1] || EMBER[3], x, y);
    }
    flush(g);
    if (GH.due) { GH.due = false; capture(); }   // before the player's own draw this frame (cloak state)
    tick(t0);
  }
  const emberTone = e => { const a = e.t / e.life, f = Math.sin(e.t * 9 + e.ph * TAU) > .2 ? 0 : 1; return Math.min(3, (a < .3 ? 0 : a < .65 ? 1 : 2) + f); };

  function sortables(cam) {
    if (!F.on || !GH.list.length) return [];
    const P = host.P, A = TUNE.ghost.alpha, band = TUNE.ghost.keep / A.length, out = [];
    for (const gh of GH.list) {
      const a = A[Math.min(A.length - 1, Math.floor(gh.t / band))];
      out.push({y: Math.min(gh.y, P.y - .001), draw(g) {
        const [sx, sy] = ctx.toS(gh.x, gh.y, gh.z), x = Math.round(sx - cam.x) - gh.piv[0] - 48, y = Math.round(sy - cam.y) - gh.piv[1] - 40;
        g.save(); g.globalAlpha = a; g.drawImage(gh.c, x, y); g.restore();
      }});
    }
    return out;
  }

  function drawFront(g, cam) {
    if (!F.on || !ps.length) return;
    const t0 = performance.now(), VW = ctx.VW, VH = ctx.VH, SPal = STREAK[biome] || STREAK.ruins;
    for (const p of ps) {
      if (p.t < 0) continue;
      if (p.k === 0) {   // streak: a 1 px line trailing back along the run, fading in 3 steps
        const c = SPal[Math.min(2, Math.floor(p.t / p.life * 3))], x0 = p.x - cam.x, y0 = p.y - cam.y;
        if (x0 < -8 || y0 < -8 || x0 > VW + 8 || y0 > VH + 8) continue;
        let lx = 1e9, ly = 1e9;
        for (let i = 0; i < p.len; i++) { const x = Math.round(x0 + p.dx * i), y = Math.round(y0 + p.dy * i); if (x !== lx || y !== ly) put(c, x, y); lx = x; ly = y; }
        continue;
      }
      const [a, b] = ctx.toS(p.x, p.y, p.h), x = Math.round(a - cam.x), y = Math.round(b - cam.y);
      if (x < -2 || y < -2 || x > VW + 1 || y > VH + 1) continue;
      if (p.k === 1) put(p.pal[p.t < p.life * .55 ? 0 : 1], x, y);
      else if (p.k === 2) put(p.pal[0], x, y);
      else if (p.k === 3) { if (p.t < .06) { put(p.pal[1], x - 1, y); put(p.pal[1], x + 1, y); put(p.pal[0], x, y - 1); } else put(p.pal[1], x, y); }
      else if (p.k === 4) put(EMBER[Math.min(3, Math.floor(p.t / p.life * 4))], x, y);
    }
    flush(g);
    tick(t0);
  }

  // emitters: scorch / sole embers on a ground-sized layer (> 1.2 x the view: the host treats it as ground, cut behind
  // the player), sparks and glowing drips on a view-sized one (in front)
  let GE = null, gq = null, FE = null, fq = null;
  function emitters(cam) {
    if (!F.on || (!gEmb.length && !ps.length)) return [];
    const t0 = performance.now(), VW = ctx.VW, VH = ctx.VH, out = [];
    if (gEmb.length) {
      const w = Math.ceil(VW * 1.25);
      if (!GE) [GE, gq] = mk(w, VH);
      if (GE.width !== w || GE.height !== VH) { GE.width = w; GE.height = VH; gq.imageSmoothingEnabled = false; } else gq.clearRect(0, 0, w, VH);
      let any = false;
      for (const e of gEmb) { const x = e.x - cam.x, y = e.y - cam.y; if (x < 0 || y < 0 || x >= VW || y >= VH) continue; const k = emberTone(e); if (k < 3) { put(EMBER[k], x, y); any = true; } }
      flush(gq); if (any) out.push({img: GE, x: 0, y: 0});
    }
    let front = false;
    const night = time === 'night';
    for (const p of ps) {
      if (p.t < 0 || !(p.k === 4 || (p.emit && p.k >= 2) || (p.k === 1 && night))) continue;
      const [a, b] = ctx.toS(p.x, p.y, p.h), x = Math.round(a - cam.x), y = Math.round(b - cam.y);
      if (x < 0 || y < 0 || x >= VW || y >= VH) continue;
      if (p.k === 4) { const k = Math.floor(p.t / p.life * 4); if (k > 2) continue; put(EMBER[k], x, y); }
      else if (p.k === 1) put(BREATH.night[p.t < p.life * .55 ? 0 : 1], x, y);
      else put(p.emit[p.k === 3 ? 1 : 0], x, y);
      front = true;
    }
    if (front) {
      if (!FE) [FE, fq] = mk(VW, VH);
      if (FE.width !== VW || FE.height !== VH) { FE.width = VW; FE.height = VH; fq.imageSmoothingEnabled = false; } else fq.clearRect(0, 0, VW, VH);
      flush(fq); out.push({img: FE, x: 0, y: 0});
    } else bk.forEach(a => { a.length = 0; });
    tick(t0);
    return out;
  }

  function lights() {
    if (!F.on || time === 'day') return [];
    const A = host.arrows, L = TUNE.light, out = [], k = time === 'night' ? L.night : L.dusk;
    for (let i = A.length - 1; i >= 0 && out.length < L.max; i--) {
      const a = A[i]; if (a.stuck || a.life <= -9) continue;
      let id = ids.get(a); if (id === undefined) { id = 7000 + (nextId++ % 1000); ids.set(a, id); }
      out.push({x: a.x, y: a.y, h: a.h, color: ALIGHT[biome] || ALIGHT.ruins, radius: L.radius, intensity: k, flicker: 0, id});
    }
    return out;
  }

  function reset() {
    decals.length = 0; dirty.length = 0; ps.length = 0; gEmb.length = 0; stuck.clear();
    for (const gh of GH.list) GH.pool.push(gh); GH.list.length = 0; GH.due = false;
    SK.d = RL.d = null; wetFrom = splashT = -99;
    if (layer) { lq.globalCompositeOperation = 'source-over'; lq.fillStyle = '#fff'; lq.fillRect(0, 0, layer.width, layer.height); }
  }

  Object.assign(F, {
    toggle() { F.on = !F.on; C.init = false; C.lpx = null; return F.on; },
    setBiome(id) { biome = MARK[id] ? id : 'ruins'; reset(); },
    setTime(name) { time = name; },
    update, camera, drawGround, drawFront, sortables, emitters, lights,
    // debugging / tests
    C, count: () => ({decals: decals.length, particles: ps.length, embers: gEmb.length, ghosts: GH.list.length, dirty: dirty.length}),
    reset,
  });
  return F;
}
