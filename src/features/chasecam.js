// CAMERA VIEWS (experiments: other ways to see the game). The cinema camera's free PERSPECTIVE view (gfx.js setCine) held on
// the player every frame instead of the game's oblique one, in one of two views; F6 goes round them: the game's own top-down
// camera -> THIRD PERSON -> FIRST PERSON -> back. Both keep the game's own heading (cv.yaw), so WASD stays camera-relative as
// it is; the mouse turns that heading (host.setYaw) and tilts the camera (pointer lock: click the screen). A crosshair at the
// middle of the screen is the aim: the sim still reads the cursor through the game's hidden oblique view (G.gameToScreen),
// so the cursor is put where the crosshair's point lies in that view.
//   third person (CHASE): the camera sits D m back along the heading; the wheel moves it in (over the shoulder, a little to
//     his right) or out (high up).
//   first person (EYES): the camera at his eyes (lower crouching, a dip landing, swimming: P.sink), looking up / down
//     TUNE.eye.up / down deg; his body is not drawn (core/loop.js reads F.hidesBody: the sprite card hidden, the live
//     hero's body not put; its pose, cloth and gun are still worked out, so co-op peers see him as ever); his lantern and his
//     contact shadow stay. The game PLAYS from his eyes too:
//     - the aim is THE LOOK (see()): the line from his eyes through the crosshair, met by the ground or by whatever stands in
//       the way (a foe, a tree, a wall, a chest); a shot, an arrow, an ability flies at that point, up or down (aimTarget:
//       ray), a target there takes it (the crosshair goes gold); with nothing in the line the aim help (features/aim.js) picks
//       on this screen
//     - E uses what he looks at, within TUNE.look.reach m (lookProp); the axe's trunk, the rod's cast, a throw, the lasso's
//       ground go where the look meets the ground (aimGround: player.js cursorGround)
//     - he faces where he looks, whichever way he walks (faceAhead: strafing, walking backwards; no turning round)
//     - his hands and what they hold are drawn at the bottom of the screen (view/fphands.js): the revolver (its kick, its
//       reload), the bow (raised and drawn as he draws: the view narrows a little, TUNE.look.drawFov), the axe's swing, the
//       fists, the lasso's coil and loop, the lantern
//     - the click that takes the mouse doesn't shoot; the wheel does nothing (the game's zoom stays as it is)
// What is LOCAL: the camera, the hidden body, the lock, the look, the hands. What others see is what the sim already shares:
// where he walks and faces (now his look's way in first person), his shots and swings, his drawn pose.
// TOGGLE: F6, the menu's rows (Sandbox > Other), ?cam=3p | 1p at boot. The idle cinematic camera may still take the screen;
// this one comes back after it. Photo mode keeps its own camera. The HUD and the prompts draw as ever (CAM.hud: core/loop.js).
// NOT YET: the camera kept out of trees and cliffs (only out of the ground), the art seen low (cards and sprites are
// painted for the game's high view), a roof over the caves (the surface crumbles away for the top-down view: the sky over
// the walls goes black down there instead), the fishing rod in his hands (it's drawn in the world from his hidden hand), his
// legs seen looking down, peers seeing him walk backwards (his walk plays facing his look).
// OWNS: its pose (CAM, handed to G.setCine), the view (mode), D / the pitches, the look (LOOK), its pointer lock, its listeners.
// WRITES: host.mouse.x / y while it is on (the aim: core/input.js's cursor otherwise; an experiment's shortcut, see above).
// READS: host.player / P / yaw / mood / env / biome / elev / entities (near) / paused / photoOpen, features/caves.js under,
//   features/aim.js aimTarget.  BUDGET: ~0.01 ms a frame; first person + the look's march (~60 ground samples, a few near()
//   queries) and the hands' few drawImage calls.
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {AIM_H} from '../sim/player/player.js';
import {HEIGHT, walkR} from '../world/collide.js';
import {topOfProp} from '../world/world.js';
import {createHands} from '../view/fphands.js';
import {loadPixelFont} from '../ui/pixelfont.js';

