// CLIMB: the ranger climbing ivy-covered stone and wooden ladders. Light, quick, quiet hands and soft boots.
// Model (docs/AUDIO.md §2.3 "Roll / jump / climb": friction + grip clicks + debris trickle):
//   grab:   a hand closing on an ivy-covered stone ledge: leaf rustle (a bed of AM-ed HP noise 2-8 kHz + a Poisson
//           shower of 2-8 ms leaf ticks BP 2.5-7.5 kHz, density following the grab), a stone scuff of the fingertips
//           (pink BP 1.5-3 kHz, ~45 ms with grit) and a soft palm thud (damped modes 220-480 Hz), a trace of grit falling
//   scrape: boots scrabbling for a hold: 3-5 stick-slip scuffs (pink BP 1.2-3.8 kHz, 40-100 ms, grit ticks), each with a
//           small stone tap of the toe (dense damped modes 400-3500 Hz) and a few pebbles trickling afterwards
//   mantle: pulling up over the top: an effort of cloth (BP noise swept 400 -> 1400 Hz over ~250 ms), two palm slaps on the
//           ledge, a knee / belt scuff, then a final soft step (light heel tap + roll + toe, as a leather boot would)
//   ladder: a hand or foot on a wooden rung: a dense, damped woody knock (beam ratios 1 : 2.76 : 5.40, f0 260-520 Hz,
//           q 6-14, a 1-2 ms contact) over a short rung-body thud, a trace of sleeve rustle; thocks, not marimba
import {add, scale, peak, filter, sweep, halfSine, modal, burst, pink, white, poisson, saturate, t60FromQ} from '../dsp.js';

const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };
const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / Math.max(1, b.length)); };
const unitRms = b => { const r = rms(b); return r > 0 ? scale(b, 1 / r) : b; };
const lerp = (a, b, u) => a + (b - a) * u;

// leaves: a bed + a shower of ticks over [at, at+dur]; density d (ticks/s)
function leaves(out, sr, R, at, dur, level, d = 260) {
  const m = Math.round(dur * sr), n = out.length;
  const bed = filter(filter(white(m, R), 'highpass', R.range(1000, 1500), .7, sr), 'lowpass', R.range(3000, 3800), .7, sr);
  const am = filter(white(m, R), 'lowpass', 90, .7, sr), ar = rms(am) + 1e-9;
  for (let i = 0; i < m; i++) { const u = i / m, w = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 1.2) * (u < .12 ? 1 : Math.exp(-(u - .12) * 2.5)); bed[i] *= Math.max(0, .4 + .6 * am[i] / ar * .8) * w; }
  add(out, unitRms(bed), at * sr, level * .22);
  for (const t of poisson(R, 0, dur, tt => d * Math.exp(-tt / dur * 2.2))) {
    const e = burst(.012, sr, R, {a: .00008, d: R.range(.0008, .003), color: 'white', bp: R.range(1500, 3800), q: R.range(1, 2)});
    add(out, e, Math.round((at + t) * sr), level * R.pow(.15, 1, 1.6) * .9);
  }
}
// scuff: stick-slip friction of skin / leather on stone: a pink band with a rough envelope and sparse grit
function scuff(out, sr, R, at, dur, level, {f = 2200, q = .8, lp = 5200, grit = 1} = {}) {
  const m = Math.round(dur * sr), b = pink(m, R);
  filter(b, 'bandpass', f, q, sr); filter(b, 'lowpass', lp, .7, sr);
  const g = filter(white(m, R), 'lowpass', R.range(60, 140), .7, sr), gr = rms(g) + 1e-9;      // stick-slip roughness
  for (let i = 0; i < m; i++) { const u = i / m, w = (u < .12 ? u / .12 : Math.exp(-(u - .12) * 5.5)) * (u > .85 ? .5 + .5 * Math.cos(Math.PI * (u - .85) / .15) : 1); b[i] *= w * Math.max(.05, 1 + .8 * g[i] / gr * .6); }
  unitRms(b);
  for (const t of poisson(R, 0, dur, 180 * grit)) { const i0 = Math.round(t * sr), a = R.pow(.3, 1, 2) * R.sign(), w = 1 - t / dur; for (let k = 0; k < 10 && i0 + k < m; k++) b[i0 + k] += 1.4 * a * w * (R() * 2 - 1) * (1 - k / 10); }
  filter(b, 'lowpass', lp * 1.2, .7, sr);
  add(out, filter(b, 'highpass', 700, .7, sr), at * sr, level);
}
// a damped stone tap (toe, fingertips): dense, short, quiet
function stoneTap(out, sr, R, at, level) {
  const modes = [];
  for (let k = 0, K = R.int(10, 14); k < K; k++) { const f = R.pow(300, 2500, 1), q = R.range(4, 12); modes.push({f, t60: Math.min(.035, t60FromQ(q, f)), a: Math.pow(f / 400, .15) * R.jit(.4)}); }
  add(out, norm(modal(halfSine(R.range(.0006, .0012), sr), modes, sr, Math.round(.06 * sr))), at * sr, level);
}
// soft body thud (palm, knee): low-q modes, long contact
function thud(out, sr, R, at, level, f = 260, t60 = .05, tc = .005) {
  const modes = [{f, t60, a: 1}, {f: f * R.range(1.6, 1.9), t60: t60 * .6, a: .5}, {f: f * R.range(2.7, 3.2), t60: t60 * .35, a: .2}];
  const y = norm(modal(halfSine(tc, sr), modes, sr, Math.round((t60 * 1.3 + .03) * sr)));
  add(y, burst(.03, sr, R, {a: .0005, d: R.range(.005, .01), color: 'pink', bp: f * 2.5, q: .7}), 0, .3);
  add(out, y, at * sr, level);
}
// a cloth sweep (effort of the cloak and sleeves)
function swoosh(out, sr, R, at, dur, level, f0 = 400, f1 = 1400) {
  const m = Math.round(dur * sr), x = pink(m, R);
  sweep(x, 'bandpass', t => lerp(f0, f1, Math.pow(Math.min(1, t / dur), .8)), .7, sr, {every: 24}); sweep(x, 'lowpass', t => Math.min(2200, lerp(f0, f1, Math.pow(Math.min(1, t / dur), .8)) * 2.2), .7, sr, {every: 48});
  unitRms(x); for (let i = 0; i < m; i++) { const u = i / m; x[i] *= Math.pow(Math.sin(Math.PI * Math.pow(u, .75)), 2); }
  add(out, x, at * sr, level);
}
// pebbles trickling: a few tiny stone ticks falling off a ledge
function pebbles(out, sr, R, at, dur, level) {
  for (const t of poisson(R, 0, dur, 28)) stoneTap(out, sr, R, at + t, level * R.pow(.15, 1, 1.5) * Math.exp(-t / dur));
}

