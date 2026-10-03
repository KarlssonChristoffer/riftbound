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
// OWNS: cv = {VW, VH, scale, zoom, dsBase, dsGoal, yaw, snapMode}, the target, the shake.  READS: the window, opt.
//   const cv = createCamera({ctxO, PPM, PPMY, PPMH, WORLD, opt: () => opt, onTurn, flags})   (the view size, before the renderer)
//   cv.attach({G, canvas, hdc, features}); cv.fit()                                             (once they exist)
import * as THREE from 'three';
import {DEG} from './gfx.js';
import {toView as viewOf, toWorld as worldOf} from './viewxf.js';

export const SNAP = [0, 22.5 * DEG, 90 * DEG], SNAP_NAME = ['free', '22.5° steps', '90° steps'];
export const ROT_SPEED = 110 * DEG;
// LEVELS are whole display scales, so every zoom at rest is pixel-perfect (scaleRange: out to twice the world on screen,
// in to twice the size). A wheel notch moves the goal one level; the view EASES there (in log space, so in and out feel
// alike, ZOOM.ease per second) drawn at its current size with `zoom` as the in-between factor, and when it arrives it's
// re-made at the new scale (fit): crisp again. Trackpads' small deltas add up to notches (ZOOM.notch). The camera
// centres the Ranger's chest (FOCUS_H), so he stays put on screen while the world scales around him
export const ZOOM = {ease: 11, notch: 100, done: .004}, FOCUS_H = .9;
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
  // zoom: the projection's extra scale ON TOP of `scale` (the display scale). 1 at rest; between zoom levels it carries the
  // easing (stepZoom). host.zoom is this (view px per art px), so features size their pixels right while it eases
  const cv = {VW: 480, VH: 270, scale: 1, zoom: 1, dsBase: 1, dsGoal: 1, yaw: (+Q.get('yaw') || 0) * DEG, snapMode: +(Q.get('snap') ?? 0) || 0};
  cv.dsBase = baseScale(); cv.dsGoal = Q.get('zoom') === '2' ? cv.dsBase * 2 : cv.dsBase; cv.scale = cv.dsGoal;   // the window's scale, the wheel's goal, the view's scale now
  [cv.VW, cv.VH] = shown() ? viewAt(cv.scale) : [Math.min(VIEW.maxW, VIEW.w), Math.min(VIEW.maxH, VIEW.h)];   // (booting hidden: the design's)
  ctxO.VW = cv.VW; ctxO.VH = cv.VH;
  cv.toView = (X, Z, a = cv.yaw) => viewOf(X, Z, a);
  cv.toWorld = (vx, vy, a = cv.yaw) => worldOf(vx, vy, a);   // (render/viewxf.js at this camera's yaw)
  const toView = cv.toView, toWorld = cv.toWorld;
  cv.attach = o => { ({G, canvas, hdc, features} = o); };

  cv.fit = function fit() {   // the window changed, or a zoom arrived (stepZoom): the view at `scale`
    if (!shown()) return;   // hidden: the view stays as it is; the window's resize event when it's back fits it
    const b = baseScale();
    if (b !== cv.dsBase) { const [lo, hi] = scaleRange(b); cv.dsGoal = Math.max(lo, Math.min(hi, Math.round(cv.dsGoal * b / cv.dsBase))); cv.dsBase = b; cv.scale = cv.dsGoal; cv.zoom = 1; }   // (the same zoom, relative)
    const [w, h] = viewAt(cv.scale);
    if (w !== cv.VW || h !== cv.VH) { cv.VW = ctxO.VW = w; cv.VH = ctxO.VH = h; G.resize(w, h); for (const f of features) f.resize?.(w, h); }
    canvas.style.width = cv.VW * cv.scale + 'px'; canvas.style.height = cv.VH * cv.scale + 'px';
    G.setDisplay?.(cv.scale);   // the canvas at display size: the pixel image is blown up on the GPU, HD effects draw over it
    const dpr = devicePixelRatio || 1; hdc.width = cv.VW * cv.scale * dpr; hdc.height = cv.VH * cv.scale * dpr; hdc.style.width = canvas.style.width; hdc.style.height = canvas.style.height;
    const r = canvas.getBoundingClientRect(); hdc.style.left = r.left + 'px'; hdc.style.top = r.top + 'px';
  };

  // ---- the wheel
  let wheelAcc = 0, wheelT = 0;
  cv.zoomTo = function zoomTo(goal) { const [lo, hi] = scaleRange(cv.dsBase); cv.dsGoal = Math.max(lo, Math.min(hi, goal)); };
  cv.onWheel = function onWheel(e) {
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY, now = performance.now();
    if (now - wheelT > 400 || Math.sign(d) !== Math.sign(wheelAcc)) wheelAcc = 0;   // a new gesture, or turned around
    wheelT = now; wheelAcc += d;
    while (Math.abs(wheelAcc) >= ZOOM.notch) { cv.zoomTo(cv.dsGoal - Math.sign(wheelAcc)); wheelAcc -= Math.sign(wheelAcc) * ZOOM.notch; }   // up = in
  };
  cv.stepZoom = function stepZoom(dt) {   // every rendered frame (the menu's backdrop zooms too)
    const eff = cv.scale * cv.zoom; if (eff === cv.dsGoal) return;
    const le = Math.log(eff), lg = Math.log(cv.dsGoal), l = Math.abs(lg - le) < ZOOM.done ? lg : le + (lg - le) * (1 - Math.exp(-dt * ZOOM.ease));
    if (l === lg) { cv.scale = cv.dsGoal; cv.zoom = 1; cv.fit(); } else cv.zoom = Math.exp(l) / cv.scale;   // arrived: the view re-made at the goal scale
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
  // ox, oy: px offset (feel, shake) applied in the view; then the visible GROUND stays inside the world (the arena
  // clamps its camera to the world the same way: no void past the edge), then the target snaps to the pixel lattice
  function snapTarget(ox, oy) {
    const z = cv.zoom, h = T.y, lift = h * PPMH / PPMY;   // the ground at screen centre lies `lift` m further back than the target
    let [vx, vy] = toView(T.x, T.z); vx += ox / PPM; vy += oy / PPMY;
    // the view's ground rectangle: half extents in the view frame, then its world-axis extents at this yaw
    const hx = cv.VW / (2 * PPM * z), hy = cv.VH / (2 * PPMY * z), c = Math.abs(Math.cos(cv.yaw)), s = Math.abs(Math.sin(cv.yaw));
    const ex = hx * c + hy * s, ez = hx * s + hy * c;
    let [gx, gz] = toWorld(vx, vy - lift);
    gx = ex * 2 >= WORLD.WM ? WORLD.WM / 2 : Math.min(WORLD.WM - ex, Math.max(ex, gx));
    gz = ez * 2 >= WORLD.HM ? WORLD.HM / 2 : Math.min(WORLD.HM - ez, Math.max(ez, gz));
    [vx, vy] = toView(gx, gz); vy += lift;
    const sx = Math.round(vx * PPM * z) / (PPM * z), S = Math.round((vy * PPMY - h * PPMH) * z), vy2 = (S / z + h * PPMH) / PPMY;
    const [X, Zw] = toWorld(sx, vy2); Ts.set(X, h, Zw);
  }
  // every rendered frame: ease after the player with a little look-ahead (the arena's), feel offsets from features, shake.
  // It aims at his chest (FOCUS_H m up, as the ground point that projects there), so he's in the same spot on screen at
  // every zoom. Sets the renderer's view and player.js's cam (its cursor reading)
  cv.follow = function follow(dt, PX, PY, P, cam) {
    if (!camInit) { T.set(PX, P.z, PY); camInit = true; }
    const [lvx, lvy] = toWorld(P.vx * .12, P.vy * .12 - FOCUS_H * PPMH / PPMY);
    const k = 1 - Math.exp(-dt * 9); T.x += (PX + lvx - T.x) * k; T.y += (P.z - T.y) * k; T.z += (PY + lvy - T.z) * k;
    let ox = 0, oy = 0;
    for (const f of features) if (f.on !== false && f.camera) { const o = f.camera(dt); if (o) { ox += o.x || 0; oy += o.y || 0; } }
    const sk = shakeS.t > 0 ? shakeS.a * Math.min(1, shakeS.t * 8) : 0;
    ox += Math.round((Math.random() * 2 - 1) * sk); oy += Math.round((Math.random() * 2 - 1) * sk);
    snapTarget(ox, oy); G.setView(Ts, cv.yaw, cv.zoom);
    const [tvx, tvy] = toView(Ts.x, Ts.z);
    cam.x = cam.fx = tvx * PPM - cv.VW / 2; cam.y = cam.fy = tvy * PPMY - Ts.y * PPMH - cv.VH / 2;
  };
  return cv;
}
