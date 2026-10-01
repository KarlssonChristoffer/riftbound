// EXPLOSION: the black-powder barrel and the explosive arrow, plus the burning fuse. docs/AUDIO.md §2.3 "Explosion".
// Five layers on one timeline, glued with tanh:
//   1. crack   a Friedlander blast wave p(t) = (1 - t/t+)·e^(-b·t/t+), t+ 1.5-4 ms (positive phase), short noise crackle on top
//   2. boom    brown noise low-passed at 40-150 Hz + a sine sweep 60 -> 30 Hz (the sub), soft 4-8 ms onset, ~0.4 s decay
//   3. roar    the fireball: pink noise band-passed 200-800 Hz sliding downwards, peaky turbulence AM, 0.4-0.9 s
//   4. debris  fracture model: 15-40 wooden fragments (power-law sizes, modes ∝ 1/size, q 6-14) thrown up by the blast
//              (v 3-10 m/s) land from 0.4 s to 1.7 s and bounce (e .3-.5), plus a gravel/dirt spray (PhISEM) over them
//   5. tail    brown rumble whose cut-off keeps falling (400 -> 70 Hz) + 2-4 low-passed echoes off the terrain
// `small` (explosive arrow) scales all of it down (higher, shorter, drier); `distant` low-passes the whole event, drops
// the crack for a dull thump and lengthens the echoes; `fuse` is the fizzing wick: a dark low-passed fizz (soft bed, dense micro-grain sizzle) + Poisson sparks, no hiss.
// Reference takes (explode_1/2, -20 LUFS): centroid 150-170 Hz, 95 % of the energy under ~800 Hz, T60 2.7-2.9 s, 2.5 s long.
import {halfSine, add, scale, peak, filter, sweep, onePoleLP, noise, brown, pink, white, phisem, saturate, bounces} from '../dsp.js';

const PI = Math.PI, G = 9.81, lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const q60 = (q, f) => 6.9078 * q / (PI * f);
const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length + 1e-20); };
const unitRms = b => { const g = 1 / rms(b); for (let i = 0; i < b.length; i++) b[i] *= g; return b; };

// ============================================================================================ helpers (kernel candidates)
function tailFade(b, sr, sec = .01) { const nf = Math.min(b.length, Math.round(sec * sr)); for (let i = 0; i < nf; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(PI * i / nf); return b; }
// Friedlander blast wave: positive phase tp (s), decay shape b, then the small negative phase; length 8·tp
function friedlander(sr, tp, b = 1) {
  const n = Math.round(8 * tp * sr), w = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr / tp; w[i] = (1 - t) * Math.exp(-b * t); }
  return w;
}
// smooth attack-decay envelope: (1 - e^-t/a)·e^-t/d (no corners), length to -80 dB
const adEnv = (n, sr, a, d) => { const e = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; e[i] = (1 - Math.exp(-t / a)) * Math.exp(-t / d); } return e; };
// slowly varying peaky modulator in [0, ~1.5]: smoothed noise raised to a power (flame / turbulence flicker)
function flicker(n, sr, R, hz, pw = 2, depth = 1) {
  const b = new Float32Array(n), k = 1 - Math.exp(-2 * PI * hz / sr), g = Math.sqrt(2 / k) * .35; let y = 0;
  for (let i = 0; i < n; i++) { y += (R() * 2 - 1 - y) * k; b[i] = Math.pow(Math.max(0, 1 + depth * y * g * .6), pw); }
  return b;
}
// sparse modal strike (see impact.js `strike`)
function strike(out, sr, at, modes, {tc = .001, amp = 1, tail = 1.35} = {}) {
  const x = halfSine(tc, sr), i0 = Math.max(0, Math.round(at * sr)); if (i0 >= out.length) return out;
  for (const m of modes) {
    if (!(m.f > 0) || m.f > sr * .45) continue;
    const len = Math.min(out.length - i0, x.length + Math.round(m.t60 * tail * sr));
    const w = 2 * PI * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = amp * m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0, i = 0;
    for (const ne = Math.min(len, x.length + 1); i < ne; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < x.length ? x[i] : 0; y2 = y1; y1 = y; out[i0 + i] += y; }
    for (; i < len; i++) { const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; out[i0 + i] += y; }
  }
  return out;
}
const BEAM = [1, 2.756, 5.404, 8.933];

