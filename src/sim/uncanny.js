// UNCANNY (the rules): the forest's secrets and the night elk (docs/UNCANNY.md), as plain logic both sides run: the co-op server
// (server/room.mjs: it owns them in a shared world) and the game offline (features/uncanny.js: the same rules, one player).
// Pure: no DOM, no game state; the places and the clock come from the plan (world/uncanny.js), the players as [{id, x, y}].
//   SECRETS: each is sleeping (by day) / awake (at night) / triggered (the moment it opens, SEC.show s) / spent (for SEC.recharge
//   nights, then it sleeps again). Who opened it (by) and on which night (n) are kept, so a late joiner sees it spent.
//     heron    the ring where the heron stood: two players inside it together at night, for a moment (checked here, by tick)
//     stones   the quiet stones: one player in the middle, the lantern out, standing still a while (the client says so: ask)
//     marks    the hollow the pale marks lead to: reached with the lantern lit (the client says so: ask)
//   const S = createSecrets(U); S.tick(dt, t, players) -> changes [{id, s, by, n}]; S.ask(id, player, t) -> a change | why not
//   S.st (id -> {s, by, n}); S.toJSON() / S.load(o)
//   THE NIGHT ELK: by day it walks its way (U.elkAt: the same everywhere from the clock). As the night comes it grows wrong; at night
//   it STALKS whoever is in its patch: it keeps a distance behind them, slipping from trunk to trunk, and each time they stop it is
//   closer. Close enough and still: it LUNGES and knocks them down (they drop something: the client), then backs off for a while.
//   Out of its patch (or in the settlement's light) it lets them go and stands at its edge, staring. At dawn it walks back to its way.
//   const K = createStalker(U, R, {often}); K.step(dt, t, players) -> events [{a: 'knock', id, vx, vy}]; K {x, y, phi, mode, tid, D, k}
//   (often: how often it hunts, 1; 2 half the rest after a knock; 0 never)
// OWNS: the secrets' state and the elk's (in whoever runs them). READS: the plan, the clock, the players' places.
import {nightK, nightNo, dawning} from '../world/uncanny.js';

const TAU = Math.PI * 2;
export const SECRETS = {
  heron:  {need: 2, r: 1.5, hold: 2.5, keep: 'heron_feather'},   // r: the ring; hold: s two must stand in it together
  stones: {need: 1, r: 1.1, hold: 5, keep: 'warm_stone'},        // r: the middle; hold: s still in the dark (the client counts)
  marks:  {need: 1, r: 1.2, keep: 'bark_doll'},                  // r: from the doll in the hollow
};
export const SEC = {recharge: 3, show: 6, night: .9};   // nights a spent one sleeps; s a triggered one shows; nightK it wakes at
export const SECRET_IDS = Object.keys(SECRETS);
export const placeOf = (U, id) => id === 'heron' ? U.heron : id === 'stones' ? U.stones : id === 'marks' ? U.hollow : null;

export function createSecrets(U, o = {}) {
  const recharge = o.recharge ?? SEC.recharge, st = {}, changes = [];
  for (const id of SECRET_IDS) st[id] = {s: 'sleeping', by: [], n: -1000, t: 0};
  let ringT = 0;
  const set = (id, s, by, n) => { const q = st[id]; q.s = s; if (by) q.by = by; if (n !== undefined) q.n = n; if (s === 'triggered') q.t = SEC.show; const c = {id, s, by: q.by, n: q.n}; changes.push(c); return c; };
  const S = {
    st, get ringT() { return ringT; },
    tick(dt, t, players) {
      changes.length = 0;
      const n = nightNo(t), night = nightK(t) >= SEC.night;
      for (const id of SECRET_IDS) {
        const q = st[id]; if (!placeOf(U, id)) continue;
        if (q.s === 'triggered') { if ((q.t -= dt) <= 0) set(id, 'spent'); }
        else if (q.s === 'spent') { if (n - q.n >= recharge) set(id, night ? 'awake' : 'sleeping'); }
        else if (q.s === 'sleeping' && night) set(id, 'awake');
        else if (q.s === 'awake' && !night) set(id, 'sleeping');
      }
      // the heron's ring: two (or more) inside it together for a moment
      const H = U.heron;
      if (H && st.heron.s === 'awake') {
        let inside = 0; for (const p of players) if (Math.hypot(p.x - H.x, p.y - H.y) < SECRETS.heron.r) inside++;
        ringT = inside >= SECRETS.heron.need ? ringT + dt : 0;
        if (ringT >= SECRETS.heron.hold) { ringT = 0; set('heron', 'triggered', players.filter(p => Math.hypot(p.x - H.x, p.y - H.y) < SECRETS.heron.r).map(p => p.id), n); }
      } else ringT = 0;
      return changes;
    },
    // a player says a secret's own condition holds for them (the lantern out in the stones' middle, the doll reached by lantern light)
    ask(id, p, t) {
      const q = st[id], w = placeOf(U, id), D = SECRETS[id]; if (!q || !w) return 'no such secret';
      if (q.s !== 'awake') return q.s;
      if (D.need > 1) return 'it needs ' + D.need;
      if (Math.hypot(p.x - w.x, p.y - w.y) > D.r + .8) return 'too far';
      return set(id, 'triggered', [p.id], nightNo(t));
    },
    toJSON: () => Object.fromEntries(SECRET_IDS.map(id => [id, {s: st[id].s === 'triggered' ? 'spent' : st[id].s, by: st[id].by, n: st[id].n}])),
    load(o) { for (const id of SECRET_IDS) { const v = o?.[id]; if (v && typeof v.s === 'string') { st[id].s = v.s; st[id].by = Array.isArray(v.by) ? v.by : []; st[id].n = +v.n || -1000; } } },
  };
  return S;
}

