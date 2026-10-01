// BOW DRAW: the ranger draws and holds a wooden longbow. Organic wood, never a buzzer.
// Model (docs/AUDIO.md §2.3 "Bow draw creak"): a limb under rising tension creaks by STICK-SLIP friction: an impulse train
// (one slip per event) whose rate climbs 15 -> 80 Hz over the draw, ±10-30% period jitter, random slip strengths, and
// pauses (the wood sticks for a while), each slip ringing the wood's formants 62.5 / 125 / 250 / 395 / 560 / 790 Hz
// (damped, q 3-6, so a slip is a soft groan, not a tone) plus a faint upper pair near 1.1 / 1.6 kHz for the "creak"
// edge. Every slip carries its own formant jitter and a little noise. Over it, the string stretching: HP pink noise
// (>2.5 kHz) at about -20 dB that swells with the tension. All gated so the creaks come in bursts.
//   draw: 0.6 s pull: finger grip tick, creak rising in rate and level, string-stretch swell
//   hold: ~1 s at full draw: low tension tremor, sparse short creak bursts, a faint string whisper
//   full: a tiny "full charge" cue: a woody tick + a short pentatonic ping (bright small wooden chime, beating twin)
//   nock: an arrow onto the string: a wooden knock at the rest, the nock snapping on the string, fletching brush
import {add, scale, peak, filter, halfSine, modal, burst, pink, white, saturate, t60FromQ} from '../dsp.js';

const lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };
const FORM = [[62.5, 3, .15], [125, 3.5, .45], [250, 4, .8], [395, 4.5, .85], [560, 5, .75], [790, 5, .65], [1150, 5, .22], [1650, 5, .07]];

// one stick-slip event into `out` at time t (s). s: strength 0..1, u: tension 0..1 (higher tension -> brighter slip)
function slip(out, sr, R, t, s, u, ring = 1) {
  const tc = R.range(.0007, .0016) * lerp(1.3, .8, u);
  const exc = halfSine(tc, sr), m = Math.round(.09 * sr * ring);
  const modes = FORM.map(([f, q, a], k) => {
    const ff = f * R.jit(.07); return {f: ff, t60: Math.min(.12, t60FromQ(q * R.range(.8, 1.2), ff)) * ring, a: a * R.range(.55, 1.4) * Math.pow(lerp(.6, 1.4, u), k / 3)};
  });
  const y = modal(exc, modes, sr, m), p = peak(y) || 1;
  // the friction noise inside the slip (rosin-like rasp), short and band-limited
  add(y, burst(.03, sr, R, {a: .0004, d: R.range(.003, .007), color: 'pink', bp: R.range(300, 900), q: .8}), 0, p * .22);
  add(out, y, t * sr, s / p);
}

// creak train over [t0, t1]: rate(u) Hz -> events. gate: fraction of time the wood is slipping (rest is stuck)
function creaks(out, sr, R, t0, t1, {rate, level, tension, gate = .75}) {
  let t = t0 + R.range(0, .01);
  const g = filter(white(Math.ceil((t1 - t0) * 200) + 8, R), 'lowpass', 6, .7, 200);  // slow random gate at 200 Hz control rate
  let gs = 0; for (const v of g) gs += v * v; gs = Math.sqrt(gs / g.length) || 1;
  const thr = -Math.sqrt(2) * (gate - .5) * 1.6;   // gate = fraction open
  while (t < t1) {
    const u = (t - t0) / (t1 - t0), k = Math.min(g.length - 1, Math.floor((t - t0) * 200)), open = g[k] / gs > thr;
    const r = rate(u) * R.jit(.25);
    if (open) slip(out, sr, R, t, level(u) * R.pow(.35, 1, 1.4) * R.jit(.15), tension(u));
    t += 1 / r;
  }
}

