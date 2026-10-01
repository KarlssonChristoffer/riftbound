// BOW RELEASE: the ranger's shot. Physical parts that share one cause (the draw energy), on one timeline:
//   release at 0 -> the power stroke accelerates the arrow for ~11-17 ms (the whoosh swells) -> the string reaches
//   brace height and slams the arm guard / limb tips (the "thwack") -> the string buzzes briefly against the guard while
//   the limbs thrum -> the arrow leaves (its whoosh falls fast with distance and darkens).
//   1. thwack: a sharp click (1-3 ms white, HP 1.5 kHz) + the slap body (pink noise BP 1-2.5 kHz, 3-6 ms decay) + the
//      leather arm guard (two low-q modes 350-1000 Hz, ~25 ms). Brighter and louder with a stronger draw.
//   2. string: extended Karplus-Strong f0 90-220 Hz, pick .1-.2, pitch falling 3-8% in ~20 ms, very dead (T60 35-80 ms:
//      a bowstring is not a guitar). It is heard mostly as a BUZZ: the string rattles on the guard once per period,
//      modelled as HP noise gated by the string's positive half-waves, plus the string itself under hard asymmetric
//      clipping, so it never rings as a clean tone.
//   3. limbs: the hand-shock "thrum": 2-3 limb bending modes 55-150 Hz with a near-degenerate twin (slow beat),
//      T60 120-260 ms, plus a faint riser knock 420-700 Hz.
//   4. arrow: broadband shaft/fletching turbulence (pink noise, a band that slides from ~9 kHz down to ~3.5 kHz as the
//      arrow recedes) + a weak, low-q aeolian tone at the Strouhal f = 0.2·v/d (Doppler-shifted), fletching flutter AM
//      20-60 Hz, and the vanes' rasp past the riser. Level: v^3 (dipole) during the stroke, then (r0/r)^fall with the
//      ear only 15-30 cm from the shaft at anchor, so it falls ~20 dB in the first 50 ms: an arrow leaving, not a hiss.
import {add, filter, sweep, karplus, halfSine, modal, burst, pink, white, saturate} from '../dsp.js';

const C = 343;
const lerp = (a, b, u) => a + (b - a) * u;
// Karplus-Strong loop gain per period for a wanted T60: g^(f0·T60) = 10^-3 (the averaging filter is ≈ 1 at f0 < 250 Hz)
const ksDamp = (f0, t60) => Math.pow(10, -3 / (f0 * t60));
const unitRms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; const g = 1 / Math.sqrt(s / b.length + 1e-20); for (let i = 0; i < b.length; i++) b[i] *= g; return b; };
const unitPeak = b => { let p = 0; for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); if (p > 0) for (let i = 0; i < b.length; i++) b[i] /= p; return b; };

// a decaying, low-passed brown noise with unit area-ish scale: the limbs' irregular shake after the shot (tau = 1/e time)
function brownShake(n, sr, R, tau) {
  const b = filter(pink(n, R), 'lowpass', 220, .7, sr); let s = 0;
  for (let i = 0; i < n; i++) { b[i] *= Math.exp(-i / sr / tau); s += Math.abs(b[i]); }
  for (let i = 0; i < n; i++) b[i] *= .6 / (s + 1e-12);
  return b;
}

// one departing arrow, added into `out` at sample offset `at`
// v: launch speed (m/s), d: shaft diameter (m), r0: ear-to-shaft distance at anchor (m), stroke: power stroke (s),
// fall: distance-law exponent, dur: audible life (s), level
function arrowWhoosh(out, sr, R, at, {v, d, r0, stroke, fall = 1, level = 1, toneQ = 3, toneMix = .12, flutter = [20, 60], dur = .3, rasp = .3, hp = 1800}) {
  const n = Math.min(out.length - at, Math.round(dur * sr)); if (n <= 0) return;
  const vAt = t => t < stroke ? v * t / stroke : v;
  const xAt = t => t < stroke ? .5 * v * t * t / stroke : .5 * v * stroke + v * (t - stroke);
  // level: dipole amplitude ∝ v^3, spreading ∝ (r0/r)^fall, and a raised-cosine fade over the last 40%
  const amp = t => { const u = vAt(t) / v, r = Math.hypot(r0, xAt(t)), w = Math.min(1, Math.max(0, (t / dur - .6) / .4)); return u * u * u * Math.pow(r0 / r, fall) * (.5 + .5 * Math.cos(Math.PI * w)); };
  // aeolian tone: Strouhal f = 0.2·v/d with the receding Doppler shift c/(c+v); low q, kept well under the turbulence
  const fTone = t => Math.max(150, .2 * vAt(t) / d * C / (C + vAt(t)));
  const tone = unitRms(sweep(white(n, R), 'bandpass', fTone, toneQ, sr, {every: 16}));
  // turbulence: a band that darkens as the arrow recedes (air absorption + the shaft no longer passing the ear)
  const hpF = hp * R.jit(.2), lpTop = R.range(5500, 7000), lpEnd = R.range(2000, 2800);
  const bb = filter(filter(pink(n, R), 'highpass', hpF, .6, sr), 'peak', R.range(2500, 3800), .8, sr, R.range(2, 4));   // fletching edge-tone hump (kept low: crisp, not shrill)
  unitRms(sweep(bb, 'lowpass', t => lpEnd + (lpTop - lpEnd) / (1 + Math.max(0, xAt(t) - .3) / 1.5), .7, sr, {every: 32}));
  // the fletching rasp: the vanes brush the arrow rest / bow hand as the arrow clears the riser (~0.7 m of travel)
  const tR = Math.max(stroke, stroke + (.7 - .5 * v * stroke) / v) * R.jit(.1), wR = R.range(.006, .014);
  let ph = R(), fr = R.range(flutter[0], flutter[1]); const depth = R.range(.15, .35), drift = R.range(-.4, .4);
  for (let i = 0; i < n; i++) {
    const t = i / sr; ph += fr * (1 + drift * t) / sr;
    const am = 1 - depth * (.5 + .5 * Math.sin(2 * Math.PI * ph)), a = amp(t) * level * am;
    const u = (t - tR) / wR, rs = u > 0 && u < 1 ? rasp * Math.sin(Math.PI * u) ** 2 : 0;
    out[at + i] += a * (toneMix * tone[i] + (1 - toneMix) * bb[i]) + rs * level * bb[i];
  }
}

