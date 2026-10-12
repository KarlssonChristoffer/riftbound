// WOODCUT: a cowboy felling oaks with an axe (docs/GATHERING.md: features/woodcut.js tree.chop / tree.fell / tree.land /
// tree.logs / tool.whiff, features/pack.js pack.add (a log), features/campfires.js + lights.js fire.addWood; the events:
// audio/runtime/events.js chop / treeCrack / treeCrash / treeLogs / logPick / axeSwing / campLog).
// The user's taste (RECIPE_GUIDE): solid wood is a dense, heavily damped THOCK (never a box, a marimba or a hollow log), every
// layer decays naturally, highs only as short transients and sparse grains, no hiss bed; mid-distance, a warm game mix (the
// impacts glued, then a warm tilt -8 dB above 4 kHz and an 8 kHz low-pass; the textures rolled off at 24 dB/oct).
// The parts, on one timeline per case:
//   edge     the steel edge meeting the bark: a very short white click (0.5-0.9 ms) and the axe head's own few modes, damped
//            hard by the wood they sit in (t60 <= 12 ms): crisp, never a ting
//   thock    the trunk: a SOLID green oak (wet, massive, rooted): a damped bending family + a dense scatter of lossy modes,
//            every t60 = t0 (f0 / f)^.75 (the fundamental <= ~60 ms, q ~4): the weight is in the modes' density, not a tone
//   mass     the trunk's low thump under a softer contact (80-125 Hz, t60 50-85 ms) and a brown 'chunk' of the blade's energy
//   bite     crushed fibres as the edge sinks in: micro-snaps over 6-20 ms (900-1900 Hz): what makes it a CHOP, not a knock
//   chips    a chip tearing off as the edge wrenches free (a short fibre tear 15-70 ms after) and, faintly, one landing
//   tear     a hinge's fibres failing: a click train (dense, then thinning) band-coloured over a fibre-rubbing bed, ringing the
//            trunk's modes (cf. crate_break.js 'splinter', the break the user loved, but lower and bigger)
//   groan    the trunk under strain: stick-slip slips (15-45 Hz, jittered) through low wood formants (q 2.5-4, t60 <= 30 ms),
//            low-passed: a rough groan, never a tonal whale
//   field    thousands of tiny grains (leaves, coals) summed into one buffer and filtered once: a texture made of events
// The cases:
//   chop       THE chop: edge + thock + mass + bite + a chip crackle (~0.25 s); per seed: the bite's depth, the chips
//   chop_deep  the last, deepest bites: the same, deeper and lower, then the trunk starting to give (a short groan + crackles)
//   glance     the edge skidding off wood too hard for it: a duller, smaller knock, a short scraping skid, a faint steel tick
//   crack      the hinge splitting as it starts to fall: a series of fibrous cracks accelerating over ~0.8-1.2 s over the
//              trunk's groan, ending in the big tear as it tips
//   crash      the crown and trunk landing: the trunk's deep thud on the earth (and its rebound), limbs and twigs snapping, a
//              broad rustle of leaves crashing and settling (dense tiny grains over a DARK body), decaying over ~2 s
//   logs       the trunk broken into logs: 3-4 solid, dull knocks on earth, staggered 60-200 ms, a little bark scrape
//   pickup     a log into the pouch: a light, dry clack of two pieces of firewood and a soft leather / cloth rustle
//   swing      the axe through the air: a deeper, darker whoosh than the fists' (~0.25 s), peaking late (~70 %)
//   campfire   a log tossed on a fire: a soft wooden thump on the embers, then the flare's crackle burst over a warm body
import {add, scale, peak, filter, sweep, halfSine, modal, pink, white, brown, saturate, warm, t60FromQ} from '../dsp.js';

const PI = Math.PI, lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const TAIL = 9.2;   // time constants to -80 dB
const buf = (sec, sr) => new Float32Array(Math.round(sec * sr));

