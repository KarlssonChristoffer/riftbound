// Runtime core test page: window.T.* is driven by a CDP harness (headless Chrome); "run all" runs it by hand.
// Measures: bake throughput + main-thread frame gaps, voice manager bursts, limiter peaks (offline render of the real
// graph), loop start/stop/wrap/ramps for clicks, snapshot ducks, reverb IR RT60s and the reverb crossfade.
import {createBakery} from '../bakery.js';
import {createEngine, buildIR, REVERBS} from '../engine.js';
import {analyze} from '../../forge/metrics.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
const dB = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// ---------------------------------------------------------------- main-thread monitor
function frameMon() {
  const ts = [], lt = []; let on = true;
  const f = t => { ts.push(t); if (on) requestAnimationFrame(f); }; requestAnimationFrame(f);
  let po = null; try { po = new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(r1(e.duration)); }); po.observe({type: 'longtask', buffered: false}); } catch {}
  return () => {
    on = false; po?.disconnect();
    const g = []; for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
    const s = g.slice().sort((a, b) => a - b);
    return {frames: ts.length, medianGap: r1(s[s.length >> 1] || 0), p99Gap: r1(s[Math.floor(s.length * .99)] || 0), maxGap: r1(s[s.length - 1] || 0),
      over20: g.filter(x => x > 20).length, longTasks: lt};
  };
}

// ---------------------------------------------------------------- signal helpers
function peak(chs) { let p = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; } return p; }
// 4x oversampled true peak (Hann-windowed sinc, 16 taps each side)
function truePeak(chs) {
  const T = 16, ph = [.25, .5, .75].map(f => { const k = []; for (let j = -T + 1; j <= T; j++) { const x = j - f, w = .5 + .5 * Math.cos(Math.PI * x / T); k.push(x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x) * w); } return k; });
  let p = peak(chs);
  for (const c of chs) for (let i = T; i < c.length - T; i++) for (const k of ph) { let s = 0; for (let j = 0; j < k.length; j++) s += k[j] * c[i - T + 1 + j]; const a = Math.abs(s); if (a > p) p = a; }
  return p;
}
// second difference: clicks are steps/kinks, which show up as isolated |d2| spikes
function d2(c) { const o = new Float32Array(c.length); for (let i = 2; i < c.length; i++) o[i] = Math.abs(c[i] - 2 * c[i - 1] + c[i - 2]); return o; }
function maxIn(a, sr, t0, t1) { let m = 0; for (let i = Math.max(0, Math.floor(t0 * sr)); i < Math.min(a.length, Math.ceil(t1 * sr)); i++) if (a[i] > m) m = a[i]; return m; }
function pctIn(a, sr, t0, t1, q) { const s = Array.from(a.subarray(Math.floor(t0 * sr), Math.floor(t1 * sr))).sort((x, y) => x - y); return s[Math.floor(s.length * q)] || 0; }
function rmsWin(c, sr, t, w = .02) { let s = 0, n = 0; for (let i = Math.floor(t * sr); i < Math.floor((t + w) * sr) && i < c.length; i++) { s += c[i] * c[i]; n++; } return Math.sqrt(s / Math.max(1, n)); }
// local spike ratio: the largest |d2| within +-w of t, against the |d2| level of the same signal nearby (p99.9 of the
// 200 ms before and after the window). ~1 means the event added nothing; a click shows as >> 2.
function spike(D, sr, t, w = .01) {
  const loc = maxIn(D, sr, t - w, t + w);
  const ref = Math.max(pctIn(D, sr, Math.max(0, t - .21), t - w, .999), pctIn(D, sr, t + w, t + .21, .999), 1e-9);
  return r2(loc / ref);
}
const mono = buf => { const n = buf.length, o = new Float32Array(n); for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let i = 0; i < n; i++) o[i] += x[i] / buf.numberOfChannels; } return o; };

// ---------------------------------------------------------------- shared state
const S = {ac: null, bakery: null};
const SET = [
  {recipe: 'impact', case: 'wood', priority: 1},
  {recipe: 'footstep', case: 'stone', priority: 1},
  {recipe: 'explosion', case: 'barrel', priority: 3},
  {recipe: 'stream', case: 'brook', priority: 6},
];
function ctx() { if (!S.ac) S.ac = new AudioContext({latencyHint: 'interactive'}); return S.ac; }
const bank = (r, c) => S.bakery.get(r, c);

const T = window.T = {};

