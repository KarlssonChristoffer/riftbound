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
// a burst of brittle micro-snaps (crushed fibres, breaking stalks): `count` 0.1-0.5 ms noise grains over `len` s, dense
// at first (times ∝ u^1.8), peaky amplitudes, band-coloured; faded end
function snaps(sr, R, len, count, fc, q = 1.2) {
  const gmax = Math.round(.003 * sr), b = new Float32Array(Math.round(len * sr) + gmax);
  for (let k = 0; k < count; k++) {
    const t = len * Math.pow(R(), 1.8), i = Math.round(t * sr), a = R.pow(.15, 1, 1.6) * (1 - .6 * t / len), d = R.range(.0001, .0005) * sr;
    for (let j = 0; j < gmax; j++) b[i + j] += a * (R() * 2 - 1) * Math.exp(-j / d);
  }
  return tailFade(filter(b, 'bandpass', fc, q, sr), sr);
}
// noise under a smooth attack-decay envelope (1 - e^-t/a)·e^-t/d: no corners anywhere (soft bodies, meat, slaps);
// the buffer runs until ~-80 dB
function smoothNoise(sr, R, a, d, color = 'pink') {
  const n = Math.round((3 * a + 9.2 * d + .01) * sr), b = noise(n, R, color);
  for (let i = 0; i < n; i++) { const t = i / sr; b[i] *= (1 - Math.exp(-t / a)) * Math.exp(-t / d); }
  return b;
}
// warm game-mix tilt (RECIPE_GUIDE 'Brightness rules'): a high-shelf (default -9 dB above ~5 kHz), optionally a
// gentle 2nd-order low-pass on top
export function warm(b, sr, {shelfHz = 5000, shelfDb = -9, lp = 0} = {}) {
  filter(b, 'highshelf', shelfHz, .7071, sr, shelfDb); if (lp) filter(b, 'lowpass', lp, .6, sr); return b;
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
  } else if (mat === 'woodSolid') {         // a SOLID wooden target (post, log, thick plank, a crate side with backing):
    // heavily damped by its mass, mounting and the arrow itself (q 6-16), modally dense, no free 'box' fundamental
    const q0 = R.range(8, 15) * qMul, tf = f0 * R.range(1.3, 1.9);
    BEAM.slice(0, 6).forEach((r, i) => push(f0 * r * R.jit(.03), (i ? 1.1 / (1 + .35 * i) : .8) * pos(i + 1, x, .3), Math.max(5, q0 * (1 - .05 * i))));
    for (let k = 1; k <= 4; k++) push(tf * k * R.jit(.03), .35 / (1 + .5 * (k - 1)) * pos(k, y), Math.max(5, q0 * .9));
    for (let k = 0; k < 24; k++) { const r = R.range(1.5, 18); push(f0 * r, R.range(.25, .55) / Math.sqrt(r), R.range(8, 20) * qMul); }   // density, falling with f
  } else if (mat === 'claySolid') {         // a solid clay/brick/earthenware lump: dull dry 'tok', q 8-18, dense, no cavity
    const q0 = R.range(9, 18) * qMul;
    CLAY.slice(0, 8).forEach((r, i) => push(f0 * r * R.jit(.05), (i ? 1 / (1 + .45 * i) : .5) * (.3 + .7 * pos(i + 1, x)), Math.min(i < 2 ? 10 : 99, Math.max(6, q0 * (1 - .03 * i)))));   // low modes capped: no ring
    for (let k = 0; k < 16; k++) { const r = R.range(1.2, 5); push(f0 * r, R.range(.2, .45) / r, R.range(6, 14) * qMul); }
  } else if (mat === 'clay') {              // fired clay: 400-2500 Hz body, q 30-120
    const q0 = R.range(45, 95) * qMul;
    CLAY.forEach((r, i) => push(f0 * r * R.jit(.03), 1 / (1 + .35 * i) * (.25 + .75 * pos(i + 1, x)), Math.max(30 * qMul, q0 * (1 - .055 * i))));
  } else if (mat === 'stone') {             // dense 1-5 kHz modes, q 5-30 (a click with colour), plus the block's mass thud
    // every rock differs: mode spacing, count, scatter and q spread are drawn per object
    const sp = R.range(.13, .3), nm = R.int(16, 26), jit = R.range(.04, .12), qlo = R.range(4, 9), qhi = R.range(12, 26);
    if (R() < .75) push(f0 * R.range(.2, .36), R.range(.15, .35), R.range(3, 5) * qMul);   // the block's mass: a short low knock
    for (let k = 0; k < nm; k++) push(f0 * (1 + k * sp) * (1 + R.range(-jit, jit)), R.range(.25, 1) / (1 + .07 * k) * (.2 + .8 * pos(k + 1, x)), Math.min(k < 3 ? 15 : 99, R.range(qlo, qhi)) * qMul);   // lowest modes capped: a click, not a tonk
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
  wood: {tc: [1.5e-3, .4e-3], f0: [140, 300], dur: .5, warm: {shelfHz: 4500, shelfDb: -10, lp: 9000}},
  clay: {tc: [1.1e-3, .4e-3], f0: [300, 650], dur: .4, warm: {shelfHz: 4500, shelfDb: -10, lp: 8000}},
  stone: {tc: [.3e-3, .06e-3], f0: [700, 1500], dur: .35, warm: {shelfHz: 5000, shelfDb: -7, lp: 12000}},
  crystal: {tc: [.22e-3, .06e-3], f0: [1900, 3200], dur: 2.6, warm: {shelfHz: 6000, shelfDb: -8, lp: 12000}},
  straw: {tc: [12e-3, 4e-3], dur: .45, warm: {shelfHz: 4500, shelfDb: -10, lp: 9000}},
  thud: {tc: [15e-3, 5e-3], dur: .5, warm: {shelfHz: 5000, shelfDb: -6}},       // the v2 'straw' sound, kept by request: a soft padded thud
  flesh: {tc: [12e-3, 4e-3], dur: .45, warm: {shelfHz: 4500, shelfDb: -8}},
};

