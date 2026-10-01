// FOOTSTEP: a light, agile ranger in soft leather boots (stealthy, nimble footfalls, not boots on a parade ground).
// One step = a ground-reaction-force (GRF) exciter driving a surface model, plus a little of the boot itself:
//   GRF: a light heel touch -> a gentle roll over the mid-sole -> a soft toe push-off. Heel-toe gap 45-100 ms (shorter
//        when running), toe ≈ -10 dB with a soft contact. As half-sine contacts (contact time sets brightness) for the
//        solid surfaces, and as a smooth load envelope (PhISEM "shake energy") for the granular ones.
//   stone:   a soft, muted leather pad: a short heel tap (modes 300-2500 Hz, q 4-10, gone in ~40 ms, a 1.2-1.8 ms
//            contact), dark grit per contact (0.6-1.3 kHz), a faint sole-roll brush (1-2 kHz, LP 2.5-3.2 kHz) and a
//            push-off scuff that grows with speed
//   grass:   a soft brush: low-q PhISEM grains at 1.5-3 kHz under a dark blade swish (HP 0.6-1.2 kHz, LP 3-4.5 kHz)
//   gravel:  a fine crunch: 3 PhISEM layers at ~0.9 / 1.9 / 3.6 kHz and a brief settle
//   snow:    a fine crunch: PhISEM 0.8-2.6 kHz over a quick compression, Poisson micro-clicks (rate ∝ load),
//            sometimes a 0.9-1.6 kHz squeak, LP 2.8-3.8 kHz (24 dB/oct)
//   crystal: soft ticks: small glass taps (1.5-3.2 kHz, beating twins, softer 0.3-0.6 ms contacts) + sparse, low
//            bell grains on a faint floor
//   boot:    only a trace of body (170-350 Hz, low q) under everything; the floors are high-passed at 120-160 Hz
//   landing: a nimble one: the two feet 15-35 ms apart, light contacts, the soles rolling flat as the knees bend, a
//            soft cloth swish; a little more body than a step, no thump
//   all:     a -10 dB high-shelf above 4 kHz (warm game mix, see RECIPE_GUIDE brightness rules)
// Every call draws fresh modes, timings, contact times and grain streams, so no two steps are identical.
import {add, scale, peak, filter, halfSine, modal, burst, pink, white, phisem, poisson, saturate, t60FromQ} from '../dsp.js';

const lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };

