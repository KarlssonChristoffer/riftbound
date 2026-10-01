// ENGINE: the mix, voices and space (docs/AUDIO.md §3.2-3.4, audio/runtime/CONTRACT.md). Plain Web Audio, no deps.
//
//   const EN = createEngine(ac, {maxVoices: 32, reverb: 'ruins'});
//   EN.play(buffer, {bus: 'sfx.impacts', gainDb, rate, pan, dist, lpf, send, at, priority, key, maxInstances, steal,
//                    coalesceMs, cullDb, minDist, maxDist}) -> Voice | null
//   EN.loop(buffer, {bus, gainDb, pan, dist, lpf, send, fadeIn, offset, rate, cullDb}) -> LoopHandle
//   EN.snapshot(name, {buses: {amb: -6}, attack, hold, release}) -> {release()}
//   EN.setReverb(biome, fade = 1), EN.bus(name), EN.setBusDb(name, db, tc), EN.limiter, EN.stats
//
// GRAPH
//   voice : BufferSource -> gain -> (lowpass, only when far or asked) -> StereoPanner -> bus.in      (dry)
//                                                                       StereoPanner -> send -> bus.wet (reverb)
//   bus   : in (base level) -> duck (snapshots) -> parent.in          wet -> wetDuck -> parent.wet | reverb in
//           every bus has a mirrored wet path with the same gains, so a muted or ducked bus mutes its reverb too
//   reverb: reverbIn -> ConvolverNode (one per IR, crossfaded; .buffer is set before it is connected) -> 'reverb' bus
//   master: 'master' in -> duck -> limiter (DynamicsCompressor) -> trim (cancels Chrome's auto makeup gain) -> destination
//
// A one-shot play() while the context isn't running returns null (counted as `skipped`), so nothing piles up and fires
// at unlock. Loops, snapshots, bus levels and reverb work while suspended and simply start when it resumes.
// An OfflineAudioContext counts as running (the tests render the real graph offline).

const DB = db => Math.pow(10, db / 20);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const BUSES = {
  master: null,
  music: 'master',
  amb: 'master', 'amb.beds': 'amb', 'amb.spots': 'amb', 'amb.emitters': 'amb',
  sfx: 'master', 'sfx.player': 'sfx', 'sfx.impacts': 'sfx', 'sfx.world': 'sfx', 'sfx.foot': 'sfx',
  ui: 'master',
  reverb: 'master',   // the reverb return
};

// Synthetic room IRs per biome. rt = RT60 (s); lp0 -> lp1 = how the tail darkens (damping); er = early reflections;
// wet = return level (dB) so the biomes sit at a similar perceived send.
export const REVERBS = {
  ruins: {rt: .9, pre: .007, lp0: 9000, lp1: 2200, hp: 140, er: 9, erSpan: .05, erGain: .55, width: .9, wet: 0},
  ember: {rt: .6, pre: .004, lp0: 5500, lp1: 1200, hp: 160, er: 7, erSpan: .03, erGain: .5, width: .8, wet: -1},
  frost: {rt: 1.4, pre: .012, lp0: 13000, lp1: 5500, hp: 120, er: 10, erSpan: .07, erGain: .45, width: 1, wet: -1},
  rift: {rt: 2.2, pre: .02, lp0: 7000, lp1: 1600, hp: 100, er: 6, erSpan: .09, erGain: .3, width: 1, wet: -2},
};