// 1. bake the test set; frame gaps while baking. Leaves S.bakery ready for the other tests.
T.bake = async ({workers = 'auto', suspend = true} = {}) => {
  const ac = ctx(); if (suspend && ac.state === 'running') await ac.suspend();   // bakes must not need a running context
  S.bakery?.dispose();
  const B = S.bakery = createBakery(ac, {workers});
  const readyOrder = []; B.onReady(b => readyOrder.push(b.recipe + '/' + b.case));
  await sleep(300);   // worker spin-up + let rAF settle
  const mon = frameMon(), t0 = performance.now();
  const dup = B.request('impact', 'wood', {priority: 1}) === B.request('impact', 'wood', {priority: 9});
  await B.prefetch(SET);
  const wall = performance.now() - t0; await sleep(100); const frames = mon();
  const banks = SET.map(s => { const b = bank(s.recipe, s.case); return {bank: s.recipe + '/' + s.case, variants: b.buffers.length, ch: b.buffers[0].numberOfChannels,
    durS: b.buffers.map(x => r2(x.duration)), workerMs: r1(b.ms), msPerVariant: r1(b.ms / b.buffers.length), buildMs: r2(b.buildMs), wallMs: r1(b.wallMs),
    KB: Math.round(b.bytes / 1024), loop: b.loop, version: b.version, pass: b.metrics.filter(m => m.pass).length + '/' + b.metrics.length,
    lufsM: b.metrics.map(m => r1(m.lufsM))}; });
  const audioS = banks.reduce((s, b) => s + b.durS.reduce((a, x) => a + x, 0) * 1, 0);
  // a failing request: unknown case and unknown recipe reject only themselves
  let e1 = null, e2 = null;
  await B.request('impact', 'nope').catch(e => (e1 = String(e.message).split('\n')[0]));
  await B.request('no_such_recipe', 'x').catch(e => (e2 = String(e.message).split('\n')[0]));
  const after = await B.request('footstep', 'grass').then(b => 'ok, ' + b.buffers.length + ' variants').catch(e => 'FAIL ' + e.message);
  if (suspend) await ac.resume();
  return {sr: ac.sampleRate, workers: B.stats.workers, hc: navigator.hardwareConcurrency, wallMs: r1(wall), sumWorkerMs: r1(B.stats.ms), sumBuildMs: r2(B.stats.buildMs),
    audioSeconds: r1(audioS), xRealtime: r1(audioS / (wall / 1000)), dupSamePromise: dup, readyOrder, banks, frames,
    errors: {unknownCase: e1, unknownRecipe: e2, nextJobAfterErrors: after}, stats: B.stats};
};

// 2. the whole library: every case of every registered recipe at its default variant count
T.bakeAll = async ({workers = 'auto'} = {}) => {
  const ac = ctx(); const {RECIPES} = await import('../../forge/recipes/index.js');
  const list = [];
  for (const id of RECIPES) { try { const r = (await import(`../../forge/recipes/${id}.js`)).default; for (const c of Object.keys(r.cases || {})) list.push({recipe: id, case: c, priority: 5}); } catch {} }
  const B = createBakery(ac, {workers});
  await sleep(300);
  const mon = frameMon(), t0 = performance.now();
  await B.prefetch(list);
  const wall = performance.now() - t0; const frames = mon();
  const banks = B.banks(); let audioS = 0, variants = 0;
  for (const b of banks) for (const x of b.buffers) { audioS += x.duration; variants++; }
  const per = {}; for (const b of banks) { const k = b.recipe; per[k] = per[k] || {ms: 0, KB: 0, banks: 0}; per[k].ms += b.ms; per[k].KB += b.bytes / 1024; per[k].banks++; }
  for (const k in per) { per[k].ms = Math.round(per[k].ms); per[k].KB = Math.round(per[k].KB); }
  const slow = banks.map(b => ({bank: b.recipe + '/' + b.case, ms: Math.round(b.ms), msPerVariant: Math.round(b.ms / b.buffers.length), KB: Math.round(b.bytes / 1024)})).sort((a, b) => b.ms - a.ms).slice(0, 8);
  const st = B.stats; B.dispose();
  return {workers: st.workers, jobs: list.length, done: st.done, failed: st.failed, errors: st.errors, variants, audioSeconds: r1(audioS), wallMs: Math.round(wall),
    sumWorkerMs: Math.round(st.ms), sumBuildMs: r1(st.buildMs), MB: r1(st.bytes / 1048576), xRealtime: r1(audioS / (wall / 1000)), frames, perRecipe: per, slowest: slow};
};

