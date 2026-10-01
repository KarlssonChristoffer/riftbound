// HD-2D RENDER TEST, host. The Proving Grounds as a real 3D scene seen through the arena's oblique projection, with a
// camera that turns freely around the player. Answers: does pixel art survive rotation, live 3D props vs 16-angle
// pre-renders, the Ranger as a camera-facing card, GPU lighting parity, camera-relative controls.
//
// THE PLAYER is the arena's own player.js, untouched. It runs in the CAMERA'S frame ("view frame": x = screen right,
// y = toward the camera, both on the ground), where the projection is exactly the arena's, so its aiming by rendered
// arrow angles, cursor reading, facing and WASD all work as they are (WASD becomes camera-relative for free). Collision,
// terrain and arrows are converted to the world. When the camera turns, the player's position / velocity rotate with
// the frame and its facing index shifts by whole 22.5 deg steps (the sprite you see is always the camera-relative one).
import * as THREE from 'three';
import {createGfx, DEG} from './gfx.js';
import {buildWorld, texOf, PLAY, TRAIL, elev, inStream, PLATEAUS} from './world.js';
import {BIOMES} from '../sprites/arena/biomes.js';
import {createLighting} from '../sprites/arena/lighting.js';
import {createPlayer, loadSet, atlasOf} from '../sprites/player.js';

const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const VW = 480, VH = 270;
const ATLAS = '../sprites/out/outfits/ranger_basic/';
const t00 = performance.now();

// ---------------------------------------------------------------- load
$('#load').textContent = 'Loading the Ranger: 255 poses x 16 facings (about half a minute)…';
const set = await loadSet(ATLAS, {normals: true});
const atlas = atlasOf(set), {SP} = set, {FW, FH, PIV, ND, DIRS} = atlas;
const PPM = set.idx.fwd_px.E[0], PPMH = PPM * Math.cos(set.idx.pitch * DEG), PPMY = PPM * Math.sin(55 * DEG);
const ctxO = {PPM, PPMY, PPMH, toS: (x, y, h = 0) => [x * PPM, y * PPMY - h * PPMH], VW, VH};

const canvas = $('#screen');
const G = createGfx(canvas, {VW, VH, PPM, PPMY, PPMH});
function fit() { const s = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH))); canvas.style.width = VW * s + 'px'; canvas.style.height = VH * s + 'px'; }
fit(); addEventListener('resize', fit);

// moods: the arena's own table (lighting.js), so both pages light the same scene the same way
const LT = createLighting({...ctxO, layout: null});
const MOODS = LT.MOODS, TIMES = LT.TIMES, CHAR = LT.CHAR;
const GRADE = {ruins: [1.039, 1.029, .818], ember: [1.166, .958, .82], frost: [.896, 1.013, 1.161], rift: [1.056, .792, 1.649]};
const BG = {ruins: [.10, .13, .11], ember: [.11, .06, .05], frost: [.10, .12, .17], rift: [.06, .04, .10]};
const lum = c => c[0] * .3 + c[1] * .55 + c[2] * .15;

let biomeI = Math.max(0, BIOMES.findIndex(b => b.id === Q.get('biome'))), timeI = Math.max(0, TIMES.indexOf(Q.get('time')));
let world = null, propMode = Q.get('props') === 'yaw' ? 'yaw' : 'live';
async function setBiome(i) {
  biomeI = ((i % BIOMES.length) + BIOMES.length) % BIOMES.length;
  $('#load').classList.remove('hidden'); $('#load').textContent = 'Building ' + BIOMES[biomeI].name + '…';
  world?.dispose();
  world = await buildWorld(G, {biome: BIOMES[biomeI], ctxO, PPM, PPMH});
  world.setMode(propMode);
  $('#load').classList.add('hidden');
}
await setBiome(biomeI);

