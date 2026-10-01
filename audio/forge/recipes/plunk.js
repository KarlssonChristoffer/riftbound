// PLUNK recipe: the original 'splash' v1, preserved unchanged (rated 5/5, kept for repurposing: a tonal, bubbly
// water entry with the musical cavity "bloop"). 'splash' v2 is now the plainer, noisier game splash.
// For a given (case, seed) it renders exactly what splash v1 rendered (seedId 'splash'; renderPlunk is v1's render).
//
// (splash v1 header follows) something entering shallow water, as mono one-shots (docs/AUDIO.md §2.3, water).
//
// Model: the three phases of a water entry (Richardson 1948; Moss et al. "Sounding Liquids" 2010; van den Doel 2005):
//   1. IMPACT: the first contact is a short broadband slap, LP noise of 5-30 ms whose cutoff falls as the object gets
//      bigger (a bigger, blunter body has a longer contact); a body adds a low thump.
//   2. CAVITY + BUBBLE CLOUD: the object drags an air cavity down; the splash entrains 20-200 small bubbles over
//      50-400 ms at a decaying rate (Minnaert f0 = 3/r, power-law radii, rising pitch: dsp.bubble). When the cavity
//      pinches off it rings as one large "plunk" bubble with a strong upward chirp (the classic "bloop"): one for an
//      arrow, 2-3 for a body. A foot at the shallow edge makes no deep cavity, so no plunk.
//   3. FALL-BACK: the thrown-up water comes down 150-600 ms later as drips: a tiny contact tick, and about half of them
//      entrain a small bubble ("plink").
//   Big adds the heavier body slosh (noise swelling through a LP that closes from ~800 to ~200 Hz, wobbling at the
//   3-6 Hz of the displaced water) and a sheet/crown spray (BP noise 1.5-7 kHz); the step gets a small slosh.
// Params are continuous (size, depth) so the game can ask for anything between the cases; cases pick the presets.
// One randomness shared by cause: `energy` (per variant) scales the slap, the cloud size and the number of drips.
import {Biquad, bubble, sweep, peak, scale, saturate} from '../dsp.js';

const MM = .001;
// noise burst with a linear attack and an exponential decay (1/e time d), in place into out at t0
function addBurst(out, sr, R, t0, {a = .0004, d = .005, len = 7 * d, g = 1, lp = null, hp = null, q = .7071} = {}) {
  const i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round((a + len) * sr)), na = Math.max(1, Math.round(a * sr));
  if (n <= 0) return;
  const fl = lp ? new Biquad('lowpass', lp, q, sr) : null, fh = hp ? new Biquad('highpass', hp, q, sr) : null;
  for (let i = 0; i < n; i++) {
    let v = R() * 2 - 1; if (fl) v = fl.process(v); if (fh) v = fh.process(v);
    out[i0 + i] += v * g * (i < na ? i / na : Math.exp(-(i - na) / (d * sr)));
  }
}

// The forge seeds R from hash((seedId || id) + ':' + case) and the seed: seedId 'splash' makes plunk seed N render exactly
// splash v1 seed N (same cases, same render code, same RNG draw order).
const CRITERIA = {   // splash v1's criteria, re-checked on 30 seeds (1-24 + 44291-44296) with the current forge trim, with margin. attack = 10->90% of the PEAK, which for small/step is sometimes the plunk
    // or a cloud bubble ~20 ms after the slap (the onset itself is always the slap at t = 0). t60 is long because the
    // drips keep the energy decay curve up for 150-600 ms.
    small: {attackMs: [0, 30], durMs: [220, 650], t60Ms: [300, 1400], centroidHz: [1500, 2700], lowHz: [650, 1400], highHz: [3800, 7800], flatness: [.03, .1]},
    big: {attackMs: [0, 60], durMs: [1100, 1800], t60Ms: [600, 2400], centroidHz: [1550, 2400], lowHz: [50, 260], highHz: [6000, 8200], flatness: [.12, .22]},
    step: {attackMs: [0, 30], durMs: [420, 720], t60Ms: [500, 1500], centroidHz: [1900, 4100], lowHz: [400, 1400], highHz: [6000, 9500], flatness: [.08, .26]},
};