// 3. voice manager on the live context
T.voices = async () => {
  const ac = ctx(); if (ac.state !== 'running') await ac.resume();
  const EN = S.EN = createEngine(ac, {maxVoices: 32});
  const an = ac.createAnalyser(); an.fftSize = 2048; EN.output.connect(an);
  const buf = new Float32Array(2048); let pk = 0, polling = true;
  (function poll() { an.getFloatTimeDomainData(buf); for (const v of buf) pk = Math.max(pk, Math.abs(v)); if (polling) setTimeout(poll, 8); })();
  const imp = bank('impact', 'wood').buffers, exp = bank('explosion', 'barrel').buffers, step = bank('footstep', 'stone').buffers;
  const out = {state: ac.state, baseLatency: ac.baseLatency, outputLatency: ac.outputLatency};
  const t0c = ac.currentTime; await sleep(200); out.clockAdvances = r2(ac.currentTime - t0c);
  async function burst(n, spanMs, mk) {
    EN.stopAll(.01); await sleep(150); EN.resetStats();
    const ts = performance.now(), c0 = ac.currentTime; let started = 0; const res = [];
    await new Promise(done => { for (let i = 0; i < n; i++) setTimeout(() => { res.push(EN.play(...mk(i))); if (++started === n) done(); }, i * spanMs / Math.max(1, n - 1)); });
    const span = r1(performance.now() - ts), ctxSpan = r1((ac.currentTime - c0) * 1000);
    const s = EN.stats; await sleep(50);
    return {plays: n, spanMs: span, ctxSpanMs: ctxSpan, started: res.filter(Boolean).length, voices: s.voices, peakVoices: s.peakVoices,
      culled: s.culled, stolen: s.stolen, coalesced: s.coalesced, rejected: s.rejected,
      mergedCounts: res.filter(Boolean).map(v => v.count)};
  }
  const hit = {bus: 'sfx.impacts', key: 'hit', maxInstances: 6, steal: 'quietest', priority: 60, gainDb: -2, send: .15};
  out.coalesceOn = await burst(30, 50, i => [imp[i % imp.length], {...hit, coalesceMs: 40, pan: (i % 7 - 3) / 4}]);
  out.coalesceOff = await burst(30, 50, i => [imp[i % imp.length], {...hit, coalesceMs: 0, pan: (i % 7 - 3) / 4}]);
  // 60 plays in ~100 ms: mixed long explosions and impacts, distances 0..30 m, priorities 30..70, 10 keys
  let seed = 12345; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  pk = 0;
  out.cap60 = await burst(60, 100, i => { const d = R() * 30; return [i % 3 ? imp[i % 6] : exp[i % 6], {bus: i % 3 ? 'sfx.impacts' : 'sfx.world', key: 'k' + (i % 10),
    maxInstances: 8, steal: 'quietest', priority: 30 + Math.floor(R() * 41), dist: d, pan: R() * 2 - 1, gainDb: -2}]; });
  await sleep(400); out.cap60.livePeakDbfs = r2(dB(pk));
  out.cap60.voicesAfter400ms = EN.stats.voices;
  // footsteps at low priority while 32 high-priority voices are up: they must be rejected, not steal
  EN.stopAll(.01); await sleep(100); EN.resetStats();
  for (let i = 0; i < 32; i++) EN.play(exp[i % 6], {bus: 'sfx.world', priority: 80, gainDb: -30, key: 'big' + i});
  const stepRes = []; for (let i = 0; i < 5; i++) stepRes.push(!!EN.play(step[i], {bus: 'sfx.foot', priority: 20, key: 'foot', maxInstances: 2}));
  out.lowPriorityAtCap = {played: stepRes.filter(Boolean).length, ...(({voices, stolen, rejected}) => ({voices, stolen, rejected}))(EN.stats)};
  // cull: past maxDist, and below cullDb
  EN.stopAll(.01); await sleep(100); EN.resetStats();
  EN.play(imp[0], {dist: 26}); EN.play(imp[0], {dist: 20, gainDb: -25}); EN.play(imp[0], {dist: 4});
  out.cull = (({culled, played}) => ({culled, played}))(EN.stats);
  // disconnect on end: everything gone once the voices finish
  await sleep(1500); out.afterEnd = (({voices}) => ({voices}))(EN.stats);
  // suspended: play() is skipped, loop() waits and starts on resume
  await ac.suspend(); EN.resetStats();
  const v = EN.play(imp[0], {}); const h = EN.loop(bank('stream', 'brook').buffers[0], {bus: 'amb.beds', gainDb: -12, fadeIn: .3});
  out.suspended = {playReturned: v, skipped: EN.stats.skipped, loopPlaying: h.playing};
  await ac.resume(); await sleep(400); pk = 0; await sleep(300);
  out.suspended.loopAudibleAfterResumeDbfs = r1(dB(pk));
  // reverb switch on the live context: the old convolver is disconnected after its fade
  EN.setReverb('rift', .5); out.reverbLive = {slotsDuring: EN.stats.reverbSlots}; await sleep(1200); out.reverbLive.slotsAfter = EN.stats.reverbSlots; out.reverbLive.current = EN.reverb;
  h.stop(.3); await sleep(600); out.loopsAfterStop = EN.stats.loops;
  polling = false; out.irBuild = EN.irStats();
  return out;
};