// ============================================================================================ explosion layers
// P: scale parameters (see CASE below). Every layer is built in its own buffer of length n and normalised to a level.
function blast(n, sr, R, P) {
  const out = new Float32Array(n);
  // ---- 1. crack: Friedlander wave (+ negative-phase tail) and a crackle of gas/powder noise
  const tp = P.tp * R.jit(.2), fw = friedlander(sr, tp, R.range(.8, 1.3));
  const crack = new Float32Array(Math.round(.06 * sr)); add(crack, fw, 0, 1);
  filter(crack, 'lowpass', P.crackLP, .7071, sr); filter(crack, 'highpass', P.crackHP, .7071, sr);
  const cn = noise(Math.round(.05 * sr), R, 'white'), ce = adEnv(cn.length, sr, .0002, P.crackD);
  for (let i = 0; i < cn.length; i++) cn[i] *= ce[i];
  filter(cn, 'bandpass', P.crackBP * R.jit(.2), .8, sr);
  norm(crack); add(crack, norm(cn), 0, .6);   // the noise crackle rides on the wave
  add(out, crack, 0, P.crack);

  // ---- 2. boom: brown noise LP + sub sweep
  const bn = Math.round((P.boomD * 9.2 + .1) * sr), boom = filter(brown(bn, R), 'lowpass', P.boomLP * R.jit(.15), .8, sr);
  filter(boom, 'highpass', 28, .7071, sr);
  const be = adEnv(bn, sr, P.boomA * R.jit(.2), P.boomD * R.jit(.1));
  for (let i = 0; i < bn; i++) boom[i] *= be[i];
  add(out, norm(boom), 0, P.boom);
  const sn = Math.round((P.subD * 9.2 + .1) * sr), sub = new Float32Array(sn), f0 = P.subF0 * R.jit(.1), f1 = P.subF1 * R.jit(.1); let ph = 0;
  const se = adEnv(sn, sr, .005, P.subD);
  for (let i = 0; i < sn; i++) { const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t / P.subT); ph += 2 * PI * f / sr; sub[i] = Math.sin(ph) * se[i]; }
  // a touch of noise in the sub: a real blast wave is not a sine (random phase wobble through the amplitude)
  const wob = flicker(sn, sr, R, 9, 1, .35); for (let i = 0; i < sn; i++) sub[i] *= wob[i];
  add(out, norm(sub), 0, P.sub);

  // ---- 3. roar: the fireball, a band sliding down with peaky turbulence
  const rn = Math.round((P.roarD * 9.2 + .1) * sr), roar = pink(rn, R), re = adEnv(rn, sr, P.roarA, P.roarD), fl = flicker(rn, sr, R, P.roarFl, 2, 1);
  for (let i = 0; i < rn; i++) roar[i] *= re[i] * fl[i];
  sweep(roar, 'bandpass', t => P.roarF1 + (P.roarF0 - P.roarF1) * Math.exp(-t / (P.roarD * .7)), 1.0, sr, {every: 48});
  filter(roar, 'highpass', 120, .7071, sr);
  add(out, norm(tailFade(roar, sr)), Math.round(R.range(0, .01) * sr), P.roar);

  // ---- 4. debris: wooden fragments fall back and bounce, a gravel spray runs under them
  const deb = new Float32Array(n);
  for (let k = 0; k < P.frag; k++) {
    const sz = R.pow(.06, 1, 1.7);                    // relative size, power-law: many small, few large
    const v = R.range(P.vUp[0], P.vUp[1]) * R.range(.5, 1), tl = Math.max(.12, 2 * v / G * R.range(.85, 1.1) + R.range(0, .04));
    const f0 = R.range(P.fragF[0], P.fragF[1]) / Math.pow(sz, .6), amp = Math.pow(sz, .8) * (.3 + .7 * Math.min(1, v / P.vUp[1]));
    const modes = BEAM.slice(0, sz > .3 ? 4 : 2).map((r, i) => ({f: f0 * r * R.jit(.03), t60: q60(R.range(4, 9), f0 * r), a: 1 / (1 + .7 * i)}));
    const seq = bounces(R, {t0: tl, v0: 1, e: R.range(.3, .5), dt0: R.range(.05, .14), minV: .3, jitter: .3, max: 3});
    for (const b of seq) if (b.t < n / sr - .2) strike(deb, sr, b.t, modes, {tc: R.range(.5, 1.2) / 1000 / Math.sqrt(sz + .2), amp: amp * b.v});
  }
  filter(deb, 'highpass', P.debHP, .7071, sr);
  add(out, norm(deb), 0, P.deb);
  const gn = Math.round(Math.min(n / sr - .1, P.gravelEnd) * sr), ge = new Float32Array(gn);
  for (let i = 0; i < gn; i++) { const t = i / sr, g = (t - P.gravelStart) / P.gravelW; ge[i] = (.5 * Math.exp(-t / .22) + Math.exp(-.5 * g * g)) * Math.min(1, i / (.02 * sr)); }   // blast spray, then the rain of pieces
  const gv = phisem(gn, sr, R, {objects: 700, soundDecay: .93, res: [[R.range(1400, 2200), .8, 1], [R.range(3500, 5000), .6, .5]], energy: ge});
  add(out, norm(tailFade(filter(gv, 'highpass', 700, .7071, sr), sr)), 0, P.gravel);

  // ---- 5. tail: a rumble with a falling cut-off, and echoes off the terrain
  const tn = Math.min(n, Math.round((P.tailD * 9.2 + .2) * sr)), tail = brown(tn, R), te = adEnv(tn, sr, .03, P.tailD);
  for (let i = 0; i < tn; i++) tail[i] *= te[i];
  sweep(tail, 'lowpass', t => P.tailF1 + (P.tailF0 - P.tailF1) * Math.exp(-t / (P.tailD * .8)), .8, sr, {every: 48});
  filter(tail, 'highpass', 30, .7071, sr);
  add(out, norm(tailFade(tail, sr)), Math.round(.02 * sr), P.tail);
  const core = new Float32Array(Math.min(n, Math.round(.9 * sr))); add(core, out, 0, 1); filter(core, 'lowpass', P.echoLP, .7071, sr);
  for (let k = 0, t = R.range(P.echoT0[0], P.echoT0[1]), g = P.echo; k < P.echoes; k++, t += R.range(.15, .4) * (1 + k * .4), g *= R.range(.55, .8)) {
    const e = core.slice(); filter(e, 'lowpass', P.echoLP * Math.pow(.8, k + 1), .7071, sr);
    for (let i = 0; i < e.length; i++) e[i] *= Math.exp(-i / (.45 * sr)) ;
    add(out, e, Math.round(t * sr), g);
  }
  return out;
}

