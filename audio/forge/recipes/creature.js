// CREATURE recipe v2 (second listening pass: everything darker; every case ends in a warm tilt, -9 dB above 4.5 kHz + LP 7 kHz): wildlife and a few world one-shots (docs/AUDIO.md §2.3 "Birds / crickets / owl", "Water", "Lava").
// All cases are mono one-shots; the runtime pans them and the scatterer picks the times.
//   wings    one bird taking off: 3-6 feathery flaps 65-100 ms apart. Each flap is a swell of band-passed noise (400-900 Hz,
//            ~50 ms) over a quieter high flutter (HP noise with 60-120 Hz roughness), the first flap with a wing-clap snap
//   scatter  a flock of 4-8 taking off: the same flap model per bird, start times bunched in 0-250 ms, each bird with its
//            own beat rate, pitch and level, plus a couple of short alarm chips
//   caw      a crow: 1-3 calls, each a harsh nasal pulse-train source (jittered period, rasp AM, period-doubling) summed from
//            harmonics, through three resonant formants (~700 / 1500 / 2600 Hz) with a falling pitch
//   songbird a phrase of 4-9 FM/AM syllables (2-8 kHz glides 20-150 ms, trills with 10-40 Hz AM, whistles) built from a small
//            vocabulary by a grammar: opening chips, a repeated motif, a closing fall
//   owl      hoot-pause-hoot-pause-tremolo: 250-900 Hz tone with soft attack, glide, breath noise, a quavering long hoot
//   cricket  one chirp: 3-5 pulses of 10-20 ms on a 3-5 kHz carrier, slightly resonant
//   frog     a short throaty croak: a pulse train (~100 -> 60 Hz) exciting two throat-sac resonances (~700 and ~1400 Hz)
//   fish     a fish jump: exit swish, then re-entry plip (a van den Doel bubble) + slap + droplets that rain back as tiny bubbles
//   critter  a small animal dashing through grass: dense rustle grains (BP 1.5-6 kHz) under a patter of footfalls, 0.3-0.5 s
//   rift_whisper / rift_shimmer  the rift's one-shots (the loops are in rift.js): a formant-hopping whisper phrase, a crystalline swell
//   lava_belch  a big viscous gas bubble surfacing and bursting: heavily damped rising bloop + pop + hiss + spatter + sub thud
import {Biquad} from '../dsp.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), lerp = (a, b, u) => a + (b - a) * u;
const rmsOf = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length) + 1e-12; };
const addAt = (dst, src, at, g = 1) => { at = Math.round(at); for (let i = Math.max(0, -at); i < src.length && i + at < dst.length; i++) dst[i + at] += src[i] * g; return dst; };
const whiteN = (n, R) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; };
// raised-cosine end fade over the last `ms`: closes a decay without a hard edge
const endFade = (b, sr, ms) => { const f = Math.min(b.length, Math.round(ms * sr / 1000)); for (let i = 0; i < f; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / f); return b; };
const bq = (b, type, f, q, sr) => new Biquad(type, f, q, sr).run(b);
const VOWELS = {a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240], ae: [660, 1720, 2410], er: [490, 1350, 1690]};   // whisper vowel formants (see rift.js)
const smoothstep = x => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };

