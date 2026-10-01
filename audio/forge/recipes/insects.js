// INSECTS recipe v1: a distant, soft insect backdrop as a seamless stereo loop (docs/AUDIO.md §2.3 "Birds / crickets / owl").
// Brightness rules (RECIPE_GUIDE.md): crickets live at 3-5 kHz, so every one is DISTANT: low-passed per distance class, a -8 dB
// shelf above 5 kHz, a 6.5 kHz master low-pass, quiet and spread across the stereo field. No single cricket is close or in one
// ear (levels sit in a narrow band, pans stay within +-0.85), and there is NO noise bed anywhere: only tonal pulses, a low hum
// and a few sparse rasp clicks.
// Cases:
//   night  a chorus of 18-26 crickets. Each is an individual: its own carrier (a cluster 2.85-3.3 kHz plus a second group up to ~4 kHz, +-5% detune), 3-5 pulses
//          of 10-20 ms (swell, then a short resonant ring) per chirp, pulse period 22-34 ms, its own chirp rhythm (0.5-1.1 s)
//          and phase, pan and distance. Dense and steady, no single recognisable chirp.
//   dusk   the first few: 5-7 crickets, slower chirps, so the pauses are audible
//   day    near silence: a very faint warm hum (a fly or two passing, 130-240 Hz, a few harmonics, slow swells, panning) and a
//          few far grasshopper rasps (short trains of damped noise ticks, band-passed 2-3.4 kHz, quiet)
// SEAMLESS LOOP by construction: every individual's chirp period divides the loop length, events live on a circular timeline
// (anything ringing past the end wraps to the start), IIR filters run circularly, and hum partials sit on whole cycles per loop.
// Level note: the forge normalises each case to -20 LUFS, so the RUNTIME sets dusk and day lower than night (about -4 / -12 dB).
import {Biquad} from '../dsp.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const whiteN = (n, R) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; };
function circBiquad(b, type, f, q, sr, {gainDb = 0, warm = sr >> 1} = {}) {
  const bq = new Biquad(type, f, q, sr, gainDb), n = b.length;
  for (let i = Math.max(0, n - warm); i < n; i++) bq.process(b[i]);
  return bq.run(b);
}
// smooth random LFO periodic in Lsec: k sines at whole cycles per loop, f in [lo, hi] Hz, unit RMS
function loopLfo(R, Lsec, lo, hi, k = 4) {
  const parts = []; let p = 0;
  for (let j = 0; j < k; j++) {
    const m = Math.max(1, Math.round(Math.exp(R.range(Math.log(lo), Math.log(hi))) * Lsec)), a = R.range(.4, 1);
    parts.push([TAU * m / Lsec, R() * TAU, a]); p += a * a / 2;
  }
  const s = 1 / Math.sqrt(p);
  return t => { let v = 0; for (const [w, ph, a] of parts) v += a * Math.sin(w * t + ph); return v * s; };
}
function ctrl(n, sr, fn, every = 64) {
  const m = Math.ceil(n / every) + 2, c = new Float32Array(m); for (let j = 0; j < m; j++) c[j] = fn(j * every / sr);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) { const j = i / every, j0 = j | 0, u = j - j0; o[i] = c[j0] + (c[j0 + 1] - c[j0]) * u; }
  return o;
}
// equal-power pan + a small interaural lag on the far ear, added circularly into a stereo pair at sample i0 (src length n)
function panAdd(bufs, src, i0, pan, g, sr) {
  const L = bufs[0].length, ang = (clamp(pan, -1, 1) + 1) * Math.PI / 4, gl = Math.cos(ang) * g, gr = Math.sin(ang) * g, lag = Math.round(.0004 * Math.abs(pan) * sr);
  const dl = pan > 0 ? lag : 0, dr = pan < 0 ? lag : 0;
  for (let i = 0; i < src.length; i++) { const v = src[i]; bufs[0][(i0 + i + dl) % L] += v * gl; bufs[1][(i0 + i + dr) % L] += v * gr; }
}

// one cricket pulse: swell of `dur` s, then a short resonant ring (1/e = 0.35 dur), 2nd harmonic at -18 dB; raised-cosine end fade
function pulse(fc, dur, ph0, sr, tmp) {
  const n = Math.min(tmp.length, Math.round(dur * 3.6 * sr)), w = TAU * fc / sr, ring = 1 / (dur * .35 * sr), swell = dur * sr;
  for (let i = 0; i < n; i++) {
    const env = i < swell ? Math.pow(Math.sin(Math.PI / 2 * i / swell), 2) : Math.exp(-(i - swell) * ring);
    const fade = i > n * .8 ? .5 + .5 * Math.cos(Math.PI * (i - n * .8) / (n * .2)) : 1;
    tmp[i] = env * fade * (Math.sin(w * i + ph0) + .12 * Math.sin(2 * w * i + 2 * ph0 + 1));
  }
  return n;
}

