// FOOTSTEP: the ranger's leather boots on the biome floors. One step = a ground-reaction-force (GRF) exciter driving a
// surface model, plus the boot itself:
//   GRF: heel strike -> roll -> toe push-off. Heel-toe gap 60-150 ms (shorter when running), toe ≈ -9 dB with a softer contact. As impulses
//        (half-sine contacts; contact time sets brightness) for the solid surfaces, and as a smooth energy envelope
//        (fast rise, 20-60 ms fall, a low plateau through the roll) for the granular ones (PhISEM "shake energy").
//   stone:   heel modes 200-2500 Hz, q 5-20, a grit burst proportional to the exciter, a soft 2-3 kHz scuff (LP ~4 kHz) at the push-off, mostly when running
//   grass:   dense PhISEM grains (200-1000) at 2.5-5 kHz with low q, an HP swish of blades brushing the boot, a faint thud
//   gravel:  3 PhISEM layers at ~0.8 / 2.5 / 6 kHz, with a short settling trickle after the step
//   snow:    PhISEM 1-4 kHz over a slower compression, crumpling micro-clicks (Poisson, rate ∝ load), sometimes a
//            1-2 kHz stick-slip squeak, everything LP 5 kHz
//   crystal: glass-mode taps (2-6 kHz, high q, beating pairs) from shards under the sole + sparse sleigh-bell grains,
//            on a stone floor
//   boot:    for every surface, a soft 120-400 Hz body thump (leather + foot mass, low q, slow contact)
//   landing: two heel events 10-30 ms apart (both feet), ×2-3 amplitude, slower contacts, a cloth thump; no toe roll
// Every call draws fresh modes, timings, contact times and grain streams, so no two steps are identical.
import {add, scale, peak, filter, halfSine, modal, burst, pink, white, phisem, poisson, saturate, t60FromQ} from '../dsp.js';

const lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };

// the GRF as discrete contacts: [{t, amp, tc, kind}] (t in s from the buffer start)
function gait(R, {weight, speed, land, t0}) {
  const ev = [], W = weight * (land ? R.range(2, 3) : 1);
  if (land) {
    const dt = R.range(.01, .03);                                  // the second foot
    ev.push({t: t0, amp: W, tc: R.range(.0011, .0018), kind: 'heel'});
    ev.push({t: t0 + dt, amp: W * R.range(.65, .95), tc: R.range(.0011, .002), kind: 'heel'});
    ev.push({t: t0 + dt + R.range(.04, .07), amp: W * R.range(.18, .28), tc: R.range(.002, .0035), kind: 'flat'});   // soles flatten
  } else {
    const gap = lerp(.14, .065, speed) * R.jit(.15);
    ev.push({t: t0, amp: W, tc: lerp(.0009, .0005, speed) * R.jit(.25), kind: 'heel'});
    ev.push({t: t0 + gap, amp: W * .355 * R.jit(.2) * (1 + .35 * speed), tc: R.range(.0016, .0028), kind: 'toe'});
  }
  return ev;
}
// the same contacts as a sampled force: half-sine pulses (the modal exciter); tcMul stretches every contact
function force(ev, sr, n, {tcMul = 1, only = null} = {}) {
  const x = new Float32Array(n);
  for (const e of ev) if (!only || only.includes(e.kind)) add(x, halfSine(e.tc * tcMul, sr), e.t * sr, e.amp);
  return x;
}
// the load as a smooth energy envelope for granular surfaces: rise `rise`, 1/e fall `fall`, plateau `roll` between
function load(ev, sr, n, {rise = .003, fall = .035, roll = .2} = {}) {
  const E = new Float32Array(n), t0 = ev[0].t, t1 = ev[ev.length - 1].t, a0 = ev[0].amp;
  for (let i = 0; i < n; i++) {
    const t = i / sr; let v = t > t0 && t < t1 ? roll * a0 : 0;
    for (const e of ev) { const u = t - e.t; if (u > 0) v += e.amp * (u < rise ? u / rise : Math.exp(-(u - rise) / fall)); }
    E[i] = v;
  }
  return E;
}
// the boot: leather + foot mass, a soft low-q body thump 120-400 Hz, driven by slow contacts
function boot(R, ev, sr, n, {land = false} = {}) {
  const f1 = R.range(120, 165) * (land ? .85 : 1), q = R.range(2, 4);
  const modes = [
    {f: f1, t60: t60FromQ(q, f1), a: 1},
    {f: f1 * R.range(1.55, 1.9), t60: t60FromQ(q * 1.2, f1 * 1.7), a: .55 * R.jit(.25)},
    {f: R.range(300, 400), t60: t60FromQ(q * 1.5, 350), a: .3 * R.jit(.3)},
  ];
  return modal(force(ev, sr, n, {tcMul: land ? R.range(3.5, 5) : R.range(5, 8)}), modes, sr, n);
}
// a band of noise with a raised-sine window (scuffs, swishes, cloth)
function band(R, sr, n, {at, dur, f, q = .8, hp = 0, lp = 0, color = 'pink'}) {
  const m = Math.round(dur * sr), b = color === 'pink' ? pink(m, R) : white(m, R);
  if (f) filter(b, 'bandpass', f, q, sr); if (hp) filter(b, 'highpass', hp, .7, sr); if (lp) filter(b, 'lowpass', lp, .7, sr);
  for (let i = 0; i < m; i++) b[i] *= Math.sin(Math.PI * i / m) ** 2;
  const o = new Float32Array(n); add(o, norm(b), at * sr); return o;
}