// 4. limiter: an overload render through the real graph, with and without the limiter
T.limiter = async () => {
  const sr = S.bakery.sampleRate;
  const imp = bank('impact', 'wood').buffers, exp = bank('explosion', 'barrel').buffers, step = bank('footstep', 'stone').buffers;
  async function render(bypass, fill) {
    const oc = new OfflineAudioContext(2, sr * 3, sr);
    const EN = createEngine(oc, {maxVoices: 200, bypassLimiter: bypass});
    fill(EN);
    const out = await oc.startRendering();
    return {pk: peak([out.getChannelData(0), out.getChannelData(1)]), tp: truePeak([out.getChannelData(0), out.getChannelData(1)]), buf: out};
  }
  const overload = EN => { for (let i = 0; i < 24; i++) EN.play(exp[i % 6], {at: .1 + i * .004, gainDb: 0, pan: (i % 5 - 2) / 3, priority: 90});
    for (let i = 0; i < 30; i++) EN.play(imp[i % 6], {at: .1 + i * .003, gainDb: 0, key: null, pan: (i % 3 - 1) / 2});
    for (let i = 0; i < 12; i++) EN.play(step[i % 8], {at: .12 + i * .01, gainDb: 0}); };
  const single = EN => EN.play(imp[0], {at: 1, gainDb: -6, send: 0});   // after the compressor's start-up release
  const ex = EN => EN.play(exp[0], {at: .1, gainDb: 0, send: .15});
  const a = await render(false, overload), b = await render(true, overload);
  const c = await render(false, single), d = await render(true, single);
  const e = await render(false, ex), f = await render(true, ex);
  return {
    overload: {plays: 66, preLimiterPeakDbfs: r2(dB(b.pk)), preLimiterTruePeak: r2(dB(b.tp)), outPeakDbfs: r2(dB(a.pk)), outTruePeakDbfs: r2(dB(a.tp))},
    oneExplosion: {pre: r2(dB(f.pk)), out: r2(dB(e.pk)), outTP: r2(dB(e.tp))},
    quietImpactUnity: {pre: r2(dB(d.pk)), out: r2(dB(c.pk)), diffDb: r2(dB(c.pk) - dB(d.pk))},
  };
};

