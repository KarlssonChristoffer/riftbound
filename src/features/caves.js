// CAVES: going down into the woods' cave (world/caves.js plans it, world/cave3d.js draws it; docs/CAVES.md).
//   SIM    update: where he is along the mouth's slot (C.slotAt). Past `warp` m down it in the woods he is moved by the cave's OFF onto
//          its copy over the cave (host.warp: as he is, moving or mid-jump, the camera with him: the same ground at the same height,
//          so only the world round him changes), and back past warp - hyst m in the copy. DOWN (in the
//          cave's band, or deep in the woods' slot) lights his lantern, a little wider (host.mods 'light.lantern' / 'light.lanternR')
//   VIEW   frame: F.under 0..1, how far the world above has gone dark round him: one curve along the slot, the same in both copies
//          (0 near its head, 1 past its foot in the cave; render/lighting.js turns the mood toward the cave's dark by it), so the step
//          changes no light. And the SINK: down the slot the surface crumbles away round him, the far first (host.G.setSink: render/
//          cut.js; the cave's meshes are kept), gone by the step, so the woods' copy of the slot and the cave's are the same picture
//          there (world/cave3d.js draws the woods' slot from the copy). By where he stands, not by time: turning back undoes it.
//          features/cutaway.js stays shut under (the cave's walls have their own way: cave3d.js leaves out the ones in front of him)
// MULTIPLAYER: the cave is everyone's (grown from the session's seed); each player's warp is his own move (co-op sends where he is:
//   the others see him walk down the slot and on in the cave), the dark is each player's own view
// OWNS: its mods' notes, F.under, F.down.  READS: host.world.cave, host.player, host.P (his state).  EMITS: player.warp.
// BUDGET: a few compares a step, an ease a frame. No allocation per step or frame.
import {smooth, clamp} from '../core/mathx.js';

const DARK0 = 2;       // m down the slot where the light starts to go (either copy)
const DARK1 = 4;       // m past the warp (in the cave's copy) where it is all dark
const LANTERN_AT = 4;  // m down the slot where his lantern comes on
const LANTERN_R = 2;   // x the lantern's reach down there
const EASE = 10;       // 1/s
const SINK0 = .5;      // m down the woods' slot where the surface starts to sink away
const SINK_PAST = 5;   // m past the view's farthest corner where it starts (any screen shape: ultra-wide too); it closes in evenly as he walks
const NOWARP = new Set(['rope', 'climb', 'mantle']);   // (a move that places him itself: the warp waits until it ends)

export const order = {};
export async function create(host) {
  const F = {name: 'caves', label: 'Caves', on: true, under: 0, down: false, get debug() { return `under ${F.under.toFixed(2)}${F.down ? ' · down' : ''}`; }};
  const C = () => host.world.cave;
  const SQ = [0, 0, 0];
  let target = 0, jumped = false;
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
    target = SQ[2] ? smooth(clamp((SQ[0] - DARK0) / (M.warp + DARK1 - DARK0), 0, 1)) : inBand ? 1 : 0;
    const down = inBand || (SQ[2] === 1 && SQ[0] > LANTERN_AT);
    if (down !== F.down) {
      F.down = down;
      if (down) host.mods.set('caves', [{stat: 'light.lantern', add: 1}, {stat: 'light.lanternR', mul: LANTERN_R}]);
      else host.mods.clear('caves');
    }
  };
  function warp(dx, dy, down) {
    host.warp(dx, dy); jumped = true;
    const p = host.player; host.events.push({type: 'player.warp', x: p.x, y: p.y, dx, dy, down});
  }
  F.frame = f => {
    const dt = Math.min(.1, f?.dt || 1 / 60), c = C();
    if (jumped) { jumped = false; F.under = target; }   // (the step: the same light both sides; no ease lag across it)
    else F.under += (target - F.under) * (1 - Math.exp(-dt * EASE));
    if (Math.abs(target - F.under) < 1e-3) F.under = target;
    const G = host.G; if (!G?.setSink) return;
    const p = host.player; if (c) c.slotAt(p.x, p.y, SQ);
    if (c && c.inBand(p.x, p.y)) { G.setSink(p.x, p.y, -1e3, c.band); return; }   // (in the cave: nothing past its band, as at the step)
    if (!c || SQ[2] !== 1 || SQ[0] < SINK0) { G.setSink(0, 0, null); return; }
    // (gone by warp - hyst: where a step back up out of the cave lands him, so coming up looks as going down did)
    const k = clamp((SQ[0] - SINK0) / (c.mouth.warp - c.mouth.hyst - SINK0), 0, 1);
    const r0 = Math.hypot(host.VW / host.PPM, host.VH / host.PPMY) / 2 + SINK_PAST;   // (the view's half-diagonal on the ground: VW / VH are what shows, any zoom)
    G.setSink(p.x, p.y, r0 * (1 - k) - 6 * k, c.band);
  };
  F.biomeChanged = () => { target = 0; F.under = 0; host.G?.setSink?.(0, 0, null); if (F.down) { F.down = false; host.mods.clear('caves'); } };
  return F;
}
