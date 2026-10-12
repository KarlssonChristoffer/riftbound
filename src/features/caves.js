// CAVES: going down into the woods' cave (world/caves.js plans it, world/cave3d.js draws it; docs/CAVES.md).
//   SIM    update: where he is along the mouth's slot (C.slotAt). Past `warp` m down it in the woods he is moved by the cave's OFF onto
//          its copy over the cave (host.warp: as he is, moving or mid-jump, the camera with him: the same ground at the same height,
//          so only the world round him changes, and that is dark by then), and back past warp - hyst m in the copy. DOWN (in the
//          cave's band, or deep in the woods' slot) lights his lantern, a little wider (host.mods 'light.lantern' / 'light.lanternR')
//   VIEW   frame: F.under 0..1, how far the world above has gone dark round him: 0 on the surface, rising down the slot, 1 in the cave,
//          eased. render/lighting.js turns the mood toward the cave's dark by it (no sun, no sky: the lights alone); features/
//          cutaway.js stays shut under (the cave's walls have their own way: cave3d.js leaves out the ones in front of him)
// MULTIPLAYER: the cave is everyone's (grown from the session's seed); each player's warp is his own move (co-op sends where he is:
//   the others see him walk down the slot and on in the cave), the dark is each player's own view
// OWNS: its mods' notes, F.under, F.down.  READS: host.world.cave, host.player, host.P (his state).  EMITS: player.warp.
// BUDGET: a few compares a step, an ease a frame. No allocation per step or frame.
import {smooth, clamp} from '../core/mathx.js';

const DARK0 = 1.5;     // m down the slot (in the woods) where the world above starts to go dark
const DARK_W = .95;    // how dark it is at the warp (the rest at the step into the cave: the woods round him are all but gone by then)
const LANTERN_R = 1.6; // x the lantern's reach down there
const EASE = 5;        // 1/s
const NOWARP = new Set(['rope', 'climb', 'mantle']);   // (a move that places him itself: the warp waits until it ends)

export const order = {};
export async function create(host) {
  const F = {name: 'caves', label: 'Caves', on: true, under: 0, down: false, get debug() { return `under ${F.under.toFixed(2)}${F.down ? ' · down' : ''}`; }};
  const C = () => host.world.cave;
  const SQ = [0, 0, 0];
  let target = 0;
  F.update = () => {
    const c = C(); if (!c) { target = 0; return; }
    const M = c.mouth, p = host.player, x = p.x, y = p.y;
    c.slotAt(x, y, SQ);
    if (!NOWARP.has(host.P.state)) {
      if (SQ[2] === 1 && SQ[0] > M.warp && Math.abs(SQ[1]) < M.w / 2 + .3) warp(c.off[0], c.off[1], true);
      else if (SQ[2] === 2 && SQ[0] < M.warp - M.hyst) warp(-c.off[0], -c.off[1], false);
    }
    c.slotAt(p.x, p.y, SQ);
    const inBand = c.inBand(p.x, p.y);
    target = SQ[2] === 1 ? DARK_W * smooth(clamp((SQ[0] - DARK0) / (M.warp - DARK0), 0, 1)) : inBand ? 1 : 0;
    const down = inBand || (SQ[2] === 1 && SQ[0] > DARK0 + 1);
    if (down !== F.down) {
      F.down = down;
      if (down) host.mods.set('caves', [{stat: 'light.lantern', add: 1}, {stat: 'light.lanternR', mul: LANTERN_R}]);
      else host.mods.clear('caves');
    }
  };
  function warp(dx, dy, down) {
    host.warp(dx, dy);
    const p = host.player; host.events.push({type: 'player.warp', x: p.x, y: p.y, dx, dy, down});
  }
  F.frame = f => {
    const dt = Math.min(.1, f?.dt || 1 / 60);
    F.under += (target - F.under) * (1 - Math.exp(-dt * EASE));
    if (Math.abs(target - F.under) < 1e-3) F.under = target;
  };
  F.biomeChanged = () => { target = 0; F.under = 0; if (F.down) { F.down = false; host.mods.clear('caves'); } };
  return F;
}