// mulberry32: deterministic IRs
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Build a stereo IR in plain JS: decorrelated noise under an exponential decay (-60 dB at rt), through a one-pole
// low-pass whose cutoff falls from lp0 to lp1 over rt (RMS-compensated so the decay stays the stated RT), a soft
// build-up of diffusion, early reflections, a gentle high-pass; normalised to unit energy per channel.
export function buildIR(sr, p, seed = 7) {
  const R = rng(seed), len = Math.ceil((p.pre + p.rt * 1.15) * sr), L = new Float32Array(len), Rr = new Float32Array(len);
  const pre = Math.round(p.pre * sr), k60 = -6.907755 / p.rt;   // ln(1e-3) / rt
  for (const out of [L, Rr]) {
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const fc = p.lp0 * Math.pow(p.lp1 / p.lp0, Math.min(1, t / p.rt));
      const k = 1 - Math.exp(-2 * Math.PI * fc / sr), norm = 1 / Math.sqrt(k / (2 - k));
      y += ((R() * 2 - 1) - y) * k;
      const build = 1 - Math.exp(-t / .012);
      out[i] = y * norm * Math.exp(k60 * t) * build;
    }
  }
  // stereo width: blend toward mid
  const w = p.width ?? 1;
  if (w < 1) for (let i = 0; i < len; i++) { const m = (L[i] + Rr[i]) * .5, s = (L[i] - Rr[i]) * .5 * w; L[i] = m + s; Rr[i] = m - s; }
  // early reflections: short smeared taps, panned, decaying with the room
  for (let j = 0; j < p.er; j++) {
    const t = p.pre * .5 + Math.pow(R(), 1.3) * p.erSpan, i0 = Math.round(t * sr);
    const a = p.erGain * (R() * .5 + .5) * Math.exp(k60 * t) * (R() < .5 ? -1 : 1), pan = R() * 2 - 1;
    const gl = a * Math.cos((pan + 1) * Math.PI / 4), gr = a * Math.sin((pan + 1) * Math.PI / 4);
    const smear = 2 + Math.floor(R() * 5);
    for (let s = 0; s < smear && i0 + s < len; s++) { const h = .5 - .5 * Math.cos(2 * Math.PI * (s + 1) / (smear + 1)); L[i0 + s] += gl * h; Rr[i0 + s] += gr * h; }
  }
  // high-pass (one-pole) to keep the room out of the mud, then unit energy per channel
  const hk = Math.exp(-2 * Math.PI * p.hp / sr);
  for (const c of [L, Rr]) {
    let x1 = 0, y1 = 0; for (let i = 0; i < len; i++) { const y = (c[i] - x1 + hk * y1); x1 = c[i]; y1 = y; c[i] = y; }
    let e = 0; for (let i = 0; i < len; i++) e += c[i] * c[i];
    const g = 1 / Math.sqrt(e || 1); for (let i = 0; i < len; i++) c[i] *= g;
  }
  return [L, Rr];
}