// ----------------------------------------------------------------------------------------------------- wings
// one flap: swell of band-passed noise at fc over a fast feather flutter; dur ~ 60-100 ms with a decay tail, closed by a fade
function flap(out, sr, t0, R, {amp = 1, fc = 600, dur = .09, clap = 0, rough = 90}) {
  const n = Math.round((dur * 1.5 + .02) * sr), x = whiteN(n, R), hf = whiteN(n, R);
  bq(x, 'bandpass', fc, .9, sr); bq(x, 'lowpass', fc * 2.4, .7, sr); bq(x, 'lowpass', fc * 2.4, 1.3, sr);
  bq(hf, 'highpass', 1300 * R.range(.8, 1.3), .7, sr); bq(hf, 'lowpass', 3600, .7, sr); bq(hf, 'lowpass', 3600, 1.3, sr);
  const rn = whiteN(n, R); bq(rn, 'lowpass', rough, .7, sr); const rg = 1 / rmsOf(rn);   // feather flutter: random roughness
  const up = dur * .32, dn = dur * .42;
  for (let i = 0; i < n; i++) {
    const t = i / sr, e = t < up ? Math.pow(t / up, 1.6) : Math.exp(-(t - up) / dn);
    const fl = Math.max(.15, 1 + .85 * rn[i] * rg);
    x[i] = x[i] * e * 1.3 + hf[i] * e * e * fl * .2;
  }
  endFade(x, sr, 18);
  addAt(out, x, t0 * sr, amp);
  if (clap > 0) {   // wing-tip clap on the first stroke: 3 ms snap, 1.5-3.5 kHz
    const m = Math.round(.012 * sr), c = whiteN(m, R); for (let i = 0; i < m; i++) c[i] *= Math.exp(-i / (.0018 * sr)) * Math.min(1, i / 12);
    bq(c, 'bandpass', R.range(900, 2200), 1.1, sr); addAt(out, c, (t0 + R.range(.004, .014)) * sr, amp * clap * 2.4);
  }
}
// a bird's whole take-off: a short ruffle, then n flaps whose beat settles at `period`
function takeoff(out, sr, R, t0, {amp = 1, n = 4, period = .08, fc = 600, clap = .0}) {
  const m = Math.round(.1 * sr), r = whiteN(m, R); bq(r, 'highpass', 1800, .7, sr); bq(r, 'lowpass', 6500, .7, sr);
  for (let i = 0; i < m; i++) r[i] *= Math.pow(Math.sin(Math.PI * i / m), 2) * (1 + .6 * Math.sin(i / sr * TAU * 38 + R() * 6));
  addAt(out, r, (t0 - .05) * sr, amp * .12);
  let t = t0;
  for (let k = 0; k < n; k++) {
    flap(out, sr, t, R, {amp: amp * R.range(.85, 1.1) * (k === 0 ? 1.05 : Math.pow(.9, k)), fc: fc * R.range(.9, 1.12), dur: period * R.range(.9, 1.15), clap: k === 0 ? clap : 0});
    t += period * (k ? R.range(.93, 1.1) : R.range(.85, 1));
  }
}

// ----------------------------------------------------------------------------------------------------- songbird
// one syllable: type sweep | trill | whistle | chip. f(t) in Hz with FM, raised-cosine envelope with AM, 2nd harmonic + breath
function syllable(out, sr, R, t0, s) {
  const n = Math.round(s.dur * sr), ph0 = R() * TAU; let ph = ph0;
  const jr = R.range(60, 110), jp = R() * TAU;
  for (let i = 0; i < n; i++) {
    const u = i / n, t = i / sr;
    let f = s.f1 * Math.pow(s.f2 / s.f1, s.curve ? Math.pow(u, s.curve) : u);
    if (s.fmDepth) f += s.fmDepth * Math.sin(TAU * s.fmRate * t);
    f *= 1 + .006 * Math.sin(TAU * jr * t + jp);   // micro-jitter: no bare sine
    ph += TAU * f / sr;
    const env = Math.pow(Math.sin(Math.PI * Math.pow(u, s.skew || 1)), s.sharp || .8) * (s.am ? 1 - s.am * .5 + s.am * .5 * Math.cos(TAU * s.amRate * t) : 1);
    out[Math.round(t0 * sr) + i] += env * (Math.sin(ph) + .1 * Math.sin(2 * ph + .6) + .02 * Math.sin(3 * ph)) * s.amp + (R() * 2 - 1) * env * s.amp * .02;
  }
}
function makeVocab(R) {
  const base = R.range(1600, 3000), kinds = ['sweep', 'trill', 'whistle', 'chip'], vocab = [];
  for (let k = 0; k < R.int(2, 3); k++) {
    const kind = R.pick(kinds), up = R() < .5;
    const a = base * R.range(.8, 1.3), b = a * (kind === 'whistle' ? R.range(.92, 1.1) : up ? R.range(1.2, 1.6) : R.range(.55, .8));
    vocab.push({kind, f1: clamp(a, 1200, 3800), f2: clamp(b, 1200, 4000), dur: kind === 'chip' ? R.range(.02, .04) : kind === 'trill' ? R.range(.08, .15) : kind === 'whistle' ? R.range(.09, .15) : R.range(.04, .11),
      fmDepth: kind === 'trill' ? R.range(200, 550) : 0, fmRate: R.range(14, 36), am: kind === 'trill' ? R.range(.5, .9) : 0, amRate: R.range(12, 38), curve: R.range(.6, 1.6), skew: kind === 'whistle' ? 1 : R.range(.8, 1.2), sharp: kind === 'whistle' ? 1.3 : .7});
  }
  return vocab;
}
function songPhrase(out, sr, R, t0, amp = 1) {
  // grammar: OPENER (1-2 chips) + MOTIF (1-3 syllables from the vocabulary) x2-4, each repeat stepped in pitch with a rising or
  // falling contour, a different last repeat sometimes + CLOSER (a falling sweep)
  const vocab = makeVocab(R), motif = []; for (let k = R.int(1, 3); k > 0; k--) motif.push(R.pick(vocab));
  const reps = R.int(2, 3), step = R.pick([1.04, 1.07, .95, .93, 1]), seq = [];
  for (let k = R.int(1, 2); k > 0; k--) seq.push({...vocab[0], kind: 'chip', dur: R.range(.02, .04), fm: 1, gap: R.range(.03, .08)});
  for (let r = 0; r < reps; r++) motif.forEach((m, j) => seq.push({...m, fm: Math.pow(step, r), gap: j < motif.length - 1 ? R.range(.015, .04) : R.range(.05, .11), vary: r === reps - 1 && R() < .4}));
  const last = vocab[vocab.length - 1];
  seq.push({...last, f1: last.f1 * 1.04, f2: last.f1 * R.range(.55, .75), dur: R.range(.08, .16), kind: 'sweep', fmDepth: 0, am: 0, fm: 1, gap: 0});
  let t = t0, k = 0; const n = seq.length;
  for (const s of seq) {
    const g = (s.vary ? R.range(1.1, 1.25) : 1) * s.fm, v = {...s, dur: s.dur * R.range(.92, 1.08) * (s.vary ? R.range(.8, 1.3) : 1), f1: s.f1 * g * R.range(.985, 1.015), f2: s.f2 * g * (s.vary ? R.range(.8, 1.2) : 1) * R.range(.985, 1.015), amp: amp * R.range(.8, 1) * (.75 + .25 * Math.sin(Math.PI * (k + 1) / (n + 1)) * 1.4)};
    v.f1 = clamp(v.f1, 1100, 4200); v.f2 = clamp(v.f2, 1100, 4300);
    syllable(out, sr, R, t, v); t += v.dur + (s.gap || R.range(.02, .06)) * R.range(.85, 1.2); k++;
  }
  return t - t0;
}

