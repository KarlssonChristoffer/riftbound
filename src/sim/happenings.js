// HAPPENINGS (the rules; features/happenings.js, content/happenings.js, docs/WORLDLIFE.md "Happenings"): which of the forest's
// happenings come on which in-game day, where and when. A pure function of the world's SEED, its CLOCK (in-game hours, sim/env.js
// env.t: shared in co-op) and its weather schedule (sim/wxclock.js, itself a function of the two): every client works out the
// same falling star at the same spot at the same hour without a message, and a co-op server could run this very file (no DOM,
// no game state; imports only pure data and the pure basics).
//   day(D)          -> the happenings of in-game day D (cached): 0..MOST, each {id, kind, day, t0, t1, tEnd, x, y, seed, ...}
//                      t0 it starts, t1 its main part ends (the star's glow at dawn, the rainbow fades, the last vätte is gone),
//                      tEnd it is gone altogether (the star's scorch the next evening). The kinds' extras: the ring's night
//                      [n0, n1) (its lights dance), the vättar's path {xs, ys, L} and n (how many)
//   around(t, out)  -> every happening going on at hour t (out: a reused array), the forced ones too
//   force(kind, t, near?) -> a happening of that kind starting at t: near {x, y} (the dev menu's "now, near me": a spot 8 .. 16 m
//                      from it), else at its seeded spot for the day. Kept in this client only (a test: not shared)
//   walkerAt(h, i, t, out) -> the vättar's i-th little one at hour t: {x, y, hd, d (m along the path; < 0 not out yet, > L gone)}
// Conditions read the weather schedule (sim/wxclock.js createSchedule): a clear night for the star, rain the evening and night
// before for the ring, a rain spell ending by day (a dry one after it) for the rainbow. o.often: every kind every day, no
// conditions (?happen=often).
// OWNS: nothing at run time but its caches (the days worked out, the open-ground grid). READS: content/happenings.js, the forest
//   plan (world/forest.js: trees, water, rock, the lake, the blocks), sim/wxclock.js, core/mathx.js.
import {HAPPENINGS, KINDS, MOST, AREA} from '../content/happenings.js';
import {createSchedule, WEATHER, seasonAt, TUNE as WXT} from './wxclock.js';
import {hash3} from '../core/mathx.js';

