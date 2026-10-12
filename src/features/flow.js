// FLOW (feature): motion and feel on what the player already does, in the 3D world. The arena's arena/flow.js, ported:
// same tunables (F.TUNE, live), same springs, same marks and particles; drawn through the host. SHOW ONLY: the
// player's movement, aim and arrows are untouched. OWNER: flow port.
//
//   camera      a spring instead of the host's plain ease: leans toward the aim while drawing the bow, a small kick back
//               on release, a dip on hard landings, a little overshoot before settling; the player's screen pixel is held
//               with hysteresis (no +-1 px toggling; with the sub-pixel camera the spring goes out unrounded). A revolver's shot (player.shoot) kicks it back harder (the Navy
//               more, a fanned shot less), a bullet's hit on a body (combat.hit) a little more on top
//   motion      sprint speed streaks (1 px lines peeling off the body), a short afterimage trail on the dodge roll
//               (2-3 flat-tinted silhouettes of earlier frames, behind the player)
//   arrows      at dusk / night a flying arrow carries a small warm light (at most 2); every flying arrow trails the
//               streak of disturbed air the arena drew (player.js drawPixelArrow): two dithered alpha steps along its
//               recent trail, lit, plus a glow copy so the flight stays readable at night
//   marks       ground decals that fade in steps: the player's own (skid scuffs, roll scrapes, turn plants, landing
//               crescents) within ~10-20 s, scorch rings (explode) and holes where arrows stood in a minute or two, wet /
//               charred footprints after a splash in seconds; other features' marks through F.stamp: a bullet's scuff
//               (features/gunfx.js) and blood stains (features/blood.js), gone in ~10-20 s
//   the Ranger  breath puffs in the cold (frost, and at night elsewhere; faster after sprinting), drips after a splash,
//               sparks lifting off the cloak in ember
//
// CONTRACT (features/<name>.js, see main.js): export async function create(host) -> F
//   F.on / F.toggle() / F.key '8'   ?flow=0 starts off (off = the host's plain camera ease, no marks / trails)
//   F.view(dt, evs)      every simulation step: kick / dip, events -> marks, particles, afterimage timing
//   F.camera(dt) -> {x, y}   the spring's position as an offset (view px) from the host's own eased target
//   F.frame(f)           decals (ground layer), particles (points + glow), afterimages (sprites), arrow streaks
//   F.lights()           arrow lights (dusk / night)
//   F.biomeChanged()     marks / particles reset (the arena's setBiome)
//   F.ms                 rolling cost per rendered frame (ms); F.count() breakdown; F.C the camera state (tests)
//   F.TUNE (= F.T)       the arena's tunables, live
//   F.stamp(kind, x, y, dx, dy, k)   a mark from another feature (world metres): 'bullet' a bullet's scuff in the ground
//                        ((dx, dy) its way: a gouge back toward the shooter, a few crumbs thrown ahead); 'blood' a drop's
//                        stain (k 0..1: a pixel .. a little splat; stains close in time and place join one mark)
//
// HOW IT MAPS ONTO THE 3D HOST
//   Camera    the host eases its target T after the player (exp(-9 dt), look-ahead, 30 px headroom) and adds
//             F.camera's offset before snapping it to the pixel lattice. This file mirrors that ease exactly (same
//             formula, same inputs) and returns (spring output - mirrored T), so the camera lands where the arena's
//             spring would put it. The spring works in VIEW-FRAME px (x = vx PPM, y = vy PPMY - h PPMH, the camera-turned
//             ground axes); when the camera turns, its state turns with the frame. The player's velocity is measured
//             from his WORLD motion, so turning the camera never reads as running.
//   Marks     decals are rasterised as in the arena, in its world px at yaw 0 ("decal px": X = x PPM, Y = y PPMY), one
//             RGBA layer per ground height (0, the plateau top). The host's ground layer MIXES (it does not multiply),
//             so each layer pixel holds the ground texel under it (world.groundCanvas) x the mark's tone; overlapping
//             marks keep the darker one ('darken', as in the arena). Each frame the visible part of a layer is drawn
//             into host.glayer('ground') through the ground plane's affine map (nearest), so marks turn with the world
//             like the ground texture does; ground-level marks are clipped out of the plateau's silhouette. A layer is a
//             G.dataImage over its own array (a painted rect goes up with G.texData; no canvas).
//   Particles world metres -> host.point (lit, depth-tested). Glow follows the arena's two emitter paths: sparks,
//             glowing drips and night breath (its view-sized canvas, which lighting.apply drew straight over the lit frame
//             at 1.25 - lum(ambient) x .95, .3..1) -> host.glayer('front') at that alpha; scorch / sole embers and the
//             arrows' air streak (its ground-sized layers: glow x (1 - light), cut where the player stands in front)
//             -> host.layer('emit'), skipping the pixels of the player's silhouette.
//   Ghosts    host.playerSprite() is copied and flattened to the biome tint (source-in) into pooled canvases, drawn at
//             the old positions with the arena's stepped alpha (.35 / .2 / .1) as REAL translucency into the 'pre' layer
//             (mixed into the albedo before the light, as the arena drew them before its lighting pass). As G-buffer
//             cards they could only fake alpha with an ordered dither, which at those levels read as scattered dots.
//             Each frame the player's current silhouette is cut out of any ghost that overlaps him on screen, so a
//             ghost never covers him (the arena sorted them just behind him).
import {flags} from '../core/flags.js';
import {clamp, hash3 as hsh, vnoise as vn, clearArray} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {hexAny255 as hex3, lum} from '../core/color.js';
import {toView, toWorld} from '../render/viewxf.js';
import {TERRAIN_ON} from '../world/layout.js';

const TAU = Math.PI * 2;

// ---------------- tunables (live: __r3d.host.feature('flow').TUNE) ----------------
const TUNE = {
  cam: {w: 9, z: .8, ff: .38,             // follow spring: omega (rad/s), damping ratio, fed-forward share of the player's speed
    pw: 24, pz: .55,                      // punch spring (kicks / dips): stiff, rings back fast
    hyst: .35, snap: .25,                 // screen-offset hysteresis (px over the 0.5 rounding); dt >= snap: jump to the target
    leanX: 22, leanY: 14, leanRX: 150, leanRY: 90, leanIn: 2.6, leanOut: 2.2,   // aim lean: max px, cursor px for full lean, 1/s
    kick: 2.6, dip: 3, dipSoft: 1.2,      // px peaks: bow kick (opposite the shot), hard landing dip, a leap's landing
    gunKick: 3.6, navyK: 1.35, fanK: .6,  // px peak of a revolver's kick (opposite the shot); x for the Navy; x for a fanned shot
    hitKick: 1.3, hitKickBig: 2.2,        // px more when the bullet hits a body; a crit or a kill
    sprintLead: 12, rollLead: 16, leadRate: 5},   // extra px ahead at a full sprint / in a roll, ease rate 1/s
  streak: {rate: 18, speed: 5.5, life: [.15, .25], len: [3, 6]},
  ghost: {every: .05, keep: .18, gap: 6, alpha: [.35, .2, .1]},
  light: {radius: 1.8, dusk: .38, night: .5, max: 2},
  marks: {cap: 250, st: 4,              // st: s per fade stage of the player's own marks (a mark lasts 3-5 stages)
    bullet: 2.5, blood: 3,              // s per stage of F.stamp's marks (a bullet's scuff ~12 s, a blood stain ~18 s)
    join: {t: .7, r: 1.6}},             // blood stains within t s and r m of the last one join its mark (one mark a hit)
  breath: {every: [2, 3], fast: .8, heat: 4},
  wet: {prints: 8, drips: 4},
  air: {tail: .72, a: [.22, .45], glow: [.35, .7]},   // arrow air streak: from the shaft's tail (main.js draws it .72 m), alpha steps
};

