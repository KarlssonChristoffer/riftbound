// CUTAWAY (3D): when something stands between the camera and the player, the renderer cuts it away round him (render/cut.js), so he
// and what lies behind him show for real instead of his x-ray outline. SHOW ONLY: nothing here changes how the game plays (the shadows
// keep the whole world: the gorge stays in its rim's shade).
//   when    every frame it looks back along the camera's line from his middle (the view's oblique line: up PPMY, back PPMH per step)
//           and asks the ground (host.elev) and the hut's roof (layout.js HUT) whether anything is over that line; the cut OPENS
//           (eased in) while it is and closes again (eased out) once the line is clear
//   how     DOWN IN THE GROUND (a gorge, a pit, a cleft: the ground over the line): a BAND over the whole view: everything on the side
//           of him the hiding wall stands on (the way to the nearest wall on the camera's side, eased) and higher than his feet goes, the
//           near rim, the land behind it and what grows on it as one piece, while the far side stands; the composite fills what that
//           opens onto nothing with a dark cap (the ground's inside).
//           UNDER A ROOF (in the hut, or its roof over the line): a CAPSULE round him (R m out, H m tall): the roof and the front wall
//           open round him, the rest of the hut stands
// CONTRACT (main.js FEATURE CONTRACT): create(host) -> F with frame(f); F.on / F.toggle() (in the menu as "Cutaway"), ?cut=0 starts off.
//   F.open 0..1 (how open the cut is), F.mode 0 none / 1 band / 2 capsule, F.debug 'open .. · mode ..'
// host: G (setCut), player (x, y, z: m, z his feet's height), yaw, elev, PPMY, PPMH
import {flags} from '../core/flags.js';
import {HUT} from '../world/layout.js';

const R = 2.2, H = 1.8;        // the capsule's radius round him (m) and his height (m)
const BAND = 60;               // the band's half width (m): the whole view (it widens from him as it opens)
const LOOK = 34, STEP = .5;    // how far back along the camera's line it looks (m) and the step (m)
const EASE = 9;                // 1/s: how fast the cut opens and closes

// ORDER (core/features.js): frame only: no update
export const order = {};
export async function create(host) {
  const G = host.G, Nn = Math.hypot(host.PPMY, host.PPMH), KU = host.PPMY / Nn, KH = host.PPMH / Nn;   // (the camera's line: up, back)
  const e = HUT ? HUT.d / 2 + HUT.over : 0;
  const roof = HUT && HUT.roofY !== null ? {x0: HUT.x0 - e, x1: HUT.x1 + e, y0: HUT.y0 - e, y1: HUT.y1 + e, z0: HUT.roofY - .05, z1: HUT.roofY + .7} : null;
  const F = {name: 'cutaway', on: flags.get('cut') !== '0', open: 0, mode: 0, get debug() { return `open ${F.open.toFixed(2)} · mode ${F.mode}`; }};
  F.toggle = () => { F.on = !F.on; if (!F.on) { F.open = 0; F.mode = 0; G.setCut?.(0, 0, 0, 0); } };
  // what is over the camera's line from (x, y, z)? 0 nothing, 1 the ground, 2 the hut's roof (or he is in the hut)
  function cover(x, y, z) {
    if (HUT && x > HUT.x0 && x < HUT.x1 && y > HUT.y0 && y < HUT.y1) return 2;
    const yaw = host.yaw, dx = Math.sin(yaw) * KH, dy = Math.cos(yaw) * KH;
    for (let s = STEP; s <= LOOK; s += STEP) {
      const px = x + dx * s, py = y + dy * s, pz = z + KU * s;
      if (roof && px > roof.x0 && px < roof.x1 && py > roof.y0 && py < roof.y1 && pz > roof.z0 && pz < roof.z1) return 2;
      if (host.elev(px, py) > pz) return 1;
    }
    return 0;
  }
  // the side the band cuts away: the way to the NEAREST WALL on the camera's side of him (ground WALL m over his feet, looked for
  // along SIDES directions within 90 deg of the camera's way, out to SIDE_R m): straight across a gorge from him, so the far wall
  // stands whichever way the camera looks along it. None found: toward the camera
  const SIDE = {x: 0, y: 0}, SIDES = 24, SIDE_R = [1, 7, .5], WALL = 1.5;
  function sideOf(x, y, feet) {
    const yaw = host.yaw; let best = 1e9; SIDE.x = Math.sin(yaw); SIDE.y = Math.cos(yaw);
    for (let i = 0; i <= SIDES; i++) {
      const a = yaw - Math.PI / 2 + Math.PI * i / SIDES, ux = Math.sin(a), uy = Math.cos(a);
      for (let r = SIDE_R[0]; r <= SIDE_R[1] && r < best; r += SIDE_R[2]) if (host.elev(x + ux * r, y + uy * r) > feet + WALL) { best = r; SIDE.x = ux; SIDE.y = uy; break; }
    }
  }
  const side = {x: 0, y: 0};   // the side the band cuts away (eased: it turns smoothly as he walks along a bend)
  F.frame = f => {
    if (!G.setCut) return;
    const p = host.player, dt = Math.min(.1, f?.dt || 1 / 60), c = cover(p.x, p.y, (p.z || 0) + H * .55);
    if (c === 1) sideOf(p.x, p.y, p.z || 0);
    if (c && c !== F.mode) { if (F.open > 0 && F.mode) F.open = Math.min(F.open, .2); F.mode = c; if (c === 1) { side.x = SIDE.x; side.y = SIDE.y; } }   // (a new shape opens from small)
    if (c === 1) { const k = Math.min(1, dt * 6); side.x += (SIDE.x - side.x) * k; side.y += (SIDE.y - side.y) * k; }
    F.open += ((c ? 1 : 0) - F.open) * Math.min(1, dt * EASE);
    if (F.open < .01 && !c) { F.open = 0; F.mode = 0; }
    G.setCut(p.x, p.z || 0, p.y, F.open, R, H, F.mode === 1 ? BAND : 0, side.x, side.y);
  };
  return F;
}