export const TUNE = {
  dist: 6, min: 2.5, max: 24,             // m behind the chest: the start, the wheel's range
  pitch: 22, pitchMin: 6, pitchMax: 65,   // deg the camera sits above him (mouse Y)
  sens: .0025,                            // rad per mouse px
  chest: 1.35,                            // m above his feet the camera follows
  shoulder: .55,                          // m to his right, close in (gone by 7 m)
  fov: [55, 38],                          // deg: close .. far
  ease: 14,                               // the follow's catch-up (1/s)
  air: .006,                              // the distance fog (1/m) on a clear day
  caveAir: .09,                           // more of it down in the cave (1/m at features/caves.js under 1): the passages go into the dark
  // first person: eyes m above his feet, ahead of his middle (m), the look's range (deg up / down), fov (deg, vertical), near
  // (m), how far a dip (P.sink: crouching, landing, swimming) lowers the eyes (m per 1: the views' 22 px), the eyes' lowest,
  // the crosshair's point when the look doesn't meet the ground (m out), its nearest; the look a view starts with (deg down)
  eye: {start: 6, h: 1.55, ahead: .12, up: 80, down: 80, fov: 66, near: .06, sink: .77, low: .3, far: 22, close: 1.2, ease: 30},
  // first person's LOOK (the line from his eyes through the crosshair: what he aims at, uses, cuts): how far it reaches (m), the
  // ground's march (m a step at the eyes, + a share of the distance), the things' (m a stretch), the most of a thing off the line
  // that still counts for E (m), the reach of E along it (m on the ground), a shot's nearest point (m); the bow's drawn fov (deg)
  look: {range: 60, step: .25, grow: .05, stretch: 4, use: .25, reach: 2, nearest: .8, drawFov: 52, drawEase: 6},
};
const VIEWS = ['', '3p', '1p'], NAMES = {'': 'Top-down camera', '3p': 'Third person camera', '1p': 'First person camera'};

// the sky from the clock's mood (features/cinema.js sky(): the same numbers)
const SKY = {nz: [.025, .04, .1], nh: [.06, .08, .16], dz: [.27, .47, .85], dh: [.68, .79, .9], wz: [.24, .22, .42], wh: [1, .6, .34]};
const ONE = [1, 1, 1], NOSKY = {}, MOON = [.78, .84, 1], WARM = [.2, .02, -.2];
const TINT = {ruins: [1, 1, 1], frost: [.9, .97, 1.08], ember: [1.15, .8, .7], rift: [1, .74, 1.25], desert: [1.08, .97, .84]};
const lerp = (a, b, t) => a + (b - a) * t, DEG = Math.PI / 180;