// scale parameters per size
const BARREL = {
  dur: 2.6, tp: .0035, crack: .95, crackLP: 9000, crackHP: 90, crackBP: 3500, crackD: .004,
  boom: 1, boomLP: 105, boomA: .006, boomD: .27, sub: .7, subF0: 62, subF1: 32, subT: .26, subD: .36,
  roar: .6, roarA: .012, roarD: .3, roarF0: 1400, roarF1: 300, roarFl: 14,
  frag: 26, vUp: [3, 11], fragF: [170, 380], debHP: 110, deb: .22, gravel: .16, gravelStart: .85, gravelW: .3, gravelEnd: 2.0,
  tail: .45, tailD: .34, tailF0: 330, tailF1: 70, echoLP: 380, echoes: 3, echo: .3, echoT0: [.2, .32],
};
const SMALL = {
  dur: 1.15, tp: .0018, crack: 1, crackLP: 8500, crackHP: 160, crackBP: 4500, crackD: .0025,
  boom: .9, boomLP: 190, boomA: .004, boomD: .16, sub: .5, subF0: 110, subF1: 58, subT: .12, subD: .2,
  roar: .8, roarA: .008, roarD: .17, roarF0: 1800, roarF1: 380, roarFl: 18,
  frag: 11, vUp: [2, 5.5], fragF: [260, 560], debHP: 160, deb: .22, gravel: .18, gravelStart: .42, gravelW: .14, gravelEnd: .95,
  tail: .35, tailD: .22, tailF0: 520, tailF1: 110, echoLP: 450, echoes: 2, echo: .22, echoT0: [.1, .17],
};