// the GRF as discrete contacts: [{t, amp, tc, kind}] (t in s from the buffer start)
function gait(R, {weight, speed, land, t0}) {
  const ev = [], W = weight * (land ? R.range(1.2, 1.6) : 1);
  if (land) {
    const dt = R.range(.015, .035);                                // the second foot, staggered
    ev.push({t: t0, amp: W, tc: R.range(.0012, .002), kind: 'heel'});
    ev.push({t: t0 + dt, amp: W * R.range(.7, .9), tc: R.range(.0012, .0022), kind: 'heel'});
    ev.push({t: t0 + dt + R.range(.025, .045), amp: W * R.range(.2, .3), tc: R.range(.0025, .004), kind: 'flat'});   // soles roll flat, knees bend
  } else {
    const gap = lerp(.1, .045, speed) * R.jit(.15);
    ev.push({t: t0, amp: W, tc: lerp(.0018, .0012, speed) * R.jit(.2), kind: 'heel'});   // a soft leather pad
    ev.push({t: t0 + gap * R.range(.4, .55), amp: W * R.range(.12, .22), tc: R.range(.002, .0035), kind: 'roll'});   // mid-sole
    ev.push({t: t0 + gap, amp: W * .32 * R.jit(.2) * (1 + .3 * speed), tc: R.range(.0015, .0025), kind: 'toe'});
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
  const f1 = R.range(170, 230) * (land ? .85 : 1), q = R.range(2, 3);
  const modes = [
    {f: f1, t60: t60FromQ(q, f1), a: 1},
    {f: f1 * R.range(1.5, 1.8), t60: t60FromQ(q * 1.2, f1 * 1.65), a: .5 * R.jit(.25)},
  ];
  return modal(force(ev, sr, n, {tcMul: R.range(3, 4)}), modes, sr, n);
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
    // the tap: the flagstone's upper modes only (a light foot does not move the slab), short and quiet
    const modes = [];
    for (let k = 0, K = R.int(14, 20); k < K; k++) { const f = R.pow(300, 2500, 1), q = R.range(4, 10); modes.push({f, t60: Math.min(.04, t60FromQ(q, f)), a: Math.pow(400 / f, .2) * R.jit(.4)}); }
    const out = norm(modal(force(ev, sr, n), modes, sr, n));
    // grit: a short noise burst per contact, proportional to the exciter (dust + sole texture)
    for (const e of ev) add(out, burst(.02, sr, R, {a: .0003, d: R.range(.0015, .003), color: 'pink', bp: R.range(600, 1300), q: .7}), e.t * sr, .45 * e.amp / ev[0].amp);
    // the sole rolling over the grit from heel to toe: a light brush, LP ~6 kHz (no hiss, no "tsk")
    const sp = p.speed ?? .3, wt = p.weight ?? .5, toe = ev[ev.length - 1], lpB = R.range(2500, 3200);
    const brush = band(R, sr, n, {at: ev[0].t + .004, dur: toe.t - ev[0].t + R.range(.015, .03), f: R.range(1000, 2000), q: .7, lp: lpB});
    add(out, filter(filter(brush, 'lowpass', lpB, .7, sr), 'lowpass', lpB, .7, sr), 0, R.range(.02, .04) * (.7 + .8 * sp) * (p.land > .5 ? .6 : 1));
    // push-off scuff: grows with speed and weight (a run kicks the floor back)
    const scuffG = R.range(.03, .06) * lerp(.3, .9, sp * sp) * Math.sqrt(wt / .5) * (p.land > .5 ? .4 : 1);
    const lpF = R.range(2500, 3200), sc = band(R, sr, n, {at: Math.max(0, toe.t - .012), dur: R.range(.015, .03), f: R.range(1200, 2200), q: .9, lp: lpF});
    add(out, filter(filter(sc, 'lowpass', lpF, .7, sr), 'lowpass', lpF, .7, sr), 0, scuffG);
    return out;
  },
  grass(R, ev, sr, n) {
    const E = load(ev, sr, n, {rise: .008, fall: R.range(.03, .045), roll: .3});
    const g = phisem(n, sr, R, {objects: R.range(200, 600), soundDecay: R.range(.88, .93), res: [[R.range(1500, 3000), R.range(.6, .78), 1], [R.range(700, 1300), .65, R.range(.2, .7)]], energy: E});
    const out = scale(norm(g), R.range(.4, .95));
    // swish: blades brushing the boot, from before the heel lands to after the push-off
    add(out, band(R, sr, n, {at: 0, dur: ev[ev.length - 1].t + R.range(.04, .07), hp: R.range(600, 1200), lp: R.range(3000, 4500)}), 0, R.range(.3, .6));
    return out;
  },
  gravel(R, ev, sr, n) {
    const E = load(ev, sr, n, {rise: .004, fall: R.range(.025, .04), roll: .3});
    for (let i = 0, t1 = ev[ev.length - 1].t; i < n; i++) { const u = i / sr - t1; if (u > 0) E[i] += .08 * Math.exp(-u / .05); }   // settling
    const obj = R.range(60, 150), out = new Float32Array(n);   // fine gravel: more, smaller stones
    for (const [f, r, g] of [[900 * R.jit(.2), .88, .6], [1900 * R.jit(.2), .85, 1], [3600 * R.jit(.15), .8, .45]])
      add(out, norm(phisem(n, sr, R, {objects: obj * R.jit(.3), soundDecay: R.range(.95, .97), res: [[f, r, 1]], energy: E})), 0, g * R.jit(.4));
    return norm(out);
  },
  snow(R, ev, sr, n) {
    const E = load(ev, sr, n, {rise: .012, fall: R.range(.035, .055), roll: .45});   // a light foot: a quick compression
    const out = norm(phisem(n, sr, R, {objects: R.range(60, 180), soundDecay: R.range(.93, .96), res: [[800 * R.jit(.18), .8, 1], [1600 * R.jit(.18), .75, .8], [2600 * R.jit(.18), .7, .4]], energy: E}));
    // crumpling micro-clicks: crystals of the snowpack breaking, Poisson with the rate following the load
    let Emax = 0; for (const v of E) Emax = Math.max(Emax, v);
    const clicks = new Float32Array(n);
    for (const t of poisson(R, 0, n / sr, t => 350 * E[Math.min(n - 1, Math.round(t * sr))] / Emax)) {
      const i0 = Math.round(t * sr), a = R.pow(.2, 1, 2) * (R() < .5 ? -1 : 1) * Math.sqrt(E[Math.min(n - 1, i0)] / Emax), L = R.int(6, 20);
      for (let i = 0; i < L && i0 + i < n; i++) clicks[i0 + i] += a * (R() * 2 - 1) * (1 - i / L);
    }
    add(out, norm(filter(filter(clicks, 'highpass', R.range(500, 1000), .7, sr), 'lowpass', 3500, .7, sr)), 0, R.range(.2, .45));
    // squeak (cold snow, ~60%): stick-slip at 1-2 kHz during the roll, a jittery rising tone
    if (R() < .6) {
      const t0 = ev[0].t + R.range(.03, .08), d = R.range(.04, .09), f0 = R.range(900, 1250), f1 = f0 * R.range(1.1, 1.3), m = Math.round(d * sr), sq = new Float32Array(m);
      let ph = 0; for (let i = 0; i < m; i++) { const u = i / m; ph += (f0 + (f1 - f0) * u) * (1 + .04 * (R() - .5)) / sr; sq[i] = (ph % 1 < .15 ? 1 : 0) * Math.sin(Math.PI * u) ** 2; }
      filter(sq, 'bandpass', (f0 + f1) * .75, 3, sr); add(out, norm(sq), t0 * sr, R.range(.12, .25));
    }
    const lpS = R.range(2800, 3800); return filter(filter(norm(out), 'lowpass', lpS, .7, sr), 'lowpass', lpS, .7, sr);
  },
  crystal(R, ev, sr, n) {
    // the stone floor underneath, quieter
    const out = scale(SURF.stone(R, ev, sr, n, {speed: .3}), .35);
    // glass taps: 2-5 shards knocked by the sole edge, each a few high-q modes with near-degenerate twins (beating)
    const taps = new Float32Array(n);
    for (let s = 0, S = R.int(2, 5); s < S; s++) {
      const e = R.pick(ev), f0 = R.range(1500, 3200), modes = [];
      for (const [r, a] of [[1, 1], [R.range(1.5, 1.7), .5], [R.range(2.3, 2.7), .25]]) { const f = f0 * r, T = t60FromQ(R.range(300, 900), f) * .4; modes.push({f, t60: Math.min(.12, T), a}, {f: f + R.range(.5, 3), t60: Math.min(.12, T), a: a * .6}); }
      add(taps, modal(halfSine(R.range(.0003, .0006), sr), modes, sr, Math.round(.3 * sr)), (e.t + R.range(0, .02)) * sr, R.pow(.3, 1, 1.5) * e.amp / ev[0].amp);
    }
    add(out, norm(taps), 0, R.range(.22, .35));
    // sleigh-bell grains: loose crystal grit jingling, sparse
    const E = load(ev, sr, n, {rise: .004, fall: .06, roll: .2});
    add(out, norm(phisem(n, sr, R, {objects: R.range(3, 8), soundDecay: .97, res: [[R.range(1600, 2200), .99, 1], [R.range(3000, 3600), .99, .6], [R.range(4200, 4800), .985, .3]], energy: E})), 0, R.range(.12, .2));
    return out;
  },
};
const BOOT = {stone: .1, grass: .1, gravel: .1, snow: .1, crystal: .08};   // a trace of the soft boot's body under each floor

