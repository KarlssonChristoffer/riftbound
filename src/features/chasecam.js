// CHASE CAMERA (an experiment: a third person view to try). The cinema camera's free PERSPECTIVE view (gfx.js setCine)
// held behind the player every frame instead of the game's oblique one: the camera sits D m back along the game's own
// heading (cv.yaw), so WASD stays camera-relative as it is; the mouse turns that heading (host.setYaw) and tilts the camera
// (pointer lock: click the screen), the wheel moves it in (over the shoulder, a little to his right) or out (high up). A
// crosshair at the middle of the screen is the aim: the sim still reads the cursor through the game's hidden oblique view
// (G.gameToScreen), so the cursor is put where the crosshair's point lies in that view.
// TOGGLE: F6, the menu's row, ?cam=3p at boot. The idle cinematic camera may still take the screen; this one comes back
// after it. Photo mode keeps its own camera.
// NOT YET: the HUD under it (only cineHd overlays draw while a cinema camera is set), the camera kept out of trees and
// cliffs (only out of the ground), the art seen low (cards and sprites are painted for the game's high view).
// OWNS: its pose (CAM, handed to G.setCine), D / pitch, its pointer lock, its listeners.
// WRITES: host.mouse.x / y while it is on (the aim: core/input.js's cursor otherwise; an experiment's shortcut, see above).
// READS: host.player / P / yaw / mood / env / biome / elev / paused / photoOpen.  BUDGET: ~0.01 ms a frame.
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {AIM_H} from '../sim/player/player.js';

export const TUNE = {
  dist: 6, min: 2.5, max: 24,             // m behind the chest: the start, the wheel's range
  pitch: 22, pitchMin: 6, pitchMax: 65,   // deg the camera sits above him (mouse Y)
  sens: .0025,                            // rad per mouse px
  chest: 1.35,                            // m above his feet the camera follows
  shoulder: .55,                          // m to his right, close in (gone by 7 m)
  fov: [55, 38],                          // deg: close .. far
  ease: 14,                               // the follow's catch-up (1/s)
  air: .006,                              // the distance fog (1/m) on a clear day
};

// the sky from the clock's mood (features/cinema.js sky(): the same numbers)
const SKY = {nz: [.025, .04, .1], nh: [.06, .08, .16], dz: [.27, .47, .85], dh: [.68, .79, .9], wz: [.24, .22, .42], wh: [1, .6, .34]};
const ONE = [1, 1, 1], NOSKY = {}, MOON = [.78, .84, 1], WARM = [.2, .02, -.2];
const TINT = {ruins: [1, 1, 1], frost: [.9, .97, 1.08], ember: [1.15, .8, .7], rift: [1, .74, 1.25], desert: [1.08, .97, .84]};
const lerp = (a, b, t) => a + (b - a) * t, DEG = Math.PI / 180;