// ============================================================================================ helpers (kernel candidates)
// attack a, 1/e decay d (s): (1 - e^-t/a) e^-t/d, by running products (no corners anywhere)
const ad = (b, sr, a, d) => {
  const ka = Math.exp(-1 / (a * sr)), kd = Math.exp(-1 / (d * sr)); let ea = 1, ed = 1;
  for (let i = 0; i < b.length; i++) { b[i] *= (1 - ea) * ed; ea *= ka; ed *= kd; }
  return b;
};
const noiseOf = (color, n, R) => (color === 'white' ? white(n, R) : color === 'brown' ? brown(n, R) : pink(n, R));
// a contact of duration tc (a half-sine roughened ±25%) into damped modes [[f, t60, a], ...], added at `at` s with peak amp; the
// buffer runs to ~-96 dB of the longest mode (cf. punch.js)
function strike(out, sr, R, at, tc, modes, amp) {
  const i0 = Math.round(at * sr); if (i0 >= out.length || !(amp > 0)) return;
  let T = 0; for (const m of modes) T = Math.max(T, m[1]);
  const exc = halfSine(tc * R.jit(.12), sr), n = Math.min(out.length - i0, Math.round((T * 1.6 + tc + .01) * sr));
  for (let i = 0; i < exc.length; i++) exc[i] *= 1 + .25 * (R() * 2 - 1);
  add(out, norm(modal(exc, modes.map(([f, t60, a]) => ({f, t60, a})), sr, n), amp), i0);
}
// a noise burst: colour, attack a, 1/e decay d, then band-pass (bp, q), low-pass (2 x 2nd order), high-pass; added at `at` s,
// sized to -80 dB, scaled by its ENERGY (amp ~ the peak of a typical short burst), not its peak (cf. punch.js)
function puff(out, sr, R, at, {a = .0005, d = .01, color = 'pink', bp = 0, q = .8, lp = 0, hp = 0, amp = 1} = {}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round((d * TAIL + a * 4 + .004) * sr)); if (n <= 0 || !(amp > 0)) return;
  const b = ad(noiseOf(color, n, R), sr, a, d);
  if (bp) filter(b, 'bandpass', bp, q, sr);
  if (lp) { filter(b, 'lowpass', lp, .7, sr); filter(b, 'lowpass', lp * 1.4, .7, sr); }
  if (hp) filter(b, 'highpass', hp, .7, sr);
  let e = 0; for (let i = 0; i < n; i++) e += b[i] * b[i];
  if (e > 0) add(out, scale(b, amp / (2.2 * Math.sqrt(2 * e / ((d + a) * sr)))), i0);
}
// k brittle micro-snaps (crushed / torn fibres) over [t0, t0 + len] s, denser early (u^shape), peaky amplitudes falling over the
// span: 0.1-0.5 ms noise grains in one sparse buffer, then ONE band-pass (f, q) + a low-pass: a crunch, cheap. Peak amp
function snaps(out, sr, R, t0, len, k, {f = 1400, q = 1.1, lp = 3200, amp = 1, g = [.0001, .0005], shape = 1.8} = {}) {
  const gmax = Math.round(g[1] * TAIL * sr) + 2, n = Math.round(len * sr) + gmax + Math.round(.004 * sr), b = new Float32Array(n);
  for (let j = 0; j < k; j++) {
    const u = Math.pow(R(), shape), i = Math.round(u * len * sr), kd = Math.exp(-1 / (R.range(g[0], g[1]) * sr)); let a = R.pow(.15, 1, 1.6) * (1 - .6 * u);
    for (let m = 0; m < gmax; m++, a *= kd) b[i + m] += a * (R() * 2 - 1);
  }
  filter(b, 'bandpass', f, q, sr); if (lp) filter(b, 'lowpass', lp, .7, sr);
  add(out, norm(b, amp), Math.round(t0 * sr));
}
// a FIELD of tiny grains (leaves brushing and ticking, coals settling, sparks): Poisson grains at rate(t) /s (t from t0; thinned
// from rmax) over [t0, t1], each a short noise grain (1/e g s) with a power-law amplitude times env(t), summed into one buffer,
// then ONE band-pass (fc, q), a 24 dB/oct low-pass at lp and an optional high-pass: thousands of grains for three filter passes.
// rate / env are plain functions of time (no draws inside); the rate thins out to none over the span's last 30 % (a texture
// never just stops). Each grain reads its noise from a random place in one shared table (a grain is too short to repeat). Added
// at t0 with peak amp
function field(out, sr, R, t0, t1, rate, rmax, {g = [.0002, .0007], fc = 1600, q = .9, lp = 3200, hp = 0, amp = 1, alpha = 1.8, env = () => 1} = {}) {
  const gmax = Math.round(g[1] * TAIL * sr) + 2, span = t1 - t0, n = Math.round(span * sr) + gmax + Math.round(.01 * sr), b = new Float32Array(n);
  const fin = t => { const u = t / span; return u < .7 ? 1 : .5 + .5 * Math.cos(PI * (u - .7) / .3); };
  const NZ = 16384, nz = white(NZ + gmax, R);
  for (let t = R.exp(1 / rmax); t < span; t += R.exp(1 / rmax)) {
    if (R() * rmax >= rate(t) * fin(t)) continue;
    const i = Math.round(t * sr), d = R.range(g[0], g[1]) * sr, kd = Math.exp(-1 / d), len = Math.min(gmax, Math.ceil(d * TAIL)), o = Math.floor(R() * NZ);
    let a = R.pow(.05, 1, alpha) * env(t);
    for (let m = 0; m < len; m++, a *= kd) b[i + m] += a * nz[o + m];
  }
  if (fc) filter(b, 'bandpass', fc, q, sr);
  if (lp) { filter(b, 'lowpass', lp, .5412, sr); filter(b, 'lowpass', lp, 1.3066, sr); }
  if (hp) filter(b, 'highpass', hp, .7, sr);
  add(out, norm(b, amp), Math.round(t0 * sr));
}
// the modes of a SOLID trunk / log (a dense, heavy, wet cylinder: nothing rings): a damped bending family (free-free beam ratios;
// the fundamental the most damped, by the roots or the ground: x .65) weighted by the strike position, plus a dense scatter of
// lossy modes falling with f (the 'woody' grain). Every t60 = t0 (f0 / f)^.75, never under 5 ms; nothing above `top`
const BEAM = [1, 2.756, 5.404, 8.933, 13.345, 18.638];
function trunkModes(f0, R, {t0 = .07, dense = 16, top = 6000, x = R.range(.1, .45), spread = 16} = {}) {
  const m = [];
  BEAM.forEach((r, i) => {
    const f = f0 * r * R.jit(.03); if (f > top) return;
    m.push([f, Math.max(.005, (i ? t0 : t0 * .65) * Math.pow(f0 / f, .75)), (i ? 1.1 / (1 + .35 * i) : .8) * Math.max(.3, Math.abs(Math.sin((i + 1) * PI * x))) * R.jit(.2)]);
  });
  for (let k = 0; k < dense; k++) { const r = R.range(1.5, spread), f = f0 * r; if (f < top) m.push([f, Math.max(.005, t0 * .7 * Math.pow(f0 / f, .75) * R.range(.7, 1.2)), R.range(.3, .6) / Math.sqrt(r)]); }
  return m;
}
// the axe head's own modes (a steel wedge, ~1.5 kg): a few inharmonic modes 1.9-4 kHz, damped hard by the wood it sits in or
// skids on (t60 ms: a click with a colour, never a ting)
const steel = (R, f, t60) => [[f, t60, 1], [f * R.range(1.42, 1.58), t60 * .75, .55], [f * R.range(2.2, 2.6), t60 * .5, .3]];
// a fibre TEAR (a hinge splitting, a limb snapping): micro-snaps dMin..dMax s apart (the gaps growing by 1 + thin u: dense, then
// thinning; amplitudes falling (1 - u)^shape), band-coloured (fc, q) over a quieter fibre-rubbing bed under the same envelope,
// and `modes` (the wood's own) rung by the same clicks. Added at t0 s with peak amp (cf. crate_break.js tear)
function tear(out, sr, R, t0, len, {fc, q = 1.4, dMin = .0006, dMax = .003, thin = 3, shape = 1.4, bed = .3, modes = null, ring = .4, amp = 1, lp = 3600}) {
  const gmax = Math.round(.0008 * TAIL * sr), n = Math.round(len * sr) + gmax + Math.round(.01 * sr), tr = new Float32Array(n);
  for (let t = R.range(0, dMin); t < len; t += R.range(dMin, dMax) * (1 + thin * (t / len))) {
    const i = Math.round(t * sr), kd = Math.exp(-1 / (R.range(.0002, .0008) * sr)); let a = Math.pow(1 - t / len, shape) * R.pow(.15, 1, 1.6);
    for (let k = 0; k < gmax; k++, a *= kd) tr[i + k] += a * (R() * 2 - 1);
  }
  const i0 = Math.round(t0 * sr), col = tr.slice();
  filter(col, 'bandpass', fc, q, sr); filter(col, 'highpass', 300, .7, sr); filter(col, 'lowpass', lp, .7, sr);
  add(out, norm(col, amp), i0);
  if (bed > 0) {
    const bn = n + Math.round(.03 * sr), b = pink(bn, R), nr = Math.round(len * sr);
    for (let i = 0; i < bn; i++) { const u = i / nr; b[i] *= u < 1 ? Math.pow(1 - u, 1.8) * Math.min(1, i / (.002 * sr)) : 0; }
    filter(b, 'bandpass', fc * R.range(.6, .85), .7, sr); filter(b, 'lowpass', lp * .8, .7, sr);
    add(out, norm(b, amp * bed), i0);
  }
  if (modes && ring > 0) {
    let T = 0; for (const m of modes) T = Math.max(T, m[1]);
    add(out, norm(modal(tr, modes.map(([f, t60, a]) => ({f, t60, a})), sr, n + Math.round(T * 1.6 * sr)), amp * ring), i0);
  }
}
// wood (or leather) under strain: stick-slip, one slip per impulse, the rate r0 -> r1 Hz over [t0, t1] (±jit), each slip ringing
// damped formants [[f, q, a], ...] (t60 capped: a creak, never a tone) with a little friction noise; the level follows
// swell(u) (u 0..1 over the span). Added with peak-ish amp (cf. punch.js creak)
function creak(out, sr, R, t0, t1, {r0, r1, formants, amp = 1, jit = .25, cap = .03, swell = u => Math.sin(PI * Math.min(1, u)), noise = .25, nbp = 900}) {
  for (let t = t0 + R.range(0, .003); t < t1;) {
    const u = (t - t0) / (t1 - t0), s = R.pow(.35, 1, 1.4) * (.15 + .85 * swell(u));
    const modes = formants.map(([f, q, a]) => { const ff = f * R.jit(.08); return [ff, Math.min(cap, t60FromQ(q * R.range(.8, 1.2), ff)), a * R.range(.6, 1.3)]; });
    strike(out, sr, R, t, R.range(.0008, .0016), modes, amp * s);
    if (noise) puff(out, sr, R, t, {a: .0003, d: R.range(.0015, .003), bp: nbp * R.jit(.2), q: .9, lp: nbp * 2.2, amp: amp * s * noise});
    t += 1 / (lerp(r0, r1, u) * R.jit(jit));
  }
}
// air moved by a blade / an arm / a body: pink noise through a band-pass whose centre goes f0 -> f1 (at pk of dur) -> f2, under
// a skewed bell (peak at pk), with a coarse grain (a low-passed random modulator: never a clean hiss), rolled off at 24 dB/oct
// above ~2.2x the centre (never above `top`); the filters follow the sweep every `every` samples. Added at `at` s with peak amp
// (cf. punch.js whoosh)
function bell(u, pk, p) { if (u <= 0 || u >= 1) return 0; const v = u < pk ? .5 * u / pk : .5 + .5 * (u - pk) / (1 - pk); return Math.pow(Math.sin(PI * v), p); }
function whoosh(out, sr, R, at, {dur, f0, f1, f2, pk = .4, p = 2, q = .8, grain = .5, gHz = [90, 220], amp = 1, top = 2600, every = 24}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round((dur + .02) * sr)); if (n <= 8) return;
  const fAt = t => { const u = Math.min(1, t / dur); return u < pk ? lerp(f0, f1, Math.sin(PI / 2 * u / pk)) : lerp(f1, f2, (u - pk) / (1 - pk)); };
  const x = sweep(pink(n, R), 'bandpass', fAt, q, sr, {every});
  for (let k = 0; k < 2; k++) sweep(x, 'lowpass', t => Math.min(top, fAt(t) * 2.2), .7, sr, {every: every * 2});
  const g = filter(white(n, R), 'lowpass', R.range(gHz[0], gHz[1]), .7, sr); let gr = 0; for (const v of g) gr += v * v; gr = Math.sqrt(gr / n) || 1;
  for (let i = 0; i < n; i++) x[i] *= bell(i / sr / dur, pk, p) * Math.max(.05, 1 + grain * .6 * g[i] / gr);
  add(out, norm(x, amp), i0);
}
// a SCRAPE (an edge skidding over bark, a log's bark on another): stick-slip grains at r0 -> r1 Hz (±30 %) over dur s, each a tiny
// band-passed noise grain (f0 -> f1 Hz: the skid slowing goes duller), amplitudes under (1 - u)^1.5 after a 3 ms rise, over a
// faint band of friction noise under the same envelope. Added at `at` s with peak amp
function scrape(out, sr, R, at, dur, {r0, r1, f0, f1, amp = 1, bed = .35, q = 1.1}) {
  const n = Math.round((dur + .03) * sr), b = new Float32Array(n), gm = Math.round(.0012 * TAIL * sr);
  const envAt = u => (u >= 1 ? 0 : Math.min(1, u * dur / .003) * Math.pow(1 - u, 1.5));
  for (let t = R.range(0, .002); t < dur;) {
    const u = t / dur, i = Math.round(t * sr), kd = Math.exp(-1 / (R.range(.0003, .0012) * sr)); let a = envAt(u) * R.pow(.3, 1, 1.4);
    for (let k = 0; k < gm && i + k < n; k++, a *= kd) b[i + k] += a * (R() * 2 - 1);
    t += 1 / (lerp(r0, r1, u) * R.jit(.3));
  }
  const fAt = t => lerp(f0, f1, Math.min(1, t / dur));
  sweep(b, 'bandpass', fAt, q, sr, {every: 32});
  if (bed > 0) {
    const nb = pink(n, R); for (let i = 0; i < n; i++) nb[i] *= envAt(i / sr / dur);
    sweep(nb, 'bandpass', fAt, .8, sr, {every: 32}); add(b, norm(nb, peak(b) * bed));
  }
  filter(b, 'lowpass', Math.max(f0, f1) * 1.8, .7, sr);
  add(out, norm(b, amp), Math.round(at * sr));
}
// a consistent crest: the loudest 20 ms brought to one level before the tanh glue rounds the peaks (cf. punch.js)
function level(b, sr, rms) {
  const w = Math.round(.02 * sr), c = new Float64Array(b.length + 1); let best = 0;
  for (let i = 0; i < b.length; i++) c[i + 1] = c[i] + b[i] * b[i];
  for (let i = w; i <= b.length; i += 64) best = Math.max(best, (c[i] - c[i - w]) / w);
  return best > 0 ? scale(b, rms / Math.sqrt(best)) : b;
}
// a transparent peak limiter: the gain follows min(1, thr / the peak of the next 1 ms), 0.25 ms attack, 2 ms release (cf. punch.js)
function limit(b, sr, thr) {
  const la = Math.round(.001 * sr), ka = 1 - Math.exp(-1 / (.00025 * sr)), kr = 1 - Math.exp(-1 / (.002 * sr)), n = b.length, need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = Math.abs(b[i]); if (v > thr) { const g = thr / v; for (let j = Math.max(0, i - la); j <= i; j++) if (!need[j] || g < need[j]) need[j] = g; } }
  let g = 1;
  for (let i = 0; i < n; i++) { const t = need[i] || 1; g += (t - g) * (t < g ? ka : kr); b[i] *= Math.min(g, t); }
  return b;
}