// 5. loops: fade in, ramps, virtualise and come back, the wrap, stop with fade -- all rendered offline and checked for clicks
T.loops = async () => {
  const sr = S.bakery.sampleRate, b = bank('stream', 'brook').buffers[0], L = b.duration;
  // the buffer seam itself (last sample -> first sample) against its typical step
  const seam = [];
  for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c), dd = d2(x), n = x.length;
    const wrap = Math.max(Math.abs(x[0] - 2 * x[n - 1] + x[n - 2]), Math.abs(x[1] - 2 * x[0] + x[n - 1]));
    seam.push(r2(wrap / pctIn(dd, sr, .1, L - .1, .999))); }
  const tStop = L + .8, fo = .5, dur = L + 1.6;
  const oc = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const EN = createEngine(oc, {reverb: null});
  let h; const ev = {};
  const at = (t, fn) => oc.suspend(Math.round(t * sr / 128) * 128 / sr).then(() => { fn(); oc.resume(); });
  h = EN.loop(b, {bus: 'amb.emitters', gainDb: -6, fadeIn: .5, send: 0, dist: 1});
  at(2.0, () => { h.setGainDb(-14, .05); h.setLpf(900, .08); h.setPan(.6, .05); });
  at(2.6, () => { h.setGainDb(-6, .05); h.setLpf(null, .08); h.setPan(0, .05); });
  at(3.2, () => { h.setDist(40); ev.virtualAfterFar = h.virtual; ev.virtualCount = EN.stats.virtual; });
  at(3.7, () => { h.setDist(1); ev.virtualAfterNear = h.virtual; });
  at(tStop, () => h.stop(fo));
  const out = await oc.startRendering(), m = mono(out), D = d2(m);
  const rmsDb = t => r1(dB(rmsWin(m, sr, t, .02)));
  return {
    loopSeconds: r2(L), channels: b.numberOfChannels, seamRatio: seam,
    fadeIn: {first10msPeakDbfs: r1(dB(maxIn(m.map(Math.abs), sr, 0, .01))), rmsDb_0_10_25_50: [rmsDb(0), rmsDb(.1), rmsDb(.25), rmsDb(.5)], spikeStart: spike(D, sr, .005)},
    ramps: {spikeAt2_0: spike(D, sr, 2.0, .06), spikeAt2_6: spike(D, sr, 2.6, .06), rmsBefore: rmsDb(1.9), rmsDuring: rmsDb(2.4), rmsAfter: rmsDb(2.95)},
    virtual: {...ev, rmsWhileVirtualDb: rmsDb(3.45), rmsBackDb: rmsDb(3.95), spikeOut: spike(D, sr, 3.2, .06), spikeBack: spike(D, sr, 3.7, .06)},
    wrap: {at: r2(L), spike: spike(D, sr, L, .005)},
    stop: {spikeStopStart: spike(D, sr, tStop, .01), rmsMidFadeDb: rmsDb(tStop + fo / 2), rmsAfterFadeDb: rmsDb(tStop + fo + .1), playing: h.playing, loopsLeft: EN.stats.loops},
  };
};

// 6. snapshots: two overlapping ducks on the same bus, measured against an unducked render
T.snapshots = async () => {
  const sr = S.bakery.sampleRate, b = bank('stream', 'brook').buffers[0];
  async function render(withSnaps) {
    const oc = new OfflineAudioContext(2, sr * 3, sr), EN = createEngine(oc, {reverb: null});
    EN.loop(b, {bus: 'amb.beds', gainDb: -6, fadeIn: 0, send: 0});
    EN.loop(b, {bus: 'music', gainDb: -40, fadeIn: 0, send: 0, offset: 1});   // music sits far under, just to carry a second bus
    if (withSnaps) {
      oc.suspend(Math.round(.5 * sr / 128) * 128 / sr).then(() => { EN.snapshot('explosionDuck', {buses: {amb: -6, music: -4}, attack: .02, hold: .1, release: .6}); oc.resume(); });
      oc.suspend(Math.round(.56 * sr / 128) * 128 / sr).then(() => { EN.snapshot('hitstop', {buses: {amb: -3}, attack: .02, hold: .2, release: .3}); oc.resume(); });
      oc.suspend(Math.round(1.6 * sr / 128) * 128 / sr).then(() => { S.pause = EN.snapshot('pause', {buses: {amb: -10}, attack: .05, hold: Infinity, release: .2}); oc.resume(); });
      oc.suspend(Math.round(2.2 * sr / 128) * 128 / sr).then(() => { S.pause.release(); oc.resume(); });
    }
    return mono(await oc.startRendering());
  }
  const ref = await render(false), duck = await render(true);
  const curve = []; for (let t = .4; t < 2.9; t += .05) curve.push([r2(t), r1(dB(rmsWin(duck, sr, t, .02)) - dB(rmsWin(ref, sr, t, .02)))]);
  return {expect: 'amb: 0 -> -6 (0.52) -> -9 (0.58..0.62) -> back to 0 by ~1.3; pause -10 from 1.6, released at 2.2 over .2 s', curveDb: curve,
    spikes: [.5, .56, 1.6, 2.2].map(t => spike(d2(duck), sr, t, .03))};
};