// ----------------------------------------------------------------------------------------------------- crow
function caw(out, sr, R, t0, {dur = .22, f0 = 520, amp = 1}) {
  const n = Math.round((dur + .06) * sr), x = new Float32Array(n); let ph = 0, wob = 0;
  const half = dur * .5, nh = Math.floor(6500 / f0);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / dur;
    wob += (R() * 2 - 1 - wob) * .02;
    let f = f0 * (1.12 - .32 * smoothstep(u * 1.1) + .035 * wob);   // falling caw with period jitter
    ph += TAU * f / sr;
    const env = (t < .012 ? t / .012 : 1) * (t > dur ? Math.exp(-(t - dur) / .012) : 1) * (1 - .25 * smoothstep(u));
    // rasp: strong 70-110 Hz AM and period doubling in the second half
    const rasp = 1 - .55 * (.5 + .5 * Math.sin(TAU * (88 + 12 * wob) * t)) - (u > .45 ? .2 * (.5 + .5 * Math.cos(ph * .5)) : 0);
    let s = 0; for (let k = 1; k <= nh; k++) s += Math.sin(k * ph + k * k * .01) / Math.pow(k, .85);
    x[i] = (s + (R() * 2 - 1) * .5) * env * rasp;
  }
  // nasal formants: three resonances; the first two slide down a little during the call
  const fa = new Biquad('bandpass', 760, 5, sr), fb = new Biquad('bandpass', 1500, 6, sr), fc = new Biquad('bandpass', 2700, 6, sr), lp = new Biquad('lowpass', 4200, .7, sr);
  for (let i = 0; i < n; i++) {
    if (i % 64 === 0) { const u = Math.min(1, i / sr / dur); fa.set('bandpass', 780 - 140 * u, 5); fb.set('bandpass', 1550 - 260 * u, 6); }
    const v = x[i]; x[i] = lp.process(fa.process(v) * 1.4 + fb.process(v) * 1.0 + fc.process(v) * .6);
  }
  endFade(x, sr, 15); addAt(out, x, t0 * sr, amp * .5);
}