const SURF = {
  stone(R, ev, sr, n, p) {
    // heel/toe modes of the flagstone + the heel's own knock: 8-12 modes 200-2500 Hz, q 5-20, falling with frequency
    const modes = [];
    for (let k = 0, K = R.int(20, 28); k < K; k++) { const f = R.pow(200, 2500, 1), q = R.range(5, 20); modes.push({f, t60: Math.min(.08, t60FromQ(q, f)), a: Math.pow(f / 200, .9) * R.jit(.4)}); }
    const out = norm(modal(force(ev, sr, n), modes, sr, n));
    // grit: a short noise burst per contact, proportional to the exciter (dust + sole texture)
    for (const e of ev) add(out, burst(.03, sr, R, {a: .0004, d: R.range(.003, .006), color: 'pink', bp: R.range(450, 1000), q: .5}), e.t * sr, 1 * e.amp / ev[0].amp);
    // scuff: the sole sliding at the push-off, ~2-3 kHz and LP 3.5-4.5 kHz (leather on stone is not a hiss), a
    // run/weight feature: at a walk it sits ~6 dB under the old level, below the heel's own high end
    const toe = ev.find(e => e.kind !== 'heel') || ev[0], sp = p.speed ?? .3, wt = p.weight ?? .5;
    const scuffG = R.range(.03, .06) * lerp(.35, .7, sp * sp) * Math.sqrt(wt / .5) * (p.land > .5 ? .5 : 1);
    const lpF = R.range(3500, 4500), sc = band(R, sr, n, {at: Math.max(0, toe.t - .015), dur: R.range(.015, .035), f: R.range(1800, 3000), q: .9, lp: lpF});
    add(out, filter(filter(sc, 'lowpass', lpF, .7, sr), 'lowpass', lpF, .7, sr), 0, scuffG);   // 36 dB/oct above the cutoff
    return out;
  },
  grass(R, ev, sr, n) {
    const E = load(ev, sr, n, {rise: .008, fall: R.range(.04, .06), roll: .35});
    const g = phisem(n, sr, R, {objects: R.range(200, 1000), soundDecay: R.range(.9, .95), res: [[R.range(2500, 5000), R.range(.7, .85), 1], [R.range(1200, 2000), .7, .4]], energy: E});
    const out = norm(g);
    // swish: blades brushing the boot, from before the heel lands to after the push-off
    add(out, band(R, sr, n, {at: 0, dur: ev[ev.length - 1].t + R.range(.06, .1), hp: R.range(1800, 2800), lp: 9000}), 0, R.range(.25, .4));
    return out;
  },
  gravel(R, ev, sr, n) {
    const E = load(ev, sr, n, {rise: .004, fall: R.range(.03, .05), roll: .3});
    for (let i = 0, t1 = ev[ev.length - 1].t; i < n; i++) { const u = i / sr - t1; if (u > 0) E[i] += .12 * Math.exp(-u / .08); }   // settling
    const obj = R.range(40, 110), out = new Float32Array(n);
    for (const [f, r, g] of [[800 * R.jit(.2), .9, .8], [2500 * R.jit(.2), .85, 1], [6000 * R.jit(.2), .78, .5]])
      add(out, norm(phisem(n, sr, R, {objects: obj * R.jit(.3), soundDecay: R.range(.95, .97), res: [[f, r, 1]], energy: E})), 0, g * R.jit(.4));
    return norm(out);
  },
  snow(R, ev, sr, n) {
    const E = load(ev, sr, n, {rise: .02, fall: R.range(.05, .08), roll: .5});   // snow compresses slowly
    const out = norm(phisem(n, sr, R, {objects: R.range(60, 180), soundDecay: R.range(.93, .96), res: [[1200 * R.jit(.18), .8, 1], [2500 * R.jit(.18), .75, .8], [3800 * R.jit(.18), .7, .5]], energy: E}));
    // crumpling micro-clicks: crystals of the snowpack breaking, Poisson with the rate following the load
    let Emax = 0; for (const v of E) Emax = Math.max(Emax, v);
    const clicks = new Float32Array(n);
    for (const t of poisson(R, 0, n / sr, t => 350 * E[Math.min(n - 1, Math.round(t * sr))] / Emax)) {
      const i0 = Math.round(t * sr), a = R.pow(.2, 1, 2) * (R() < .5 ? -1 : 1) * Math.sqrt(E[Math.min(n - 1, i0)] / Emax), L = R.int(6, 20);
      for (let i = 0; i < L && i0 + i < n; i++) clicks[i0 + i] += a * (R() * 2 - 1) * (1 - i / L);
    }
    add(out, norm(filter(clicks, 'highpass', R.range(800, 1600), .7, sr)), 0, R.range(.25, .6));
    // squeak (cold snow, ~60%): stick-slip at 1-2 kHz during the roll, a jittery rising tone
    if (R() < .6) {
      const t0 = ev[0].t + R.range(.03, .08), d = R.range(.04, .09), f0 = R.range(1000, 1500), f1 = f0 * R.range(1.1, 1.4), m = Math.round(d * sr), sq = new Float32Array(m);
      let ph = 0; for (let i = 0; i < m; i++) { const u = i / m; ph += (f0 + (f1 - f0) * u) * (1 + .04 * (R() - .5)) / sr; sq[i] = (ph % 1 < .15 ? 1 : 0) * Math.sin(Math.PI * u) ** 2; }
      filter(sq, 'bandpass', (f0 + f1) * .75, 3, sr); add(out, norm(sq), t0 * sr, R.range(.12, .25));
    }
    return filter(norm(out), 'lowpass', R.range(3800, 6000), .7, sr);
  },
  crystal(R, ev, sr, n) {
    // the stone floor underneath, quieter
    const out = scale(SURF.stone(R, ev, sr, n, {speed: .3}), .6);
    // glass taps: 2-5 shards knocked by the sole edge, each a few high-q modes with near-degenerate twins (beating)
    const taps = new Float32Array(n);
    for (let s = 0, S = R.int(2, 5); s < S; s++) {
      const e = R.pick(ev), f0 = R.range(2000, 4200), modes = [];
      for (const [r, a] of [[1, 1], [R.range(1.5, 1.7), .6], [R.range(2.3, 2.7), .35]]) { const f = f0 * r, T = t60FromQ(R.range(500, 1500), f) * .5; modes.push({f, t60: Math.min(.35, T), a}, {f: f + R.range(.5, 3), t60: Math.min(.35, T), a: a * .6}); }
      add(taps, modal(halfSine(R.range(.00015, .0004), sr), modes, sr, Math.round(.45 * sr)), (e.t + R.range(0, .025)) * sr, R.pow(.3, 1, 1.5) * e.amp / ev[0].amp);
    }
    add(out, norm(taps), 0, R.range(.2, .32));
    // sleigh-bell grains: loose crystal grit jingling, sparse
    const E = load(ev, sr, n, {rise: .004, fall: .06, roll: .2});
    add(out, norm(phisem(n, sr, R, {objects: R.range(3, 8), soundDecay: .97, res: [[R.range(2400, 2700), .99, 1], [R.range(5000, 5600), .99, .8], [R.range(6300, 6800), .99, .6]], energy: E})), 0, R.range(.12, .2));
    return out;
  },
};
const BOOT = {stone: .4, grass: .6, gravel: .5, snow: .45, crystal: .7};   // how much of the leather thump each floor lets through

