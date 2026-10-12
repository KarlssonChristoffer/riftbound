// CUTAWAY (3D): when something stands between the camera and the player, the renderer cuts it away round him (gfx.js CUT), so he and
// what lies behind him show for real instead of his x-ray outline: the near rim over a gorge's floor, a hut's roof and front wall over
// its inside. SHOW ONLY: nothing here changes how the game plays (the shadows keep the whole world: the gorge stays in its rim's shade).
//   when    every frame it looks back along the camera's line from his middle (the view's oblique line: up PPMY, back PPMH per step)
//           and asks the ground (host.elev) and the hut's roof (layout.js HUT) whether anything is over that line; then the cut
//           OPENS (eased in, ~.12 s) and closes again (eased out) once the line is clear. Standing under the hut's roof counts too
//   what    G.setCut: the capsule round him on screen (R m out, H m tall), what lies nearer the camera than him and higher than his
//           feet (gfx.js CUT): the ground he stands on and everything behind him stay
// CONTRACT (main.js FEATURE CONTRACT): create(host) -> F with frame(f); F.on / F.toggle() (in the menu as "Cutaway"), ?cut=0 starts off.
//   F.open 0..1 (how open the cut is), F.debug 'open .. · hidden ..'
// host: G (setCut), player (x, y, z: m, z his feet's height), yaw, elev, PPMY, PPMH
import {flags} from '../core/flags.js';
import {HUT} from '../world/layout.js';

const R = 2.2, H = 1.8;        // the cut's radius round him (m) and his height (m)
const LOOK = 34, STEP = .5;    // how far back along the camera's line it looks (m) and the step (m)
const EASE = 9;                // 1/s: how fast the cut opens and closes

// ORDER (core/features.js): frame only: no update
export const order = {};
export async function create(host) {
  const G = host.G, Nn = Math.hypot(host.PPMY, host.PPMH), KU = host.PPMY / Nn, KH = host.PPMH / Nn;   // (the camera's line: up, back)
  const roof = HUT && HUT.roofY !== null ? {x0: HUT.x0 - HUT.d / 2 - HUT.over, x1: HUT.x1 + HUT.d / 2 + HUT.over, y0: HUT.y0 - HUT.d / 2 - HUT.over, y1: HUT.y1 + HUT.d / 2 + HUT.over, z0: HUT.roofY - .05, z1: HUT.roofY + .7} : null;
  const F = {name: 'cutaway', on: flags.get('cut') !== '0', open: 0, hidden: false, get debug() { return `open ${F.open.toFixed(2)} · hidden ${F.hidden ? 1 : 0}`; }};
  F.toggle = () => { F.on = !F.on; if (!F.on) { F.open = 0; G.setCut?.(0, 0, 0, 0); } };
  // is anything over the camera's line from (x, y, z)? the ground, or the hut's roof (or he is in the hut)
  function hidden(x, y, z) {
    if (HUT && x > HUT.x0 && x < HUT.x1 && y > HUT.y0 && y < HUT.y1) return true;   // (inside the hut: its roof and front wall)
    const yaw = host.yaw, dx = Math.sin(yaw) * KH, dy = Math.cos(yaw) * KH;
    for (let s = STEP; s <= LOOK; s += STEP) {
      const px = x + dx * s, py = y + dy * s, pz = z + KU * s;
      if (host.elev(px, py) > pz) return true;
      if (roof && px > roof.x0 && px < roof.x1 && py > roof.y0 && py < roof.y1 && pz > roof.z0 && pz < roof.z1) return true;
    }
    return false;
  }
  F.frame = f => {
    if (!G.setCut) return;
    const p = host.player, dt = Math.min(.1, f?.dt || 1 / 60);
    F.hidden = hidden(p.x, p.y, (p.z || 0) + H * .55);
    F.open += ((F.hidden ? 1 : 0) - F.open) * Math.min(1, dt * EASE);
    if (F.open < .01 && !F.hidden) F.open = 0;
    G.setCut(p.x, p.z || 0, p.y, F.open, R, H);
  };
  return F;
}