const rngOf = seed => { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const mix = (seed, a, b = 0) => (hash3(seed | 0, a, b) * 4294967296) | 0;
const KI = k => KINDS.indexOf(k) + 1;

// the open-ground test from the plan: no trunk (or big rock) within `clear` m, no water near, no rock, not the settlement's clearing,
// not too steep. trees(x, y, r): how many trunks within r m (the openness score)
function groundOf(F) {
  const C = 4, x0 = AREA.x0 - 12, y0 = AREA.y0 - 12, w = Math.ceil((AREA.x1 - AREA.x0 + 24) / C), h = Math.ceil((AREA.y1 - AREA.y0 + 24) / C);
  const cells = Array.from({length: w * h}, () => []);
  const put = (x, y) => { const i = Math.floor((x - x0) / C), j = Math.floor((y - y0) / C); if (i >= 0 && j >= 0 && i < w && j < h) cells[j * w + i].push(x, y); };
  for (const t of F.trees.values()) put(t[0], t[1]);
  for (const p of F.props) if (p[0] === 'rock_big' || p[0] === 'tree') put(p[1], p[2]);
  const count = (x, y, r, stop = 1e9) => {
    let n = 0; const i0 = Math.floor((x - r - x0) / C), i1 = Math.floor((x + r - x0) / C), j0 = Math.floor((y - r - y0) / C), j1 = Math.floor((y + r - y0) / C);
    for (let j = Math.max(0, j0); j <= Math.min(h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(w - 1, i1); i++) {
      const c = cells[j * w + i]; for (let k = 0; k < c.length; k += 2) if (Math.hypot(c[k] - x, c[k + 1] - y) < r && ++n >= stop) return n;
    }
    return n;
  };
  const W = F.wet, wet = (x, y) => { if (!W) return false; const i = Math.floor(x) - W.x0, j = Math.floor(y) - W.y0; return i >= 0 && j >= 0 && i < W.w && j < W.h && W.d[j * W.w + i] === 1; };
  const slope = (x, y) => { const e = .6; return Math.hypot(F.height(x + e, y) - F.height(x - e, y), F.height(x, y + e) - F.height(x, y - e)) / (2 * e); };
  const ok = (x, y, clear) => {
    if (x < AREA.x0 || x > AREA.x1 || y < AREA.y0 || y > AREA.y1) return false;
    if (wet(x, y) || (F.inLake && F.inLake(x, y, 2.5))) return false;
    for (const o of F.outcrops) if (Math.hypot(o.x - x, o.y - y) < (o.r || 3) * 1.4 + 2) return false;
    if (F.boulders && Math.hypot(F.boulders.x - x, F.boulders.y - y) < F.boulders.r + 2.5) return false;
    if (F.clearing && Math.hypot(F.clearing.x - x, F.clearing.y - y) < F.clearing.r + 2) return false;
    if (F.cave?.mouth && Math.hypot(F.cave.mouth.x - x, F.cave.mouth.y - y) < 9) return false;
    if (slope(x, y) > .28) return false;
    return count(x, y, clear, 1) === 0;
  };
  return {ok, count};
}

export function createHappenings(F, seed, o = {}) {
  const days = new Map(), forced = [];
  const SCH = createSchedule(seed), seasonDays = o.seasonDays || WXT.seasonDays, precip = o.precip !== false, often = !!o.often;
  const G = F ? groundOf(F) : null;
  let nf = 0;
  // the spells over [h0, h1): [{w, t0, t1}] (walks forward: ask in order of time; a jump back starts the schedule over)
  function spells(h0, h1) {
    const out = []; let h = h0;
    for (let k = 0; k < 64 && h < h1; k++) { const s = SCH.at('ruins', h, seasonDays, precip); out.push({w: s.w, t0: s.t0, t1: s.t1}); h = s.t1 + 1e-6; }
    return out;
  }
  const rainy = w => !!WEATHER[w]?.rain;
  // a seeded open spot: tries candidates from R, keeps the best by score (lower better); null when none fits
  function spot(R, clear, score, tries = 40, near = null) {
    let best = null, bs = 1e9;
    for (let t = 0; t < tries; t++) {
      let x, y;
      if (near) { const a = R() * Math.PI * 2, d = near.r0 + R() * (near.r1 - near.r0); x = near.x + Math.cos(a) * d; y = near.y + Math.sin(a) * d; }
      else { x = AREA.x0 + R() * (AREA.x1 - AREA.x0); y = AREA.y0 + R() * (AREA.y1 - AREA.y0); }
      if (!G || !G.ok(x, y, clear)) continue;
      const s = score ? score(x, y) : R(); if (s < bs) { bs = s; best = {x: +x.toFixed(2), y: +y.toFixed(2)}; }
    }
    return best;
  }
  const starScore = (x, y) => Math.abs(G.count(x, y, 7) - 6);   // (a few trees round it to light)
  const ringScore = (x, y) => G.count(x, y, 5.5);   // (the most open: a glade)
  // the vättar's way: from a big boulder (a block) to the lake shore, a gentle wander; null without both
  function pathOf(R, near = null) {
    const blocks = F.outcrops.filter(b => b.kind === 'block'), L = F.lake;
    let b = null, ex, ey;
    if (near) {   // (now, near me: from a spot beside him toward the water, or on for 30 m)
      const a = R() * Math.PI * 2; b = {x: near.x + Math.cos(a) * 6, y: near.y + Math.sin(a) * 6, r: .3};
    } else {
      if (!L || !blocks.length) return null;
      const ok = blocks.filter(q => { const d = Math.hypot(q.x - L.x, q.y - L.y); return d > 18 && d < 75; });
      if (!ok.length) return null;
      b = ok[Math.floor(R() * ok.length)];
    }
    if (L && Math.hypot(b.x - L.x, b.y - L.y) < 80) {   // the shore: in from the boulder toward the lake's middle until the water, a step in
      const dx = L.x - b.x, dy = L.y - b.y, D = Math.hypot(dx, dy) || 1; let s = 0;
      for (; s < D; s += .25) if (F.inLake(b.x + dx / D * s, b.y + dy / D * s)) break;
      s = Math.min(D, s + 1.2); ex = b.x + dx / D * s; ey = b.y + dy / D * s;
    } else { const a = R() * Math.PI * 2; ex = b.x + Math.cos(a) * 30; ey = b.y + Math.sin(a) * 30; }
    // from the boulder's foot (its far side from the water: they come out of it), a wander of a couple of m either way
    const dx = ex - b.x, dy = ey - b.y, D = Math.hypot(dx, dy) || 1, ux = dx / D, uy = dy / D;
    const sx = b.x + ux * (b.r * .5), sy = b.y + uy * (b.r * .5), N = 28, xs = new Float64Array(N + 1), ys = new Float64Array(N + 1), ds = new Float64Array(N + 1);
    const w1 = R() * 6.28, w2 = R() * 6.28, a1 = 1.5 + R() * 1.5;
    for (let i = 0; i <= N; i++) {
      const k = i / N, x0 = sx + (ex - sx) * k, y0 = sy + (ey - sy) * k, wob = Math.sin(k * Math.PI) * (a1 * Math.sin(k * 7 + w1) + .8 * Math.sin(k * 17 + w2));
      xs[i] = x0 - uy * wob; ys[i] = y0 + ux * wob; if (i) ds[i] = ds[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    return {xs, ys, ds, L: ds[N], N, bx: b.x, by: b.y, br: b.r, ex, ey};
  }
  // one happening of a kind on day D (its conditions met: decided by the caller), at its seeded place and hour
  function make(kind, D, R, t0, near = null) {
    const T = HAPPENINGS[kind], h = {id: '', kind, day: D, t0, t1: t0, tEnd: t0, x: 0, y: 0, seed: mix(seed, 9100 + KI(kind), D)};
    if (kind === 'star') {
      const p = spot(R, 2.2, near ? null : starScore, 40, near); if (!p) return null; h.x = p.x; h.y = p.y;
      const dawn = Math.floor((t0 - 3) / 24) * 24 + 24 + T.glowTo;   // (the morning after the night it fell in)
      h.t1 = near ? Math.max(t0 + 4, dawn) : dawn; h.tEnd = Math.floor(h.t1 / 24) * 24 + T.scorchTo; if (h.tEnd < h.t1 + 2) h.tEnd += 24;
      h.ang = R() * Math.PI * 2;   // the way it came in from
    } else if (kind === 'ring') {
      const p = spot(R, T.r + 1.6, near ? null : ringScore, 50, near); if (!p) return null; h.x = p.x; h.y = p.y;
      h.t1 = h.tEnd = t0 + T.lasts;
      const d0 = Math.floor(t0 / 24) * 24; h.n0 = d0 + T.night[0]; h.n1 = d0 + T.night[1];
      if (near && !(t0 % 24 >= T.night[0] || t0 % 24 < 5.6)) { h.n0 = t0; }   // (now, near me, by day: its lights dance at once)
      if (near) { h.n0 = Math.min(h.n0, t0); h.n1 = Math.max(h.n1, t0 + 3); h.t1 = h.tEnd = Math.max(h.t1, h.n1); }
      h.count = 9 + Math.floor(R() * 4);
    } else if (kind === 'vattar') {
      const P = pathOf(R, near); if (!P) return null;
      h.path = P; h.n = T.n[0] + Math.floor(R() * (T.n[1] - T.n[0] + 1)); h.x = P.bx; h.y = P.by;
      h.t1 = h.tEnd = t0 + (P.L + (h.n - 1) * T.gap + 1.5) / T.v;
    } else if (kind === 'rainbow') {
      const p = spot(R, 1.2, null, 40, near); if (!p) return null; h.x = p.x; h.y = p.y;
      h.t1 = h.tEnd = t0 + T.lasts; h.side = R() < .5 ? -1 : 1;
    }
    return h;
  }
  // the day's happenings
  function day(D) {
    let L = days.get(D); if (L) return L;
    L = [];
    if (F) {
      const R = rngOf(mix(seed, 9001, D)), d0 = D * 24, season = seasonAt(d0 + 12, seasonDays);
      const sp = spells(d0 - 12, d0 + 30);   // (the evening before .. the night after)
      const at = h => { for (const s of sp) if (h >= s.t0 && h < s.t1) return s; return null; };
      const cand = [];
      for (const kind of KINDS) {
        const T = HAPPENINGS[kind], r = hash3(mix(seed, 9200 + KI(kind)), D, 1), u = hash3(mix(seed, 9300 + KI(kind)), D, 2);
        if (r >= (often ? 1 : T.chance)) continue;
        let t0 = d0 + T.hours[0] + u * (T.hours[1] - T.hours[0]);
        if (!often) {
          if (T.need === 'clear-night') { const s = at(t0); if (!s || (WEATHER[s.w]?.cloud ?? 1) > .35 || WEATHER[s.w]?.precip) continue; }
          else if (T.need === 'after-rain') { if (season === 'winter' || !sp.some(s => rainy(s.w) && s.t1 > d0 - 10 && s.t0 < d0 + 5)) continue; }
          else if (T.need === 'dusk') { const s = at(t0); if (s && WEATHER[s.w]?.storm) continue; }
          else if (T.need === 'rain-clears') {
            let hit = null;
            for (let i = 0; i < sp.length - 1; i++) { const s = sp[i], n = sp[i + 1]; if (rainy(s.w) && !WEATHER[n.w]?.precip && s.t1 >= d0 + T.hours[0] && s.t1 < d0 + T.hours[1]) { hit = s; break; } }
            if (!hit) continue; t0 = hit.t1;
          }
        } else if (kind === 'rainbow') t0 = d0 + 11 + u * 3;
        cand.push({kind, t0, k: hash3(mix(seed, 9400 + KI(kind)), D, 3)});
      }
      cand.sort((a, b) => a.k - b.k);
      for (const c of cand.slice(0, often ? 9 : MOST)) { const h = make(c.kind, D, R, c.t0); if (h) { h.id = `${c.kind}.${D}`; L.push(h); } }
      L.sort((a, b) => a.t0 - b.t0);
    }
    days.set(D, L);
    if (days.size > 8) days.delete(days.keys().next().value);
    return L;
  }
  return {
    day, forced,
    around(t, out) {
      out.length = 0; const D = Math.floor(t / 24);
      for (let d = D - 2; d <= D; d++) for (const h of day(d)) if (t >= h.t0 - .02 && t < h.tEnd) out.push(h);
      for (let i = forced.length - 1; i >= 0; i--) { const h = forced[i]; if (t >= h.tEnd + 1 || t < h.t0 - 48) forced.splice(i, 1); else if (t >= h.t0 - .02) out.push(h); }
      return out;
    },
    force(kind, t, near = null) {
      if (!HAPPENINGS[kind] || !F) return null;
      const R = rngOf(mix(seed, 9500 + KI(kind), Math.round(t * 997) + (++nf))), D = Math.floor(t / 24);
      const h = make(kind, D, R, t, near ? {x: near.x, y: near.y, r0: 8, r1: 16} : null) || (near ? make(kind, D, R, t, {x: near.x, y: near.y, r0: 3, r1: 26}) : null);
      if (!h) return null;
      h.id = `${kind}.f${Math.round(t * 3600)}`; h.forced = true; forced.push(h); return h;
    },
    walkerAt(h, i, t, out) {
      const P = h.path, T = HAPPENINGS.vattar, d = (t - h.t0) * T.v - i * T.gap;
      out.d = d; const dc = d < 0 ? 0 : d > P.L ? P.L : d;
      let k = 1; while (k < P.N && P.ds[k] < dc) k++;
      const a = (dc - P.ds[k - 1]) / Math.max(1e-6, P.ds[k] - P.ds[k - 1]);
      out.x = P.xs[k - 1] + (P.xs[k] - P.xs[k - 1]) * a; out.y = P.ys[k - 1] + (P.ys[k] - P.ys[k - 1]) * a;
      out.hd = Math.atan2(P.ys[k] - P.ys[k - 1], P.xs[k] - P.xs[k - 1]);
      return out;
    },
  };
}
// the compass word for the way from (x0, y0) to (x1, y1) (x east, y south)
export function compass(x0, y0, x1, y1) {
  const a = Math.atan2(-(y1 - y0), x1 - x0), i = Math.round(a / (Math.PI / 4) + 8) % 8;
  return ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][i];
}
