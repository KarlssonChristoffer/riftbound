// NAV: where enemies can stand and how they reach you.
// A 0.5 m grid over the world. A cell is OPEN when it is ground level (no plateau), inside the arena's walls or on the
// trail (layout.navArea: the gateways count), dry, and clear of the walls and the fixed props (pillars, posts, trees, rocks); breakable
// props don't close cells (the core's own hop test keeps enemies off them). A breadth-first FLOW FIELD from the player,
// re-run a few times a second, gives every open cell its walking distance to you:
//   steer(b)       the next waypoint for an enemy: the lowest cell one hop away along a clear line (round walls, out
//                  through a gate, along the bank), or null when it can go straight at you (the core does that)
//   spots(...)     spawn spots: open cells in a band of WALKING distance (never across the stream from you), spaced out
// It's rebuilt per stage (build()) since the world's fixed props come with the layout.
import {WORLD, navArea, elev, inStream} from './world.js';

const C = .5, TAU = Math.PI * 2;

export function createNav(host) {
  const X0 = WORLD.x0, Y0 = WORLD.y0, NX = Math.ceil(WORLD.WM / C), NY = Math.ceil(WORLD.HM / C), N = NX * NY;   // cell (i, j) = X0 + i C .. (the world's origin)
  const open = new Uint8Array(N), dist = new Float32Array(N).fill(Infinity), queue = new Int32Array(N);
  let fieldT = 0, built = false;
  const idx = (x, y) => { const i = Math.floor((x - X0) / C), j = Math.floor((y - Y0) / C); return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i; };
  const at = (x, y) => { const k = idx(x, y); return k < 0 ? Infinity : dist[k]; };
  const isOpen = (x, y) => { const k = idx(x, y); return k >= 0 && open[k] === 1; };

  function build() {
    const fixed = host.props.filter(p => !p.gone && !p.broken && !p.breakable && !p.sparring && !p.outside && !p.interact && (p.rect || p.r > 0));
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = X0 + (i + .5) * C, y = Y0 + (j + .5) * C;
      let ok = navArea(x, y) && elev(x, y) === 0 && !inStream(x, y);
      if (ok) for (const p of fixed) {
        if (p.rect ? x > p.rect[0] - .3 && x < p.rect[2] + .3 && y > p.rect[1] - .3 && y < p.rect[3] + .3 : Math.hypot(p.x - x, p.y - y) < p.r + .3) { ok = false; break; }
      }
      open[j * NX + i] = ok ? 1 : 0;
    }
    built = true; fieldT = 0;
  }
  // the nearest open cell to (x, y) within r cells (the player can stand where enemies can't: a plateau, a sunk crate)
  function nearestOpen(x, y, r = 8) {
    const i0 = Math.floor((x - X0) / C), j0 = Math.floor((y - Y0) / C);
    let best = -1, bd = 1e9;
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NY || !open[j * NX + i]) continue;
      const d = (i - i0) ** 2 + (j - j0) ** 2; if (d < bd) { bd = d; best = j * NX + i; }
    }
    return best;
  }
  function field(px, py) {
    dist.fill(Infinity);
    let s = idx(px, py); if (s < 0 || !open[s]) s = nearestOpen(px, py);
    if (s < 0) return;
    let h = 0, t = 0; queue[t++] = s; dist[s] = 0;
    while (h < t) {
      const k = queue[h++], i = k % NX, j = (k - i) / NX, d = dist[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NX || b >= NY) continue;
        const n = b * NX + a; if (!open[n] || dist[n] !== Infinity) continue;
        if (di && dj && (!open[j * NX + a] || !open[b * NX + i])) continue;   // no cutting a corner
        dist[n] = d + (di && dj ? 1.414 : 1) * C; queue[t++] = n;
      }
    }
  }
  const lineOpen = (x0, y0, x1, y1) => {
    const l = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(l / .25));
    for (let k = 1; k <= n; k++) if (!isOpen(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)) return false;
    return true;
  };

  return {
    get built() { return built; }, open, dist, NX, NY, C, X0, Y0, at, isOpen, build,
    update(dt) { if (built && (fieldT -= dt) <= 0) { fieldT = .25; field(host.player.x, host.player.y); } },
    steer(b) {
      const P = host.player, d0 = at(b.x, b.y);
      if (!isFinite(d0)) return null;                                     // off the grid: straight at you
      if (d0 < 2.5 || lineOpen(b.x, b.y, P.x, P.y)) return null;          // close, or a clear line: straight at you
      const hop = b.hopD ?? 1.7;
      let best = null, bv = d0 - .2;
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * TAU, sx = Math.sin(a), sy = Math.cos(a);
        for (const r of [hop, hop * .6]) {
          const x = b.x + sx * r, y = b.y + sy * r, v = at(x, y);
          if (v < bv && lineOpen(b.x, b.y, x, y)) { bv = v; best = {x, y, stop: 0}; }
        }
      }
      return best;
    },
    // n spawn spots between lo and hi metres of WALKING distance from you, at least `apart` m from each other and from
    // `avoid` points ({x, y}); falls back to anything reachable
    spots(n, lo, hi, rng = Math.random, avoid = [], apart = 1.6) {
      const P = host.player, cand = [];
      for (let k = 0; k < N; k++) if (open[k] && dist[k] >= lo && dist[k] <= hi) cand.push(k);
      if (!cand.length) for (let k = 0; k < N; k++) if (open[k] && dist[k] > 3 && isFinite(dist[k])) cand.push(k);
      const out = [];
      for (let tries = 0; out.length < n && tries < 200 && cand.length; tries++) {
        const k = cand[Math.floor(rng() * cand.length)], x = X0 + (k % NX + .5) * C, y = Y0 + (Math.floor(k / NX) + .5) * C;
        if (Math.hypot(P.x - x, P.y - y) < lo * .7) continue;
        if ([...out, ...avoid].some(o => Math.hypot(o.x - x, o.y - y) < apart)) continue;
        out.push({x, y});
      }
      return out;
    },
  };
}