// ---------------------------------------------------------------- the fuse: hiss bed + sparks
function fuse(p, R, sr) {
  // Dark fizz: no hiss bed. A soft low-passed "pssh" (brown/pink, steep roll-off above ~1.5 kHz, slow organic flicker) under a
  // sizzle made of DENSE discrete micro-grains (250-500/s, low-passed at 2.4-3 kHz) and sparser, louder sparks (1.2-3.8 kHz).
  const len = R.range(.72, .88), n = Math.round((len + .12) * sr), out = new Float32Array(n), I = p.intensity;
  const env = new Float32Array(n), nSw = Math.round(.04 * sr), tFade = .12;
  for (let i = 0; i < n; i++) { const t = i / sr; env[i] = Math.min(1, i / nSw) * (1 - .3 * t / len) * (t < len ? 1 : .5 + .5 * Math.cos(PI * Math.min(1, (t - len) / tFade))); }
  const fl = flicker(n, sr, R, 9, 2, 1), fl2 = flicker(n, sr, R, 25, 2, .6);
  // the soft bed: pink, 4-pole low-pass 1.4 kHz, high-passed 220 Hz
  const bed = pink(n, R); filter(bed, 'lowpass', R.range(1100, 1500), .7071, sr); filter(bed, 'lowpass', R.range(1100, 1500), .7071, sr); filter(bed, 'highpass', 220, .7071, sr);
  for (let i = 0; i < n; i++) bed[i] *= env[i] * (.3 + .7 * Math.min(1.5, fl[i]));
  add(out, unitRms(bed), 0, .25);
  // sizzle: dense micro-grains, each 0.2-1.2 ms, peaky amplitudes, then a steep low-pass
  const rate = R.range(250, 500) * (.8 + .3 * I), gmax = Math.round(.004 * sr), sz = new Float32Array(n + gmax);
  for (let t = R.exp(1 / rate); t < len + .08; t += R.exp(1 / rate)) {
    const i0 = Math.round(t * sr), a = R.pow(.1, 1, 2) * (1 - .3 * t / len), d = R.range(.0002, .0012) * sr;
    for (let j = 0; j < gmax; j++) sz[i0 + j] += a * (R() * 2 - 1) * Math.exp(-j / d);
  }
  const sizzle = sz.subarray(0, n); filter(sizzle, 'lowpass', R.range(2200, 3000), .7071, sr); filter(sizzle, 'lowpass', R.range(2200, 3000), .7071, sr); filter(sizzle, 'highpass', 500, .7071, sr);
  for (let i = 0; i < n; i++) sizzle[i] *= env[i] * (.5 + .5 * Math.min(1.5, fl2[i]));
  add(out, unitRms(sizzle), 0, .3);
  // sparks: Poisson 14-35 per second, a short (1-5 ms) burst through a band-pass 1.2-3.8 kHz, louder and peaky
  const srate = R.range(14, 35) * (.7 + .5 * I), sgm = Math.round(.015 * sr), sp = new Float32Array(n + sgm);
  for (let t = R.exp(1 / srate); t < len + .08; t += R.exp(1 / srate)) {
    const i0 = Math.round(t * sr), a = R.pow(.15, 1, 1.8) * (1 - .3 * t / len), d = R.range(.0006, .004) * sr, fc = R.range(1200, 3800), q = R.range(1.5, 3.5);
    const g = new Float32Array(sgm); for (let j = 0; j < sgm; j++) g[j] = (R() * 2 - 1) * Math.exp(-j / d) * Math.min(1, j / (.0002 * sr));
    filter(g, 'bandpass', fc, q, sr);
    for (let j = 0; j < sgm; j++) sp[i0 + j] += a * g[j] * 6;
  }
  const spk = sp.subarray(0, n); for (let i = 0; i < n; i++) spk[i] *= (t => t < len ? 1 : .5 + .5 * Math.cos(PI * Math.min(1, (t - len) / tFade)))(i / sr);
  add(out, spk, 0, 1);
  filter(out, 'highpass', 250, .7071, sr); filter(out, 'highshelf', 3500, .7071, sr, -10); filter(out, 'lowpass', 5200, .7071, sr);
  return tailFade(out, sr, .03);
}

