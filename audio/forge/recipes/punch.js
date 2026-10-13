// PUNCH: the live cowboys' bare-knuckle fight (docs/exp/fists.md: features/fists.js fist.hit / fist.whiff / fist.grab,
// sim/player/fists.js player.fist, features/foes/brawler.js foe.fwind / foe.punch; the events: audio/runtime/events.js
// punch / punchBlock / whiff / fistCue / fistGrab / foeWind / foePunch).
// The user's taste (RECIPE_GUIDE): light, tight, dry, physical. Nothing hollow, nothing that rings: every mode dies within a
// few periods (t60 <= ~90 ms below 150 Hz, <= ~35 ms above 300 Hz, <= 8 ms above 1.4 kHz), highs only as short transients,
// no hiss (the impacts glued, then a warm tilt -8 dB above 4 kHz and an 8 kHz low-pass; the air and cloth rolled off above ~2.6 kHz).
// A BLOW is built from the parts a Foley punch is made of, on one timeline:
//   slap    skin / leather meeting: a very short band of noise (0.9-2.2 kHz, 2.5-9 ms): what makes a punch READ
//   knock   the meat / bone thock: 2-3 damped modes 260-600 Hz (t60 9-32 ms): the "tock" of a fist on a face
//   thump   the body's mass: a damped low mode 70-175 Hz (t60 28-88 ms) under a soft contact (1.8-8 ms): the WEIGHT
//   mass    a low-passed pink puff (muffled flesh); cloth (a shirt, a vest: a soft band 600-1100 Hz) on body shots only
//   crack   (uppercut, haymaker) a very short contact into a few fast modes 1.3-2.4 kHz (t60 4-8 ms): the jaw's clack
// The weight ladder jab < cross < hook < upper < heavy: a longer contact (duller), a lower and longer thump, a lower slap
// band, more mass, more saturation. The cases:
//   jab     light, quick, tight: a bright-ish slap, a short knock, a small low body (~0.1 s)
//   cross   fuller: the same parts, longer and lower, a firmer body
//   hook    meaty: a wider slap, a big knock, more body, a crumple of skin
//   upper   a crack + a thump: the jaw's clack, then the body's low thump a breath late (the head lifted)
//   heavy   the haymaker / a knockout: a big dull thump with a crack, the body's second jolt, a crunch; no ring
//   body    a fist into the gut: soft attack (through the shirt), a dull low thud, a puff of breath forced out
//   block   on raised forearms: a short dry thock, padded (leather sleeves): duller and shorter than the jab
//   head    a headbutt: a hard dull knock: skull modes 230-300 Hz (q ~3.5: knocks, never bonks), a bone tick, a click
//   kick    a shin into the ribs (the roundhouse, the knee): a heavy slap-thud through the shirt
//   whiff   a punch at nothing: a quick air swish (~0.1 s), peaking early (the hand is already out at the contact time)
//   swing   the big ones' throw (haymaker, body, roundhouse): a deeper whoosh peaking ~0.1-0.15 s in (at the contact)
//   slip    the bob-and-weave: a soft cloth whoosh and a smaller return
//   ready   the counter window: a fist clenching in leather: a short creak and a soft thup (subtle, but it reads)
//   windup  a heavy charging / a gunman's haymaker telegraph: the arm drawn back (a rising cloth swish) and leather creak
//   grab    the clinch: two hands slapping onto a shirt, the cloth crumpling, chest meeting chest
import {add, scale, peak, filter, sweep, halfSine, modal, pink, white, saturate, warm, t60FromQ} from '../dsp.js';

const PI = Math.PI, lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const TAIL = 9.2;   // time constants to -80 dB

