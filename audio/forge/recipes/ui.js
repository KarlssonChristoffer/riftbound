// UI: menu sounds. Tasteful, soft, very short (20-130 ms), and one family: every sound is a small WOODEN voice (a dense,
// damped wood tick/tone: beam ratios 1 : 2.76 : 5.4, low q, a tiny noise tick) so hover, click, confirm, back and error
// belong together; the notes sit on one scale (D major pentatonic: D5 587 Hz, E5, F#5, A5 880 Hz).
// Variants are deliberately near-identical (pitch +-1%, q +-10%, fresh noise): UI must stay consistent.
//   hover:   a soft 1.8 kHz wooden tick, ~30 ms
//   click:   a wooden-ish tap: a 740 Hz block + a 190 Hz body thock, ~60 ms
//   confirm: two rising soft notes D5 -> A5, 40 ms apart, ~120 ms
//   back:    two falling soft notes A5 -> D5 (a touch darker), 40 ms apart
//   open:    a menu opening: a soft paper / cloth swish (pink band 500 -> 1800 Hz, ~110 ms) with a tiny paper flick
//   error:   a muted double thud: 190 Hz then 160 Hz, 55 ms apart, low q, dull
import {add, scale, peak, filter, sweep, halfSine, modal, burst, pink, saturate, t60FromQ} from '../dsp.js';

const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };
const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / Math.max(1, b.length)); };

// a small wooden voice at f: dense damped modes, a short contact, a faint tick of noise. t60 = 1st mode.
function wood(out, sr, R, at, f, t60, level, {tc = .0004, bright = 1, tick = .22, body = 0} = {}) {
  const modes = [{f, t60, a: 1}, {f: f * 2.76 * R.jit(.01), t60: t60 * .5, a: .38 * bright}, {f: f * 5.4 * R.jit(.01), t60: t60 * .25, a: .12 * bright}];
  if (body) modes.push({f: body, t60: t60 * 1.2, a: .4});
  const y = norm(modal(halfSine(tc, sr), modes, sr, Math.round((t60 * 1.6 + .01) * sr)));
  add(y, burst(.008, sr, R, {a: .00004, d: .0008, color: 'white', bp: Math.min(4500, f * 2.5), q: .7}), 0, tick);
  add(out, y, (at + .0015) * sr, level);   // 1.5 ms lead-in: the forge fades the first ms
}

const CASES = {
  hover(R, sr) {
    const out = new Float32Array(Math.round(.1 * sr));
    wood(out, sr, R, 0, 1800 * R.jit(.01), .014, 1, {tc: .0002, bright: .6, tick: .3});
    return out;
  },
  click(R, sr) {
    const out = new Float32Array(Math.round(.16 * sr));
    wood(out, sr, R, 0, 740 * R.jit(.01), .03, 1, {tc: .0005, bright: .9, tick: .3, body: 190 * R.jit(.02)});
    return out;
  },
  confirm(R, sr) {
    const out = new Float32Array(Math.round(.3 * sr));
    wood(out, sr, R, 0, 587.3 * R.jit(.004), .04, .85, {tc: .0006, bright: .7, tick: .15});
    wood(out, sr, R, .04, 880 * R.jit(.004), .05, 1, {tc: .0006, bright: .8, tick: .15});
    return out;
  },
  back(R, sr) {
    const out = new Float32Array(Math.round(.3 * sr));
    wood(out, sr, R, 0, 880 * R.jit(.004), .04, .85, {tc: .0007, bright: .5, tick: .12});
    wood(out, sr, R, .04, 587.3 * R.jit(.004), .05, 1, {tc: .0007, bright: .5, tick: .12});
    filter(out, 'lowpass', 5200, .7, sr);
    return out;
  },
  open(R, sr) {
    const d = .11 * R.jit(.04), m = Math.round(d * sr), out = new Float32Array(Math.round(.25 * sr)), x = pink(m, R);
    sweep(x, 'bandpass', t => 500 * Math.pow(1800 / 500, Math.pow(Math.min(1, t / d), .8)), .8, sr, {every: 24});
    sweep(x, 'lowpass', t => 1500 * Math.pow(1800 / 500, Math.pow(Math.min(1, t / d), .8)) * .8, .7, sr, {every: 48});
    const r = rms(x) + 1e-9;
    for (let i = 0; i < m; i++) { const u = i / m; x[i] *= Math.pow(Math.sin(Math.PI * Math.pow(u, .7)), 2) / r; }
    add(out, x, .0015 * sr, .6);
    add(out, burst(.01, sr, R, {a: .00005, d: .0012, color: 'pink', bp: 2500, q: .7}), .0015 * sr, .4);   // the paper flick
    return out;
  },
  error(R, sr) {
    const out = new Float32Array(Math.round(.3 * sr));
    for (const [at, f, lv] of [[0, 190, 1], [.055, 160, .85]]) {
      const ff = f * R.jit(.01), modes = [{f: ff, t60: .04, a: 1}, {f: ff * 1.8 * R.jit(.02), t60: .03, a: .5}, {f: ff * 3.0, t60: .02, a: .2}];
      const y = norm(modal(halfSine(.004, sr), modes, sr, Math.round(.1 * sr)));
      add(y, burst(.03, sr, R, {a: .0004, d: .006, color: 'pink', bp: 520 * R.jit(.05), q: .7}), 0, .35);
      add(out, y, (at + .0015) * sr, lv);
    }
    return out;
  },
};