// ---------------------------------------------------------------- the night elk
export const STALK = {
  dist: 13, step: 2.4, min: 2.6,   // m it keeps behind its quarry at first; how much closer each stop brings it; how close it gets
  still: .6, lunge: 1.4,           // s standing still that counts as a stop; s standing still that close before it lunges
  pace: 4.4, rush: 8, roam: .9,    // m/s: stalking, the lunge, wandering its patch
  home: 3.5,                       // m/s back to its day way at dawn
  knock: 6.5,                      // m/s it throws you
  cool: 40, back: 15,              // s after a knock before it comes again; m it backs off to
  edge: 6, light: 8,               // m past its patch's edge you are free; m round the settlement's clearing that is light
  hide: 2.4, behind: .75,          // a trunk within hide m of where it wants to be: it stands behind that (behind m past the trunk)
  stare: 7,                        // s it stands at its edge staring after one who got away
  dusk: .6,                        // nightK past which it hunts (before that it walks its way, growing wrong)
};
export const MODES = ['day', 'roam', 'stalk', 'lunge', 'back', 'stare', 'home'];

export function createStalker(U, R, o = {}) {
  const E = U.elk; if (!E) return null;
  const often = () => o.often ?? 1;   // (read each time: a live knob)
  const CL = U.F.clearing;
  const S = {x: E.x, y: E.y, phi: 0, mode: 'day', tid: -1, D: STALK.dist, k: 0, stareT: 0, cool: 0, sx: 0, sy: 0, roamA: R() * TAU};
  const seen = new Map();   // id -> {x, y, still, counted, t}
  const day = {x: 0, y: 0, phi: 0, back: false, moving: false, s: 0}, out = [];
  const moveTo = (x, y, v, dt) => { const dx = x - S.x, dy = y - S.y, d = Math.hypot(dx, dy); if (d < 1e-4) return 0; const s = Math.min(d, v * dt); S.x += dx / d * s; S.y += dy / d * s; return d - s; };
  const face = (a, dt, rate = 5) => { let d = a - S.phi; d -= Math.round(d / TAU) * TAU; S.phi += d * Math.min(1, dt * rate); };
  const faceTo = (x, y, dt, rate) => { if (Math.hypot(x - S.x, y - S.y) > .05) face(Math.atan2(x - S.x, y - S.y), dt, rate); };
  const inPatch = (p, m = 0) => Math.hypot(p.x - E.x, p.y - E.y) < E.r + m;
  const lit = p => Math.hypot(p.x - CL.x, p.y - CL.y) < CL.r + STALK.light;
  const byId = (players, id) => { for (const p of players) if (p.id === id) return p; return null; };
  let stamp = 0;
  S.step = (dt, t, players) => {
    out.length = 0; stamp++;
    for (const p of players) {   // who is standing still, and for how long
      let q = seen.get(p.id); if (!q) seen.set(p.id, q = {x: p.x, y: p.y, still: 0, counted: false, t: 0});
      const v = Math.hypot(p.x - q.x, p.y - q.y) / Math.max(dt, 1e-4); q.x = p.x; q.y = p.y; q.t = stamp;
      if (v < .35) q.still += dt; else { q.still = 0; q.counted = false; }
    }
    for (const [id, q] of seen) if (q.t !== stamp) seen.delete(id);
    const k = S.k = nightK(t);
    U.elkAt(t, day);
    // BY DAY (and while the dusk works on it): its way, the same for everyone
    if (k <= .02 || (!dawning(t) && k < STALK.dusk)) {
      S.mode = 'day'; S.x = day.x; S.y = day.y; S.phi = day.phi; S.tid = -1; S.D = STALK.dist; S.cool = 0; return out;
    }
    // DAWN: it walks back to where its way has got to
    if (dawning(t) && k < .97) {
      S.mode = 'home'; S.tid = -1;
      if (moveTo(day.x, day.y, STALK.home, dt) > .4) faceTo(day.x, day.y, dt, 4); else face(day.phi, dt, 2);
      return out;
    }
    // NIGHT
    if (S.cool > 0) S.cool -= dt;
    let p = S.tid >= 0 ? byId(players, S.tid) : null;
    if (S.tid >= 0 && !p) { S.tid = -1; S.mode = 'roam'; }
    if (p && (S.mode === 'stalk' || S.mode === 'lunge') && (lit(p) || !inPatch(p, STALK.edge))) {   // it lets them go: to its edge, staring
      const a = Math.atan2(p.y - E.y, p.x - E.x); S.sx = E.x + Math.cos(a) * E.r; S.sy = E.y + Math.sin(a) * E.r; S.mode = 'stare'; S.stareT = STALK.stare;
    }
    if (S.mode === 'day' || S.mode === 'home') S.mode = 'roam';
    if (S.mode === 'roam' && S.cool <= 0 && often() > 0) {   // a quarry: the nearest one in its patch, out of the light
      let best = null, bd = 34;
      for (const q of players) { if (!inPatch(q) || lit(q)) continue; const d = Math.hypot(q.x - S.x, q.y - S.y); if (d < bd) { bd = d; best = q; } }
      if (best) { S.tid = best.id; p = best; S.mode = 'stalk'; S.D = Math.max(STALK.min, Math.min(STALK.dist, bd)); }
    }
    switch (S.mode) {
      case 'roam': {   // it drifts round the middle of its patch, slowly, among the trunks
        S.roamA += dt * .05; const r = E.r * .35, x = E.x + Math.cos(S.roamA) * r, y = E.y + Math.sin(S.roamA) * r;
        if (moveTo(x, y, STALK.roam, dt) > .2) faceTo(x, y, dt, 2);
        break;
      }
      case 'stare': {
        S.stareT -= dt; moveTo(S.sx, S.sy, 1.4, dt);
        if (p) faceTo(p.x, p.y, dt, 3);
        if (S.stareT <= 0) { S.mode = 'roam'; S.tid = -1; }
        break;
      }
      case 'back': {   // after a knock: off to a distance, still watching
        if (p) { const dx = S.x - p.x, dy = S.y - p.y, d = Math.hypot(dx, dy) || 1; if (d < STALK.back) moveTo(p.x + dx / d * STALK.back, p.y + dy / d * STALK.back, 3, dt); faceTo(p.x, p.y, dt, 3); }
        if (S.cool <= 0) { S.mode = 'roam'; S.tid = -1; }
        break;
      }
      case 'stalk': {
        const q = seen.get(p.id);
        if (q.still > STALK.still && !q.counted) { q.counted = true; S.D = Math.max(STALK.min, S.D - STALK.step); }   // they stopped: closer
        let dx = S.x - p.x, dy = S.y - p.y; const d = Math.hypot(dx, dy); if (d > 1e-3) { dx /= d; dy /= d; } else { dx = 0; dy = 1; }
        let wx = p.x + dx * S.D, wy = p.y + dy * S.D;
        const tr = U.treeNear(wx, wy, STALK.hide, t);
        if (tr) { const ux = tr[0] - p.x, uy = tr[1] - p.y, ul = Math.hypot(ux, uy) || 1; wx = tr[0] + ux / ul * STALK.behind; wy = tr[1] + uy / ul * STALK.behind; }   // (behind the trunk, from them)
        moveTo(wx, wy, STALK.pace, dt); faceTo(p.x, p.y, dt, 4);
        if (S.D <= STALK.min + 1e-3 && q.still > STALK.lunge && d < S.D + 1.2) S.mode = 'lunge';
        break;
      }
      case 'lunge': {
        const left = moveTo(p.x, p.y, STALK.rush, dt); faceTo(p.x, p.y, dt, 8);
        if (left < 1.1) {
          let ux = p.x - S.x, uy = p.y - S.y; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
          out.push({a: 'knock', id: p.id, vx: +(ux * STALK.knock).toFixed(2), vy: +(uy * STALK.knock).toFixed(2)});
          S.mode = 'back'; S.cool = STALK.cool / Math.max(often(), .1); S.D = STALK.dist;
        } else if (left > STALK.min + 5) S.mode = 'stalk';   // (they got away from it: on with the stalk)
        break;
      }
    }
    return out;
  };
  S.events = out;
  // the state for the wire (server/room.mjs snapshots): [x, y, phi, mode, tid]
  S.row = () => [+S.x.toFixed(2), +S.y.toFixed(2), +S.phi.toFixed(3), MODES.indexOf(S.mode), S.tid];
  return S;
}
