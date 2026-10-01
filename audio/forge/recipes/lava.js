// LAVA recipe v2 (second listening pass: no bright haze; the sizzle is now very quiet and dark, pops and ticks sit in 0.3-3 kHz): seamless stereo lava loops (docs/AUDIO.md §2.3 "Lava"). The one-shot belch lives in creature.js (lava_belch):
// one recipe cannot be both a loop and a one-shot.
// Model: viscous lava is a thick, slowly churning fluid. What you hear, in order of importance:
//   1. CHURN BED   dozens per second of mid-sized (r 10-35 mm, f0 85-300 Hz), very heavily damped bubbles (damping x3-10,
//                  pitch rising xi .2-.5) that merge into a continuous gloopy murmur: the bed under the events
//   2. RUMBLE      brown noise -> LP: sub (80 Hz) plus a slow-heaving body (LP 250 Hz), AM 0.1-0.6 Hz
//   3. BLOOPS      the events (0.5-3/s): big damped bubbles (f0 60-250 Hz, van den Doel decay x3-10 clamped to a thick 8-70/s,
//                  pitch rises as the bubble shrinks), each surfaced with a POP transient (noise 10-25 ms, BP 500-2500 Hz) and
//                  a puff of hiss; saturated lightly so the low fundamentals have harmonics a small speaker can reproduce
//   4. SIZZLE      HP noise x a 4th-power burst modulator over a floor: gas escaping, plus sparse crust ticks
// Cases: flow (active river of lava), pool (calm: fewer, smaller, slower bloops, less sizzle).
// SEAMLESS: circular timeline, circular filters, whole-cycle LFOs, ringing bubbles folded onto the start.
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

const lp24 = (x, f, sr) => { circBiquad(x, 'lowpass', f, .54, sr); circBiquad(x, 'lowpass', f, 1.3, sr); return x; };   // 4th order, 24 dB/oct

// a damped bubble as a recursive phasor (f0 Hz, damping d /s, rising pitch f = f0 (1 + xi d t)), `ramp` s onset, added to out[i0..]
function blub(out, sr, i0, f0, d, xi, amp, ramp = .002) {
  const n = Math.min(out.length - i0, Math.round(Math.min(1.4, 7.2 / d) * sr)), dec = Math.exp(-d / sr), rn = Math.max(2, Math.round(ramp * sr));
  let re = amp, im = 0, cr = 1, ci = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) { const f = f0 * (1 + xi * d * (i + 7.5) / sr); if (f > sr * .45) break; const w = 2 * Math.PI * f / sr; cr = dec * Math.cos(w); ci = dec * Math.sin(w); }
    const nr = re * cr - im * ci; im = re * ci + im * cr; re = nr;
    out[i0 + i] += im * (i < rn ? .5 - .5 * Math.cos(Math.PI * i / rn) : 1);
  }
  return out;
}
const dampFor = (f0, mul) => { const r = 3 / f0; return clamp((.13 / r + .0072 * Math.pow(r, -1.5)) * mul, 8, 70); };