// 7. reverb: IR RT60s (measured with the forge's own metrics) and a click-free crossfade under a continuous send
T.reverb = async () => {
  const sr = S.bakery.sampleRate, irs = {};
  for (const [k, p] of Object.entries(REVERBS)) {
    const t = performance.now(), [L, R] = buildIR(sr, p), ms = performance.now() - t;
    const mL = analyze(L, sr), mR = analyze(R, sr);
    let lr = 0, ll = 0, rr = 0; for (let i = 0; i < L.length; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
    irs[k] = {targetRt: p.rt, t60s: r2(((mL.t60Ms || 0) + (mR.t60Ms || 0)) / 2000), centroidHz: Math.round(mL.centroidHz), lenS: r2(L.length / sr), buildMs: r1(ms), lrCorr: r2(lr / Math.sqrt(ll * rr))};
  }
  const b = bank('stream', 'brook').buffers[0], imp = bank('impact', 'wood').buffers[0];
  // the same continuous send rendered twice: with biome switches at 1 s (ruins -> rift) and 3 s (-> frost), and without
  async function render(sw) {
    const oc = new OfflineAudioContext(2, sr * 5, sr), EN = createEngine(oc, {reverb: 'ruins'});
    EN.loop(b, {bus: 'sfx.world', gainDb: -6, fadeIn: 0, send: 1});
    const at = (t, fn) => oc.suspend(Math.round(t * sr / 128) * 128 / sr).then(() => { fn(); oc.resume(); });
    if (sw) { at(1, () => EN.setReverb('rift', 1)); at(3, () => EN.setReverb('frost', 1)); }
    return mono(await oc.startRendering());
  }
  const out = await render(true), ref = await render(false), D = d2(out), Dr = d2(ref);
  const step = (x, t0, t1) => { let m = 0; for (let t = t0; t < t1; t += .02) m = Math.max(m, Math.abs(dB(rmsWin(x, sr, t + .02, .02)) - dB(rmsWin(x, sr, t, .02)))); return r2(m); };
  const wet = (x, y, t) => r1(dB(rmsWin(x, sr, t, .1)) - dB(rmsWin(y, sr, t, .1)));   // switched vs ruins-only level
  // wet tails: one impact, send 1, dry muted via a 1-sample-later... measure the decay of the whole output per biome
  const tails = {};
  for (const k of Object.keys(REVERBS)) {
    const o2 = new OfflineAudioContext(2, sr * 3.5, sr), E2 = createEngine(o2, {reverb: k});
    E2.play(imp, {at: .05, send: 1, gainDb: -6}); const x = mono(await o2.startRendering());
    tails[k] = {rmsAt_0_5s: r1(dB(rmsWin(x, sr, .55, .05))), rmsAt_1_0s: r1(dB(rmsWin(x, sr, 1.05, .05))), rmsAt_2_0s: r1(dB(rmsWin(x, sr, 2.05, .05)))};
  }
  return {irs, crossfade: {
    d2MaxRatio_vs_noSwitch_0_9to2_1: r2(maxIn(D, sr, .9, 2.1) / maxIn(Dr, sr, .9, 2.1)), d2MaxRatio_vs_noSwitch_2_9to4_1: r2(maxIn(D, sr, 2.9, 4.1) / maxIn(Dr, sr, 2.9, 4.1)),
    rms20msMaxStepDb: {switched_0_9to2_1: step(out, .9, 2.1), noSwitch_0_9to2_1: step(ref, .9, 2.1), switched_2_9to4_1: step(out, 2.9, 4.1), noSwitch_2_9to4_1: step(ref, 2.9, 4.1)},
    levelVsRuinsOnlyDb: [[.5, wet(out, ref, .5)], [1.25, wet(out, ref, 1.25)], [1.5, wet(out, ref, 1.5)], [2.5, wet(out, ref, 2.5)], [3.5, wet(out, ref, 3.5)], [4.5, wet(out, ref, 4.5)]]},
    impactTails: tails};
};

T.limiterCal = async () => {
  const sr = 48000, n = sr * 3, sine = new AudioBuffer({length: n, sampleRate: sr}), x = sine.getChannelData(0);
  for (let i = 0; i < n; i++) x[i] = .1 * Math.sin(2 * Math.PI * 440 * i / sr);
  const r = async bypass => { const oc = new OfflineAudioContext(2, n, sr), EN = createEngine(oc, {reverb: null, bypassLimiter: bypass}); EN.play(sine, {send: 0}); return mono(await oc.startRendering()); };
  const a = await r(false), b = await r(true);
  return [.01, .05, .1, .2, .5, 1, 2].map(t => [t, r2(dB(rmsWin(a, sr, t, .02)) - dB(rmsWin(b, sr, t, .02)))]);
};

T.all = async () => {
  const r = {};
  r.bake = await T.bake(); r.limiter = await T.limiter(); r.loops = await T.loops(); r.snapshots = await T.snapshots(); r.reverb = await T.reverb(); r.voices = await T.voices();
  return r;
};
document.getElementById('all').onclick = async () => { document.getElementById('out').textContent = 'running...'; document.getElementById('out').textContent = JSON.stringify(await T.all(), null, 1); };
