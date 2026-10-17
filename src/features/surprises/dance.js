// THE RAIN DANCE (features/surprises.js; content/surprises.js DANCE): walk round the standing stones on the West Downs' hill
// (world/stonecircle.js SITE) DANCE.laps times without stopping and the sky answers: a storm rolls in (sim/env.js setWeather,
// eased), or, if it's already raining, the rain clears off. Each lap the stones hum (a ring of motes rises off the ring, the
// altar's glow swells); the last lap ends in a bolt onto the altar (features/weather.js boltAt: the flash and the crack only,
// no fire). The weather holds DANCE.hold s, then the clock's own comes back (only if nobody else has locked another since).
// SIM: the count (the angle he has gone round, unwrapped) and the lock. VIEW: the motes, the altar's glow.
// MULTIPLAYER: the weather is each player's own for now (co-op weather is parked), so the storm you dance up is yours to see
// and its bolts come from your own sky offline; online the server's lightning stays the server's.
import {DANCE} from '../../content/surprises.js';
import {SITE, STONES_ON} from '../../world/stonecircle.js';
import {WEST_ON} from '../../world/layout.js';
import {TAU, clamp} from '../../core/mathx.js';

const RAINY = new Set(['rain', 'storm', 'snow', 'blizzard']);

export function createDance(C) {
  const {host} = C, ON = STONES_ON && WEST_ON;
  let sum = 0, lastA = null, outT = 0, idleT = 0, best = 0, restT = 0, lockT = 0, locked = '', laps = 0;
  let pulse = 0, motesT = 0;   // (view: the altar's glow, s of motes left)
  const MOTE = Array.from({length: 64}, () => ({t: 9, x: 0, y: 0, h: 0, v: 0, life: 1}));
  let mi = 0;
  const V = C.V;

  function reset() { sum = 0; lastA = null; outT = 0; idleT = 0; best = 0; laps = 0; }
  function finish() {
    const env = host.env, P = host.player, wet = RAINY.has(env.weather);
    const w = wet ? 'clear' : 'storm';
    env.setWeather(w, wet ? DANCE.clearEase : DANCE.ease);
    locked = w; lockT = DANCE.hold; restT = DANCE.rest;
    host.events.push({type: 'dance.done', x: P.x, y: P.y, weather: w});
    C.toast(wet ? 'The stones hush the sky' : 'The sky answers', wet ? 'the rain moves off' : 'a storm is rolling in', wet ? '#f2d27a' : '#9cc8ff');
    if (!wet) host.feature('weather')?.boltAt?.(SITE.x, SITE.y, SITE.floor + .6);
    host.shake(wet ? 1 : 4, .35);
    reset();
  }
  function call(w) { host.env.setWeather(w, 2); locked = w; lockT = DANCE.hold; }   // (the dev rows: at once)

  return {
    update(dt) {
      if (!ON || !C.active()) return;
      if (lockT > 0 && (lockT -= dt) <= 0) {   // the called weather lets go (if it's still ours)
        if (host.env.weatherLock === locked) host.env.setWeather('', 30);
        locked = '';
      }
      if (restT > 0) { restT -= dt; reset(); return; }
      const P = host.player, dx = P.x - SITE.x, dy = P.y - SITE.y, d = Math.hypot(dx, dy);
      if (d < DANCE.band[0] || d > DANCE.band[1] || host.feature('caves')?.down) {
        if (lastA !== null && (outT += dt) > DANCE.lose) reset();
        if (d > DANCE.band[1]) lastA = null;
        return;
      }
      outT = 0;
      const a = Math.atan2(dy, dx);
      if (lastA !== null) { let da = a - lastA; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU; sum += da; }
      lastA = a;
      const n = Math.abs(sum);
      if (n > best + .05) { best = n; idleT = 0; } else if ((idleT += dt) > DANCE.idle) reset();
      if (Math.abs(sum) < best - Math.PI) { reset(); return; }   // (turned back half a lap: it starts over)
      const k = Math.floor(n / TAU);
      if (k > laps) {
        laps = k;
        host.events.push({type: 'dance.lap', x: P.x, y: P.y, n: laps, of: DANCE.laps});
        if (laps >= DANCE.laps) finish();
        else C.toast('The stones hum', `${laps} of ${DANCE.laps}`, '#cfe3a0');
      }
    },
    view(dt, evs) {
      if (!ON) return;
      for (const e of evs) if (e.type === 'dance.lap' || e.type === 'dance.done') { pulse = 1; motesT = e.type === 'dance.done' ? 2.5 : 1.2; }
      pulse = Math.max(0, pulse - dt * .5);
      if (motesT > 0) {   // motes rising off the ring of stones
        motesT -= dt;
        for (let j = 0; j < 3; j++) {
          const m = MOTE[mi = (mi + 1) % MOTE.length], a = V() * TAU;
          m.x = SITE.x + Math.cos(a) * SITE.rx * (.9 + V() * .25); m.y = SITE.y + Math.sin(a) * SITE.ry * (.9 + V() * .25);
          m.h = SITE.floor + V() * .5; m.v = .5 + V() * .9; m.t = 0; m.life = 1.6 + V() * 1.4;
        }
      }
      for (const m of MOTE) if (m.t < m.life) { m.t += dt; m.h += m.v * dt; }
    },
    frame() {
      if (!ON) return;
      for (const m of MOTE) if (m.t < m.life) host.point(m.x, m.y, m.h, m.t < m.life * .6 ? '#e6f4c8' : '#8fb070', C.PE);
      if (laps > 0 && !host.playerHidden) {   // while he dances: a faint wake of glints behind his heels
        const P = host.player; if (((performance.now() / 90) | 0) % 2) host.point(P.x, P.y, host.elev(P.x, P.y) + .05, '#cfe3a0', C.PE);
      }
    },
    lights(out, R) {
      if (!ON || (pulse <= 0 && laps === 0)) return;
      const r = R(); if (!r) return; r.x = SITE.x; r.y = SITE.y; r.h = SITE.floor + 1.2; r.color = '#bfe8a8';
      r.radius = 5 + 3 * pulse; r.intensity = clamp(.35 * laps / DANCE.laps + 1.4 * pulse, 0, 2); r.flicker = .2; out.push(r);
    },
    chip() { return laps > 0 && restT <= 0 ? {text: `Rain dance ${laps}/${DANCE.laps}`, col: '#cfe3a0'} : lockT > 0 && locked ? {text: `${locked === 'storm' ? 'Danced storm' : 'Danced sky'} ${C.mmss(lockT)}`, col: '#9cc8ff'} : null; },
    menu: () => !ON ? [] : [
      {label: 'Surprise: take me to the standing stones', run: () => host.teleport(SITE.x + SITE.rx + 1.5, SITE.y)},
      {label: 'Surprise: the rain dance, done (a storm)', run: () => call('storm')},
    ],
  };
}