// ---------------------------------------------------------------- the camera's frame
let yaw = (+Q.get('yaw') || 0) * DEG, zoom = Q.get('zoom') === '2' ? 2 : 1, snapMode = +(Q.get('snap') ?? 0) || 0;
const SNAP = [0, 22.5 * DEG, 90 * DEG], SNAP_NAME = ['free', '22.5° steps', '90° steps'];
const toView = (X, Z, a = yaw) => [X * Math.cos(a) - Z * Math.sin(a), X * Math.sin(a) + Z * Math.cos(a)];
const toWorld = (vx, vy, a = yaw) => [vx * Math.cos(a) + vy * Math.sin(a), -vx * Math.sin(a) + vy * Math.cos(a)];

// ---------------------------------------------------------------- the player
const keys = new Set(), mouse = {x: VW / 2, y: VH / 2, down: false}, cam = {x: 0, y: 0, fx: 0, fy: 0}, events = [];
const R_BODY = .25;
// collision in the world (round, so it doesn't change with the camera; the arena squashes it to match its 2D look)
function blockedW(x, y, z, air) {
  const arena = x > PLAY.x0 - 3 && x < PLAY.x1 + 3 && y > PLAY.y0 - 3 && y < PLAY.y1 + 3;
  const trail = x > TRAIL.x0 && x < TRAIL.x1 && y > TRAIL.y0 && y < TRAIL.y1;
  if (!arena && !trail) return true;
  if (!air && inStream(x, y)) return true;
  if (elev(x, y) > z + .3) return true;
  return world.props.some(p => !p.broken && Math.abs((p.z || 0) - z) < 1 && (p.rect ? x > p.rect[0] - R_BODY && x < p.rect[2] + R_BODY && y > p.rect[1] - R_BODY && y < p.rect[3] + R_BODY
    : p.r && Math.hypot(p.x - x, p.y - y) < p.r + R_BODY));
}
// the plateau as the player sees it: exact when the camera faces north (climbing works); turned, only its height counts
const plateausV = PLATEAUS.map(q => ({...q}));
function syncPlateaus() {
  PLATEAUS.forEach((q, i) => Object.assign(plateausV[i], Math.abs(yaw) < 1e-6 ? {...q} : {h: q.h, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, climbs: []}));
}
const arrows = [];
const PL = createPlayer({
  ctx: ctxO, atlas, keys, mouse, cam, events, plateaus: plateausV,
  blocked: (x, y, z = PL.P.z, air = false) => { const [X, Z] = toWorld(x, y); return blockedW(X, Z, z, air); },
  elev: (x, y) => { const [X, Z] = toWorld(x, y); return elev(X, Z); },
  inStream: (x, y) => { const [X, Z] = toWorld(x, y); return inStream(X, Z); },
  pixelBow: () => true,
  onShoot: a => { const [X, Z] = toWorld(a.x, a.y), [VX, VZ] = toWorld(a.vx, a.vy); arrows.push({x: X, z: Z, h: a.h, vx: VX, vz: VZ, vh: a.vh || 0, life: a.life ?? 1.6}); },
});
const P = PL.P;
{ const at = (Q.get('at') || '').split(',').map(Number), sp = world.layout.spawn, [vx, vy] = toView(at.length === 2 ? at[0] : sp.x, at.length === 2 ? at[1] : sp.y); P.x = vx; P.y = vy; P.z = elev(...toWorld(vx, vy)); }

// the camera turned by d: everything the player keeps in view-frame coordinates turns with it
let faceAcc = 0;
function turnFrame(d) {
  const c = Math.cos(d), s = Math.sin(d), rot = (x, y) => [x * c - y * s, x * s + y * c];
  [P.x, P.y] = rot(P.x, P.y); [P.vx, P.vy] = rot(P.vx, P.vy);
  if (P.rollDir) P.rollDir = rot(...P.rollDir);
  if (P.back) P.back = rot(...P.back);
  if (P.leap) { [P.leap.x0, P.leap.y0] = rot(P.leap.x0, P.leap.y0); [P.leap.dx, P.leap.dy] = rot(P.leap.dx, P.leap.dy); }
  faceAcc -= d / (2 * Math.PI / ND);
  const n = Math.round(faceAcc);
  if (n) { P.face = (((P.face + n) % ND) + ND) % ND; P.want = (((P.want + n) % ND) + ND) % ND; faceAcc -= n; }
}
function setYaw(a) { if (a !== yaw) { turnFrame(a - yaw); yaw = a; } if (yaw > Math.PI) { yaw -= 2 * Math.PI; } else if (yaw <= -Math.PI) { yaw += 2 * Math.PI; } }

