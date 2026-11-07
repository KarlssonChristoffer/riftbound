// IT'S RAINING FISH (features/surprises.js; content/surprises.js FISHRAIN): in a real storm (the sky's storm over FISHRAIN.storm,
// out of the cave), now and then a fish the wind sucked out of some lake comes down out of the clouds near you, smacks into the
// ground and flops about, silver, until you pick it up (walk over it) or it flops off into the nearest puddle and is gone
// (FISHRAIN.life s). Mostly small fry; now and then something bigger.
// SIM: when one falls and where (this part's own generator), the ones lying, the pickup. VIEW: the fall (a silver streak), the
// flop (it hops about where it lies), the splat.
// MULTIPLAYER: your own storm's fish, into your own pouch (a shared shower would be the server's to drop).
import {FISHRAIN} from '../../content/surprises.js';
import {COMMON_FISH} from '../../content/fishing.js';
import {FOREST} from '../../world/layout.js';
import {TAU} from '../../core/mathx.js';

export function createFishRain(C) {
  const {host, R, V} = C;
  let nextT = FISHRAIN.every[1], fid = 0, got = 0;
  const lying = [], falling = [];   // lying {id, kind, x, y, h, t}; falling {id, kind, x, y, t}
  const SPLAT = Array.from({length: 40}, () => ({t: 9, life: 1, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0}));
  let si = 0;
  const stormy = () => (host.env?.sky?.storm ?? 0) > FISHRAIN.storm && !host.feature('caves')?.down;
  function spot(P) {
    for (let k = 0; k < 8; k++) {
      const a = R() * TAU, d = FISHRAIN.dist[0] + R() * (FISHRAIN.dist[1] - FISHRAIN.dist[0]), x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
      if (!host.inStream(x, y) && !host.blocked(x, y, host.elev(x, y) + .05) && !(FOREST?.inLake?.(x, y, .5))) return [x, y];
    }
    return null;
  }
  function drop(x, y) {
    if (lying.length + falling.length >= FISHRAIN.max) return;
    const kind = R() < FISHRAIN.big ? FISHRAIN.bigOnes[Math.floor(R() * FISHRAIN.bigOnes.length)] : COMMON_FISH[Math.floor(R() * COMMON_FISH.length)];
    falling.push({id: ++fid, kind, x, y, t: FISHRAIN.fall});
  }
  return {
    update(dt) {
      if (!C.active()) return;
      const P = host.player;
      if (stormy() && (nextT -= dt) <= 0) {
        nextT = FISHRAIN.every[0] + R() * (FISHRAIN.every[1] - FISHRAIN.every[0]);
        const n = 1 + (R() < FISHRAIN.pair ? 1 : 0);
        for (let i = 0; i < n; i++) { const at = spot(P); if (at) drop(at[0], at[1]); }
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i]; if ((f.t -= dt) > 0) continue;
        falling.splice(i, 1);
        lying.push({id: f.id, kind: f.kind, x: f.x, y: f.y, h: host.elev(f.x, f.y), t: 0});
        host.events.push({type: 'fishrain.land', x: f.x, y: f.y, id: f.kind});
      }
      for (let i = lying.length - 1; i >= 0; i--) {
        const f = lying[i]; f.t += dt;
        if (f.t > FISHRAIN.life) { lying.splice(i, 1); continue; }
        if (f.t < .4 || Math.hypot(f.x - P.x, f.y - P.y) > FISHRAIN.take || Math.abs(P.z - f.h) > 1.2) continue;
        lying.splice(i, 1);
        C.pack()?.give(f.kind, 1, {x: f.x, y: f.y, h: f.h + .5});
        if (got++ === 0) C.toast('It\'s raining fish', 'they fall out of the storm; grab them before they flop off', '#c8d8e0');
      }
    },
    view(dt, evs) {
      for (const e of evs) if (e.type === 'fishrain.land') for (let i = 0; i < 12; i++) {
        const s = SPLAT[si = (si + 1) % SPLAT.length], a = V() * TAU, v = .6 + V() * 1.6;
        s.x = e.x; s.y = e.y; s.h = host.elev(e.x, e.y) + .05; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v; s.vh = .8 + V() * 1.8; s.t = 0; s.life = .3 + V() * .4;
      }
      for (const s of SPLAT) if (s.t < s.life) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.h += s.vh * dt; s.vh -= 9 * dt; }
    },
    frame(f) {
      const t = f.t;
      for (const q of falling) {   // a silver streak coming down out of the clouds
        const k = 1 - q.t / FISHRAIN.fall, h0 = host.elev(q.x, q.y), hh = h0 + (1 - k) * (1 - k) * 22;
        for (let i = 0; i < 4; i++) host.point(q.x, q.y, hh + i * .25, i ? '#8fa4b0' : '#e8f0f4', C.PE);
      }
      for (const q of lying) {   // it flops: hops and turns where it lies, slower as it tires
        const tire = Math.max(.25, 1 - q.t / FISHRAIN.life), ph = t * 9 * tire + q.id, hop = Math.max(0, Math.sin(ph)) * .22 * tire, a = Math.sin(ph * .5) * 1.4;
        const cx = Math.cos(a) * .12, cy = Math.sin(a) * .12, z = q.h + .04 + hop;
        host.point(q.x - cx, q.y - cy, z, '#7a8a94', C.P1); host.point(q.x, q.y, z, '#d8e4ea', C.P1); host.point(q.x + cx, q.y + cy, z + .01, '#a8bac4', C.P1);
        host.point(q.x + cx * 1.9, q.y + cy * 1.9, z + .02 + Math.sin(ph * 2) * .04, '#5a6a74', C.P1);   // (the tail)
      }
      for (const s of SPLAT) if (s.t < s.life) host.point(s.x, s.y, s.h, '#9ab8d0', C.P1);
    },
    chip() { return lying.length ? {text: lying.length > 1 ? `${lying.length} fish flopping about` : 'A fish is flopping about', col: '#c8d8e0'} : null; },
    menu: () => [{label: 'Surprise: rain fish on me', run: () => C.queue(() => { for (let i = 0; i < 3; i++) { const at = spot(host.player); if (at) drop(at[0], at[1]); } })}],
  };
}
