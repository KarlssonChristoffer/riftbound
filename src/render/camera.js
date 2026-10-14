// CAMERA: what the screen shows. The VIEW follows the window and the zoom, the YAW turns the world (free rotation), the
// TARGET eases after the player (look-ahead, features' camera feel, shake), stays inside the world and snaps to the pixel
// lattice; ground sampling goes smooth while the view turns.
// THE VIEW follows the window and the zoom. `scale` is the DISPLAY SCALE (screen px per art px, whole: the art stays crisp)
// and the view is as many art px as fill the window at it, so a wide or ultrawide screen sees more of the world to the
// sides instead of black bars. The window's own scale (base: the biggest that still fits 480 x 270, the design) is the
// default zoom; the wheel moves `scale` (zoom levels, below). Capped at the world's size (bars past that). A change
// resizes the renderer (G.resize) and tells the features (F.resize?(VW, VH)); host.VW / VH and ctxO.VW / VH are current.
// A HIDDEN window (a minimised browser, a collapsed pane: 0 x 0, or anything under MIN_WIN px) has no view to fit: the
// view keeps its size (the design's 480 x 270 if the page boots hidden) until the window is back, so the view is never
// 0 px (no view-sized canvas made empty) and the zoom isn't re-scaled to an empty window.
// FREE (photo mode, ui/photo.js): freeOn() / freeMove / freeReset / freeOff(): the view leaves the player (below).
// SUB-PIXEL (t3ssel8r's trick; ?subpx=0: off, an A/B): the target still snaps to the art lattice, so the art never crawls,
// and the snap's remainder (cv.sub: how far the true view lies right of / below the drawn one, 0..1 art px) goes to the
// renderer (G.setSubpixel), which slides the blown-up image back by it in whole SCREEN px: the view glides at display
// resolution, not a whole art px (DS screen px) at a time. So the shift never bares an edge, the view is drawn cv.pad art
// px wider and taller than the window shows, the pad on the right and below (the snap rounds DOWN with a pad: the image
// only ever slides left / up) and the drawn centre that far right of / below the chest (pad / 2); the canvas runs past its
// place by the pad (negative margins, clipped), so the page, the cursor's origin and the HD overlay sit as before. At
// display scale 1 there's nothing finer to show: no pad, rounding to the nearest as before
// OWNS: cv = {VW, VH, scale, zoom, dz, dsBase, dsGoal, yaw, snapMode, pad, sub, cl, ct}, the target, the free target, the shake.  READS: the window, opt.
//   const cv = createCamera({ctxO, PPM, PPMY, PPMH, WORLD, opt: () => opt, onTurn, flags})   (the view size, before the renderer)
//   cv.attach({G, canvas, hdc, features}); cv.fit()                                             (once they exist)
import * as THREE from 'three';
import {DEG} from './gfx.js';
import {toView as viewOf, toWorld as worldOf} from './viewxf.js';

export const SNAP = [0, 22.5 * DEG, 90 * DEG], SNAP_NAME = ['free', '22.5° steps', '90° steps'];
export const ROT_SPEED = 110 * DEG;
// LEVELS are whole display scales, so every zoom at rest is pixel-perfect (scaleRange: out to twice the world on screen,
// in to twice the size). A wheel notch moves the goal one level; the view EASES there (in log space, so in and out feel
// alike, ZOOM.ease per second). The world is never drawn at an in-between size: the art is drawn at a whole scale
// (`scale`, at most the shown size: zooming out it drops to the goal at once) and the finished pixel image is MAGNIFIED
// on screen by `dz` (>= 1, the renderer's display zoom: G.setDisplay), each art pixel a solid block with a one-screen-px
// soft edge. A fractional projection (the old way) dropped and doubled rows and columns of every texel, every frame: the
// art shimmered and its 1 px outlines came and went. When it arrives it's re-made at the goal (fit): the same art pixels,
// dz 1. The ease's tail moves at least ZOOM.min (log scale per second), so it ends in a step no bigger than the last few
// (cutting a slow exponential tail short made the arrival a visible jump at the screen's edges). Trackpads' small deltas
// add up to notches (ZOOM.notch). The camera centres the Ranger's chest (FOCUS_H), and the image is magnified about there,
// so he stays put on screen while the world scales around him
export const ZOOM = {ease: 11, notch: 100, min: .12}, FOCUS_H = .9;
const SMOOTH_IN = 12, SMOOTH_OUT = 3, TURN_HOLD = .12;   // ground sampling: smooth while turning (auto)
const MIN_WIN = 16;   // px: a window smaller than this either way counts as hidden (the view keeps its size)