export async function create(host) {
  const G = host.G, THREE = host.THREE;
  const F = {name: 'chasecam', label: 'Third person camera', on: flags.get('cam') === '3p', cineHd: true, TUNE};
  const CAM = {pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, near: .1, far: 400, air: TUNE.air,
    sky: {zen: [0, 0, 0], hor: [0, 0, 0], sun: [1, 1, 1], dir: [0, 1, 0], disk: .032}};
  let D = TUNE.dist, pitch = TUNE.pitch * DEG, init = false, wired = false, canvas = null;
  const C = {x: 0, y: 0, h: 0}, aimP = {x: 0, y: 0, h: 0}, out = [0, 0, 0];
  const active = () => F.on && G.cine === CAM;
  const locked = () => !!canvas && document.pointerLockElement === canvas;

  function pose(dt) {
    const p = host.player, feet = host.P.z || 0, k = init ? 1 - Math.exp(-dt * TUNE.ease) : 1; init = true;
    C.x += (p.x - C.x) * k; C.y += (p.y - C.y) * k; C.h += (feet + TUNE.chest - C.h) * k;
    const yaw = host.yaw, fx = -Math.sin(yaw), fy = -Math.cos(yaw), rx = -fy, ry = fx;   // forward (where W goes), his right
    const sh = TUNE.shoulder * clamp((7 - D) / 4.5, 0, 1), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ahead = (3 + D * .6) * cp * cp;   // the look's point ahead of him: he sits below the middle, the crosshair out in front
    CAM.pos.set(C.x - fx * D * cp + rx * sh, C.h + D * sp, C.y - fy * D * cp + ry * sh);
    const g = (host.elev(CAM.pos.x, CAM.pos.z) || 0) + .5; if (CAM.pos.y < g) CAM.pos.y = g;   // (never under the ground)
    aimP.x = C.x + fx * ahead + rx * sh; aimP.y = C.y + fy * ahead + ry * sh; aimP.h = feet + AIM_H;
    CAM.look.set(aimP.x, C.h - TUNE.chest + AIM_H, aimP.y);
    CAM.fov = lerp(TUNE.fov[0], TUNE.fov[1], clamp((D - 4) / 16, 0, 1));
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
    o.disk = cloud > .55 ? 0 : night ? .022 : .032;
    CAM.air = TUNE.air + (sk.fog || 0) * .016 + (sk.rain || 0) * .005 + (sk.snow || 0) * .007;
  }
  // the cursor where the crosshair's point lies in the game's own view (what the sim aims through)
  function aim() {
    if (!active()) return;
    G.gameToScreen(aimP.x, aimP.h, aimP.y, out); host.mouse.x = out[0]; host.mouse.y = out[1];
  }

  // the listeners go on with the first frame: after core/input.js's, so its cursor update runs first and this one last
  function wire() {
    wired = true; canvas = document.querySelector('#screen');
    canvas?.addEventListener('mousedown', () => { if (active() && !locked() && !host.paused) { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {} } });
    addEventListener('mousemove', e => {
      if (!active()) return;
      if (locked() && !host.paused) {
        if (e.movementX) host.setYaw(host.yaw - e.movementX * TUNE.sens);
        pitch = clamp(pitch + e.movementY * TUNE.sens, TUNE.pitchMin * DEG, TUNE.pitchMax * DEG);
      }
      aim();
    });
    addEventListener('wheel', e => {   // (capture, and not on to the canvas: the game's zoom stays as it is)
      if (!active() || host.paused) return;
      e.preventDefault(); e.stopPropagation();
      D = clamp(D * Math.exp(e.deltaY * .0015), TUNE.min, TUNE.max);
    }, {capture: true, passive: false});
  }
  function off() { if (G.cine === CAM) G.setCine(null); if (locked()) document.exitPointerLock(); }

  Object.assign(F, {
    // the pose here, not in frame(): this runs before the renderer takes its view (render/camera.js follow)
    camera(dt) {
      if (host.photoOpen) { off(); return null; }
      if (G.cine && G.cine !== CAM) { init = false; return null; }   // (the cinematic camera has the screen)
      pose(Math.min(dt || 0, .1)); sky();
      if (G.cine !== CAM) G.setCine(CAM);
      return null;
    },
    frame() {
      if (!wired) wire();
      if (host.paused && locked()) document.exitPointerLock();
      aim();
    },
    hd(q, sc) {
      if (!active()) return;
      const W = q.canvas.width, H = q.canvas.height, u = Math.max(1, Math.round(host.hudScale)), cx = Math.round(W / 2), cy = Math.round(H / 2);
      q.fillStyle = 'rgba(0,0,0,.55)';
      q.fillRect(cx - 6 * u, cy - u, 12 * u + u, 3 * u); q.fillRect(cx - u, cy - 6 * u, 3 * u, 12 * u + u);
      q.fillStyle = host.P.state === 'draw' ? '#f2d27a' : '#e9e4da';
      q.fillRect(cx - 5 * u, cy, 4 * u, u); q.fillRect(cx + 2 * u, cy, 4 * u, u); q.fillRect(cx, cy - 5 * u, u, 4 * u); q.fillRect(cx, cy + 2 * u, u, 4 * u);
      if (!locked() && !host.paused) {
        q.font = `${8 * u}px monospace`; q.textAlign = 'center'; q.fillStyle = 'rgba(0,0,0,.6)';
        const t = 'Third person: click to look around  ·  wheel: closer / further  ·  F6: back to the normal camera';
        q.fillText(t, cx + u, H - 14 * u + u); q.fillStyle = '#e9e4da'; q.fillText(t, cx, H - 14 * u);
      }
    },
    onKey(k, e) { if (k !== 'f6') return false; e?.preventDefault(); F.toggle(); return true; },
    toggle() { F.on = !F.on; init = false; if (!F.on) off(); return F.on; },
    menu() { return [{label: F.on ? 'Normal camera (F6)' : 'Third person camera (F6)', run: () => F.toggle()}]; },
    info() { return {on: F.on, active: active(), locked: locked(), dist: +D.toFixed(2), pitch: +(pitch / DEG).toFixed(1), pos: CAM.pos.toArray().map(v => +v.toFixed(2)), look: CAM.look.toArray().map(v => +v.toFixed(2))}; },
  });
  return F;
}