export default {
  id: 'footstep', version: 4, desc: 'Light leather-boot footsteps: GRF exciter (heel-roll-toe) driving surface models',
  lufs: -25,                                                      // stealthy: 5 dB under the -20 LUFS one-shots
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
    const n = Math.round((ev[ev.length - 1].t + (s === 'crystal' ? .3 : land ? .25 : .18)) * sr);
    const out = SURF[s](R.fork(1), ev, sr, n, p);
    add(out, norm(boot(R.fork(2), ev, sr, n, {land})), 0, BOOT[s] * (land ? R.range(1.8, 3) : 1));
    if (land) add(out, band(R.fork(3), sr, n, {at: 0, dur: R.range(.1, .22), f: R.range(500, 1500), q: .7, lp: 3000}), 0, R.range(.015, .05));   // cloth: knees bending
    const hp = land ? 100 : s === 'stone' || s === 'crystal' ? 160 : 120;   // light feet: little below ~150 Hz
    filter(filter(out, 'highpass', hp, .7, sr), 'highpass', hp, .7, sr);
    filter(out, 'highshelf', 4000, .7, sr, -10);                    // warm game mix: -10 dB above ~4 kHz
    return saturate(norm(out, .9), 1.3);
  },
  criteria: {
    // v4 (light AND dark). Ranges cover seeds 1-24, the lab's 44291-44296 and 12 large random seeds (42 per case).
    // The toe sits ~10 dB under a light heel and the roll is gentle, so the onset detector often sees 0-1 events.
    stone: {attackMs: [0, 5], crest: [14, 23], t60Ms: [180, 340], centroidHz: [300, 620], lowHz: [130, 240], highHz: [350, 1900], flatness: [0, .02], durMs: [110, 180], onsetCount: [0, 2], clickEnd: [0, .01]},
    grass: {attackMs: [0, 60], crest: [10, 22], t60Ms: [110, 260], centroidHz: [1350, 2100], lowHz: [250, 750], highHz: [2700, 4600], flatness: [0, .1], durMs: [220, 320], onsetCount: [0, 2], clickEnd: [0, .01]},
    gravel: {attackMs: [0, 25], crest: [14, 23], t60Ms: [160, 340], centroidHz: [950, 1800], lowHz: [130, 400], highHz: [2300, 4000], flatness: [0, .05], durMs: [220, 300], onsetCount: [0, 2], clickEnd: [0, .01]},
    snow: {attackMs: [3, 30], crest: [12, 22], t60Ms: [90, 340], centroidHz: [750, 1450], lowHz: [130, 400], highHz: [1800, 2900], durMs: [200, 300], onsetCount: [0, 2], clickEnd: [0, .01]},
    // crystal: a shard tap can land after the heel and be the loudest event, hence the wide attack range
    crystal: {attackMs: [0, 120], crest: [13, 23], t60Ms: [90, 420], centroidHz: [1300, 2500], lowHz: [200, 1900], highHz: [1600, 3600], durMs: [280, 400], onsetCount: [0, 3], clickEnd: [0, .01]},
    land_stone: {attackMs: [0, 35], crest: [14, 23], t60Ms: [60, 380], centroidHz: [260, 520], lowHz: [90, 220], highHz: [300, 1300], durMs: [100, 240], onsetCount: [0, 2], clickEnd: [0, .01]},
    run_stone: {attackMs: [0, 5], crest: [14, 22], t60Ms: [110, 230], centroidHz: [300, 720], lowHz: [130, 240], highHz: [350, 2100], durMs: [85, 145], onsetCount: [0, 2], clickEnd: [0, .01]},
  },
  refs: {stone: ['assets/sfx/step.ruins_stone_1.mp3', 'assets/sfx/step.ruins_stone_2.mp3']},
  notes: 'GRF exciter (heel/roll/toe) into modal stone, PhISEM (Cook) grass/gravel/snow, glass modes + sleigh-bell grains for crystal; see docs/AUDIO.md §2.3',
};