export default {
  id: 'ui', version: 2, desc: 'Menu sounds in one wooden family: hover, click, confirm, back, open, error',
  params: {kind: {values: ['hover', 'click', 'confirm', 'back', 'open', 'error'], def: 'click'}},
  cases: {hover: {kind: 'hover'}, click: {kind: 'click'}, confirm: {kind: 'confirm'}, back: {kind: 'back'}, open: {kind: 'open'}, error: {kind: 'error'}},
  variants: 2,
  render(p, R, sr) {
    const out = CASES[p.kind](R, sr);
    filter(out, 'highpass', p.kind === 'error' ? 90 : 160, .7, sr);
    filter(out, 'highshelf', 5000, .7, sr, -6); filter(out, 'lowpass', 6500, .7, sr);   // v2: tame the top
    return saturate(norm(out, .9), 1.1);
  },
  criteria: {
    // v2. Ranges cover seeds 1-24, 44291-44296 and 12 large random seeds (42 per case), with margin. v2: hover 1.8 kHz, swish 500-1800 Hz, -6 dB shelf above 5 kHz, LP 6.5 kHz. UI is near-deterministic by design, so ranges are tight; durations include the 20 ms end fade.
    hover: {attackMs: [0, 5], crest: [16, 19], t60Ms: [10, 19], centroidHz: [1558, 2022], lowHz: [1485, 1917], highHz: [1650, 2126], flatness: [0, 0.01], durMs: [36, 46], onsetCount: [0, 2], clickEnd: [0, .01]},
    click: {attackMs: [0, 5], crest: [14, 18], t60Ms: [22, 42], centroidHz: [508, 657], lowHz: [144, 184], highHz: [680, 866], flatness: [0, 0.01], durMs: [60, 76], onsetCount: [0, 2], clickEnd: [0, .01]},
    confirm: {attackMs: [0, 5], crest: [14, 17], t60Ms: [38, 67], centroidHz: [742, 955], lowHz: [515, 657], highHz: [825, 1051], flatness: [0, 0.01], durMs: [116, 143], onsetCount: [0, 3], clickEnd: [0, .01]},
    back: {attackMs: [26, 55], crest: [14, 17], t60Ms: [38, 67], centroidHz: [506, 650], lowHz: [371, 499], highHz: [598, 762], flatness: [0, 0.01], durMs: [117, 143], onsetCount: [0, 3], clickEnd: [0, .01]},
    open: {attackMs: [5, 57], crest: [9, 16], t60Ms: [68, 162], centroidHz: [772, 1150], lowHz: [205, 421], highHz: [1588, 2337], flatness: [0, 0.01], durMs: [114, 149], onsetCount: [0, 3], clickEnd: [0, .01]},
    error: {attackMs: [0, 8], crest: [12, 15], t60Ms: [30, 54], centroidHz: [128, 167], lowHz: [82, 106], highHz: [185, 237], flatness: [0, 0.01], durMs: [119, 149], onsetCount: [0, 3], clickEnd: [0, .01]},
  },
  notes: 'One wooden voice (beam ratios 1:2.76:5.4, low q, noise tick) on D major pentatonic; open = pink band swish; see docs/AUDIO.md §2.3',
};
