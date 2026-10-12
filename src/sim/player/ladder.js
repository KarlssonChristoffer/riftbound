// THE LADDER under the player's control (docs/exp/ropeclimb.md): E at a ladder's foot or top starts player.js's 'climb' (as before,
// the camera eased to face it: sim/player/adapter.js); from then on this drives it: W up, S down, S + Shift slides down the rails,
// nothing held: he stays where he is; at the top W takes him over the lip, at the foot S steps him off, Space drops him off.
// ?ladder=old: player.js's own automatic climb. SIM: fixed steps, no random draws; the climb spot is player.js's (the view frame:
// valid while the camera faces the ladder).
// OWNS: L (the climb it has, its phase, the height on the rungs). While on: P's frame / face / want / state / y / z (+ vx / vy /
//   vz / fall0 when he drops off).
// READS: the keys, P.climb (player.js climbSpot), elev. EMITS: rope.step {kind: 'rung'} (a boot on a rung, every other rung),
//   player.land (the slide's end).
//   const ladder = createLadder({...internals, elev}); in the 'climb' state: if (ladder.step(dt)) return true
import {LADDER as T} from '../../content/ropewall.js';

export function createLadder(I) {
  const {P, A, H, has, ev, elev} = I;
  const {keys} = H;
  const L = {c: null, ph: '', t: 0, z: 0, H0: 0, Hh: 0, face: 0, top: 0, rung: 0, sp: false, sl: false};
  const frameAt = z => {
    const C = A.CLIP.climb; if (!has('climb.0')) return Math.floor(z / T.rung) % 2 ? 'reach_up' : 'idle.0';
    const n = C?.frames || 4; return 'climb.' + (Math.floor(z / T.rung * n / 2) % n + n) % n;   // (a cycle every two rungs)
  };
  function off(state) { L.c = null; L.ph = ''; P.state = state; P.t = 0; P.prevF = -1; }
  return {
    get on() { return !!L.c; },
    get ph() { return L.ph; }, get z() { return L.z; }, get slide() { return L.sl; },   // (the view: on the rungs, how high, sliding)
    step(dt) {
      if (H.ladderOld || P.state !== 'climb' || !P.climb) { L.c = null; return false; }
      const C = P.climb, c = C.c;
      if (L.c !== C) {   // a new climb: from the foot onto the rungs, or from the top over the lip and down onto them
        L.c = C; L.t = 0; L.face = c.y + .05; L.top = c.y - c.reach; L.Hh = c.h1;
        L.H0 = C.dir > 0 ? c.h0 : Math.min(c.h0, elev(c.x, L.face + .35));
        L.ph = C.dir > 0 ? 'on' : 'down'; L.z = C.dir > 0 ? L.H0 + .05 : L.Hh; L.rung = Math.floor(L.z / T.rung); L.sp = keys.has(' ');
      }
      const sp = keys.has(' '), spNow = sp && !L.sp; L.sp = sp;   // (Space: player.js onSpace is a no-op while he climbs)
      if (spNow && L.ph === 'on') { P.vx = 0; P.vy = 1.2; P.vz = 0; P.fall0 = P.z; off('fall'); return true; }   // he lets go and drops, out from the wall
      L.t += dt; P.vx = P.vy = 0; P.face = P.want = A.ND / 2;   // (the wall to the north: facing it)
      const mantleF = has('mantle.0') ? 'mantle.0' : 'crouch';
      if (L.ph === 'down') {   // over the lip, onto the rungs
        const k = Math.min(1, L.t / T.mantle); P.z = L.Hh; P.y = L.top + (L.face - L.top) * k; P.frame = mantleF;
        if (k >= 1) { L.ph = 'on'; L.t = 0; L.z = L.Hh - .4; }
        return true;
      }
      if (L.ph === 'up') {     // over the lip onto the top
        const k = Math.min(1, L.t / T.mantle); P.z = L.Hh; P.y = L.face + (L.top - L.face) * k; P.frame = mantleF;
        if (k >= 1) off('idle');
        return true;
      }
      // on the rungs
      const up = keys.has('w') || keys.has('arrowup'), down = keys.has('s') || keys.has('arrowdown'), slide = down && keys.has('shift');
      let dz = up && !down ? T.up * dt : down ? -(slide ? T.slide : T.down) * dt : 0;
      if (dz > 0 && L.z + dz >= L.Hh) { L.z = L.Hh; L.ph = 'up'; L.t = 0; P.y = L.face; P.z = L.Hh; P.frame = mantleF; return true; }
      if (dz < 0 && L.z + dz <= L.H0) {   // the foot: off the ladder, a step out from it
        P.z = L.H0; P.y = L.face + .35; P.face = P.want = 0; P.frame = 'idle.0';
        if (slide) ev({type: 'player.land', x: P.x, y: P.y, z: P.z});
        off('idle'); return true;
      }
      L.z += dz; P.y = L.face; P.z = L.z; L.sl = slide;
      const r = Math.floor(L.z / T.rung);
      if (r !== L.rung) { if (!slide && r % 2 === 0) ev({type: 'rope.step', x: P.x, y: P.y, z: P.z, kind: 'rung'}); L.rung = r; }
      P.frame = slide ? (has('reach_up') ? 'reach_up' : frameAt(L.z)) : frameAt(L.z);
      return true;
    },
  };
}