export default {
  id: 'lava', version: 2, desc: 'Lava: seamless stereo loops. Churn bed of damped bubbles + rumble + big bloops with pops + sizzle',
  params: {
    rate: {min: .3, max: 3.5, def: 1.8},                 // bloop events per second
    fLo: {min: 50, max: 250, def: 60}, fHi: {min: 80, max: 300, def: 250},   // bloop f0 range
    churn: {min: 0, max: 80, def: 45}, churnLevel: {min: 0, max: 2, def: 1},   // churn bubbles per second and level
    bloop: {min: 0, max: 2, def: 1}, pop: {min: 0, max: 2, def: 1},
    rumble: {min: 0, max: 2, def: 1}, slosh: {min: 0, max: 2, def: 1}, sizzle: {min: 0, max: 1, def: .3}, ticks: {min: 0, max: 8, def: 3},
  },
  cases: {
    flow: {rate: 2.2, fLo: 60, fHi: 250, churn: 50, churnLevel: 1, bloop: 1, pop: 1, rumble: 1, slosh: 1, sizzle: .32, ticks: 3},
    pool: {rate: .7, fLo: 55, fHi: 160, churn: 24, churnLevel: .8, bloop: .75, pop: .6, rumble: 1.1, slosh: .7, sizzle: .15, ticks: 1},
  },
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const Lsec = R.range(8.6, 10.4), L = Math.round(Lsec * sr), TAIL = Math.round(1.5 * sr), N = L + TAIL;
    const out = [new Float32Array(L), new Float32Array(L)];
    const Jg = R.fork(5), jg = () => Jg.range(.7, 1.4), J = {churn: jg(), bloop: jg(), rumble: jg(), sizzle: jg(), pop: jg(), slosh: Jg.range(.75, 1.3)};
    const panAdd = (bufs, tmp, t0, pan, g) => {   // equal-power pan + interaural lag of the far ear
      const ang = (clamp(pan, -1, 1) + 1) * Math.PI / 4, gl = Math.cos(ang) * g, gr = Math.sin(ang) * g, i0 = Math.round(t0 * sr), lag = Math.round(.0004 * Math.abs(pan) * sr);
      for (let i = 0; i < tmp.length && i0 + i < N; i++) { const v = tmp[i]; bufs[0][i0 + i + (pan > 0 ? lag : 0)] += v * gl; bufs[1][i0 + i + (pan < 0 ? lag : 0)] += v * gr; }
    };
    const ev = [new Float32Array(N + 64), new Float32Array(N + 64)];   // bubble + pop events (stereo)
    const churnB = [new Float32Array(N + 64), new Float32Array(N + 64)];
    const sizzleEv = [new Float32Array(N + 64), new Float32Array(N + 64)];
    // ---- 1. churn bed: many mid bubbles
    const Rc = R.fork(11), flare = loopLfo(R.fork(1), Lsec, .3, 2.5, 8);
    const flareU = t => 1 / (1 + Math.exp(-1.4 * flare(t)));
    if (p.churn > 0) {
      const tmp = new Float32Array(Math.round(1.2 * sr));
      for (const t of poissonT(Rc, Lsec, t => p.churn * (.6 + .8 * flareU(t)), p.churn * 1.5)) {
        const f0 = Math.exp(Rc.range(Math.log(85), Math.log(300))), d = dampFor(f0, Rc.range(3, 10)), a = Rc.range(.25, 1) * Math.pow(f0 / 150, -.4);
        tmp.fill(0, 0, Math.min(tmp.length, Math.round(7.2 / d * sr) + 4)); blub(tmp, sr, 0, f0, d, Rc.range(.2, .5), a);
        panAdd(churnB, tmp.subarray(0, Math.min(tmp.length, Math.round(7.2 / d * sr) + 4)), t, Rc.range(-.8, .8), 1);
      }
    }
    // ---- 3. bloops with pops and hiss puffs
    const Re = R.fork(21), tmp2 = new Float32Array(Math.round(1.5 * sr));
    const popEv = (t0, a, pan, f, dec) => {
      const n = Math.round(dec * sr * 7) + 8, b = new Float32Array(n), k = 1 / (dec * sr);
      for (let i = 0; i < n; i++) b[i] = (Re() * 2 - 1) * Math.exp(-i * k) * Math.min(1, i / 24);
      new Biquad('bandpass', f, 1.1, sr).run(b); new Biquad('lowpass', 2800, .7, sr).run(b); new Biquad('lowpass', 2800, 1.3, sr).run(b); let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(b[i])); for (let i = 0; i < n; i++) b[i] *= a / (pk + 1e-9) * Math.min(1, (n - i) / (.003 * sr));
      panAdd(ev, b, t0, pan, 1);
    };
    const puff = (t0, a, pan, dur) => {
      const n = Math.round(dur * sr * 1.4), b = new Float32Array(n);
      for (let i = 0; i < n; i++) { const u = i / (dur * sr); b[i] = (Re() * 2 - 1) * Math.pow(Math.sin(Math.PI * Math.min(1, u / 1.4)), 2) * Math.exp(-2 * u); }
      new Biquad('highpass', 700, .7, sr).run(b); new Biquad('lowpass', 2600, .54, sr).run(b); new Biquad('lowpass', 2600, 1.3, sr).run(b);
      panAdd(sizzleEv, b, t0, pan, a);
    };
    if (p.rate > 0) for (const t of poissonT(Re, Lsec, t => p.rate * (.4 + 1.2 * flareU(t)), p.rate * 1.8)) {
      const f0 = Math.exp(Re.range(Math.log(p.fLo), Math.log(p.fHi))), size = Math.pow(150 / f0, .7), pan = Re.range(-.7, .7);
      const nb = Re() < .22 ? 2 : 1, d = dampFor(f0, Re.range(3, 10)), a0 = Re.range(.5, 1) * p.bloop * J.bloop * Math.pow(size, .5);
      for (let k = 0; k < nb; k++) {
        const tk = t + k * Re.range(.05, .14), fk = f0 * (k ? Re.range(.7, 1.2) : 1), dk = k ? dampFor(fk, Re.range(3, 10)) : d, nn = Math.min(tmp2.length, Math.round(7.2 / dk * sr) + 8);
        tmp2.fill(0, 0, nn); blub(tmp2, sr, 0, fk, dk, Re.range(.2, .5), a0 * (k ? .6 : 1), Re.range(.003, .009));
        panAdd(ev, tmp2.subarray(0, nn), tk, pan, 1);
        popEv(tk + Re.range(-.002, .004), .7 * p.pop * J.pop * a0, pan, Re.range(300, 1500), Re.range(.006, .016));
        puff(tk, .25 * p.sizzle * 1.2 * a0 * size, pan, Re.range(.05, .22));
      }
    }
    // crust ticks (cooling crust cracking): sparse tiny clicks, 1.5-5 kHz
    if (p.ticks > 0) for (const t of poissonT(Re, Lsec, () => p.ticks, p.ticks)) popEv(t, Re.pow(.03, .2, 1.5), Re.range(-.9, .9), Re.range(900, 3000), Re.range(.0008, .003));
    // ---- per ear: fold, beds, mix
    const slowR = loopLfo(R.fork(31), Lsec, .1, .6, 4), heave = ctrl(L, sr, t => Math.exp(.35 * slowR(t)));
    const sizHi = loopLfo(R.fork(41), Lsec, .4, 4, 7), sizEnv = ctrl(L, sr, t => .18 + .82 * Math.pow(1 / (1 + Math.exp(-1.5 * sizHi(t))), 4) * 2);
    const lapCom = circBrown(L, R.fork(50)), gl1 = loopLfo(R.fork(60), Lsec, .8, 5, 7), gloop = ctrl(L, sr, t => Math.exp(.55 * gl1(t) - .15));
    for (let c = 0; c < 2; c++) {
      const o = out[c], Rn = R.fork(70 + c);
      const ch = fold(churnB[c], L); unit(ch); for (let i = 0; i < L; i++) ch[i] = Math.tanh(ch[i] * 1.8) / 1.8;
      const bl = fold(ev[c], L), sz = fold(sizzleEv[c], L);
      // light saturation of the low bloops so their harmonics survive small speakers
      for (let i = 0; i < L; i++) bl[i] = Math.tanh(bl[i] * 3.2) / 3.2;
      for (let i = 0; i < L; i++) o[i] += ch[i] * p.churnLevel * J.churn * .17 * heave[i] + bl[i] * 3.2 + sz[i] * 2;
      // slosh: the viscous mid body (pink noise 250-900 Hz, gloop-modulated)
      { const x = circPink(L, Rn.fork(3)); circBiquad(x, 'highpass', 200 * J.slosh, .7, sr); lp24(x, 850 * J.slosh, sr); unit(x);
        for (let i = 0; i < L; i++) o[i] += x[i] * gloop[i] * p.slosh * .16; }
      // rumble: sub + slow heaving body
      const bs = circBrown(L, Rn.fork(1)); for (let i = 0; i < L; i++) bs[i] = .6 * lapCom[i] + .8 * bs[i];
      const sub = bs.slice(); circBiquad(sub, 'lowpass', 80, .7, sr); unit(sub);
      const body = bs.slice(); circBiquad(body, 'lowpass', 260, .7, sr); circBiquad(body, 'highpass', 55, .7, sr); unit(body);
      for (let i = 0; i < L; i++) o[i] += (sub[i] * .07 + body[i] * .11 * heave[i]) * p.rumble * J.rumble;
      // sizzle bed: HP noise x (floor + 4th-power bursts)
      if (p.sizzle > 0) { const x = circWhite(L, Rn.fork(2)); circBiquad(x, 'highpass', 900, .7, sr); lp24(x, 2600, sr); unit(x); for (let i = 0; i < L; i++) o[i] += x[i] * sizEnv[i] * p.sizzle * J.sizzle * .12; }
      circBiquad(o, 'highpass', 28, .7, sr);
    }
    return out;
  },
  criteria: {   // deep bubbling bed + sparse pops: nothing bright (highHz = 95% band edge), no hiss
    flow: {centroidHz: [200, 480], highHz: [500, 1400], flatness: [0, .01], onsetRate: [.8, 4], durMs: [8000, 11000]},
    pool: {centroidHz: [140, 420], highHz: [380, 1250], flatness: [0, .01], onsetRate: [.5, 3.5], durMs: [8000, 11000]},
  },
  notes: 'dense heavily damped bubbles (churn) + big bloops (f0 60-250, damping x3-10, xi .2-.5) with pops + brown rumble + 4th-power sizzle; seamless',
};
