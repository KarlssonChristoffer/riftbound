// FALLING STARS and THE STAR FRENZY (features/surprises.js; content/surprises.js STARS, FRENZY).
// On a clear night (env.part night, the sky's cloud under STARS.cloud, out of the cave) a shooting star crosses the sky every
// STARS.every s. Every STARS.landEvery-th (and the first of each night) doesn't burn out: it comes down near you (STARS.dist m off,
// on open ground) with a flash and a small scorched star, and leaves a STAR SHARD humming in it, lit, until the dawn melts it
// away. Walk over it and it's yours (content/items.js star_shard). In first person look up: they cross the sky over the trees.
// THE STAR FRENZY: carry a shard into the lake at night and the lake drinks it: the water lights up from below and for FRENZY.dur s
// every cast bites at once ('fish.lure' x FRENZY.lure, a little luck too: notes under 'starfrenzy', features/fishing.js reads them).
// SIM: when stars fall and where (this part's own generator), the shards lying, the pickup, the frenzy. VIEW: the streaks (the HD
// layer, screen space: the sky), the impact, the shard's glow, the lake's light.
// MULTIPLAYER: each player's own sky: the stars, the shards and the frenzy are personal finds (nobody can take your star). A shared
// shower everyone runs for would be the server's to own: a later step.
import {STARS, FRENZY} from '../../content/surprises.js';
import {FOREST} from '../../world/layout.js';
import {TAU, clamp, smooth} from '../../core/mathx.js';
import {flags} from '../../core/flags.js';

const NOW = flags.get('stars') === 'now';