export function createCamera({ctxO, PPM, PPMY, PPMH, WORLD, opt: optOf, onTurn, flags}) {
  const Q = flags;
  let G = null, canvas = null, hdc = null, features = [];
  const VIEW = {w: 480, h: 270, maxW: Math.min(1920, Math.floor(WORLD.WM * PPM / 2) * 2), maxH: Math.min(1080, Math.floor(WORLD.HM * PPMY / 2) * 2)};
  const even = v => Math.floor(v / 2) * 2;
  const shown = () => innerWidth >= MIN_WIN && innerHeight >= MIN_WIN;   // (else hidden: see the header)
  const baseScale = () => Math.max(1, Math.floor(Math.min(innerWidth / VIEW.w, innerHeight / VIEW.h)));
  const viewAt = s => [Math.min(VIEW.maxW, even(innerWidth / s)), Math.min(VIEW.maxH, even(innerHeight / s))];
  // zoom levels: out to half the base scale (twice the world on screen), in to twice it. ?zoom=2 starts zoomed in
  const scaleRange = b => [Math.max(1, Math.ceil(b / 2)), b * 2];
  // zoom: the projection's extra scale ON TOP of `scale` (view px per art px; host.zoom, which features size their pixels
  // by): always 1 now, the in-between steps are dz's. dz: the finished image's magnification on screen (1 at rest; the
  // ease, stepZoom); the screen shows scale x dz px per art px. cl, ct: the canvas's place on the page (css px, at fit)
  const cv = {VW: 480, VH: 270, scale: 1, zoom: 1, dz: 1, dsBase: 1, dsGoal: 1, cl: 0, ct: 0, yaw: (+Q.get('yaw') || 0) * DEG, snapMode: +(Q.get('snap') ?? 0) || 0};
  cv.dsBase = baseScale(); cv.dsGoal = Q.get('zoom') === '2' ? cv.dsBase * 2 : cv.dsBase; cv.scale = cv.dsGoal;   // the window's scale, the wheel's goal, the view's scale now
  // the sub-pixel view (header): the pad (art px, even: the view's centre stays on the lattice) and the remainder now
  const SUB = Q.get('subpx') !== '0', padAt = s => SUB && s > 1 ? 2 : 0;
  cv.pad = padAt(cv.scale); cv.sub = {x: 0, y: 0};
  [cv.VW, cv.VH] = shown() ? viewAt(cv.scale) : [Math.min(VIEW.maxW, VIEW.w), Math.min(VIEW.maxH, VIEW.h)];   // (booting hidden: the design's)
  cv.VW += cv.pad; cv.VH += cv.pad;
  ctxO.VW = cv.VW; ctxO.VH = cv.VH;
  cv.toView = (X, Z, a = cv.yaw) => viewOf(X, Z, a);
  cv.toWorld = (vx, vy, a = cv.yaw) => worldOf(vx, vy, a);   // (render/viewxf.js at this camera's yaw)
  const toView = cv.toView, toWorld = cv.toWorld;
  cv.attach = o => { ({G, canvas, hdc, features} = o); };

  cv.fit = function fit() {   // the window changed, a zoom arrived (stepZoom) or one out began (zoomTo): the view at `scale`
    if (!shown()) return;   // hidden: the view stays as it is; the window's resize event when it's back fits it
    const b = baseScale();
    if (b !== cv.dsBase) { const [lo, hi] = scaleRange(b); cv.dsGoal = Math.max(lo, Math.min(hi, Math.round(cv.dsGoal * b / cv.dsBase))); cv.dsBase = b; cv.scale = cv.dsGoal; cv.dz = 1; }   // (the same zoom, relative)
    const pad = padAt(cv.scale), [w0, h0] = viewAt(cv.scale), w = w0 + pad, h = h0 + pad;   // (what the window shows + the pad)
    cv.pad = pad;
    if (w !== cv.VW || h !== cv.VH) { cv.VW = ctxO.VW = w; cv.VH = ctxO.VH = h; G.resize(w, h); for (const f of features) f.resize?.(w, h); }
    canvas.style.width = cv.VW * cv.scale + 'px'; canvas.style.height = cv.VH * cv.scale + 'px';
    // (the pad runs past the canvas's place on the right and below: negative margins keep it centred where it was, the clip hides it)
    const pp = pad * cv.scale; canvas.style.marginRight = canvas.style.marginBottom = pad ? -pp + 'px' : ''; canvas.style.clipPath = pad ? `inset(0 ${pp}px ${pp}px 0)` : '';
    G.setDisplay?.(cv.scale, cv.dz);   // the canvas at display size: the pixel image is blown up on the GPU (and magnified by dz), HD effects draw over it
    const dpr = devicePixelRatio || 1; hdc.width = w0 * cv.scale * dpr; hdc.height = h0 * cv.scale * dpr; hdc.style.width = w0 * cv.scale + 'px'; hdc.style.height = h0 * cv.scale + 'px';   // (what shows: no pad)
    const r = canvas.getBoundingClientRect(); hdc.style.left = r.left + 'px'; hdc.style.top = r.top + 'px'; cv.cl = r.left; cv.ct = r.top;
  };

  // ---- the wheel
  let wheelAcc = 0, wheelT = 0;
  // (now: there at once, no ease: photo mode's way back to the zoom you played at.) Out past the drawn view: the goal's
  // bigger view is drawn at once, magnified (dz) to look as it did, so the ease only ever magnifies (dz >= 1: never a gap)
  cv.zoomTo = function zoomTo(goal, now = false) {
    const [lo, hi] = scaleRange(cv.dsBase); cv.dsGoal = Math.max(lo, Math.min(hi, goal));
    if (now) { if (cv.scale !== cv.dsGoal || cv.dz !== 1) { cv.scale = cv.dsGoal; cv.dz = 1; cv.fit(); } }
    else if (cv.dsGoal < cv.scale) { cv.dz *= cv.scale / cv.dsGoal; cv.scale = cv.dsGoal; cv.fit(); }
  };
  cv.onWheel = function onWheel(e) {
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY, now = performance.now();
    if (now - wheelT > 400 || Math.sign(d) !== Math.sign(wheelAcc)) wheelAcc = 0;   // a new gesture, or turned around
    wheelT = now; wheelAcc += d;
    while (Math.abs(wheelAcc) >= ZOOM.notch) { cv.zoomTo(cv.dsGoal - Math.sign(wheelAcc)); wheelAcc -= Math.sign(wheelAcc) * ZOOM.notch; }   // up = in
  };
  cv.stepZoom = function stepZoom(dt) {   // every rendered frame (the menu's backdrop zooms too)
    const eff = cv.scale * cv.dz; if (eff === cv.dsGoal && cv.dz === 1) return;
    const le = Math.log(eff), lg = Math.log(cv.dsGoal), d = lg - le, st = Math.max(Math.abs(d) * (1 - Math.exp(-dt * ZOOM.ease)), ZOOM.min * dt);
    const l = Math.abs(d) <= st ? lg : le + Math.sign(d) * st;
    if (l === lg) { cv.scale = cv.dsGoal; cv.dz = 1; cv.fit(); }   // arrived: the view re-made at the goal scale
    else { cv.dz = Math.exp(l) / cv.scale; G.setDisplay?.(cv.scale, cv.dz); }
  };

  // ---- the yaw: the player keeps view-frame coordinates, so a turn turns them too (onTurn)
  cv.setYaw = function setYaw(a) { if (a !== cv.yaw) { onTurn(a - cv.yaw); cv.yaw = a; } if (cv.yaw > Math.PI) cv.yaw -= 2 * Math.PI; else if (cv.yaw <= -Math.PI) cv.yaw += 2 * Math.PI; };
  // in a step mode, ease onto the nearest step once you let go
  cv.snapEase = (ny, dt) => { const s = SNAP[cv.snapMode], tg = Math.round(ny / s) * s, d = tg - ny; return Math.abs(d) < .0015 ? tg : ny + d * (1 - Math.exp(-dt * 14)); };

  // ---- ground sampling: crisp nearest at rest, smooth-pixel while the camera turns (auto)
  let turnT = 0;
  cv.stepSampling = function stepSampling(dt, turned) {
    const opt = optOf();
    turnT = turned ? TURN_HOLD : Math.max(0, turnT - dt);
    const want = opt.sampling === 'smooth' ? 1 : opt.sampling === 'nearest' ? 0 : turnT > 0 ? 1 : 0, v = G.smooth;
    G.setSmooth(want > v ? Math.min(want, v + dt * SMOOTH_IN) : Math.max(want, v - dt * SMOOTH_OUT));   // (the one writer)
  };

  // ---- shake (menu > Graphics > Screen shake)
  const shakeS = {a: 0, t: 0};
  cv.shake = function shake(a, sec) { if (optOf().shake && a >= shakeS.a * (shakeS.t > 0 ? 1 : 0)) { shakeS.a = a; shakeS.t = sec; } };
  cv.stepShake = dt => { if (shakeS.t > 0) shakeS.t -= dt; };

  // ---- the target: eased (look-ahead), snapped to the pixel lattice
  const T = new THREE.Vector3(), Ts = new THREE.Vector3();
  let camInit = false;
  cv.snap = () => { camInit = false; };   // jump to the player next frame (a teleport)
  cv.shift = (dx, dy) => { T.x += dx; T.z += dy; Ts.x += dx; Ts.z += dy; };   // he was moved as he was (world m, adapter.js shift): the view goes along, eased as it was
  // ox, oy: px offset (feel, shake) applied in the view; then the visible GROUND stays inside the world (the arena
  // clamps its camera to the world the same way: no void past the edge), then the target snaps to the pixel lattice
  // (V: the target to place, T or the free one, FR; ga: how far the clamp gives way, m)
  function snapTarget(ox, oy, V = T, ga = airH * PPMH / PPMY) {
    const z = cv.zoom, h = V.y, lift = h * PPMH / PPMY, K = cv.pad;   // the ground at screen centre lies `lift` m further back than the target
    let [vx, vy] = toView(V.x, V.z); vx += ox / PPM; vy += oy / PPMY;
    // the view's ground rectangle (what shows: no pad, magnified by dz): half extents in the view frame, then its world-axis extents at this yaw
    const hx = (cv.VW - K) / (2 * PPM * z * cv.dz), hy = (cv.VH - K) / (2 * PPMY * z * cv.dz), c = Math.abs(Math.cos(cv.yaw)), s = Math.abs(Math.sin(cv.yaw));
    const ex = hx * c + hy * s, ez = hx * s + hy * c;
    let [gx, gz] = toWorld(vx, vy - lift);
    // (ga: airborne, the clamp gives way by his height above where he stood; 0 on the ground)
    // (it may go WORLD.past m past the world's edges, where the ground goes on: near a border the player stays centred)
    const pa = WORLD.past || 0, PW = WORLD.WM + 2 * pa, PH = WORLD.HM + 2 * pa;
    gx = ex * 2 >= PW ? WORLD.x0 + WORLD.WM / 2 : Math.min(WORLD.x1 + pa - ex + ga, Math.max(WORLD.x0 - pa + ex - ga, gx));
    gz = ez * 2 >= PH ? WORLD.y0 + WORLD.HM / 2 : Math.min(WORLD.y1 + pa - ez + ga, Math.max(WORLD.y0 - pa + ez - ga, gz));
    [vx, vy] = toView(gx, gz); vy += lift;
    if (V === FR) { const [fx, fz] = toWorld(vx, vy); FR.x = fx; FR.z = fz; }   // (the free target stays where the view can go)
    // the lattice, in art px at this zoom (x; y: screen rows): with a pad the drawn centre lies K / 2 px right of / below this
    // one, rounded DOWN, and the remainder goes to the renderer (header); without one, rounded to the nearest
    const lx = vx * PPM * z + K / 2, ly = (vy * PPMY - h * PPMH) * z + K / 2, Lx = K ? Math.floor(lx) : Math.round(lx), Ly = K ? Math.floor(ly) : Math.round(ly);
    cv.sub.x = K ? lx - Lx : 0; cv.sub.y = K ? ly - Ly : 0;
    const sx = Lx / (PPM * z), vy2 = (Ly / z + h * PPMH) / PPMY;
    const [X, Zw] = toWorld(sx, vy2); Ts.set(X, h, Zw);
  }
  // every rendered frame: ease after the player with a little look-ahead (the arena's), feel offsets from features, shake.
  // It aims at his chest (FOCUS_H m up, as the ground point that projects there), so he's in the same spot on screen at
  // every zoom. Sets the renderer's view and player.js's cam (its cursor reading)
  // AIRBORNE (on a rope: the equipment experiment's lasso swing, state 'rope', and the fall after it): the world-edge clamp
  // above gives way by the body's height over where he last stood (eased, metres), so a body up to ~3 m stays in view near
  // the world's edges; on the ground it is 0 and the clamp is as it was
  let airH = 0, groundZ = 0;
  cv.follow = function follow(dt, PX, PY, P, cam) {
    if (free) { snapTarget(0, 0, FR, 0); G.setView(Ts, cv.yaw, cv.zoom); G.setSubpixel?.(cv.sub.x, cv.sub.y, cv.pad); return; }   // (cam, the cursor's frame, stays as it was)
    if (!camInit) { T.set(PX, P.z, PY); camInit = true; }
    const air = P.state === 'rope' || P.state === 'fall';
    if (!air) groundZ = P.z;
    const aw = air ? Math.max(0, P.z - groundZ) : 0;
    airH = aw === airH ? aw : airH + (aw - airH) * (1 - Math.exp(-dt * 6)); if (airH < 1e-3 && aw === 0) airH = 0;
    const [lvx, lvy] = toWorld(P.vx * .12, P.vy * .12 - FOCUS_H * PPMH / PPMY);
    const k = 1 - Math.exp(-dt * 9); T.x += (PX + lvx - T.x) * k; T.y += (P.z - T.y) * k; T.z += (PY + lvy - T.z) * k;
    let ox = 0, oy = 0;
    for (const f of features) if (f.on !== false && f.camera) { const o = f.camera(dt); if (o) { ox += o.x || 0; oy += o.y || 0; } }
    const sk = shakeS.t > 0 ? shakeS.a * Math.min(1, shakeS.t * 8) : 0;
    ox += Math.round((Math.random() * 2 - 1) * sk); oy += Math.round((Math.random() * 2 - 1) * sk);
    snapTarget(ox, oy); G.setView(Ts, cv.yaw, cv.zoom); G.setSubpixel?.(cv.sub.x, cv.sub.y, cv.pad);
    const [tvx, tvy] = toView(Ts.x, Ts.z);
    cam.x = cam.fx = tvx * PPM - cv.VW / 2; cam.y = cam.fy = tvy * PPMY - Ts.y * PPMH - cv.VH / 2;
  };
  // ---- FREE (ui/photo.js: photo mode): the view leaves the player and looks where it's moved (world metres), held so its
  // ground stays inside the world like the follow's; no look-ahead, feel or shake. The follow's own target and the
  // cursor's frame (cam) aren't touched meanwhile: after freeOff() the follow goes on exactly from where it was, and the
  // renderer's view is put back at once as the follow last set it (a sim step before the next draw reads the screen: the aim)
  let free = false; const FR = new THREE.Vector3(), TS0 = new THREE.Vector3(), SUB0 = {x: 0, y: 0};   // (SUB0: the follow's remainder, kept with TS0)
  cv.freeOn = (x, y, h) => { free = true; TS0.copy(Ts); SUB0.x = cv.sub.x; SUB0.y = cv.sub.y; if (camInit) FR.copy(T); else FR.set(x, h, y); };   // (x, y, h: where to look if the follow hasn't run yet)
  cv.freeOff = () => { if (!free) return; free = false; Ts.copy(TS0); cv.sub.x = SUB0.x; cv.sub.y = SUB0.y; if (camInit) { G.setView(Ts, cv.yaw, cv.zoom); G.setSubpixel?.(cv.sub.x, cv.sub.y, cv.pad); } };   // (after the yaw and zoom are back)
  cv.freeReset = (x, y, h) => { if (camInit) FR.copy(T); else FR.set(x, h, y); };   // back over the player (where the follow is)
  cv.freeMove = (dx, dy) => { FR.x += dx; FR.z += dy; };     // world metres (x east, y south)
  cv.freeAt = o => { o.x = FR.x; o.y = FR.z; o.h = FR.y; return o; };
  return cv;
}