// the Ranger's card: the sprite + the pixel bow composited every frame, its normal map from the pose's sheet
const charCv = document.createElement('canvas'); charCv.width = FW; charCv.height = FH;
const cq = charCv.getContext('2d'); cq.imageSmoothingEnabled = false;
const charTex = texOf(charCv);
const hero = G.card({tex: charTex, w: FW, h: FH, px: PIV[0], py: PIV[1], type: 4, obj: 8, bias: .0025, xray: true});
const arrowLines = G.lines(128);

// ---------------------------------------------------------------- toggles
// ground sampling: 'auto' (the default) = crisp nearest pixels while the camera is still, smooth-pixel while it turns
// (nearest crawls along diagonals under rotation); the two blend, so stopping doesn't pop
const SAMPLING = ['auto', 'nearest', 'smooth'];
const opt = {sampling: Q.get('smooth') === '1' ? 'smooth' : SAMPLING.includes(Q.get('sampling')) ? Q.get('sampling') : 'auto',
  outline: true, banded: true, shadows: true, lantern: Q.get('lantern') === '1', debug: +(Q.get('debug') || 0), help: true};
const DEBUG = ['final', 'albedo', 'normals', 'depth', 'object ids', 'sun shadow', 'light only'];
const SMOOTH_IN = 12, SMOOTH_OUT = 3, TURN_HOLD = .12;   // fade rates (1/s): in fast when you start turning, out gently after
let turnT = 0;
function stepSampling(dt, turned) {
  turnT = turned ? TURN_HOLD : Math.max(0, turnT - dt);
  const want = opt.sampling === 'smooth' ? 1 : opt.sampling === 'nearest' ? 0 : turnT > 0 ? 1 : 0, u = G.U.smooth;
  u.value = want > u.value ? Math.min(want, u.value + dt * SMOOTH_IN) : Math.max(want, u.value - dt * SMOOTH_OUT);
}
function applyOpts() {
  if (opt.sampling !== 'auto') G.U.smooth.value = opt.sampling === 'smooth' ? 1 : 0;
  G.compU.uOutline.value = opt.outline ? 1 : 0; G.compU.uBanded.value = opt.banded ? 1 : 0;
  G.compU.uShadowOn.value = opt.shadows ? 1 : 0; G.compU.uDebug.value = opt.debug; $('#help').classList.toggle('hidden', !opt.help);
}
applyOpts();