export default {
  id: 'insects', version: 1, desc: 'Insect backdrop loop: distant night cricket chorus, dusk first crickets, day hum + far rasps (seamless stereo)',
  params: {
    crickets: {min: 0, max: 40, def: 30},       // number of individual crickets (+-20%, capped 40)
    chirpPeriod: {min: .3, max: 3, def: .65},   // mean time between one cricket's chirps (s)
    hum: {min: 0, max: 1, def: 0},              // faint low insect hum (flies / bees passing)
    rasp: {min: 0, max: 6, def: 0},             // far grasshopper rasps per loop
  },
  cases: {
    night: {crickets: 22, chirpPeriod: .75, hum: 0, rasp: 0},
    dusk: {crickets: 6, chirpPeriod: 1.2, hum: 0, rasp: 0},
    day: {crickets: 0, chirpPeriod: 1, hum: 1, rasp: 3},
  },
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const Lsec = R.range(8.4, 11.4), L = Math.round(Lsec * sr);
    const out = [new Float32Array(L), new Float32Array(L)];
    const tmp = new Float32Array(Math.round(.09 * sr));
    // ---------------------------------------------------------------- crickets: three distance buses (near .. far), each its own low-pass
    const Rc = R.fork(11), nC = Math.min(40, Math.round(p.crickets * Rc.range(.8, 1.2)));
    const LPS = [4900, 4300, 3700], buses = LPS.map(() => [new Float32Array(L), new Float32Array(L)]);
    const base = Rc.range(2850, 3300), second = base * Rc.range(1.08, 1.2);     // two groups of singers (two species / temperatures)
    for (let i = 0; i < nC; i++) {
      const Ri = Rc.fork(100 + i), grp = Ri() < .25 ? second : base;
      const fc = clamp(grp * (1 + clamp(Ri.gauss() * .025, -.05, .05)), 2500, 4500);
      const nch = Math.max(2, Math.round(Lsec / (p.chirpPeriod * Ri.range(.72, 1.4)))), P = Lsec / nch, ph = Ri() * P;
      const d = Ri.range(1.5, 4.6), bus = d < 2.4 ? 0 : d < 3.5 ? 1 : 2;
      const a = Math.pow(1 / d, .9) * Ri.range(.85, 1.1), pan = Ri.range(-.85, .85);
      const np0 = Ri.int(3, 5), pdur = Ri.range(.010, .020), pper = Ri.range(.022, .034);
      for (let c = 0; c < nch; c++) {
        if (Ri() < .05) continue;                                               // an occasional missed chirp
        const t0 = ph + c * P + Ri.range(-.07, .07) * P, np = clamp(np0 + (Ri() < .15 ? Ri.sign() : 0), 3, 5), ca = a * Ri.range(.8, 1.1);
        let t = t0;
        for (let k = 0; k < np; k++) {
          const n = pulse(fc * (1 + .004 * Ri.gauss()), pdur * Ri.range(.9, 1.1), Ri() * TAU, sr, tmp);
          panAdd(buses[bus], tmp.subarray(0, n), Math.round((t % Lsec) * sr), pan, ca * (.85 + .15 * Math.sin(Math.PI * (k + .5) / np)) * (1 - .05 * k), sr);
          t += pper * Ri.range(.93, 1.07);
        }
      }
    }
    const Rl = R.fork(31);
    buses.forEach((b, k) => {
      const lfo = loopLfo(Rl.fork(k), Lsec, .05, .5, 3), g = ctrl(L, sr, t => Math.exp(.12 * lfo(t)));   // each distance layer breathes a little
      for (let c = 0; c < 2; c++) { circBiquad(b[c], 'lowpass', LPS[k], .6, sr); circBiquad(b[c], 'lowpass', LPS[k], 1.0, sr); for (let i = 0; i < L; i++) out[c][i] += b[c][i] * g[i]; }
    });

    // ---------------------------------------------------------------- day: a faint warm hum (flies passing) and far rasps
    if (p.hum > 0) {
      const Rh = R.fork(41), nF = Rh.int(2, 3);
      for (let f = 0; f < nF; f++) {
        const Rf = Rh.fork(f), f0 = Rf.range(130, 235), tc = Rf() * Lsec, wd = Rf.range(1.6, 3.4), pm = loopLfo(Rf.fork(1), Lsec, .3, 3, 3), depth = Rf.range(.35, .9);
        const swell = ctrl(L, sr, t => { let dt = Math.abs(t - tc); dt = Math.min(dt, Lsec - dt); return dt < wd ? Math.pow(Math.cos(Math.PI / 2 * dt / wd), 2) : 0; });   // circular bump
        const pmc = ctrl(L, sr, t => depth * pm(t)), pan0 = Rf.range(-.6, .6), pph = Rf() * TAU, span = Rf.range(.2, .45);
        const parts = [];
        for (let h = 1; h <= 5; h++) parts.push([TAU * Math.round(h * f0 * Lsec) / Lsec / sr, Rf() * TAU, 1 / Math.pow(h, 1.25), h]);   // whole cycles per loop
        const pb = ctrl(L, sr, t => pan0 + span * Math.sin(TAU * t / Lsec + pph));
        for (let i = 0; i < L; i++) {
          const e = swell[i]; if (e < 2e-3) continue;
          let s = 0; for (const [w, p0, am, h] of parts) s += am * Math.sin(w * i + p0 + h * pmc[i]);
          s *= e * .3;
          const ang = (clamp(pb[i], -1, 1) + 1) * Math.PI / 4; out[0][i] += s * Math.cos(ang); out[1][i] += s * Math.sin(ang);
        }
      }
    }
    if (p.rasp > 0) {
      const Rr = R.fork(51), nR = Math.max(0, Math.round(p.rasp * Rr.range(.7, 1.3))), buf = [new Float32Array(L), new Float32Array(L)];
      for (let r = 0; r < nR; r++) {
        let t = Rr.range(0, Lsec); const pan = Rr.range(-.8, .8), fc = Rr.range(2200, 3200), a = Rr.range(.35, .8), ng = Rr.int(2, 4), rate = Rr.range(70, 115);
        for (let gI = 0; gI < ng; gI++) {                                       // a rasp = a few groups of 12-30 ticks
          const nt = Rr.int(12, 30);
          for (let k = 0; k < nt; k++) {
            const u = k / nt, env = Math.pow(Math.sin(Math.PI * (u * .9 + .05)), 1.4), d = Rr.range(.0008, .0016) * sr, n = Math.min(tmp.length, Math.round(7 * d));
            for (let i = 0; i < n; i++) tmp[i] = (Rr() * 2 - 1) * Math.exp(-i / d) * Math.min(1, i / 6);
            const x = tmp.subarray(0, n); new Biquad('bandpass', fc * Rr.range(.9, 1.1), 2.2, sr).run(x);
            panAdd(buf, x, Math.round((t % Lsec) * sr), pan, a * env * .55, sr);
            t += 1 / (rate * Rr.range(.8, 1.2));
          }
          t += Rr.range(.05, .18);
        }
      }
      for (let c = 0; c < 2; c++) { circBiquad(buf[c], 'lowpass', 3800, .6, sr); circBiquad(buf[c], 'lowpass', 3800, 1.0, sr); for (let i = 0; i < L; i++) out[c][i] += buf[c][i] * 1.7; }
    }

    // ---------------------------------------------------------------- master: -8 dB shelf above 5 kHz, 6.5 kHz low-pass, 70 Hz high-pass (all circular)
    for (const o of out) { circBiquad(o, 'highshelf', 5000, .7, sr, {gainDb: -8}); circBiquad(o, 'lowpass', 6500, .7, sr); circBiquad(o, 'highpass', 70, .7, sr); }
    return out;
  },
  criteria: {   // 33 seeds each (1-24, 44291-44296, 3 large), with margin. Carriers sit at 2.85-4 kHz by design (distant, low-passed), so energy above 4 kHz is tiny
    night: {durMs: [8200, 11600], centroidHz: [2700, 3600], lowHz: [2500, 3400], highHz: [3000, 4300], flatness: [0, .01], hf4kDb: [-70, -22], onsetRate: [3, 14]},
    dusk: {durMs: [8200, 11600], centroidHz: [2600, 3700], lowHz: [2500, 3500], highHz: [2700, 4300], flatness: [0, .01], hf4kDb: [-70, -10], onsetRate: [1, 12]},
    day: {durMs: [8200, 11600], centroidHz: [150, 420], lowHz: [80, 260], highHz: [350, 900], flatness: [0, .01], hf4kDb: [-90, -38]},
  },
  notes: 'cricket chorus: per-individual carrier (+-5%), 3-5 pulses of 10-20 ms (swell + ring), own chirp period dividing the loop, 3 distance buses with low-passes; day = faint whole-cycle flies hum + far rasps; seamless; no noise bed',
};
