// WIND LINES (render3d): the wind made visible WHERE IT MEETS SOMETHING. Streaks of air that strike through a tree's crown or
// whip past the Ranger as a gust front reaches them, often ending in a curl (the Wind Waker idea), in the world: they turn
// with the camera and pass behind walls and crowns. Never free-floating (the user: "only when they interact with the
// environment"). OWNER: the trees / wind-feel session. SHOW ONLY (no colliders, never pushes anything).
//   emitters a leafy tree (3D crown bounds or the card's), a bush (rarely), the player. Each fires a burst of 1-3 lines when
//            a gust front ARRIVES at it (local gust x the wind strength rising past TUNE.fire: none in a calm or a plain
//            breeze, bursts in brisk / gale), then rests TUNE.cool s. The lines start upwind of it, skim / pierce it (bent
//            round its bulk: TUNE.deflect), and run on downwind
//   motion   the head rides the wind field (faster than it: TUNE.speed, so it reads as moving air, not drifting dust), with
//            a slow vertical wobble; most lines CURL near the end of their life: the head loops once in the vertical plane
//            of the wind, so the trail draws a loop. The trail is the head's own recent path (a ribbon), grown in at birth,
//            dying tail first
//   looks    (TUNE.look, menu 'Wind lines', Shift+B cycles, ?windlines=): 'pixel' (default) = crisp 1 px world lines in 3
//            pale tones (depth-tested: they pass behind walls and crowns; lit by the scene), 'hd' = soft display-resolution
//            strokes (gfx fx blobs, depth faded against the pixel scene, like the HD flames), 'off'
//   sound    a line passing close to the player gives a soft dark swish (windaudio.js swish), panned to its side
// FEATURE CONTRACT (main.js): create(host) -> F: update (simulate), frame (draw), settings, onKey, hud.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const R = Math.random, rr = (a, b) => a + R() * (b - a);
export const TUNE = {
  look: 'pixel',
  fire: 1.05,         // an emitter bursts when (gust there x strength) rises past this (a breeze's full gust ~1: rarely)
  cool: [1.8, 3.2],   // s an emitter rests after a burst
  burst: {tree: [1, 3], bush: [1, 1], player: [1, 2]},   // lines per burst (min, max)
  odds: {tree: 1, bush: .12, dead: .5, player: 1},       // chance a qualifying arrival bursts at all (bushes are many: rarely)
  deflect: 1.1,       // how hard a line bends round the bulk it passes (x its speed)
  speed: [3.2, 2.2],  // m/s: base + per unit of strength (the wind field's own speed is added x 1.5)
  life: [.9, 1.6],    // s
  curl: .55,          // share of lines that end in a loop
  curlDur: [.38, .55],// s per loop
  trail: 16,          // samples of the head's path kept (~0.27 s at 60 Hz: ~2 m of streak)
  max: 24,            // lines alive at once
  hd: {r0: .05, r1: .018, a: .6, col: [.95, .97, 1]},   // HD stroke: radius m at the head -> tail, peak alpha, colour
  wave: [.18, .42],   // m: the sideways S of a line (across the wind, on the ground plane), and its rate is .4-.9 waves / s
  hdBudget: 3200,     // HD blobs per frame at most (gfx FXMAX 6000 is shared with the HD flames)
  px: ['#f4f6f2', '#d9dfdc', '#b7c0bf'],                  // pixel tones: head .. tail
  swish: {r: 2.2, cool: .35},                             // m from the player, s between swishes
};