// ============================================================================================ the parts
// a CHOP: the edge, the thock, the mass, the bite, the chips. bite 0..1 (how deep the edge sinks: a longer, duller contact, more
// crunch, a heavier thump), chips 0..1, f0 the trunk (lower = thicker), at (s)
function chopAt(out, sr, R, at, {bite, chips, f0, amp = 1}) {
  const fa = R.range(1900, 2600), fB = R.range(82, 118) * lerp(1.08, .92, bite), tc = lerp(.0007, .0012, bite) * R.jit(.1), fk = R.range(340, 470) * lerp(1.06, .9, bite);
  puff(out, sr, R, at, {a: .00005, d: R.range(.0005, .0008), color: 'white', bp: R.range(2200, 3200), q: .9, lp: 5200, amp: amp * R.range(.5, .65)});   // the edge
  strike(out, sr, R, at, R.range(.00012, .0002), steel(R, fa, R.range(.006, .011)), amp * R.range(.1, .17));                                              // the head
  strike(out, sr, R, at + .0002, tc, trunkModes(f0, R, {t0: R.range(.08, .105), dense: 18, top: 5000}), amp);                                          // the thock
  // the TOCK: the wedge in the wood, a few damped modes 340-470 Hz (t60 18-30 ms, q ~4: a knock, never a note)
  strike(out, sr, R, at + .0003, tc * R.range(.75, .9), [[fk, R.range(.018, .03), 1], [fk * R.range(1.55, 1.75), .013, .55], [fk * R.range(2.4, 2.8), .008, .3], [fk * R.range(.55, .62), .03, .35]], amp * R.range(.6, .75));
  strike(out, sr, R, at + .0004, R.range(.003, .0045), [[fB, R.range(.045, .07), 1], [fB * R.range(2.1, 2.4), .028, .35], [fB * R.range(3.4, 3.9), .016, .15]], amp * lerp(.3, .46, bite) * R.jit(.08));   // the mass
  puff(out, sr, R, at, {a: .0003, d: R.range(.004, .007), color: 'brown', bp: R.range(450, 800), q: .7, lp: 1800, amp: amp * R.range(.35, .5)});        // the chunk
  snaps(out, sr, R, at + .0004, lerp(.006, .02, bite) * R.jit(.15), Math.round(lerp(8, 22, bite) * R.jit(.2)), {f: R.range(900, 1700), q: 1.1, lp: 3000, amp: amp * lerp(.28, .42, bite) * R.jit(.1)});   // the bite
  if (chips > .15) tear(out, sr, R, at + R.range(.014, .03), R.range(.02, .045) * lerp(.7, 1.2, chips), {fc: R.range(1100, 1900), q: 1.3, dMin: .001, dMax: .005, thin: 2, bed: .2, amp: amp * lerp(.06, .16, chips), lp: 3200});   // a chip tearing off
  for (let k = chips > .55 ? R.int(1, 2) : 0; k > 0; k--) strike(out, sr, R, at + R.range(.1, .22), R.range(.0003, .0006), trunkModes(R.range(1100, 1700), R, {t0: .012, dense: 3, top: 6000}), amp * R.range(.01, .02));   // one landing, faint
}