// ---------------- palettes ----------------
// marks: MULTIPLY tones, deep -> faint. A pixel's tone index grows by one each stage; past the end it is gone.
const MARK = {
  ruins: ['#7a6e60', '#948878', '#aea496', '#c6beb2', '#ddd8d0'],
  ember: ['#5a504e', '#766c68', '#948c88', '#b2acaa', '#cecac8'],
  frost: ['#7e8ea8', '#96a4bc', '#aebacc', '#c6cedc', '#dce2ec'],   // blue-grey slush
  rift: ['#726290', '#8a7ca6', '#a498bc', '#beb4d0', '#d8d0e4'],
  desert: ['#9a8064', '#ae967a', '#c2ae94', '#d6c8b2', '#e8e0d2'],   // scuffed sand / dust
};
const SCORCH = {
  ruins: ['#857a6e', '#9a9084', '#aea69a', '#c2bcb2', '#d6d2ca', '#e8e6e0'],
  ember: ['#6a5e5c', '#7e7472', '#948c8a', '#aca6a4', '#c4c0be', '#dcd8d6'],
  frost: ['#7686a2', '#8a9ab4', '#a0acc4', '#b6c0d2', '#ccd4e0', '#e0e6ee'],   // melted: wet blue-grey slush
  rift: ['#665888', '#7a6e9a', '#9086ae', '#a8a0c2', '#c0bad4', '#d8d4e4'],
  desert: ['#7e6c5a', '#94826e', '#aa9a86', '#c0b29e', '#d6cab8', '#eae2d6'],
};
const WET = {   // footprints after falling in (ember: charred soles out of the lava)
  ruins: ['#6a7a92', '#8694aa', '#a4aec0', '#c4cad6'],
  ember: ['#3a2c2a', '#5a4a46', '#80726e', '#a89e9a'],
  frost: ['#5e7092', '#7a8cac', '#9caac4', '#bec8da'],
  rift: ['#56467a', '#726496', '#9286b2', '#b4aace'],
  desert: ['#6e5e4a', '#887862', '#a4947e', '#c2b49e'],   // muddy soles out of the creek
};
// blood stains (F.stamp 'blood'): multiply tones, deep -> faint (on sand the deepest is a dark red, ~#72170c)
const BLOOD = ['#8a2018', '#9c3426', '#b04c3a', '#c46a56', '#d68a76', '#e6ac9c'];
const CHIP = {ruins: '#b4a27c', ember: '#8c8078', frost: '#eef4fc', rift: '#9c8cc4', desert: '#d8bc8c'};   // splinter / crumb by an arrow hole
const STREAK = {ruins: ['#e6dcc4', '#c8b894', '#a8987a'], ember: ['#c8beb4', '#a39a92', '#7c746e'],
  frost: ['#e8f0fa', '#c4d0e4', '#98a8c4'], rift: ['#c8b0ec', '#9a7ed4', '#6e56a8'], desert: ['#f0e0bc', '#d6be92', '#b49a72']};
const GHOST = {ruins: '#a8c4d8', ember: '#e09a70', frost: '#c0dcf8', rift: '#7c66b4', desert: '#e0c494'};
const BREATH = {cold: ['#eef4fc', '#b8c6dc'], faint: ['#a4b0c2', '#7c889c'], night: ['#2e3848', '#1c2432']};   // night: a dim emitter lift (moonlit)
const DRIP = {ruins: {pal: ['#d8eef4', '#8cb8c8']}, frost: {pal: ['#e8f4ff', '#a0b8d4']},
  ember: {pal: ['#b8481c', '#5e200e'], emit: ['#ffd070', '#f08a30']}, rift: {pal: ['#7448c4', '#40247a'], emit: ['#e4c8ff', '#ac80f2']},
  desert: {pal: ['#d6ccac', '#9a8e6e']}};
const EMBER = ['#ffd27e', '#f28a36', '#b8481c', '#5e200e'];   // hot -> cold
const ALIGHT = {ruins: '#ffd8a0', ember: '#ffc890', frost: '#ffe4c0', rift: '#f4c8ff', desert: '#ffd49a'};
const AIR = '#efe4c8';   // the arrows' air streak: player.js PX.strTight (PAL.linen[0])
const CHEST = 1.25, MOUTH = 1.55;   // metres: the arrows' height (aim lean origin), breath height
const WATER_H = -.18;   // world.js lowers the stream bed by this much (drips sink there)

const RGBF = new Map(); const rgbf = h => { let v = RGBF.get(h); if (!v) { const c = hex3(h); RGBF.set(h, v = [c[0] / 255, c[1] / 255, c[2] / 255]); } return v; };
const RGB8 = new Map(); const rgb8 = h => { let v = RGB8.get(h); if (!v) RGB8.set(h, v = hex3(h)); return v; };
const ZERO = {x: 0, y: 0, g: 0};