// ============================================================================================ helpers
// attack a, 1/e decay d (s): (1 - e^-t/a) e^-t/d, by running products (no corners anywhere)
const ad = (b, sr, a, d) => {
  const ka = Math.exp(-1 / (a * sr)), kd = Math.exp(-1 / (d * sr)); let ea = 1, ed = 1;
  for (let i = 0; i < b.length; i++) { b[i] *= (1 - ea) * ed; ea *= ka; ed *= kd; }
  return b;
};
// a contact of duration tc (a half-sine roughened ±25%: skin and cloth are never a clean pulse) into damped modes
// [[f, t60, a], ...], added at `at` s with peak amp; the buffer runs to ~-96 dB of the longest mode
function strike(out, sr, R, at, tc, modes, amp) {
  const i0 = Math.round(at * sr); if (i0 >= out.length || !(amp > 0)) return;
  let T = 0; for (const m of modes) T = Math.max(T, m[1]);
  const exc = halfSine(tc * R.jit(.12), sr), n = Math.min(out.length - i0, Math.round((T * 1.6 + tc + .01) * sr));
  for (let i = 0; i < exc.length; i++) exc[i] *= 1 + .25 * (R() * 2 - 1);
  add(out, norm(modal(exc, modes.map(([f, t60, a]) => ({f, t60, a})), sr, n), amp), i0);
}
// a noise burst: colour, attack a, 1/e decay d, then band-pass (bp, q), low-pass (2 x 2nd order), high-pass; added at `at` s,
// sized to -80 dB. Scaled by its ENERGY (amp ~ the peak of a typical short burst: 2.2 x its rms over its decay), not its peak: a
// short burst's peak swings by several dB with the noise, its energy (what you hear) does not
function puff(out, sr, R, at, {a = .0005, d = .01, color = 'pink', bp = 0, q = .8, lp = 0, hp = 0, amp = 1} = {}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round((d * TAIL + a * 4 + .004) * sr)); if (n <= 0 || !(amp > 0)) return;
  const b = ad(color === 'white' ? white(n, R) : pink(n, R), sr, a, d);
  if (bp) filter(b, 'bandpass', bp, q, sr);
  if (lp) { filter(b, 'lowpass', lp, .7, sr); filter(b, 'lowpass', lp * 1.4, .7, sr); }
  if (hp) filter(b, 'highpass', hp, .7, sr);
  let e = 0; for (let i = 0; i < n; i++) e += b[i] * b[i];
  if (e > 0) add(out, scale(b, amp / (2.2 * Math.sqrt(2 * e / ((d + a) * sr)))), i0);
}
// k tiny dark ticks over [t0, t1] s (skin crumpling, cloth fibres): more of them early, fading; peak amp
function grains(out, sr, R, t0, t1, k, {f = [700, 1500], amp = .2, d = [.0005, .0011]} = {}) {
  for (let i = 0; i < k; i++) {
    const u = R(), at = t0 + (t1 - t0) * u * u, fb = R.range(f[0], f[1]);
    puff(out, sr, R, at, {a: .00008, d: R.range(d[0], d[1]), color: 'white', bp: fb, q: 1.2, lp: fb * 1.6, amp: amp * (1 - .6 * u) * R.range(.5, 1)});
  }
}
// the jaw / knuckle CLACK of the hard blows: a very short contact into a few fast modes (t60 4-8 ms: a click with a colour,
// never a tone) and a white burst of ~1 ms
function crack(out, sr, R, at, amp, f, len = 1) {
  strike(out, sr, R, at, R.range(.00012, .0002), [[f, R.range(.004, .007) * len, 1], [f * R.range(1.4, 1.6), .004 * len, .55], [f * R.range(.55, .65), .008 * len, .5]], amp);
  puff(out, sr, R, at, {a: .00005, d: R.range(.0008, .0014), color: 'white', bp: f * R.range(1.1, 1.35), q: .9, lp: 5000, amp: amp * .6});
}
// air and cloth moved by an arm or a body: pink noise through a band-pass whose centre goes f0 -> f1 (at pk of dur) -> f2,
// under a skewed bell (peak at pk), with a fabric grain (a 90-220 Hz low-passed random modulator: never a clean hiss),
// rolled off at 24 dB/oct above ~2.2x the centre (never above `top`). Added at `at` s with peak amp
function bell(u, pk, p) { if (u <= 0 || u >= 1) return 0; const v = u < pk ? .5 * u / pk : .5 + .5 * (u - pk) / (1 - pk); return Math.pow(Math.sin(PI * v), p); }
function whoosh(out, sr, R, at, {dur, f0, f1, f2, pk = .4, p = 2, q = .8, grain = .5, amp = 1, top = 2600}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round((dur + .02) * sr)); if (n <= 8) return;
  const fAt = t => { const u = Math.min(1, t / dur); return u < pk ? lerp(f0, f1, Math.sin(PI / 2 * u / pk)) : lerp(f1, f2, (u - pk) / (1 - pk)); };
  const x = sweep(pink(n, R), 'bandpass', fAt, q, sr, {every: 24});
  for (let k = 0; k < 2; k++) sweep(x, 'lowpass', t => Math.min(top, fAt(t) * 2.2), .7, sr, {every: 48});
  const g = filter(white(n, R), 'lowpass', R.range(90, 220), .7, sr); let gr = 0; for (const v of g) gr += v * v; gr = Math.sqrt(gr / n) || 1;
  for (let i = 0; i < n; i++) x[i] *= bell(i / sr / dur, pk, p) * Math.max(.05, 1 + grain * .6 * g[i] / gr);
  add(out, norm(x, amp), i0);
}
// LEATHER under strain (a glove, a fist clenching, a jacket's shoulder): stick-slip, one slip per impulse, the rate going
// r0 -> r1 Hz over [t0, t1] (±25% jitter), each slip ringing the leather's damped formants (q 3-5, t60 <= 22 ms: a soft
// creak, never a tone) with a short rasp of friction noise; the level swells and falls over the span
const LEATHER = [[210, 3, .35], [460, 3.5, .7], [780, 4, 1], [1180, 4.5, .75], [1650, 4.5, .4], [2300, 4.5, .12]];
function creak(out, sr, R, t0, t1, {r0, r1, amp = 1, tilt = 0}) {
  for (let t = t0 + R.range(0, .003); t < t1;) {
    const u = (t - t0) / (t1 - t0), s = R.pow(.35, 1, 1.4) * (.35 + .65 * Math.sin(PI * Math.min(1, u)));
    const modes = LEATHER.map(([f, q, a], k) => { const ff = f * R.jit(.08); return [ff, Math.min(.022, t60FromQ(q * R.range(.8, 1.2), ff)), a * R.range(.6, 1.3) * Math.pow(1 + tilt, k / 2)]; });
    strike(out, sr, R, t, R.range(.0006, .0012), modes, amp * s);
    puff(out, sr, R, t, {a: .0003, d: R.range(.0015, .003), bp: R.range(800, 1400), q: .9, lp: 2800, amp: amp * s * .25});
    t += 1 / (lerp(r0, r1, u) * R.jit(.25));
  }
}
const buf = (sec, sr) => new Float32Array(Math.round(sec * sr));
// a consistent crest: the loudest 20 ms brought to one level before the tanh glue rounds the peaks (a short blow is held
// under -20 LUFS by the forge's -1.2 dB peak cap, by how much depends on its crest: the jab's variants spread 5 dB without
// this, ~2.5 with it and limit() below)
function level(b, sr, rms) {
  const w = Math.round(.02 * sr), c = new Float64Array(b.length + 1); let best = 0;
  for (let i = 0; i < b.length; i++) c[i + 1] = c[i] + b[i] * b[i];
  for (let i = w; i <= b.length; i += 64) best = Math.max(best, (c[i] - c[i - w]) / w);
  return best > 0 ? scale(b, rms / Math.sqrt(best)) : b;
}
// a transparent peak limiter: the gain follows min(1, thr / the peak of the next 1 ms) with a 0.25 ms attack and a 2 ms
// release (no added harmonics): only an outlier transient is touched (see LIM)
function limit(b, sr, thr) {
  const la = Math.round(.001 * sr), ka = 1 - Math.exp(-1 / (.00025 * sr)), kr = 1 - Math.exp(-1 / (.002 * sr)), n = b.length, need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = Math.abs(b[i]); if (v > thr) { const g = thr / v; for (let j = Math.max(0, i - la); j <= i; j++) if (!need[j] || g < need[j]) need[j] = g; } }
  let g = 1;
  for (let i = 0; i < n; i++) { const t = need[i] || 1; g += (t - g) * (t < g ? ka : kr); b[i] *= Math.min(g, t); }
  return b;
}