// ---------------------------------------------------------------- mood + lights
const HALO_A = .16, HALO_R = .3, LANTERN = {fwd: .22, side: .3, h: .95, c: [1, .76, .48], r: 4.2, k: 1, flicker: .2, id: -7};
function flick(l, t) {
  const f = l.flicker || 0; if (!f) return 1;
  const s = (l.id ?? 0) * 12.9898 % 6.283, n = .5 * Math.sin(t * 7.3 + s) + .3 * Math.sin(t * 12.7 + s * 2.3) + .2 * Math.sin(t * 23.1 + s * 3.7);
  return 1 - f * .22 * (1 + n);
}
const sunDir = new THREE.Vector3();
function applyMood(PX, PZ, t) {
  const biome = BIOMES[biomeI].id, time = TIMES[timeI], m = MOODS[biome][time], U = G.compU;
  U.uAmb.value.set(...m.amb);
  const az = m.sun.az * DEG, el = m.sun.el * DEG;
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  G.setSun(sunDir);
  U.uSunK.value = m.sun.k; U.uShadowA.value = m.shadow.a > 0 && m.sun.el > 2 ? m.shadow.a : 0; U.uShadowC.value.set(...m.shadow.c);
  U.uFog.value.set(...m.fog);
  const la = Math.max(.02, lum(m.amb)), fk = lum(m.fill || [0, 0, 0]) / la * CHAR.fillK;
  U.uFill.value.set(...m.amb.map(v => v * fk)); U.uGrade.value.set(...GRADE[biome]); U.uGradeK.value = CHAR.gradeK[time] ?? 0;
  const dark = Math.max(0, 1 - lum(m.amb));
  U.uEmin.value = .1 + .2 * dark;
  U.uBg.value.set(...BG[biome].map(v => v * (.35 + .65 * lum(m.amb))));
  // lights: the lift (a flat pool at the player in dark scenes), the lantern, then the nearest world lights
  const L = [];
  if (m.lift[0] + m.lift[1] + m.lift[2] > 0) L.push({x: PX, y: P.z + .9, z: PZ, c: m.lift, r: 1.7, gain: 1, flat: true});
  if (opt.lantern) {
    const a = P.face * 2 * Math.PI / ND, [fx, fy] = toWorld(Math.sin(a), Math.cos(a));
    L.push({x: PX + fx * LANTERN.fwd - fy * LANTERN.side, y: P.z + LANTERN.h, z: PZ + fy * LANTERN.fwd + fx * LANTERN.side, c: LANTERN.c, r: LANTERN.r * (1 + (flick(LANTERN, t) - 1) * .15), gain: flick(LANTERN, t)});
  }
  const near = world.lights.map(l => ({l, d: Math.hypot(l.x - PX, l.z - PZ)})).filter(o => o.d < 24 + o.l.r).sort((a, b) => a.d - b.d);
  for (const {l} of near) { if (L.length >= 16) break; const fk2 = flick(l, t); L.push({x: l.x, y: l.y, z: l.z, c: l.c, r: l.r * (1 + (fk2 - 1) * .15), gain: l.k * fk2}); }
  U.uNL.value = L.length; let nh = 0;
  L.forEach((l, i) => {
    U.uLP.value[i].set(l.x, l.y, l.z, l.r); U.uLC.value[i].set(l.c[0] * l.gain, l.c[1] * l.gain, l.c[2] * l.gain, l.flat ? 1 : 0);
    if (l.flat) return;
    const a = Math.min(.75, HALO_A * l.gain * (m.glow ?? 1) * (.3 + .7 * dark) + Math.max(0, l.gain - 1.5) * .12); if (a < .02) return;
    const [sx, sy] = G.toScreen(l.x, l.y, l.z);
    U.uHalo.value[nh].set(sx, VH - sy, (HALO_R + .12 * Math.min(2, l.gain)) * PPM * zoom, a); U.uHaloC.value[nh].set(...l.c); nh++;
  });
  U.uNH.value = nh;
  return m;
}

// ---------------------------------------------------------------- arrows (world)
function arrowBlocked(a) {
  return world.props.some(p => !p.broken && a.h > (p.z || 0) && a.h < (p.z || 0) + (p.kind === 'wall_s' ? .5 : 2.5)
    && (p.rect ? a.x > p.rect[0] && a.x < p.rect[2] && a.z > p.rect[1] && a.z < p.rect[3] : (p.target || p.r > .3) && Math.hypot(p.x - a.x, p.y - a.z) < Math.max(.3, p.r)));
}
function stepArrows(dt) {
  for (const a of arrows) {
    if (a.stuck) { a.life -= dt; continue; }
    a.x += a.vx * dt; a.z += a.vz * dt; a.h += a.vh * dt; a.vh -= .9 * dt; a.life -= dt;
    const g = elev(a.x, a.z);
    if (a.h <= g || a.life <= 0 || arrowBlocked(a)) { a.stuck = true; a.life = 3; }
  }
  for (let i = arrows.length - 1; i >= 0; i--) if (arrows[i].stuck && arrows[i].life <= 0) arrows.splice(i, 1);
  const segs = [];
  for (const a of arrows) {
    const l = Math.hypot(a.vx, a.vz, a.vh) || 1, dx = a.vx / l, dz = a.vz / l, dh = a.vh / l;
    segs.push([a.x - dx * .72, a.h - dh * .72, a.z - dz * .72, a.x - dx * .1, a.h - dh * .1, a.z - dz * .1, .55, .42, .29]);
    segs.push([a.x - dx * .1, a.h - dh * .1, a.z - dz * .1, a.x, a.h, a.z, .78, .78, .74]);
  }
  arrowLines.set(segs);
}

