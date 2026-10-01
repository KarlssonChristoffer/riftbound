// CHEST: an old wooden treasure chest, iron-bound. Wood first, a little iron, a hint of magic.
// Model (docs/AUDIO.md §2.3):
//   latch: an iron hasp, two clicks 40-90 ms apart (unhook, then lift): each a dense bank of 7-10 inharmonic modes
//          2-6 kHz, q 12-35 (t60 8-30 ms) + a 1-1.4 kHz knock + a 0.5 ms noise tick. Kept 8-10 dB under the wood so it
//          never turns the chest into a "clinky" metal object.
//   hinge: stick-slip friction, an impulse train at 5-40 Hz (rate follows the swing speed: slow-fast-slow, +-30%
//          jitter, random strengths) ringing rusty formants 400-2000 Hz (q 6-10) plus a faint continuous rasp.
//   lid:   the lid hits its back stop / falls shut: a DENSE, DAMPED thud: 14-18 box/plank modes 100-420 Hz at random
//          frequencies, q 2-4 (t60 25-80 ms), a 2-3 ms contact, a plank rebound 55-90 ms later, and a dull
//          woody noise body. No sustained cavity tone.
//   magic: a soft sparkle at the end of open: 5-9 tiny bell glints (1.8-5 kHz, pentatonic-ish, beating twins), falling
//          in level, over a faint airy shimmer.
import {add, scale, peak, filter, halfSine, modal, burst, pink, white, bounces, saturate, t60FromQ} from '../dsp.js';

const lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };
const bellU = u => (u <= 0 || u >= 1) ? 0 : Math.pow(Math.sin(Math.PI * u), 1.3);

// iron latch click at time t (s), into out. s: strength
function latchClick(out, sr, R, t, s, bright = 1) {
  const modes = [];
  for (let k = 0, K = R.int(7, 10); k < K; k++) {
    const f = R.range(1500, 4500), q = R.range(12, 35);
    modes.push({f, t60: Math.min(.03, t60FromQ(q, f)), a: R.range(.4, 1) * Math.pow(f / 3500, -.3)});
  }
  modes.push({f: R.range(800, 1200), t60: .014, a: .8}, {f: R.range(380, 600), t60: .02, a: .4});
  const y = modal(halfSine(R.range(.00015, .0004), sr), modes, sr, Math.round(.09 * sr));
  add(y, burst(.01, sr, R, {a: .00005, d: R.range(.0004, .0009), color: 'white', bp: R.range(2000, 4000), q: .6}), 0, peak(y) * .25);
  add(out, norm(y), t * sr, s);
}
// the hinge: stick-slip train over [t0, t0+dur]
function hinge(out, sr, R, t0, dur, level) {
  const F = [350, 540, 760, 1000, 1300, 1600].map(f => f * R.jit(.12)), Q = F.map(() => R.range(6, 10)), A = [.7, 1, .9, .65, .4, .22].map(a => a * R.jit(.25));
  let t = t0;
  while (t < t0 + dur) {
    const u = (t - t0) / dur, sw = bellU(u), rate = lerp(5, 40, Math.pow(sw, 1.1)) * R.jit(.3);
    const modes = F.map((f, i) => ({f: f * R.jit(.05), t60: Math.min(.06, t60FromQ(Q[i], f)), a: A[i] * R.range(.5, 1.4)}));
    const y = modal(halfSine(R.range(.0003, .0007), sr), modes, sr, Math.round(.07 * sr));
    add(out, norm(y), t * sr, level * (.25 + .75 * sw) * R.pow(.4, 1, 1.3));
    t += 1 / rate;
  }
  // continuous rasp of the pin turning in the strap: noise through two formants, following the swing
  const m = Math.round(dur * sr), r = pink(m, R);
  filter(r, 'bandpass', F[2], 1.5, sr); const r2 = filter(pink(m, R), 'bandpass', F[4], 1.8, sr);
  for (let i = 0; i < m; i++) r[i] = (r[i] + .6 * r2[i]) * bellU(i / m) * bellU(i / m);
  add(out, norm(r), t0 * sr, level * .14);
}
// the lid thud at time t. s: strength
function lidThud(out, sr, R, t, s, {rebound = true} = {}) {
  const modes = [];
  for (let k = 0, K = R.int(14, 18); k < K; k++) {
    const f = R.pow(100, 420, 1), q = R.range(2, 4);
    modes.push({f, t60: t60FromQ(q, f), a: R.range(.4, 1) * Math.pow(f / 200, -.35)});
  }
  const mk = tc => { const y = modal(halfSine(tc, sr), modes, sr, Math.round(.24 * sr)); add(y, burst(.06, sr, R, {a: .0004, d: R.range(.008, .016), color: 'pink', bp: R.range(450, 900), q: .6}), 0, peak(y) * .9); return norm(y); };
  add(out, mk(R.range(.002, .003)), t * sr, s);
  if (rebound) add(out, mk(R.range(.003, .005)), (t + R.range(.055, .09)) * sr, s * R.range(.28, .42));
}
// magical sparkle: tiny glints over a faint shimmer, from t0 for dur
function sparkle(out, sr, R, t0, dur, level) {
  const root = R.pick([880, 987.8, 1174.7, 1318.5]), K = R.int(5, 9);
  for (let k = 0; k < K; k++) {
    const u = k / K, f = root * Math.pow(2, R.pick([0, 2, 4, 7, 9, 12, 14]) / 12) * Math.pow(.97, 0) * (R() < .3 ? 1.5 : 1), tg = t0 + u * dur * R.range(.6, 1);
    if (f > 4600) continue;
    const T = R.range(.1, .22), modes = [{f, t60: T, a: 1}, {f: f * Math.pow(2, R.range(1, 2) / 1200), t60: T, a: .7}, {f: f * 2.01, t60: T * .5, a: .3}];
    add(out, norm(modal(halfSine(.0003, sr), modes, sr, Math.round(T * 1.4 * sr))), tg * sr, level * Math.pow(1 - u * .65, 1.5) * R.range(.5, 1));
  }
  const m = Math.round((dur + .2) * sr), sh = filter(filter(pink(m, R), 'bandpass', 2200, .8, sr), 'lowpass', 4500, .7, sr);
  for (let i = 0; i < m; i++) sh[i] *= Math.pow(Math.sin(Math.PI * Math.min(1, i / m)), 2);
  add(out, norm(sh), t0 * sr, level * .05);
}