// ============================================================================================ the cases
const CASES = {
  jab(R, sr) {
    const out = buf(.2, sr), fs = R.range(1600, 2100), fk = R.range(450, 540), fB = R.range(145, 175);
    puff(out, sr, R, 0, {a: .00008, d: R.range(.0025, .0038), color: 'white', bp: fs, q: .85, lp: 4500, amp: 1});                        // the slap
    strike(out, sr, R, .0003, R.range(.0006, .0009), [[fk, R.range(.012, .014), 1], [fk * R.range(1.6, 1.8), .008, .5], [fk * R.range(2.5, 2.8), .005, .25]], R.range(.7, .78));   // the knock
    strike(out, sr, R, .0005, R.range(.0016, .0022), [[fB, R.range(.024, .028), 1], [fB * R.range(2.1, 2.4), .013, .4]], R.range(.32, .37));   // the body
    puff(out, sr, R, .0008, {a: .0005, d: R.range(.004, .006), lp: R.range(700, 900), hp: 100, amp: .22});                                   // the mass
    return out;
  },
  cross(R, sr) {
    const out = buf(.25, sr), fs = R.range(1300, 1750), fk = R.range(390, 470), fB = R.range(112, 136);
    puff(out, sr, R, 0, {a: .0001, d: R.range(.0035, .005), color: 'white', bp: fs, q: .8, lp: 4200, amp: 1});
    strike(out, sr, R, .0004, R.range(.0008, .0011), [[fk, R.range(.017, .021), 1], [fk * R.range(1.6, 1.8), .011, .5], [fk * R.range(2.5, 2.8), .007, .25]], R.range(.72, .82));
    strike(out, sr, R, .0006, R.range(.0026, .0032), [[fB, R.range(.035, .042), 1], [fB * R.range(2.1, 2.5), .018, .45], [fB * R.range(3.5, 4), .011, .2]], R.range(.58, .68));
    puff(out, sr, R, .001, {a: .0007, d: R.range(.006, .009), lp: R.range(600, 800), hp: 80, amp: .4});
    return out;
  },
  hook(R, sr) {
    const out = buf(.28, sr), fs = R.range(1050, 1550), fk = R.range(340, 440), fB = R.range(95, 125);
    puff(out, sr, R, 0, {a: .00012, d: R.range(.0045, .0065), color: 'white', bp: fs, q: .7, lp: 4000, amp: 1});                          // a wider slap
    strike(out, sr, R, .0005, R.range(.001, .0013), [[fk, R.range(.022, .028), 1], [fk * R.range(1.6, 1.8), .014, .55], [fk * R.range(2.5, 2.8), .009, .3]], R.range(.8, .95));
    strike(out, sr, R, .0008, R.range(.0032, .004), [[fB, R.range(.05, .062), 1], [fB * R.range(2.1, 2.5), .025, .45], [fB * R.range(3.5, 4), .014, .2]], R.range(.85, 1));
    puff(out, sr, R, .0012, {a: .0009, d: R.range(.008, .011), lp: R.range(500, 650), hp: 80, amp: .5});
    grains(out, sr, R, .001, R.range(.018, .026), R.int(2, 4), {f: [700, 1400], amp: .18});                                                // skin crumpling
    return out;
  },
  upper(R, sr) {
    const out = buf(.3, sr), fk = R.range(450, 580), fB = R.range(90, 118), lag = R.range(.0015, .003);
    crack(out, sr, R, 0, R.range(.85, 1), R.range(1500, 2200), 1.6);                                                                         // the jaw's clack
    puff(out, sr, R, 0, {a: .0001, d: R.range(.003, .0045), color: 'white', bp: R.range(1300, 1900), q: .8, lp: 4200, amp: .7});
    strike(out, sr, R, .0004, R.range(.0007, .001), [[fk, R.range(.015, .02), 1], [fk * R.range(1.6, 1.8), .009, .45]], R.range(.6, .75));
    strike(out, sr, R, lag, R.range(.0034, .0042), [[fB, R.range(.05, .062), 1], [fB * R.range(2.1, 2.5), .026, .45], [fB * R.range(3.5, 4), .014, .2]], .85);   // the thump, a breath late
    puff(out, sr, R, lag, {a: .001, d: R.range(.008, .011), lp: R.range(480, 620), hp: 75, amp: .45});
    return out;
  },
  heavy(R, sr) {
    const out = buf(.42, sr), fk = R.range(300, 400), fB = R.range(70, 92), tB = R.range(.07, .088);
    crack(out, sr, R, 0, R.range(.45, .6), R.range(1300, 1900));
    puff(out, sr, R, .0002, {a: .00015, d: R.range(.006, .008), color: 'white', bp: R.range(900, 1400), q: .7, lp: 3600, amp: .95});        // the slap
    strike(out, sr, R, .0006, R.range(.0012, .0016), [[fk, R.range(.026, .032), 1], [fk * R.range(1.6, 1.8), .016, .55], [fk * R.range(2.5, 2.8), .01, .3]], R.range(.85, 1));
    strike(out, sr, R, .001, R.range(.0045, .006), [[fB, tB, 1], [fB * R.range(2.1, 2.5), tB * .45, .45], [fB * R.range(3.5, 4), tB * .25, .2]], 1.15);   // the thump
    strike(out, sr, R, R.range(.008, .015), .005, [[fB * R.range(1.15, 1.3), tB * .7, 1], [fB * R.range(2.4, 2.8), tB * .35, .4]], R.range(.5, .65));   // the body's second jolt
    puff(out, sr, R, .0015, {a: .0015, d: R.range(.012, .016), lp: R.range(380, 520), hp: 60, amp: .65});                                   // the mass
    grains(out, sr, R, .002, R.range(.025, .035), R.int(4, 6), {f: [600, 1400], amp: .2});                                                  // a crunch
    return out;
  },
  body(R, sr) {
    const out = buf(.4, sr), fB = R.range(72, 95), lag = R.range(.0015, .003);
    puff(out, sr, R, 0, {a: R.range(.0004, .0007), d: R.range(.006, .009), bp: R.range(700, 1100), q: .8, lp: 2400, amp: .65});        // the shirt
    strike(out, sr, R, lag, R.range(.006, .008), [[fB, R.range(.055, .068), 1], [fB * R.range(2.1, 2.5), .028, .45], [fB * R.range(3.5, 4), .015, .2]], 1);   // the gut
    strike(out, sr, R, .001, R.range(.0022, .0028), [[R.range(260, 340), R.range(.018, .024), 1], [R.range(480, 560), .011, .45]], R.range(.4, .55));   // a dull knock
    puff(out, sr, R, lag, {a: .002, d: R.range(.012, .016), lp: R.range(350, 480), hp: 60, amp: .75});                                     // the mass
    puff(out, sr, R, R.range(.012, .02), {a: R.range(.007, .01), d: R.range(.018, .025), bp: R.range(450, 700), q: .7, lp: 1100, hp: 200, amp: .14});   // breath forced out
    return out;
  },
  block(R, sr) {
    const out = buf(.2, sr), f = R.range(240, 320);
    puff(out, sr, R, 0, {a: .0002, d: R.range(.0025, .004), bp: R.range(900, 1300), q: .9, lp: 3000, amp: .55});                          // the leather sleeve
    strike(out, sr, R, .0003, R.range(.0014, .002), [[f, R.range(.018, .024), 1], [f * R.range(1.65, 1.8), .012, .55], [f * R.range(2.6, 2.9), .008, .3]], 1);   // the thock
    strike(out, sr, R, .0004, R.range(.0005, .0007), [[R.range(700, 850), R.range(.009, .012), 1], [R.range(1050, 1250), .006, .4]], R.range(.25, .35));   // the bone
    puff(out, sr, R, .0008, {a: .0006, d: R.range(.006, .009), lp: R.range(600, 750), hp: 90, amp: .3});
    return out;
  },
  head(R, sr) {
    const out = buf(.28, sr), f = R.range(230, 300);
    strike(out, sr, R, 0, R.range(.001, .0014), [[f, R.range(.026, .034), 1], [f * R.range(2.2, 2.5), .016, .55], [f * R.range(3.7, 4.2), .01, .3], [f * R.range(5.5, 6.2), .006, .15]], 1);   // the skull
    strike(out, sr, R, .0002, R.range(.0004, .0006), [[R.range(750, 950), R.range(.01, .013), 1], [R.range(1150, 1450), .007, .45]], R.range(.6, .75));   // a bone tick
    puff(out, sr, R, 0, {a: .00005, d: R.range(.001, .0018), color: 'white', bp: R.range(1500, 2000), q: 1, lp: 4000, amp: .35});         // the click
    puff(out, sr, R, .0002, {a: .0001, d: .0025, color: 'white', bp: R.range(1200, 1600), q: .9, lp: 3500, amp: .3});                      // skin
    strike(out, sr, R, .0008, R.range(.0028, .0034), [[R.range(100, 125), R.range(.04, .05), 1]], R.range(.5, .6));                          // the mass behind it
    puff(out, sr, R, .001, {a: .0006, d: R.range(.008, .012), lp: R.range(500, 650), hp: 80, amp: .3});
    return out;
  },
  kick(R, sr) {
    const out = buf(.36, sr), fB = R.range(78, 100), fk = R.range(320, 420);
    puff(out, sr, R, 0, {a: .00015, d: R.range(.006, .009), color: 'white', bp: R.range(900, 1400), q: .7, lp: 3500, amp: 1});            // the shin's slap
    puff(out, sr, R, .0005, {a: .0008, d: R.range(.01, .014), bp: R.range(600, 900), q: .8, lp: 2000, amp: .4});                         // the shirt
    strike(out, sr, R, .0008, R.range(.004, .005), [[fB, R.range(.06, .072), 1], [fB * R.range(2.2, 2.5), .03, .45], [fB * R.range(3.6, 4), .016, .2]], 1.05);   // the thud
    strike(out, sr, R, .0005, R.range(.0011, .0014), [[fk, R.range(.02, .026), 1], [fk * R.range(1.6, 1.8), .012, .45]], R.range(.55, .7));   // the ribs
    puff(out, sr, R, .0012, {a: .0012, d: R.range(.011, .015), lp: R.range(420, 560), hp: 60, amp: .55});
    return out;
  },
  whiff(R, sr) {
    const out = buf(.18, sr), dur = R.range(.085, .13);
    whoosh(out, sr, R, 0, {dur, f0: R.range(450, 600), f1: R.range(1100, 1500), f2: R.range(650, 850), pk: R.range(.2, .3), p: 1.6, q: R.range(.9, 1.2), grain: .4, top: 2800});
    whoosh(out, sr, R, .004, {dur: dur * R.range(.85, 1), f0: 240, f1: R.range(460, 560), f2: 320, pk: .35, p: 1.6, q: .7, grain: .6, amp: R.range(.35, .5), top: 1400});   // the sleeve
    return out;
  },
  swing(R, sr) {
    const out = buf(.32, sr), dur = R.range(.2, .27);
    whoosh(out, sr, R, 0, {dur, f0: R.range(280, 360), f1: R.range(850, 1150), f2: R.range(420, 560), pk: R.range(.5, .6), p: 1.8, q: R.range(.8, 1), grain: .55, top: 2400});
    whoosh(out, sr, R, .02, {dur: dur * R.range(.85, .95), f0: 200, f1: R.range(380, 460), f2: 260, pk: .55, p: 1.6, q: .7, grain: .7, amp: R.range(.4, .55), top: 1200});   // the sleeve flapping
    return out;
  },
  slip(R, sr) {
    const out = buf(.38, sr), dur = R.range(.19, .27), t2 = dur * R.range(.55, .7);
    whoosh(out, sr, R, 0, {dur, f0: R.range(230, 310), f1: R.range(580, 780), f2: R.range(290, 390), pk: R.range(.3, .5), p: 1.5, q: R.range(.7, .9), grain: .6, top: 2000});
    if (R() < .8) whoosh(out, sr, R, t2, {dur: R.range(.1, .14), f0: 300, f1: R.range(500, 600), f2: 320, pk: .4, p: 1.6, q: .8, grain: .6, amp: R.range(.38, .5), top: 1800});   // back up
    return out;
  },
  ready(R, sr) {
    const out = buf(.14, sr), T = R.range(.035, .055);
    creak(out, sr, R, 0, T, {r0: R.range(110, 150), r1: R.range(60, 80), amp: 1, tilt: .6});                                               // the glove's leather
    strike(out, sr, R, T * R.range(.7, .9), R.range(.0022, .003), [[R.range(170, 220), R.range(.018, .024), 1], [R.range(380, 450), .01, .4]], R.range(.4, .5));   // the fist closed
    return out;
  },
  windup(R, sr) {
    const out = buf(.52, sr), dur = R.range(.24, .36);
    whoosh(out, sr, R, 0, {dur, f0: R.range(220, 280), f1: R.range(520, 650), f2: R.range(560, 700), pk: R.range(.75, .85), p: 1.3, q: .75, grain: .6, top: 1800, amp: .9});   // the arm drawn back
    creak(out, sr, R, dur * R.range(.35, .55), dur + R.range(.04, .1), {r0: R.range(22, 38), r1: R.range(45, 75), amp: R.range(.6, .85)});                 // the jacket's leather taking the strain
    return out;
  },
  grab(R, sr) {
    const out = buf(.26, sr), t2 = R.range(.006, .018);
    whoosh(out, sr, R, 0, {dur: R.range(.08, .11), f0: 300, f1: R.range(600, 700), f2: 380, pk: .3, p: 1.5, q: .8, grain: .6, amp: .5, top: 1800});   // the shirt pulled
    puff(out, sr, R, 0, {a: .0001, d: R.range(.003, .005), color: 'white', bp: R.range(1000, 1400), q: .9, lp: 3200, amp: .7});            // a hand
    puff(out, sr, R, t2, {a: .0001, d: R.range(.003, .005), color: 'white', bp: R.range(1000, 1400), q: .9, lp: 3200, amp: .7 * R.range(.6, .85)});   // the other
    grains(out, sr, R, .002, R.range(.035, .045), R.int(8, 14), {f: [900, 2200], amp: .25});                                                 // the cloth crumpling
    strike(out, sr, R, R.range(.012, .025), R.range(.004, .005), [[R.range(130, 170), R.range(.035, .045), 1], [R.range(300, 390), .018, .4]], R.range(.55, .7));   // chest meets chest
    return out;
  },
};
// the air / cloth cases (rolled off above ~2.5 kHz already: a gentle tilt and a 110 Hz high-pass, like recipes/cloth.js)
const SOFT = new Set(['whiff', 'swing', 'slip', 'windup']);
// the loudest 20 ms's level before the glue (lower = the transients squashed less: the cracks of the hard blows stay sharp)
const LEVEL = {jab: .25, cross: .25, block: .25, hook: .22, body: .22, upper: .2, heavy: .2, head: .2, kick: .2, ready: .2, grab: .2};
// the peak (dB) over the blow's rms in a 400 ms window (the forge's loudness window) past which the limiter takes an outlier's
// transient down: each case's median (the rest of the variants' spread is their spectrum under the K-weighting)
const LIM = {jab: 24.3, cross: 22.5, hook: 21.5, upper: 20.8, heavy: 20.3, body: 19.4, block: 23.2, head: 22.7, kick: 20.8, ready: 21.4, grab: 19};
// saturation (tanh glue): the heavier, the more
const DRIVE = {jab: 1.55, cross: 1.5, hook: 1.5, upper: 1.55, heavy: 1.8, body: 1.6, block: 1.55, head: 1.5, kick: 1.6, ready: 1.3, grab: 1.2};
const KINDS = Object.keys(CASES);

