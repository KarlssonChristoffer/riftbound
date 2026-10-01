// COIN: loot sounds. Real metal, but small and bright: thin discs ring for a fraction of a second, not like bells.
// Model (docs/AUDIO.md §2.3 "Metal"): a coin is a modal bank with the thin-disc ratios 1 : 1.73 : 2.33 : 3.91 : 4.11,
// t60 0.2-0.5 s on the lowest mode and falling with frequency, each of the two lowest modes with a near-degenerate twin
// 0.5-3 Hz away (the slow shimmer of metal), struck by a very short half-sine (tc 0.05-0.15 ms) plus a tiny noise tick.
//   pickup: one clink (f0 2.4-3.3 kHz) and, 12-30 ms later, a tiny pentatonic chime partial pair above it
//   spill:  6-10 coins dropped over ~150 ms; each is a bounce sequence (restitution e 0.5-0.7, first gap 55-110 ms,
//           gaps shrink by e, speeds by e), every contact a clink scaled by the impact speed (harder = brighter via tc),
//           plus a dull surface tick; two or three coins end in a settling spin: ticks that accelerate (gap x0.88) into
//           a short buzz, the way a coin rattles to rest
//   chime:  the "loot!" reward: 3-4 rising notes of a major pentatonic scale, each a small bell whose partials sit on
//           the scale (1, 2, 3, 4.01, 5.04) with a twin detuned +-1-2 cents (slow beating), warm (upper partials fall fast)
import {add, scale, peak, filter, halfSine, modal, burst, bounces, saturate, t60FromQ} from '../dsp.js';

const lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };
const RAT = [1, 1.73, 2.33, 3.91, 4.11], AMP = [1, .75, .55, .4, .32], DEC = [1, .65, .45, .26, .22];

// the ring of one coin struck once: unit-peak buffer. f0 Hz, T = t60 of the lowest mode (s), tc = contact time (s)
function coinRing(R, sr, f0, T, tc = .0001) {
  const modes = [];
  RAT.forEach((r, i) => {
    const f = f0 * r * R.jit(.012), t60 = T * DEC[i] * R.jit(.12), a = AMP[i] * R.jit(.15);
    modes.push({f, t60, a});
    if (i < 2) modes.push({f: f + R.range(.5, 3), t60: t60 * R.range(.9, 1.1), a: a * .55});   // beating twin
  });
  const n = Math.round(Math.min(1.1, T * 1.4 + .01) * sr), y = modal(halfSine(tc, sr), modes, sr, n);
  add(y, burst(.012, sr, R, {a: .00005, d: R.range(.0008, .0016), color: 'white', bp: R.range(3000, 5500), q: .6}), 0, peak(y) * .26);   // the strike tick
  return norm(y);
}
// a small bell note: partials tuned on the scale, each with a +-1-2 cents twin. f in Hz; T = t60 of the fundamental
function bellNote(R, sr, f, T, {tc = .0004, warm = 1, partials = [[1, 1], [2, .55], [3.005, .22], [4.01, .1], [5.04, .04]]} = {}) {
  const modes = [];
  partials.forEach(([r, a], i) => {
    const f0 = f * r, t60 = T / (1 + 1.0 * warm * i) * R.jit(.08), cents = R.range(1, 2) * R.sign();
    modes.push({f: f0, t60, a: a * R.jit(.1)}, {f: f0 * Math.pow(2, cents / 1200), t60: t60 * 1.05, a: a * .7});
  });
  return norm(modal(halfSine(tc, sr), modes, sr, Math.round(Math.min(2.2, T * 1.4 + .02) * sr)));
}
const PENT = [0, 2, 4, 7, 9];   // major pentatonic degrees
const penta = (root, k) => root * Math.pow(2, (PENT[((k % 5) + 5) % 5] + 12 * Math.floor(k / 5)) / 12);

