// CUTAWAY (3D): when something stands between the camera and the player, the renderer cuts it away round him (render/cut.js), so he
// and what lies behind him show for real instead of his x-ray outline. SHOW ONLY: nothing here changes how the game plays (the shadows
// keep the whole world: the gorge stays in its rim's shade).
//   when    every frame it looks back along the camera's line from his middle (the view's oblique line: up PPMY, back PPMH per step)
//           and asks the ground (host.elev) and the hut's roof (layout.js HUT) whether anything is over that line; the cut OPENS
//           (eased in) while it is and closes again (eased out) once the line is clear
//   how     DOWN IN THE GROUND (a gorge, a pit, a cleft: ground DEEP m over his feet over the line): a WELL on the camera's side of
//           him, an oval reaching out along the camera's way as far as the ground still covers the line (+3 m, eased) and 5.5 m across
//           it: what stands in it higher than his feet goes, the near rim and the ground between him and the camera with what grows
//           there, while what is behind him (the far wall) and everything off to the sides stands; the composite lays the cut earth
//           flat at his level where it was sawn open (render/cut.js CAP)
//           UNDER A ROOF (in the hut, or its roof over the line): a CAPSULE round him (R m out, H m tall): the roof and the front wall
//           open round him, the rest of the hut stands
// CONTRACT (main.js FEATURE CONTRACT): create(host) -> F with frame(f); F.on / F.toggle() (in the menu as "Cutaway"), ?cut=0 starts off.
//   F.open 0..1 (how open the cut is), F.mode 0 none / 1 well / 2 capsule, F.debug 'open .. · mode ..'
// host: G (setCut), player (x, y, z: m, z his feet's height), yaw, elev, PPMY, PPMH
import {flags} from '../core/flags.js';
import {HUT} from '../world/layout.js';

const R = 2.2, H = 1.8;        // the capsule's radius round him (m) and his height (m)
const WELL = 7, WELL_MAX = 24;  // how far the well reaches toward the camera (m): at least, at most (it widens from him as it opens)
const DEEP = 2.5;              // the ground over the camera's line counts only this much over his feet (m): a wall, not a bump or a slope
const GROWN = 7;               // m: the trees on the ground over the line (the well reaches out past them too)
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
  // what is over the camera's line from his middle (x, y, z)? 0 nothing, 1 the ground (DEEP m over his feet: a wall, not a bump), 2 the
  // hut's roof (or he is in the hut). OUT: how far out (level m) the ground still covers the line, plus a margin: how far the well reaches
  let OUT = 0;
  function cover(x, y, feet, z) {
    if (HUT && x > HUT.x0 && x < HUT.x1 && y > HUT.y0 && y < HUT.y1) return 2;
    const yaw = host.yaw, dx = Math.sin(yaw) * KH, dy = Math.cos(yaw) * KH;
    let hit = false, last = 0;
    for (let s = STEP; s <= LOOK; s += STEP) {
      const px = x + dx * s, py = y + dy * s, pz = z + KU * s;
      if (roof && px > roof.x0 && px < roof.x1 && py > roof.y0 && py < roof.y1 && pz > roof.z0 && pz < roof.z1) return 2;
      const g = host.elev(px, py);
      if (g <= feet + DEEP) continue;
      if (g > pz - .6) { hit = true; last = s; }
      else if (g + GROWN > pz) last = s;   // (what grows up there, a tree on the rim, can still hide him)
    }
    OUT = Math.min(WELL_MAX, Math.max(WELL, last * KH + 3));
    return hit ? 1 : 0;
  }
  // (the looks are asked every few frames, not every one: host.elev allocates a little per call, the answers change slowly)
  let c = 0, tick = 0, out = WELL;
  F.frame = f => {
    if (!G.setCut) return;
    const p = host.player, dt = Math.min(.1, f?.dt || 1 / 60), t = tick++;
    if (t % 3 === 0) c = cover(p.x, p.y, p.z || 0, (p.z || 0) + H * .55);
    if (c && c !== F.mode) { if (F.open > 0 && F.mode) F.open = Math.min(F.open, .2); F.mode = c; if (c === 1) out = OUT; }   // (a new shape opens from small)
    if (c === 1) out += (OUT - out) * Math.min(1, dt * 4);
    F.open += ((c ? 1 : 0) - F.open) * Math.min(1, dt * EASE);
    if (F.open < .01 && !c) { F.open = 0; F.mode = 0; }
    G.setCut(p.x, p.z || 0, p.y, F.open, R, H, F.mode === 1 ? out : 0, Math.sin(host.yaw), Math.cos(host.yaw));
  };
  return F;
}
