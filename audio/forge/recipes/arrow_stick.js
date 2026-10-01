// ARROW_STICK: an arrow ending its flight in the ground. The ranger fires a lot, so everything here is short, light and
// dull-edged (no sustained ring, nothing above ~8 kHz that sits on top of the mix). Per surface:
//   ground  packed earth: a soft low thump (a lossy earth mode, q 1.5-3), a pink-noise earth crunch (BP 500-1100 Hz,
//           6-10 ms), a tiny grit spray, a faint tick of the arrowhead, and the shaft wobbling in the soil: the
//           cantilever modes (1 : 6.27 : 17.55) with a detuned twin, so the wobble beats (70-180 Hz, T60 90-170 ms).
//   stone   a hard tock: dense short stone modes 1-4 kHz (q 5-14, τc ~0.1 ms), a click, the shaft knocking (a wooden tube),
//           then the arrow falls and clatters (2-4 shrinking ticks) and skids (stick-slip scrape, 30-70 ms).
//   snow    a muffled puff (low-passed pink noise, soft 2-4 ms attack), a deep soft thump (60-110 Hz) and a short crunch of
//           snow grains (1.5-4 kHz micro-snaps, dense then thinning), all under a 4.5 kHz low-pass.
//   crystal an arrow into glassy magic-crystal ground (v3, the rift biome): a short glassy tick, a dull thud (a lossy low mode + dark
//           pink noise), a tiny DAMPED beating ring (three twin pairs 1.3-2.9 kHz, q <= 260 and T60 <= 150 ms: it is a glint, not
//           a bell), a couple of faint shard ticks skittering off, and a faint shaft wobble. Dark: shelf -10 dB above 3.5 kHz, LP 5.2 kHz.
//   ricochet off stone: the steel head's bright ping (two inharmonic modes 2.4-5 kHz, T60 40-100 ms) + a tick, the arrow
//           spinning away (BP noise 1.5-3 kHz with spin AM 25-45 Hz and the Doppler fall) and a clatter of landing ticks.
import {halfSine, add, scale, peak, filter, sweep, onePoleLP, noise, phisem, saturate} from '../dsp.js';

const PI = Math.PI, lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const q60 = (q, f) => 6.9078 * q / (PI * f);   // quality factor -> T60

