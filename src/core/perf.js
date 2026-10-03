// THE FRAME PROFILER: where every millisecond of the main thread goes, against a budget (docs/ARCHITECTURE.md, "Performance").
// What isn't measured regresses: every system's CPU time is timed every frame (two performance.now() calls, no
// allocation), rolled into a 240-frame window and drawn on the HD overlay (F3 or ?perf=1). The bench (tools/perf/bench.mjs)
// reads report() in headless Chrome and fails a scenario that goes over budget.
//
//   perf.wrap(obj, key, label, group)   time a function in place (features' hooks; idempotent)
//   perf.instrument(features)           wrap every feature hook: update -> sim, view / frame / lights / camera -> view, hd -> ui
//   perf.begin(label, group) ... perf.end(label)   time a span of host code (main.js)
//   perf.frameStart() / perf.frameEnd()  around the whole frame (the main thread's JS); the rAF interval gives the fps
//   perf.counts(o)                      this frame's counts (render/glstats.js take(): draws, uniforms, uploads...; the loop
//                                       feeds them while F3 is up or the bench runs); the JS heap is read with them
//   perf.report() -> {fps, frame: {p50, p95, p99, max}, js: {...}, groups: [{group, avg, budget}], systems: [...], counts}
//   perf.draw(q, sc)                    the overlay (q = the HD canvas' 2D context, sc = display px per view px)
//
// BUDGETS: milliseconds per frame on the dev machine (RTX 4070, a 3440x1440 display at 164 Hz), which is the target: as
// high a frame rate as that display shows, so every frame fits 1000 / 164 = 6.1 ms (p95 of the frame interval). The main
// thread's JS gets 4 ms of it on average (the browser, the compositor and a visible window take the rest: headless Chrome
// runs 10-20% faster than a window); the GPU gets 4.5 ms (G.render, p95, timed by the bench), most of it unused today:
// that's the room for looks. Weaker machines get the detail tier, not a budget.
// (2026-10-02: the target was a mid laptop at 60 fps; the 4 ms total stays, its split leans to where more life and the
// ultrawide's wider view cost (measured: 60 enemies add ~.02 ms to sim's per-frame share, ~.35 ms to render: a card +
// a shadow draw each; 3440x1440 shows ~50% more world than 1920x1080: 63 gbuffer draws, not 41, more lights in view))
export const BUDGET = {sim: .4, char: .4, view: 1.7, render: 1.3, ui: .2, frame: 4.0, p95: 6.1, gpu: 4.5};   // p95: frame interval; gpu: G.render on the GPU, p95
const GROUPS = ['sim', 'char', 'view', 'render', 'ui'];
const COL = {sim: '#6fb3ff', char: '#c58cff', view: '#7fd67a', render: '#f0c060', ui: '#ff8a6a', host: '#8a8577'};
const N = 240;   // frames in the window (~2-4 s)