// the string's impact at brace height: thwack + buzz + limb thrum, added into `out` at `at`
function release(out, sr, R, at, {draw, size, heavy, limbs = true, gain = 1, thwack = 1}) {
  const n = out.length - at, E = .35 + .65 * draw;              // shared cause: the stored draw energy
  // 1. thwack: click + slap body + leather arm guard
  const click = filter(burst(R.range(.001, .003), sr, R, {a: .0001, d: R.range(.0003, .0007), color: 'white'}), 'highpass', 1500, .7, sr);
  filter(click, 'lowpass', R.range(4000, 5500), .7, sr);         // leather-damped: a thwack, not a tick
  add(out, click, at, 2.2 * E * E * gain * thwack);
  const body = burst(.03, sr, R, {a: .0003, d: R.range(.003, .006), color: 'pink', bp: lerp(900, 1900, draw) * R.jit(.12), q: R.range(.6, 1)});
  add(out, unitPeak(body), at, .9 * E * gain * thwack);
  const gf = R.range(350, 650), guard = modal(halfSine(R.range(.0008, .0015), sr), [{f: gf, t60: R.range(.02, .035), a: 1}, {f: gf * R.range(1.6, 1.9), t60: R.range(.012, .022), a: .5}], sr, Math.round(.06 * sr));
  add(out, unitPeak(guard), at, .3 * E * gain * thwack);
  // 2. string: dead KS (±3% pitch, ±20% damping), heard as a buzz on the guard rather than a tone
  const f0 = lerp(215, 105, size) * (heavy ? .82 : 1) * R.jit(.03);
  const t60 = lerp(.035, .07, size) * (heavy ? 1.2 : 1) * R.jit(.2), m = Math.min(n, Math.round((t60 * 1.3 + .01) * sr));
  const str = unitPeak(karplus(m, sr, f0, R, {damp: ksDamp(f0, t60), bright: .35 + .45 * draw, pick: R.range(.1, .2), glide: -R.range(.03, .08), glideT: .0065}));
  const rattle = filter(filter(white(m, R), 'highpass', R.range(800, 1500), .7, sr), 'lowpass', 4000, .7, sr), buzz = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const s = str[i], c = s > .25 ? .25 + (s - .25) * .15 : s;  // asymmetric clip: the guard stops one side
    buzz[i] = .55 * c + rattle[i] * Math.max(0, s - .1) * 1.4;   // the rattle fires on each contact
  }
  add(out, unitPeak(buzz), at, R.range(.35, .55) * E * gain);
  // 3. limb thrum (hand shock): low bending modes with slow beating, plus a faint riser knock
  if (limbs) {
    const lf = lerp(95, 62, size) * (heavy ? .88 : 1) * R.jit(.07), T = R.range(.1, .18) * (heavy ? 1.25 : 1), beat = R.range(1.5, 4);
    const modes = [
      {f: lf, t60: T, a: 1}, {f: lf + beat, t60: T, a: .6},
      {f: Math.min(150, lf * R.range(1.45, 1.65)), t60: T * .7, a: .9 * R.jit(.25)},
      {f: lf * R.range(2.5, 2.9), t60: T * .4, a: .3 * R.jit(.3)},             // beam-like 2.76 mode: the 150-300 Hz body
      {f: R.range(420, 700), t60: R.range(.015, .03), a: .06 * R.jit(.3)},
    ];
    // the exciter is the impact plus an irregular shake (hand, riser, limb tips settling): a decaying brown noise, so
    // the thrum comes out as a grainy low rumble around the limb modes instead of a clean decaying sine
    const m2 = Math.min(n, Math.round((T * 1.3 + .2) * sr)), shake = brownShake(m2, sr, R, R.range(.07, .12) * (heavy ? 1.3 : 1));
    add(shake, halfSine(R.range(.004, .007), sr), 0, R.range(.5, .9));
    const th = modal(shake, modes, sr, m2);
    add(out, unitPeak(th), at, R.range(.7, .95) * E * gain * (heavy ? 1.25 : 1));
  }
}