// warm game-mix tone stage: gentle high shelf and a steep (24 dB/oct) low-pass
function warm(b, sr, {shelf = -9, fs = 4500, lp = 7000} = {}) { filter(b, 'highshelf', fs, .7071, sr, shelf); filter(b, 'lowpass', lp, .7071, sr); filter(b, 'lowpass', lp, .7071, sr); return b; }
// ============================================================================================ helpers (kernel candidates)
// sparse modal strike (see impact.js `strike`): modes [{f, t60, a}] excited by `exc` (half-sine of tc) at time `at`
function strike(out, sr, at, modes, {tc = .001, amp = 1, exc = null, tail = 1.35} = {}) {
  const x = exc || halfSine(tc, sr), i0 = Math.max(0, Math.round(at * sr)); if (i0 >= out.length) return out;
  for (const m of modes) {
    if (!(m.f > 0) || m.f > sr * .45 || !m.a) continue;
    const len = Math.min(out.length - i0, x.length + Math.round(m.t60 * tail * sr));
    const w = 2 * PI * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = amp * m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0, i = 0;
    for (const ne = Math.min(len, x.length + 1); i < ne; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < x.length ? x[i] : 0; y2 = y1; y1 = y; out[i0 + i] += y; }
    for (; i < len; i++) { const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; out[i0 + i] += y; }
  }
  return out;
}
const rough = (f, R, r) => { for (let i = 0; i < f.length; i++) f[i] *= 1 + r * (R() * 2 - 1); return f; };
// raised-cosine fade over the last `sec` of a buffer
function tailFade(b, sr, sec = .008) { const nf = Math.min(b.length, Math.round(sec * sr)); for (let i = 0; i < nf; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(PI * i / nf); return b; }
// noise under a smooth attack-decay envelope (1 - e^-t/a)·e^-t/d with no corners; the buffer runs to ~-80 dB, then is
// optionally band-limited. {a, d} seconds; bp/lp/hp Hz.
function puff(sr, R, {a = .0005, d = .01, color = 'pink', bp = null, q = .7, lp = null, hp = null}) {
  const n = Math.round((3 * a + 9.2 * d + .012) * sr), b = noise(n, R, color);
  for (let i = 0; i < n; i++) { const t = i / sr; b[i] *= (1 - Math.exp(-t / a)) * Math.exp(-t / d); }
  if (bp) filter(b, 'bandpass', bp, q, sr); if (lp) filter(b, 'lowpass', lp, .7071, sr); if (hp) filter(b, 'highpass', hp, .7071, sr);
  return tailFade(b, sr);
}
// micro-snaps: `count` 0.1-0.5 ms noise grains over `len` s, times ∝ u^dens (dense at first), peaky amplitudes, fading
function snaps(sr, R, len, count, fc, q = 1.2, dens = 1.8) {
  const gmax = Math.round(.003 * sr), b = new Float32Array(Math.round(len * sr) + gmax);
  for (let k = 0; k < count; k++) {
    const t = len * Math.pow(R(), dens), i = Math.round(t * sr), a = R.pow(.15, 1, 1.6) * (1 - .6 * t / len), d = R.range(.0001, .0005) * sr;
    for (let j = 0; j < gmax; j++) b[i + j] += a * (R() * 2 - 1) * Math.exp(-j / d);
  }
  return tailFade(filter(b, 'bandpass', fc, q, sr), sr);
}
// a wooden shaft knocking something: cantilever / beam modes 1 : 2.76 : 5.4 : 8.9, short
const BEAM = [1, 2.756, 5.404, 8.933];
const shaftModes = (f, t60, R, n = 4) => BEAM.slice(0, n).map((r, i) => ({f: f * r * R.jit(.02), t60: t60 / (1 + .8 * i), a: 1 / (1 + .7 * i)}));
// a fallen arrow's clatter: `k` shrinking ticks from t0, each a shaft knock + a tiny click
function clatter(out, sr, R, t0, {k = 3, f = [900, 2200], dt = [.02, .05], e = [.45, .7], level = .3, t60 = .03, bright = 4000}) {
  let t = t0, d = R.range(dt[0], dt[1]), g = 1;
  for (let j = 0; j < k && g > .08; j++, t += d, d *= R.range(e[0], e[1]), g *= R.range(.45, .75)) {
    strike(out, sr, t, shaftModes(R.range(f[0], f[1]), t60 * R.range(.7, 1.3), R, 3), {tc: R.range(.1, .3) / 1000, amp: level * g * R.range(.7, 1.1)});
    add(out, norm(puff(sr, R, {a: .00008, d: R.range(.0006, .0018), color: 'white', hp: bright * .5})), Math.round(t * sr), level * g * .5);
  }
}

// ============================================================================================ cases
function ground(p, R, sr) {
  const out = new Float32Array(Math.round(.34 * sr)), I = p.intensity, tc = lerp(7e-3, 3.5e-3, I) * R.jit(.15), hard = Math.pow(I, .7);
  // the thump: a lossy soil mode (q 1.5-3) + a second at ×2.1-2.5, struck by a soft contact
  const f0 = R.range(115, 190), th = new Float32Array(out.length);
  strike(th, sr, 0, [{f: f0, t60: q60(R.range(1.5, 3), f0), a: 1}, {f: f0 * R.range(2.1, 2.6), t60: q60(2, f0 * 2.3), a: R.range(.3, .55)}], {exc: rough(halfSine(tc, sr), R, .1)});
  add(out, norm(th), 0, R.range(.8, 1));
  // earth crunch: pink BP 500-1100, 6-10 ms, soft 0.6 ms onset
  add(out, norm(puff(sr, R, {a: .0006, d: R.range(.005, .009), bp: lerp(550, 1100, hard) * R.jit(.2), q: .6})), 0, R.range(.6, .85));
  // the arrowhead's tick through the soil (a dull one: HP 1.2 kHz, LP 4 kHz)
  add(out, norm(puff(sr, R, {a: .00008, d: R.range(.0008, .0018), color: 'white', hp: 1200, lp: R.range(2200, 3200)})), 0, R.range(.22, .4) * hard);
  // grit: a few crumbs of soil thrown aside
  const gn = Math.round(.12 * sr), en = new Float32Array(gn); for (let i = 0; i < gn; i++) en[i] = Math.exp(-i / (R.range(.02, .035) * sr));
  const grit = phisem(gn, sr, R, {objects: R.range(200, 500), soundDecay: .92, res: [[R.range(1200, 2200), .8, 1], [R.range(2800, 4000), .6, .4]], energy: en});
  add(out, norm(tailFade(filter(grit, 'highpass', 900, .7071, sr), sr)), Math.round(R.range(.001, .004) * sr), R.range(.14, .26));
  // the shaft wobbling in the ground: the audible cantilever modes with a beating twin (faint)
  const fs = R.range(70, 130), T = R.range(.09, .17), wb = new Float32Array(out.length), beat = R.range(5, 11);
  strike(wb, sr, R.range(.002, .006), [
    {f: fs, t60: T, a: 1}, {f: fs + beat, t60: T, a: .75}, {f: fs * 6.27 * R.jit(.02), t60: T * .45, a: .35}, {f: fs * 17.55 * R.jit(.02), t60: T * .2, a: .1},
  ], {tc: R.range(2, 4) / 1000});
  add(out, norm(wb), 0, R.range(.1, .2));
  filter(out, 'highpass', 60, .7071, sr); warm(out, sr, {shelf: -8, fs: 3500, lp: 5500});
  return out;
}

function stone(p, R, sr) {
  const out = new Float32Array(Math.round(.42 * sr)), I = p.intensity, tc = lerp(.22e-3, .08e-3, I) * R.jit(.2), hard = Math.pow(I, .7);
  // dense stone modes (the slab's click with colour), plus the mass thud
  const f0 = R.range(700, 1150), sp = R.range(.14, .3), nm = R.int(12, 18), jit = R.range(.04, .1), modes = [];
  for (let k = 0; k < nm; k++) { const f = f0 * (1 + k * sp) * (1 + R.range(-jit, jit)); modes.push({f, a: R.range(.25, 1) / (1 + .07 * k), t60: q60(R.range(5, 14), f)}); }
  modes.push({f: f0 * R.range(.2, .32), a: R.range(.25, .45), t60: q60(R.range(3, 5), f0 * .25)});
  const tk = new Float32Array(out.length); strike(tk, sr, 0, modes, {exc: rough(halfSine(tc, sr), R, R.range(.3, .6))});
  add(out, norm(tk), 0, 1);
  add(out, norm(puff(sr, R, {a: .00015, d: R.range(.0012, .003), color: R.pick(['white', 'pink']), bp: lerp(1300, 2600, hard) * R.jit(.2), q: R.range(.6, 1)})), 0, R.range(.7, 1));
  // the arrow's own knock: the tip stopped dead, the shaft rings briefly (wooden tube)
  const kn = new Float32Array(out.length); strike(kn, sr, R.range(.0003, .001), shaftModes(R.range(420, 760), R.range(.03, .05), R), {tc: R.range(.4, .8) / 1000});
  add(out, norm(kn), 0, R.range(.25, .4));
  // skid: stick-slip scrape of the tip along the stone, 30-70 ms, starting a few ms in
  const sl = R.range(.03, .07), sn = Math.round((sl + .02) * sr), sk = noise(sn, R, 'white'); let ph = R();
  const rate = R.range(160, 380);
  for (let i = 0; i < sn; i++) { const t = i / sr, u = Math.min(1, t / sl); ph += rate * (1 - .5 * u) * R.jit(.1) / sr; const slip = Math.pow(.5 + .5 * Math.sin(2 * PI * ph), 3), env = Math.sin(PI * Math.min(1, t / (sl * 1.15))) ** 1.2 * (1 - u * .4); sk[i] *= slip * env; }
  sweep(sk, 'bandpass', t => lerp(2600, 1400, Math.min(1, t / sl)), 1.6, sr);
  add(out, norm(tailFade(sk, sr)), Math.round(R.range(.004, .012) * sr), R.range(.18, .32));
  // clatter: the arrow drops from its rebound and rattles on the stone
  clatter(out, sr, R, R.range(.03, .07), {k: R.int(2, 4), f: [650, 1400], dt: [.025, .06], level: R.range(.14, .26), t60: .016, bright: 2400});
  filter(out, 'highpass', 90, .7071, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5200});
  return out;
}