const CASES = {
  pickup(R, sr) {
    const n = Math.round(.75 * sr), out = new Float32Array(n);
    add(out, coinRing(R.fork(1), sr, R.range(2000, 2800), R.range(.18, .3), R.range(.00008, .00016)), 0, 1);
    // a dull little knock of the coin leaving the pile / hitting the palm
    add(out, burst(.03, sr, R.fork(2), {a: .0003, d: R.range(.003, .006), color: 'pink', bp: R.range(900, 1700), q: .8}), 0, .22);
    // the tiny chime: a note a fifth to an octave above, soft
    const tc = R.range(.012, .03), root = R.pick([880, 987.8, 1046.5, 1174.7, 1318.5]);
    add(out, bellNote(R.fork(3), sr, root, R.range(.2, .32), {partials: [[1, 1], [2.005, .4], [3.01, .12]]}), Math.round(tc * sr), R.range(.3, .42));
    return out;
  },
  spill(R, sr) {
    const n = Math.round(1.7 * sr), out = new Float32Array(n);
    const K = R.int(6, 10);
    for (let c = 0; c < K; c++) {
      const Rc = R.fork(10 + c), f0 = Rc.range(1800, 2800), T = Rc.range(.13, .34), e = Rc.range(.5, .7);
      const rings = [coinRing(Rc, sr, f0, T, .0001), coinRing(Rc, sr, f0, T, .0003)];   // hard / soft contact
      const t0 = Math.pow(Rc(), 1.3) * .16 + Rc.range(0, .02), v0 = Rc.range(.5, 1) * Math.pow(.93, c * .5);
      let tEnd = t0, tick = null;
      for (const b of bounces(Rc, {t0, v0, e, dt0: Rc.range(.055, .11), minV: .07, jitter: .2, max: 9})) {
        const hard = b.v > .45 ? 0 : 1;
        add(out, rings[hard], Math.round(b.t * sr), b.v * b.v * 1.1 + .04);
        // the surface: a dull tap (stone or wood floor) at each contact, in proportion to the speed
        add(out, burst(.02, sr, Rc, {a: .0002, d: Rc.range(.0015, .004), color: 'pink', bp: Rc.range(1200, 3000), q: .7}), Math.round(b.t * sr), b.v * .25);
        tEnd = b.t; tick = b.v;
      }
      // settling spin (about 40% of the coins): ticks that accelerate to a buzz as the coin lies down
      if (Rc() < .45) {
        let t = tEnd + .05, gap = Rc.range(.03, .05), a = .1;
        const ring = coinRing(Rc, sr, f0 * Rc.range(.75, .95), .06, .0002);
        for (let k = 0; k < 34 && gap > .0016; k++) { add(out, ring, Math.round(t * sr), a * Math.min(.5, tick + .1) * (1 + k * .06)); t += gap; gap *= Rc.range(.84, .92); }
        add(out, burst(.03, sr, Rc, {a: .0005, d: .01, color: 'pink', bp: 3200, q: .8}), Math.round(t * sr), .1);
      }
    }
    return out;
  },
  chime(R, sr) {
    const n = Math.round(2.0 * sr), out = new Float32Array(n);
    const root = R.pick([440, 493.88, 523.25, 587.33]), K = R.int(3, 4), step = R.range(.075, .095), t0 = R.range(0, .01);
    const start = R.pick([0, 0, 1]), ladder = [start, start + 1, start + 2, start + 4, start + 5];   // rising pentatonic ladder
    for (let k = 0; k < K; k++) {
      const last = k === K - 1, note = bellNote(R.fork(1 + k), sr, penta(root, ladder[Math.min(k, ladder.length - 1)] + (last ? 0 : 0)), last ? R.range(.7, .95) : R.range(.22, .32), {warm: 1});
      add(out, note, Math.round((t0 + k * step * (1 + .05 * k)) * sr), last ? 1 : lerp(.55, .8, k / K));
    }
    // a faint glint of coin metal on the first note
    add(out, coinRing(R.fork(9), sr, R.range(2800, 3400), .18, .00008), Math.round(t0 * sr), .12);
    return out;
  },
};

export default {
  id: 'coin', version: 2, desc: 'Coins: pickup clink + tiny chime, spill (bouncing/spinning coins), pentatonic loot chime',
  params: {kind: {values: ['pickup', 'spill', 'chime'], def: 'pickup'}},
  cases: {pickup: {kind: 'pickup'}, spill: {kind: 'spill'}, chime: {kind: 'chime'}},
  variants: 6,
  render(p, R, sr) {
    const out = CASES[p.kind](R, sr);
    filter(out, 'highpass', 400, .7, sr);
    filter(out, 'highshelf', 6000, .7, sr, -7); filter(out, 'lowpass', 9000, .7, sr);   // tame the very top (v2)
    return saturate(norm(out, .9), 1.15);
  },
  criteria: {
    // v2. Ranges cover seeds 1-24, 44291-44296 and 12 large random seeds (42 per case), with margin. v2: f0 1.8-2.8 kHz, upper modes decay faster, -7 dB shelf above 6 kHz and LP 9 kHz; Schroeder t60 of spill reads long (settling spins).
    pickup: {attackMs: [0, 5], crest: [14, 19], t60Ms: [146, 383], centroidHz: [1342, 2694], lowHz: [762, 1471], highHz: [2021, 5382], flatness: [0, 0.01], durMs: [267, 452], onsetCount: [0, 2], clickEnd: [0, .01]},
    spill: {attackMs: [0, 190], crest: [14, 21], t60Ms: [774, 2437], centroidHz: [2059, 3160], lowHz: [1567, 2363], highHz: [3238, 5355], flatness: [0, 0.016], durMs: [598, 1000], onsetCount: [0, 5], clickEnd: [0, .01]},
    chime: {attackMs: [115, 413], crest: [14, 20], t60Ms: [418, 1104], centroidHz: [537, 1268], lowHz: [391, 815], highHz: [969, 1943], flatness: [0, 0.01], durMs: [912, 1759], onsetCount: [1, 5], clickEnd: [0, .01]},
  },
  notes: 'Metal disc modes 1:1.73:2.33:3.91:4.11 with beating twins; bounce sequence e .5-.7 + accelerating settle ticks; pentatonic bells +-1-2 cents; see docs/AUDIO.md §2.3',
};