// ============================================================================================ the cases
const CASES = {
  chop(R, sr) {
    const out = buf(.42, sr);
    chopAt(out, sr, R, 0, {bite: R.range(.25, .85), chips: R(), f0: R.range(175, 235)});
    return out;
  },
  chop_deep(R, sr) {
    const out = buf(.62, sr), bite = R.range(.8, 1), f0 = R.range(150, 195), t1 = R.range(.26, .38);
    chopAt(out, sr, R, 0, {bite, chips: R.range(.4, 1), f0});
    const tm = trunkModes(f0 * R.range(.55, .7), R, {t0: .06, dense: 10, top: 3000});
    // the trunk starting to give: a short groan through its low formants, and fibres crackling under it
    creak(out, sr, R, R.range(.035, .06), t1, {r0: R.range(18, 26), r1: R.range(34, 48), amp: R.range(.12, .17), cap: .028, noise: .2, nbp: 600,
      formants: [[R.range(85, 110), 2.6, .5], [R.range(160, 200), 3, .9], [R.range(270, 330), 3.4, 1], [R.range(430, 520), 3.8, .6], [R.range(680, 800), 4, .3]],
      swell: u => Math.sin(PI * Math.pow(Math.min(1, u), .7))});
    for (let k = R.int(2, 4), t = R.range(.05, .09); k > 0 && t < t1; k--, t += R.range(.04, .1))
      tear(out, sr, R, t, R.range(.015, .04), {fc: R.range(900, 1700), q: 1.3, dMin: .0008, dMax: .004, thin: 2.5, bed: .25, modes: tm, ring: .5, amp: R.range(.06, .13), lp: 3000});
    return out;
  },
  glance(R, sr) {
    const out = buf(.36, sr), f0 = R.range(250, 340), skid = R.range(.06, .11);
    puff(out, sr, R, 0, {a: .00005, d: R.range(.0004, .0007), color: 'white', bp: R.range(2000, 2800), q: .9, lp: 4800, amp: R.range(.3, .4)});           // the edge on the bark
    strike(out, sr, R, .0002, R.range(.0014, .002), trunkModes(f0, R, {t0: R.range(.035, .05), dense: 12, top: 4000}), .8);                             // a duller knock (no bite)
    strike(out, sr, R, .0004, R.range(.003, .004), [[R.range(100, 130), R.range(.03, .045), 1], [R.range(230, 280), .018, .35]], R.range(.3, .38));      // the trunk barely moves
    scrape(out, sr, R, R.range(.002, .006), skid, {r0: R.range(280, 420), r1: R.range(110, 170), f0: R.range(1100, 1600), f1: R.range(600, 850), amp: R.range(.18, .26), bed: .3});   // the skid
    strike(out, sr, R, R.range(.0005, .002), R.range(.00015, .00025), steel(R, R.range(2300, 3200), R.range(.025, .045)), R.range(.05, .08));            // a faint steel tick
    snaps(out, sr, R, .001, R.range(.01, .02), R.int(4, 8), {f: R.range(1200, 2000), q: 1.2, lp: 3200, amp: R.range(.08, .14)});                         // bark grit
    return out;
  },
  crack(R, sr) {
    const out = buf(1.9, sr), T = R.range(.8, 1.15), n = R.int(7, 11), f0 = R.range(85, 150), tm = trunkModes(f0, R, {t0: .085, dense: 14, top: 3500});
    // the groan: the hinge's fibres slipping faster as it gives, the level swelling to the tip, then gone
    creak(out, sr, R, R.range(.02, .06), T + R.range(.05, .12), {r0: R.range(13, 18), r1: R.range(34, 46), amp: R.range(.3, .4), cap: .03, noise: .15, nbp: 500,
      formants: [[R.range(75, 95), 2.5, .6], [R.range(140, 175), 2.8, 1], [R.range(240, 290), 3.2, .9], [R.range(380, 450), 3.6, .55], [R.range(600, 700), 4, .25]],
      swell: u => (.35 + .65 * Math.pow(Math.min(1, u), .8)) * (u < .9 ? 1 : Math.max(0, .5 + .5 * Math.cos(PI * (u - .9) / .1)))});
    // the cracks, accelerating (t ~ u^.55) and growing; a fine crackle of single fibres runs between them, thickening
    const p = R.range(.5, .62);
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1), t = .04 + (T - .04) * Math.pow(u, p) + (k && k < n - 1 ? R.range(-.012, .012) : 0), last = k === n - 1;
      const g = last ? R.range(.95, 1.05) : (.28 + .55 * Math.pow(u, 1.3)) * R.range(.75, 1.15);
      puff(out, sr, R, t, {a: .0001, d: R.range(.002, .005) * (last ? 1.6 : 1), bp: R.range(700, 1300), q: .8, lp: 3000, amp: g * .6});               // the snap
      tear(out, sr, R, t + .0005, (last ? R.range(.12, .2) : R.range(.03, .08) * lerp(.7, 1.2, u)), {fc: R.range(900, 1900), q: 1.3, dMin: .0004, dMax: last ? .002 : .003,
        thin: last ? 5 : 3, bed: .35, modes: tm, ring: .55, amp: g, lp: 3400});
      if (u > .45) strike(out, sr, R, t + .001, R.range(.003, .005), [[R.range(60, 80), R.range(.07, .1), 1], [R.range(140, 170), .04, .35]], g * R.range(.35, .5) * (last ? 1.4 : 1));   // the trunk's weight shifting
    }
    field(out, sr, R, .05, T + .06, t => 25 + 160 * Math.pow(Math.min(1, t / T), 1.6), 220, {g: [.0002, .0006], fc: R.range(1000, 1500), q: .9, lp: 2800, amp: R.range(.07, .11), env: t => .4 + .6 * Math.min(1, t / T)});
    return out;
  },
  crash(R, sr) {
    // sz: the tree's size (a bigger one lower and fuller in every layer at once: the variants differ as wholes)
    const sz = R.range(.8, 1.25), out = buf(2.5, sr), fT = R.range(46, 56) / sz, tT = R.range(.008, .03), tm = trunkModes(R.range(110, 145) / sz, R, {t0: .08, dense: 12, top: 2500});
    // the dark body first: the crown's mass flattening the brush, a low-passed brown whump; and the limbs swishing (a broad whoosh)
    puff(out, sr, R, 0, {a: R.range(.008, .016), d: R.range(.14, .22), color: 'brown', lp: R.range(400, 520) / sz, hp: 40, amp: R.range(.4, .6) * Math.sqrt(sz)});
    whoosh(out, sr, R, 0, {dur: R.range(.55, .8), f0: R.range(500, 650), f1: R.range(350, 450), f2: 220, pk: .06, p: 1.4, q: .55, grain: .9, gHz: [12, 30], amp: .3, top: 1300, every: 96});
    // the trunk's mass on the earth: a deep damped thud (a long soft contact: earth and bark), its wood, the earth; its rebound off
    // the crown and a last settle
    const thud = (t, g) => {
      strike(out, sr, R, t, R.range(.009, .014), [[fT, R.range(.18, .26), 1], [fT * R.range(2, 2.3), .09, .4], [fT * R.range(3.3, 3.8), .05, .18]], g);
      strike(out, sr, R, t + .001, R.range(.0035, .005), tm, g * .45);
      puff(out, sr, R, t, {a: .003, d: R.range(.03, .05), color: 'brown', lp: R.range(260, 340), hp: 35, amp: g * .5});
    };
    thud(tT, 1);
    thud(tT + R.range(.13, .22), R.range(.28, .4));
    if (R() < .7) thud(tT + R.range(.34, .5), R.range(.1, .16));
    // the limbs: a few big cracks in the first 250 ms (low, short tears), then twigs snapping, thinning out to the settle
    for (let k = R.int(3, 6); k > 0; k--) {
      const t = R.range(0, .25), g = R.range(.18, .32) * (1 - t * 1.5);
      tear(out, sr, R, t, R.range(.015, .04), {fc: R.range(600, 1100), q: 1.2, dMin: .0006, dMax: .003, thin: 3, bed: .3, modes: trunkModes(R.range(220, 420), R, {t0: .04, dense: 4, top: 2500}), ring: .5, amp: g, lp: 2600});
    }
    for (let k = R.int(14, 26); k > 0; k--) {
      const u = Math.pow(R(), 2.2), t = .005 + u * R.range(1.2, 1.9), g = R.pow(.25, 1, 1.5) * .17 * (1 - .75 * u), f = R.range(380, 900);
      strike(out, sr, R, t, R.range(.0003, .0007), [[f, R.range(.012, .025), 1], [f * R.range(2.3, 2.8), .008, .5]], g);
      puff(out, sr, R, t, {a: .00008, d: R.range(.0006, .0015), color: 'white', bp: R.range(1000, 2000), q: 1, lp: 3000, amp: g * .7});
    }
    // the leaves: thousands of tiny grains, very dense at the crash and settling (density falls in two stages), darker as they settle
    const tau1 = R.range(.12, .2), tau2 = R.range(.55, .85), L1 = R.range(1.7, 2.3);
    field(out, sr, R, 0, L1, t => 3800 * Math.exp(-t / tau1) + 700 * Math.exp(-t / tau2), 4600, {g: [.00025, .0008], fc: R.range(1050, 1450) / sz, q: .7, lp: R.range(2400, 2800) / Math.sqrt(sz), hp: 250, amp: R.range(.32, .44) / sz, env: t => .3 + .7 * Math.exp(-t / .3)});
    field(out, sr, R, .002, L1 * .8, t => 1500 * Math.exp(-t / tau1) + 260 * Math.exp(-t / tau2), 1800, {g: [.0008, .0016], fc: R.range(480, 640) / sz, q: .7, lp: 1300, hp: 120, amp: R.range(.2, .32) * sz, env: t => .4 + .6 * Math.exp(-t / .4)});   // branches brushing
    return out;
  },
  logs(R, sr) {
    const out = buf(1.2, sr), n = R.int(3, 4), knock = R.int(0, n - 1), fl = R.range(200, 330);
    let t = R.range(0, .01);
    for (let k = 0; k < n; k++) {
      const g = (k ? R.range(.55, .95) : 1) * R.jit(.08), f0 = fl * R.range(.85, 1.35), tc = R.range(.0011, .0018);
      strike(out, sr, R, t, tc, trunkModes(f0, R, {t0: R.range(.04, .055), dense: 12, top: 4000}), g);                                                      // the log's wood
      strike(out, sr, R, t + .0005, R.range(.005, .008), [[R.range(85, 125), R.range(.04, .06), 1], [R.range(200, 260), .02, .3]], g * R.range(.45, .58));   // its weight on the earth
      puff(out, sr, R, t, {a: .001, d: R.range(.008, .014), color: 'brown', lp: R.range(380, 520), hp: 50, amp: g * .4});                                     // the earth
      if (R() < .55) { const tb = t + R.range(.04, .08); strike(out, sr, R, tb, tc * .8, trunkModes(f0 * R.jit(.05), R, {t0: .035, dense: 8, top: 4000}), g * R.range(.22, .35)); }   // a small bounce
      if (k === knock && k > 0 && R() < .6) strike(out, sr, R, t + R.range(.008, .02), R.range(.0008, .0012), trunkModes(R.range(420, 560), R, {t0: .03, dense: 8, top: 4500}), g * R.range(.3, .45));   // log on log
      t += R.range(.06, .2);
    }
    scrape(out, sr, R, t - R.range(.02, .06), R.range(.07, .14), {r0: R.range(90, 140), r1: R.range(40, 70), f0: R.range(900, 1300), f1: R.range(550, 750), amp: R.range(.06, .1), bed: .5});   // a little bark scrape
    return out;
  },
  pickup(R, sr) {
    const out = buf(.34, sr), f0 = R.range(620, 900), t2 = R.range(.018, .045);
    whoosh(out, sr, R, 0, {dur: R.range(.09, .13), f0: R.range(320, 400), f1: R.range(700, 900), f2: R.range(420, 520), pk: R.range(.25, .4), p: 1.5, q: .8, grain: .6, amp: R.range(.18, .26), top: 1800});   // the pouch's leather / the sleeve
    const ta = R.range(.02, .035);
    strike(out, sr, R, ta, R.range(.0004, .0007), trunkModes(f0, R, {t0: R.range(.022, .03), dense: 10, top: 5000}), 1);                                 // the clack: firewood on firewood
    if (R() < .65) strike(out, sr, R, ta + t2, R.range(.0004, .0007), trunkModes(f0 * R.range(.85, 1.15), R, {t0: .02, dense: 8, top: 5000}), R.range(.3, .5));   // it settles against another
    strike(out, sr, R, ta + .0005, R.range(.0025, .0035), [[R.range(150, 200), R.range(.025, .035), 1], [R.range(320, 400), .014, .3]], R.range(.3, .4));   // its weight into the pouch
    puff(out, sr, R, ta, {a: .0001, d: R.range(.0006, .001), color: 'white', bp: R.range(1500, 2100), q: 1, lp: 3800, amp: R.range(.12, .18)});           // the contact
    creak(out, sr, R, ta + R.range(.01, .025), ta + R.range(.05, .075), {r0: R.range(90, 130), r1: R.range(50, 70), amp: R.range(.07, .11), cap: .015, noise: .3, nbp: 1100,
      formants: [[210, 3, .35], [460, 3.5, .7], [780, 4, 1], [1180, 4.5, .75], [1650, 4.5, .35]]});                                                     // the pouch's leather taking it
    return out;
  },
  swing(R, sr) {
    const out = buf(.38, sr), dur = R.range(.22, .29);
    whoosh(out, sr, R, 0, {dur, f0: R.range(160, 230), f1: R.range(470, 740), f2: R.range(230, 350), pk: R.range(.66, .74), p: 1.8, q: R.range(.8, 1.15), grain: .45, top: 1500});   // the blade
    whoosh(out, sr, R, .012, {dur: dur * R.range(.88, .96), f0: 140, f1: R.range(280, 380), f2: 170, pk: R.range(.62, .7), p: 1.6, q: .7, grain: .6, amp: R.range(.35, .7), top: 900});   // the haft and the arms
    return out;
  },
  campfire(R, sr) {
    const out = buf(1.7, sr), f0 = R.range(200, 290), T = R.range(.8, 1.1), pk = R.range(.15, .3);
    // the log onto the coals: a soft wooden thump, its weight, the embers crunching under it
    strike(out, sr, R, 0, R.range(.003, .0045), trunkModes(f0, R, {t0: R.range(.04, .055), dense: 12, top: 3500}), 1);
    strike(out, sr, R, .0008, R.range(.006, .009), [[R.range(85, 115), R.range(.05, .07), 1], [R.range(190, 240), .025, .3]], R.range(.5, .62));
    snaps(out, sr, R, .002, R.range(.025, .045), R.int(8, 16), {f: R.range(900, 1500), q: 1, lp: 2600, amp: R.range(.14, .2), g: [.0002, .0008]});
    // the flare: a warm dark body swelling as the flame takes the new wood (brown, 24 dB/oct above ~550 Hz), lapping
    const nb = Math.round((T + .5) * sr), b = brown(nb, R), lap = filter(white(nb, R), 'lowpass', R.range(4, 7), .7, sr); let lr = 0; for (const v of lap) lr += v * v; lr = Math.sqrt(lr / nb) || 1;
    const ka = R.range(.07, .12), kd = R.range(.26, .36), w0 = Math.round(nb * .6);   // (the last 40 %: a raised-cosine to nothing)
    for (let i = 0; i < nb; i++) { const t = i / sr; b[i] *= (1 - Math.exp(-t / ka)) * Math.exp(-t / kd) * Math.max(.2, 1 + .5 * lap[i] / lr) * (i < w0 ? 1 : .5 + .5 * Math.cos(PI * (i - w0) / (nb - w0))); }
    const blp = R.range(420, 720); filter(b, 'lowpass', blp, .5412, sr); filter(b, 'lowpass', blp, 1.3066, sr); filter(b, 'highpass', 60, .7, sr);
    add(out, norm(b, R.range(.24, .38)), Math.round(.01 * sr));
    // the crackles: sparse snaps swelling to the flare's peak and dying away; a few deeper pops; the odd bright ember tick
    const rate = t => 90 * Math.pow(Math.min(1, t / pk), 1.5) * Math.exp(-Math.max(0, t - pk) / (T * .4));
    field(out, sr, R, .03, T + .3, rate, 100, {g: [.0002, .0009], fc: R.range(1500, 2400), q: 2.2, lp: 3400, hp: 600, amp: R.range(.3, .4), alpha: 1.5});
    for (let k = R.int(2, 4); k > 0; k--) {
      const t = .03 + R.range(.4, 1.6) * pk + R.range(0, T * .5), f = R.range(500, 1000);
      puff(out, sr, R, t, {a: .0002, d: R.range(.004, .009), bp: f, q: 2.5, lp: 2400, amp: R.range(.08, .16)});
      strike(out, sr, R, t, R.range(.0003, .0006), [[f * R.range(1.8, 2.4), .01, 1]], R.range(.04, .08));
    }
    return out;
  },
};
// the air cases (rolled off already: a gentle tilt and a 90 Hz high-pass, like punch.js's soft cases)
const SOFT = new Set(['swing']);
// the textures and the long ones: a warm tilt, a 24 dB/oct low-pass (crash: every layer is low-passed already), a light glue, no
// levelling (their loudest 400 ms are their bodies, not one transient)
const TEX = {crack: {lp: 6000, drive: 1.35}, crash: {lp: 0, drive: 1.3}, campfire: {lp: 5500, drive: 1.2}};
// the loudest 20 ms's level before the glue, the limiter's threshold over the 400 ms rms (dB), the glue's drive
const LEVEL = {chop: .24, chop_deep: .24, glance: .24, logs: .22, pickup: .24};
const LIM = {chop: 20.5, chop_deep: 20, glance: 21.5, logs: 20, pickup: 21};
const DRIVE = {chop: 1.7, chop_deep: 1.75, glance: 1.5, logs: 1.5, pickup: 1.3};
const KINDS = Object.keys(CASES);