function crystal(p, R, sr) {
  const out = new Float32Array(Math.round(.36 * sr)), I = p.intensity, hard = Math.pow(I, .7), tc = lerp(.16e-3, .08e-3, I) * R.jit(.2);
  // the dull thud: the ground's mass, a lossy low mode (q 2-4) under a soft pink thump
  const f0 = R.range(105, 175), th = new Float32Array(out.length);
  strike(th, sr, 0, [{f: f0, t60: q60(R.range(2, 4), f0), a: 1}, {f: f0 * R.range(1.9, 2.5), t60: q60(2.5, f0 * 2.2), a: R.range(.3, .5)}], {exc: rough(halfSine(R.range(.0025, .004) * R.jit(.15), sr), R, .1)});
  add(out, norm(th), 0, R.range(.5, .7));
  add(out, norm(puff(sr, R, {a: .0005, d: R.range(.006, .011), bp: lerp(420, 800, hard) * R.jit(.2), q: .6})), 0, R.range(.25, .4));
  // the glassy tick: a very short, dark click (BP 1.8-3 kHz) with a little glass colour (dense short modes, q 6-14)
  add(out, norm(puff(sr, R, {a: .00006, d: R.range(.0004, .0009), color: 'white', bp: lerp(1900, 3000, hard) * R.jit(.1), q: .8, lp: 4200})), 0, R.range(.8, 1.1));
  const gk = new Float32Array(out.length), gm = [], g0 = R.range(1300, 2000);
  for (let k = 0; k < R.int(6, 9); k++) { const f = g0 * (1 + k * R.range(.2, .4)) * R.jit(.05); gm.push({f, a: R.range(.3, 1) / (1 + .12 * k), t60: Math.min(.03, q60(R.range(6, 14), f))}); }
  strike(gk, sr, 0, gm, {tc});
  add(out, norm(gk), 0, R.range(.55, .85));
  // the tiny damped beating ring: three twin pairs (detuned 12-34 Hz, so the beat is heard inside the decay), q <= 260, T60 <= 150 ms
  const rg = new Float32Array(out.length), fr = R.range(1250, 1900);
  [1, R.range(1.45, 1.7), R.range(2.0, 2.4)].forEach((r, k) => {
    const f = fr * r, T = Math.min(.15, q60(Math.min(260, R.range(120, 260)), f)) / (1 + .5 * k), d = R.range(12, 34), a = (k ? .55 / k : 1) * R.range(.8, 1);
    strike(rg, sr, R.range(0, .0006), [{f, t60: T, a}, {f: f + d, t60: T, a: a * R.range(.65, .95)}], {tc: R.range(.2, .4) / 1000});
  });
  add(out, norm(rg), 0, R.range(.3, .5) * lerp(.7, 1, hard));
  // shard ticks skittering off: 2-4 faint, tiny ticks over 8-70 ms
  for (let k = R.int(2, 4), t = R.range(.008, .02); k > 0; k--, t += R.range(.008, .03)) {
    const fs = R.range(1500, 2800), sh = new Float32Array(out.length);
    strike(sh, sr, t, [{f: fs, t60: R.range(.008, .02), a: 1}, {f: fs * R.range(1.5, 1.9), t60: .008, a: .4}], {tc: R.range(.1, .2) / 1000});
    add(out, norm(sh), 0, R.range(.05, .14));
  }
  // the shaft wobbling in the stuck crystal (faint): cantilever modes with a beating twin
  const fsh = R.range(75, 135), T = R.range(.07, .13), wb = new Float32Array(out.length);
  strike(wb, sr, R.range(.002, .006), [{f: fsh, t60: T, a: 1}, {f: fsh + R.range(5, 11), t60: T, a: .7}, {f: fsh * 6.27 * R.jit(.02), t60: T * .4, a: .25}], {tc: R.range(2, 4) / 1000});
  add(out, norm(wb), 0, R.range(.07, .14));
  filter(out, 'highpass', 80, .7071, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5200});
  return out;
}

