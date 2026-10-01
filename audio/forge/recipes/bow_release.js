// BOW RELEASE: the ranger's shot. Four physical parts that share one cause (the draw energy):
//   1. the bowstring: extended Karplus-Strong, f0 90-220 Hz, pick .1-.2, heavily damped (T60 60-250 ms: a bowstring is
//      dead, not a guitar), pitch falling 3-8% over the first ~20 ms as the stroke tension relaxes
//   2. the slap: the string hitting brace height / the nock leaving: 2-5 ms of noise band-passed at 2-4 kHz
//   3. the limbs: a wood thump, modes 60-150 Hz decaying in 30-80 ms, plus a faint riser knock
//   4. the departing arrow: an aeolian tone at the Strouhal frequency f = 0.2·v/d (750-1500 Hz for an 8 mm shaft at
//      30-60 m/s, BP Q 3-10) plus broadband turbulence, fletching flutter AM 20-60 Hz, receding Doppler, and a level
//      that follows the arrow's speed (dipole power ∝ v^6, amplitude ∝ v^3) and its distance (∝ 1/r) as it leaves.
// Timeline: release at 0; the string's power stroke accelerates the arrow for ~12-18 ms (the whoosh swells and sweeps
// up), the string hits brace height at the end of the stroke (slap + limb thump + string ring), then the arrow recedes.
import {add, filter, sweep, karplus, halfSine, modal, burst, pink, white, saturate} from '../dsp.js';

const C = 343;
const lerp = (a, b, u) => a + (b - a) * u;
// Karplus-Strong loop gain per period for a wanted T60: g^(f0·T60) = 10^-3 (the averaging filter is ≈ 1 at f0 < 250 Hz)
const ksDamp = (f0, t60) => Math.pow(10, -3 / (f0 * t60));
const unitRms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; const g = 1 / Math.sqrt(s / b.length + 1e-20); for (let i = 0; i < b.length; i++) b[i] *= g; return b; };

// one departing arrow, added into `out` at sample offset `at`
// v: launch speed (m/s), d: shaft diameter (m), r0: ear-to-arrow distance at full draw (m), stroke: power stroke (s),
// fall: distance-law exponent (1 = free field; < 1 = the long "pierce" hiss), level
function arrowWhoosh(out, sr, R, at, {v, d, r0, stroke, fall = 1, level = 1, toneQ = 6, toneMix = .3, flutter = [20, 60], dur = .45, rasp = 1, hp = 2200}) {
  const n = Math.min(out.length - at, Math.round(dur * sr)); if (n <= 0) return;
  // kinematics: constant acceleration over the stroke, then constant speed along the line of sight
  const vAt = t => t < stroke ? v * t / stroke : v;
  const xAt = t => t < stroke ? .5 * v * t * t / stroke : .5 * v * stroke + v * (t - stroke);
  // level: dipole amplitude ∝ v^3, spreading ∝ (r0/r)^fall, and a raised-cosine fade over the last half (out of earshot)
  const amp = t => { const u = vAt(t) / v, r = Math.hypot(r0, xAt(t)), w = Math.min(1, Math.max(0, 2 * t / dur - 1)); return u * u * u * Math.pow(r0 / r, fall) * (.5 + .5 * Math.cos(Math.PI * w)); };
  // aeolian tone: Strouhal f = 0.2·v/d, heard with the receding Doppler shift c/(c+v)
  const fTone = t => Math.max(120, .2 * vAt(t) / d * C / (C + vAt(t)));
  const tone = unitRms(sweep(white(n, R), 'bandpass', fTone, toneQ, sr, {every: 16}));
  // broadband turbulence (shaft boundary layer + fletching): pink noise shaped ~2-9 kHz, duller with distance (air)
  const bb = filter(pink(n, R), 'lowpass', 9500 * R.jit(.15), .6, sr); filter(bb, 'highpass', hp * R.jit(.25), .6, sr);
  unitRms(sweep(bb, 'lowpass', t => 3800 + 4200 / (1 + xAt(t) / 6), .7, sr, {every: 64}));
  // the fletching rasp: the vanes brush the arrow rest / bow hand as the arrow clears the riser (~0.7 m of travel)
  const tR = Math.max(stroke, stroke + (.7 - .5 * v * stroke) / v) * R.jit(.1), wR = R.range(.008, .018);
  // fletching flutter: AM at 20-60 Hz, slowly wandering (vanes flapping in the wake), shared by all layers
  let ph = R(), fr = R.range(flutter[0], flutter[1]); const depth = R.range(.3, .6), drift = R.range(-.4, .4);
  for (let i = 0; i < n; i++) {
    const t = i / sr; ph += fr * (1 + drift * t) / sr;
    const am = 1 - depth * (.5 + .5 * Math.sin(2 * Math.PI * ph)), a = amp(t) * level * am;
    const u = (t - tR) / wR, rs = u > 0 && u < 1 ? rasp * Math.sin(Math.PI * u) ** 2 : 0;
    out[at + i] += a * (toneMix * tone[i] + (1 - toneMix) * bb[i]) + rs * level * bb[i] * (.6 + .4 * Math.sin(2 * Math.PI * ph * 7.3));
  }
}