export default {
  id: 'woodcut', version: 1,
  desc: 'Felling oaks with an axe: the chop (and the deep last bites), a glance off hard wood, the hinge cracking, the crown crashing down, the logs, picking one up, the swing, a log on a campfire',
  params: {kind: {values: KINDS, def: 'chop'}},
  cases: Object.fromEntries(KINDS.map(k => [k, {kind: k}])),
  variants: 6,
  render(p, R, sr) {
    const k = CASES[p.kind] ? p.kind : 'chop', out = CASES[k](R, sr);
    if (SOFT.has(k)) { filter(out, 'highpass', 90, .7071, sr); warm(out, sr, {shelf: -6, fs: 3000}); return saturate(norm(out, .9), 1.2); }
    if (TEX[k]) {
      const X = TEX[k];
      warm(out, sr, {shelf: -8, fs: 3500, lp: X.lp}); filter(out, 'highpass', 35, .7071, sr);
      return saturate(norm(out, .9), X.drive);
    }
    // the impacts: levelled, glued (tanh), THEN the warm tilt and the low-pass (they take the glue's added highs too), limited
    saturate(level(out, sr, LEVEL[k] ?? .22), DRIVE[k] ?? 1.4);
    warm(out, sr, {shelf: -8, fs: 4000, lp: 8000}); filter(out, 'highpass', 40, .7071, sr);
    let e = 0; for (let i = 0; i < out.length; i++) e += out[i] * out[i];
    return norm(limit(out, sr, Math.pow(10, (LIM[k] ?? 30) / 20) * Math.sqrt(e / (.4 * sr))), .9);
  },
  // pass ranges from the forge's metrics over 42 seeds (1-24, the lab's 44291-44296, 12 large ones) with margin, checked on 24
  // more. The forge's STFT starts a Hann window at sample 0, so a short blow's centroid / highHz mostly weigh its tail (the chop:
  // 145-510 Hz zero-padded, the thock and the tock; its edge is crisp but ~1 ms). t60 of the multi-event cases (chop_deep, crack,
  // logs, crash, campfire) is their event structure's, not a ring: every wooden mode here dies by construction (the thock's
  // fundamental <= ~70 ms, the tock <= 30 ms, the steel <= 11 ms, the glance's tick <= 45 ms). Textures (crack, crash, campfire):
  // hf4kDb well under -18, highHz under 3 kHz (RECIPE_GUIDE brightness rules)
  criteria: {
    chop: {attackMs: [0, 6], t60Ms: [35, 180], centroidHz: [120, 620], lowHz: [5, 95], highHz: [350, 2800], flatness: [0, .005], hf4kDb: [-62, -22], durMs: [80, 300], onsetCount: [0, 2], clickEnd: [0, .01]},
    chop_deep: {attackMs: [0, 16], t60Ms: [450, 1050], centroidHz: [190, 760], lowHz: [5, 95], highHz: [700, 2900], flatness: [0, .005], hf4kDb: [-40, -21], durMs: [270, 480], onsetCount: [0, 5], clickEnd: [0, .01]},
    glance: {attackMs: [0, 5], t60Ms: [60, 270], centroidHz: [430, 1450], lowHz: [5, 95], highHz: [1400, 3100], flatness: [0, .005], hf4kDb: [-40, -21], durMs: [70, 165], onsetCount: [0, 1], clickEnd: [0, .01]},
    crack: {attackMs: [600, 1300], t60Ms: [150, 460], centroidHz: [580, 1200], lowHz: [20, 95], highHz: [1700, 3000], flatness: [0, .01], hf4kDb: [-33, -20], durMs: [900, 1500], onsetCount: [5, 18], clickEnd: [0, .01]},
    // (crash: the rebound with a limb cracking can peak within a dB of the fall; chop_deep: a deep bite's mass crests ~10 ms in)
    crash: {attackMs: [5, 260], t60Ms: [1250, 3300], centroidHz: [150, 420], lowHz: [5, 70], highHz: [450, 2000], flatness: [0, .01], hf4kDb: [-55, -32], durMs: [1400, 2450], onsetCount: [0, 9], clickEnd: [0, .01]},
    logs: {attackMs: [0, 650], t60Ms: [140, 1350], centroidHz: [140, 310], lowHz: [20, 70], highHz: [320, 950], flatness: [0, .005], hf4kDb: [-66, -42], durMs: [320, 820], onsetCount: [2, 7], clickEnd: [0, .01]},   // any log can land hardest
    pickup: {attackMs: [0, 32], t60Ms: [80, 240], centroidHz: [370, 820], lowHz: [40, 140], highHz: [800, 2500], flatness: [0, .005], hf4kDb: [-60, -28], durMs: [100, 190], onsetCount: [1, 2], clickEnd: [0, .01]},
    swing: {attackMs: [55, 210], t60Ms: [110, 250], centroidHz: [330, 640], lowHz: [95, 240], highHz: [600, 1300], flatness: [0, .005], hf4kDb: [-74, -50], durMs: [230, 345], onsetCount: [0, 2], clickEnd: [0, .01]},   // peaks late (~70 %)
    campfire: {attackMs: [0, 8], t60Ms: [1100, 3600], centroidHz: [200, 500], lowHz: [20, 95], highHz: [420, 2500], flatness: [0, .01], hf4kDb: [-56, -30], durMs: [1150, 1700], onsetCount: [1, 16], clickEnd: [0, .01]},
  },
  notes: 'modal synthesis (dense, damped trunk modes under half-sine contacts) + fibre click trains (cf. crate_break.js) + stick-slip groans (cf. bow_draw.js) + grain fields (PhISEM-like, filtered once) + swept-band whooshes (cf. punch.js)',
};