export default {
  id: 'bow_release', version: 3, desc: 'Bow shot: thwack + string buzz + limb thrum + departing arrow whoosh',
  params: {
    draw: {min: 0, max: 1, def: .8},                            // stronger draw = more energy, brighter thwack, faster arrow
    size: {min: 0, max: 1, def: .45},                           // 0 = short bow (high, tight string) .. 1 = longbow
    shot: {values: ['basic', 'heavy', 'multi'], def: 'basic'},
  },
  cases: {
    basic: {shot: 'basic'},
    heavy: {shot: 'heavy', draw: 1, size: .7},                  // the pierce shot: deeper thrum, longer hiss
    multi: {shot: 'multi', draw: .7},                           // a volley of 3 arrows
  },
  variants: 6,
  render(p, R, sr) {
    const heavy = p.shot === 'heavy', multi = p.shot === 'multi';
    const dur = heavy ? .6 : multi ? .45 : .4, out = new Float32Array(Math.round(dur * sr));
    const vBase = lerp(34, 60, p.draw) * (heavy ? 1.05 : 1);    // launch speed
    const shots = multi ? [[0, 1], [R.range(.018, .03), R.range(.65, .85)], [R.range(.042, .065), R.range(.5, .7)]] : [[0, 1]];
    for (const [dt, g] of shots) {
      const Rs = R.fork(Math.round(dt * 1e4) + 1), stroke = R.range(.011, .017) * (heavy ? 1.15 : 1), at = Math.round(dt * sr);
      arrowWhoosh(out, sr, Rs, at, {
        v: vBase * Rs.jit(.06), d: heavy ? Rs.range(.01, .012) : Rs.range(.0072, .0085), r0: Rs.range(.15, .3), stroke,
        fall: heavy ? 1 : Rs.range(1.35, 1.6), level: g * (heavy ? 1.1 : 1) * Rs.range(.75, 1.25) * .95, toneQ: Rs.range(2, 4),
        toneMix: Rs.range(.05, .12), rasp: Rs.range(.15, .3), hp: heavy ? 1100 : 1500, dur: heavy ? .55 : .32,
      });
      release(out, sr, Rs, at + Math.round(stroke * sr), {draw: Math.min(1, p.draw * Rs.jit(.08)), size: p.size, heavy, limbs: dt === 0, gain: g});
    }
    filter(out, 'highpass', 38, .7, sr);                        // rumble guard
    filter(out, 'highshelf', 5000, .7, sr, -8);                   // warm game mix (RECIPE_GUIDE brightness rules)
    return saturate(out, 1.2);
  },
  criteria: {
    // onsets: the forge's detector needs 15 ms of history and the thwack lands 11-20 ms after release on a swelling
    // whoosh, so a single shot may register 0 onsets; the transient is checked by the crest factor instead.
    // Ranges cover seeds 1-24, the lab's 44291-44296 and 12 large random seeds (42 per case).
    // v3 (darker: warm game mix). Ranges cover 42 seeds per case.
    basic: {attackMs: [0, 35], crest: [16, 24], t60Ms: [80, 450], centroidHz: [450, 2200], lowHz: [30, 150], highHz: [2300, 5500], flatness: [0, .08], durMs: [330, 440], onsetCount: [0, 3], clickEnd: [0, .01]},
    heavy: {attackMs: [0, 35], crest: [16, 24], t60Ms: [300, 1000], centroidHz: [450, 2000], lowHz: [30, 150], highHz: [2500, 5200], flatness: [0, .08], durMs: [500, 620], onsetCount: [0, 3], clickEnd: [0, .01]},
    multi: {attackMs: [0, 45], crest: [15, 22], t60Ms: [90, 350], centroidHz: [1100, 2800], lowHz: [30, 150], highHz: [3500, 6000], flatness: [0, .12], durMs: [340, 500], onsetCount: [0, 4], clickEnd: [0, .01]},
  },
  refs: {basic: ['assets/sfx/shot.basic_1.mp3', 'assets/sfx/shot.basic_2.mp3']},
  notes: 'Thwack (click + slap + guard modes), KS string heard as a guard buzz, limb thrum modes, Strouhal/turbulence whoosh with v^3 and (r0/r)^fall; see docs/AUDIO.md §2.3',
};
