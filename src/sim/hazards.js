// HAZARDS (sim): telegraphed damaging zones on the ground, a small kit any feature can own (features/affixes.js is the
// first: Blazing's burning ground, Glacial's frost nova, Overloaded's lightning). Its look is view/hazards.js.
// A HAZARD is a circle on the ground. It WARNS for `warn` s (the telegraph: the look closes a ring in on the moment it
// goes off), then
//   - it GOES OFF once: damage `dmg`, a knock outward, a slow, to the player if he stands within r (+ his body) at its
//     level; 'hazard.burst' says where (the look's flash, sounds), and the owner's onBurst(h) runs (lighting props, ...)
//   - and, with last > 0, it LINGERS for `last` s: while he stands in it (feet on the ground: not in a leap, a fall, a
//     climb) it hurts dps x tick every `tick` s. One clock per kit: overlapping patches don't stack.
// THE PLAYER CAN BE HIT only when the rest of the game lets him: never while the game's core.immune says so (a dodge roll,
// the Nimble window after one, the hurt flicker, travel, the run over), nor while dodging (P.untouchable: the sandbox too)
// or flickering after a hit (P.blink). A hit is the same as a brute's: player.hurt {dmg, by} (the game takes the health
// and starts the flicker), player.hit for a blow (the hit sound, music), host.knock. A SLOW is one timed host.mods note on
// 'player.speed' under the kit's own source (`<name>.slow`): the strongest running wins, it ends by itself.
// SIM ONLY: fixed steps, no random draws (the owner places them), no drawing; deterministic. Allocation-free per step
// (pooled records and event payloads; a slow's note is set on change only).
// OWNS: the records, the linger clock, the slow note ('<name>.slow'). READS: host.player, the combat core's immune().
// EMITS: player.hurt, player.hit, hazard.burst (core/events.js).
//
//   const H = createHazards(host, {name: 'affixes', cap: 64})
//   H.add({x, y, z?, r, warn, last?, dps?, tick?, dmg?, knock?, slow?: {mul, dur}, by?, style?, col?, data?}) -> the record,
//     or null when the kit is full. style: a look ('fire' | 'frost' | 'strike' | 'blast' | 'ring': view/hazards.js);
//     col: its colour ('#rrggbb'); by: who it hurts in the name of (player.hurt's by); data: the owner's, kept as given
//   H.update(dt)        SIM: age, go off, linger, end
//   H.hurt(dmg, by)     the owner's own damage to the player through the same rules (a drain beam): true if it landed
//   H.slow(mul, dur)    a slow from elsewhere (an affix's chilling blow): the same note
//   H.canHit()          may the player be hit now
//   H.clear()           every hazard gone, the slow dropped (a new stage, the owner switched off)
//   H.list / H.n        the live records (0 .. n-1; swap-removed, so no index is kept across steps); H.slowK (0..1 how
//                       slowed he is now: a look), H.slowT (s left)
//   H.onBurst = h => {} the owner's hook as one goes off
// A record: {x, y, z, r, warn, last, t (s since it was placed), dps, tick, dmg, knock, slowMul, slowDur, by, style, col,
//   data, id, fired (it went off)}. Its events carry src: the kit's name (the look picks its own bursts out by it).
// BUDGET: ~.01 ms a step with a few dozen.

import {TERRAIN_ON} from '../world/layout.js';
import {throwOf} from './player/launch.js';   // a blast's throw (by how close he stood)
const AIR = new Set(['leap', 'fall', 'climb', 'splash', 'swim']);   // (swim: in the water, out of a ground zone's reach)
const BODY = .25;   // the player's body radius (sim/player/adapter.js R_BODY): a zone reaches him at its edge