// ORDER (core/features.js): its trails read this step's wind
export const order = {after: ['wind']};
export async function create(host) {
  const Q = flags;
  const {PPM, PPMY, PPMH} = host;
  let {VW, VH} = host;   // the view size: F.resize follows the window
  const F = {name: 'flow', label: 'Flow (camera, trails, marks)', key: '8', on: Q.get('flow') !== '0', ms: 0, TUNE, T: TUNE};
  const K = TUNE.cam;
  // the revolver's kick x the modifiers' note 'flow.gunKick' (base 1: dev/gunfeel.js tunes it live), read when the notes change
  let GK = 1; if (host.mods) { const f = () => { GK = host.mods.value('flow.gunKick', 1); }; host.mods.watch(f); f(); }
  let biome = '', time = 'day', acc = 0, simT = 0;
  const R = mulberry32(71);
  const rr = (a, b) => a + R() * (b - a);
  const tick = t0 => { acc += performance.now() - t0; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d'); q.imageSmoothingEnabled = false; return [c, q]; };
  const windAt = (x, y) => { const w = host.wind; return w && w.on !== false && w.at ? w.at(x, y) : ZERO; };
  const scr = (ux, uy) => { const x = ux * PPM, y = uy * PPMY, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };   // ground dir -> decal-px dir

  // ---------------- the view: the host's projection as an affine map, refreshed per pass ----------------
  const V = {ox: 0, oy: 0, xx: 1, xy: 0, yx: 0, yy: 1, hx: 0, hy: -1, c: 1, s: 0, z: 1};
  function view() {
    const o = host.toView(0, 0, 0), a = host.toView(1, 0, 0), b = host.toView(0, 1, 0), h = host.toView(0, 0, 1);
    V.ox = o[0]; V.oy = o[1]; V.xx = a[0] - o[0]; V.xy = a[1] - o[1]; V.yx = b[0] - o[0]; V.yy = b[1] - o[1]; V.hx = h[0] - o[0]; V.hy = h[1] - o[1];
    V.c = Math.cos(host.yaw); V.s = Math.sin(host.yaw); V.z = host.zoom || 1;
  }
  const SX = (x, y, h) => V.ox + x * V.xx + y * V.yx + h * V.hx, SY = (x, y, h) => V.oy + x * V.xy + y * V.yy + h * V.hy;
  const inView = (X, Y, m) => X > -m && Y > -m && X < VW + m && Y < VH + m;
  // world <-> view frame (the camera-turned ground axes the player runs in), at the current yaw
  const toVF = (x, y) => toView(x, y, host.yaw), toW = (a, b) => toWorld(a, b, host.yaw);

  // drawing: colour buckets (batched fillRects) for the ground / glow layers; lit points
  // ground; front glow (sparks, glowing drips, night breath: the arena's view-sized emitter canvas, drawn straight over the
  // lit frame at 1.25 - lum(ambient) x .95, .3..1); emit (scorch / sole embers, the air streak: the arena's ground-sized
  // emitter layers, glow x (1 - light) with the player's silhouette cut out), the air streak at its two alphas
  const BG = new Map(), BF = new Map(), BE = new Map(), BA = [new Map(), new Map()];
  const put = (bk, c, x, y, w = 1, h = 1) => { let a = bk.get(c); if (!a) bk.set(c, a = []); a.push(x, y, w, h); };
  function flush(bk, q) { for (const [c, a] of bk) { if (!a.length) continue; q.fillStyle = c; for (let i = 0; i < a.length; i += 4) q.fillRect(a[i], a[i + 1], a[i + 2], a[i + 3]); clearArray(a); } }
  const any = bk => { for (const a of bk.values()) if (a.length) return true; return false; };
  const lp = (bk, c, X, Y, dx = 0, dy = 0) => put(bk, c, X + dx * V.z, Y + dy * V.z, V.z, V.z);
  const PO = {size: 1}, PA = [{size: 1, alpha: .22}, {size: 1, alpha: .45}];
  const glowA = () => Math.max(.3, Math.min(1, 1.25 - lum(host.mood?.amb || [1, 1, 1]) * .95));
  // the emit path: ground glow is painted on a private view-sized canvas, the player's silhouette (his card as drawn this
  // frame: anchor snapped to a pixel, pivot, zoom) is cut out of it, as the arena's lighting.apply did, then it goes
  // into host.layer('emit'). (Reading the player's canvas back per pixel would cost ~6 ms: it lives on the GPU.)
  let EC = null, ecq = null;
  function flushEmit() {
    if (!(any(BE) || any(BA[0]) || any(BA[1]))) return;
    if (!EC) [EC, ecq] = mk(VW, VH); else ecq.clearRect(0, 0, VW, VH);
    flush(BE, ecq);
    for (let i = 0; i < 2; i++) if (any(BA[i])) { ecq.globalAlpha = TUNE.air.glow[i]; flush(BA[i], ecq); }
    ecq.globalAlpha = 1;
    const sp = host.playerSprite(), P = host.P;
    if (!(P.blink && Math.floor(P.blink * 12) % 2)) {
      const ax = Math.round(SX(sp.x, sp.y, sp.h)), ay = Math.round(SY(sp.x, sp.y, sp.h));
      ecq.globalCompositeOperation = 'destination-out'; ecq.imageSmoothingEnabled = false;
      ecq.drawImage(sp.img, ax - sp.px * V.z, ay - sp.py * V.z, sp.img.width * V.z, sp.img.height * V.z);
      ecq.globalCompositeOperation = 'source-over';
    }
    host.layer('emit').drawImage(EC, 0, 0);
  }
  const pp = (x, y, h, c, dx = 0, dy = 0) => { PO.size = V.z; host.point(x + dx * V.c / PPM, y - dx * V.s / PPM, h - dy / PPMH, rgbf(c), PO); };

  // ============================================================ camera
  const C = {init: false, x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, pvx: 0, pvy: 0, ox: 0, oy: 0, outX: 0, outY: 0,
    lw: null, vpx: 0, vpy: 0, lean: 0, ax: 0, ay: 0, dx: 0, dy: 0, yaw: 0};
  const Tm = {x: 0, y: 0, z: 0, init: false};   // the host's eased camera target, mirrored (world X, height, world Z = y)
  // velocity for a punch that peaks at `px` pixels (impulse response of the damped punch spring)
  const punchV = px => { const z = K.pz, w = K.pw, q = Math.sqrt(1 - z * z); return px * w / Math.exp(-z / q * Math.atan2(q, z)); };
  function camera(dt) {
    const t0 = performance.now();
    const P = host.P, pl = host.player, yaw = host.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const PX = pl.x, PY = pl.y, Pz = P.z;
    // ---- the host's own ease (main.js draw), mirrored step for step: our offset is measured from it
    if (!Tm.init) {   // flow switched on mid-game: start from the camera as it is (or the player on the very first frame)
      const o = host.toView(0, 0, 0), z = host.zoom || 1, cx = -(o[0] - VW / 2) / z, cyy = -(o[1] - VH / 2) / z;
      const vx = cx / PPM, vy = (cyy + Pz * PPMH) / PPMY, wx = vx * cy + vy * sy, wy = -vx * sy + vy * cy;
      if (Number.isFinite(wx) && Math.hypot(wx - PX, wy - PY) < 12) { Tm.x = wx; Tm.z = wy; } else { Tm.x = PX; Tm.z = PY; }
      Tm.y = Pz; Tm.init = true;
    }
    const lvx = P.vx * .12, lvy = P.vy * .12 - 30 / PPMY, lx = lvx * cy + lvy * sy, ly = -lvx * sy + lvy * cy;
    const ke = 1 - Math.exp(-dt * 9);
    Tm.x += (PX + lx - Tm.x) * ke; Tm.y += (Pz - Tm.y) * ke; Tm.z += (PY + ly - Tm.z) * ke;
    const tvx = Tm.x * cy - Tm.z * sy, tvy = Tm.x * sy + Tm.z * cy, TX = tvx * PPM, TY = tvy * PPMY - Tm.y * PPMH;
    // ---- the camera turned since last frame: turn the spring with the view frame (its state is in view-frame px)
    if (C.init && yaw !== C.yaw) {
      const d = yaw - C.yaw, c = Math.cos(d), s0 = Math.sin(d), rot = (a, b) => [a * c - b * s0, a * s0 + b * c];
      let [a, b] = rot(C.x / PPM, (C.y + Tm.y * PPMH) / PPMY); C.x = a * PPM; C.y = b * PPMY - Tm.y * PPMH;
      [a, b] = rot(C.vx / PPM, C.vy / PPMY); C.vx = a * PPM; C.vy = b * PPMY;
      [a, b] = rot(C.outX / PPM, (C.outY + Tm.y * PPMH) / PPMY); C.outX = a * PPM; C.outY = b * PPMY - Tm.y * PPMH;
    }
    C.yaw = yaw;
    const pxs = P.x * PPM, pys = P.y * PPMY - Pz * PPMH;
    // the player's velocity on the view (px/s), MEASURED from his world motion: right in rolls and leaps (P.vx is stale
    // there), 0 in hitstop, and turning the camera doesn't count
    let vpx = 0, vpy = 0;
    if (C.lw && dt > 1e-4 && dt < K.snap) {
      const dx = PX - C.lw[0], dy = PY - C.lw[1], dz = Pz - C.lw[2], a = (dx * cy - dy * sy) * PPM, b = (dx * sy + dy * cy) * PPMY - dz * PPMH;
      if (Math.abs(a) < 40 && Math.abs(b) < 40) { vpx = a / dt; vpy = b / dt; }   // bigger = a teleport (respawn)
    }
    C.lw = [PX, PY, Pz]; C.vpx = vpx; C.vpy = vpy;
    // the target (view centre, px): the host's (look-ahead + 30 px headroom) + the aim lean + a sprint / roll lead
    let gx = pxs + P.vx * .12 * PPM, gy = pys + P.vy * .12 * PPMY - 30;
    const drawing = P.state === 'draw';
    C.lean = clamp(C.lean + (drawing ? K.leanIn : -K.leanOut) * dt, 0, 1);
    if (C.lean > 0) {
      if (drawing) {   // toward the cursor, from the chest on screen (zoom-1 view px, like the host's mouse)
        const m = host.mouse, sx = VW / 2 + (pxs - C.outX), sy0 = VH / 2 + (pys - CHEST * PPMH - C.outY);
        C.ax = clamp((m.x - sx) / K.leanRX, -1, 1); C.ay = clamp((m.y - sy0) / K.leanRY, -1, 1);
      }   // (released: keep the last aim while it eases back)
      const e = C.lean * C.lean * (3 - 2 * C.lean);
      gx += C.ax * K.leanX * e; gy += C.ay * K.leanY * e;
    }
    const mps = Math.hypot(vpx / PPM, vpy / PPMY), vl = Math.hypot(vpx, vpy);
    let want = 0;
    if (P.state === 'roll') want = K.rollLead;
    else if (P.state === 'move' && !P.skid && (P.gait === 'sprint' || P.gait === 'drive')) want = K.sprintLead * clamp((mps - 5) / 2, 0, 1);
    const kl = 1 - Math.exp(-dt * K.leadRate);
    C.dx += ((vl > 1 ? vpx / vl * want : 0) - C.dx) * kl; C.dy += ((vl > 1 ? vpy / vl * want * .7 : 0) - C.dy) * kl;
    gx += C.dx; gy += C.dy;
    // (re)start: first frame, flow switched on, or a big dt (snap)
    if (!C.init || dt >= K.snap) {
      const snap = dt >= K.snap;
      C.x = snap ? gx : TX; C.y = snap ? gy : TY; C.vx = C.vy = C.px = C.py = C.pvx = C.pvy = 0;
      C.ox = Math.round(pxs - C.x); C.oy = Math.round(pys - C.y); C.init = true;
    } else if (dt > 0) {
      const n = Math.ceil(dt * 120), h = dt / n, w2 = K.w * K.w, z2 = 2 * K.z * K.w;
      const fx = K.ff * vpx, fy = K.ff * vpy;   // fed-forward speed (the 3D world has no clamped edges)
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
    C.outX = pxs - C.ox + Math.round(C.px); C.outY = pys - C.oy + Math.round(C.py);
    // (the sub-pixel camera, render/camera.js: the view glides in screen px, so the spring goes out as it is; a held whole-px
    // offset would jump the whole view an art px each time it let go)
    if (host.G.sub?.pad > 0) { C.outX = C.x + Math.round(C.px); C.outY = C.y + Math.round(C.py); }
    tick(t0);
    return {x: C.outX - TX, y: C.outY - TY};
  }
  function kick(ux, uy, px) { const v = punchV(px); C.pvx -= ux * v; C.pvy -= uy * v; }   // camera goes AGAINST (ux, uy)
  function gunKick(wx, wy, px) {   // a shot's way on the ground (world, unit) -> the view frame's px direction, then the kick
    const v = toVF(wx, wy), vx = v[0] * PPM, vy = v[1] * PPMY, l = Math.hypot(vx, vy);
    if (l > 1e-6) kick(vx / l, vy / l, px);
  }

  // ============================================================ marks (decals)
  // decal px: the arena's world px at yaw 0 without the height (X = x PPM, Y = y PPMY); each decal keeps its ground height
  const decals = [];   // {pix: [X, Y, tone, ...], set, ramp, st, z, t, stage, min, x0, y0, x1, y1, chips}
  let dirty = [];      // [z, x0, y0, x1, y1]
  const levels = new Map();   // ground height -> {z, x0, y0, w, h, D, gi}: the baked layer (ground x tone; gi: D as a G.dataImage)
  const WPX = () => host.ctxO.WPX || Math.ceil(62 * PPM), HPX = () => host.ctxO.HPX || Math.ceil(30 * PPMY);
  const plats = () => host.layout?.plateaus || [];
  function level(z) {
    let L = levels.get(z); if (L) return L;
    let x0 = 0, y0 = 0, x1 = WPX(), y1 = HPX();
    if (z) {   // a plateau top: just its box
      x0 = 1e9; y0 = 1e9; x1 = -1e9; y1 = -1e9;
      for (const q of plats()) if (q.h === z) { x0 = Math.min(x0, Math.floor(q.x0 * PPM) - 2); y0 = Math.min(y0, Math.floor(q.y0 * PPMY) - 2); x1 = Math.max(x1, Math.ceil(q.x1 * PPM) + 2); y1 = Math.max(y1, Math.ceil(q.y1 * PPMY) + 2); }
      if (x1 <= x0) { x0 = 0; y0 = 0; x1 = WPX(); y1 = HPX(); }
    }
    const w = x1 - x0, h = y1 - y0, D = new Uint8ClampedArray(w * h * 4);
    levels.set(z, L = {z, x0, y0, w, h, D, gi: host.G.dataImage(w, h, D)});
    if (TERRAIN_ON && z === 0) host.G.setGroundDecals?.(L.gi, x0, y0, PPM, PPMY);   // (walkable terrain: the ground surfaces show it themselves)
    return L;
  }
  // the ground texture (world.js paints it top-down at PPM px / m) for the multiply: read back lazily in 64 px tiles
  let gC = null, gQ = null, gW = 0, gH = 0;
  const gTiles = new Map();
  function texel(x, y) {   // world metres -> [r, g, b] 0..255 of the ground texel there (white when unknown)
    const c = host.world?.groundCanvas;
    if (c !== gC) { gC = c; gTiles.clear(); gQ = c ? c.getContext('2d', {willReadFrequently: true}) : null; gW = c?.width || 0; gH = c?.height || 0; }
    if (!gQ) return WHITE;
    const gx = Math.min(gW - 1, Math.max(0, Math.floor(x * PPM))), gy = Math.min(gH - 1, Math.max(0, Math.floor(y * PPM))), k = (gx >> 6) + (gy >> 6) * 4096;
    let t = gTiles.get(k);
    if (!t) { try { t = gQ.getImageData(gx & ~63, gy & ~63, 64, 64).data; } catch { return WHITE; } gTiles.set(k, t); }
    const i = ((gy & 63) * 64 + (gx & 63)) * 4; TX[0] = t[i]; TX[1] = t[i + 1]; TX[2] = t[i + 2]; return TX;
  }
  const WHITE = [255, 255, 255], TX = [0, 0, 0];
  // a decal pixel on the surface at height z: not on the water, not over the cliff lip
  const valid = (X, Y, z) => { const mx = (X + .5) / PPM, my = (Y + .5) / PPMY; return (TERRAIN_ON && z === 0 ? !host.layout.plateauAt(mx, my) : Math.abs(host.elev(mx, my) - z) < .01) && !(z === 0 && host.inStream(mx, my)); };
  // WALKABLE TERRAIN (docs/TERRAIN.md, step 3 to come): a layer per height would be a world-sized layer per decal on a slope, so a
  // decal off a plateau's top goes on the ground's layer (0), and valid() keeps only its pixels where the ground lies level with it
  const levelZ = z => !TERRAIN_ON || z === 0 || plats().some(q => q.h === z) ? z : 0;
  function decal(ramp, st, z) { z = levelZ(z); return {pix: [], set: new Map(), ramp, rgb: ramp.map(rgb8), st, z, t: 0, stage: 0, min: 9, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, d: null}; }
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
    if (d.d) { dirty.push([d.z, ...d.d]); d.d = null; }
    if (!keep) d.set = null;
    if (!d.pix.length) return null;
    if (!decals.includes(d)) { decals.push(d); while (decals.length > TUNE.marks.cap) { const o = decals.shift(); dirty.push([o.z, o.x0, o.y0, o.x1, o.y1]); } }
    return d;
  }
  // repaint one dirty rect of a level from every mark of that level that touches it: ground texel x tone, darkest wins
  function paintRect(z, rx0, ry0, rx1, ry1) {
    const L = level(z), x0 = Math.max(L.x0, rx0), y0 = Math.max(L.y0, ry0), x1 = Math.min(L.x0 + L.w, rx1), y1 = Math.min(L.y0 + L.h, ry1);
    if (x1 <= x0 || y1 <= y0) return;
    const D = L.D, W = L.w;
    for (let y = y0; y < y1; y++) D.fill(0, ((y - L.y0) * W + x0 - L.x0) * 4, ((y - L.y0) * W + x1 - L.x0) * 4);
    for (const d of decals) {
      if (d.z !== z || d.x1 <= x0 || d.x0 >= x1 || d.y1 <= y0 || d.y0 >= y1) continue;
      const Pp = d.pix, rp = d.rgb, st = d.stage, n = rp.length;
      for (let i = 0; i < Pp.length; i += 3) {
        const x = Pp[i], y = Pp[i + 1]; if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        const k = Pp[i + 2] + st; if (k >= n) continue;
        const t = rp[k], o = ((y - L.y0) * W + x - L.x0) * 4;
        const G = texel((x + .5) / PPM, (y + .5) / PPMY), r = G[0] * t[0] / 255, g = G[1] * t[1] / 255, b = G[2] * t[2] / 255;
        if (D[o + 3]) { if (r < D[o]) D[o] = r; if (g < D[o + 1]) D[o + 1] = g; if (b < D[o + 2]) D[o + 2] = b; }
        else { D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = 255; }
      }
    }
    host.G.texData(L.gi, x0 - L.x0, y0 - L.y0, x1 - x0, y1 - y0, D, W, x0 - L.x0, y0 - L.y0);   // (the rect into its texture)
  }
  function ageDecals(dt) {
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i]; d.t += dt;
      const st = Math.floor(d.t / d.st);
      if (st === d.stage) continue;
      d.stage = st; dirty.push([d.z, d.x0, d.y0, d.x1, d.y1]);
      if (st + d.min >= d.ramp.length) decals.splice(i, 1);
    }
  }
  const ground = (x, y) => levelZ(host.elev(x, y));
  const wpx = (x, y) => [Math.round(x * PPM), Math.round(y * PPMY)];
  // a crescent of soil pushed up at a foot, bulging toward (ux, uy) (ground dir). rx, ry px, span rad either side
  function crescent(x, y, ux, uy, o = {}) {
    const z = ground(x, y), d = decal(MARK[biome], o.st || TUNE.marks.st, z), cx = x * PPM, cy = y * PPMY, [vx, vy] = scr(ux, uy), a0 = Math.atan2(vy, vx);
    const rx = o.rx || 2.6, ry = o.ry || 1.7, span = o.span || 1.25, tone = o.tone ?? 1;
    for (let a = -span; a <= span + 1e-6; a += .16) dot(d, Math.round(cx + Math.cos(a0 + a) * rx), Math.round(cy + Math.sin(a0 + a) * ry), tone);
    if (o.dent !== false) dot(d, Math.round(cx), Math.round(cy), tone + 1);   // the heel's dent
    return commit(d);
  }
  // explosion scorch: ragged soot disc, a dark burnt ring, radial cracks; fresh embers glow in it for a while
  function scorch(x, y, r) {
    const z = ground(x, y), R0 = clamp(r * .36, .5, 1.1), cx = x * PPM, cy = y * PPMY, rx = R0 * PPM, ry = R0 * PPMY;
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
    for (let i = 0; i < n && emb.length; i++) { const [ex, ey] = emb.splice(R() * emb.length | 0, 1)[0]; gEmb.push({x: ex, y: ey, z, t: 0, life: rr(life[0], life[1]), ph: R()}); }
  }
  // arrow hole: a dark pinhole + a gouge toward where it came from, a pale splinter / crumb chip beside it
  function hole(h) {
    const d = decal(MARK[biome], 20, h.z), [X, Y] = wpx(h.x, h.y), [ux, uy] = scr(h.vx, h.vy);
    dot(d, X, Y, 0); dot(d, Math.round(X - ux * 1.2), Math.round(Y - uy * 1.2), 1);
    if (!commit(d)) return;
    const side = R() < .5 ? -1 : 1, cxp = Math.round(X - uy * side * 2 - ux), cyp = Math.round(Y + ux * side * 2 - uy);
    if (valid(cxp, cyp, h.z)) d.chips = [cxp, cyp];
  }
  // a wet (charred, violet) footprint: a small sole along the stride, the heel a tone lighter
  const SOLE = {h: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 1]], v: [[0, -1, 0], [0, 0, 0], [1, -1, 1]],
    d1: [[-1, -1, 0], [0, 0, 0], [1, 1, 1]], d2: [[1, -1, 0], [0, 0, 0], [-1, 1, 1]]};
  function print(x, y, tone) {
    const z = ground(x, y), d = decal(WET[biome], 2.5, z), [X, Y] = wpx(x, y), ax = Math.abs(dirX), ay = Math.abs(dirY);
    const S = ax > .85 ? SOLE.h : ay > .85 ? SOLE.v : dirX * dirY > 0 ? SOLE.d1 : SOLE.d2;
    for (const [i, j, k] of S) dot(d, X + i, Y + j, Math.min(3, tone + k));
    if (commit(d) && biome === 'ember' && tone === 0 && R() < .6) gEmb.push({x: X, y: Y, z, t: 0, life: rr(1.2, 2.2), ph: R()});   // hot soles
  }
  // continuous marks: the skid (two parallel streaks under the feet) and the roll scrape grow while they last
  const SK = {d: null, last: null, n: 0, sd: 0}, RL = {d: null, last: null, len: 0, next: 0};
  function trackSkid(P, speed) {
    if (!(P.skid && P.state === 'move' && speed > .7)) { if (SK.d) { SK.d.set = null; SK.d = null; } return; }
    // the heels dig in hardest at the start; the streaks thin out as he slows, wander a pixel, break up now and then
    const z = ground(P.x, P.y), ux = P.vx / speed, uy = P.vy / speed, tone = speed > 6 ? 0 : speed > 3.2 ? 1 : 2, pts = [];
    for (const side of [-1, 1]) { const o = side * (.1 + (vn(SK.n / 9, side + 3, SK.sd) - .5) * .07); pts.push(wpx(P.x + uy * o, P.y - ux * o)); }
    if (!SK.d || SK.d.z !== z) { SK.d = decal(MARK[biome], TUNE.marks.st, z); SK.n = 0; SK.sd = (R() * 9e5) | 0; for (const [x, y] of pts) dot(SK.d, x, y, tone); }
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
    const z = ground(P.x, P.y), [X, Y] = wpx(P.x, P.y);
    if (!RL.d || RL.d.z !== z) { RL.d = decal(MARK[biome], TUNE.marks.st, z); RL.len = 0; RL.next = 0; RL.last = [X, Y]; }
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
  // other features' marks (F.stamp): a bullet's scuff; blood stains, joined into the last stain's mark when close
  const BL = {d: null, t: -9, x: 0, y: 0};
  function stamp(kind, x, y, dx = 0, dy = 0, k = 0) {
    if (!F.on || !biome) return;
    const z = ground(x, y), X = Math.round(x * PPM), Y = Math.round(y * PPMY);
    if (z === 0 && host.inStream(x, y)) return;
    if (kind === 'blood') {
      const J = TUNE.marks.join;
      if (!(BL.d && BL.d.z === z && simT - BL.t < J.t && Math.abs(x - BL.x) + Math.abs(y - BL.y) < J.r && decals.includes(BL.d))) { if (BL.d) BL.d.set = null; BL.d = decal(BLOOD, TUNE.marks.blood, z); BL.x = x; BL.y = y; }
      BL.t = simT; const d = BL.d;
      dot(d, X, Y, k > .6 ? 0 : 1);
      if (k > .35) dot(d, X + (R() < .5 ? -1 : 1), Y, 1);
      if (k > .7) { const [ux, uy] = scr(dx, dy); dot(d, X, Y + (R() < .5 ? -1 : 1), 2); dot(d, X + Math.round(ux * 2), Y + Math.round(uy * 2), 2); }   // (a splat: a tail along its fall)
      commit(d, true); return;
    }
    const d = decal(MARK[biome], TUNE.marks.bullet, z), [ux, uy] = scr(dx, dy);
    dot(d, X, Y, 0); dot(d, Math.round(X - ux * 1.3), Math.round(Y - uy * 1.3), 1);   // the hole, the gouge back toward the shot
    for (let i = 0; i < 3; i++) { const f = rr(1.6, 3.4), s = rr(-1.3, 1.3); dot(d, Math.round(X + ux * f - uy * s), Math.round(Y + uy * f + ux * s), 2 + (R() < .5 ? 1 : 0)); }   // crumbs thrown ahead
    commit(d);
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
  // the plateau's silhouette on screen (convex hull of its box), cut out of the ground-level marks: ground behind the
  // block projects onto its top / faces, which are ground pixels too
  function hull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function drawDecals() {
    for (const L of levels.values()) {
      if (TERRAIN_ON && L.z === 0) continue;   // (the ground surfaces draw the ground's layer: G.setGroundDecals)
      let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
      for (const d of decals) if (d.z === L.z) { if (d.x0 < u0) u0 = d.x0; if (d.y0 < v0) v0 = d.y0; if (d.x1 > u1) u1 = d.x1; if (d.y1 > v1) v1 = d.y1; }
      if (u1 <= u0) continue;
      // decal px -> view px: X / PPM, Y / PPMY metres at height z, through the projection
      const a = V.xx / PPM, b = V.xy / PPM, c = V.yx / PPMY, d = V.yy / PPMY, e = SX(0, 0, L.z), f = SY(0, 0, L.z), det = a * d - b * c;
      if (Math.abs(det) < 1e-9) continue;
      let w0 = 1e9, z0 = 1e9, w1 = -1e9, z1 = -1e9;
      for (const [X, Y] of [[0, 0], [VW, 0], [0, VH], [VW, VH]]) {
        const u = (d * (X - e) - c * (Y - f)) / det, v = (-b * (X - e) + a * (Y - f)) / det;
        if (u < w0) w0 = u; if (u > w1) w1 = u; if (v < z0) z0 = v; if (v > z1) z1 = v;
      }
      // the visible part, 2 px of margin (the transformed rectangle's own edges stay transparent: no soft border)
      const x0 = Math.max(L.x0, Math.floor(Math.max(u0, w0)) - 2), y0 = Math.max(L.y0, Math.floor(Math.max(v0, z0)) - 2);
      const x1 = Math.min(L.x0 + L.w, Math.ceil(Math.min(u1, w1)) + 2), y1 = Math.min(L.y0 + L.h, Math.ceil(Math.min(v1, z1)) + 2);
      if (x1 <= x0 || y1 <= y0) continue;
      const q = host.glayer('ground');   // (the GPU draws it: G.glayer)
      q.save(); q.setTransform(1, 0, 0, 1, 0, 0);
      if (L.z === 0 && plats().length) {   // cut out of the plateau's silhouette (even-odd, as a canvas's rect + hulls + clip('evenodd'))
        const polys = [];
        for (const p of plats()) {
          const pts = []; for (const x of [p.x0, p.x1]) for (const y of [p.y0, p.y1]) for (const h of [0, p.h]) pts.push([SX(x, y, h), SY(x, y, h)]);
          polys.push(hull(pts));
        }
        q.clipOutside(polys);
      }
      q.setTransform(a, b, c, d, e, f); q.globalAlpha = 1; q.globalCompositeOperation = 'source-over';
      q.drawImage(L.gi, x0 - L.x0, y0 - L.y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      q.restore();
    }
  }

  // ============================================================ particles (world space)
  // k: 0 streak, 1 breath, 2 drip, 3 drip splash, 4 spark (metres)
  const ps = [], gEmb = [];
  let streakAcc = 0, breathT = 1.5, heat = 0, dripAcc = 0, sparkAcc = 0, splashT = -99, wetFrom = -99;
  // a speed streak peeling off the body: a 1 px line trailing back along the run, len px on screen
  function spawnStreak(P) {
    const sp = Math.hypot(P.vx, P.vy) || 1, ux = P.vx / sp, uy = P.vy / sp, rawP = host.P;
    const [dx] = scr(rawP.vx, rawP.vy), hp = rr(10, 44);   // (the run on screen: the view-frame velocity)
    const ox = Math.abs(dx) > .45 ? -Math.sign(dx) * rr(6, 9) : (R() < .5 ? -1 : 1) * rr(8, 10);   // trailing edge / a side
    const off = (ox - dx * rr(0, 3)) / PPM, [rx, ry] = toW(1, 0);   // screen px -> metres along the screen's right
    // (shown from t = 0: ~2 frames after it peels off, when the body has moved clear of it: never a line across the bow)
    ps.push({k: 0, x: P.x + rx * off, y: P.y + ry * off, h: P.z + hp / PPMH, ux: -ux, uy: -uy,
      len: Math.round(rr(TUNE.streak.len[0], TUNE.streak.len[1] + .99)), t: -.035, life: rr(TUNE.streak.life[0], TUNE.streak.life[1])});
  }
  function breathe(P) {
    const a = host.player.faceAngle - host.yaw, fx = Math.sin(a), fy = Math.cos(a);   // facing in the view frame
    if (fy < -.55) return;   // facing away: the mouth is behind the head
    // it starts just past the face (never as specks ON it); facing the viewer it leaves past a cheek, downwind
    let ox = fx * .3, oy = fy * .3, lx = 0;
    if (fy > .7) { const w = windAt(P.x, P.y), wv = toVF(w.x, w.y)[0]; lx = wv > .05 ? 1 : wv < -.05 ? -1 : R() < .5 ? -1 : 1; ox = lx * .24; oy = .1; }
    const cold = biome === 'frost', n = 3 + (R() < .5) + (cold && R() < .5 ? 1 : 0), [wx, wy] = toW(ox, oy), x = P.x + wx, y = P.y + wy, h = P.z + MOUTH;
    for (let i = 0; i < n; i++) {
      const sp = rr(.35, .75), [vx, vy] = toW(fx * sp + lx * sp * .6 + (R() - .5) * .14, fy * sp * (lx ? .4 : .8) + (R() - .5) * .1), [jx, jy] = toW((R() - .5) * .05, 0);
      ps.push({k: 1, x: x + jx, y: y + jy, h: h + (R() - .5) * .05, vx, vy, vh: rr(.02, .16), t: -i * .035, life: rr(.55, .9), pal: cold ? BREATH.cold : BREATH.faint});
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
        const z = ground(p.x, p.y), w = z === 0 && host.inStream(p.x, p.y);
        if (p.h <= (w ? WATER_H : z)) { if (w) p.life = 0; else { p.k = 3; p.h = z; p.t = 0; p.life = .14; } }
      } else if (p.k === 4) {   // spark: rises, wobbles, drifts with the wind
        const w = windAt(p.x, p.y);
        p.h += p.vh * dt; p.vh *= Math.exp(-dt * .6); p.x += (w.x * .6 + Math.sin(p.t * 7 + p.ph * TAU) * .28) * dt; p.y += w.y * .6 * dt;
      }
    }
    for (let i = gEmb.length - 1; i >= 0; i--) if ((gEmb[i].t += dt) >= gEmb[i].life) { gEmb[i] = gEmb[gEmb.length - 1]; gEmb.pop(); }
  }
  const emberTone = e => { const a = e.t / e.life, f = Math.sin(e.t * 9 + e.ph * TAU) > .2 ? 0 : 1; return Math.min(3, (a < .3 ? 0 : a < .65 ? 1 : 2) + f); };

  // ============================================================ afterimages
  const GH = {list: [], pool: [], acc: 0, due: false, lx: 1e9, ly: 1e9};
  const pview = () => { const P = host.P; return [P.x * PPM, P.y * PPMY - P.z * PPMH]; };   // the player in view-frame px
  function capture() {
    const sp = host.playerSprite(), w = sp.img.width, h = sp.img.height;   // (sp.h is the height in metres: the key is used twice)
    let g = GH.pool.pop(); if (!g) { const [c, q] = mk(w, h), [d, dq] = mk(w, h); g = {c, q, d, dq}; }
    for (const [c, q] of [[g.c, g.q], [g.d, g.dq]]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; q.imageSmoothingEnabled = false; }
    const q = g.q; q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, w, h);
    q.drawImage(sp.img, 0, 0);   // body + cloak + bow as drawn this frame
    q.globalCompositeOperation = 'source-in'; q.fillStyle = GHOST[biome] || GHOST.ruins; q.fillRect(0, 0, w, h);
    q.globalCompositeOperation = 'source-over';
    GH.list.push({...g, x: sp.x, y: sp.y, z: sp.h, t: 0, px: sp.px, py: sp.py});
    [GH.lx, GH.ly] = pview();
  }
  function drawGhosts() {
    if (!GH.list.length) return;
    const A = TUNE.ghost.alpha, band = TUNE.ghost.keep / A.length, sp = host.playerSprite();
    const PXs = Math.round(SX(sp.x, sp.y, sp.h)), PYs = Math.round(SY(sp.x, sp.y, sp.h));
    let pq = null;
    for (const gh of GH.list) {
      const a = A[Math.min(A.length - 1, Math.floor(gh.t / band))];
      const gx = Math.round(SX(gh.x, gh.y, gh.z)), gy = Math.round(SY(gh.x, gh.y, gh.z));
      // the player's current silhouette, at his offset from this ghost (card px = screen px / zoom), cut out of it
      const ox = Math.round((PXs - gx) / V.z) + gh.px - sp.px, oy = Math.round((PYs - gy) / V.z) + gh.py - sp.py;
      let img = gh.c;
      if (Math.abs(ox) < gh.c.width && Math.abs(oy) < gh.c.height) {
        const q = gh.dq; q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, gh.d.width, gh.d.height); q.drawImage(gh.c, 0, 0);
        q.globalCompositeOperation = 'destination-out'; q.drawImage(sp.img, ox, oy); q.globalCompositeOperation = 'source-over';
        img = gh.d;
      }
      pq ??= host.layer('pre');
      pq.globalAlpha = a; pq.imageSmoothingEnabled = false;
      pq.drawImage(img, gx - gh.px * V.z, gy - gh.py * V.z, img.width * V.z, img.height * V.z);
    }
    if (pq) pq.globalAlpha = 1;
  }

  // ============================================================ the arrows' air streak
  function airStreaks() {
    const A = TUNE.air;
    for (const a of host.arrows) {
      if (a.stuck || !a.trail || a.trail.length < 2) continue;
      const l = Math.hypot(a.vx, a.vy, a.vh) || 1, tx = a.x - a.vx / l * A.tail, ty = a.y - a.vy / l * A.tail, th = a.h - a.vh / l * A.tail;
      const [ox, oy, oh] = a.trail[0];
      if (Math.hypot(SX(tx, ty, th) - SX(ox, oy, oh), SY(tx, ty, th) - SY(ox, oy, oh)) <= 2 * V.z) continue;
      const mx = (ox + tx) / 2, my = (oy + ty) / 2, mh = (oh + th) / 2;
      seg(ox, oy, oh, mx, my, mh, 0); seg(mx, my, mh, tx, ty, th, 1);
    }
  }
  function seg(x0, y0, h0, x1, y1, h1, i) {   // dithered lit pixels along it (one per screen px), + the glow copy
    const n = Math.max(1, Math.ceil(Math.hypot(SX(x1, y1, h1) - SX(x0, y0, h0), SY(x1, y1, h1) - SY(x0, y0, h0)) / V.z)), o = PA[i], c = rgbf(AIR), bk = BA[i];
    o.size = V.z; o.alpha = TUNE.air.a[i];
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, h = h0 + (h1 - h0) * t, X = Math.floor(SX(x, y, h)), Y = Math.floor(SY(x, y, h));
      if (!inView(X, Y, 2)) continue;
      host.point(x, y, h, c, o); put(bk, AIR, X, Y, V.z, V.z);
    }
  }

  // ============================================================ the frame
  let dirX = 1, dirY = 0, prevState = 'idle', lastShots = null;
  const seen = new WeakSet();
  const ids = new WeakMap(); let nextId = 0;
  function update(dt, evs) {
    const t0 = performance.now();
    const raw = host.P, pl = host.player;
    // the player in the world (the arena's P, in metres): x, y, vx, vy world; the rest from the player as it is
    const P = {x: pl.x, y: pl.y, z: raw.z, vx: pl.vx, vy: pl.vy, state: raw.state, t: raw.t, skid: raw.skid, gait: raw.gait, sink: raw.sink, frame: raw.frame,
      turn: raw.turn, fall0: raw.fall0, leap: raw.leap, rollDir: raw.rollDir};
    if (host.biome.id !== biome) setBiome(host.biome.id);
    time = host.time;
    dt = Math.min(.05, Math.max(0, dt || 0)); simT += dt;
    view();
    const speed = Math.hypot(P.vx, P.vy);
    // ---- the bow's kick: a new arrow leaving the player (a shot or an ability; not rain from the sky) ----
    const shots = host.PL?.shots ?? 0; let kx = 0, ky = 0, kn = 0;
    for (const a of host.arrows) {
      if (seen.has(a)) continue; seen.add(a);
      if (a.stuck || Math.hypot(a.x - P.x, a.y - P.y) > 1.5 || a.h > P.z + 2.5) continue;
      const [avx, avy] = toVF(a.vx, a.vy), vx = avx * PPM, vy = avy * PPMY - (a.vh || 0) * PPMH, l = Math.hypot(vx, vy) || 1; kx += vx / l; ky += vy / l; kn++;
    }
    if (kn || (lastShots !== null && shots > lastShots)) {
      const l = Math.hypot(kx, ky); if (l > 1e-3) kick(kx / l, ky / l, K.kick * (kn > 1 ? 1.2 : 1));
    }
    lastShots = shots;
    // ---- events ----
    let dip = 0;
    const side = (e, s0) => { const s1 = (e.foot || s0) === 'R' ? -1 : 1; return [e.x + dirY * s1 * .09, e.y - dirX * s1 * .09]; };   // left of travel = (dy, -dx)
    // the PLAYER's own events: features push land / splash / ... too (with a prop or a kind); his carry his position
    const mine = e => !e.prop && !e.kind && Math.hypot(e.x - P.x, e.y - P.y) < .4;
    for (const e of evs || []) {
      if ((e.type === 'player.land' || e.type === 'player.step' || e.type === 'player.jump' || e.type === 'player.splash') && !mine(e)) continue;
      if (e.type === 'player.land' && P.state === 'land') {   // a real landing (sprint footfalls are 'player.land' too, big 2, state 'move')
        if (e.big >= 3) { dip = Math.max(dip, K.dip); crescent(e.x, e.y, dirX, dirY, {rx: 5, ry: 3, span: 2.5, tone: 1, dent: false}); }
        else if (e.big === 2) {
          const drop = prevState === 'fall' ? (P.fall0 ?? P.z) - P.z : 0;
          dip = Math.max(dip, prevState === 'fall' ? K.dipSoft + (K.dip - K.dipSoft) * clamp((drop - .3) / 1.5, 0, 1) : K.dipSoft);
          for (const s0 of ['L', 'R']) { const [x, y] = side({...e, foot: s0}); crescent(x, y, dirX, dirY, {tone: 1}); }
        }
      } else if (e.type === 'player.land' && e.big === 2 && P.turn && /a$/.test(P.frame)) {   // turn plant: soil pushed toward the old momentum
        const [x, y] = side(e); crescent(x, y, dirX, dirY, {tone: 1});
      } else if (e.type === 'player.jump') {   // take-off: a faint crescent behind the push
        const L = P.leap; if (L) { const [ldx, ldy] = toW(L.dx, L.dy); crescent(e.x - ldx * .12, e.y - ldy * .12, -ldx, -ldy, {tone: 2}); }
      } else if (e.type === 'player.splash' && !e.small && P.state === 'splash') { splashT = simT; wetFrom = -99; }   // HIS splash
      else if (e.type === 'combat.explode') scorch(e.x, e.y, e.r || 2);
      else if (e.type === 'player.shoot') gunKick(e.vx, e.vy, K.gunKick * GK * (e.gun === 'brass_navy' ? K.navyK : 1) * (e.fan ? K.fanK : 1));
      else if (e.type === 'combat.hit' && e.by === 'bullet' && (e.who?.hunter || e.who?.sparring || e.who?.target)) gunKick(e.dx, e.dy, (e.broke || e.crit ? K.hitKickBig : K.hitKick) * GK);
      else if (e.type === 'fist.hit') gunKick(-e.dx, -e.dy, e.kick * .8);   // a fist landing (features/fists.js): the view jolts along the blow
      if ((e.type === 'player.step' || e.type === 'player.land') && P.state !== 'splash' && wetFrom > -99 && simT - wetFrom < TUNE.wet.prints) {   // (sprint footfalls are 'land')
        const age = simT - wetFrom, [x, y] = side(e); print(x, y, age < TUNE.wet.prints * .45 ? 0 : age < TUNE.wet.prints * .8 ? 1 : 2);
      }
    }
    if (dip) C.pvy += punchV(dip);
    if (splashT > -99 && P.state !== 'splash' && prevState === 'splash') wetFrom = simT;   // back on the bank: dripping
    // ---- direction of travel (after the events: a turn plant wants the momentum from before the turn) ----
    if (P.state === 'roll' && P.rollDir) { [dirX, dirY] = toW(P.rollDir[0], P.rollDir[1]); }
    else if (speed > .3) { dirX = P.vx / speed; dirY = P.vy / speed; }
    // ---- marks ----
    trackSkid(P, speed); trackRoll(P); trackArrows(); ageDecals(dt);
    // ---- particles ----
    const sprint = P.state === 'move' && !P.skid && (P.gait === 'sprint' || P.gait === 'drive') && speed > TUNE.streak.speed;
    if (sprint) { heat = TUNE.breath.heat; for (streakAcc += TUNE.streak.rate * dt; streakAcc >= 1; streakAcc--) spawnStreak(P); }
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
      GH.acc += dt; const [sx, sy] = pview();
      if (GH.acc >= TUNE.ghost.every && Math.hypot(sx - GH.lx, sy - GH.ly) >= TUNE.ghost.gap) { GH.due = true; GH.acc = 0; }
    } else { GH.acc = TUNE.ghost.every; GH.lx = GH.ly = 1e9; GH.due = false; }
    prevState = P.state;
    tick(t0);
  }

  function frame() {
    const t0 = performance.now();
    F.ms = F.ms * .95 + acc * .05; acc = 0;   // one sample per rendered frame: last frame's draws + this frame's steps / camera
    if (!biome) { tick(t0); return; }
    view();
    // ---- marks: the baked layers (ground x tone) into the ground layer; chips; fresh embers
    if (dirty.length) for (const r of dirty.splice(0, 32)) paintRect(...r);   // (the rest next frame)
    if (decals.length) {
      drawDecals();
      for (const d of decals) if (d.chips && d.stage < 2) {
        const x = (d.chips[0] + .5) / PPM, y = (d.chips[1] + .5) / PPMY, X = Math.floor(SX(x, y, d.z)), Y = Math.floor(SY(x, y, d.z));
        if (inView(X, Y, 2)) lp(BG, CHIP[biome] || CHIP.ruins, X, Y);
      }
    }
    for (const e of gEmb) {   // fresh embers: an opaque base pixel (reads by day), the glow on top (at night)
      const x = (e.x + .5) / PPM, y = (e.y + .5) / PPMY, X = Math.floor(SX(x, y, e.z)), Y = Math.floor(SY(x, y, e.z));
      if (!inView(X, Y, 2)) continue;
      const k = emberTone(e); pp(x, y, e.z, EMBER[k + 1] || EMBER[3]);
      if (k < 3) lp(BE, EMBER[k], X, Y);
    }
    if (any(BG)) flush(BG, host.glayer('ground'));
    // ---- afterimages (the ghost captured this frame: the player's card as it is drawn now)
    if (GH.due) { GH.due = false; capture(); }
    drawGhosts();
    // ---- particles: streaks, breath, drips, sparks (lit points); glow
    const SPal = STREAK[biome] || STREAK.ruins, night = time === 'night';
    for (const p of ps) {
      if (p.t < 0) continue;
      if (p.k === 0) {   // streak: a 1 px line trailing back along the run, fading in 3 steps
        const X = SX(p.x, p.y, p.h), Y = SY(p.x, p.y, p.h); if (!inView(X, Y, 8 * V.z)) continue;
        const c = SPal[Math.min(2, Math.floor(p.t / p.life * 3))], dX = p.ux * V.xx + p.uy * V.yx, dY = p.ux * V.xy + p.uy * V.yy, st = V.z / (Math.hypot(dX, dY) || 1);
        for (let i = 0; i < p.len; i++) pp(p.x + p.ux * st * i, p.y + p.uy * st * i, p.h, c);
        continue;
      }
      const X = Math.floor(SX(p.x, p.y, p.h)), Y = Math.floor(SY(p.x, p.y, p.h));
      if (!inView(X, Y, 2 * V.z)) continue;
      if (p.k === 1) { const i = p.t < p.life * .55 ? 0 : 1; pp(p.x, p.y, p.h, p.pal[i]); if (night) lp(BF, BREATH.night[i], X, Y); }
      else if (p.k === 2) { pp(p.x, p.y, p.h, p.pal[0]); if (p.emit) lp(BF, p.emit[0], X, Y); }
      else if (p.k === 3) {
        if (p.t < .06) { pp(p.x, p.y, p.h, p.pal[1], -1, 0); pp(p.x, p.y, p.h, p.pal[1], 1, 0); pp(p.x, p.y, p.h, p.pal[0], 0, -1); } else pp(p.x, p.y, p.h, p.pal[1]);
        if (p.emit) lp(BF, p.emit[1], X, Y);
      } else if (p.k === 4) { const k = Math.min(3, Math.floor(p.t / p.life * 4)); pp(p.x, p.y, p.h, EMBER[k]); if (k <= 2) lp(BF, EMBER[k], X, Y); }
    }
    airStreaks();
    if (any(BF)) { const q = host.glayer('front'); q.save(); q.globalAlpha = glowA(); flush(BF, q); q.restore(); }
    flushEmit();
    tick(t0);
  }

  function lights() {
    if (time === 'day') return [];
    const A = host.arrows, L = TUNE.light, out = [], k = time === 'night' ? L.night : L.dusk;
    for (let i = A.length - 1; i >= 0 && out.length < L.max; i--) {
      const a = A[i]; if (a.stuck || a.life <= -9) continue;
      let id = ids.get(a); if (id === undefined) { id = 7000 + (nextId++ % 1000); ids.set(a, id); }
      out.push({x: a.x, y: a.y, h: a.h, color: ALIGHT[biome] || ALIGHT.ruins, radius: L.radius, intensity: k, flicker: 0, id});
    }
    return out;
  }

  function reset() {
    decals.length = 0; dirty.length = 0; ps.length = 0; gEmb.length = 0; stuck.clear(); BL.d = null;
    for (const gh of GH.list) GH.pool.push(gh); GH.list.length = 0; GH.due = false;
    SK.d = RL.d = null; wetFrom = splashT = -99;
    for (const L of levels.values()) { L.D.fill(0); host.G.texData(L.gi, 0, 0, L.w, L.h, L.D, L.w); }
  }
  function setBiome(id) { biome = MARK[id] ? id : 'ruins'; reset(); }

  Object.assign(F, {
    toggle() {
      F.on = !F.on; C.init = false; C.lw = null; Tm.init = false;
      if (F.on) { lastShots = host.PL?.shots ?? null; for (const a of host.arrows) seen.add(a); prevState = host.P.state; }
      else { SK.d = RL.d = null; for (const gh of GH.list) GH.pool.push(gh); GH.list.length = 0; GH.due = false; }
      return F.on;
    },
    biomeChanged() { levels.clear(); setBiome(host.biome.id); level(0); },   // (a rebuilt world: new ground texture; the ground layer made now, behind the loading screen)
    resize(w, h) { VW = w; VH = h; if (EC) { EC.width = w; EC.height = h; ecq.imageSmoothingEnabled = false; } },   // the view changed size (main.js fit)
    view: update, camera, frame, lights, stamp,   // (not ambient: its streaks / tracks follow the player's frozen speed)
    hud: () => '',
    // debugging / tests
    C, Tm, count: () => ({decals: decals.length, particles: ps.length, embers: gEmb.length, ghosts: GH.list.length, dirty: dirty.length, levels: levels.size}),
    dbg: {get ps() { return ps; }, get decals() { return decals; }, get levels() { return levels; }, V},
    reset,
  });
  if (host.biome) { setBiome(host.biome.id); level(0); }
  return F;
}