// one string release (string ring + slap + optional limb thump), added into `out` at `at`
function release(out, sr, R, at, {draw, size, heavy, limbs = true, gain = 1}) {
  const n = out.length - at, E = .35 + .65 * draw;              // shared cause: the stored draw energy
  // 1. string: bigger bow = longer, lower string; per shot ±3% pitch, ±20% damping
  const f0 = lerp(215, 105, size) * (heavy ? .82 : 1) * R.jit(.03);
  const t60 = lerp(.08, .17, size) * (heavy ? 1.35 : 1) * R.jit(.2);
  const str = karplus(Math.min(n, Math.round((t60 * 1.6 + .03) * sr)), sr, f0, R, {
    damp: ksDamp(f0, t60), bright: .25 + .5 * draw, pick: R.range(.1, .2), glide: -R.range(.03, .08), glideT: .0065,
  });
  saturate(str, 1.6 + draw);                                    // the string slaps the brace: rounded, a bit gritty
  add(out, str, at, 1.1 * E * gain);
  // 2. slap: 2-5 ms, brighter with a stronger draw
  const sl = burst(R.range(.002, .005), sr, R, {a: .0002, d: R.range(.0006, .0012), color: 'white', bp: lerp(2100, 3900, draw) * R.jit(.08), q: R.range(1, 1.8)});
  add(out, sl, at, 10 * E * E * gain);
  // 3. limb thump: bending modes of the limbs 60-150 Hz plus a faint riser knock
  if (limbs) {
    const lf = lerp(95, 65, size) * (heavy ? .9 : 1) * R.jit(.06);
    const modes = [
      {f: lf, t60: R.range(.04, .08), a: 1},
      {f: lf * R.range(1.45, 1.6), t60: R.range(.035, .06), a: .55 * R.jit(.2)},
      {f: Math.min(150, lf * R.range(1.9, 2.2)), t60: R.range(.03, .045), a: .35 * R.jit(.25)},
      {f: R.range(420, 700), t60: R.range(.015, .03), a: .08 * R.jit(.3)},
    ];
    const th = modal(halfSine(R.range(.003, .006), sr), modes, sr, Math.min(n, Math.round(.14 * sr)));
    add(out, th, at, 2 * E * gain * (heavy ? 1.3 : 1));
  }
}

export default {
  id: 'bow_release', version: 1, desc: 'Bow shot: damped KS bowstring + slap + limb thump + departing aeolian whoosh',
  params: {
    draw: {min: 0, max: 1, def: .8},                            // stronger draw = more energy, brighter slap, faster arrow
    size: {min: 0, max: 1, def: .45},                           // 0 = short bow (high, tight string) .. 1 = longbow
    shot: {values: ['basic', 'heavy', 'multi'], def: 'basic'},
  },
  cases: {
    basic: {shot: 'basic'},
    heavy: {shot: 'heavy', draw: 1, size: .7},                  // the pierce shot: deeper, longer hiss
    multi: {shot: 'multi', draw: .7},                           // a volley of 3 arrows
  },
  variants: 6,
  render(p, R, sr) {
    const heavy = p.shot === 'heavy', multi = p.shot === 'multi';
    const dur = heavy ? .75 : multi ? .6 : .5, out = new Float32Array(Math.round(dur * sr));
    const vBase = lerp(34, 60, p.draw) * (heavy ? 1.05 : 1);     // launch speed
    const shots = multi ? [[0, 1], [R.range(.018, .03), R.range(.65, .85)], [R.range(.042, .065), R.range(.5, .7)]] : [[0, 1]];
    for (const [dt, g] of shots) {
      const Rs = R.fork(Math.round(dt * 1e4) + 1), stroke = R.range(.011, .017) * (heavy ? 1.15 : 1), at = Math.round(dt * sr);
      // the arrow: its whoosh starts at release, the string's impact comes at the end of the power stroke
      arrowWhoosh(out, sr, Rs, at, {
        v: vBase * Rs.jit(.06), d: heavy ? Rs.range(.01, .012) : Rs.range(.0072, .0085), r0: Rs.range(.35, .6), stroke,
        fall: heavy ? .55 : .95, level: g * (heavy ? 1.15 : 1) * Rs.range(.7, 1.3), toneQ: Rs.range(3, 10), toneMix: heavy ? .3 : Rs.range(.14, .26), rasp: Rs.range(.15, .35), hp: heavy ? 1500 : 2200,
        dur: heavy ? .72 : .48,
      });
      release(out, sr, Rs, at + Math.round(stroke * sr), {draw: Math.min(1, p.draw * Rs.jit(.08)), size: p.size, heavy, limbs: dt === 0, gain: g});
    }
    filter(out, 'highpass', 42, .7, sr);                        // rumble guard
    return out;
  },
  criteria: {
    // onsets: the forge's detector needs 15 ms of history, and the slap lands 11-20 ms after release on a swelling
    // whoosh, so a single shot may register 0 onsets; the transient is checked by the crest factor instead
    basic: {attackMs: [0, 15], crest: [16, 32], t60Ms: [350, 1000], centroidHz: [1800, 3600], lowHz: [30, 150], highHz: [6000, 9500], durMs: [380, 520], onsetCount: [0, 3], clickEnd: [0, .01]},
    heavy: {attackMs: [0, 25], crest: [16, 32], t60Ms: [900, 1700], centroidHz: [1600, 3200], lowHz: [30, 150], highHz: [5500, 9000], durMs: [600, 780], onsetCount: [0, 3], clickEnd: [0, .01]},
    multi: {attackMs: [0, 40], crest: [14, 30], t60Ms: [450, 1000], centroidHz: [2200, 4000], lowHz: [30, 150], highHz: [6500, 9500], durMs: [400, 580], onsetCount: [0, 4], clickEnd: [0, .01]},
  },
  refs: {basic: ['assets/sfx/shot.basic_1.mp3', 'assets/sfx/shot.basic_2.mp3']},
  notes: 'Extended Karplus-Strong (Jaffe-Smith) string with tension glide; Strouhal aeolian tone 0.2·v/d with v^3/r level law; see docs/AUDIO.md §2.3',
};