export async function create(host) {
  const Q = new URLSearchParams(location.search), G = host.G, ctx = host.ctxO;
  if (['hd', 'pixel', 'off'].includes(Q.get('windlines'))) TUNE.look = Q.get('windlines');
  const lines = [];
  const F = {name: 'windlines', label: 'Wind lines', on: true, TUNE, lines, ms: 0, fired: {}};   // fired: bursts per emitter kind (tests)
  let swishT = 0, T = 0;
  const WA = {x: 0, y: 0, g: 0};   // wind.at fills it: no allocation per call
  const W = () => host.wind;
  // the view: its centre and half extents (view-frame metres), the screen's right / toward-camera on the ground (arena x, y)
  function view() {
    const yaw = host.yaw, z = host.zoom || 1, T3 = G.view.T, RX = Math.cos(yaw), RY = -Math.sin(yaw), FX = Math.sin(yaw), FY = Math.cos(yaw);
    const up = T3.y * ctx.PPMH / ctx.PPMY;   // the target stands T3.y up: the ground at the screen's centre lies that much away from the camera
    return {RX, RY, FX, FY, cx: T3.x - FX * up, cy: T3.z - FY * up, hw: ctx.VW / 2 / (ctx.PPM * z), hh: ctx.VH / 2 / (ctx.PPMY * z)};
  }
  // ---- emitters: what the wind can be seen meeting. -> {x, y (centre, arena), h0, h1 (height span), r (bulk radius)}
  function crownOf(p) {
    const it = host.itemOf(p), ps = it?.pose, C = ps?.crown, z = p.z || 0;
    if (C) { const c = Math.cos(ps.yaw), s = Math.sin(ps.yaw), k = ps.scale; return {x: p.x + (C.x * c + C.z * s) * k, y: p.y + (-C.x * s + C.z * c) * k, h0: z + C.y0 * k, h1: z + C.y1 * k, r: C.r * k}; }
    if (ps) { const top = ps.top || 4; return {x: p.x, y: p.y, h0: z + top * .3, h1: z + top, r: .9}; }   // a bare (dead) 3D tree: its limbs
    const sp = it?.sp, top = sp ? sp.pivot[1] / ctx.PPMH : 3.8;   // a painted card: its sprite's height
    return p.kind === 'bush' ? {x: p.x, y: p.y, h0: z + .1, h1: z + Math.max(.6, top), r: .45} : {x: p.x, y: p.y, h0: z + top * .45, h1: z + top, r: 1.25};
  }
  const est = new Map();   // emitter (prop / 'player') -> {e: last (gust x strength), cool}
  const inView = (V, x, y, m) => { const dx = (x - V.cx) * V.RX + (y - V.cy) * V.RY, dy = (x - V.cx) * V.FX + (y - V.cy) * V.FY; return Math.abs(dx) < V.hw + m && dy > -V.hh - m - 3 && dy < V.hh + m; };
  const queue = [];   // a burst's lines, staggered by a few tenths of a second
  function arrive(key, kind, B, e, dt) {
    let s = est.get(key); if (!s) est.set(key, s = {e, cool: 0});
    s.cool -= dt; const rose = e >= TUNE.fire && s.e < TUNE.fire; s.e = e;
    if (!rose || s.cool > 0 || R() > (TUNE.odds[kind] ?? 1)) return;
    s.cool = rr(...TUNE.cool); F.fired[kind] = (F.fired[kind] || 0) + 1;
    const [lo, hi] = TUNE.burst[kind === 'dead' ? 'tree' : kind] || [1, 1], n = lo + Math.floor(R() * (hi - lo + 1)) + (e > 2.6 && kind === 'tree' ? 1 : 0);
    for (let i = 0; i < n; i++) queue.push({at: T + rr(0, .3) + i * .08, B, kind});
  }
  // one line through / past the bulk B: it starts upwind of it, at a height within it, a little to one side, and runs on
  // downwind (life = the way through + a few metres), bent round B on the way
  function launch(q, w) {
    const B = q.B, a = w.at(B.x, B.y, WA), sp = Math.hypot(a.x, a.y) || 1, ux = a.x / sp, uy = a.y / sp, lv = w.level ?? 1;
    const side = (R() < .5 ? -1 : 1) * B.r * rr(.25, 1.05), back = B.r + rr(1, 2);
    const x = B.x - ux * back - uy * side, y = B.y - uy * back + ux * side, h = rr(B.h0 + (B.h1 - B.h0) * .2, B.h1 + .15), N = TUNE.trail;
    const S = (TUNE.speed[0] + TUNE.speed[1] * lv) * rr(.85, 1.15) + sp * 1.5;
    const L = {x, y, h, dx: ux, dy: uy, t: 0, life: Math.min(TUNE.life[1] + .3, (back + B.r + rr(2.5, 4)) / S + .25), S, obs: B, kind: q.kind,
      ph: R() * TAU, wob: rr(.06, .2), wf: rr(3, 6), sw: rr(...TUNE.wave) * (R() < .5 ? -1 : 1), sf: rr(2.5, 5.5), hist: new Float32Array(N * 3), n: 0, head: 0, curl: null, near: false};
    if (R() < TUNE.curl) { const d = rr(...TUNE.curlDur); L.curl = {t0: Math.max(.25, L.life - d - rr(.05, .2)), d, dir: R() < .5 ? 1 : -1}; }
    lines.push(L);
  }
  function emitters(V, w, dt) {
    const lv = w.level ?? 1;
    if (lv < .9) { est.clear(); return; }
    for (const p of host.props) {
      const k = p.kind; if ((k !== 'tree' && k !== 'bush') || p.gone || !inView(V, p.x, p.y, 2)) continue;
      const dead = k === 'tree' && (p.variant | 0) === 2 && host.biome.id === 'ruins';
      arrive(p, dead ? 'dead' : k, crownOf(p), w.at(p.x, p.y, WA).g * lv, dt);
    }
    const P = host.player;   // the Ranger: a gust strong enough to whip the cloak and scarf
    arrive('player', 'player', {x: P.x, y: P.y, h0: P.z + .9, h1: P.z + 1.75, r: .35}, (w.strength || 0) * .62, dt);
  }
  function step(L, dt, w) {
    L.t += dt;
    const a = w.at(L.x, L.y, WA), sp = Math.hypot(a.x, a.y);
    if (sp > .05) { const k = Math.min(1, dt * 3); L.dx += (a.x / sp - L.dx) * k; L.dy += (a.y / sp - L.dy) * k; const n = Math.hypot(L.dx, L.dy) || 1; L.dx /= n; L.dy /= n; }
    let vH = L.S, vV = L.wob * L.wf * Math.cos(L.t * L.wf + L.ph);   // along the wind, up
    const C = L.curl;
    if (C && L.t > C.t0 && L.t < C.t0 + C.d) {   // the loop: the velocity turns once round in the wind's vertical plane
      const th = (L.t - C.t0) / C.d * TAU * C.dir, s = L.S * .7; vH = s * Math.cos(th); vV = s * Math.sin(th);
    }
    const vS = L.sw * L.sf * Math.cos(L.t * L.sf + L.ph * 1.7);   // sideways, across the wind: the S of a flowing line
    L.x += (L.dx * vH - L.dy * vS) * dt; L.y += (L.dy * vH + L.dx * vS) * dt; L.h += vV * dt;
    const O = L.obs;
    if (O) {   // bent round the bulk it passes: pushed out sideways (and over the top half), so it skims the crown / the Ranger
      const ex = L.x - O.x, ey = L.y - O.y, d = Math.hypot(ex, ey), r2 = O.r * 1.15;
      if (d < r2 && d > 1e-3 && L.h > O.h0 - .2 && L.h < O.h1 + .3) { const k = (1 - d / r2) * L.S * TUNE.deflect * dt; L.x += ex / d * k; L.y += ey / d * k; if (L.h > (O.h0 + O.h1) / 2) L.h += k * .5; }
    }
    const N = TUNE.trail, i = L.head * 3; L.hist[i] = L.x; L.hist[i + 1] = L.y; L.hist[i + 2] = L.h; L.head = (L.head + 1) % N; L.n = Math.min(N, L.n + 1);
  }
  // the k-th sample back from the head (0 = the head)
  const at = (L, k, o) => { const N = TUNE.trail, i = ((L.head - 1 - k) % N + N) % N * 3; o[0] = L.hist[i]; o[1] = L.hist[i + 1]; o[2] = L.hist[i + 2]; return o; };
  const A = [0, 0, 0], B = [0, 0, 0];
  // how much of the trail shows: grows in at birth (.12 s), dies tail first over the last .35 s
  const shown = L => Math.max(0, Math.min(L.n, Math.floor(TUNE.trail * Math.min(1, L.t / .12) * Math.min(1, (L.life - L.t) / .35) + .999)));

  F.update = dt => {
    const t0 = performance.now(), w = W();
    T += dt; swishT -= dt;
    if (!w?.on || !F.on || TUNE.look === 'off') { lines.length = 0; queue.length = 0; return; }
    const V = view();
    emitters(V, w, dt);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= T) { if (lines.length < TUNE.max) launch(queue[i], w); queue.splice(i, 1); }
    const P = host.player, aw = host.feature('audio')?.windAudio;
    for (let i = lines.length - 1; i >= 0; i--) {
      const L = lines[i]; step(L, dt, w);
      if (L.t >= L.life) { lines[i] = lines[lines.length - 1]; lines.pop(); continue; }
      if (!L.near && swishT <= 0 && aw?.swish && Math.hypot(L.x - P.x, L.y - P.y) < TUNE.swish.r && Math.abs(L.h - P.z - 1) < 1.6) {
        L.near = true; swishT = TUNE.swish.cool;
        aw.swish(clamp(((L.x - P.x) * V.RX + (L.y - P.y) * V.RY) / 2.5, -.9, .9), clamp((w.level ?? 1) / 2.5, .3, 1));
      }
    }
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  const PX = TUNE.px.map(c => host.rgb(c));
  F.frame = () => {
    if (!lines.length || TUNE.look === 'off') return;
    const hd = TUNE.look === 'hd', H = TUNE.hd;
    let budget = TUNE.hdBudget;   // HD blobs this frame (the fx buffer is shared with the HD flames)
    for (const L of lines) {
      if (hd && budget <= 0) break;
      const m = shown(L); if (m < 2) continue;
      const env = Math.min(1, L.t / .1) * Math.min(1, (L.life - L.t) / .25);
      for (let k = 0; k < m - 1; k++) {
        at(L, k, A); at(L, k + 1, B);
        const u = k / (TUNE.trail - 1);
        if (!hd) { host.line(A[0], A[1], A[2], B[0], B[1], B[2], PX[u < .25 ? 0 : u < .62 ? 1 : 2]); continue; }
        // HD: soft blobs along the segment, close enough to merge into one stroke, fading toward the tail
        const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), r = H.r0 + (H.r1 - H.r0) * u, n = Math.max(1, Math.ceil(len / (r * .9)));
        const al = H.a * env * (1 - u) ** 1.3; budget -= n;
        for (let j = 0; j < n; j++) { const f = j / n; G.fx(A[0] + (B[0] - A[0]) * f, A[2] + (B[2] - A[2]) * f, A[1] + (B[1] - A[1]) * f, r, H.col, al, 'blend'); }
      }
    }
  };
  const LOOKS = ['pixel', 'hd', 'off'];
  F.settings = () => [{label: 'Wind lines', options: LOOKS, get: () => TUNE.look, set: v => { TUNE.look = v; }}];
  F.onKey = (k, e) => { if (k === 'b' && e?.shiftKey) { TUNE.look = LOOKS[(LOOKS.indexOf(TUNE.look) + 1) % LOOKS.length]; return true; } return false; };
  F.hud = () => TUNE.look === 'off' ? '' : `wind lines ${TUNE.look} ${lines.length}`;
  return F;
}
