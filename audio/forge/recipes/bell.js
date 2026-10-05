// BELL: the brass bells of the sandbox's bells and plates (features/bells.js). One case per note of a C major pentatonic
// scale from G4 to A5 (g4 a4 c5 d5 e5 g5 a5: the sim's TUNE.notes), so the bells one shot rings play a little phrase. A small
// cast-brass handbell struck by a bullet's glance or by its own clapper. SHORT and WARM, by the user's ear (RECIPE_GUIDE.md:
// nothing long, harsh, hollow or ringing):
//   modes   a tuned handbell's profile: the fundamental (strong), the octave (2.0), a faint minor-third colour an octave up
//           (2.4: the bell's "tierce"), the twelfth (3.0), a few fainter partials above (4.2, 5.4, 6.8) gone in tens of ms;
//           the lowest three each with a twin .6-2 Hz away (the slow shimmer of cast metal)
//   decay   the fundamental's t60 .62-.8 s (higher notes a little shorter); each partial above dies 1.5x faster per step up
//   strike  a short half-sine (tc .25-.45 ms: bright enough to read as metal, no click) and a faint dull tick (noise round
//           1.4-2.2 kHz, a few ms): the strike, not a ring
//   tone    a -9 dB shelf above 3.5 kHz, a high-pass at 180 Hz, a touch of tanh glue
import {add, scale, peak, filter, halfSine, modal, burst, saturate} from '../dsp.js';

export const NOTES = {g4: 392, a4: 440, c5: 523.25, d5: 587.33, e5: 659.25, g5: 783.99, a5: 880};
const PARTIALS = [[1, 1], [2, .5], [2.4, .12], [3, .24], [4.2, .07], [5.4, .035], [6.8, .014]];
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };

function ring(R, sr, f0) {
  const T = R.range(.62, .8) * Math.pow(440 / f0, .25), modes = [];   // (higher notes a little shorter)
  PARTIALS.forEach(([r, a], i) => {
    const f = f0 * r * (i ? R.jit(.002) : R.jit(.0004)), t60 = T / Math.pow(1.5, i) * R.jit(.06), amp = a * R.jit(.08);
    modes.push({f, t60, a: amp});
    if (i < 3) modes.push({f: f + R.range(.6, 2) * R.sign(), t60: t60 * R.range(.92, 1.06), a: amp * R.range(.35, .55)});   // the shimmer's twin
  });
  const n = Math.round(Math.min(1.5, T * 1.4 + .03) * sr), tc = R.range(.00025, .00045);
  const y = modal(halfSine(tc, sr), modes, sr, n);
  add(y, burst(.012, sr, R.fork(7), {a: .0002, d: R.range(.0012, .0025), color: 'pink', bp: R.range(1400, 2200), q: .9}), 0, peak(y) * R.range(.08, .13));
  return y;
}

export default {
  id: 'bell', version: 1, desc: 'Small brass bells tuned to a C major pentatonic (G4-A5): short, warm, struck once',
  params: {note: {values: Object.keys(NOTES), def: 'c5'}},
  cases: Object.fromEntries(Object.keys(NOTES).map(k => [k, {note: k}])),
  variants: 2,
  render(p, R, sr) {
    const out = ring(R, sr, NOTES[p.note] ?? 523.25);
    filter(out, 'highpass', 180, .7, sr);
    filter(out, 'highshelf', 3500, .7, sr, -9);
    return saturate(norm(out, .9), 1.1);
  },
  criteria: {
    // v1. Ranges over seeds 1-24, 44291-44296 and 6 large seeds (36 per case), with margin (forge.mjs bell --seeds 24)
    g4: {attackMs: [0, 4], crest: [15, 19.3], t60Ms: [410, 844], centroidHz: [385, 498], lowHz: [338, 413], highHz: [696, 877], flatness: [0, 0.01], durMs: [670, 1262], onsetCount: [0, 1], clickEnd: [0, 0.01]},
    a4: {attackMs: [0, 4], crest: [15, 19], t60Ms: [413, 797], centroidHz: [434, 553], lowHz: [380, 464], highHz: [780, 980], flatness: [0, 0.01], durMs: [620, 1241], onsetCount: [0, 1], clickEnd: [0, 0.01]},
    c5: {attackMs: [0, 4], crest: [15.3, 18.9], t60Ms: [390, 792], centroidHz: [514, 645], lowHz: [443, 568], highHz: [928, 1161], flatness: [0, 0.01], durMs: [654, 1180], onsetCount: [0, 1], clickEnd: [0, 0.01]},
    d5: {attackMs: [0, 4], crest: [15.3, 18.7], t60Ms: [359, 734], centroidHz: [575, 724], lowHz: [507, 619], highHz: [1055, 1289], flatness: [0, 0.01], durMs: [622, 1156], onsetCount: [0, 1], clickEnd: [0, 0.01]},
    e5: {attackMs: [0, 4], crest: [15.4, 18.9], t60Ms: [348, 720], centroidHz: [650, 811], lowHz: [570, 696], highHz: [1182, 1470], flatness: [0, 0.01], durMs: [585, 1108], onsetCount: [0, 1], clickEnd: [0, 0.01]},
    g5: {attackMs: [0, 4], crest: [14.9, 18.5], t60Ms: [363, 724], centroidHz: [753, 950], lowHz: [696, 850], highHz: [738, 1727], flatness: [0, 0.01], durMs: [555, 1061], onsetCount: [0, 1], clickEnd: [0, 0.01]},
    a5: {attackMs: [0, 4], crest: [14.4, 18.1], t60Ms: [332, 674], centroidHz: [841, 1036], lowHz: [780, 954], highHz: [823, 1934], flatness: [0, 0.01], durMs: [567, 1028], onsetCount: [0, 1], clickEnd: [0, 0.01]},
  },
  notes: 'Tuned handbell partials 1:2:2.4:3:4.2:5.4:6.8 with shimmer twins on the lowest three; t60 .62-.8 s falling 1.5x per partial; half-sine strike + a faint pink tick; see docs/AUDIO.md §2.3 "Metal"',
};