const CASES = {
  grab(R, sr) {
    const n = Math.round(.55 * sr), out = new Float32Array(n);
    // fingertips on stone first, then the leaves are crushed as the fist closes; the palm lands softly
    scuff(out, sr, R.fork(1), 0, R.range(.04, .06), .9, {f: R.range(1000, 1800), lp: 3000, q: .8, grit: 1.1});
    thud(out, sr, R.fork(2), R.range(.012, .02), .65, R.range(220, 340), .05, R.range(.004, .007));
    leaves(out, sr, R.fork(3), .004, R.range(.22, .3), .5, R.range(80, 130));
    pebbles(out, sr, R.fork(4), .03, .22, .3);
    return out;
  },
  scrape(R, sr) {
    const n = Math.round(.75 * sr), out = new Float32Array(n);
    const K = R.int(3, 5); let t = R.range(0, .02);
    for (let k = 0; k < K; k++) {
      const Rk = R.fork(1 + k), d = Rk.range(.04, .1), lv = Rk.range(.6, 1) * (k === 0 ? 1 : .85);
      scuff(out, sr, Rk, t, d, lv, {f: Rk.range(900, 2200), q: .8, lp: Rk.range(2800, 3600), grit: 1.1});
      stoneTap(out, sr, Rk, t + Rk.range(.0, .012), lv * .55);
      if (Rk() < .6) stoneTap(out, sr, Rk, t + d * Rk.range(.6, 1), lv * .3);
      t += d + Rk.range(.02, .09);
    }
    pebbles(out, sr, R.fork(20), .06, .5, .35);
    return out;
  },
  mantle(R, sr) {
    const n = Math.round(1.0 * sr), out = new Float32Array(n);
    const dur = R.range(.22, .3);
    swoosh(out, sr, R.fork(1), 0, dur, .6, 300, 950);
    // two palm slaps on the ledge as the arms straighten
    thud(out, sr, R.fork(2), R.range(.04, .07), .75, R.range(220, 320), .05, R.range(.005, .008));
    scuff(out, sr, R.fork(3), R.range(.04, .07), R.range(.04, .07), .55, {f: R.range(1000, 1800), lp: 3000, grit: 1});
    thud(out, sr, R.fork(4), R.range(.11, .15), .6, R.range(200, 300), .05, R.range(.005, .008));
    // knee / belt drags over the edge
    scuff(out, sr, R.fork(5), R.range(.14, .17), R.range(.1, .16), .55, {f: R.range(900, 1700), q: .7, lp: 3500, grit: .8});
    thud(out, sr, R.fork(6), R.range(.18, .22), .55, R.range(150, 230), .055, R.range(.007, .012));
    // the final step onto the top: a light leather heel + roll + toe on stone
    const ts = dur + R.range(.1, .16), fh = R.range(180, 240);
    stoneTap(out, sr, R.fork(7), ts, .7);
    thud(out, sr, R.fork(8), ts, .35, fh, .045, .003);
    scuff(out, sr, R.fork(9), ts + .006, R.range(.04, .06), .45, {f: R.range(1100, 2000), lp: 3000});
    stoneTap(out, sr, R.fork(10), ts + R.range(.05, .07), .3);
    swoosh(out, sr, R.fork(11), ts - .03, R.range(.12, .18), .22, 300, 700);
    return out;
  },
  ladder(R, sr) {
    const n = Math.round(.4 * sr), out = new Float32Array(n);
    const hand = R() < .5, f0 = hand ? R.range(380, 520) : R.range(260, 380), q = R.range(6, 12);
    const modes = [[1, 1], [2.76, .6], [5.4, .28], [8.93, .03]].map(([r, a], i) => { const f = f0 * r * R.jit(.03); return {f, t60: t60FromQ(q, f) * (i ? .9 : 1), a: a * R.jit(.2)}; });
    modes.push({f: f0 * .5 * R.jit(.05), t60: .045, a: .5});
    const knock = modal(halfSine(R.range(.0012, .002) * (hand ? .8 : 1.2), sr), modes, sr, Math.round(.14 * sr));
    add(out, norm(knock), 0, 1);
    // the rung is a dowel in two stiles: a short second thump 8-20 ms later (the stile ringing), and the rattle of the rung seat
    thud(out, sr, R.fork(2), R.range(.008, .02), .3, f0 * .6, .05, .004);
    stoneTap(out, sr, R.fork(3), R.range(.004, .012), .08);
    // a trace of sleeve / boot rustle
    scuff(out, sr, R.fork(4), R.range(.004, .016), R.range(.04, .08), hand ? .1 : .16, {f: R.range(1000, 1800), q: .7, lp: 3000, grit: .7});
    return out;
  },
};

