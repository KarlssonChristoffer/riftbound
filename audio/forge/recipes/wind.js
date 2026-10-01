// WIND recipe v2: seamless stereo wind loops (docs/AUDIO.md §2.3 "Wind"). v2 follows the second listening pass: the
// user found the v1 wind a "disturbing white noise": no broadband 'shhh' layer any more. Everything continuous is DARK.
// Model: a GUST CONTROLLER (smoothed random 0.05-0.5 Hz, squashed to 0..1, raised to a power so gusts are peaky) gives a
// wind speed v(t) = base + depth·gust. The layers follow v:
//   1. BODY     pink noise -> band-pass swept 150-800 Hz with v (Q ~0.85) -> 24 dB/oct low-pass just above the band: a low-mid whoosh
//   2. RUMBLE   brown noise -> LP: turbulence in the low end, ∝ v^1.5
//   3. LEAF BED (breeze, gusty) a dark rustle: noise 350-1500 Hz, 36 dB/oct roll-off, with a fast random roughness (LP noise ~11 Hz)
//   4. LEAF TICKS sparse grains (4-18 ms, BP 1.8-4 kHz) at a rate ∝ v^1.5: the only high-frequency content, 20+ dB under the body
//   5. WHISTLES (howl) 1-3 narrow band-passes (Q 30-150) at 500-1900 Hz, frequency drifting with v and a slow wobble, faded
//               in smoothly above a speed threshold: soft tones, never a hiss
// Stereo: every noise source is independent per ear (a little shared), and so are the gust controllers (a shared part
// keeps the two ears in the same weather). SEAMLESS: circular timeline, circular filters, whole-cycle LFOs.
import {Biquad} from '../dsp.js';
// ------------------------------------------------------------------ circular loop toolkit (copied locally; kernel candidates)
// Everything lives on a circular timeline of L samples: noise is a length-L sequence, IIR filters run circularly (state
// warmed on the tail), every LFO has a whole number of cycles per loop, and ringing events fold back onto the start.
const fold = (b, L) => { const o = new Float32Array(L); for (let i = 0; i < b.length; i++) o[i % L] += b[i]; return o; };
function circBiquad(b, type, f, q, sr, {gainDb = 0, warm = sr} = {}) {
  const bq = new Biquad(type, f, q, sr, gainDb), n = b.length;
  for (let i = Math.max(0, n - warm); i < n; i++) bq.process(b[i]);
  return bq.run(b);
}
// time-varying biquad, circular: fAt(t)/qAt(t) in seconds; warm-up replays the last `warm` samples with their true times
function circSweep(b, type, fAt, qAt, sr, {every = 32, warm = Math.round(.5 * sr)} = {}) {
  const n = b.length, bq = new Biquad(type, fAt(0), qAt(0), sr), w0 = Math.max(0, n - warm);
  for (let i = w0; i < n; i++) { if (i % every === 0) bq.set(type, fAt(i / sr), qAt(i / sr)); bq.process(b[i]); }
  for (let i = 0; i < n; i++) { if (i % every === 0) bq.set(type, fAt(i / sr), qAt(i / sr)); b[i] = bq.process(b[i]); }
  return b;
}
function circOnePoleLP(b, fc, sr) {
  const k = 1 - Math.exp(-2 * Math.PI * fc / sr), n = b.length; let y = 0;
  for (let i = Math.max(0, n - sr); i < n; i++) y += (b[i] - y) * k;
  for (let i = 0; i < n; i++) { y += (b[i] - y) * k; b[i] = y; }
  return b;
}
function circWhite(n, R) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; }
function circBrown(n, R) {
  const w = circWhite(n, R); let v = 0; const step = i => (v = (v + .02 * w[i]) / 1.02);
  for (let i = Math.max(0, n - 20000); i < n; i++) step(i);
  const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = step(i) * 3.5;
  return b;
}
function circPink(n, R) {
  const w = circWhite(n, R); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; const o = new Float32Array(n);
  const step = x => { b0 = .99886 * b0 + x * .0555179; b1 = .99332 * b1 + x * .0750759; b2 = .969 * b2 + x * .153852; b3 = .8665 * b3 + x * .3104856; b4 = .55 * b4 + x * .5329522; b5 = -.7616 * b5 - x * .016898; const y = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * .5362) * .11; b6 = x * .115926; return y; };
  for (let i = Math.max(0, n - 96000); i < n; i++) step(w[i]);
  for (let i = 0; i < n; i++) o[i] = step(w[i]);
  return o;
}
// smooth random LFO periodic in Lsec: k sines at whole cycles/loop within [lo, hi] Hz; t -> value with unit RMS
function loopLfo(R, Lsec, lo, hi, k = 5) {
  const parts = []; let p = 0;
  for (let j = 0; j < k; j++) {
    const m = Math.max(1, Math.round(Math.exp(R.range(Math.log(lo), Math.log(hi))) * Lsec)), a = R.range(.4, 1);
    parts.push([2 * Math.PI * m / Lsec, R() * 2 * Math.PI, a]); p += a * a / 2;
  }
  const s = 1 / Math.sqrt(p);
  return t => { let v = 0; for (const [w, ph, a] of parts) v += a * Math.sin(w * t + ph); return v * s; };
}
// control-rate curve (every `every` samples, linear interpolation) of fn(t), n samples long
function ctrl(n, sr, fn, every = 64) {
  const m = Math.ceil(n / every) + 2, c = new Float32Array(m); for (let j = 0; j < m; j++) c[j] = fn(j * every / sr);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) { const j = i / every, j0 = j | 0, u = j - j0; o[i] = c[j0] + (c[j0 + 1] - c[j0]) * u; }
  return o;
}
function poissonT(R, T, rate, rmax) { const out = []; let t = 0; while ((t += R.exp(1 / rmax)) < T) if (R() * rmax < rate(t)) out.push(t); return out; }
const rmsOf = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length) + 1e-12; };
const unit = b => { const g = 1 / rmsOf(b); for (let i = 0; i < b.length; i++) b[i] *= g; return b; };   // unit RMS
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), lerp = (a, b, u) => a + (b - a) * u;