export default {
  id: 'punch', version: 1,
  desc: 'Bare-knuckle fighting: jab / cross / hook / upper / heavy / body / block / headbutt / kick hits, whiff and swing whooshes, slip, the counter\'s ready creak, the windup, the clinch grab',
  params: {kind: {values: KINDS, def: 'jab'}},
  cases: Object.fromEntries(KINDS.map(k => [k, {kind: k}])),
  variants: 6,
  render(p, R, sr) {
    const k = CASES[p.kind] ? p.kind : 'jab', out = CASES[k](R, sr);
    if (SOFT.has(k)) { filter(out, 'highpass', 110, .7071, sr); warm(out, sr, {shelf: -6, fs: 3500}); return saturate(norm(out, .9), DRIVE[k] ?? 1.2); }
    // the impacts: levelled, glued (tanh), THEN the warm tilt and the low-pass (they take the glue's added highs too)
    saturate(level(out, sr, LEVEL[k] ?? .22), DRIVE[k] ?? 1.2);
    warm(out, sr, {shelf: -8, fs: 4000, lp: 8000}); filter(out, 'highpass', 45, .7071, sr);
    let e = 0; for (let i = 0; i < out.length; i++) e += out[i] * out[i];
    return norm(limit(out, sr, Math.pow(10, (LIM[k] ?? 30) / 20) * Math.sqrt(e / (.4 * sr))), .9);
  },
  // pass ranges from the forge's metrics over 105 seeds (1-24, the lab's 44291-44296, 100-160, 14 large ones) with margin. Its STFT
  // starts a Hann window at sample 0, so a short blow's centroid / highHz / hf4kDb mostly weigh the tail; zero-padded, the
  // centroids run jab 640-1210 Hz > cross 380-640 > hook 270-520 > upper 230-440 > heavy 200-475; body 165-280, block
  // 245-395, head 205-300. The t60 caps are the ring guard (the longest octave band's t60: 140 ms on the heavy, 200 on the gut)
  criteria: {
    jab: {attackMs: [0, 6], t60Ms: [10, 55], centroidHz: [160, 1060], lowHz: [5, 65], highHz: [500, 3400], flatness: [0, 0.005], hf4kDb: [-34, -17], durMs: [40, 100], onsetCount: [0, 1], clickEnd: [0, .01]},
    cross: {attackMs: [0, 8.5], t60Ms: [15, 75], centroidHz: [100, 580], lowHz: [5, 120], highHz: [140, 2620], flatness: [0, 0.005], hf4kDb: [-41, -22], durMs: [50, 125], onsetCount: [0, 1], clickEnd: [0, .01]},
    hook: {attackMs: [0, 9.5], t60Ms: [25, 90], centroidHz: [70, 330], lowHz: [25, 120], highHz: [60, 1860], flatness: [0, 0.005], hf4kDb: [-47, -26], durMs: [75, 150], onsetCount: [0, 1], clickEnd: [0, .01]},
    upper: {attackMs: [0, 12], t60Ms: [25, 95], centroidHz: [50, 180], lowHz: [25, 95], highHz: [40, 510], flatness: [0, 0.005], hf4kDb: [-55, -32], durMs: [75, 145], onsetCount: [0, 1], clickEnd: [0, .01]},
    heavy: {attackMs: [0, 20.5], t60Ms: [25, 155], centroidHz: [50, 340], lowHz: [5, 95], highHz: [40, 1730], flatness: [0, 0.005], hf4kDb: [-52, -27], durMs: [105, 205], onsetCount: [0, 1], clickEnd: [0, .01]},
    body: {attackMs: [0, 26.5], t60Ms: [50, 170], centroidHz: [60, 250], lowHz: [5, 95], highHz: [160, 890], flatness: [0, 0.005], hf4kDb: [-69, -50], durMs: [145, 285], onsetCount: [0, 1], clickEnd: [0, .01]},
    block: {attackMs: [0, 5], t60Ms: [15, 85], centroidHz: [110, 490], lowHz: [5, 145], highHz: [280, 1460], flatness: [0, 0.005], hf4kDb: [-62, -39], durMs: [50, 125], onsetCount: [0, 1], clickEnd: [0, .01]},
    head: {attackMs: [0, 8.5], t60Ms: [20, 95], centroidHz: [70, 220], lowHz: [5, 95], highHz: [100, 620], flatness: [0, 0.005], hf4kDb: [-66, -48], durMs: [65, 150], onsetCount: [0, 1], clickEnd: [0, .01]},
    kick: {attackMs: [0, 18], t60Ms: [25, 110], centroidHz: [70, 460], lowHz: [5, 95], highHz: [80, 2400], flatness: [0, 0.005], hf4kDb: [-48, -27], durMs: [90, 185], onsetCount: [0, 1], clickEnd: [0, .01]},
    whiff: {attackMs: [7, 59], t60Ms: [55, 200], centroidHz: [610, 1370], lowHz: [125, 445], highHz: [1260, 2530], flatness: [0, 0.005], hf4kDb: [-50, -29], durMs: [85, 180], onsetCount: [0, 2], clickEnd: [0, .01]},
    swing: {attackMs: [29, 150], t60Ms: [105, 305], centroidHz: [480, 1090], lowHz: [125, 335], highHz: [980, 2130], flatness: [0, 0.005], hf4kDb: [-58, -35], durMs: [190, 335], onsetCount: [0, 3], clickEnd: [0, .01]},
    slip: {attackMs: [16.5, 167], t60Ms: [135, 470], centroidHz: [390, 780], lowHz: [125, 310], highHz: [700, 1480], flatness: [0, 0.005], hf4kDb: [-69, -48], durMs: [185, 380], onsetCount: [0, 4], clickEnd: [0, .01]},
    ready: {attackMs: [4.5, 59], t60Ms: [15, 80], centroidHz: [170, 490], lowHz: [25, 145], highHz: [480, 1400], flatness: [0, 0.005], hf4kDb: [-64, -42], durMs: [65, 130], onsetCount: [0, 2], clickEnd: [0, .01]},
    windup: {attackMs: [72.5, 311], t60Ms: [160, 675], centroidHz: [360, 680], lowHz: [105, 255], highHz: [680, 1290], flatness: [0, 0.005], hf4kDb: [-65, -51], durMs: [275, 545], onsetCount: [0, 6], clickEnd: [0, .01]},
    grab: {attackMs: [0, 39.5], t60Ms: [55, 205], centroidHz: [220, 640], lowHz: [45, 120], highHz: [640, 1750], flatness: [0, 0.005], hf4kDb: [-52, -31], durMs: [80, 170], onsetCount: [0, 2], clickEnd: [0, .01]},
  },
  notes: 'Foley-style punch layers: band-passed slap + damped modal knock / thump (half-sine contacts) + low-passed mass; swept-band cloth whooshes (cf. cloth.js); stick-slip leather creak (cf. bow_draw.js)',
};