// ---------------------------------------------------------------- camera target: eased, then snapped to the pixel lattice
const T = new THREE.Vector3(), Ts = new THREE.Vector3();
let camInit = false;
function snapTarget() {
  const [vx, vy] = toView(T.x, T.z), z = zoom;
  const sx = Math.round(vx * PPM * z) / (PPM * z), S = Math.round(vy * PPMY * z - T.y * PPMH * z), vy2 = (S + T.y * PPMH * z) / (PPMY * z);
  const [X, Zw] = toWorld(sx, vy2); Ts.set(X, T.y, Zw);
}

// ---------------------------------------------------------------- input
let dragging = false, dragX = 0, dragYaw = 0;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (k === ' ') PL.onSpace();
  if (k === 'e') PL.onInteractKey();
  if (k === '1') snapMode = (snapMode + 1) % 3;
  if (k === '2') opt.sampling = SAMPLING[(SAMPLING.indexOf(opt.sampling) + 1) % SAMPLING.length];
  if (k === '3') opt.outline = !opt.outline;
  if (k === '4') { propMode = propMode === 'live' ? 'yaw' : 'live'; world.setMode(propMode); }
  if (k === '5') opt.banded = !opt.banded;
  if (k === '6') opt.shadows = !opt.shadows;
  if (k === 't') timeI = (timeI + 1) % TIMES.length;
  if (k === 'n') setBiome(biomeI + (e.shiftKey ? -1 : 1));
  if (k === 'l') opt.lantern = !opt.lantern;
  if (k === 'g') opt.debug = (opt.debug + 1) % DEBUG.length;
  if (k === 'h') opt.help = !opt.help;
  if (k === 'home') setYaw(0);
  applyOpts();
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') PL.onInteractUp(); });
addEventListener('blur', () => { keys.clear(); mouse.down = false; dragging = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect(), s = r.width / VW, mx = (e.clientX - r.left) / s, my = (e.clientY - r.top) / s;
  mouse.x = VW / 2 + (mx - VW / 2) / zoom; mouse.y = VH / 2 + (my - VH / 2) / zoom;   // the player reads the screen at zoom 1
  if (dragging) { dragYaw += (e.clientX - dragX) * -.006; dragX = e.clientX; }
});
canvas.addEventListener('mousedown', e => { if (e.button === 0) PL.press(); if (e.button === 2) { dragging = true; dragX = e.clientX; } });
addEventListener('mouseup', e => { if (e.button === 0) PL.release(); if (e.button === 2) dragging = false; });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = e.deltaY < 0 ? 2 : 1; }, {passive: false});