const CASES = {
  draw(R, sr) {
    const D = R.range(.56, .64), n = Math.round((D + .2) * sr), out = new Float32Array(n);
    // 15 -> 80 Hz as the limb loads; level swells with the tension (tension ~ u^1.4: a bow loads progressively)
    const tens = u => Math.pow(u, 1.4);
    creaks(out, sr, R.fork(1), .02, D, {rate: u => lerp(15, 80, tens(u)), level: u => .25 + .75 * tens(u), tension: tens, gate: .86});
    // string stretch: HP noise, -20 dB re the creak, swelling with the draw
    const m = Math.round((D + .1) * sr), st = filter(filter(pink(m, R.fork(2)), 'bandpass', R.range(700, 1100), .8, sr), 'lowpass', 2200, .7, sr);
    for (let i = 0; i < m; i++) { const u = Math.min(1, i / sr / D); st[i] *= (.15 + .85 * Math.pow(u, 1.6)) * (1 - Math.pow(Math.max(0, (i / sr - D) / .1), 2)); }
    add(out, norm(st), .02 * sr, .03);   // a dark, very quiet stretch of the string (v2: was a bright HP hiss)
    // fingers gripping the string: a soft leather tick at the start; and a small settle at full draw
    add(out, burst(.03, sr, R.fork(3), {a: .0005, d: R.range(.004, .008), color: 'pink', bp: R.range(900, 1500), q: .8}), 0, .22);
    add(out, burst(.05, sr, R.fork(4), {a: .002, d: R.range(.012, .02), color: 'pink', bp: R.range(300, 450), q: .7}), D * sr, .12);   // anchor: knuckle on the cheek
    return out;
  },
  hold(R, sr) {
    const D = R.range(.95, 1.1), n = Math.round((D + .25) * sr), out = new Float32Array(n);
    // sparse creak bursts: 2-5 per second, each a short 25-45 Hz train of 2-6 slips, weak (low, held tension)
    for (let t = R.range(.05, .18); t < D;) {
      const k = R.int(2, 6), r = R.range(22, 44), ts = R.range(.35, .65);
      for (let j = 0; j < k; j++) slip(out, sr, R, t + j / r * R.jit(.25), R.range(.4, .8) * (1 - .3 * j / k), ts, R.range(1, 1.3));
      t += k / r + R.exp(.28) + .08;
    }
    // tension tremor: the draw hand shaking a little, 125/250 Hz wood hum modulated slowly (8-11 Hz), very quiet
    const trem = filter(pink(n, R.fork(2)), 'bandpass', R.range(140, 200), 1.2, sr), f = R.range(7, 11);
    for (let i = 0; i < n; i++) { const t = i / sr; trem[i] *= (0.5 + 0.5 * Math.sin(2 * Math.PI * f * t + 1)) * Math.pow(Math.sin(Math.PI * Math.min(1, t / (D + .2))), .5); }
    add(out, norm(trem), 0, .07);
    // a whisper of string stretch
    const st = filter(filter(pink(n, R.fork(3)), 'bandpass', 800, .8, sr), 'lowpass', 2000, .7, sr);
    for (let i = 0; i < n; i++) st[i] *= Math.pow(Math.sin(Math.PI * Math.min(1, i / sr / (D + .2))), 1.5);
    add(out, norm(st), 0, .012);
    return out;
  },
  full(R, sr) {
    const n = Math.round(.4 * sr), out = new Float32Array(n);
    // woody tick: a stiff short click with dense damped modes (no ring)
    const f0 = R.range(650, 900), tick = modal(halfSine(.0003, sr), [{f: f0, t60: .022, a: 1}, {f: f0 * 1.62, t60: .016, a: .6}, {f: f0 * 2.4, t60: .01, a: .35}, {f: 320 * R.jit(.1), t60: .03, a: .5}], sr, Math.round(.08 * sr));
    add(out, norm(tick), 0, .9);
    // ping: a small pentatonic wood-chime, 1-2 partials, beating twin, short and soft
    const base = R.pick([523.25, 587.33, 659.25, 783.99, 880]);
    const modes = [{f: base, t60: R.range(.07, .1), a: 1}, {f: base + R.range(1.5, 3), t60: R.range(.07, .1), a: .6}, {f: base * 2.76, t60: .05, a: .25}, {f: base * 5.4, t60: .02, a: .06}, {f: base * 1.5, t60: .05, a: .15}];
    const ping = modal(halfSine(.0004, sr), modes, sr, Math.round(.35 * sr));
    add(out, norm(ping), Math.round(R.range(.002, .01) * sr), .3);
    return out;
  },
  nock(R, sr) {
    const n = Math.round(.32 * sr), out = new Float32Array(n);
    // 1. the shaft taps the arrow rest / bow shelf: a dense damped wood knock
    const f = R.range(520, 800), knock = modal(halfSine(R.range(.0005, .001), sr), [{f, t60: .03, a: 1}, {f: f * 1.9, t60: .02, a: .6}, {f: f * 3.1, t60: .012, a: .35}, {f: 180 * R.jit(.15), t60: .045, a: .45}], sr, Math.round(.1 * sr));
    add(out, norm(knock), 0, .8);
    add(out, burst(.02, sr, R, {a: .0002, d: .002, color: 'pink', bp: R.range(1200, 1800), q: .7}), 0, .3);
    // 2. the nock snaps onto the string: a tiny sharper click and a faint string ring (dead)
    const t2 = R.range(.07, .11), nf = R.range(1000, 1500), nk = modal(halfSine(.0002, sr), [{f: nf, t60: .012, a: 1}, {f: nf * 1.7, t60: .008, a: .5}], sr, Math.round(.04 * sr));
    add(out, norm(nk), t2 * sr, .55);
    add(out, norm(modal(halfSine(.0006, sr), [{f: R.range(220, 330), t60: .06, a: 1}, {f: R.range(520, 700), t60: .03, a: .4}], sr, Math.round(.12 * sr))), t2 * sr, .22);
    // 3. fletching brushing the fingers / rest: soft airy swish
    const d = R.range(.07, .11), m = Math.round(d * sr), br = filter(pink(m, R), 'bandpass', R.range(1500, 2300), .6, sr);
    for (let i = 0; i < m; i++) br[i] *= Math.pow(Math.sin(Math.PI * i / m), 2);
    add(out, norm(br), Math.round((t2 - .03) * sr), .14);
    return out;
  },
};

