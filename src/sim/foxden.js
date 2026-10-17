// THE THIEVING FOX (the rules; living-animals.md slice 4, docs/FAUNA.md "The thieving fox"): things put down on the ground, the
// fox that takes food left out at night home to its den, and what the den holds. Plain logic both sides run: the co-op server
// (server/room.mjs: one world for everyone) and the game offline (features/foxden.js, saved in pack.store('foxden')). Pure: no DOM,
// no game state; the dens come from the fauna plan (world/fauna.js: each fox's G.den), the clock is in-game hours, the burning
// fires and the moving players are handed in each step.
//   GROUND   leave(by, kind, x, y, t, name?) -> the item | a reason; take(id) -> the item | null. At most GROUND.most each
//   THEFT    each food (content/animals.js THEFT.food) left out gets a try at a seeded hour of the night (THEFT.hours), the same
//            for everyone (the item's id and the night); a burning fire within THEFT.fire m or a moving player within THEFT.watch
//            puts it off THEFT.retry hours, at most THEFT.tries a night. Then the nearest den's fox comes for it: a RUN, from a
//            point on its den's side (trotting in), the item in its jaws, home at THEFT.run m/s on a seeded wiggly line (runAt).
//            often: within THEFT.often hours of being put down, day or night (?thief=often)
//   DROP     drop(fox, x, y): the lasso on a fox that carries something: it lands there (trotting in: back where it lay)
//   DEN      each den keeps what came home (with who left it) and its own finds (DEN.own at the start, +1 every DEN.refill days up
//            to DEN.unclaimed; DEN.named of the refills a thing scratched with a name). reach(fox, t) -> everything in it, emptied
// Events (from step, drop, reach; the server sends them as {k: 'ev', ...e}): {a: 'theft', run}, {a: 'denned', fox, id},
// {a: 'drop', fox, item}. Its state goes out whole (toJSON / load): ground items, runs, dens.
//   const D = createFoxden(plan, R, o); D.step(t, fires, movers) -> events; D.ground, D.runs, D.dens; runAt(run, t, out)
// OWNS: the ground items, the runs, the dens' lists (in whoever runs it). READS: content/animals.js (THEFT, GROUND, DEN, DEN_FINDS,
//   NAMED), core/mathx.js (hash3).
import {THEFT, GROUND, DEN, DEN_FINDS, NAMED} from '../content/animals.js';
import {hash3} from '../core/mathx.js';

const TAU = Math.PI * 2;
const H = (s, a, b = 0) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return hash3(h | 0, a, b); };   // 0..1, the same everywhere
export const APPROACH = {d: 16, v: 2.5};   // m out it trots in from, m/s
// the dens: [{fox: its animal id, x, y (the den spot), mx, my (its mouth, under the rock)}] from the fauna plan
export function densOf(plan) {
  const out = [];
  if (!plan) return out;
  for (const a of plan.animals) {
    if (a.sp !== 'fox') continue;
    const G = plan.groups[a.group], d = G.den || G, rk = G.rock || null;
    // the mouth: from the den spot in toward its rock (the outcrop or block it lies by), to just short of the rock's foot (at most
    // DEN.mouth m); no rock: the spot itself. u: the way in (toward the rock)
    let ux = 0, uy = 1, k = 0;
    if (rk) { const l = Math.hypot(rk.x - d.x, rk.y - d.y) || 1; ux = (rk.x - d.x) / l; uy = (rk.y - d.y) / l; k = Math.max(0, Math.min(DEN.mouth, l - rk.r - .15)); }
    out.push({fox: a.id, x: d.x, y: d.y, mx: +(d.x + ux * k).toFixed(2), my: +(d.y + uy * k).toFixed(2), ux, uy, rock: !!rk});
  }
  return out;
}
// where a run's fox is at hour t -> out {x, y, hd, v (m/s), phase: 'in' | 'carry' | 'home'}
export function runAt(r, t, out) {
  const s = (t - r.t0) * 3600 / 50;   // (real seconds since it set out: an in-game hour is 50 s, sim/env.js)
  const tin = APPROACH.d / APPROACH.v;
  const dx = r.dx - r.ix, dy = r.dy - r.iy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  if (s < tin) {   // trotting in, from its den's side
    const k = s / tin, x0 = r.ix + ux * APPROACH.d, y0 = r.iy + uy * APPROACH.d;
    out.x = x0 + (r.ix - x0) * k - uy * Math.sin(k * 3 + r.w) * 1.2; out.y = y0 + (r.iy - y0) * k + ux * Math.sin(k * 3 + r.w) * 1.2;
    out.hd = Math.atan2(-uy, -ux); out.v = APPROACH.v; out.phase = 'in'; return out;
  }
  const c = Math.min(L, (s - tin) * THEFT.run), k = c / L, wig = Math.sin(k * 7 + r.w) * Math.min(3, L * .08) * Math.sin(k * Math.PI);
  out.x = r.ix + ux * c - uy * wig; out.y = r.iy + uy * c + ux * wig;
  out.hd = Math.atan2(uy, ux) + Math.cos(k * 7 + r.w) * .35; out.v = c < L ? THEFT.run : 0; out.phase = c < L ? 'carry' : 'home';
  return out;
}
export const runEnd = r => r.t0 + (APPROACH.d / APPROACH.v + Math.hypot(r.dx - r.ix, r.dy - r.iy) / THEFT.run) * 50 / 3600;
export const runTake = r => r.t0 + APPROACH.d / APPROACH.v * 50 / 3600;   // (the hour it has the item in its jaws)