function snow(p, R, sr) {
  const out = new Float32Array(Math.round(.34 * sr)), I = p.intensity, hard = Math.pow(I, .7);
  // puff: soft-attack low-passed pink noise whose cut-off falls as the snow packs (900 -> 350 Hz)
  const pf = puff(sr, R, {a: R.range(.0025, .004), d: R.range(.022, .04), color: 'pink'});
  const f1 = lerp(500, 1000, hard) * R.jit(.2), f2 = R.range(260, 420);
  sweep(pf, 'lowpass', t => f2 + (f1 - f2) * Math.exp(-t / .02), .7, sr);
  add(out, norm(pf), 0, R.range(.5, .7));
  // deep soft thump
  const f0 = R.range(60, 105), th = new Float32Array(out.length);
  strike(th, sr, 0, [{f: f0, t60: q60(R.range(1.2, 2.2), f0), a: 1}], {exc: rough(halfSine(R.range(.006, .011), sr), R, .05)});
  add(out, norm(th), 0, R.range(.25, .45));
  // crunch: snow grains (ice crystals fracturing) 1.5-4 kHz, dense then thinning, with a few audible single crackles
  const cr = snaps(sr, R, R.range(.04, .085), R.int(14, 30), R.range(1300, 2400), .9, 1.5);
  add(out, norm(cr), Math.round(R.range(.002, .008) * sr), R.range(.7, 1) * lerp(.6, 1, hard));
  const gn = Math.round(.16 * sr), en = new Float32Array(gn); for (let i = 0; i < gn; i++) en[i] = Math.exp(-i / (R.range(.025, .045) * sr));
  const gr = phisem(gn, sr, R, {objects: R.range(80, 200), soundDecay: .88, res: [[R.range(1600, 2800), .7, 1]], energy: en});
  add(out, norm(tailFade(filter(gr, 'highpass', 1200, .7071, sr), sr)), Math.round(R.range(.004, .012) * sr), R.range(.25, .4));
  filter(out, 'highpass', 55, .7071, sr); warm(out, sr, {shelf: -8, fs: 3000, lp: 4200});
  return out;
}