export default {
  id: 'bow_draw', version: 2, desc: 'Drawing the longbow: stick-slip wood creak + string stretch; hold, full-charge cue, arrow nock',
  params: {kind: {values: ['draw', 'hold', 'full', 'nock'], def: 'draw'}},
  cases: {draw: {kind: 'draw'}, hold: {kind: 'hold'}, full: {kind: 'full'}, nock: {kind: 'nock'}},
  variants: 6,
  render(p, R, sr) {
    const out = CASES[p.kind](R, sr);
    filter(out, 'highpass', p.kind === 'draw' || p.kind === 'hold' ? 85 : 90, .7, sr);
    filter(filter(out, 'lowpass', p.kind === 'full' ? 2600 : 3200, .7, sr), 'lowpass', p.kind === 'full' ? 2600 : 3200, .7, sr);   // warm mix
    return saturate(norm(out, .9), 1.2);
  },
  criteria: {
    // v2. Ranges cover seeds 1-24, 44291-44296 and 12 large random seeds (42 per case), with margin. v2 darker: string-stretch noise now a very quiet 700-1100 Hz band (was a bright HP hiss), ping 520-880 Hz, 85 Hz high-pass on the creaks.
    draw: {attackMs: [245, 738], crest: [15, 23], t60Ms: [74, 728], centroidHz: [224, 351], lowHz: [61, 106], highHz: [495, 841], flatness: [0, 0.01], durMs: [632, 856], onsetCount: [4, 13], clickEnd: [0, .01]},
    hold: {attackMs: [0, 1082], crest: [15, 26], t60Ms: [263, 3582], centroidHz: [203, 316], lowHz: [61, 106], highHz: [432, 657], flatness: [0, 0.01], durMs: [1060, 1456], onsetCount: [2, 12], clickEnd: [0, .01]},
    full: {attackMs: [0, 6], crest: [14, 20], t60Ms: [52, 127], centroidHz: [460, 982], lowHz: [412, 972], highHz: [474, 1024], flatness: [0, 0.01], durMs: [102, 162], onsetCount: [0, 2], clickEnd: [0, .01]},
    nock: {attackMs: [0, 6], crest: [14, 19], t60Ms: [52, 440], centroidHz: [623, 1076], lowHz: [124, 237], highHz: [1588, 2626], flatness: [0, 0.01], durMs: [146, 226], onsetCount: [0, 3], clickEnd: [0, .01]},
  },
  notes: 'Stick-slip impulse train 15->80 Hz through wood formants 62.5-790 Hz (+ faint 1.1/1.6 kHz edge), HP string-stretch noise -20 dB; see docs/AUDIO.md §2.3',
};