function render(p, R, sr) {
  if (p.kind === 'fuse') return saturate(norm(fuse(p, R, sr), .9), 1.1);
  const small = p.kind === 'small', distant = p.kind === 'distant';
  const B = small ? {...SMALL} : {...BARREL};
  if (distant) Object.assign(B, {
    dur: 3.4, crack: .08, crackLP: 1500, crackHP: 60, crackBP: 800, tp: .008, boomA: .02, boomD: .5, boomLP: 90, roar: .5, roarF0: 500, roarF1: 160, roarA: .05,
    deb: .1, gravel: .03, tail: .75, tailD: .8, tailF0: 300, tailF1: 55, echoLP: 260, echoes: 4, echo: .45, echoT0: [.25, .45],
  });
  const n = Math.round(B.dur * sr), I = p.intensity;
  // per-explosion spread of the main balance: how much powder, how tamped
  B.boom *= R.range(.85, 1.15); B.roar *= R.range(.8, 1.2) * lerp(.85, 1, I); B.crack *= R.range(.8, 1.25); B.deb *= R.range(.7, 1.3); B.frag = Math.round(B.frag * R.range(.7, 1.3));
  const out = blast(n, sr, R, B);
  if (distant) {   // air and distance: everything above ~700 Hz is gone, the rest keeps closing with time
    sweep(out, 'lowpass', t => 720 * Math.exp(-t / 1.6) + 220, .7071, sr, {every: 64});
  }
  // radiation guard and the end fade (the longest echo can still be audible at the window's edge)
  filter(out, 'highpass', 26, .7071, sr); filter(out, 'highshelf', 4500, .7071, sr, -6); filter(out, 'lowpass', 8000, .7071, sr);   // warm mix: gentle shelf, the refs keep their 1-4 kHz
  const nf = Math.round(n * .22); for (let i = 0; i < nf; i++) out[n - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  return saturate(norm(out, .8), small ? 1.6 : 1.9);   // tanh glue: the layers fuse into one event
}

export default {
  id: 'explosion', version: 2, desc: 'Black-powder barrel and explosive arrow: Friedlander crack + boom/sub + fireball roar + debris + echoing tail; fuse',
  params: {
    kind: {values: ['barrel', 'small', 'distant', 'fuse'], def: 'barrel'},
    intensity: {min: 0, max: 1, def: .8},
  },
  cases: {barrel: {kind: 'barrel'}, small: {kind: 'small'}, distant: {kind: 'distant'}, fuse: {kind: 'fuse'}},
  variants: 6,
  render,
  // v2 (brightness pass): fuse is now a dark fizz (no hiss bed); barrel/small/distant shelved -6 dB above 4.5 kHz (refSim 0.95 kept); barrel vs explode_1/2 centroid 152-169 Hz, 95% band 750-800 Hz; validated on 36 seeds (1-24, 44291-44296, 6 large)
  criteria: {
    barrel: {durMs: [2200, 2600], attackMs: [5, 200], t60Ms: [1800, 5500], centroidHz: [80, 300], lowHz: [20, 60], highHz: [150, 1500], flatness: [0, .02], crest: [12, 23], clickEnd: [0, .01]},
    small: {durMs: [950, 1300], attackMs: [0, 150], t60Ms: [900, 2600], centroidHz: [150, 550], lowHz: [20, 80], highHz: [600, 2300], flatness: [0, .04], crest: [11, 22], clickEnd: [0, .01]},
    distant: {durMs: [2800, 3600], attackMs: [5, 250], t60Ms: [2500, 6500], centroidHz: [60, 140], lowHz: [20, 60], highHz: [150, 450], flatness: [0, .005], crest: [11, 22], clickEnd: [0, .01]},
    fuse: {durMs: [750, 1100], t60Ms: [700, 1700], centroidHz: [700, 1600], lowHz: [200, 450], highHz: [1700, 3200], flatness: [0, .01], crest: [12, 27], clickEnd: [0, .01]},
  },
  refs: {barrel: ['assets/sfx/explode_1.mp3', 'assets/sfx/explode_2.mp3']},
  notes: 'Friedlander blast wave, brown-noise boom + sub sweep, fireball band, fracture debris (bounces), falling-cut-off rumble + echoes (AUDIO.md §2.3); fuse = dark fizz + sparks',
};