function ricochet(p, R, sr) {
  const out = new Float32Array(Math.round(.6 * sr)), I = p.intensity, hard = Math.pow(I, .7);
  // contact: the steel head glances off the stone: a short stone click + a bright ping (inharmonic, T60 40-100 ms)
  const fp = R.range(1400, 2500), T = R.range(.03, .07), pg = new Float32Array(out.length);
  strike(pg, sr, 0, [{f: fp, t60: T, a: 1}, {f: fp * R.range(1.55, 1.8), t60: T * .6, a: R.range(.35, .6)}, {f: fp * R.range(2.4, 3), t60: T * .35, a: .2}, {f: fp + R.range(2, 7), t60: T, a: .5}], {tc: R.range(.06, .12) / 1000});
  add(out, norm(pg), 0, R.range(.5, .8));
  const f0 = R.range(750, 1250), tk = new Float32Array(out.length), modes = [];
  for (let k = 0; k < 12; k++) { const f = f0 * (1 + k * R.range(.15, .28)) * R.jit(.07); modes.push({f, a: R.range(.3, 1) / (1 + .08 * k), t60: q60(R.range(5, 12), f)}); }
  strike(tk, sr, 0, modes, {exc: rough(halfSine(lerp(.18e-3, .07e-3, hard), sr), R, .5)});
  add(out, norm(tk), 0, R.range(.6, .9));
  add(out, norm(puff(sr, R, {a: .00008, d: R.range(.001, .002), color: 'white', bp: R.range(1800, 3000), q: .8})), 0, R.range(.5, .8));
  // whirr: the arrow tumbles away spinning. Spin AM 25-45 Hz, band falls (Doppler away) 2.6 -> 1.5 kHz, level 1/r-ish
  const wl = R.range(.16, .26), wn = Math.round((wl + .03) * sr), wh = noise(wn, R, 'pink'), spin = R.range(25, 45); let ph = R();
  for (let i = 0; i < wn; i++) {
    const t = i / sr, u = t / wl; ph += spin * (1 - .25 * u) / sr;
    const am = .45 + .55 * Math.abs(Math.sin(PI * ph)), e = Math.pow(Math.max(0, 1 - u), 1.6) * Math.min(1, t / .004);
    wh[i] *= am * e;
  }
  const fw0 = R.range(1400, 2100), fw1 = fw0 * R.range(.55, .7);
  sweep(wh, 'bandpass', t => lerp(fw0, fw1, Math.min(1, t / wl)), 3, sr);
  add(out, norm(tailFade(wh, sr)), Math.round(R.range(.004, .012) * sr), R.range(.28, .45));
  // and it lands somewhere out there: a few distant, softer ticks, low-passed
  const cl = new Float32Array(out.length);
  clatter(cl, sr, R, wl + R.range(.02, .09), {k: R.int(2, 4), f: [550, 1300], dt: [.03, .07], level: R.range(.3, .5), t60: .014, bright: 2400});
  filter(cl, 'lowpass', R.range(2200, 3200), .7071, sr);
  add(out, cl, 0, R.range(.3, .45));
  filter(out, 'highpass', 150, .7071, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5000});
  return out;
}