const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const lp24 = (x, f, sr) => { circBiquad(x, 'lowpass', f, .54, sr); circBiquad(x, 'lowpass', f, 1.3, sr); return x; };   // 4th order
const lp36 = (x, f, sr) => { lp24(x, f, sr); circBiquad(x, 'lowpass', f, .7, sr); return x; };

export default {
  id: 'wind', version: 2, desc: 'Wind: seamless stereo loops. Gust controller + swept low-mid body + rumble + dark leaf bed + sparse leaf ticks + soft threshold whistles',
  params: {
    base: {min: 0, max: 1, def: .25}, depth: {min: 0, max: 1, def: .5},          // speed v = base + depth·gust
    gp: {min: 1, max: 5, def: 2},                                              // gust peakiness (power)
    gHz: {min: .05, max: .5, def: .2},                                          // gust controller upper rate (lower = gHz/5)
    body: {min: 0, max: 2, def: 1}, bodyF: {min: 60, max: 600, def: 150}, bodyHi: {min: 150, max: 1200, def: 700},
    rumble: {min: 0, max: 2, def: .5}, rumbleF: {min: 60, max: 400, def: 160},
    leafBed: {min: 0, max: 1, def: .3}, leafLo: {min: 200, max: 1200, def: 350}, leafHi: {min: 600, max: 2500, def: 1500},
    ticks: {min: 0, max: 60, def: 8}, tickLevel: {min: 0, max: 1, def: .2},
    whistle: {min: 0, max: 2, def: 0}, nW: {min: 1, max: 3, def: 2},
    width: {min: 0, max: 1, def: .85},
  },
  cases: {
    breeze: {base: .3, depth: .3, gp: 1.4, gHz: .22, body: .8, bodyF: 170, bodyHi: 480, rumble: .15, leafBed: .55, leafLo: 380, leafHi: 1500, ticks: 22, tickLevel: .22},   // ruins day: soft wind through leaves
    gusty: {base: .16, depth: .62, gp: 2, gHz: .45, body: 1, bodyF: 150, bodyHi: 720, rumble: .55, leafBed: .2, leafLo: 350, leafHi: 1300, ticks: 8, tickLevel: .2},      // peaky gusts
    howl: {base: .42, depth: .5, gp: 1.8, gHz: .3, body: .8, bodyF: 180, bodyHi: 780, rumble: .5, leafBed: 0, ticks: 0, whistle: 1, nW: 3},                                 // frost: strong wind + soft whistles
    ember_hot: {base: .34, depth: .3, gp: 1.6, gHz: .2, body: 1, bodyF: 100, bodyHi: 520, rumble: .4, rumbleF: 170, leafBed: .12, leafLo: 300, leafHi: 900, ticks: 0},      // low hot wind, faint roar
  },
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const Lsec = R.range(8.6, 10.4), L = Math.round(Lsec * sr), cw = Math.sqrt(1 - .75 * p.width), sw = Math.sqrt(.75 * p.width);
    const out = [new Float32Array(L), new Float32Array(L)];
    const gHi = p.gHz, gLo = Math.max(.05, p.gHz / 5);
    const common = loopLfo(R.fork(1), Lsec, gLo, gHi, 5);
    const lfos = [loopLfo(R.fork(2), Lsec, gLo, gHi, 5), loopLfo(R.fork(3), Lsec, gLo, gHi, 5)];
    const comNoise = {pink: circPink(L, R.fork(10)), brown: circBrown(L, R.fork(11)), white: circWhite(L, R.fork(12))};
    const Jg = R.fork(5), jg = () => Jg.range(.75, 1.3), G = {body: jg(), rumble: jg(), leaf: jg(), tick: jg(), whistle: jg()};
    const Jg2 = Jg.range(.8, 1.25), Jg3 = Jg.range(.8, 1.25), Jl = Jg.range(.8, 1.25);
    // whistle set
    const Rw = R.fork(40), nW = Math.round(p.nW), whis = [];
    for (let k = 0; k < nW; k++) whis.push({f: [520, 940, 1480][k] * Rw.range(.8, 1.25), q: Rw.range(30, 150), g: Rw.range(.6, 1), th: Rw.range(.4, .68), drift: Rw.range(.18, .32), wob: loopLfo(Rw.fork(k), Lsec, .15, 1.2, 3)});
    // leaf ticks: sparse grains on the circular timeline (panned, small tail folded back)
    const tickBuf = [new Float32Array(L + 4000), new Float32Array(L + 4000)];
    const vSh = t => clamp(p.base + p.depth * Math.pow(1 / (1 + Math.exp(-1.7 * (.55 * common(t) + .83 * lfos[0](t)))), p.gp) * .62 ** (2 - p.gp), 0, 1);
    if (p.ticks > 0) {
      const Rt = R.fork(60);
      for (const t of poissonT(Rt, Lsec, t => p.ticks * Math.pow(vSh(t), 1.5) * 2.2, p.ticks * 2.4)) {
        const dur = Rt.range(.004, .018), n = Math.round(dur * 6 * sr), b = new Float32Array(n), k = 1 / (dur * sr), a = Rt.pow(.1, 1, 2);
        for (let i = 0; i < n; i++) b[i] = (Rt() * 2 - 1) * Math.exp(-i * k) * Math.min(1, i / 20);
        new Biquad('bandpass', Rt.range(1800, 4000), 1.2, sr).run(b);
        const pan = Rt.range(-.8, .8), ang = (pan + 1) * Math.PI / 4, i0 = Math.round(t * sr), gl = Math.cos(ang), gr = Math.sin(ang);
        let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(b[i]));
        for (let i = 0; i < n; i++) { const v = b[i] / (pk + 1e-9) * a * Math.min(1, (n - i) / (.002 * sr)); tickBuf[0][i0 + i] += v * gl; tickBuf[1][i0 + i] += v * gr; }
      }
    }
    for (let c = 0; c < 2; c++) {
      const Rc = R.fork(100 + c), o = out[c];
      const mix = (key, gen) => { const s = gen(L, Rc.fork(key.length + c * 7)), x = new Float32Array(L), cm = comNoise[key]; for (let i = 0; i < L; i++) x[i] = cw * cm[i] + sw * s[i]; return x; };
      const vf = t => { const x = .55 * common(t) + .83 * lfos[c](t), u = 1 / (1 + Math.exp(-1.7 * x)); return clamp(p.base + p.depth * Math.pow(u, p.gp) / Math.pow(.62, p.gp - 1) * .62, 0, 1); };
      const v = ctrl(L, sr, vf, 128), vTS = t => vf(t);
      const vs = Array.from(v).sort((a, b) => a - b), vq = u => vs[Math.floor(u * (vs.length - 1))];
      // 1. body: swept band-pass, then a steep roll-off just above the band
      { const x = mix('pink', circPink);
        const lo = p.bodyF * Jg2, hi = p.bodyHi * Jg3;
        circSweep(x, 'bandpass', t => lerp(lo, hi, vTS(t)), () => .85, sr);
        lp24(x, hi * 1.5, sr); unit(x);
        for (let i = 0; i < L; i++) o[i] += x[i] * p.body * G.body * (.1 + .9 * Math.pow(v[i], 1.25)) * .6; }
      // 2. rumble
      if (p.rumble > 0) { const x = mix('brown', circBrown); circBiquad(x, 'lowpass', p.rumbleF, .7, sr); circBiquad(x, 'highpass', 40, .7, sr); unit(x);
        for (let i = 0; i < L; i++) o[i] += x[i] * p.rumble * G.rumble * Math.pow(v[i], 1.5) * .45; }
      // 3. leaf bed: dark rustle with a fast random roughness (no broadband hiss: steep roll-off at leafHi)
      if (p.leafBed > 0) { const x = mix('pink', circPink); circBiquad(x, 'highpass', p.leafLo, .7, sr); lp36(x, p.leafHi * Jl, sr); unit(x);
        const rg = circWhite(L, Rc.fork(77)); circOnePoleLP(rg, 11, sr); circOnePoleLP(rg, 11, sr); unit(rg);
        const rg2 = circWhite(L, Rc.fork(78)); circOnePoleLP(rg2, 30, sr); unit(rg2);
        for (let i = 0; i < L; i++) o[i] += x[i] * p.leafBed * G.leaf * Math.pow(v[i], 1.4) * Math.max(.1, 1 + .5 * rg[i] + .3 * rg2[i]) * .5; }
      // 4. leaf ticks (sparse high grains)
      if (p.ticks > 0) { const tk = fold(tickBuf[c], L); for (let i = 0; i < L; i++) o[i] += tk[i] * p.tickLevel * G.tick * .4; }
      // 5. whistles: narrow BPs, drift with speed, fade in smoothly above a threshold of the speed distribution
      if (p.whistle > 0) for (const w of whis) {
        const x = circPink(L, Rc.fork(200 + Math.round(w.f)));
        const f0 = w.f; circSweep(x, 'bandpass', t => f0 * (.88 + w.drift * vTS(t) + .018 * w.wob(t)), () => w.q, sr, {every: 24}); unit(x);
        const th = vq(w.th);
        for (let i = 0; i < L; i++) o[i] += x[i] * p.whistle * G.whistle * w.g * smooth(th, th + .14, v[i]) * .5;
      }
      circBiquad(o, 'highpass', 30, .7, sr);
    }
    return out;
  },
  criteria: {   // dark low-mid textures: no broadband haze (highHz = 95% band edge), flatness ~0; the gust controller gives 6-12 dB swings
    breeze: {centroidHz: [220, 520], highHz: [450, 1700], flatness: [0, .01], durMs: [8000, 11000]},
    gusty: {centroidHz: [260, 640], highHz: [550, 1400], flatness: [0, .01], durMs: [8000, 11000]},
    howl: {centroidHz: [500, 1150], highHz: [1000, 2400], flatness: [0, .01], durMs: [8000, 11000]},
    ember_hot: {centroidHz: [180, 460], highHz: [380, 1000], flatness: [0, .01], durMs: [8000, 11000]},
  },
  notes: 'gust controller (smoothed random, sigmoid, power) -> dark body BP sweep, rumble, dark leaf bed, sparse leaf ticks, soft threshold whistles; stereo decorrelated; seamless circular loop',
};