// ---------------------------------------------------------------- frame
const ROT_SPEED = 110 * DEG;
let last = performance.now(), fps = 60, hudT = 0;
function step(dt) {
  // camera rotation: keys / drag, then (in a step mode) ease onto the nearest step once you let go
  const rot = (keys.has('x') ? 1 : 0) - (keys.has('z') ? 1 : 0);
  let ny = yaw + rot * ROT_SPEED * dt + dragYaw; dragYaw = 0;
  if (!rot && !dragging && snapMode) { const s = SNAP[snapMode], tg = Math.round(ny / s) * s, d = tg - ny; ny = Math.abs(d) < .0015 ? tg : ny + d * (1 - Math.exp(-dt * 14)); }
  const y0 = yaw; setYaw(ny); syncPlateaus();
  stepSampling(dt, yaw !== y0);
  PL.step(dt);
  stepArrows(dt);
  events.length = 0;
}
function draw(t) {
  const [PX, PZ] = toWorld(P.x, P.y);
  if (!camInit) { T.set(PX, P.z, PZ); camInit = true; }
  const k = 1 - Math.exp(-lastDt * 9); T.x += (PX - T.x) * k; T.y += (P.z - T.y) * k; T.z += (PZ - T.z) * k;
  snapTarget(); G.setView(Ts, yaw, zoom);
  const [tvx, tvy] = toView(Ts.x, Ts.z);
  cam.x = cam.fx = tvx * PPM - VW / 2; cam.y = cam.fy = tvy * PPMY - Ts.y * PPMH - VH / 2;
  // the Ranger
  const fr = SP[P.frame] ? P.frame : 'idle.0', sp = SP[fr];
  cq.clearRect(0, 0, FW, FH); cq.drawImage(sp.img, P.face * FW, 0, FW, FH, 0, 0, FW, FH); PL.drawPixelBow(cq, 0, 0); charTex.needsUpdate = true;
  const hu = hero.g.uniforms;
  if (sp.nrm) { hu.uNrm.value = texOf(sp.nrm); hu.uHasNrm.value = 1; hu.uNrmRect.value.set(P.face / ND, 0, 1 / ND, 1); } else hu.uHasNrm.value = 0;
  hero.u.uAnchor.value.set(PX, P.z, PZ);
  G.compU.uPlayer.value.set(PX, P.z + .9, PZ);
  world.update(yaw);
  applyMood(PX, PZ, t);
  G.render();
}
let lastDt = 1 / 60;
function frame(now) {
  const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now; lastDt = dt;
  step(dt); draw(now / 1000);
  fps = fps * .95 + (dt > 0 ? 1 / dt : 60) * .05;
  if (now - hudT > 250) { hudT = now; hud(); }
  requestAnimationFrame(frame);
}
function hud() {
  const b = BIOMES[biomeI], deg = ((yaw / DEG) % 360 + 360) % 360;
  $('#hud').innerHTML = [
    `<div class="row"><b>HD-2D render test</b> · ${b.name} · ${TIMES[timeI]}${opt.lantern ? ' · lantern' : ''}</div>`,
    `<div class="row">camera <b>${deg.toFixed(1)}°</b> (${SNAP_NAME[snapMode]}) · zoom ${zoom}x · view <b>${DEBUG[opt.debug]}</b></div>`,
    `<div class="row">props <b>${propMode === 'live' ? 'live 3D' : '16-angle sprites'}</b> <span class="dim">(${world.liveCount} live, ${world.yawCount} with angles, ${world.cardCount} painted cards)</span></div>`,
    `<div class="row">ground <b>${opt.sampling === 'auto' ? `auto (${G.U.smooth.value > .5 ? 'smooth, turning' : 'crisp'})` : opt.sampling === 'smooth' ? 'smooth-pixel' : 'nearest'}</b> · outlines <b>${opt.outline ? 'on' : 'off'}</b> · bands <b>${opt.banded ? 'on' : 'off'}</b> · shadows <b>${opt.shadows ? 'on' : 'off'}</b></div>`,
    `<div class="row dim">${fps.toFixed(0)} fps · ${G.stats.ms.toFixed(1)} ms CPU per frame · ${G.stats.calls} draw calls</div>`,
    `<div class="row dim">player ${toWorld(P.x, P.y).map(v => v.toFixed(1)).join(', ')} · ${DIRS[P.face]} on screen · ${P.frame}</div>`,
  ].join('');
}
$('#load').classList.add('hidden');
console.log(`render3d ready in ${((performance.now() - t00) / 1000).toFixed(1)} s`);

// debug handle for scripted tests (drive frames while the pane is hidden: rAF pauses there)
window.__r3d = {G, THREE, P, PL, keys, mouse, cam, opt, arrows, toView, toWorld, setYaw, setBiome,
  get world() { return world; }, get yaw() { return yaw; }, set zoom(v) { zoom = v; }, set time(i) { timeI = i; }, set snap(i) { snapMode = i; },
  set props(m) { propMode = m; world.setMode(m); },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { lastDt = dt; step(dt); draw(performance.now() / 1000); } },
  applyOpts, hud};
requestAnimationFrame(frame);
