// TRAP: a metal spring snare (a bear trap with a chain). Metal is the point here, but it must never ring on: the jaws
// clamp together and damp each other, so every ring is cut to 40-200 ms.
//   set     laying/arming it: 4-7 ratchet clicks (a pawl riding the toothed quadrant, intervals shrinking as the jaws
//           are forced wider), a stretching spring creak (stick-slip pulses through a rising band, 200 -> 700 Hz), a
//           final trigger-plate engagement (two metal ticks + a low knock)
//   snap    the jaws slam shut: a metal impact with τc < 0.2 ms exciting 10-20 inharmonic modes 500-3000 Hz (free q
//           300-1000, here ×0.07-0.2: jaw on jaw contact) + a low iron knock, then the spring's twang (a damped,
//           frequency-modulated partial set 180-420 Hz, falling pitch) with a dispersive "zing" chirp at the onset, and
//           the chain's jingle (PhISEM sleigh-bell resonances, energy decaying over ~0.4-0.7 s)
//   rattle  a caught animal struggling: 4-7 yanks (decaying in strength as it tires), each a chain jangle burst plus 1-3
//           jaw clanks (tooth on tooth, quiet, short) and a soft thump of the body on the ground. No voice.
import {halfSine, add, scale, peak, filter, sweep, onePoleLP, noise, pink, white, phisem, PHISEM, saturate} from '../dsp.js';

const PI = Math.PI, lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const q60 = (q, f) => 6.9078 * q / (PI * f);