export function createHazards(host, {name = 'hazards', cap = 64} = {}) {
  const P = host.player, events = host.events, SRC = name + '.slow';
  const list = [];
  for (let i = 0; i < cap; i++) list.push({x: 0, y: 0, z: 0, r: 0, warn: 0, last: 0, t: 0, dps: 0, tick: .5, dmg: 0, knock: 0, slowMul: 1, slowDur: 0,
    by: null, style: '', col: '', data: null, id: 0, fired: false});
  let n = 0, nextId = 1, lingerT = 0, slowT = 0, slowMul = 1, noteMul = 1, core = null;
  // event payloads: a ring of one shape (a payload lives for its step: core/events.js)
  const RING = 64, ring = [];
  for (let i = 0; i < RING; i++) ring.push({type: '', src: name, x: 0, y: 0, z: 0, h: 0, r: 0, dmg: 0, by: null, vx: 0, vy: 0, player: false, style: '', col: '', data: null});
  let ri = 0;
  function emit(type, x, y, z) {
    const e = ring[ri]; ri = (ri + 1) % RING;
    e.type = type; e.x = x; e.y = y; e.z = z; e.h = z; e.r = 0; e.dmg = 0; e.by = null; e.vx = e.vy = 0; e.player = false; e.style = e.col = ''; e.data = null;
    events.push(e); return e;
  }

  function canHit() {
    core ??= host.feature('combat')?.core || null;
    return !(core?.immune?.()) && !P.untouchable && !((P.raw?.blink || 0) > 0);
  }
  function hurt(dmg, by) {
    if (dmg <= 0 || !canHit()) return false;
    const e = emit('player.hurt', P.x, P.y, P.z); e.dmg = Math.max(1, Math.round(dmg)); e.by = by;
    return true;
  }
  function slow(mul, dur) {
    if (!(mul < 1) || !(dur > 0)) return;
    slowMul = Math.min(slowMul, mul); slowT = Math.max(slowT, dur);
    if (slowMul !== noteMul) { noteMul = slowMul; host.mods?.set(SRC, [{stat: 'player.speed', mul: slowMul}]); }
  }
  function unslow() { slowT = 0; slowMul = 1; if (noteMul !== 1) { noteMul = 1; host.mods?.clear(SRC); } }

  // a zone goes off: everything at once to whoever stands in it
  function goOff(h) {
    const e = emit('hazard.burst', h.x, h.y, h.z); e.r = h.r; e.style = h.style; e.col = h.col; e.by = h.by; e.data = h.data;
    if ((h.dmg > 0 || h.knock > 0 || h.slowMul < 1) && P.state !== 'climb' && Math.abs(P.z - h.z) < 1.2) {
      const dx = P.x - h.x, dy = P.y - h.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < h.r + BODY && canHit()) {
        const ux = d > .05 ? dx / d : 0, uy = d > .05 ? dy / d : 1;
        const th = h.style === 'blast' ? throwOf(1 - d / (h.r + BODY)) : null;   // a burst close by THROWS him (sim/player/launch.js; a live loadout)
        if (h.knock > 0 && !(th && host.launch?.(ux * th[0], uy * th[0], th[1]))) host.knock(ux * h.knock, uy * h.knock);
        if (h.slowMul < 1) slow(h.slowMul, h.slowDur);
        if (h.dmg > 0) {
          const k = emit('player.hit', P.x, P.y, P.z); k.vx = ux * 4; k.vy = uy * 4; k.player = true;
          const u = emit('player.hurt', P.x, P.y, P.z); u.dmg = Math.max(1, Math.round(h.dmg)); u.by = h.by;
        }
      }
    }
    H.onBurst?.(h);
  }

  function remove(i) {
    const h = list[i], j = --n;
    if (i !== j) { list[i] = list[j]; list[j] = h; }
    h.by = null; h.data = null;
  }

  const H = {
    list, get n() { return n; }, get slowK() { return slowT > 0 ? 1 - slowMul : 0; }, get slowT() { return slowT; },
    onBurst: null, canHit, hurt, slow,
    add(o) {
      if (n >= cap) return null;
      const h = list[n++];
      h.x = o.x; h.y = o.y; h.z = o.z ?? host.elev(o.x, o.y); h.r = o.r; h.warn = o.warn ?? 0; h.last = o.last ?? 0; h.t = 0;
      h.dps = o.dps ?? 0; h.tick = o.tick ?? .5; h.dmg = o.dmg ?? 0; h.knock = o.knock ?? 0;
      h.slowMul = o.slow ? o.slow.mul : 1; h.slowDur = o.slow ? o.slow.dur : 0;
      h.by = o.by ?? null; h.style = o.style ?? 'ring'; h.col = o.col ?? '#ffffff'; h.data = o.data ?? null; h.id = nextId++; h.fired = false;
      return h;
    },
    update(dt) {
      if (slowT > 0 && (slowT -= dt) <= 0) unslow();
      lingerT = Math.max(0, lingerT - dt);
      const px = P.x, py = P.y, pz = P.z, grounded = !AIR.has(P.state);
      for (let i = 0; i < n; i++) {
        const h = list[i]; h.t += dt;
        if (!h.fired && h.t >= h.warn) { h.fired = true; goOff(h); }
        // (walkable terrain: a zone lies over sloping ground: on its feet on the ground under him, and that ground the zone's level)
        if (h.fired && h.last > 0 && h.dps > 0 && lingerT <= 0 && grounded && (TERRAIN_ON ? Math.abs(pz - host.elev(px, py)) < .35 && Math.abs(pz - h.z) < 1 : Math.abs(pz - h.z) < .35)) {
          const dx = px - h.x, dy = py - h.y, rr = h.r + BODY * .5;
          if (dx * dx + dy * dy < rr * rr && hurt(h.dps * h.tick, h.by)) lingerT = h.tick;
        }
        if (h.t >= h.warn + h.last) { remove(i); i--; }
      }
    },
    clear() { for (let i = 0; i < n; i++) { list[i].by = null; list[i].data = null; } n = 0; lingerT = 0; unslow(); },
  };
  return H;
}