export default {
  id: 'climb', version: 2, desc: 'Climbing: ledge grab (ivy + stone), boot scrape, mantle over the top, wooden ladder rung',
  params: {kind: {values: ['grab', 'scrape', 'mantle', 'ladder'], def: 'grab'}},
  cases: {grab: {kind: 'grab'}, scrape: {kind: 'scrape'}, mantle: {kind: 'mantle'}, ladder: {kind: 'ladder'}},
  variants: 6,
  render(p, R, sr) {
    const out = CASES[p.kind](R, sr);
    filter(out, 'highpass', p.kind === 'ladder' ? 110 : 130, .7, sr);
    filter(out, 'highshelf', 4500, .7, sr, -8); filter(filter(out, 'lowpass', 4200, .7, sr), 'lowpass', 4200, .7, sr);   // v2 warm mix
    return saturate(norm(out, .9), 1.2);
  },
  criteria: {
    // v2. Ranges cover seeds 1-24, 44291-44296 and 12 large random seeds (42 per case), with margin. v2 darker: leaves bed 1-3.8 kHz at -7 dB and sparser ticks 1.5-3.8 kHz, scuffs 0.9-2.2 kHz, shelf -8 dB above 4.5 kHz and LP 4.2 kHz. The Schroeder t60 of scrape/mantle reads long (several separate events).
    grab: {attackMs: [0, 21], crest: [17, 26], t60Ms: [247, 687], centroidHz: [1195, 1897], lowHz: [185, 841], highHz: [2268, 3728], flatness: [0, 0.01], durMs: [204, 333], onsetCount: [0, 4], clickEnd: [0, .01]},
    scrape: {attackMs: [0, 620], crest: [15, 24], t60Ms: [31, 1254], centroidHz: [1123, 1826], lowHz: [515, 919], highHz: [1980, 3124], flatness: [0, 0.01], durMs: [396, 797], onsetCount: [1, 7], clickEnd: [0, .01]},
    mantle: {attackMs: [12, 212], crest: [14, 21], t60Ms: [487, 1345], centroidHz: [745, 1247], lowHz: [165, 315], highHz: [1588, 2731], flatness: [0, 0.01], durMs: [415, 652], onsetCount: [0, 6], clickEnd: [0, .01]},
    ladder: {attackMs: [0, 32], crest: [11, 18], t60Ms: [37, 146], centroidHz: [437, 1519], lowHz: [102, 263], highHz: [1464, 2993], flatness: [0, 0.01], durMs: [76, 156], onsetCount: [0, 3], clickEnd: [0, .01]},
  },
  notes: 'Leaf Poisson ticks + AM bed, stick-slip scuffs, dense damped stone taps, cloth sweep, beam-ratio wood knock; see docs/AUDIO.md §2.3',
};