export function createPerf({on = false} = {}) {
  const now = () => performance.now();
  const S = new Map();   // label -> {group, t0, cur (this frame), ring: Float32Array(N)}
  let i = 0, filled = 0, f0 = 0, lastStart = 0;
  const jsRing = new Float32Array(N), dtRing = new Float32Array(N);
  // COUNTS per frame, rolled like the systems: what the frame asks of WebGL (render/glstats.js) and the JS heap, its growth
  // between collections and the collections (a drop of performance.memory's used heap: Chrome; coarse unless Chrome runs
  // with --enable-precise-memory-info, as the bench does). Only while someone feeds them (perf.counts each frame)
  const CN = ['draws', 'uniforms', 'texCanvas', 'texData', 'texBytes', 'bufBytes', 'heapUp', 'gc'], cRing = {}, cCur = {}, cOn = new Uint8Array(N);
  for (const k of CN) { cRing[k] = new Float32Array(N); cCur[k] = 0; }
  let counted = false, heapPrev = 0;
  function counts(o) { counted = true; for (const k in o) if (k in cCur) cCur[k] += o[k]; }
  const sys = (label, group) => { let s = S.get(label); if (!s) S.set(label, s = {label, group, t0: 0, cur: 0, ring: new Float32Array(N)}); return s; };

  function begin(label, group = 'host') { const s = sys(label, group); s.t0 = now(); }
  function end(label) { const s = S.get(label); if (s) s.cur += now() - s.t0; }
  function wrap(obj, key, label, group) {
    const f = obj?.[key]; if (typeof f !== 'function' || f.__perf) return;
    const s = sys(label, group);
    // (fixed arity: a rest parameter would allocate an array per call; every hook takes at most three arguments)
    const w = function (a, b, c) { const t = now(); try { return f.call(this, a, b, c); } finally { s.cur += now() - t; } };
    w.__perf = f; obj[key] = w;
  }
  const HOOKS = {update: 'sim', view: 'view', frame: 'view', lights: 'view', camera: 'view', aimTarget: 'view', hd: 'ui'};
  function instrument(features) { for (const F of features) for (const [k, g] of Object.entries(HOOKS)) wrap(F, k, `${F.name}.${k}`, g); }

  function frameStart() { const t = now(); if (lastStart) dtRing[i] = t - lastStart; lastStart = t; f0 = t; }
  function frameEnd() {
    jsRing[i] = now() - f0;
    for (const s of S.values()) { s.ring[i] = s.cur; s.cur = 0; }
    if (counted) {
      const m = performance.memory?.usedJSHeapSize || 0;
      if (m && heapPrev) { if (m < heapPrev) cCur.gc++; else cCur.heapUp += m - heapPrev; }
      heapPrev = m;
    } else heapPrev = 0;
    for (const k of CN) { cRing[k][i] = cCur[k]; cCur[k] = 0; }
    cOn[i] = counted ? 1 : 0; counted = false;
    i = (i + 1) % N; if (filled < N) filled++;
  }

  const avg = r => { let a = 0; for (let k = 0; k < filled; k++) a += r[k]; return filled ? a / filled : 0; };
  const pct = (r, q) => { const a = Array.from(r.subarray(0, filled)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0; };
  function report() {
    const systems = [...S.values()].map(s => ({label: s.label, group: s.group, avg: +avg(s.ring).toFixed(3), max: +Math.max(...s.ring.subarray(0, filled), 0).toFixed(2)}))
      .sort((a, b) => b.avg - a.avg);
    const groups = GROUPS.map(g => ({group: g, avg: +systems.filter(s => s.group === g).reduce((a, s) => a + s.avg, 0).toFixed(3), budget: BUDGET[g]}));
    const js = {avg: +avg(jsRing).toFixed(3), p95: +pct(jsRing, .95).toFixed(2), budget: BUDGET.frame};
    const dt = avg(dtRing);
    return {fps: dt ? +(1000 / dt).toFixed(1) : 0, frame: {p50: +pct(dtRing, .5).toFixed(2), p95: +pct(dtRing, .95).toFixed(2), p99: +pct(dtRing, .99).toFixed(2),
      max: +Math.max(...dtRing.subarray(0, filled), 0).toFixed(2), budget: BUDGET.p95}, js, groups, systems, frames: filled, counts: countReport()};
  }
  function countReport() {   // the frames that were counted: averages, the most draws, collections a second -> null if none
    let n = 0, secs = 0; const sum = {}; for (const k of CN) sum[k] = 0; let dMax = 0;
    for (let k = 0; k < filled; k++) { if (!cOn[k]) continue; n++; secs += dtRing[k] / 1000; for (const c of CN) sum[c] += cRing[c][k]; dMax = Math.max(dMax, cRing.draws[k]); }
    if (!n) return null;
    const a = k => sum[k] / n;
    return {draws: +a('draws').toFixed(1), drawsMax: dMax, uniforms: +a('uniforms').toFixed(1), texCanvas: +a('texCanvas').toFixed(2), texData: +a('texData').toFixed(2),
      texKB: +(a('texBytes') / 1024).toFixed(1), bufKB: +(a('bufBytes') / 1024).toFixed(1), heapKB: +(a('heapUp') / 1024).toFixed(1), gcPerSec: secs ? +(sum.gc / secs).toFixed(2) : 0, frames: n};
  }
  function reset() { filled = 0; i = 0; jsRing.fill(0); dtRing.fill(0); for (const s of S.values()) s.ring.fill(0); for (const k of CN) cRing[k].fill(0); cOn.fill(0); heapPrev = 0; }

  // ---- the overlay: frame-time graph, the groups against their budgets, the most expensive systems
  let rep = null, repT = 0;
  function draw(q, sc) {
    if (!P.on) return;
    const t = now(); if (!rep || t - repT > 250) { rep = report(); repT = t; }   // (sorting 240 samples 4x a second, not every frame)
    const u = Math.max(1, sc / 3), W = 300 * u, x0 = q.canvas.width - W - 12 * u, y0 = 12 * u, lh = 13 * u;
    const top = rep.systems.slice(0, 9), cn = rep.counts, H = (96 + (GROUPS.length + top.length + (cn ? 2 : 0)) * 13 + 30) * u;
    q.save(); q.setTransform(1, 0, 0, 1, 0, 0);
    q.fillStyle = 'rgba(12,14,13,.86)'; q.fillRect(x0, y0, W, H);
    q.font = `${Math.round(11 * u)}px ui-monospace, Consolas, monospace`; q.textBaseline = 'top';
    const txt = (s, x, y, c = '#e8e2d2') => { q.fillStyle = c; q.fillText(s, x, y); };
    const p = 8 * u, ok = (v, b) => v <= b ? '#7fd67a' : v <= b * 1.5 ? '#f0c060' : '#ff6a5a';
    txt(`${rep.fps.toFixed(0)} fps · frame p50 ${rep.frame.p50.toFixed(1)} / p95 ${rep.frame.p95.toFixed(1)} ms`, x0 + p, y0 + p, ok(rep.frame.p95, BUDGET.p95));
    txt(`JS ${rep.js.avg.toFixed(2)} ms (budget ${BUDGET.frame})`, x0 + p, y0 + p + lh, ok(rep.js.avg, BUDGET.frame));
    let yc = y0 + p + 2 * lh;
    if (cn) {   // what the frame asks of WebGL, and the heap (render/glstats.js; performance.memory)
      txt(`draws ${cn.draws.toFixed(0)} · uniforms ${cn.uniforms.toFixed(0)} · up ${cn.texCanvas.toFixed(1)} canvas ${cn.texData.toFixed(1)} data ${cn.texKB.toFixed(0)} KB · buf ${cn.bufKB.toFixed(0)} KB`, x0 + p, yc, '#b8b2a4'); yc += lh;
      txt(`heap +${cn.heapKB.toFixed(0)} KB/frame · GC ${cn.gcPerSec.toFixed(1)}/s`, x0 + p, yc, cn.heapKB > 100 ? '#f0c060' : '#b8b2a4'); yc += lh;
    }
    // the graph: JS per frame (stacked by group would cost more than it tells), frame interval as a line; marks at 16.7 ms,
    // the p95 budget (164 Hz) and the JS budget
    const gx = x0 + p, gy = yc + .4 * lh, gw = W - 2 * p, gh = 56 * u, sy = v => gy + gh - Math.min(gh, v / 20 * gh);
    q.fillStyle = 'rgba(255,255,255,.05)'; q.fillRect(gx, gy, gw, gh);
    for (const [v, c] of [[16.7, 'rgba(255,106,90,.5)'], [BUDGET.p95, 'rgba(240,192,96,.5)'], [BUDGET.frame, 'rgba(127,214,122,.5)']]) { q.fillStyle = c; q.fillRect(gx, sy(v), gw, Math.max(1, u)); }
    const bw = gw / N;
    for (let k = 0; k < filled; k++) {
      const j = (i - filled + k + N) % N, x = gx + (N - filled + k) * bw;
      q.fillStyle = COL.view; q.fillRect(x, sy(jsRing[j]), Math.max(1, bw), gy + gh - sy(jsRing[j]));
      q.fillStyle = '#e8e2d2'; q.fillRect(x, sy(dtRing[j]), Math.max(1, bw), Math.max(1, u));
    }
    let y = gy + gh + 6 * u;
    for (const g of rep.groups) {
      txt(g.group.padEnd(7) + g.avg.toFixed(2).padStart(6) + ' / ' + g.budget.toFixed(1), x0 + p, y, ok(g.avg, g.budget));
      const bx = x0 + p + 150 * u, bwid = W - 150 * u - 2 * p; q.fillStyle = 'rgba(255,255,255,.08)'; q.fillRect(bx, y + 2 * u, bwid, 8 * u);
      q.fillStyle = COL[g.group]; q.fillRect(bx, y + 2 * u, Math.min(bwid, bwid * g.avg / (g.budget * 2)), 8 * u);
      q.fillStyle = '#e8e2d2'; q.fillRect(bx + bwid / 2, y, Math.max(1, u), 12 * u);   // the budget mark (bar = 2x budget)
      y += lh;
    }
    y += 4 * u;
    for (const s of top) { txt(s.label.slice(0, 26).padEnd(27) + s.avg.toFixed(2).padStart(6) + ' ms', x0 + p, y, COL[s.group] || COL.host); y += lh; }
    q.restore();
  }

  const P = {on, begin, end, wrap, instrument, frameStart, frameEnd, counts, report, reset, draw, BUDGET,
    toggle() { P.on = !P.on; }};
  return P;
}