function render(p, R, sr) {
  const mat = MAT[p.material] ? p.material : 'wood', M = MAT[mat], I = clamp01(p.intensity), S = Math.max(.3, p.size), A = clamp01(p.arrow);
  const n = Math.round(M.dur * Math.sqrt(S) * sr), out = new Float32Array(n);
  const tc = lerp(M.tc[0], M.tc[1], Math.pow(I, .7)) * R.jit(.15);   // harder = shorter contact = brighter
  const hard = Math.pow(I, .7);
  const bal = R.range(mat === 'wood' || mat === 'stone' ? .9 : .65, 1.5);             // per-hit modal-to-residue balance
  const f0 = M.f0 ? R.range(M.f0[0], M.f0[1]) / S : 0;

  if (mat === 'wood') {
    // SOLID wood ('thock'): a short, dense, heavily damped modal body; the fibre crunch carries the attack
    const modes = materialModes('woodSolid', f0, R);
    add(out, norm(strike(new Float32Array(n), sr, 0, modes, {exc: contactForce(tc, sr, R, .3)})), 0, 1);
    add(out, norm(residue(.01, sr, R, {tc, decay: R.range(.004, .009), color: 'brown', bp: lerp(450, 1300, hard) * R.jit(.2), q: .6})), 0, .85 * bal);
    const crunch = snaps(sr, R, R.range(.008, .016), R.int(6, 16), R.range(900, 2000));
    add(out, norm(crunch), Math.round(R.range(0, 1.5) * sr / 1000), R.range(.35, .55) * bal * lerp(.6, 1, hard));
    // the unresolved high-mode field: short now (12-25 ms), highs dying first
    const fd = R.range(.012, .025), fTop = R.range(1500, 3000), fTau = R.range(.02, .035);
    const fld = residue(0, sr, R, {tc, decay: fd, hp: 300});
    add(out, norm(tailFade(sweep(fld, 'lowpass', t => 500 + (fTop - 500) * Math.exp(-t / fTau), .7071, sr), sr)), 0, R.range(.18, .3) * bal);
    if (A > 0) {   // a subtle shaft twang: cantilever modes 1 : 6.27 : 17.55, short
      let fs = R.range(80, 180); const t60 = R.range(.05, .1), th = new Float32Array(n);
      if (Math.abs(fs / f0 - 1) < .15) fs *= .75;
      strike(th, sr, R.range(.3, 1.2) / 1000, [
        {f: fs, t60, a: 1}, {f: fs + R.sign() * R.range(3, 9), t60: t60 * R.jit(.1), a: R.range(.25, .45)},
        {f: fs * 6.27 * R.jit(.02), t60: t60 * .3, a: R.range(.15, .3)}, {f: fs * 17.55 * R.jit(.02), t60: t60 * .12, a: R.range(.05, .12)},
      ], {tc: R.range(1, 2.2) / 1000});
      add(out, norm(th), 0, R.range(.12, .25) * A);
    }
  } else if (mat === 'clay') {
    // solid fired clay ('tok'): dull, dry, damped, gritty; no pot cavity
    const modes = materialModes('claySolid', f0, R);
    add(out, norm(strike(new Float32Array(n), sr, 0, modes, {exc: contactForce(tc, sr, R, .35)})), 0, 1);
    add(out, norm(residue(.01, sr, R, {tc, decay: R.range(.003, .007), color: 'brown', bp: lerp(500, 1300, hard) * R.jit(.15), q: .7})), 0, .7 * bal);
    add(out, norm(tailFade(filter(grains(sr, R, tc, R.range(.01, .025), {objects: 900, soundDecay: .96, res: [[R.range(1500, 2800), .8, 1]]}), 'highpass', 700, .7071, sr), sr)), 0, .2 * bal);
  } else if (mat === 'stone') {
    // mostly click + noise. Per hit: strike position, mode set, residue colour, chip spray and ricochet pattern all vary
    const modes = materialModes('stone', f0, R, {x: R.range(.02, .5)});
    add(out, norm(strike(new Float32Array(n), sr, 0, modes, {exc: contactForce(tc, sr, R, R.range(.3, .7))})), 0, 1);
    add(out, norm(residue(.01, sr, R, {tc, decay: R.range(.001, .005), color: R.pick(['white', 'pink']), bp: lerp(1600, 4000, hard) * R.jit(.25), q: R.range(.5, 1.2)})), 0, R.range(.8, 1.2) * bal);
    add(out, norm(residue(.01, sr, R, {tc: tc * 4, decay: R.range(.004, .008), color: 'pink', lp: 900, hp: 150})), 0, R.range(.08, .25) * bal);
    if (R() < .4) add(out, norm(tailFade(filter(grains(sr, R, .001, R.range(.01, .03), {objects: R.range(200, 900), soundDecay: .96, res: [[R.range(3500, 6500), .85, 1]]}), 'highpass', 2000, .7071, sr), sr)), Math.round(R.range(1, 6) * sr / 1000), R.range(.08, .18));   // chips
    if (A > 0 && R() > .15) {   // the arrow ricochets: 1-4 ticks, intervals shrinking like bounces (or not at all: it snapped)
      let t = R.range(.02, .07), dt = R.range(.02, .07), g = R.range(.08, .22) * A;
      for (let k = R.int(1, 4); k > 0 && t < M.dur * .7; k--, t += dt, dt *= R.range(.45, .9), g *= R.range(.4, .8)) {
        const fsh = R.range(800, 2200), sh = [];
        for (let i = 0; i < 4; i++) sh.push({f: fsh * MATERIAL_MODES.BEAM[i], t60: R.range(.015, .04) / (1 + i), a: 1 / (1 + i)});
        strike(out, sr, t, sh, {tc: .15e-3, amp: g * .9});
        add(out, norm(residue(.012, sr, R, {tc: .1e-3, decay: .001, color: 'pink', hp: 2000})), Math.round(t * sr), g * .5);
      }
    }
  } else if (mat === 'crystal') {   // unchanged from v2
    const modes = materialModes(mat, f0, R, {fMax: 11000});
    add(out, norm(strike(new Float32Array(n), sr, 0, modes, {exc: contactForce(tc, sr, R, .25)})), 0, 1);
    add(out, norm(residue(.02, sr, R, {tc, decay: R.range(.0006, .0015), color: 'pink', bp: R.range(3500, 6000), q: .9})), 0, .3 * bal);
  } else if (mat === 'thud') {
    // the v2 'straw' (kept by request): LP noise under a long contact + a damped thump + a light rustle
    const nb = Math.round(M.dur * .6 * sr), thumpF = R.range(90, 160), thumpQ = R.range(1.5, 3);
    const th = new Float32Array(n); strike(th, sr, 0, [{f: thumpF, t60: 6.9078 * thumpQ / (PI * thumpF), a: 1}, {f: thumpF * R.range(2.1, 2.6), t60: .02, a: .3}], {exc: contactForce(tc, sr, R, .1)});
    add(out, norm(th), 0, R.range(.6, 1) / bal);
    const soft = residue(nb / sr, sr, R, {tc, decay: tc * R.range(1.2, 2.5), color: 'pink', lp: lerp(700, 1600, hard)});
    add(out, norm(filter(soft, 'highpass', 60, .7071, sr)), 0, .9 * bal);
    const rs = grains(sr, R, tc * 2, R.range(.03, .055), {objects: R.range(40, 90), soundDecay: .9, res: [[R.range(2500, 4000), .75, 1], [R.range(5000, 7000), .6, .5]]});
    add(out, norm(tailFade(filter(rs, 'highpass', 1200, .7071, sr), sr)), Math.round(tc * .3 * sr), R.range(.3, .5));
  } else if (mat === 'straw') {
    // dry straw / hay: brittle hollow stalks snapping as the head pushes through, a papery rustle, a soft low thump.
    // No low-passed noise body (that read as wet/fleshy).
    const th = new Float32Array(n), thF = R.range(70, 130), thQ = R.range(1.2, 2.2);
    strike(th, sr, 0, [{f: thF, t60: 6.9078 * thQ / (PI * thF), a: 1}], {exc: contactForce(tc, sr, R, .05)});
    add(out, norm(th), 0, R.range(.5, .7));
    // stalks: thin hollow tubes, 2 brittle modes each (1.5-4.5 kHz, ×1.9-2.6), q 4-10, struck very briefly
    const len = R.range(.05, .14) * lerp(.8, 1.2, I), ns = Math.round(R.range(25, 60) * lerp(.7, 1.2, I)), crunch = new Float32Array(n);
    for (let k = 0; k < ns; k++) {
      const t = R.range(0, .004) + len * Math.pow(R(), 1.6), fs = R.range(800, 2200), q1 = R.range(4, 10), f2 = fs * R.range(1.9, 2.6);
      strike(crunch, sr, t, [{f: fs, t60: 6.9078 * q1 / (PI * fs), a: 1}, {f: f2, t60: 6.9078 * q1 / (PI * f2), a: R.range(.3, .7)}], {tc: R.range(.04, .12) / 1000, amp: R.pow(.1, 1, 1.5) * Math.pow(1 - Math.min(1, t / (len + .004)), 1.3)});   // the push slows: snaps thin and fade out
    }
    add(out, norm(filter(crunch, 'highpass', 500, .7071, sr)), 0, R.range(.6, .85));
    // papery rustle: dense tiny grains 3-10 kHz, decaying over ~60-160 ms
    const rs = grains(sr, R, .006, R.range(.025, .05), {objects: R.range(200, 400), soundDecay: .8, res: [[R.range(2000, 3500), .55, 1], [R.range(4000, 6000), .45, .5]]});
    add(out, norm(tailFade(filter(rs, 'highpass', 1200, .7071, sr), sr)), Math.round(R.range(1, 5) * sr / 1000), R.range(.25, .4));
  } else {
    // flesh ('arrow into a body / punch into meat'): smooth layered decays only, no gated shapes
    // meaty body: brown noise, LP 250-400 Hz, HP 80, soft 1.5-4 ms attack, 25-55 ms decay
    const body = smoothNoise(sr, R, R.range(.001, .0025), R.range(.012, .025), 'brown');
    filter(filter(body, 'lowpass', R.range(250, 400), .6, sr), 'highpass', 80, .7071, sr);
    add(out, norm(tailFade(body, sr)), 0, R.range(.7, .9));
    const th = new Float32Array(n), thF = R.range(90, 170), thQ = R.range(1.5, 3);   // the body's damped thump
    strike(th, sr, 0, [{f: thF, t60: 6.9078 * thQ / (PI * thF), a: 1}], {exc: contactForce(R.range(.006, .01), sr, R, .02)});
    add(out, norm(th), 0, R.range(.35, .55));
    // wet slap at contact: pink, BP 1.2-2.5 kHz, 3-7 ms
    add(out, norm(tailFade(filter(smoothNoise(sr, R, .0003, R.range(.003, .007)), 'bandpass', R.range(800, 1600), .9, sr), sr)), 0, R.range(.5, .7) * lerp(.6, 1, hard));
    // squelch: a band-pass sweeping 1.8-2.6 kHz → 400-700 Hz under a smooth 15-30 ms decay
    const f1 = R.range(1200, 1800), f2 = R.range(300, 500), T = R.range(.02, .035);
    const sq = sweep(smoothNoise(sr, R, .003, R.range(.015, .03)), 'bandpass', t => f2 + (f1 - f2) * Math.exp(-t / (T / 3)), 2, sr);
    add(out, norm(tailFade(sq, sr)), Math.round(R.range(3, 8) * sr / 1000), R.range(.4, .55));
    const bb = new Float32Array(Math.round(.15 * sr));
    for (let k = R.int(2, 5); k > 0; k--) bubble(bb, sr, R.range(.005, .05), R.range(.0015, .004), R.range(.4, 1), {dampMul: R.range(1.5, 3)});
    add(out, norm(bb), 0, R.range(.08, .15));
  }
  // the window is long enough for every layer; a raised-cosine over its last 30 % catches the longest rings (crystal)
  const nf = Math.round(n * .3); for (let i = 0; i < nf; i++) out[n - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  if (M.warm) warm(out, sr, M.warm);   // warm game-mix tilt (brightness rules)
  onePoleLP(out, 16000, sr);
  filter(out, 'highpass', 35, .7071, sr);
  return saturate(norm(out, .9), 1.2);
}

export default {
  id: 'impact', version: 4, desc: 'Arrow / object impacts: contact-driven modal body + force-shaped noise residue',
  params: {
    material: {values: ['wood', 'clay', 'stone', 'crystal', 'straw', 'thud', 'flesh'], def: 'wood'},
    intensity: {min: 0, max: 1, def: .8},   // harder hit: shorter contact, brighter
    size: {min: .5, max: 2, def: 1},        // object scale: modes ∝ 1/size, longer ring
    arrow: {min: 0, max: 1, def: 1},        // arrow-specific layers: shaft thrum (wood), skitter (stone); 0 = plain object hit
  },
  cases: {
    wood: {material: 'wood'}, clay: {material: 'clay'}, stone: {material: 'stone'},
    crystal: {material: 'crystal'}, straw: {material: 'straw'}, thud: {material: 'thud', seedAs: 'straw'}, flesh: {material: 'flesh'},
  },
  variants: 6,
  render,
  // pass ranges from the physics (q, τc, contact duration) checked against 16-seed spreads and the wood references
  // (hit.wood_1/2: t60 412/510 ms, centroid 425/209 Hz, band 94-1711/94-375 Hz)
  // pass ranges from the physics, validated on 40 seeds (1-24, the lab's 44291-44296 and 10 large seeds)
  // pass ranges validated on 40 seeds (1-24, the lab's 44291-44296, 10 large seeds). v4 'warm game mix': upper
  // centroid / highHz bounds guard against brightness creeping back (RECIPE_GUIDE brightness rules)
  criteria: {
    wood: {attackMs: [0, 8], t60Ms: [40, 250], centroidHz: [150, 1000], highHz: [350, 3000], clickEnd: [0, .01]},   // solid, dense, damped
    clay: {attackMs: [0, 4], t60Ms: [20, 100], centroidHz: [400, 1800], highHz: [800, 3800], clickEnd: [0, .01]},    // dull dry tok
    stone: {attackMs: [0, 3], t60Ms: [20, 700], durMs: [40, 320], centroidHz: [700, 3000], highHz: [1500, 7000], flatness: [.003, .12], clickEnd: [0, .01]},
    crystal: {attackMs: [0, 5], t60Ms: [800, 4000], centroidHz: [1800, 4500], lowHz: [1500, 4000], highHz: [2500, 7000], flatness: [0, .01], clickEnd: [0, .01]},   // bright-ish by design
    straw: {attackMs: [0, 20], t60Ms: [70, 350], durMs: [100, 300], centroidHz: [650, 1800], highHz: [1700, 4000], clickEnd: [0, .01]},
    thud: {attackMs: [.5, 15], t60Ms: [40, 250], durMs: [100, 320], centroidHz: [250, 1500], highHz: [900, 5000], clickEnd: [0, .01]},
    flesh: {attackMs: [1, 25], t60Ms: [70, 250], durMs: [120, 380], centroidHz: [130, 550], highHz: [350, 2000], flatness: [0, .02], clickEnd: [0, .01]},   // soft attack
  },
  refs: {wood: ['assets/sfx/hit.wood_1.mp3', 'assets/sfx/hit.wood_2.mp3']},
  notes: 'modal synthesis with half-sine contact + residue (van den Doel; Avanzini & Rocchesso q per material; Cook PhISEM for grit)',
};
