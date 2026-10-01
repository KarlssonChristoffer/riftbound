// IMPACT recipe: an arrow (or any object) hitting wood / clay / stone / crystal / straw / flesh. docs/AUDIO.md §2.3.
// Model: a half-sine contact force of duration τc (short = hard = bright) with a little surface roughness drives a modal
// bank of 10-30 modes with per-material frequency ratios and q (higher modes die faster), plus a noise "residue" whose
// envelope follows the contact force. Soft targets (straw, flesh) have a long τc, low-passed noise and no ringing.
// Arrow-specific layers (param `arrow`): the shaft "thrum" of an arrow stuck in wood, the ricochet skitter on stone.
// Per hit: mode frequencies ±f/300, gains ±20%, strike position (sin(nπx/L) mode weights), modal-to-residue balance.
// Named exports (MATERIAL_MODES, materialModes, strike, contactTrain, contactForce, contactEnv) are reused by crate_break.js.
import {halfSine, add, scale, peak, filter, sweep, onePoleLP, noise, phisem, bubble, saturate} from '../dsp.js';

const PI = Math.PI, clamp01 = v => Math.max(0, Math.min(1, v)), lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };

// ============================================================================================ helpers (kernel candidates)
// contact force: unit-area half-sine of duration tc with multiplicative surface roughness (excites high modes randomly)
export function contactForce(tc, sr, R, rough = .2) {
  const f = halfSine(tc, sr); if (rough) for (let i = 0; i < f.length; i++) f[i] *= 1 + rough * (R() * 2 - 1); return f;
}
// force-shaped envelope for the residue: rises like the contact force (first quarter-sine over tc/2), then decays (1/e)
export function contactEnv(n, sr, tc, decay) {
  const e = new Float32Array(n), nh = Math.max(1, Math.round(tc * sr / 2)), k = 1 / (Math.max(1e-5, decay) * sr);
  for (let i = 0; i < n; i++) e[i] = i < nh ? Math.sin(PI / 2 * (i + .5) / nh) : Math.exp(-(i - nh) * k);
  return e;
}
// sparse modal synthesis: add the response of `modes` to one contact at time `at` (s) into `out`. Each mode only runs
// until it has decayed ~80 dB, so many short events (debris, bounces) stay cheap. exc overrides the half-sine.
export function strike(out, sr, at, modes, {tc = .001, amp = 1, exc = null, tail = 1.35} = {}) {
  const x = exc || halfSine(tc, sr), i0 = Math.max(0, Math.round(at * sr)); if (i0 >= out.length) return out;
  for (const m of modes) {
    if (!(m.f > 0) || m.f > sr * .45 || !m.a) continue;
    const len = Math.min(out.length - i0, x.length + Math.round(m.t60 * tail * sr));
    const w = 2 * PI * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = amp * m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0, i = 0;
    for (const ne = Math.min(len, x.length + 1); i < ne; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < x.length ? x[i] : 0; y2 = y1; y1 = y; out[i0 + i] += y; }
    for (; i < len; i++) { const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; out[i0 + i] += y; }   // free ring: no input
  }
  return out;
}
// several contacts on one object as ONE excitation buffer (so a mode bank runs once for a whole bounce sequence):
// hits = [{t (s), amp, tc (s)}] → {exc, t0}; pass exc to strike(out, sr, t0, modes, {exc})
export function contactTrain(hits, sr, R, rough = .25) {
  const t0 = Math.min(...hits.map(h => h.t)), end = Math.max(...hits.map(h => h.t + h.tc)), exc = new Float32Array(Math.round((end - t0) * sr) + 2);
  for (const h of hits) { const f = contactForce(h.tc, sr, R, rough), i0 = Math.round((h.t - t0) * sr); for (let i = 0; i < f.length && i0 + i < exc.length; i++) exc[i0 + i] += f[i] * h.amp; }
  return {exc, t0};
}
// samples for a contact-shaped decay (1/e time `decay`) to reach ~-78 dB, plus room for filter ringing. Every noise /
// particle layer sizes its buffer with this, so no layer is cut off mid-decay (a hard vertical edge in the spectrogram).
export const decayLen = (sr, tc, decay, tail = .012) => Math.round((tc / 2 + 9 * decay + tail) * sr);
// raised-cosine fade over the last `sec` of a buffer: whatever is left at a buffer's end fades instead of stopping
export function tailFade(b, sr, sec = .008) { const nf = Math.min(b.length, Math.round(sec * sr)); for (let i = 0; i < nf; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(PI * i / nf); return b; }
// noise residue: coloured noise under a contact-shaped envelope, then band-limited. `sec` is a minimum length.
function residue(sec, sr, R, {tc, decay, color = 'pink', bp = null, q = .8, lp = null, hp = null}) {
  const n = Math.max(Math.round(sec * sr), decayLen(sr, tc, decay)), b = noise(n, R, color), e = contactEnv(n, sr, tc, decay);
  for (let i = 0; i < n; i++) b[i] *= e[i];
  if (bp) filter(b, 'bandpass', bp, q, sr); if (lp) filter(b, 'lowpass', lp, .7071, sr); if (hp) filter(b, 'highpass', hp, .7071, sr);
  return tailFade(b, sr);
}
// a particle (PhISEM) layer whose shake energy follows a contact envelope; length from the decay, faded end
function grains(sr, R, tc, decay, opts) {
  const n = decayLen(sr, tc, decay, .02); return tailFade(phisem(n, sr, R, {...opts, energy: contactEnv(n, sr, tc, decay)}), sr);
}

// ============================================================================================ materials
// mode-ratio tables. BEAM: free-free bending bar; CLAY: fired-clay shell (inharmonic, circumferential + axial);
// GLASS: crystal/glass body; RING: thin circular ring bending modes n = 2..7, f ∝ n(n²-1)/√(n²+1) (see 'hoop').
export const MATERIAL_MODES = {
  BEAM: [1, 2.756, 5.404, 8.933, 13.345, 18.638, 24.81, 31.87],
  CLAY: [1, 1.52, 2.17, 2.66, 3.25, 3.9, 4.67, 5.42, 6.3, 7.24, 8.3, 9.5],
  GLASS: [1, 1.53, 2.08, 2.61, 3.2, 3.84, 4.5, 5.3, 6.1],
  RING: [1, 2.829, 5.424, 8.771, 12.867, 17.71],
};
// modes for one object of material `mat` with fundamental f0. x, y = strike position (0..1 along length / width),
// qMul scales every q (a cracking structure is lossier), count limits the mode count (small fragments), hitJit = ±f/300.
export function materialModes(mat, f0, R, {x = R.range(.08, .46), y = R.range(.1, .45), qMul = 1, count = 99, hitJit = 1 / 300, fMax = 16000} = {}) {
  const out = [], {BEAM, CLAY, GLASS} = MATERIAL_MODES;
  const push = (f, a, q, jit = true) => {
    if (jit) f *= 1 + (R() * 2 - 1) * hitJit;
    if (f > fMax || out.length >= count) return;
    out.push({f, a: a * R.jit(.2), t60: 6.9078 * q / (PI * f)});
  };
  const pos = (k, p, floor = .03) => Math.max(floor, Math.abs(Math.sin(k * PI * p)));
  if (mat === 'wood') {                     // plank: bending family + torsion (harmonic) + width bending; q 15-60
    const q0 = R.range(25, 50) * qMul, tf = f0 * R.range(1.3, 1.9), wf = f0 * R.range(3.2, 5);
    const nb = count < 99 ? Math.ceil(count * .6) : 8;
    // the fundamental is the most damped by the mounting (clamped / resting on the ground): q x .65
    BEAM.slice(0, nb).forEach((r, i) => push(f0 * r * R.jit(.015), (i ? 1 / (1 + .55 * i) : .75) * pos(i + 1, x), Math.max(15, q0 * (i ? 1 - .07 * i : .65))));
    for (let k = 1; k <= 5; k++) push(tf * k * R.jit(.02), .45 / (1 + .6 * (k - 1)) * pos(k, y), Math.max(15, q0 * .8 * (1 - .08 * k)));
    for (let i = 0; i < 3; i++) push(wf * BEAM[i] * R.jit(.02), .3 / (1 + i), Math.max(15, q0 * .6));
    // grain: a real board/log/target is a composite with dense, lossy modes 0.6-6 kHz (the 'woody' texture)
    for (let k = 0, ng = count < 99 ? 0 : 14; k < ng; k++) push(f0 * R.range(3, 28), R.range(.2, .5), R.range(25, 55) * qMul);
  } else if (mat === 'clay') {              // fired clay: 400-2500 Hz body, q 30-120
    const q0 = R.range(45, 95) * qMul;
    CLAY.forEach((r, i) => push(f0 * r * R.jit(.03), 1 / (1 + .35 * i) * (.25 + .75 * pos(i + 1, x)), Math.max(30 * qMul, q0 * (1 - .055 * i))));
  } else if (mat === 'stone') {             // dense 1-5 kHz modes, q 5-30 (a click with colour), plus the block's mass thud
    push(f0 * R.range(.22, .34), .55, R.range(4, 7) * qMul);
    for (let k = 0; k < 22; k++) push(f0 * (1 + k * .2 + R.range(-.08, .08)), R.range(.3, 1) / (1 + .07 * k) * (.3 + .7 * pos(k + 1, x)), R.range(5, 30) * qMul);
  } else if (mat === 'crystal') {           // 2-6 kHz, q 500-3000, near-degenerate twins detuned 0.5-3 Hz: beating
    const q0 = R.range(1800, 3000) * qMul;
    GLASS.forEach((r, i) => {
      const f = f0 * r * R.jit(.04) * (1 + (R() * 2 - 1) * hitJit), a = 1 / (1 + .4 * i) * (.2 + .8 * pos(i + 1, x)), q = Math.max(500, q0 * (1 - .09 * i));
      push(f, a, q, false); push(f + R.sign() * R.range(.5, 3), a * R.range(.5, .9), q, false);
    });
  } else if (mat === 'hoop') {              // thin metal ring (barrel hoop): f0 = the n=2 mode (15-40 Hz for a real hoop), so
    // what rings is the dense high-order series f_n ∝ n(n²-1)/√(n²+1) (≈ n²): n = 6..26, 0.4-6 kHz; q 300-1000; the
    // lowest audible pairs are split twins (degenerate cos/sin modes split by the rivet joint): beating
    const fn = k => f0 * k * (k * k - 1) / Math.sqrt(k * k + 1) / 2.683, ks = [];
    for (let k = 6; k <= 26; k++) if (fn(k) > 350 && fn(k) < Math.min(fMax, 7000)) ks.push(k);
    const want = Math.min(count < 99 ? count : 14, ks.length);
    while (ks.length > want) ks.splice(R.int(0, ks.length - 1), 1);   // a blow excites a random subset strongly
    ks.forEach((k, i) => {
      const f = fn(k) * R.jit(.004) * (1 + (R() * 2 - 1) * hitJit), a = 1 / (1 + .06 * (k - 6)) * (.25 + .75 * pos(k, x)), q = R.range(300, 1000) * qMul;
      push(f, a, q, false); if (i < 4) push(f + R.sign() * R.range(.5, 3), a * R.range(.4, .8), q, false);
    });
  }
  return out;
}

// ============================================================================================ recipe
// per material: τc range [soft hit, hard hit] (s), object f0 range (Hz), render length (s)
const MAT = {
  wood: {tc: [2e-3, .5e-3], f0: [150, 300], dur: .7},
  clay: {tc: [.7e-3, .18e-3], f0: [450, 820], dur: .7},
  stone: {tc: [.3e-3, .05e-3], f0: [950, 1500], dur: .3},
  crystal: {tc: [.22e-3, .05e-3], f0: [1900, 3200], dur: 2.6},
  straw: {tc: [15e-3, 5e-3], dur: .5},
  flesh: {tc: [12e-3, 4e-3], dur: .35},
};

function render(p, R, sr) {
  const mat = MAT[p.material] ? p.material : 'wood', M = MAT[mat], I = clamp01(p.intensity), S = Math.max(.3, p.size), A = clamp01(p.arrow);
  const n = Math.round(M.dur * Math.sqrt(S) * sr), out = new Float32Array(n);
  const tc = lerp(M.tc[0], M.tc[1], Math.pow(I, .7)) * R.jit(.15);   // harder = shorter contact = brighter
  const hard = Math.pow(I, .7);
  const bal = R.range(mat === 'wood' ? .8 : .65, 1.5);               // per-hit modal-to-residue balance
  const f0 = M.f0 ? R.range(M.f0[0], M.f0[1]) / S : 0;

  if (mat === 'wood' || mat === 'clay' || mat === 'stone' || mat === 'crystal') {
    const modes = materialModes(mat, f0, R);
    const body = norm(strike(new Float32Array(n), sr, 0, modes, {exc: contactForce(tc, sr, R, mat === 'stone' ? .5 : .25)}));
    add(out, body, 0, 1);
    if (mat === 'wood') {
      // residue: the knock of fibres crushing under the head, pink, 0.9-2.6 kHz by hardness
      add(out, norm(residue(.02, sr, R, {tc, decay: R.range(.006, .014), bp: lerp(800, 2400, hard) * R.jit(.2), q: .6})), 0, .8 * bal);
      // the target's dense high-mode field (too dense to resolve: noise-like), decaying over ~150 ms with the highs dying
      // first: pink noise under a slower envelope through a low-pass that closes from 4-7 kHz towards 800 Hz
      const fd = R.range(.025, .045), fTop = R.range(4000, 7000), fTau = R.range(.035, .06);
      const fld = residue(0, sr, R, {tc, decay: fd, hp: 450});
      add(out, norm(tailFade(sweep(fld, 'lowpass', t => 800 + (fTop - 800) * Math.exp(-t / fTau), .7071, sr), sr)), 0, R.range(.3, .45) * bal);
      // penetration: a few fibre-crush ticks in the first 15 ms
      const tk = new Float32Array(Math.round(.03 * sr)); for (let k = R.int(3, 8); k > 0; k--) tk[R.int(0, Math.round(.015 * sr))] += R.range(-1, 1);
      add(out, norm(filter(filter(tk, 'bandpass', R.range(2200, 4500), 1.5, sr), 'highpass', 1500, .7071, sr)), Math.round(R.range(.5, 2) * sr / 1000), .18 * bal * hard);
      if (A > 0) {   // shaft thrum: a cantilever (arrowhead fixed, fletching free), modes 1 : 6.27 : 17.55, twin → slight AM
        let fs = R.range(80, 180); const t60 = R.range(.06, .15), th = new Float32Array(n);   // a twang, not a hum
        if (Math.abs(fs / f0 - 1) < .15) fs *= .75;   // keep the shaft off the target's fundamental (else one fused hum)
        strike(th, sr, R.range(.3, 1.2) / 1000, [
          {f: fs, t60, a: 1}, {f: fs + R.sign() * R.range(3, 9), t60: t60 * R.jit(.1), a: R.range(.25, .45)},
          {f: fs * 6.27 * R.jit(.02), t60: t60 * .3, a: R.range(.15, .3)}, {f: fs * 17.55 * R.jit(.02), t60: t60 * .12, a: R.range(.05, .12)},
        ], {tc: R.range(1, 2.2) / 1000});
        add(out, norm(saturate(norm(th), 1.2)), 0, R.range(.5, .85) * A * Math.min(1, Math.sqrt(.09 / t60)));   // equal-ish thrum energy
      }
    } else if (mat === 'clay') {
      // gritty residue: bright pink burst plus crumbling grains (PhISEM, energy follows the contact)
      add(out, norm(residue(.05, sr, R, {tc, decay: R.range(.003, .006), bp: lerp(1800, 3800, hard) * R.jit(.15), q: .9})), 0, .5 * bal);
      add(out, norm(tailFade(filter(grains(sr, R, tc, R.range(.008, .018), {objects: 900, soundDecay: .96, res: [[R.range(3500, 6000), .8, 1]]}), 'highpass', 1500, .7071, sr), sr)), 0, .3 * bal);
    } else if (mat === 'stone') {
      // mostly click + noise: a strong bright residue, then the arrow skitters off (shaft/fletching ticks)
      add(out, norm(residue(.04, sr, R, {tc, decay: R.range(.0015, .004), color: 'white', bp: lerp(2500, 5500, hard) * R.jit(.2), q: .7})), 0, .9 * bal);
      add(out, norm(residue(.03, sr, R, {tc: tc * 4, decay: R.range(.004, .008), color: 'pink', lp: 900, hp: 150})), 0, .25 * bal);
      if (A > 0) {
        let t = R.range(.025, .06);
        for (let k = R.int(1, 3); k > 0 && t < M.dur * .8; k--, t += R.range(.02, .07)) {
          const sh = [];   // shaft modes (a thin wooden rod, free-free): 1.2-2.5 kHz body
          const fsh = R.range(1200, 2500); for (let i = 0; i < 4; i++) sh.push({f: fsh * MATERIAL_MODES.BEAM[i], t60: R.range(.015, .04) / (1 + i), a: 1 / (1 + i)});
          const g = R.range(.06, .2) * A; strike(out, sr, t, sh, {tc: .15e-3, amp: g * .9});
          add(out, norm(residue(.012, sr, R, {tc: .1e-3, decay: .001, color: 'white', hp: 3000})), Math.round(t * sr), g * .6);
        }
      }
    } else {   // crystal: a short, very bright click; the modes carry the sound
      add(out, norm(residue(.02, sr, R, {tc, decay: R.range(.0006, .0015), color: 'white', bp: R.range(5500, 8500), q: .9})), 0, .35 * bal);
    }
  } else {
    // soft targets: no ringing. Low-passed noise under the (long) contact force + a heavily damped body thump.
    const nb = Math.round(M.dur * .6 * sr);
    const thumpF = mat === 'straw' ? R.range(90, 160) : R.range(110, 220), thumpQ = mat === 'straw' ? R.range(1.5, 3) : R.range(2, 4);
    const th = new Float32Array(n); strike(th, sr, 0, [{f: thumpF, t60: 6.9078 * thumpQ / (PI * thumpF), a: 1}, {f: thumpF * R.range(2.1, 2.6), t60: .02, a: .3}], {exc: contactForce(tc, sr, R, .1)});
    add(out, norm(th), 0, R.range(.6, 1) / bal);
    const soft = residue(nb / sr, sr, R, {tc, decay: tc * R.range(1.2, 2.5), color: 'pink', lp: mat === 'straw' ? lerp(700, 1600, hard) : lerp(450, 1100, hard)});
    add(out, norm(filter(soft, 'highpass', mat === 'straw' ? 60 : 90, .7071, sr)), 0, .9 * bal);   // a small soft contact can't radiate sub-bass
    if (mat === 'straw') {
      // stalks snapping and rustling as the arrow pushes through: sparse crackles, 2.5-7 kHz, over 60-150 ms
      const rs = grains(sr, R, tc * 2, R.range(.03, .055), {objects: R.range(40, 90), soundDecay: .9, res: [[R.range(2500, 4000), .75, 1], [R.range(5000, 7000), .6, .5]]});
      add(out, norm(tailFade(filter(rs, 'highpass', 1200, .7071, sr), sr)), Math.round(tc * .3 * sr), R.range(.3, .5));
    } else {
      // flesh: a short wet component: a squelch (band-passed noise sweeping 2.5 kHz → 700 Hz in ~25 ms) + damped bubbles
      const w = residue(0, sr, R, {tc: .003, decay: R.range(.015, .03)});
      const f1 = R.range(2000, 3000), f2 = R.range(600, 900), T = R.range(.02, .035);
      const wet = tailFade(sweep(w, 'bandpass', t => f2 + (f1 - f2) * Math.exp(-t / (T / 3)), 2.5, sr), sr);
      add(out, norm(wet), Math.round(R.range(1, 4) * sr / 1000), R.range(.25, .45) * bal);
      const bb = new Float32Array(Math.round(.15 * sr));   // latest bubble ends by ~110 ms
      for (let k = R.int(3, 7); k > 0; k--) bubble(bb, sr, R.range(.003, .06), R.range(.0012, .004), R.range(.4, 1), {dampMul: R.range(1.5, 3.5)});
      // tissue tearing as the head passes: a short, wet, low crackle (PhISEM, 0.8-2.5 kHz), 20-60 ms
      add(out, norm(grains(sr, R, .004, R.range(.015, .035), {objects: R.range(60, 140), soundDecay: .93, res: [[R.range(800, 1500), .8, 1], [R.range(1800, 2600), .7, .6]]})), Math.round(R.range(2, 6) * sr / 1000), R.range(.15, .3) * hard);
      add(out, norm(bb), 0, R.range(.12, .25) * bal);
      // skin/cloth slap at first contact: short band-passed noise 1-2.5 kHz
      add(out, norm(residue(.03, sr, R, {tc: .6e-3, decay: R.range(.002, .005), bp: R.range(1000, 2500), q: 1.2})), 0, R.range(.2, .4) * hard);
    }
  }
  // the window is long enough for every layer; a raised-cosine over its last 30 % catches the longest rings (crystal)
  const nf = Math.round(n * .3); for (let i = 0; i < nf; i++) out[n - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  onePoleLP(out, 16000, sr);
  filter(out, 'highpass', 35, .7071, sr);
  return saturate(norm(out, .9), 1.2);
}

export default {
  id: 'impact', version: 2, desc: 'Arrow / object impacts: contact-driven modal body + force-shaped noise residue',
  params: {
    material: {values: ['wood', 'clay', 'stone', 'crystal', 'straw', 'flesh'], def: 'wood'},
    intensity: {min: 0, max: 1, def: .8},   // harder hit: shorter contact, brighter
    size: {min: .5, max: 2, def: 1},        // object scale: modes ∝ 1/size, longer ring
    arrow: {min: 0, max: 1, def: 1},        // arrow-specific layers: shaft thrum (wood), skitter (stone); 0 = plain object hit
  },
  cases: {
    wood: {material: 'wood'}, clay: {material: 'clay'}, stone: {material: 'stone'},
    crystal: {material: 'crystal'}, straw: {material: 'straw'}, flesh: {material: 'flesh'},
  },
  variants: 6,
  render,
  // pass ranges from the physics (q, τc, contact duration) checked against 16-seed spreads and the wood references
  // (hit.wood_1/2: t60 412/510 ms, centroid 425/209 Hz, band 94-1711/94-375 Hz)
  criteria: {
    wood: {attackMs: [0, 10], t60Ms: [100, 500], centroidHz: [200, 1200], highHz: [500, 5000], clickEnd: [0, .01]},   // q 15-60 at 150-300 Hz + thrum
    clay: {attackMs: [0, 4], t60Ms: [100, 450], centroidHz: [450, 1500], lowHz: [350, 900], clickEnd: [0, .01]},      // q 30-120 at 400-2500 Hz
    stone: {attackMs: [0, 2], t60Ms: [50, 700], durMs: [40, 250], centroidHz: [1200, 4000], flatness: [.03, .4], clickEnd: [0, .01]},   // click + noise
    crystal: {attackMs: [0, 3], t60Ms: [800, 4000], centroidHz: [2000, 6000], lowHz: [1500, 4000], flatness: [0, .01], clickEnd: [0, .01]},   // q 500-3000
    straw: {attackMs: [.5, 15], t60Ms: [50, 250], durMs: [100, 350], centroidHz: [300, 2200], highHz: [1000, 8000], clickEnd: [0, .01]},   // τc 5-15 ms
    flesh: {attackMs: [.5, 12], t60Ms: [60, 250], durMs: [80, 250], centroidHz: [300, 1400], highHz: [800, 3000], clickEnd: [0, .01]},
  },
  refs: {wood: ['assets/sfx/hit.wood_1.mp3', 'assets/sfx/hit.wood_2.mp3']},
  notes: 'modal synthesis with half-sine contact + residue (van den Doel; Avanzini & Rocchesso q per material; Cook PhISEM for grit)',
};