export function createEngine(ac, {maxVoices = 32, minDist = 2, maxDist = 25, lpfStart = 3, lpfFar = 4000, panLimit = .8,
  reverb = 'ruins', reverbs = REVERBS, limiterTrim = true, bypassLimiter = false} = {}) {   // bypassLimiter: measurement only
  const isOffline = typeof OfflineAudioContext !== 'undefined' && ac instanceof OfflineAudioContext;
  const live = () => isOffline || ac.state === 'running';
  const st = {voices: 0, peakVoices: 0, loops: 0, virtual: 0, played: 0, culled: 0, stolen: 0, coalesced: 0, rejected: 0, skipped: 0};

  // ------------------------------------------------------------------ automation helpers
  const hold = (param, t) => {
    if (param.cancelAndHoldAtTime) { try { param.cancelAndHoldAtTime(t); return; } catch {} }
    const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t);
  };
  const target = (param, v, tc, t = ac.currentTime) => { hold(param, t); if (tc > 0) param.setTargetAtTime(v, t, tc); else param.setValueAtTime(v, t); };   // tc = time constant (s)
  // equal-power fade of a gain param from its current value to `to` over dur (sin in, cos out): crossfades stay level
  const fade = (param, to, dur, t = ac.currentTime) => {
    hold(param, t);
    const from = param.value;
    if (!(dur > 0) || Math.abs(from - to) < 1e-6) { param.setValueAtTime(to, t); return; }
    const n = 48, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1); c[i] = to > from ? from + (to - from) * Math.sin(x * Math.PI / 2) : to + (from - to) * Math.cos(x * Math.PI / 2); }
    try { param.setValueCurveAtTime(c, t, dur); } catch { param.setValueAtTime(from, t); param.linearRampToValueAtTime(to, t + dur); }
  };

  // ------------------------------------------------------------------ buses
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.knee.value = 0; limiter.attack.value = .001; limiter.release.value = .15;
  // Chrome (and the spec) add makeup gain = (1 / curve(0 dBFS))^0.6 to everything: about +1.6 dB with these settings
  // (measured 1.62 dB in Chrome 2026-10 with a -20 dBFS sine). The trim takes it back, so material under the threshold
  // passes at unity (±0.01 dB) and the ceiling lands near -1.5 dBTP. Note: Chrome's compressor starts in gain reduction
  // and releases over ~0.2 s, so the first ~200 ms after the engine is created are quieter (create it at load).
  const makeupDb = 1.62;
  const trim = ac.createGain(); trim.gain.value = limiterTrim ? DB(-makeupDb) : 1;
  limiter.connect(trim); trim.connect(ac.destination);
  const reverbIn = ac.createGain();
  const buses = new Map();
  function mkBus(name) {
    if (buses.has(name)) return buses.get(name);
    const parentName = name in BUSES ? BUSES[name] : (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : 'master');
    const parent = parentName ? mkBus(parentName) : null;
    const b = {name, parent, baseDb: 0, in: ac.createGain(), duck: ac.createGain(), wet: null, wetDuck: null};
    b.in.connect(b.duck);
    if (!parent) b.duck.connect(bypassLimiter ? ac.destination : limiter); else b.duck.connect(parent.in);
    if (parent && name !== 'reverb') {
      b.wet = ac.createGain(); b.wetDuck = ac.createGain(); b.wet.connect(b.wetDuck);
      b.wetDuck.connect(parent.wet || reverbIn);
    }
    b.defSend = /^(ui|music|reverb)/.test(name) ? 0 : .15;
    buses.set(name, b);
    return b;
  }
  for (const n of Object.keys(BUSES)) mkBus(n);
  const busOf = name => mkBus(name || 'sfx');   // unknown dotted names are created under their parent ('sfx.enemies' -> under 'sfx')
  function setBusDb(name, db, tc = .05) {
    const b = busOf(name); b.baseDb = db; const g = DB(db);
    target(b.in.gain, g, tc); if (b.wet) target(b.wet.gain, g, tc);
  }

  // ------------------------------------------------------------------ spatial
  const distDb = (d, minD = minDist) => (d <= minD ? 0 : -20 * Math.log10(d / minD));
  const distLpf = (d, maxD = maxDist) => (d <= lpfStart ? null : 20000 * Math.pow(lpfFar / 20000, clamp((d - lpfStart) / Math.max(.001, maxD - lpfStart), 0, 1)));
  // the reverb send loses only half the distance attenuation (-3 dB per doubling): far sounds get wetter
  const sendComp = dDb => DB(-dDb / 2);

  // ------------------------------------------------------------------ voices
  const active = new Set();      // live one-shot voices (not stolen/fading)
  const groups = new Map();      // key -> Set<voice>
  const level = (v, now) => v.db - (now > v.t0 ? 60 * (now - v.t0) / v.dur : 0);   // rough current level (dB)
  function detach(v) {
    active.delete(v);
    const g = v.key != null && groups.get(v.key); if (g) { g.delete(v); if (!g.size) groups.delete(v.key); }
    st.voices = active.size;
  }
  function kill(v, f = .015) {
    if (v.done) return;
    detach(v); v.fading = true;
    const now = ac.currentTime;
    hold(v.g.gain, now); v.g.gain.linearRampToValueAtTime(0, now + f);
    try { v.src.stop(now + f + .005); } catch {}
  }
  function pickVictim(set, policy, now) {
    let best = null, bv = Infinity;
    for (const v of set) {
      const s = policy === 'oldest' ? v.t0 : policy === 'furthest' ? -v.dist : level(v, now);
      if (s < bv) { bv = s; best = v; }
    }
    return best;
  }
  function play(buffer, o = {}) {
    if (!buffer) return null;
    if (!live()) { st.skipped++; return null; }
    const now = ac.currentTime, t = Math.max(now, o.at ?? now);
    const d = Math.max(0, o.dist || 0), minD = o.minDist ?? minDist, maxD = o.maxDist ?? maxDist;
    if (d > maxD) { st.culled++; return null; }
    const dDb = distDb(d, minD), db = (o.gainDb || 0) + dDb;
    if (db < (o.cullDb ?? -40)) { st.culled++; return null; }
    const pri = (o.priority ?? 50) - 20 * clamp(d / maxD, 0, 1);
    const key = o.key ?? null, grp = key != null ? groups.get(key) : null;
    // coalescing: merge into the newest voice of this key that started within the window
    if (grp && o.coalesceMs > 0) {
      let v = null; for (const x of grp) if (!v || x.t0 > v.t0) v = x;
      if (v && Math.abs(t - v.t0) * 1000 <= o.coalesceMs) {
        v.count++; v.baseDb = Math.max(v.baseDb, db);
        const bump = Math.min(6, 2 * Math.log2(v.count));
        v.db = v.baseDb + bump;
        target(v.g.gain, DB(v.db), .003, now);
        st.coalesced++; return null;
      }
    }
    // per-key instance limit
    if (grp && grp.size >= (o.maxInstances ?? 6)) {
      const pol = o.steal ?? 'quietest';
      if (pol === 'none') { st.rejected++; return null; }
      kill(pickVictim(grp, pol, now)); st.stolen++;
    }
    // global cap: reject below the lowest active priority, else steal the weakest (lowest priority, then quietest)
    if (active.size >= maxVoices) {
      let w = null;
      for (const v of active) if (!w || v.pri < w.pri || (v.pri === w.pri && level(v, now) < level(w, now))) w = v;
      if (pri < w.pri) { st.rejected++; return null; }
      kill(w); st.stolen++;
    }
    const bus = busOf(o.bus || 'sfx');
    const src = ac.createBufferSource(); src.buffer = buffer;
    const rate = o.rate ?? 1; if (rate !== 1) src.playbackRate.value = rate;
    const g = ac.createGain(); g.gain.value = DB(db);
    const lpf = o.lpf ?? distLpf(d, maxD);
    let lp = null;
    if (lpf != null && lpf < 18000) { lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .707; lp.frequency.value = lpf; }
    const pan = ac.createStereoPanner(); pan.pan.value = clamp(o.pan || 0, -panLimit, panLimit);
    src.connect(g); if (lp) { g.connect(lp); lp.connect(pan); } else g.connect(pan);
    pan.connect(bus.in);
    const send = o.send ?? bus.defSend;
    let sg = null;
    if (send > 0 && bus.wet) { sg = ac.createGain(); sg.gain.value = send * sendComp(dDb); pan.connect(sg); sg.connect(bus.wet); }
    const v = {key, t0: t, dur: buffer.duration / rate, db, baseDb: db, pri, dist: d, count: 1, src, g, bus: bus.name, done: false, fading: false,
      nodes: [src, g, lp, pan, sg].filter(Boolean),
      stop: (f = .015) => kill(v, f),
      get playing() { return !v.done && !v.fading; }};
    src.onended = () => { v.done = true; detach(v); for (const n of v.nodes) { try { n.disconnect(); } catch {} } v.nodes.length = 0; };
    src.start(t);
    active.add(v);
    if (key != null) { if (!groups.has(key)) groups.set(key, new Set()); groups.get(key).add(v); }
    st.played++; st.voices = active.size; st.peakVoices = Math.max(st.peakVoices, active.size);
    return v;
  }

  // ------------------------------------------------------------------ loops
  const loops = new Set();
  function loop(buffer, o = {}) {
    const bus = busOf(o.bus || 'amb');
    const rate = o.rate ?? 1, cullDb = o.cullDb ?? -50;
    const fadeG = ac.createGain(), lvl = ac.createGain(), lp = ac.createBiquadFilter(), pan = ac.createStereoPanner();
    lp.type = 'lowpass'; lp.Q.value = .707;
    fadeG.gain.value = 0; fadeG.connect(lvl); lvl.connect(lp); lp.connect(pan); pan.connect(bus.in);
    let sg = null; const send = o.send ?? bus.defSend;
    if (bus.wet) { sg = ac.createGain(); pan.connect(sg); sg.connect(bus.wet); }
    const s = {gainDb: o.gainDb || 0, dist: Math.max(0, o.dist || 0), lpf: o.lpf ?? null, send};
    const t0 = ac.currentTime, off0 = o.offset || 0;
    let src = null, playing = true, virtual = false, endedRes;
    const ended = new Promise(r => (endedRes = r));
    const totalDb = () => s.gainDb + distDb(s.dist);
    const inaudible = () => s.dist > maxDist || totalDb() < cullDb;
    const lpfNow = () => Math.min(20000, s.lpf ?? distLpf(s.dist) ?? 20000);
    function apply(tc) {
      const dDb = distDb(s.dist);
      target(lvl.gain, DB(s.gainDb + dDb), tc);
      target(lp.frequency, lpfNow(), tc);
      if (sg) target(sg.gain, s.send * sendComp(dDb), tc);
    }
    lvl.gain.value = DB(totalDb()); lp.frequency.value = lpfNow(); if (sg) sg.gain.value = s.send * sendComp(distDb(s.dist));
    pan.pan.value = clamp(o.pan || 0, -panLimit, panLimit);
    function startSrc(fadeIn) {
      const now = ac.currentTime;
      src = ac.createBufferSource(); src.buffer = buffer; src.loop = true; if (rate !== 1) src.playbackRate.value = rate;
      src.connect(fadeG);
      const pos = ((off0 + (now - t0) * rate) % buffer.duration + buffer.duration) % buffer.duration;   // keep the clock
      src.start(now, pos);
      const me = src; src.onended = () => { try { me.disconnect(); } catch {} if (!playing && me === lastSrc) finish(); };
      lastSrc = src;
      fade(fadeG.gain, 1, fadeIn, now);
    }
    let lastSrc = null;
    function stopSrc(f) {
      if (!src) return;
      const now = ac.currentTime;
      fade(fadeG.gain, 0, f, now);
      try { src.stop(now + f + .02); } catch {}
      src = null;
    }
    function virtualize() {   // go virtual when inaudible: stop the node, keep the clock; come back at elapsed % duration
      const v = inaudible();
      if (v && !virtual && playing) { virtual = true; stopSrc(.05); st.virtual++; }
      else if (!v && virtual && playing) { virtual = false; st.virtual--; startSrc(.05); }
    }
    function finish() {
      for (const n of [fadeG, lvl, lp, pan, sg]) { if (n) try { n.disconnect(); } catch {} }
      loops.delete(h); st.loops = loops.size; endedRes();
    }
    const h = {
      get playing() { return playing; },
      get virtual() { return virtual; },
      ended,
      setGainDb(db, tc = .1) { s.gainDb = db; if (playing) { apply(tc); virtualize(); } },
      setDist(d, tc = .1) { s.dist = Math.max(0, d); if (playing) { apply(tc); virtualize(); } },
      setPan(p, tc = .1) { if (playing) target(pan.pan, clamp(p, -panLimit, panLimit), tc); },
      setLpf(hz, tc = .1) { s.lpf = hz; if (playing) target(lp.frequency, lpfNow(), tc); },
      setSend(x, tc = .1) { s.send = x; if (playing && sg) target(sg.gain, x * sendComp(distDb(s.dist)), tc); },
      stop(fadeOut = 1.5) {
        if (!playing) return; playing = false;
        if (virtual) { virtual = false; st.virtual--; finish(); return; }
        stopSrc(fadeOut);
      },
    };
    loops.add(h); st.loops = loops.size;
    if (inaudible()) { virtual = true; st.virtual++; } else startSrc(o.fadeIn ?? 1.5);
    return h;
  }

  // ------------------------------------------------------------------ snapshots (stacked ducks)
  // Each active snapshot is an envelope e(t) in 0..1 (attack, hold, release; linear in dB). A bus's duck gain is the
  // sum of e(t) * db over the snapshots touching it, scheduled as exponential ramps between the union of breakpoints
  // (a sum of piecewise-linear dB curves is piecewise linear in dB, so this is exact).
  const snaps = new Map();
  const env = (sn, t) => {
    if (t <= sn.t0) return sn.e0;
    if (t < sn.tA) return sn.e0 + (1 - sn.e0) * (t - sn.t0) / (sn.tA - sn.t0);
    if (t < sn.tR) return 1;
    if (t < sn.tE) return 1 - (t - sn.tR) / (sn.tE - sn.tR);
    return 0;
  };
  function reschedule(busName) {
    const b = busOf(busName), now = ac.currentTime;
    const list = [...snaps.values()].filter(sn => busName in sn.buses && sn.tE > now);
    const dbAt = t => Math.max(-80, list.reduce((s, sn) => s + env(sn, t) * sn.buses[busName], 0));
    const pts = new Set();
    for (const sn of list) for (const p of [sn.tA, sn.tR, sn.tE]) if (p > now && Number.isFinite(p)) pts.add(p);
    for (const param of [b.duck.gain, b.wetDuck?.gain].filter(Boolean)) {
      hold(param, now);
      param.setValueAtTime(DB(dbAt(now)), now);
      for (const p of [...pts].sort((a, c) => a - c)) param.exponentialRampToValueAtTime(DB(dbAt(p)), p);
    }
  }
  function snapshot(name, {buses: bd = {}, attack = .02, hold: hl = .1, release = .6} = {}) {
    const now = ac.currentTime, prev = snaps.get(name);
    const e0 = prev ? env(prev, now) : 0;
    const sn = {name, buses: {...bd}, e0, t0: now, attack, release};
    sn.tA = now + attack * (1 - e0); sn.tR = sn.tA + hl; sn.tE = sn.tR + release;
    snaps.set(name, sn);
    const touched = new Set([...Object.keys(bd), ...(prev ? Object.keys(prev.buses) : [])]);
    for (const n of touched) reschedule(n);
    // forget it once it has fully released
    if (Number.isFinite(sn.tE)) setTimeout(() => { if (snaps.get(name) === sn && ac.currentTime >= sn.tE) snaps.delete(name); }, (sn.tE - now) * 1000 + 250);
    return {
      name,
      release(rel = sn.release) {
        if (snaps.get(name) !== sn) return;
        const t = ac.currentTime, e = env(sn, t);
        if (e <= 0) return;
        // restart the envelope from its current depth straight into release
        sn.e0 = e; sn.t0 = t; sn.tA = t; sn.tR = t; sn.tE = t + rel * e;
        for (const n of Object.keys(sn.buses)) reschedule(n);
      },
    };
  }

  // ------------------------------------------------------------------ reverb
  const irCache = new Map();
  const irBuffer = biome => {
    if (!irCache.has(biome)) {
      const p = reverbs[biome]; if (!p) throw new Error(`unknown reverb '${biome}'`);
      const t = performance.now(), [L, R] = buildIR(ac.sampleRate, p);
      const b = ac.createBuffer(2, L.length, ac.sampleRate); b.copyToChannel(L, 0); b.copyToChannel(R, 1);
      irCache.set(biome, {buffer: b, ms: performance.now() - t});
    }
    return irCache.get(biome).buffer;
  };
  let slots = [], curBiome = null;
  function setReverb(biome, fadeS = 1) {
    if (biome === curBiome || !reverbs[biome]) return;
    const now = ac.currentTime, buf = irBuffer(biome);
    const conv = ac.createConvolver(); conv.normalize = false; conv.buffer = buf;   // set before it is on a live path
    const g = ac.createGain(); g.gain.value = 0;
    conv.connect(g); g.connect(buses.get('reverb').in); reverbIn.connect(conv);
    const wet = DB(reverbs[biome].wet || 0), first = !slots.length;
    for (const sl of slots) {
      fade(sl.g.gain, 0, fadeS, now); sl.out = now + fadeS;
      const done = sl;
      const tidy = () => {
        if (!slots.includes(done) || done.out == null) return;   // came back (shouldn't) or already gone
        if (ac.currentTime < done.out + .05 && !isOffline) { setTimeout(tidy, 200); return; }
        if (isOffline) return;   // offline renders keep their graph
        try { reverbIn.disconnect(done.conv); } catch {} try { done.conv.disconnect(); done.g.disconnect(); } catch {}
        slots = slots.filter(x => x !== done);
      };
      setTimeout(tidy, fadeS * 1000 + 300);
    }
    if (first) g.gain.value = wet; else fade(g.gain, wet, fadeS, now);
    slots.push({biome, conv, g, out: null});
    curBiome = biome;
  }
  if (reverb) setReverb(reverb, 0);

  // ------------------------------------------------------------------ lifecycle
  function unlock() {   // call inside a user gesture: resume, and start a 1-sample silent buffer (iOS)
    try { const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, ac.sampleRate); s.connect(ac.destination); s.start(0); } catch {}
    return ac.state === 'running' || isOffline ? Promise.resolve() : ac.resume();
  }

  return {
    ac,
    bus: name => busOf(name).in,
    setBusDb,
    play,
    loop,
    snapshot,
    setReverb,
    get reverb() { return curBiome; },
    prepareReverbs(list = Object.keys(reverbs)) { for (const k of list) irBuffer(k); },   // build IRs at load, not at the biome change
    limiter,
    output: trim,
    unlock,
    irStats: () => Object.fromEntries([...irCache].map(([k, v]) => [k, {ms: +v.ms.toFixed(2), sec: +(v.buffer.duration).toFixed(2)}])),
    get stats() { return {...st, voices: active.size, loops: loops.size, reverbSlots: slots.length}; },
    resetStats() { Object.assign(st, {peakVoices: active.size, played: 0, culled: 0, stolen: 0, coalesced: 0, rejected: 0, skipped: 0}); },
    stopAll(f = .05) { for (const v of [...active]) kill(v, f); for (const h of [...loops]) h.stop(f); },
  };
}