const CASES = {
  open(R, sr) {
    const swing = R.range(.5, .62), tHinge = R.range(.1, .14), tThud = tHinge + swing + R.range(.01, .03);
    const n = Math.round((tThud + 1.05) * sr), out = new Float32Array(n);
    // latch: unhook (small), lift (bigger)
    const tl = R.range(.05, .09);
    latchClick(out, sr, R.fork(1), 0, .26);
    latchClick(out, sr, R.fork(2), tl, .42);
    hinge(out, sr, R.fork(3), tHinge, swing, .5);
    lidThud(out, sr, R.fork(4), tThud, 1, {rebound: true});
    sparkle(out, sr, R.fork(5), tThud - .1, R.range(.5, .7), .26);
    return out;
  },
  close(R, sr) {
    const n = Math.round(.75 * sr), out = new Float32Array(n);
    const fall = R.range(.16, .24);
    hinge(out, sr, R.fork(1), 0, fall, .28);
    lidThud(out, sr, R.fork(2), fall, 1, {rebound: true});
    latchClick(out, sr, R.fork(3), fall + R.range(.06, .1), .7);   // the hasp drops into place
    return out;
  },
  locked(R, sr) {
    const n = Math.round(.55 * sr), out = new Float32Array(n);
    // the player tugs the lid: the hasp rattles against the staple (bouncing clicks) and the lid knocks on the body
    const K = R.int(2, 3);
    let t = 0.002;
    for (let j = 0; j < K; j++) {
      const seq = bounces(R.fork(10 + j), {t0: t, v0: R.range(.7, 1), e: R.range(.55, .7), dt0: R.range(.05, .075), minV: .12, jitter: .2, max: 6});
      for (const b of seq) latchClick(out, sr, R.fork(20 + j * 8 + Math.round(b.t * 1000)), b.t, .25 * b.v);
      lidThud(out, sr, R.fork(40 + j), t, .22 * R.range(.7, 1), {rebound: false});
      t += R.range(.2, .27);
    }
    return out;
  },
};

export default {
  id: 'chest', version: 2, desc: 'Old wooden treasure chest: open (latch, hinge creak, damped lid thud, sparkle), close, locked rattle',
  params: {kind: {values: ['open', 'close', 'locked'], def: 'open'}},
  cases: {open: {kind: 'open'}, close: {kind: 'close'}, locked: {kind: 'locked'}},
  variants: 6,
  render(p, R, sr) {
    const out = CASES[p.kind](R, sr);
    filter(out, 'highpass', 70, .7, sr);
    filter(out, 'highshelf', 5000, .7, sr, -8); filter(filter(out, 'lowpass', 6500, .7, sr), 'lowpass', 6500, .7, sr);   // v2: darker hasp, hinge and sparkle
    return saturate(norm(out, .9), 1.2);
  },
  criteria: {
    // v2. Ranges cover seeds 1-24, 44291-44296 and 12 large random seeds (42 per case), with margin. v2 darker: hasp modes 1.5-4.5 kHz, hinge formants 350-1600 Hz, sparkle 0.9-1.3 kHz root with a band-limited veil, -8 dB shelf above 5 kHz, LP 6.5 kHz.
    open: {attackMs: [443, 983], crest: [19, 25], t60Ms: [406, 1778], centroidHz: [421, 1034], lowHz: [61, 106], highHz: [1155, 3308], flatness: [0, 0.01], durMs: [1138, 1701], onsetCount: [6, 16], clickEnd: [0, .01]},
    close: {attackMs: [0, 125], crest: [17, 23], t60Ms: [139, 371], centroidHz: [190, 477], lowHz: [61, 79], highHz: [577, 2442], flatness: [0, 0.01], durMs: [280, 444], onsetCount: [1, 6], clickEnd: [0, .01]},
    locked: {attackMs: [0, 298], crest: [17, 23], t60Ms: [30, 1047], centroidHz: [395, 926], lowHz: [61, 79], highHz: [1711, 3019], flatness: [0, 0.011], durMs: [341, 605], onsetCount: [4, 11], clickEnd: [0, .01]},
  },
  notes: 'Iron hasp modal clicks 2-6 kHz, stick-slip hinge 5-40 Hz through 400-2000 Hz formants, dense damped plank thud (14-18 modes, q 2-4), pentatonic sparkle; see docs/AUDIO.md §2.3',
};
