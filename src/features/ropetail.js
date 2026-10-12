// ROPE TAIL (docs/exp/ropeclimb.md): on the rope wall the rope runs on past his upper hand. The lasso's look draws it from the
// anchor to that hand (features/equip/lassolook.js); this draws the rest: down along his body to the brake hand at his hip, then the
// tail hanging from it down the face to the ground (a hand out from the stones), swaying a little as he moves along the face, and
// its loose end lying on the grass. Live loadouts only (the drawn rope hands: host.playerRopeHand), while sim/player/ropewall.js
// has him on a face or a free rope.
// VIEW ONLY: its shape is worked out each frame from the hands and the face (no physics: a pinned rope dragged up a wall flails).
// OWNS: the sway. READS: PL.ropewall (its technique and the face: px, py, nx, ny), the drawn rope hands, host.elev.
// BUDGET: ~30 lines a frame while on, nothing allocated.
import {ROPE} from '../content/lasso.js';
import {hex01} from '../core/color.js';

// (the lasso's rope first: it draws the anchor to the upper hand, this the hand onward)
export const order = {after: ['equip']};
const SEG = .16, OFF = .09, LIE = .55, SWAY = .14, TAU = .35;
const ON = new Set(['walk', 'swing', 'bound', 'free']), TWIST = [1, 0, 1, 2], C3 = ROPE.map(hex01);

export function create(host) {
  let S = null, h = null, sw = 0, lu = NaN;   // (S: the rope wall's state, h: the drawn rope hands; the sway and the last along)
  const F = {name: 'ropetail', on: true};
  function hands() {
    const R = host.PL?.ropewall; S = R?.active && host.P.state === 'rope' ? R.S : null;
    if (!S || !ON.has(S.tech)) return false;
    h = host.playerRopeHand?.() || null; return !!h;
  }
  // the sway: the hand's speed along the face, eased (it swings the hanging tail the other way)
  F.view = dt => {
    if (!hands() || !(dt > 0)) { lu = NaN; sw *= .9; return; }
    const u = (h.x - S.px) * -S.ny + (h.y - S.py) * S.nx, v = lu === lu ? (u - lu) / dt : 0; lu = u;
    sw += (Math.max(-2, Math.min(2, v)) - sw) * Math.min(1, dt / TAU);
  };
  F.frame = () => {
    if (!hands()) return;
    host.line(h.ux, h.uy, h.uh, h.x, h.y, h.h, C3[1], false);   // (the upper hand down to the brake hand: along his body)
    // the hanging part: from the brake hand down to the ground a hand out from the face, bowed by the sway (most at its middle)
    const fx = S.nx, fy = S.ny, ax = -S.ny, ay = S.nx;   // (out from the face; along it)
    const f0 = (h.x - S.px) * fx + (h.y - S.py) * fy, out = Math.max(OFF, Math.min(f0, OFF + .25));   // (it falls close to the stones)
    const bx = h.x + fx * (out - f0), by = h.y + fy * (out - f0), g = host.elev(bx, by) + .02, drop = Math.max(0, h.h - g);
    const n = Math.max(1, Math.min(48, Math.ceil(drop / SEG)));
    let px = h.x, py = h.y, ph = h.h;
    for (let i = 1; i <= n; i++) {
      const k = i / n, bow = Math.sin(Math.PI * k) * -sw * SWAY, e = Math.min(1, k * 3);   // (off the hand toward the stones in its first third)
      const x = h.x + (bx - h.x) * e + ax * bow, y = h.y + (by - h.y) * e + ay * bow, z = h.h - drop * k;
      host.line(px, py, ph, x, y, z, C3[TWIST[i & 3]], false); px = x; py = y; ph = z;
    }
    // the loose end on the ground: out from the foot of the face and curled a little along it
    for (let i = 1; i <= 4; i++) {
      const k = i / 4, x = bx + fx * LIE * k + ax * .18 * Math.sin(k * 2.4), y = by + fy * LIE * k + ay * .18 * Math.sin(k * 2.4);
      const z = host.elev(x, y) + .02;
      host.line(px, py, ph, x, y, z, C3[TWIST[(n + i) & 3]], false); px = x; py = y; ph = z;
    }
  };
  F.update = () => {};
  return F;
}