// ============================================================================================ helpers (kernel candidates)
// warm game-mix tone stage: gentle high shelf and a steep (24 dB/oct) low-pass
function warm(b, sr, {shelf = -9, fs = 4500, lp = 7000} = {}) { filter(b, 'highshelf', fs, .7071, sr, shelf); filter(b, 'lowpass', lp, .7071, sr); filter(b, 'lowpass', lp, .7071, sr); return b; }
function tailFade(b, sr, sec = .008) { const nf = Math.min(b.length, Math.round(sec * sr)); for (let i = 0; i < nf; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(PI * i / nf); return b; }
// sparse modal strike (see impact.js `strike`): modes run only until ~-80 dB
function strike(out, sr, at, modes, {tc = .001, amp = 1, tail = 1.35} = {}) {
  const x = halfSine(tc, sr), i0 = Math.max(0, Math.round(at * sr)); if (i0 >= out.length) return out;
  for (const m of modes) {
    if (!(m.f > 0) || m.f > sr * .45) continue;
    const len = Math.min(out.length - i0, x.length + Math.round(m.t60 * tail * sr));
    const w = 2 * PI * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = amp * m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0, i = 0;
    for (const ne = Math.min(len, x.length + 1); i < ne; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < x.length ? x[i] : 0; y2 = y1; y1 = y; out[i0 + i] += y; }
    for (; i < len; i++) { const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; out[i0 + i] += y; }
  }
  return out;
}
// smooth noise burst: (1 - e^-t/a)·e^-t/d, to -80 dB, optionally band-limited
function puff(sr, R, {a = .0002, d = .004, color = 'white', bp = null, q = .8, hp = null, lp = null}) {
  const n = Math.round((3 * a + 9.2 * d + .01) * sr), b = color === 'pink' ? pink(n, R) : white(n, R);
  for (let i = 0; i < n; i++) { const t = i / sr; b[i] *= (1 - Math.exp(-t / a)) * Math.exp(-t / d); }
  if (bp) filter(b, 'bandpass', bp, q, sr); if (hp) filter(b, 'highpass', hp, .7071, sr); if (lp) filter(b, 'lowpass', lp, .7071, sr);
  return tailFade(b, sr);
}
// inharmonic steel modes: `count` frequencies log-spread over [lo, hi] with random scatter and a minimum spacing, free q
// 300-1000 × qMul (contact damping), amplitudes falling with frequency; near-degenerate twins (beating) on the lowest few
function metalModes(R, {lo = 500, hi = 3000, count = 14, qMul = .12, qRange = [300, 1000], tMax = .4, twins = 3} = {}) {
  const fs = [];
  for (let tries = 0; fs.length < count && tries < 200; tries++) {
    const f = lo * Math.pow(hi / lo, R());
    if (fs.every(g => Math.abs(Math.log(g / f)) > .045)) fs.push(f);
  }
  fs.sort((a, b) => a - b);
  const out = [];
  fs.forEach((f, i) => {
    const a = R.range(.35, 1) / (1 + .12 * i), t60 = Math.min(tMax, q60(R.range(qRange[0], qRange[1]) * qMul, f) * R.jit(.15));
    out.push({f, a, t60});
    if (i < twins) out.push({f: f + R.sign() * R.range(.6, 3), a: a * R.range(.5, .9), t60});
  });
  return out;
}
// a clean envelope for particle energy: events [{t, a, d}] -> sum of a·(1 - e^-(t-t0)/.004)·e^-(t-t0)/d
function energyOf(n, sr, events) {
  const e = new Float32Array(n);
  for (const ev of events) {
    const i0 = Math.max(0, Math.round(ev.t * sr)), len = Math.min(n - i0, Math.round(ev.d * 9 * sr));
    for (let i = 0; i < len; i++) { const t = i / sr; e[i0 + i] += ev.a * (1 - Math.exp(-t / .004)) * Math.exp(-t / ev.d); }
  }
  return e;
}
// the chain: sleigh-bell resonances re-tuned to iron links (2-8 kHz), energy-driven. Faded end.
function chain(n, sr, R, events, {objects = 28, gain = 1} = {}) {
  const sc = R.range(.42, .55), res = PHISEM.sleighBells.res.slice(0, 4).map(([f, r, g], i) => [f * sc * (i === 0 ? 1.2 : 1), .94, g]);
  return tailFade(phisem(n, sr, R, {objects, soundDecay: .965, systemDecay: .9994, res, gain, energy: energyOf(n, sr, events)}), sr, .02);
}

// ============================================================================================ cases
function snap(p, R, sr) {
  const out = new Float32Array(Math.round(1.05 * sr)), I = p.intensity;
  // the jaw impact: τc < 0.2 ms, 10-20 inharmonic modes, damped by the contact (qMul .07-.2 -> t60 20-250 ms)
  const modes = metalModes(R, {lo: 450, hi: 2500, count: R.int(10, 18), qMul: R.range(.07, .2), tMax: .2});
  const jaw = new Float32Array(out.length); strike(jaw, sr, 0, modes, {tc: R.range(.07, .18) / 1000});
  add(out, norm(jaw), 0, 1);
  // the click of the strike itself and the iron body's knock (low, short: the frame takes the blow)
  add(out, norm(puff(sr, R, {a: .00005, d: R.range(.0005, .0012), hp: 1200, lp: R.range(4500, 6000)})), 0, R.range(.4, .65));
  const kf = R.range(220, 420), kn = new Float32Array(out.length);
  strike(kn, sr, 0, [{f: kf, t60: q60(R.range(8, 16), kf), a: 1}, {f: kf * R.range(2.2, 2.8), t60: q60(10, kf * 2.5), a: .45}], {tc: R.range(.4, .8) / 1000});
  add(out, norm(kn), 0, R.range(.4, .65));
  // a second, softer jaw contact 6-25 ms later (the jaws bounce shut: two clacks) with different modes
  if (R() < .8) { const j2 = new Float32Array(out.length); strike(j2, sr, 0, metalModes(R, {lo: 450, hi: 2200, count: R.int(8, 14), qMul: R.range(.06, .14), tMax: .2}), {tc: R.range(.1, .22) / 1000}); add(out, norm(j2), Math.round(R.range(.006, .025) * sr), R.range(.3, .55)); }
  // the spring twang: damped partials with a falling pitch + slow FM (the coil vibrates), onset "zing" (dispersion chirp)
  const ts = R.range(.012, .05), tn = out.length - Math.round(ts * sr), tw = new Float32Array(tn), f0 = R.range(170, 400), T = R.range(.16, .32);
  const fm = R.range(9, 15), fmd = R.range(.015, .035);
  for (const [r, a, tm] of [[1, 1, 1], [R.range(2.0, 2.15), .55, .6], [R.range(3.0, 3.3), .35, .4], [R.range(5.2, 5.9), .18, .22]]) {
    let ph = R() * 2 * PI; const A = a * R.jit(.2);
    for (let i = 0; i < tn; i++) {
      const t = i / sr, f = f0 * r * (1 + .08 * Math.exp(-t / .04)) * (1 + fmd * Math.sin(2 * PI * fm * t) * Math.exp(-t / (T * .5)));
      ph += 2 * PI * f / sr; tw[i] += A * Math.exp(-6.9078 * t / (T * tm)) * Math.min(1, t / .002) * Math.sin(ph);
    }
  }
  add(out, norm(tailFade(tw, sr, .02)), Math.round(ts * sr), R.range(.18, .32));
  const zing = new Float32Array(Math.round(.06 * sr)); let zp = 0;
  const z0 = R.range(1800, 2800), z1 = R.range(500, 900), zd = R.range(.015, .03);
  for (let i = 0; i < zing.length; i++) { const t = i / sr; zp += 2 * PI * (z1 + (z0 - z1) * Math.exp(-t / zd)) / sr; zing[i] = Math.sin(zp) * Math.exp(-t / .015) * Math.min(1, t / .0008); }
  add(out, norm(tailFade(zing, sr)), Math.round(ts * .5 * sr), R.range(.1, .2));
  // the chain: a jingle as the loose links fall (two energy pulses), 0.35-0.6 s
  const c0 = R.range(.02, .06), ch = chain(out.length, sr, R, [{t: c0, a: R.range(.8, 1.1), d: R.range(.06, .12)}, {t: c0 + R.range(.06, .16), a: R.range(.4, .7), d: R.range(.08, .16)}], {objects: R.range(22, 34)});
  add(out, norm(filter(ch, 'highpass', 700, .7071, sr)), 0, R.range(.25, .4));
  filter(out, 'highpass', 70, .7071, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5200});
  const nf = Math.round(out.length * .25); for (let i = 0; i < nf; i++) out[out.length - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  return out;
}

function set(p, R, sr) {
  const out = new Float32Array(Math.round(.95 * sr)), nClick = R.int(4, 7);
  // ratchet: a pawl riding the teeth; the jaws are forced open, so clicks slow then catch at the end
  let t = R.range(.01, .03), dt = R.range(.04, .07);
  const times = [];
  for (let k = 0; k < nClick; k++) {
    times.push(t);
    const g = R.range(.6, 1) * (k === nClick - 1 ? 1.2 : 1);
    const m = metalModes(R, {lo: 900, hi: 3000, count: R.int(5, 8), qMul: R.range(.05, .1), tMax: .05, twins: 0});
    const ck = new Float32Array(Math.round(.1 * sr)); strike(ck, sr, 0, m, {tc: R.range(.1, .25) / 1000});
    add(out, norm(ck), Math.round(t * sr), g * .8);
    add(out, norm(puff(sr, R, {a: .00005, d: R.range(.0004, .001), hp: 1000, lp: 4200})), Math.round(t * sr), g * .4);
    t += dt; dt *= R.range(.92, 1.12);
    if (k === nClick - 3) dt *= 1.5;   // a pause before the final catch
  }
  const tEnd = times[times.length - 1];
  // spring stretch: stick-slip pulses (jittered 90-200 Hz) through a band that rises 200 -> 700 Hz while the spring loads
  const sl = tEnd + .03, sn = Math.round(sl * sr), sp = new Float32Array(sn); let ph = R();
  for (let i = 0; i < sn; i++) {
    const u = i / sr / sl; ph += R.range(90, 200) * (1 + .5 * u) / sr;
    const pulse = ph - Math.floor(ph) < .12 ? 1 : 0;
    sp[i] = (R() * 2 - 1) * pulse * (.4 + .6 * u) * Math.sin(PI * Math.min(1, u * 1.05)) ** .6;
  }
  sweep(sp, 'bandpass', t => 200 + 500 * Math.min(1, t / sl), 2.2, sr);
  add(out, norm(tailFade(sp, sr, .02)), 0, R.range(.22, .35));
  // a thin whine of the coil under tension: a sine that rises with the load, wobbling, faint
  const wn = Math.round((sl + .05) * sr), wh = new Float32Array(wn); let wp = 0; const f0 = R.range(260, 400), f1 = f0 * R.range(1.4, 1.9);
  for (let i = 0; i < wn; i++) { const u = Math.min(1, i / sr / sl), f = (f0 + (f1 - f0) * u * u) * (1 + .01 * Math.sin(2 * PI * 7 * i / sr)); wp += 2 * PI * f / sr; wh[i] = Math.sin(wp) * Math.pow(Math.sin(PI * Math.min(1, i / (wn - 1))), 1.5); }
  add(out, norm(wh), 0, R.range(.05, .1));
  // trigger plate engages: two ticks ~12-25 ms apart (the dog drops into the notch) and a low knock of the pan
  const te = tEnd + R.range(.05, .09);
  for (const [dt2, g] of [[0, 1], [R.range(.012, .025), R.range(.5, .8)]]) {
    const m = metalModes(R, {lo: 500, hi: 2200, count: R.int(8, 12), qMul: R.range(.06, .12), tMax: .08, twins: 1}), ck = new Float32Array(Math.round(.14 * sr));
    strike(ck, sr, 0, m, {tc: R.range(.1, .2) / 1000}); add(out, norm(ck), Math.round((te + dt2) * sr), g * .85);
    add(out, norm(puff(sr, R, {a: .00005, d: R.range(.0006, .0014), hp: 900, lp: 4200})), Math.round((te + dt2) * sr), g * .4);
  }
  const kf = R.range(160, 300), kn = new Float32Array(out.length); strike(kn, sr, 0, [{f: kf, t60: q60(R.range(6, 12), kf), a: 1}], {tc: R.range(.6, 1.2) / 1000});
  add(out, norm(kn), Math.round(te * sr), R.range(.2, .35));
  filter(out, 'highpass', 90, .7071, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5200});
  const nf = Math.round(out.length * .2); for (let i = 0; i < nf; i++) out[out.length - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  return out;
}

function rattle(p, R, sr) {
  const out = new Float32Array(Math.round(1.7 * sr)), I = p.intensity;
  const nY = R.int(4, 7), ev = []; let t = R.range(.02, .08), str = R.range(.8, 1);
  for (let k = 0; k < nY; k++) {
    ev.push({t, a: str * R.range(.6, 1), d: R.range(.05, .14), jaw: R.int(1, 3)});
    t += R.range(.12, .3) * (1 + .12 * k); str *= R.range(.7, .92);   // it tires: weaker, more spaced
  }
  // chain jangles (one energy pulse per yank, with a smaller echo as links settle)
  const events = []; for (const e of ev) { events.push({t: e.t, a: e.a, d: e.d}); events.push({t: e.t + R.range(.05, .12), a: e.a * .35, d: e.d * 1.3}); }
  const ch = chain(out.length, sr, R, events, {objects: R.range(24, 34)});
  add(out, norm(filter(ch, 'highpass', 600, .7071, sr)), 0, R.range(.4, .6));
  // jaw clanks and body thumps for each yank
  for (const e of ev) {
    for (let j = 0; j < e.jaw; j++) {
      const tj = e.t + R.range(0, .09), m = metalModes(R, {lo: 380, hi: 1900, count: R.int(7, 12), qMul: R.range(.05, .11), tMax: .08, twins: 1}), ck = new Float32Array(Math.round(.14 * sr));
      strike(ck, sr, 0, m, {tc: R.range(.15, .4) / 1000}); add(out, norm(ck), Math.round(tj * sr), e.a * R.range(.15, .35));
    }
    const bf = R.range(70, 130), bt = new Float32Array(Math.round(.25 * sr)); strike(bt, sr, 0, [{f: bf, t60: q60(R.range(1.5, 2.5), bf), a: 1}], {tc: R.range(.006, .012)});
    add(out, norm(bt), Math.round((e.t + R.range(0, .05)) * sr), e.a * R.range(.15, .3));
    // the chain pulled taut: a low creak of the ring on the stake (stick-slip noise, short)
    add(out, norm(puff(sr, R, {a: .004, d: R.range(.02, .05), color: 'pink', bp: R.range(500, 1100), q: 1.5})), Math.round((e.t - .005) * sr), e.a * R.range(.12, .22));
  }
  filter(out, 'highpass', 80, .7071, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5200});
  const nf = Math.round(out.length * .2); for (let i = 0; i < nf; i++) out[out.length - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  return out;
}

function render(p, R, sr) {
  const out = ({snap, set, rattle}[p.action] || snap)(p, R, sr);
  return saturate(norm(out, .9), 1.2);
}

export default {
  id: 'trap', version: 2, desc: 'Metal spring snare: ratchet set, jaw snap (damped metal modes + spring twang + chain), struggling rattle',
  params: {
    action: {values: ['snap', 'set', 'rattle'], def: 'snap'},
    intensity: {min: 0, max: 1, def: .8},
  },
  cases: {set: {action: 'set'}, snap: {action: 'snap'}, rattle: {action: 'rattle'}},
  variants: 6,
  render,
  // v2 (brightness pass): chain resonances 1.1-5.4 kHz (was 2.5-9.8), modes 450-2500 Hz, shelf -10 dB above 3.5 kHz; validated on 36 seeds (1-24, 44291-44296, 6 large)
  criteria: {
    set: {durMs: [300, 800], t60Ms: [80, 800], centroidHz: [500, 1200], lowHz: [80, 400], highHz: [1300, 2800], flatness: [0, .03], onsetCount: [2, 10], clickEnd: [0, .01]},
    snap: {durMs: [380, 900], attackMs: [0, 20], t60Ms: [300, 1000], centroidHz: [400, 1300], lowHz: [100, 450], highHz: [1000, 3400], flatness: [0, .03], crest: [15, 27], clickEnd: [0, .01]},
    rattle: {durMs: [900, 1750], t60Ms: [600, 3800], centroidHz: [700, 1900], lowHz: [50, 600], highHz: [2000, 4000], flatness: [0, .03], onsetCount: [3, 11], clickEnd: [0, .01]},
  },
  notes: 'steel-jaw impact (τc<0.2 ms, 10-20 inharmonic modes, contact-damped q), FM spring twang + dispersion chirp, PhISEM sleigh-bell chain (AUDIO.md §2.3 Metal)',
};