// ----------------------------------------------------------------------------------------------------- owl
function hoot(out, sr, R, t0, {dur = .4, f0 = 380, glide = -.08, trem = 0, tremRate = 9, amp = 1, attack = .06}) {
  const n = Math.round((dur + .18) * sr), x = new Float32Array(n), br = whiteN(n, R); bq(br, 'bandpass', f0 * 2.2, 2.2, sr); let ph = 0;
  const vr = R.range(4.5, 6.5), vp = R() * TAU;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = Math.min(1, t / dur);
    const f = f0 * (1 + glide * smoothstep(u * 1.1) + .008 * Math.sin(TAU * vr * t + vp));
    ph += TAU * f / sr;
    const env = (t < attack ? Math.pow(t / attack, 1.8) : 1) * (t > dur - .02 ? Math.exp(-(t - dur + .02) / .07) : 1) * (trem ? 1 - trem * .5 + trem * .5 * Math.cos(TAU * tremRate * t) : 1);
    x[i] = env * (Math.sin(ph) + .38 * Math.sin(2 * ph + .4) + .13 * Math.sin(3 * ph + 1) + .04 * Math.sin(4 * ph)) + br[i] * env * .06;
  }
  endFade(x, sr, 40); addAt(out, x, t0 * sr, amp * .5);
}

// ----------------------------------------------------------------------------------------------------- cricket / frog
function chirpPulse(out, sr, R, t0, {fc, dur, amp}) {
  const n = Math.round((dur * 2.4) * sr), x = new Float32Array(n), ph0 = R() * TAU;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / dur, env = u < 1 ? Math.pow(Math.sin(Math.PI * u / 2), 2) : Math.exp(-(t - dur) / (dur * .35));   // swell, then a short resonant ring
    const f = fc * (1 + .01 * Math.exp(-t / .004));
    x[i] = env * (Math.sin(TAU * f * t + ph0) + .12 * Math.sin(TAU * 2 * f * t + 1)) * amp;
  }
  endFade(x, sr, 5); addAt(out, x, t0 * sr, 1);
}
function croak(out, sr, R, t0, {dur = .16, f0 = 100, f1 = 62, r1 = 700, r2 = 1450, amp = 1}) {
  const n = Math.round((dur + .08) * sr), x = new Float32Array(n), ex = new Float32Array(n);
  let t = 0; while (t < dur) { const u = t / dur, per = 1 / lerp(f0, f1, u) * R.jit(.1); const i = Math.round(t * sr); if (i < n) ex[i] += (u < .1 ? u / .1 : 1) * (1 - .6 * smoothstep((u - .6) / .4)) * R.range(.7, 1); t += per; }
  const a = new Biquad('bandpass', r1, 3.5, sr), b = new Biquad('bandpass', r2, 4, sr), c = new Biquad('bandpass', 280, 2, sr);
  for (let i = 0; i < n; i++) { const e = ex[i]; x[i] = a.process(e) * 1.2 + b.process(e) * .9 + c.process(e) * .8; }
  bq(x, 'lowpass', 3600, .7, sr); endFade(x, sr, 25); addAt(out, x, t0 * sr, amp);
}

// ----------------------------------------------------------------------------------------------------- water
function plip(out, sr, t0, r, amp, xi = .12, dampMul = 1) {   // dsp.bubble's model, local copy (a damped phasor)
  const f0 = 3 / r, d = (.13 / r + .0072 * Math.pow(r, -1.5)) * dampMul, i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round(Math.min(1.4, 7 / d) * sr));
  let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, f = f0 * (1 + xi * d * t); if (f > sr * .45) break; ph += TAU * f / sr; out[i0 + i] += amp * Math.exp(-d * t) * Math.min(1, i / 12) * Math.sin(ph); }
}
function blub(out, sr, i0, f0, d, xi, amp, ramp = .002) {   // lava bloop: recursive damped phasor with rising pitch
  const n = Math.min(out.length - i0, Math.round(Math.min(1.4, 7.2 / d) * sr)), dec = Math.exp(-d / sr), rn = Math.max(2, Math.round(ramp * sr));
  let re = amp, im = 0, cr = 1, ci = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) { const f = f0 * (1 + xi * d * (i + 7.5) / sr); if (f > sr * .45) break; const w = TAU * f / sr; cr = dec * Math.cos(w); ci = dec * Math.sin(w); }
    const nr = re * cr - im * ci; im = re * ci + im * cr; re = nr;
    out[i0 + i] += im * (i < rn ? .5 - .5 * Math.cos(Math.PI * i / rn) : 1);
  }
}
function noiseBurst(out, sr, R, t0, {dur = .02, amp = 1, f = 3000, q = .8, hp = 0, atk = .0004, type = 'bandpass', lp = 0}) {
  const n = Math.round(dur * 8 * sr) + 8, b = whiteN(n, R), k = 1 / (dur * sr), na = Math.max(2, Math.round(atk * sr));
  for (let i = 0; i < n; i++) b[i] *= (i < na ? i / na : Math.exp(-(i - na) * k));
  if (type === 'bandpass') bq(b, 'bandpass', f, q, sr); else bq(b, type, f, q, sr); if (hp) bq(b, 'highpass', hp, .7, sr); if (lp) { bq(b, 'lowpass', lp, .6, sr); bq(b, 'lowpass', lp, 1.3, sr); }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(b[i])); for (let i = 0; i < n; i++) b[i] *= amp / (pk + 1e-9);
  endFade(b, sr, 4); addAt(out, b, t0 * sr, 1);
}