export default {
  id: 'footstep', version: 2, desc: 'Leather-boot footsteps: GRF exciter (heel-roll-toe) driving surface models',
  params: {
    surface: {values: ['stone', 'grass', 'gravel', 'snow', 'crystal'], def: 'stone'},
    weight: {min: .3, max: 1.5, def: .5},                         // walk .5, run .8, land 1.2
    speed: {min: 0, max: 1, def: .3},                             // 0 = slow walk .. 1 = sprint (heel-toe gap, contact time, scuff)
    land: {min: 0, max: 1, def: 0},                               // 1 = landing after a jump
  },
  cases: {
    stone: {surface: 'stone'},
    grass: {surface: 'grass'},
    gravel: {surface: 'gravel'},
    snow: {surface: 'snow'},
    crystal: {surface: 'crystal'},
    land_stone: {surface: 'stone', weight: 1.2, land: 1},
    run_stone: {surface: 'stone', weight: .8, speed: .9},
  },
  variants: 8,
  render(p, R, sr) {
    const land = p.land > .5, s = p.surface;
    const t0 = s === 'grass' ? R.range(.02, .04) : .0005;         // grass: the swish starts before the heel lands
    const ev = gait(R, {weight: p.weight, speed: p.speed, land, t0});
    const n = Math.round((ev[ev.length - 1].t + (s === 'crystal' ? .45 : .3)) * sr);
    const out = SURF[s](R.fork(1), ev, sr, n, p);
    add(out, norm(boot(R.fork(2), ev, sr, n, {land})), 0, BOOT[s] * (land ? 1.4 : 1));
    if (land) add(out, band(R.fork(3), sr, n, {at: 0, dur: R.range(.15, .25), f: R.range(400, 1200), q: .7, lp: 3000}), 0, R.range(.04, .07));   // cloth
    filter(out, 'highpass', land ? 50 : 75, .7, sr);                // a boot on a floor has little below ~80 Hz; a landing does
    return saturate(norm(out, .9), 1.3);
  },
  criteria: {
    // stone/run/land: the toe sits at -9 dB with a softer contact, so the onset detector may not see it
    stone: {attackMs: [0, 4], crest: [14, 24], t60Ms: [100, 480], centroidHz: [170, 500], lowHz: [40, 200], highHz: [300, 1200], flatness: [0, .05], durMs: [150, 320], onsetCount: [0, 2], clickEnd: [0, .01]},
    grass: {attackMs: [0, 15], t60Ms: [200, 450], centroidHz: [2000, 4200], lowHz: [60, 250], highHz: [6000, 10000], flatness: [.12, .5], durMs: [250, 420], onsetCount: [0, 2], clickEnd: [0, .01]},
    gravel: {attackMs: [0, 12], t60Ms: [250, 550], centroidHz: [1200, 2800], lowHz: [60, 250], highHz: [4000, 8000], flatness: [.05, .3], durMs: [280, 420], onsetCount: [0, 3], clickEnd: [0, .01]},
    snow: {attackMs: [5, 50], t60Ms: [220, 480], centroidHz: [1100, 2000], lowHz: [100, 300], highHz: [3000, 4800], durMs: [280, 480], onsetCount: [0, 2], clickEnd: [0, .01]},
    crystal: {attackMs: [0, 15], t60Ms: [200, 700], centroidHz: [900, 3300], lowHz: [50, 300], highHz: [2500, 6500], durMs: [280, 560], onsetCount: [0, 3], clickEnd: [0, .01]},
    // landing: the two heels land 10-30 ms apart, closer than the onset detector resolves (40 ms), so 0-1 onsets
    land_stone: {attackMs: [0, 20], crest: [10, 20], t60Ms: [150, 500], centroidHz: [140, 300], lowHz: [30, 100], highHz: [250, 1000], durMs: [140, 300], onsetCount: [0, 2], clickEnd: [0, .01]},
    run_stone: {attackMs: [0, 4], crest: [14, 24], t60Ms: [40, 350], centroidHz: [200, 600], lowHz: [40, 120], highHz: [300, 3200], durMs: [100, 240], onsetCount: [1, 2], clickEnd: [0, .01]},
  },
  refs: {stone: ['assets/sfx/step.ruins_stone_1.mp3', 'assets/sfx/step.ruins_stone_2.mp3']},
  notes: 'GRF exciter (heel/roll/toe) into modal stone, PhISEM (Cook) grass/gravel/snow, glass modes + sleigh-bell grains for crystal; see docs/AUDIO.md §2.3',
};