export default {
  id: 'plunk', seedId: 'splash', version: 1, desc: 'Tonal water entry (splash v1): slap, bubble cloud + cavity bloop, drips, slosh',
  params: {
    size: {min: 0, max: 1, def: .15},     // 0 = pebble/arrow, 1 = a whole body: slap cutoff, cloud size, plunk pitch, drips, slosh
    depth: {min: 0, max: 1, def: .7},     // how deep the entry goes: cavity plunk (> .35) and how many bubbles are entrained
  },
  cases: {
    small: {size: .15, depth: .7},        // an arrow plopping into the stream
    big: {size: 1, depth: .9},            // the player falling in
    step: {size: .45, depth: .15},        // a foot splashing at the shallow edge
  },
  variants: 6,
  render: renderPlunk,
  criteria: CRITERIA,
  notes: 'splash v1 (Richardson 3-phase water entry: LP-noise slap, van den Doel bubble cloud + cavity plunk, fall-back drips; big adds slosh + crown spray), preserved as plunk',
};

// splash v1 render, unchanged
export function renderPlunk(p, R, sr) {
  {
    const size = Math.min(1, Math.max(0, p.size)), depth = Math.min(1, Math.max(0, p.depth)), energy = R.range(.8, 1.2);
    const dur = .8 + 1 * size, n = Math.round(dur * sr), out = new Float32Array(n);

    // ---- 1. impact slap: LP noise, 5-30 ms, cutoff ∝ 1/size; a body adds a low thump
    const Ri = R.fork(1), impD = (.0025 + .009 * size) * Ri.jit(.2), fc = 1100 / (.13 + size) * Ri.jit(.15);
    addBurst(out, sr, Ri, 0, {a: .0003 + .0015 * size, d: impD, len: 5 * impD, g: (1.4 + .8 * (1 - size)) * energy, lp: fc, q: .8});
    addBurst(out, sr, Ri, .0015, {a: .0002, d: impD * .5, len: 3 * impD, g: .5 * energy, lp: fc * 1.8, hp: fc * .5});   // second, brighter micro-slap
    if (size > .4) {   // the body's thump: a heavily damped low pulse
      const f = Ri.range(55, 85), T = .06 + .05 * size, g = .9 * (size - .4) * energy;
      for (let i = 0, N = Math.round(T * sr); i < N; i++) { const t = i / sr; out[i] += g * Math.sin(2 * Math.PI * f * t * (1 - .25 * t / T)) * Math.sin(Math.PI * Math.min(1, t / .006) / 2) * Math.exp(-t / (T * .3)); }
    }

    // ---- 2a. bubble cloud: 20-200 bubbles over 50-400 ms at a decaying rate
    const Rc = R.fork(2), nb = Math.round((20 + 180 * Math.pow(size, 1.3)) * (.4 + .6 * depth) * energy);
    const Tc = .05 + .35 * size, rTop = (1.5 + 5 * size) * MM;
    for (let k = 0; k < nb; k++) {
      let t = -Math.log(1 - Rc() * (1 - Math.exp(-3))) * Tc / 3;   // exponential rate, truncated at Tc
      t += .002 + Rc.range(0, .006);
      const r = Rc.pow(.3 * MM, rTop, 2.4), a = .55 * Math.pow(r / MM, .5) * Rc.range(.3, 1) * Math.exp(-1.2 * t / Tc);
      bubble(out, sr, t, r, a, {xi: Rc.range(.08, .2), dampMul: 1 + Math.pow(r / (4 * MM), 1.5)});
    }
    // ---- 2b. the cavity plunk(s): large bubbles with a strong upward chirp
    if (depth > .35) {
      const Rp = R.fork(3), np = size > .6 ? Rp.int(2, 3) : 1;
      for (let k = 0; k < np; k++) {
        const r = (2.4 + 12 * Math.pow(size, 1.5)) * MM * (k ? Rp.range(.45, .8) : Rp.jit(.18));
        const t = (.012 + .08 * size) * Rp.jit(.25) + (k ? Rp.range(.04, .2) : 0);
        bubble(out, sr, t, r, (k ? .3 : .5) * Rp.range(.8, 1.1) * (.5 + depth * .5), {xi: Rp.range(.18, .32), dampMul: Rp.range(.8, 1.1) * (1 + 1.2 * size * size)});   // a big cavity is ragged: damped harder
      }
    }

    // ---- 2c. a body sinking lets air escape from clothes and gear: a few slow big glugs
    if (size > .6 && depth > .35) {
      const Rg = R.fork(6), ng = Rg.int(3, 6); let t = Rg.range(.12, .2);
      for (let k = 0; k < ng; k++) { bubble(out, sr, t, Rg.range(4, 9) * MM, Rg.range(.12, .3) * (size - .4), {xi: Rg.range(.1, .2), dampMul: Rg.range(1.5, 2.5)}); t += Rg.range(.04, .16); }
    }

    // ---- 3. fall-back drips 150-600 ms later: tick + (half the time) a small entrained bubble
    const Rd = R.fork(4), nd = Math.round((2 + 26 * Math.pow(size, 1.3)) * energy);
    for (let k = 0; k < nd; k++) {
      const t = .15 + .45 * Math.pow(Rd(), 1.4) * (.6 + .4 * size), g = Rd.range(.05, .2) * (1.2 - t);
      addBurst(out, sr, Rd, t, {a: .0002, d: Rd.range(.0004, .0012), g, lp: Rd.range(4000, 9000)});
      if (Rd() < .5) bubble(out, sr, t + Rd.range(.001, .004), Rd.pow(.5 * MM, 2.6 * MM, 2), g * Rd.range(.8, 1.8), {xi: Rd.range(.1, .25)});
    }

    // ---- 4. slosh (big; a little for the step) and the crown/sheet spray
    const Rs = R.fork(5), sl = Math.max(0, size - .3) / .7;
    if (sl > 0) {
      const T = .25 + .75 * sl, pk = .03 + .1 * sl, m = Math.round((pk + 7 * T * .22) * sr), b = new Float32Array(m), w1 = Rs.range(3, 6), w2 = Rs.range(1.5, 3), ph = Rs() * 6;
      for (let i = 0; i < m; i++) b[i] = Rs() * 2 - 1;
      sweep(b, 'lowpass', t => 200 + 600 * (1 + .6 * (1 - sl)) * Math.exp(-t / (T * .35)), .9, sr);
      sweep(b, 'highpass', () => 70, .7, sr, {every: 4096});
      for (let i = 0; i < m; i++) {
        const t = i / sr, env = t < pk ? Math.pow(t / pk, 1.5) : Math.exp(-(t - pk) / (T * .22));
        out[i] += b[i] * env * (1 + .35 * Math.sin(2 * Math.PI * w1 * t + ph) + .2 * Math.sin(2 * Math.PI * w2 * t)) * (.4 + .5 * (1 - sl)) * sl * energy;   // a small slosh is relatively fuller
      }
      // the crown / thrown sheet: BP noise that swells and hisses away
      addBurst(out, sr, Rs, .008, {a: .012 + .02 * sl, d: .04 + .08 * sl, g: .6 * sl * energy, lp: 7000, hp: 1500});
    }
    // gentle tanh glue (realism checklist): rounds the slap's spike so variants sit at an even loudness
    const pk = peak(out); if (pk > 0) scale(saturate(scale(out, 1 / pk), 1.4), pk);
    return out;
  }
}