// o: {often: bool (?thief=often), day0: the world's first day (dens start full)}
export function createFoxden(plan, o = {}) {
  const dens = densOf(plan), ground = new Map(), runs = new Map(), lists = new Map(), ev = [];
  let n = 0;
  for (const d of dens) lists.set(d.fox, {things: [], own: DEN.own[0] + Math.floor(H(d.fox, 1) * (DEN.own[1] - DEN.own[0] + 1)), refill: o.day0 ?? 0, k: 0});
  const nearestDen = (x, y) => { let b = null, bd = 1e9; for (const d of dens) { const q = Math.hypot(d.x - x, d.y - y); if (q < bd) { bd = q; b = d; } } return b; };
  // the next try for an item after hour t: a seeded hour in tonight's (or the next) window; often: soon after it went down
  function slot(it, t) {
    if (o.often) return Math.max(t, it.at + H(it.id, 7) * THEFT.often);
    const [h0, h1] = THEFT.hours, span = (h1 + 24 - h0) % 24 || 24;
    for (let d = Math.floor((t - h0) / 24); ; d++) { const s = d * 24 + h0 + H(it.id, 9, d) * span; if (s >= t) return s; }
  }
  const D = {
    dens, ground, runs, lists,
    count: by => { let k = 0; for (const it of ground.values()) if (it.by === by) k++; return k; },
    leave(by, kind, x, y, t, name = null, who = '') {
      if (D.count(by) >= GROUND.most) return 'too many down';
      const it = {id: 'g' + (++n), kind, x: +x.toFixed(2), y: +y.toFixed(2), by, who, name, at: t, next: -1, tries: 0};
      ground.set(it.id, it); return it;
    },
    take(id) { const it = ground.get(id); if (!it) return null; ground.delete(id); return it; },
    // the hour: the tries due now (fires [{x, y}] burning; movers [{x, y}] people moving), the runs come home
    step(t, fires, movers) {
      ev.length = 0;
      for (const it of ground.values()) {
        if (!THEFT.food(it.kind) || !dens.length) continue;
        if (it.next < 0) it.next = slot(it, t);
        if (t < it.next) continue;
        let busy = false;
        for (const f of fires) if (Math.hypot(f.x - it.x, f.y - it.y) < THEFT.fire) busy = true;
        for (const m of movers) if (Math.hypot(m.x - it.x, m.y - it.y) < THEFT.watch) busy = true;
        for (const r of runs.values()) if (r.fox === nearestDen(it.x, it.y).fox) busy = true;   // (its fox is out on another)
        if (busy) { if (++it.tries < THEFT.tries) it.next = t + THEFT.retry; else { it.tries = 0; it.next = slot(it, t + 4); } continue; }
        const d = nearestDen(it.x, it.y);
        const r = {id: 'r' + (++n), fox: d.fox, item: {kind: it.kind, by: it.by, who: it.who, name: it.name}, ix: it.x, iy: it.y, dx: d.mx, dy: d.my, t0: t, w: H(it.id, 11) * TAU, gid: it.id};
        ground.delete(it.id); runs.set(r.id, r); ev.push({a: 'theft', run: r});
      }
      for (const r of runs.values()) if (t >= runEnd(r)) { runs.delete(r.id); lists.get(r.fox).things.push(r.item); ev.push({a: 'denned', fox: r.fox, id: r.id}); }
      // the dens' own finds: one more every DEN.refill days, up to DEN.unclaimed
      const day = Math.floor(t / 24);
      for (const L of lists.values()) while (day - L.refill >= DEN.refill) { L.refill += DEN.refill; if (L.own < DEN.unclaimed) L.own++; }
      return ev;
    },
    // the lasso on a fox on a run: what it carries lands at (x, y) (still trotting in: where it lay); -> the ground item | null
    drop(fox, x, y, t) {
      for (const r of runs.values()) {
        if (r.fox !== fox) continue;
        runs.delete(r.id);
        const early = t < runTake(r), it = {id: r.gid, kind: r.item.kind, x: +(early ? r.ix : x).toFixed(2), y: +(early ? r.iy : y).toFixed(2), by: r.item.by, who: r.item.who, name: r.item.name, at: t, next: -1, tries: 0};
        ground.set(it.id, it); return it;
      }
      return null;
    },
    // reaching in: everything (the stolen with who left them; its own finds rolled now, from the den and how often it was emptied)
    reach(fox) {
      const L = lists.get(fox); if (!L) return null;
      const out = L.things.slice();
      for (let i = 0; i < L.own; i++) {
        const named = H(fox, 40 + L.k, i) < DEN.named, pick = (list, salt) => list[Math.floor(H(fox, salt + L.k, i) * list.length) % list.length];   // (DEN.named of them: a thing scratched with a name)
        out.push({kind: named ? pick(NAMED.ids, 20) : pick(DEN_FINDS, 30), by: null, who: '', name: named ? pick(NAMED.names, 60) : null});
      }
      L.things.length = 0; L.own = 0; L.k++;
      return out;
    },
    toJSON: () => ({n, ground: [...ground.values()], runs: [...runs.values()], lists: [...lists].map(([f, L]) => [f, L])}),
    load(s) {
      if (!s || typeof s !== 'object') return;
      n = s.n | 0; ground.clear(); runs.clear();
      for (const it of s.ground || []) ground.set(it.id, it);
      for (const r of s.runs || []) runs.set(r.id, r);
      for (const [f, L] of s.lists || []) if (lists.has(f)) lists.set(f, L);
    },
  };
  return D;
}
