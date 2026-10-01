// CRATE_BREAK recipe: breakables (crate, clay pot, barrel). docs/AUDIO.md §2.3 "Breaking".
// Model, in physical order:
//   1. the blow: a crack burst (noise) + the parent object's modes (lossier than intact: the structure is failing)
//   2. fracture: wood tears as trains of fibre clicks (1-5 ms apart, BP 1-6 kHz, 50-200 ms) that also ring the plank;
//      clay fails in a few fast brittle cracks; a barrel adds its low staves (80-250 Hz) and metal hoops (q 300-1000)
//   3. debris: 5-40 fragments with power-law sizes (modes ∝ 1/size, amplitude ∝ size, same material ratios as impact.js)
//      fall from their height (first landing √(2h/g) ≈ 0.25-0.45 s, ±30-80 ms each) and bounce with restitution e
//      (planks .4-.6, shards .3-.5): interval and speed shrink by e per bounce; long planks land end-then-end ("clack-clack")
//   4. pot: a little-rocks grit layer (PhISEM) over the landings; barrel: hoops hit the floor and ring
// All layers share one cause: `intensity` sets crack brightness, fragment count, tear length and scatter.
import {add, scale, peak, filter, noise, phisem, PHISEM, saturate, onePoleLP, bounces} from '../dsp.js';
import {materialModes, strike, contactTrain, contactForce, contactEnv, decayLen, tailFade} from './impact.js';

const PI = Math.PI, G = 9.81, clamp01 = v => Math.max(0, Math.min(1, v)), lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };

// ============================================================================================ helpers (kernel candidates)
// a noise burst whose envelope follows a contact (see impact.js contactEnv), band-limited. The buffer length comes from
// the decay (to ~-78 dB, impact.js decayLen) and ends in a short fade: no burst is ever cut off mid-decay.
function crackNoise(sr, R, {tc = .0004, decay = .01, color = 'pink', bp = null, q = .7, hp = null, lp = null}) {
  const n = decayLen(sr, tc, decay), b = noise(n, R, color), e = contactEnv(n, sr, tc, decay);
  for (let i = 0; i < n; i++) b[i] *= e[i];
  if (bp) filter(b, 'bandpass', bp, q, sr); if (hp) filter(b, 'highpass', hp, .7071, sr); if (lp) filter(b, 'lowpass', lp, .7071, sr);
  return tailFade(b, sr);
}
// click train: micro-snaps at intervals drawn from [dMin, dMax] s over `len` s, with a peaky decaying amplitude; the
// interval grows by (1 + thin·u) as the train runs out (dense at first, then thinning). Each click is a 0.2-0.8 ms
// decaying noise grain (a fibre bundle failing is broadband, not a delta). Returns a sparse excitation buffer.
function clickTrain(len, sr, R, {dMin = .001, dMax = .005, thin = 1.5, shape = 1.5, peaky = 1.6, grain = [.0002, .0008]} = {}) {
  const n = Math.round(len * sr), gmax = Math.round(grain[1] * sr * 6), b = new Float32Array(n + gmax);
  for (let t = R.range(0, dMin); t < len; t += R.range(dMin, dMax) * (1 + thin * (t / len))) {
    const i = Math.round(t * sr), a = Math.pow(1 - t / len, shape) * R.pow(.15, 1, peaky), d = R.range(grain[0], grain[1]) * sr;
    for (let k = 0; k < gmax; k++) b[i + k] += a * (R() * 2 - 1) * Math.exp(-k / d);
  }
  return b;
}
// one tear: the click train, band-coloured, over a quieter noise bed that follows the same thinning envelope (fibres
// rubbing), plus the plank modes it rings. Added into `out` at t0; every part decays out (no truncated buffers).
function tear(out, sr, R, t0, len, {fc, dMin, dMax, thin, level, bed, plankF}) {
  const tr = clickTrain(len, sr, R, {dMin, dMax, thin}), i0 = Math.round(t0 * sr);
  const col = tailFade(filter(filter(tr.slice(), 'bandpass', fc, R.range(1.2, 2.5), sr), 'highpass', 700, .7071, sr), sr);
  add(out, norm(col), i0, level);
  if (bed) {
    const bn = tr.length + Math.round(.03 * sr), b = noise(bn, R, 'pink'), nr = Math.round(len * sr);
    for (let i = 0; i < bn; i++) { const u = i / nr; b[i] *= u < 1 ? Math.pow(1 - u, 1.8) * Math.min(1, i / (.002 * sr)) : 0; }
    add(out, norm(tailFade(filter(b, 'bandpass', fc * R.range(.6, .9), .7, sr), sr)), i0, level * bed);
  }
  const pm = materialModes('wood', plankF, R, {count: 5, qMul: .7}), tmax = Math.max(...pm.map(m => m.t60));
  const ring = strike(new Float32Array(tr.length + Math.round(1.4 * tmax * sr)), sr, 0, pm, {exc: tr});
  add(out, norm(ring), i0, level * R.range(.25, .45));
}