// ============================================================================================ cases
const KINDS = {
  wings(R, sr, p) {
    const out = new Float32Array(Math.round(1.1 * sr));
    takeoff(out, sr, R, .06, {n: R.int(3, 6), period: R.range(.065, .1), fc: R.range(420, 880), clap: R() < .6 ? R.range(.25, .6) : 0});
    return out;
  },
  scatter(R, sr, p) {
    const out = new Float32Array(Math.round(2.0 * sr)), N = R.int(4, 8);
    const starts = [0]; for (let k = 1; k < N; k++) starts.push(Math.min(.3, R.exp(.1)));
    starts.sort((a, b) => a - b).forEach((s, k) => takeoff(out, sr, R, .08 + s, {amp: R.range(.5, 1) * (k ? 1 : 1.1), n: R.int(3, 7), period: R.range(.065, .1), fc: R.range(400, 900), clap: R() < .4 ? R.range(.2, .5) : 0}));
    for (let k = R.int(1, 3); k > 0; k--) syllable(out, sr, R, .1 + R.range(0, .5), {kind: 'chip', f1: R.range(2600, 3800), f2: R.range(1900, 2600), dur: R.range(.03, .06), amp: .14, skew: 1, sharp: .7, curve: 1});
    return out;
  },
  caw(R, sr, p) {
    const out = new Float32Array(Math.round(1.8 * sr)), n = R.int(1, 3), f0 = R.range(430, 640); let t = .03;
    for (let k = 0; k < n; k++) { const dur = R.range(.15, .28) * (k ? .85 : 1); caw(out, sr, R, t, {dur, f0: f0 * R.range(.94, 1.08), amp: k ? .9 : 1}); t += dur + R.range(.14, .3); }
    return out;
  },
  songbird(R, sr, p) {
    const out = new Float32Array(Math.round(2 * sr)); songPhrase(out, sr, R, .05, 1); return out;
  },
  owl(R, sr, p) {
    const out = new Float32Array(Math.round(4.2 * sr)), f0 = R.range(300, 520), pat = R() < .5;
    let t = .05;
    hoot(out, sr, R, t, {dur: R.range(.25, .4), f0, glide: -.06, amp: .8}); t += .42 + R.range(.1, .3);
    if (pat) { hoot(out, sr, R, t, {dur: R.range(.2, .3), f0: f0 * .96, glide: -.07, amp: .75}); t += .35 + R.range(.1, .25); }
    hoot(out, sr, R, t, {dur: R.range(.8, 1.2), f0: f0 * R.range(.94, 1.04), glide: R.range(-.14, -.04), trem: R.range(.4, .65), tremRate: R.range(7, 12), amp: 1, attack: .09});
    return out;
  },
  cricket(R, sr, p) {
    const out = new Float32Array(Math.round(.4 * sr)), fc = R.range(2100, 3500), n = R.int(3, 5), per = R.range(.022, .034); let t = .01;
    for (let k = 0; k < n; k++) { chirpPulse(out, sr, R, t, {fc: fc * R.range(.99, 1.01), dur: R.range(.01, .02), amp: (1 - .06 * k) * R.range(.85, 1)}); t += per * R.range(.9, 1.1); }
    return out;
  },
  frog(R, sr, p) {
    const out = new Float32Array(Math.round(.8 * sr)), f0 = R.range(80, 130), r1 = R.range(560, 900), r2 = R.range(1200, 1800); let t = .02;
    const n = R() < .45 ? 2 : 1;
    for (let k = 0; k < n; k++) { const dur = R.range(.1, .2) * (k ? .75 : 1); croak(out, sr, R, t, {dur, f0: f0 * (k ? 1.05 : 1), f1: f0 * R.range(.5, .7), r1, r2, amp: k ? .8 : 1}); t += dur + R.range(.07, .13); }
    return out;
  },
  fish(R, sr, p) {
    const out = new Float32Array(Math.round(1.6 * sr)), air = R.range(.14, .3), tIn = .06 + air;
    noiseBurst(out, sr, R, .0, {dur: R.range(.02, .035), amp: .28, f: R.range(1400, 2800), q: .7, hp: 600, lp: 3200});               // exit swish
    noiseBurst(out, sr, R, .01, {dur: .06, amp: .1, f: 1200, q: .6, hp: 500, lp: 2500});
    const r = R.range(.003, .007);
    plip(out, sr, tIn + .003, r, 1, R.range(.12, .3), R.range(1, 1.5));                                                       // the plip
    noiseBurst(out, sr, R, tIn, {dur: R.range(.012, .025), amp: .85, f: R.range(1500, 3200), q: .7, hp: 400, lp: 3200});               // entry slap
    noiseBurst(out, sr, R, tIn, {dur: .09, amp: .22, f: 800, q: .7, lp: 2500});
    for (let k = R.int(2, 5), t = tIn + R.range(.05, .12); k > 0; k--) { plip(out, sr, t, R.range(.0013, .0028), R.range(.2, .45), R.range(.1, .3), R.range(1.3, 2)); t += R.range(.03, .14); }   // droplets
    if (R() < .7) plip(out, sr, tIn + R.range(.12, .25), r * R.range(.5, .8), R.range(.3, .5), .2, 1.4);                      // closing second bubble
    return out;
  },
  critter(R, sr, p) {
    const dur = R.range(.32, .5), out = new Float32Array(Math.round((dur + .2) * sr)), step = R.range(.055, .09), steps = [];
    for (let t = R.range(0, .03); t < dur; t += step * R.range(.8, 1.2)) steps.push(t);
    const bell = t => Math.pow(Math.sin(Math.PI * clamp(t / dur, 0, 1)), 1.2);
    let t = 0; const rate = 90;   // grains/s
    while (t < dur) {
      t += R.exp(1 / (rate * (.35 + bell(t))));
      if (t >= dur) break;
      let near = 0; for (const s of steps) near = Math.max(near, Math.exp(-Math.abs(t - s) / .018));
      const a = (.12 + .88 * near) * bell(t) * R.pow(.15, 1, 1.5), gd = R.range(.003, .014);
      noiseBurst(out, sr, R, t, {dur: gd, amp: a, f: R.range(600, 2600), q: R.range(.8, 1.6), atk: .0006, lp: 3600});
    }
    for (const s of steps) if (R() < .7) noiseBurst(out, sr, R, s, {dur: .012, amp: .35 * bell(s), f: R.range(250, 600), q: .8, atk: .001});   // soft footfall
    return out;
  },
  rift_whisper(R, sr, p) {   // one distant whisper phrase: noise through three vowel formants hopping at 3-6 syllables/s, soft fricatives
    const rate = R.range(3, 6), nSy = R.int(5, 11), dur = nSy / rate, n = Math.round((dur + .5) * sr), size = R.range(.85, 1.2), out = new Float32Array(n);
    const names = Object.keys(VOWELS); const sy = []; let vow = R.pick(names);
    for (let s = 0; s < nSy; s++) { const nxt = R.pick(names); sy.push({t: s / rate, d: 1 / rate * R.range(.85, 1.15), a: VOWELS[vow], b: VOWELS[nxt], fr: R() < .45 ? R.range(.5, 1) : 0, jf: R.range(.94, 1.08) * size}); vow = nxt; }
    const x = whiteN(n, R), fz = whiteN(n, R); bq(fz, 'bandpass', 2800, 1.2, sr); bq(fz, 'lowpass', 3600, .54, sr); bq(fz, 'lowpass', 3600, 1.3, sr);
    const fl = [new Biquad('bandpass', 500, 7, sr), new Biquad('bandpass', 1300, 9, sr), new Biquad('bandpass', 2400, 10, sr)], gq = [1, .7, .25];
    let cur = sy[0], si = 0, env = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; while (si < sy.length - 1 && t >= sy[si + 1].t) si++; cur = sy[si];
      const pu = clamp((t - cur.t) / cur.d, 0, 1), sm = pu * pu * (3 - 2 * pu);
      if (i % 64 === 0) for (let q = 0; q < 3; q++) fl[q].set('bandpass', clamp((cur.a[q] + (cur.b[q] - cur.a[q]) * sm) * cur.jf, 150, 3600), [7, 9, 10][q]);
      const e = (t < dur ? Math.pow(Math.sin(Math.PI * pu), 1.6) : 0) * Math.pow(Math.sin(Math.PI * clamp(t / dur, 0, 1)), .5);
      let y = 0; for (let q = 0; q < 3; q++) y += fl[q].process(x[i]) * gq[q];
      out[i] = y * e * 2.4 + fz[i] * cur.fr * Math.max(0, 1 - pu * 3.3) * .12 * e;
    }
    bq(out, 'lowpass', 3300, .54, sr); bq(out, 'lowpass', 3300, 1.3, sr); endFade(out, sr, 120);
    return out;
  },
  rift_shimmer(R, sr, p) {   // a crystalline swell: detuned A-major-ish partials, 4-7 Hz tremolo, a few soft sparkle pings
    const rise = R.range(.9, 1.5), fall = R.range(1.2, 2), dur = rise + fall + .6, out = new Float32Array(Math.round((dur + .8) * sr));
    const sets = [[440, 659.26, 880, 1108.7, 1318.5], [440, 523.25, 659.26, 880, 1046.5], [329.63, 440, 554.37, 880, 1108.7]], set = R.pick(sets), tr = R.range(4, 7), trD = R.range(.15, .3);
    const envA = new Float32Array(out.length); for (let i = 0; i < out.length; i++) { const t = i / sr; envA[i] = t < rise ? Math.pow(Math.sin(Math.PI / 2 * t / rise), 2) : Math.exp(-(t - rise) / (fall * .38)); }
    set.forEach((f0, k) => {
      for (let v = 0; v < 2; v++) {
        const f = f0 + (v ? R.range(.8, 4) : 0), w = TAU * f / sr, ph = R() * TAU, tph = R() * TAU, g = (1 - k * .16) * (v ? .7 : 1) * R.range(.6, 1.2);
        if (f > 1500 && R() < .4) continue;
        let c = Math.cos(ph), sn = Math.sin(ph), tc = Math.cos(tph), ts = Math.sin(tph); const cw = Math.cos(w), sw = Math.sin(w), tcw = Math.cos(TAU * tr / sr), tsw = Math.sin(TAU * tr / sr);
        for (let i = 0; i < out.length; i++) {   // rotating phasors: 1 mul-add per sample instead of a sin()
          const e = envA[i];
          out[i] += sn * e * g * (1 - trD + trD * ts) * .22;
          let q = c * cw - sn * sw; sn = c * sw + sn * cw; c = q; q = tc * tcw - ts * tsw; ts = tc * tsw + ts * tcw; tc = q;
        }
      }
    });
    for (let k = R.int(2, 5); k > 0; k--) { const t = R.range(.3, rise + fall * .8), f = R.pick([880, 1318.5, 1760, 2217.5]) * R.range(.997, 1.003), d = R.range(.05, .14), n = Math.round(d * 7 * sr), i0 = Math.round(t * sr), a = R.range(.03, .1); for (let i = 0; i < n && i0 + i < out.length; i++) out[i0 + i] += Math.sin(TAU * f * i / sr) * Math.exp(-i / (d * sr)) * Math.min(1, i / 90) * a; }
    bq(out, 'lowpass', 3500, .6, sr); endFade(out, sr, 200);
    return out;
  },
  lava_belch(R, sr, p) {
    const out = new Float32Array(Math.round(2.2 * sr)), f0 = R.range(62, 110), r = 3 / f0, d = clamp((.13 / r + .0072 * Math.pow(r, -1.5)) * R.range(2.5, 5), 8, 40);
    const tmp = new Float32Array(Math.round(1.6 * sr)); blub(tmp, sr, 0, f0, d, R.range(.3, .55), 1, R.range(.012, .03));
    for (let i = 0; i < tmp.length; i++) tmp[i] = Math.tanh(tmp[i] * 3.5) / 3.5; addAt(out, tmp, .08 * sr, 3);
    blub(tmp.fill(0), sr, 0, f0 * 1.9, d * 1.6, .3, .5, .012); for (let i = 0; i < tmp.length; i++) tmp[i] = Math.tanh(tmp[i] * 3) / 3; addAt(out, tmp, .1 * sr, 1.6);
    const tp = .08 + R.range(.12, .22);   // the burst
    noiseBurst(out, sr, R, tp, {dur: R.range(.015, .035), amp: 1.1, f: R.range(500, 1800), q: 1.1});
    noiseBurst(out, sr, R, tp, {dur: R.range(.08, .16), amp: .3, f: 1300, q: .6, lp: 2800, atk: .012});             // gas hiss (dark band)
    for (let k = R.int(3, 7), t = tp + R.range(.06, .14); k > 0; k--) { blub(tmp.fill(0), sr, 0, R.range(180, 420), R.range(30, 60), R.range(.2, .5), R.range(.3, .7), .004); for (let i = 0; i < tmp.length; i++) tmp[i] = Math.tanh(tmp[i] * 2.5) / 2.5; addAt(out, tmp, t * sr, R.range(.5, 1)); noiseBurst(out, sr, R, t, {dur: .008, amp: .2, f: R.range(1000, 3000), q: 1}); t += R.range(.05, .22); }
    return out;
  },
};