export async function create(host) {
  const G = host.G, THREE = host.THREE;
  const start = VIEWS.includes(flags.get('cam')) ? flags.get('cam') : '';
  let mode = start;   // '' the game's camera, '3p', '1p'
  const F = {name: 'chasecam', label: 'Camera views', on: !!start, cineHd: true, TUNE,
    get hidesBody() { return mode === '1p' && active(); },   // his body is not drawn this frame (first person on the screen: core/loop.js)
    get current() { return mode; }};   // the view ('view' is the feature contract's hook)
  // hud: the game's HUD and prompts draw over this camera (core/loop.js; the cinematic camera's shots have none)
  const CAM = {pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, near: .1, far: 400, air: TUNE.air, hud: true,
    sky: {zen: [0, 0, 0], hor: [0, 0, 0], sun: [1, 1, 1], dir: [0, 1, 0], disk: .032}};
  let D = TUNE.dist, pitch = TUNE.pitch * DEG, look = -TUNE.eye.start * DEG, init = false, wired = false, canvas = null;   // look: first person's (rad, + up)
  let caves = null, zoomK = 0, fdt = 0;
  const hands = createHands(host);   // what he holds, from his eyes (view/fphands.js)
  loadPixelFont();   // (the hint's letters: ui/pixelfont.js RiftPixel)   // features/caves.js (false: none); the bow's narrowed view (0..1)
  const C = {x: 0, y: 0, h: 0}, aimP = {x: 0, y: 0, h: 0}, out = [0, 0, 0];
  const active = () => F.on && G.cine === CAM;
  const locked = () => !!canvas && document.pointerLockElement === canvas;

  function pose(dt) { if (mode === '1p') eyes(dt); else chase(dt); }
  // FIRST PERSON: at his eyes (the draw's lerped spot: no lag), only the height eased (a step up a stone, a dip)
  function eyes(dt) {
    const p = host.player, P = host.P, E = TUNE.eye, feet = P.z || 0, k = init ? 1 - Math.exp(-dt * E.ease) : 1; init = true;
    const yaw = host.yaw, fx = -Math.sin(yaw), fy = -Math.cos(yaw);
    C.x = p.x + fx * E.ahead; C.y = p.y + fy * E.ahead;
    C.h += (feet + Math.max(E.low, E.h - (P.sink || 0) * E.sink) - C.h) * k;
    const cl = Math.cos(look), sl = Math.sin(look);
    CAM.pos.set(C.x, C.h, C.y);
    const g = (host.elev(C.x, C.y) || 0) + .15; if (CAM.pos.y < g) CAM.pos.y = g;   // (never under the ground)
    CAM.look.set(C.x + fx * cl * 10, CAM.pos.y + sl * 10, C.y + fy * cl * 10);
    // the crosshair's point: what the look meets (below), the cursor put there
    see(CAM.pos.x, CAM.pos.y, CAM.pos.z, fx * cl, sl, fy * cl);
    aimP.x = LOOK.x; aimP.y = LOOK.y; aimP.h = LOOK.h;
    // the bow drawn: the view narrows a little as the string comes back (his eyes on the mark)
    const drawn = host.P.state === 'draw' && host.weapon?.kind === 'bow' ? clamp(host.P.t * 1.6, 0, 1) : 0;
    zoomK += (drawn - zoomK) * (1 - Math.exp(-dt * TUNE.look.drawEase));
    CAM.fov = lerp(E.fov, TUNE.look.drawFov, zoomK); CAM.near = E.near;
  }
  // THE LOOK (first person): the line from his eyes through the crosshair, out to TUNE.look.range m, against the ground (marched,
  // then halved down onto it) and the things standing on it (the registry's near() along it, a stretch at a time: each thing's
  // round or box from its base to its top, collide.js's heights; nothing else is scanned). -> LOOK: the point it meets (x, y, h:
  // world, h up), t (m along it), what it met: target (a thing to shoot: hp, a target, breakable), use (a thing for E: in
  // reach, a little off the line counts), tree; gx, gy: the ground under that point (the sim's cursorGround). Nothing met: the
  // point out at `range`, its ground `far` m ahead. Read by the sim through aimTarget / aimGround / lookProp, the frame before
  const LOOK = {x: 0, y: 0, h: 0, t: 0, target: null, use: null, tree: null, gx: 0, gy: 0, ground: false};
  const NEAR = [];
  function see(ox, oh, oy, dx, dh, dy) {
    const L = TUNE.look, el = host.elev, hl = Math.hypot(dx, dy);
    // the ground
    let tg = L.range, ta = 0, ground = false;
    for (let t = L.step; t < L.range; t += L.step + t * L.grow) {
      const h = oh + dh * t, g = el(ox + dx * t, oy + dy * t) || 0;
      if (h <= g) {
        let a = ta, b = t;
        for (let i = 0; i < 7; i++) { const m = (a + b) / 2; if (oh + dh * m <= (el(ox + dx * m, oy + dy * m) || 0)) b = m; else a = m; }
        tg = b; ground = true; break;
      }
      if (dh > 0 && h - g > 25) break;   // (up into the sky: nothing more to meet)
      ta = t;
    }
    // the things on it, nearest first
    let best = tg, bp = null, use = null, ut = Infinity;
    const P = host.player, SL = L.stretch;
    for (let s = 0; s < best; s += SL) {
      const m = s + SL / 2, cx = ox + dx * m, cy = oy + dy * m;
      for (const p of host.entities.near(cx, cy, SL * hl / 2 + L.use + .1, NEAR)) {
        if (p.gone || p.broken) continue;
        const aim = p.hp > 0 || p.target || p.breakable, act = !!p.interact && !p.opened;
        const top = aim ? p.hitH ?? (p.kind === 'pot' ? .55 : p.kind === 'crate' ? .75 : 1.6) : topOfProp(p) ?? HEIGHT[p.kind];
        if (!(top > 0) && !act) continue;   // (ground cover, decals, markers: nothing standing)
        const z0 = (p.z || 0) + (aim ? p.h || 0 : 0), z1 = z0 + Math.max(top || 0, act ? .5 : 0);
        const r = aim ? Math.max(.3, p.hitR ?? p.r ?? .4) : p.kind === 'tree' ? walkR(p) : p.r || (act ? .35 : 0);
        if (act) {   // E: a little off the line counts, within reach of his feet
          const t = cross(p, ox, oh, oy, dx, dh, dy, r + L.use, z0, z1 + .2);
          if (t < ut && t <= best + .5) { const hx = ox + dx * t - P.x, hy = oy + dy * t - P.y; if (Math.hypot(hx, hy) <= L.reach + r) { ut = t; use = p; } }
        }
        if (!(r > 0 || p.rect) || !(top > 0)) continue;
        const t = cross(p, ox, oh, oy, dx, dh, dy, r, z0, z1);
        if (t < best) { best = t; bp = p; }
      }
      if (best < s + SL) break;   // (met in this stretch: nothing further on can be nearer)
    }
    LOOK.t = best; LOOK.x = ox + dx * best; LOOK.y = oy + dy * best; LOOK.h = oh + dh * best; LOOK.ground = ground && !bp;
    LOOK.target = bp && (bp.hp > 0 || bp.target || bp.breakable) ? bp : null; LOOK.tree = bp && bp.kind === 'tree' ? bp : null;
    LOOK.use = use && ut <= best + .5 ? use : null;
    if (bp || ground) { LOOK.gx = LOOK.x; LOOK.gy = LOOK.y; }
    else { const f = Math.max(hl, .05); LOOK.gx = ox + dx / f * TUNE.eye.far; LOOK.gy = oy + dy / f * TUNE.eye.far; }
  }
  // where the line (unit d) first enters prop p's round (radius r; its rect grown by r - its own r) between heights z0 and z1
  // -> t (m along the line), Infinity: it doesn't. (the eyes inside it: from where the line is in its height band)
  function cross(p, ox, oh, oy, dx, dh, dy, r, z0, z1) {
    let t0 = 0, t1 = TUNE.look.range;
    if (p.rect) {
      const g = Math.max(0, r - (p.r || 0)), R = p.rect;
      if (!slab(ox, dx, R[0] - g, R[2] + g)) return Infinity; t0 = Math.max(t0, S0); t1 = Math.min(t1, S1);
      if (!slab(oy, dy, R[1] - g, R[3] + g)) return Infinity; t0 = Math.max(t0, S0); t1 = Math.min(t1, S1);
    } else {
      const ex = ox - p.x, ey = oy - p.y, a = dx * dx + dy * dy, b = ex * dx + ey * dy, c = ex * ex + ey * ey - r * r;
      if (a < 1e-9) { if (c > 0) return Infinity; }   // (straight down)
      else { const D = b * b - a * c; if (D < 0) return Infinity; const q = Math.sqrt(D); t0 = Math.max(t0, (-b - q) / a); t1 = Math.min(t1, (-b + q) / a); }
    }
    if (!slab(oh, dh, z0, z1)) return Infinity; t0 = Math.max(t0, S0); t1 = Math.min(t1, S1);
    return t0 <= t1 ? t0 : Infinity;
  }
  let S0 = 0, S1 = 0;   // (slab's answer: the line's t range between lo and hi on one axis)
  function slab(o, d, lo, hi) {
    if (Math.abs(d) < 1e-9) { S0 = -Infinity; S1 = Infinity; return o >= lo && o <= hi; }
    const a = (lo - o) / d, b = (hi - o) / d; S0 = Math.min(a, b); S1 = Math.max(a, b); return true;
  }
  function chase(dt) {
    const p = host.player, feet = host.P.z || 0, k = init ? 1 - Math.exp(-dt * TUNE.ease) : 1; init = true;
    C.x += (p.x - C.x) * k; C.y += (p.y - C.y) * k; C.h += (feet + TUNE.chest - C.h) * k;
    const yaw = host.yaw, fx = -Math.sin(yaw), fy = -Math.cos(yaw), rx = -fy, ry = fx;   // forward (where W goes), his right
    const sh = TUNE.shoulder * clamp((7 - D) / 4.5, 0, 1), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ahead = (3 + D * .6) * cp * cp;   // the look's point ahead of him: he sits below the middle, the crosshair out in front
    CAM.pos.set(C.x - fx * D * cp + rx * sh, C.h + D * sp, C.y - fy * D * cp + ry * sh);
    const g = (host.elev(CAM.pos.x, CAM.pos.z) || 0) + .5; if (CAM.pos.y < g) CAM.pos.y = g;   // (never under the ground)
    aimP.x = C.x + fx * ahead + rx * sh; aimP.y = C.y + fy * ahead + ry * sh; aimP.h = feet + AIM_H;
    CAM.look.set(aimP.x, C.h - TUNE.chest + AIM_H, aimP.y);
    CAM.fov = lerp(TUNE.fov[0], TUNE.fov[1], clamp((D - 4) / 16, 0, 1)); CAM.near = .1;
  }
  function sky() {
    const m = host.mood, env = host.env, sk = env.sky || NOSKY, o = CAM.sky, amb = m.amb, c = m.sun.c || ONE;
    const la = .3 * amb[0] + .55 * amb[1] + .15 * amb[2], day = clamp((la - .3) / .55, 0, 1), night = env.part === 'night';
    const warm = night ? 0 : clamp((c[0] - c[2] - .2) * 2.2, 0, 1) * (1 - .4 * day);
    const cloud = clamp(Math.max(sk.cloud || 0, sk.fog || 0, sk.rain || 0, sk.snow || 0), 0, 1), tint = TINT[host.biome.id] || TINT.ruins;
    for (let i = 0; i < 3; i++) {
      let z = lerp(SKY.nz[i], SKY.dz[i], day), h = lerp(SKY.nh[i], SKY.dh[i], day);
      z = lerp(z, SKY.wz[i], warm * .6); h = lerp(h, SKY.wh[i], warm * .85);
      const gr = la * (.74 + .04 * i);
      o.zen[i] = lerp(z, gr * .85, cloud * .8) * tint[i]; o.hor[i] = lerp(h, gr, cloud * .8) * tint[i];
      o.sun[i] = (night ? MOON[i] * .75 : Math.min(1, c[i] * (1 + WARM[i] * warm))) * (1 - cloud * .8);
    }
    const az = m.sun.az * DEG, el = m.sun.el * DEG;
    o.dir[0] = Math.sin(az) * Math.cos(el); o.dir[1] = Math.sin(el); o.dir[2] = -Math.cos(az) * Math.cos(el);
    // down in the cave (features/caves.js under: the world above gone dark round him) the open sky over the walls goes black
    const u = (caves ??= host.feature('caves') || false) ? caves.under || 0 : 0, lit = 1 - u;
    if (u > 0) for (let i = 0; i < 3; i++) { o.zen[i] *= lit * lit; o.hor[i] *= lit * lit; o.sun[i] *= lit; }
    o.disk = cloud > .55 || u > .3 ? 0 : night ? .022 : .032;
    CAM.air = TUNE.air + (sk.fog || 0) * .016 + (sk.rain || 0) * .005 + (sk.snow || 0) * .007 + u * TUNE.caveAir;
  }
  // the cursor where the crosshair's point lies in the game's own view (what the sim aims through)
  function aim() {
    if (!active()) return;
    G.gameToScreen(aimP.x, aimP.h, aimP.y, out); host.mouse.x = out[0]; host.mouse.y = out[1];
  }

  // the listeners go on with the first frame: after core/input.js's, so its cursor update runs first and this one last
  function wire() {
    wired = true; canvas = document.querySelector('#screen');
    // the click that takes the mouse is only that: it doesn't reach core/input.js (no shot, no swing), nor does its let-go
    let eat = false;
    addEventListener('mousedown', e => {
      if (!active() || locked() || host.paused || host.lock || e.target !== canvas || e.button !== 0) return;
      try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {}
      eat = true; e.stopPropagation(); e.preventDefault();
    }, {capture: true});
    addEventListener('mouseup', e => { if (eat && e.button === 0) { eat = false; e.stopPropagation(); } }, {capture: true});
    addEventListener('mousemove', e => {
      if (!active()) return;
      if (locked() && !host.paused) {
        if (e.movementX) host.setYaw(host.yaw - e.movementX * TUNE.sens);
        if (mode === '1p') look = clamp(look - e.movementY * TUNE.sens, -TUNE.eye.down * DEG, TUNE.eye.up * DEG);
        else pitch = clamp(pitch + e.movementY * TUNE.sens, TUNE.pitchMin * DEG, TUNE.pitchMax * DEG);
      }
      aim();
    });
    addEventListener('wheel', e => {   // (capture, and not on to the canvas: the game's zoom stays as it is; first person: nothing)
      if (!active() || host.paused || (e.target !== canvas && !locked())) return;   // (over a panel: its own scroll)
      e.preventDefault(); e.stopPropagation();
      if (mode === '3p') D = clamp(D * Math.exp(e.deltaY * .0015), TUNE.min, TUNE.max);
    }, {capture: true, passive: false});
  }
  function off() { if (G.cine === CAM) G.setCine(null); if (locked()) document.exitPointerLock(); }

  // the sim's side of the look (sim/player/adapter.js, between the steps; first person on the screen only, else null / false)
  const AT = {x: 0, y: 0, h: 0, target: null, ray: true}, GP = {x: 0, y: 0};
  let aimF = null;   // features/aim.js (false: none)
  const eyesOn = () => mode === '1p' && active();
  Object.assign(F, {
    // the aim (the adapter's hover chain): what the look meets, at the height it meets it (kept inside a target's own); else the
    // aim help's pick (features/aim.js: soft / lock / auto, on this screen); else the point itself (ray: a shot flies straight
    // at it, up or down: player.js shoot, gun.js fire), never nearer his feet than look.nearest
    aimTarget() {
      if (!eyesOn()) return null;
      const p = LOOK.target, P = host.player;
      if (p) {
        const z0 = (p.z || 0) + (p.h || 0), hh = p.hitH ?? (p.kind === 'pot' ? .55 : p.kind === 'crate' ? .75 : 1.6);
        AT.x = p.x; AT.y = p.y; AT.h = clamp(LOOK.h, z0 + hh * .08, z0 + hh * .95); AT.target = p; return AT;
      }
      const help = (aimF ??= host.feature('aim') || false) && aimF.aimTarget?.(); if (help) return help;
      AT.x = LOOK.x; AT.y = LOOK.y; AT.h = LOOK.h; AT.target = null;
      const dx = AT.x - P.x, dy = AT.y - P.y, n = TUNE.look.nearest;
      if (dx * dx + dy * dy < n * n) { AT.x = P.x - Math.sin(host.yaw) * n; AT.y = P.y - Math.cos(host.yaw) * n; AT.h = Math.min(AT.h, (P.z || 0) + AIM_H); }
      return AT;
    },
    aimGround() { if (!eyesOn()) return null; GP.x = LOOK.gx; GP.y = LOOK.gy; return GP; },   // the ground under it (player.js cursorGround: the rod's cast, the axe's trunk, a throw)
    lookProp() { return eyesOn() ? LOOK.use : null; },   // what E uses: the thing looked at (adapter nearProp)
    faceAhead() { return eyesOn(); },   // he faces where he looks, whichever way he walks (player.js locomotion)
    get look() { return LOOK; },
    cursor: aim,   // (core/loop.js: right after core/input.js's cursor, so this frame's hover and his arm read the crosshair's)
    // the pose here, not in frame(): this runs before the renderer takes its view (render/camera.js follow)
    camera(dt) {
      if (host.photoOpen) { off(); return null; }
      if (G.cine && G.cine !== CAM) { init = false; return null; }   // (the cinematic camera has the screen)
      pose(Math.min(dt || 0, .1)); sky();
      if (G.cine !== CAM) G.setCine(CAM);
      return null;
    },
    view(dt, evs) { if (eyesOn()) hands.view(dt, evs); },
    frame({dt}) {
      fdt = dt || 0;
      if (!wired) wire();
      if (host.paused && locked()) document.exitPointerLock();
      aim();
    },
    hd(q, sc) {
      if (!active()) return;
      const W = q.canvas.width, H = q.canvas.height, u = Math.max(1, Math.round(host.hudScale)), cx = Math.round(W / 2), cy = Math.round(H / 2);
      const col = host.P.state === 'draw' || (mode === '1p' && LOOK.target) ? '#f2d27a' : '#e9e4da';
      if (mode === '1p' && !host.hudOff) { q.save(); hands.draw(q, sc, look, fdt); q.restore(); }
      q.fillStyle = 'rgba(0,0,0,.55)';
      if (mode === '1p') {   // a smaller cross round a dot
        q.fillRect(cx - 5 * u, cy - u, 10 * u + u, 3 * u); q.fillRect(cx - u, cy - 5 * u, 3 * u, 10 * u + u);
        q.fillStyle = col; q.fillRect(cx, cy, u, u);
        q.fillRect(cx - 4 * u, cy, 2 * u, u); q.fillRect(cx + 3 * u, cy, 2 * u, u); q.fillRect(cx, cy - 4 * u, u, 2 * u); q.fillRect(cx, cy + 3 * u, u, 2 * u);
      } else {
        q.fillRect(cx - 6 * u, cy - u, 12 * u + u, 3 * u); q.fillRect(cx - u, cy - 6 * u, 3 * u, 12 * u + u);
        q.fillStyle = col;
        q.fillRect(cx - 5 * u, cy, 4 * u, u); q.fillRect(cx + 2 * u, cy, 4 * u, u); q.fillRect(cx, cy - 5 * u, u, 4 * u); q.fillRect(cx, cy + 2 * u, u, 4 * u);
      }
      if (!locked() && !host.paused) {
        q.font = `${10 * u}px RiftPixel, monospace`; q.textAlign = 'center'; q.fillStyle = 'rgba(0,0,0,.6)';
        const t = mode === '1p' ? 'First person: click to look around  ·  F6: back to the top-down camera'
          : 'Third person: click to look around  ·  wheel: closer / further  ·  F6: first person';
        q.fillText(t, cx + u, 16 * u + u); q.fillStyle = '#e9e4da'; q.fillText(t, cx, 16 * u);   // (at the top: the HUD's below)
      }
    },
    onKey(k, e) { if (k !== 'f6') return false; e?.preventDefault(); F.toggle(); return true; },
    // F6: the next view round (top-down -> third person -> first person -> top-down)
    toggle() { return F.setView(VIEWS[(VIEWS.indexOf(mode) + 1) % VIEWS.length]); },
    setView(v) {
      if (!VIEWS.includes(v)) return F.on;
      if (v === '1p' && mode !== '1p') look = -TUNE.eye.start * DEG;
      mode = v; F.on = !!v; init = false; if (!F.on) off(); return F.on;
    },
    setLook(deg) { look = clamp(deg * DEG, -TUNE.eye.down * DEG, TUNE.eye.up * DEG); },   // (first person's look up / down: tests)
    menu() { return VIEWS.filter(v => v !== mode).map(v => ({label: NAMES[v] + ' (F6)', run: () => F.setView(v)})); },
    info() { return {on: F.on, view: mode, active: active(), locked: locked(), hidesBody: F.hidesBody, dist: +D.toFixed(2), pitch: +(pitch / DEG).toFixed(1), look: +(look / DEG).toFixed(1), pos: CAM.pos.toArray().map(v => +v.toFixed(2)), at: CAM.look.toArray().map(v => +v.toFixed(2)), aim: [+aimP.x.toFixed(2), +aimP.y.toFixed(2)]}; },
  });
  return F;
}