// radiation-efficiency high-pass (2nd order, soft knee): small radiators lose their lows
function radHP(b, fc, sr) { return filter(b, 'highpass', fc, .5, sr); }

// ============================================================================================ objects
const OBJ = {
  crate: {mat: 'wood', dur: 1.3, f0: [260, 480], parts: [4, 6], big: [2, 4], small: [4, 14], smallAmp: .55, e: [.4, .6], eSmall: [.3, .5], tears: [1, 2], tearBP: [1000, 6000]},
  pot: {mat: 'clay', dur: 1.15, f0: [480, 800], parts: [1, 1], big: [2, 4], small: [10, 26], smallAmp: .8, e: [.3, .5], eSmall: [.3, .5], tears: [0, 0]},
  barrel: {mat: 'wood', dur: 1.7, f0: [80, 250], parts: [3, 4], big: [4, 7], small: [3, 8], smallAmp: .55, e: [.4, .6], eSmall: [.3, .5], tears: [0, 2], tearBP: [900, 3500]},
};

function render(p, R, sr) {
  const kind = OBJ[p.object] ? p.object : 'crate', O = OBJ[kind], I = clamp01(p.intensity), S = Math.max(.4, p.size), H = Math.max(.1, p.height);
  const n = Math.round(O.dur * sr), out = new Float32Array(n), hard = Math.pow(I, .7);
  const tc = (O.mat === 'clay' ? lerp(.6e-3, .2e-3, hard) : lerp(2e-3, .6e-3, hard)) * R.jit(.15);

  // ---- 1. the blow: parent modes + crack burst
  const parents = [], pf = [], hoops = [];
  for (let k = R.int(O.parts[0], O.parts[1]); k > 0; k--) {
    const f0 = R.range(O.f0[0], O.f0[1]) / S; pf.push(f0);
    const m = materialModes(O.mat, f0, R, {qMul: O.mat === 'clay' ? .45 : .6}); parents.push(m);
    strike(out, sr, parents.length === 1 ? 0 : R.range(0, .004), m, {exc: contactForce(tc * R.jit(.2), sr, R, .3), amp: parents.length === 1 ? 1 : R.range(.35, .8)});
  }
  // radiation efficiency: a panel of radius a radiates poorly below ≈ c/(2πa) (acoustic short-circuit), so the
  // failing planks' low modes are heard thinner than they vibrate. Barrel staves form a large closed body: lower corner.
  radHP(out, (kind === 'barrel' ? 70 : R.range(170, 240)) / S, sr);
  norm(out, .9);
  const crack = crackNoise(sr, R, {tc: tc * .5, decay: (O.mat === 'clay' ? R.range(.006, .015) : R.range(.015, .035)) * lerp(.8, 1.3, I), color: 'pink',
    bp: (O.mat === 'clay' ? R.range(2500, 4500) : R.range(1400, 3000)) * lerp(.8, 1.15, hard), q: .6});
  add(out, norm(crack), 0, R.range(1, 1.4));
  add(out, norm(crackNoise(sr, R, {tc: .1e-3, decay: R.range(.001, .003), color: 'white', hp: 4000})), 0, R.range(.25, .5) * hard);   // the snap
  if (kind === 'barrel') {   // hollow body boom + the hoops ringing from the blow
    strike(out, sr, 0, [{f: R.range(60, 110), t60: R.range(.08, .16), a: 1}], {exc: contactForce(4e-3, sr, R, .1), amp: R.range(.4, .7)});
    // hoops: free-ring material q is 300-1000, but pressed onto the staves (and later lying on the floor) the contact
    // damps them: qMul .4 while mounted, .6 when dropped (it rings between bounces, then settles)
    for (let h = R.int(2, 3); h > 0; h--) hoops.push({f0: R.range(22, 45) / S, x: R.range(.05, .45)});
    for (const hp of hoops) strike(out, sr, R.range(.001, .006), materialModes('hoop', hp.f0, R, {count: 12, x: hp.x, qMul: .4}), {tc: .25e-3, amp: R.range(.08, .16)});
  }

  // ---- 2. fracture
  if (O.mat === 'wood') {
    // the main split: ONE continuous splintering tear from the blow, 80-200 ms, dense at first (0.3-1.5 ms apart) and
    // thinning out (to ~2-10 ms apart), over a fibre-rubbing noise bed
    const len = R.range(.08, .2) * lerp(.8, 1.1, I);
    tear(out, sr, R, R.range(0, .004), len, {fc: R.range(O.tearBP[0], O.tearBP[1] * .7), dMin: .0003, dMax: .0015, thin: 6, level: R.range(.7, .95), bed: R.range(.35, .55), plankF: R.pick(pf) * R.range(1.5, 3)});
    // 0-2 later, shorter splits as loosened boards give way: they carry the sound into the fall
    for (let k = R.int(O.tears[0], O.tears[1]); k > 0; k--)
      tear(out, sr, R, R.range(.06, .18), R.range(.04, .1), {fc: R.range(O.tearBP[0], O.tearBP[1]), dMin: .001, dMax: .004, thin: 3, level: R.range(.25, .45), bed: .3, plankF: R.pick(pf) * R.range(1.5, 4)});
  }
  if (O.mat === 'clay') {   // brittle: 2-5 fast secondary cracks as the shell splits, each re-exciting the failing shell
    for (let k = R.int(2, 5), t = 0; k > 0; k--) {
      t += R.range(.002, .012);
      strike(out, sr, t, R.pick(parents), {tc: .15e-3, amp: R.range(.15, .4)});
      add(out, norm(crackNoise(sr, R, {tc: .1e-3, decay: R.range(.001, .003), color: 'white', bp: R.range(3000, 7000), q: .8})), Math.round(t * sr), R.range(.2, .45));
    }
  }

  // ---- 3. debris: fall, land, bounce
  const frags = [];
  for (let k = R.int(O.big[0], O.big[1]); k > 0; k--) frags.push({s: R.range(.35, 1), big: true});
  const nSmall = Math.round(lerp(O.small[0], O.small[1], I) * R.jit(.2));
  for (let k = 0; k < nSmall; k++) frags.push({s: R.pow(.04, .35, 2), big: false});
  const debris = new Float32Array(n), clicks = new Float32Array(n), floor = new Float32Array(n), vRef = Math.sqrt(2 * G * H);
  let firstLand = 9;
  for (const fr of frags) {
    // fall time from the piece's height, ±30-80 ms spread; some pieces are thrown up by the blow first (vy > 0)
    const h = H * R.range(.45, 1.15), vy = R() < .25 * I ? R.range(.5, 2) : 0;
    const tl = Math.max(.1, (vy + Math.sqrt(vy * vy + 2 * G * h)) / G + R.sign() * R.range(.03, .08) * R());
    const v0 = Math.sqrt(vy * vy + 2 * G * h);
    firstLand = Math.min(firstLand, tl);
    const f0 = (kind === 'barrel' && fr.big ? R.range(80, 250) : R.pick(pf)) / fr.s;
    // pieces lying on the floor are damped by the contact: lossier than free (qMul < 1)
    const modes = materialModes(O.mat, f0, R, {count: fr.s > .3 ? 8 : fr.s > .1 ? 5 : 3, qMul: fr.big ? .45 : .7});
    const e = fr.big ? R.range(O.e[0], O.e[1]) : R.range(O.eSmall[0], O.eSmall[1]);
    // flat planks and shards tumble and slide rather than bounce high: at most 3 bounces before they settle
    const seq = bounces(R, {t0: tl, v0: v0 / vRef, e, dt0: 2 * e * v0 / G * R.range(.2, .55), minV: .2, jitter: .25, max: 3});
    const hits = [], tcBase = O.mat === 'clay' ? .25e-3 : .9e-3;
    for (const b of seq) {
      const amp = fr.s * b.v * (fr.big ? .8 : O.smallAmp), tcb = tcBase * (1 + .6 * (1 - Math.min(1, b.v))) * R.jit(.2);
      hits.push({t: b.t, amp, tc: tcb});
      if (fr.big && b === seq[0]) {   // a long piece lands end-then-end, and thumps the floor
        hits.push({t: b.t + R.range(.006, .03), amp: amp * R.range(.5, .9), tc: tcb * 1.3});
        strike(floor, sr, b.t, [{f: R.range(70, 130), t60: R.range(.03, .06), a: 1}], {exc: contactForce(4e-3, sr, R, .1), amp: amp * fr.s});
      }
      // the contact click itself (surface noise at the landing): a short natural decay (wood 4-10 ms, clay 2-6 ms)
      add(clicks, crackNoise(sr, R, {tc: tcb, decay: O.mat === 'clay' ? R.range(.002, .006) : R.range(.004, .01), color: O.mat === 'clay' ? 'white' : 'pink',
        bp: O.mat === 'clay' ? R.range(3000, 7000) : R.range(1200, 3500), q: .7}), Math.round(b.t * sr), Math.sqrt(fr.s) * b.v * (fr.big ? 1 : O.smallAmp));
    }
    const {exc, t0} = contactTrain(hits, sr, R, .08);   // low roughness: the landing's highs come from the modes, not broadband
    strike(debris, sr, t0, modes, {exc});
  }
  if (kind === 'barrel') {   // a hoop drops and rings on the floor
    for (const hp of hoops.slice(0, R.int(1, 2))) {
      const hm = materialModes('hoop', hp.f0, R, {count: 10, x: R.range(.05, .45), qMul: .6});
      const seq = bounces(R, {t0: firstLand + R.range(.04, .25), v0: 1, e: R.range(.5, .7), dt0: R.range(.06, .12), minV: .2, jitter: .3, max: 4});
      const {exc, t0} = contactTrain(seq.map(b => ({t: b.t, amp: b.v, tc: .3e-3})), sr, R, .3);
      strike(debris, sr, t0, hm, {exc, amp: R.range(.06, .12)});
    }
  }
  radHP(debris, (kind === 'barrel' ? 90 : 300) / S, sr);   // pieces are smaller than the object: thinner still
  const dp = peak(debris) || 1;
  add(debris, floor, 0, R.range(.12, .25) * dp / (peak(floor) || 1));
  add(debris, clicks, 0, R.range(.6, 1) * dp / (peak(clicks) || 1));
  add(out, debris, 0, R.range(.7, 1.1) * .9 / Math.max(1e-9, peak(debris)) * Math.min(1, .6 + .4 * I));

  // ---- 4. pot: grit (little rocks / clay crumbs) at the break and over the landings
  if (kind === 'pot') {
    const gn = n, en = new Float32Array(gn), t0 = Math.round(firstLand * sr), d1 = R.range(.02, .04) * sr, d2 = R.range(.12, .25) * sr;
    const e0 = t0 + 3 * d2, e1 = t0 + 4.5 * d2;   // the grit energy reaches exactly zero (no stray late grains)
    for (let i = 0; i < gn; i++) {
      en[i] = .6 * Math.exp(-i / d1) + (i >= t0 ? Math.exp(-(i - t0) / d2) * Math.min(1, (i - t0) / (.004 * sr)) : 0);
      if (i > e0) en[i] *= i >= e1 ? 0 : .5 + .5 * Math.cos(PI * (i - e0) / (e1 - e0));
    }
    const grit = phisem(gn, sr, R, {...PHISEM.littleRocks, res: [[R.range(5000, 8000), .85, 1]], energy: en});
    add(out, norm(filter(grit, 'highpass', 1500, .7071, sr)), 0, R.range(.12, .22));
  }

  // the render window ends before a dropped hoop has fully rung out: a raised-cosine fade over the last 25 %
  const nf = Math.round(n * .25); for (let i = 0; i < nf; i++) out[n - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  onePoleLP(out, 16000, sr);
  filter(out, 'highpass', 35, .7071, sr);
  return saturate(norm(out, .9), 1.3);
}

export default {
  id: 'crate_break', version: 2, desc: 'Breakables: crack + parent modes, fracture (fibre tearing / brittle cracks), falling and bouncing fragments',
  params: {
    object: {values: ['crate', 'pot', 'barrel'], def: 'crate'},
    intensity: {min: 0, max: 1, def: .8},   // harder blow: brighter crack, more fragments, longer tearing
    size: {min: .5, max: 2, def: 1},        // object scale: modes ∝ 1/size
    height: {min: .2, max: 1.2, def: .5},   // fall height of the pieces (m): first landing ≈ √(2h/g)
  },
  cases: {crate: {object: 'crate'}, pot: {object: 'pot', height: .45}, barrel: {object: 'barrel', height: .7}},
  variants: 4,
  render,
  // pass ranges: event structure (onsets = landings), spectral balance vs the crate references (brk.crate_1/2: centroid
  // 1989/1770 Hz, band 469-5016/656-4195 Hz, onsets 4/2, t60 891/808 ms), checked against 16-seed spreads
  criteria: {
    crate: {attackMs: [0, 10], t60Ms: [400, 2500], durMs: [550, 1300], centroidHz: [1000, 2800], lowHz: [200, 700], highHz: [3000, 8000], flatness: [.05, .3], onsetCount: [2, 10], clickEnd: [0, .01]},
    pot: {attackMs: [0, 5], durMs: [500, 1200], centroidHz: [1300, 4000], lowHz: [350, 900], highHz: [5000, 12000], flatness: [.07, .5], onsetCount: [1, 12], clickEnd: [0, .01]},
    barrel: {attackMs: [0, 20], durMs: [1000, 1750], centroidHz: [500, 1600], lowHz: [50, 250], highHz: [1800, 6000], onsetCount: [1, 10], clickEnd: [0, .01]},
  },
  refs: {crate: ['assets/sfx/brk.crate_1.mp3', 'assets/sfx/brk.crate_2.mp3']},
  notes: 'modal fracture + debris (Zheng & James fracture sound; van den Doel modal; Cook PhISEM grit); reuses impact.js materials',
};
