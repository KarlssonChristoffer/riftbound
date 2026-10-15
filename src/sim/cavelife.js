// CAVE LIFE (the rules): the soot things (docs/CAVELIFE.md), as plain logic both sides run: the co-op server (server/room.mjs:
// one flock for everyone, like the night elk) and the game offline (features/cavelife.js: the same rules, one player). Pure: no
// DOM, no game state; their roosts come from the cave's plan (world/caves.js C.soot), the players as [{id, x, y, z, lit}], the
// lights they shun as [{x, y}] (Crystal Lamps and burning fires).
//   Each thing ROOSTS (hangs over its roost, fluttering), SEEKS a lit lantern it sees (within SOOT.see m of it, never farther than
//   SOOT.leash m from home, never into a lamp's light), CIRCLES the lantern-bearer's head SOOT.circle s and puts the lantern out
//   (an event), then goes BACK home and rests SOOT.cool s. A lamp's light (SOOT.lamp m) sends it back at once. They fly straight
//   (soot-black over the dark rock, a short way through it shows nothing).
//   const S = createSoot(C, R, n); S.step(dt, players, lamps) -> events [{a: 'snuff', id}]; S.things [{x, y, h, mode, tid}];
//   S.rows(out) -> out: [x, y, h, mode] a thing, flat (the server's snapshot 'sn')
// OWNS: the soot things' state (in whoever runs them). READS: the plan's roosts, the players, the lamps.
import {SOOT} from '../content/cavelife.js';

export const MODES = ['roost', 'seek', 'circle', 'back'];
const TAU = Math.PI * 2;

// n: how many (the roosts' count by default; more share the roosts)
export function createSoot(C, R, n) {
  const roosts = C?.soot || [], want = Math.max(0, Math.min(16, n ?? roosts.length)), things = [], ev = [];
  for (let i = 0; i < want && roosts.length; i++) {
    const r = roosts[i % roosts.length], j = i >= roosts.length ? 1 : 0, hx = r.x + j * (R() - .5) * 1.2, hy = r.y + j * (R() - .5) * 1.2;
    things.push({i, hx, hy, hz: r.h + SOOT.roost, x: hx, y: hy, h: r.h + SOOT.roost, mode: 0, tid: -1, t: 0, cool: 0, a: R() * TAU, w: .8 + R() * .5});
  }
  const lit = (p, lamps) => { if (!p.lit) return false; for (const L of lamps) if (Math.hypot(L.x - p.x, L.y - p.y) < SOOT.lamp) return false; return true; };
  const inLamp = (x, y, lamps) => { for (const L of lamps) if (Math.hypot(L.x - x, L.y - y) < SOOT.lamp) return true; return false; };
  const find = (players, id) => { for (const p of players) if (p.id === id) return p; return null; };
  function fly(s, x, y, h, v, dt) {   // straight at (x, y, h), v m/s -> the distance left (over the ground)
    const dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy), st = Math.min(d, v * dt);
    if (d > 1e-6) { s.x += dx / d * st; s.y += dy / d * st; }
    s.h += (h - s.h) * Math.min(1, dt * 3);
    return d - st;
  }
  const S = {
    things,
    step(dt, players, lamps) {
      ev.length = 0;
      for (const s of things) {
        s.a += dt * TAU * s.w;
        if (s.cool > 0) s.cool -= dt;
        if (s.mode !== 3 && s.mode !== 0 && inLamp(s.x, s.y, lamps)) { s.mode = 3; s.tid = -1; s.cool = Math.max(s.cool, 4); }   // (a lamp's light: away, a while)
        if (s.mode === 0) {   // ROOST: hanging over home, waiting for a light
          fly(s, s.hx + Math.cos(s.a * .37) * .12, s.hy + Math.sin(s.a * .29) * .12, s.hz, 1, dt);
          if (s.cool > 0) continue;
          let best = null, bd = SOOT.see;
          for (const p of players) {
            const d = Math.hypot(p.x - s.x, p.y - s.y);
            if (d < bd && Math.hypot(p.x - s.hx, p.y - s.hy) < SOOT.leash && lit(p, lamps)) { bd = d; best = p; }
          }
          if (best) { s.mode = 1; s.tid = best.id; }
        } else if (s.mode === 1 || s.mode === 2) {   // SEEK / CIRCLE: the lantern; out of reach, dark or in a lamp's light: back
          const p = find(players, s.tid);
          if (!p || !lit(p, lamps) || Math.hypot(p.x - s.hx, p.y - s.hy) > SOOT.leash) { s.mode = 3; s.tid = -1; s.cool = Math.max(s.cool, 2); continue; }
          if (s.mode === 1) { if (fly(s, p.x, p.y, p.z + SOOT.h, SOOT.seek, dt) < SOOT.ring + .25) { s.mode = 2; s.t = 0; } continue; }
          s.t += dt;
          fly(s, p.x + Math.cos(s.a * .5) * SOOT.ring, p.y + Math.sin(s.a * .5) * SOOT.ring, p.z + SOOT.h + Math.sin(s.a) * .12, SOOT.seek * 1.6, dt);
          if (s.t >= SOOT.circle) { ev.push({a: 'snuff', id: p.id}); s.mode = 3; s.tid = -1; s.cool = SOOT.cool; }
        } else if (fly(s, s.hx, s.hy, s.hz, SOOT.back, dt) < .05) s.mode = 0;   // BACK home
      }
      return ev;
    },
    rows(out) {
      out.length = 0;
      for (const s of things) out.push(+s.x.toFixed(2), +s.y.toFixed(2), +s.h.toFixed(2), s.mode);
      return out;
    },
  };
  return S;
}