export default {
  id: 'creature', version: 2, desc: 'Wildlife one-shots: wings, scatter, caw, songbird, owl, cricket, frog, fish, critter, lava_belch, rift_whisper, rift_shimmer',
  params: {kind: {values: Object.keys(KINDS), def: 'wings'}},
  cases: Object.fromEntries(Object.keys(KINDS).map(k => [k, {kind: k}])),
  variants: 6,
  loop: false,
  render(p, R, sr) { const out = (KINDS[p.kind] || KINDS.wings)(R, sr, p); bq(out, 'highshelf', 4500, .7, sr, -9); bq(out, 'lowpass', 7000, .6, sr); return out; },   // warm tilt on everything
  criteria: {
    // one-shots: dark (95% band edge <= ~4.6 kHz), natural tails; clickEnd <= .01 on all
    wings: {clickEnd: [0, .01], durMs: [300, 1000], centroidHz: [600, 1700], highHz: [1200, 3600], attackMs: [10, 220], onsetCount: [1, 8]},
    scatter: {clickEnd: [0, .01], durMs: [550, 1400], centroidHz: [800, 1700], highHz: [1800, 3900], attackMs: [10, 450]},
    caw: {clickEnd: [0, .01], durMs: [200, 1500], centroidHz: [600, 1300], highHz: [1000, 3300], flatness: [0, .01]},
    songbird: {clickEnd: [0, .01], durMs: [400, 2300], centroidHz: [1200, 3600], highHz: [1800, 4600], flatness: [0, .01]},
    owl: {clickEnd: [0, .01], durMs: [1500, 3000], centroidHz: [250, 700], highHz: [450, 1200], attackMs: [300, 1500], flatness: [0, .005]},
    cricket: {clickEnd: [0, .01], durMs: [90, 260], centroidHz: [2000, 3700], highHz: [2100, 3800], flatness: [0, .01]},
    frog: {clickEnd: [0, .01], durMs: [120, 600], centroidHz: [800, 1800], highHz: [1800, 3300]},
    fish: {clickEnd: [0, .01], durMs: [350, 1100], centroidHz: [600, 1800], highHz: [1800, 3800], onsetCount: [1, 8]},
    critter: {clickEnd: [0, .01], durMs: [280, 650], centroidHz: [900, 2500], highHz: [2400, 4200]},
    lava_belch: {clickEnd: [0, .01], durMs: [700, 1900], centroidHz: [120, 800], highHz: [350, 3200], attackMs: [5, 80]},
    rift_whisper: {clickEnd: [0, .01], durMs: [700, 4000], centroidHz: [700, 1800], highHz: [1800, 3400], flatness: [0, .01]},
    rift_shimmer: {clickEnd: [0, .01], durMs: [3000, 5000], centroidHz: [350, 900], highHz: [700, 1700], flatness: [0, .005]},
  },
  notes: 'wildlife synthesis: noise-swell flaps, harmonic+formant caw, FM/AM syllable grammar, hooting owl, resonant cricket pulses, pulse-excited croak, bubble plips, grass grains, lava bloop',
};