function render(p, R, sr) {
  const out = ({ground, stone, snow, ricochet, crystal}[p.surface] || ground)(p, R, sr);
  const nf = Math.round(out.length * .3); for (let i = 0; i < nf; i++) out[out.length - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  return saturate(norm(out, .9), 1.2);
}

export default {
  id: 'arrow_stick', version: 3, desc: 'An arrow ending its flight: ground thock, stone tock + clatter, snow puff, stone ricochet, crystal glint',
  params: {
    surface: {values: ['ground', 'stone', 'snow', 'ricochet', 'crystal'], def: 'ground'},
    intensity: {min: 0, max: 1, def: .8},
  },
  cases: {ground: {surface: 'ground'}, stone: {surface: 'stone'}, snow: {surface: 'snow'}, ricochet: {surface: 'ricochet'}, crystal: {surface: 'crystal'}},
  variants: 6,
  render,
  // v2 (brightness pass): stone/ricochet pitched down (ping 1.4-2.5 kHz), shelf -8..-10 dB above 3-3.5 kHz; validated on 36 seeds (1-24, 44291-44296, 6 large)
  criteria: {
    ground: {durMs: [100, 260], attackMs: [0, 10], t60Ms: [30, 160], centroidHz: [120, 900], lowHz: [30, 200], highHz: [500, 2800], flatness: [0, .03], clickEnd: [0, .01]},
    stone: {durMs: [80, 260], attackMs: [0, 4], t60Ms: [100, 600], centroidHz: [850, 2200], lowHz: [250, 900], highHz: [2000, 4000], flatness: [0, .03], clickEnd: [0, .01]},
    snow: {durMs: [170, 380], attackMs: [1, 30], t60Ms: [90, 320], centroidHz: [180, 1100], lowHz: [30, 150], highHz: [500, 3300], flatness: [0, .03], clickEnd: [0, .01]},
    ricochet: {durMs: [250, 520], attackMs: [0, 4], t60Ms: [350, 1200], centroidHz: [950, 2200], lowHz: [400, 1200], highHz: [1500, 3300], flatness: [0, .03], clickEnd: [0, .01]},
    // v3 crystal: 33 seeds (1-24, 44291-44296, 3 large). Dull thud + glassy tick + a damped beating ring (q <= 260, T60 <= 150 ms); energy above 4 kHz about -30..-43 dB
    crystal: {durMs: [150, 270], attackMs: [0, 8], t60Ms: [50, 230], centroidHz: [350, 1500], lowHz: [40, 200], highHz: [1100, 2900], hf4kDb: [-70, -24], flatness: [0, .03], clickEnd: [0, .01]},
  },
  notes: 'soil/stone/snow contact: lossy modes + force-shaped noise, cantilever shaft wobble (1:6.27:17.55), stone clatter (bounces), PhISEM grit/snow',
};