export function createStars(C) {
  const {host} = C, R = C.R, V = C.V;
  let nextT = NOW ? 4 : STARS.every[0], n = 0, night = -1, frenzy = 0, fid = 0;
  const shards = [], falling = [];   // shards {id, x, y, h, t}; falling {id, x, y, t (s to impact)}
  // view
  const STREAK = Array.from({length: 5}, () => ({t: 9, dur: 1, x0: 0, y0: 0, dx: 0, dy: 0, land: 0, id: 0}));
  const BURST = Array.from({length: 80}, () => ({t: 9, life: 1, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0}));
  const SCORCH = [];   // {id, x, y, d: [x, y, h, ...]} (the scorched star round where one came down)
  const LAKE = Array.from({length: 48}, () => ({t: 9, life: 1, x: 0, y: 0, h: 0}));
  let bi = 0, li = 0, flashT = 9, flashX = 0, flashY = 0, lakeK = 0;
  const S0 = [0, 0, 0];

  const clearSky = () => { const E = host.env; return E.part === 'night' && (E.sky?.cloud ?? 0) < STARS.cloud && !host.feature('caves')?.down; };
  function spot(P) {
    for (let k = 0; k < 10; k++) {
      const a = R() * TAU, d = STARS.dist[0] + R() * (STARS.dist[1] - STARS.dist[0]), x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d, g = host.elev(x, y);
      if (!host.inStream(x, y) && !host.blocked(x, y, g + .05) && !(FOREST?.inLake?.(x, y, 1))) return [x, y];
    }
    return null;
  }
  function fall(x, y) {
    if (shards.length + falling.length >= STARS.max) return;
    const id = ++fid; falling.push({id, x, y, t: STARS.fall});
    host.events.push({type: 'star.fall', x, y, id, t: STARS.fall});
  }
  function startFrenzy() {
    const P = host.player; frenzy = FRENZY.dur;
    host.mods.set('starfrenzy', [{stat: 'fish.lure', mul: FRENZY.lure}, {stat: 'fish.luck', add: FRENZY.luck}]);
    host.events.push({type: 'star.frenzy', x: P.x, y: P.y, t: frenzy});
    C.toast('The lake drinks the star', 'every cast bites at once while it glows', '#7fe0ff');
  }
  function burst(x, y, h, k) {
    for (let i = 0; i < k; i++) {
      const b = BURST[bi = (bi + 1) % BURST.length], a = V() * TAU, s = .8 + V() * 3;
      b.x = x; b.y = y; b.h = h; b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s; b.vh = 1 + V() * 4; b.t = 0; b.life = .5 + V() * .9;
    }
  }

  return {
    update(dt) {
      if (!C.active()) return;
      const P = host.player, E = host.env;
      if (E.part === 'day' && shards.length) { for (const s of shards) host.events.push({type: 'star.fade', x: s.x, y: s.y, id: s.id}); shards.length = 0; }   // (the dawn melts them)
      if (E.part !== 'night') n = 0;
      // the sky
      if (clearSky()) {
        if (night !== E.day) { night = E.day; n = 0; if (!NOW) nextT = Math.min(nextT, 6 + R() * 10); }
        if ((nextT -= dt) <= 0) {
          nextT = STARS.every[0] + R() * (STARS.every[1] - STARS.every[0]);
          const land = n % STARS.landEvery === 0 || NOW; n++;
          const at = land ? spot(P) : null;
          if (at) fall(at[0], at[1]);
          else host.events.push({type: 'star.streak', x: P.x, y: P.y, a: R(), b: R()});
        }
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i]; if ((f.t -= dt) > 0) continue;
        falling.splice(i, 1);
        const h = host.elev(f.x, f.y); shards.push({id: f.id, x: f.x, y: f.y, h, t: 0});
        const d = Math.hypot(f.x - P.x, f.y - P.y);
        if (d < 25) host.shake(d < 10 ? 3 : 1.5, .3);
        host.events.push({type: 'star.land', x: f.x, y: f.y, id: f.id});
      }
      // the pickup
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i]; s.t += dt;
        if (s.t < .8 || Math.hypot(s.x - P.x, s.y - P.y) > STARS.take || Math.abs(P.z - s.h) > 1.2) continue;
        shards.splice(i, 1);
        C.pack()?.give(STARS.item, 1, {x: s.x, y: s.y, h: s.h + .5});
        host.events.push({type: 'star.take', x: s.x, y: s.y, id: s.id});
        C.toast('A star shard', 'still warm; it hums when you face the lake', '#cfe8ff');
      }
      // the frenzy
      if (frenzy > 0 && (frenzy -= dt) <= 0) { frenzy = 0; host.mods.clear('starfrenzy'); C.toast('The lake goes dark', 'the frenzy is over', '#7fa8c0'); }
      if (frenzy <= 0 && E.part === 'night' && FOREST?.inLake?.(P.x, P.y) && host.inStream(P.x, P.y) && (C.pack()?.count(STARS.item) || 0) > 0) {
        if (C.pack().take(STARS.item, 1)) startFrenzy();
      }
    },
    view(dt, evs) {
      for (const e of evs) {
        if (e.type === 'star.streak' || e.type === 'star.fall') {
          const s = STREAK.find(q => q.t >= q.dur) || STREAK[0];
          s.t = 0; s.land = e.type === 'star.fall' ? 1 : 0; s.id = e.id || 0;
          if (s.land) { s.dur = e.t; s.x0 = (V() - .5) * .5; s.y0 = 0; s.dx = e.x; s.dy = e.y; }
          else { s.dur = .7 + V() * .6; s.x0 = .1 + (e.a ?? V()) * .8; s.y0 = .04 + (e.b ?? V()) * .3; const a = (V() < .5 ? -1 : 1) * (.25 + V() * .5); s.dx = Math.cos(a) * (V() < .5 ? -1 : 1) * .35; s.dy = Math.abs(Math.sin(a)) * .2 + .05; }
        } else if (e.type === 'star.land') {
          const h = host.elev(e.x, e.y); burst(e.x, e.y, h + .1, 40); flashT = 0; flashX = e.x; flashY = e.y;
          const d = []; for (let i = 0; i < 70; i++) { const a = V() * TAU, r = Math.pow(V(), .7) * (i % 5 === 0 ? 1.6 : 1), x = e.x + Math.cos(a) * r, y = e.y + Math.sin(a) * r; d.push(x, y, host.elev(x, y) + .02); }
          SCORCH.push({id: e.id, x: e.x, y: e.y, d}); if (SCORCH.length > 6) SCORCH.shift();
        } else if (e.type === 'star.take' || e.type === 'star.fade') burst(e.x, e.y, host.elev(e.x, e.y) + .2, e.type === 'star.take' ? 24 : 10);
        else if (e.type === 'star.frenzy') lakeK = Math.max(lakeK, .01);
      }
      for (const s of STREAK) if (s.t < s.dur) s.t += dt;
      for (const b of BURST) if (b.t < b.life) { b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt; b.vh -= 6 * dt; b.vx *= .96; b.vy *= .96; }
      if (flashT < 1) flashT += dt;
      lakeK = frenzy > 0 ? Math.min(1, lakeK + dt / 3) : Math.max(0, lakeK - dt / 3);
      if (lakeK > 0) {   // light coming up through the water round him
        const P = host.player;
        for (let j = 0; j < 2; j++) {
          const a = V() * TAU, r = 1 + V() * 9, x = P.x + Math.cos(a) * r, y = P.y + Math.sin(a) * r;
          if (!FOREST?.inLake?.(x, y)) continue;
          const m = LAKE[li = (li + 1) % LAKE.length]; m.x = x; m.y = y; m.h = host.elev(x, y) + .03; m.t = 0; m.life = .6 + V() * 1.2;
        }
      }
      for (const m of LAKE) if (m.t < m.life) { m.t += dt; m.h += .25 * dt; }
    },
    frame(f) {
      const t = f.t;
      for (const s of shards) {   // the shard: a white heart, a cool halo turning round it, motes going up
        const tw = .5 + .5 * Math.sin(t * 5 + s.id);
        host.point(s.x, s.y, s.h + .18, '#ffffff', C.PE2);
        for (let i = 0; i < 4; i++) { const a = t * 1.6 + i * TAU / 4; host.point(s.x + Math.cos(a) * .28, s.y + Math.sin(a) * .28, s.h + .18 + Math.sin(a * 2) * .06, tw > .5 ? '#cfe8ff' : '#8fb8ff', C.PE); }
        const k = (t * .7 + s.id * .37) % 1; host.point(s.x, s.y, s.h + .3 + k * 1.4, k < .5 ? '#cfe8ff' : '#6a88c8', C.PE);
      }
      for (const q of SCORCH) {
        const live = shards.some(s => s.id === q.id);
        for (let i = 0; i < q.d.length; i += 3) host.point(q.d[i], q.d[i + 1], q.d[i + 2], live && i % 9 === 0 ? '#3a4a78' : '#1a1612', C.P1);
      }
      for (const b of BURST) if (b.t < b.life) host.point(b.x, b.y, b.h, b.t < b.life * .4 ? '#ffffff' : '#9cc0ff', C.PE);
      for (const m of LAKE) if (m.t < m.life) host.point(m.x, m.y, m.h, m.t < m.life * .5 ? '#bff4ff' : '#3fa8d0', C.PE);
    },
    hd(q, sc, u) {   // the streaks over the sky, in screen space (a landing one ends on the spot it comes down on)
      const W = q.canvas.width, H = q.canvas.height;
      for (const s of STREAK) {
        if (s.t >= s.dur) continue;
        const k = s.t / s.dur;
        let hx, hy, tx, ty;
        if (s.land) {
          const g = host.elev(s.dx, s.dy), p = host.G.toScreenInto(s.dx, g, s.dy, S0);
          if (p[0] < -1e4) continue;
          const ex = p[0] * sc, ey = p[1] * sc, sx = ex + s.x0 * W, sy = Math.min(-H * .05, ey - H);
          const e = smooth(k) * .25 + k * .75;
          hx = sx + (ex - sx) * e; hy = sy + (ey - sy) * e;
          tx = sx + (ex - sx) * Math.max(0, e - .18); ty = sy + (ey - sy) * Math.max(0, e - .18);
        } else {
          hx = (s.x0 + s.dx * k) * W; hy = (s.y0 + s.dy * k) * H;
          tx = (s.x0 + s.dx * Math.max(0, k - .3)) * W; ty = (s.y0 + s.dy * Math.max(0, k - .3)) * H;
        }
        const fade = s.land ? 1 : clamp(Math.min(k * 5, (1 - k) * 3), 0, 1), N = 22;
        for (let i = 0; i <= N; i++) {
          const a = i / N, x = Math.round((tx + (hx - tx) * a) / u) * u, y = Math.round((ty + (hy - ty) * a) / u) * u;
          q.globalAlpha = fade * a * a; q.fillStyle = a > .85 ? '#ffffff' : a > .5 ? '#cfe8ff' : '#7f9cd8';
          q.fillRect(x, y, u, u);
        }
        q.globalAlpha = fade; q.fillStyle = '#ffffff'; q.fillRect(Math.round(hx / u) * u - u, Math.round(hy / u) * u - u, 2 * u, 2 * u);
      }
      q.globalAlpha = 1;
    },
    lights(out, Rl) {
      const L = STARS.light;
      for (const s of shards) { const r = Rl(); if (!r) break; r.x = s.x; r.y = s.y; r.h = s.h + .6; r.color = L.color; r.radius = L.radius; r.intensity = L.intensity; r.flicker = L.flicker; out.push(r); }
      if (flashT < .5) { const r = Rl(); if (r) { r.x = flashX; r.y = flashY; r.h = host.elev(flashX, flashY) + 1.5; r.color = '#ffffff'; r.radius = 14; r.intensity = 3 * (1 - flashT / .5); r.flicker = 0; out.push(r); } }
      if (lakeK > 0) { const P = host.player, F = FRENZY.light, r = Rl(); if (r) { r.x = P.x; r.y = P.y; r.h = P.z + .2; r.color = F.color; r.radius = F.radius; r.intensity = F.intensity * lakeK; r.flicker = F.flicker; out.push(r); } }
    },
    chip() {
      if (frenzy > 0) return {text: `Star frenzy ${C.mmss(frenzy)}`, col: '#7fe0ff'};
      return shards.length ? {text: shards.length > 1 ? `${shards.length} fallen stars nearby` : 'A fallen star nearby', col: '#cfe8ff'} : null;
    },
    menu: () => [
      {label: 'Surprise: a star falls near me', run: () => C.queue(() => { const at = spot(host.player); if (at) fall(at[0], at[1]); })},
      {label: 'Surprise: give me a star shard', run: () => C.queue(() => C.pack()?.give(STARS.item, 1))},
      {label: 'Surprise: the star frenzy at the lake', run: () => C.queue(startFrenzy)},
      ...(FOREST?.lake ? [{label: 'Surprise: take me to the lake shore', run: () => { const L = FOREST.lake; host.teleport(L.x + L.rx + 2.5, L.y); }}] : []),
    ],
    dispose() { host.mods.clear('starfrenzy'); },
  };
}
