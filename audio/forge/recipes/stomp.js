// STOMP: heavy things hitting the ground, and the player taking a hit. Heavy but dull and damped: low modes with q 1.5-4,
// soft contacts (τc 6-20 ms), noise layers that decay naturally. Nothing rings.
//   hop    a straw-and-wood training dummy landing from a hop: the stuffed body's dull thump (70-110 Hz, q 2-3), the
//          post's solid wood thock (130-260 Hz, q 6-12, dense), a crunch of dry straw stalks (25-60 snaps, 1.5-4.5 kHz)
//          and a dust puff; a smaller second settle 60-110 ms later (it rocks back).
//   slam   a heavy creature's ground slam: a deep thump (40-70 Hz + a 55 -> 30 Hz ground-wave sweep), an earth crack
//          (pink BP 400-900 Hz), then the dirt it threw up lands: 10-25 clods (soft single-mode thuds by size) and a gravel
//          spray (PhISEM little rocks) peaking when the pieces fall back (0.3-0.9 s), a few stone chips, a falling rumble.
//   hurt   the player takes a hit: a padded body impact (leather and flesh: 90-170 Hz thump, soft BP slap, no ring), a
//          short rattle of gear (buckles, a quiver's loose bits: tiny metal ticks 2-6 kHz + PhISEM bells at low gain),
//          the leather flap. No voice. Light: the ranger is nimble, so little energy below 80 Hz.
import {halfSine, add, scale, peak, filter, sweep, onePoleLP, noise, pink, white, brown, phisem, PHISEM, saturate} from '../dsp.js';

const PI = Math.PI, G = 9.81, lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const q60 = (q, f) => 6.9078 * q / (PI * f);

// ============================================================================================ helpers (kernel candidates)
// warm game-mix tone stage: gentle high shelf and a steep (24 dB/oct) low-pass
function warm(b, sr, {shelf = -9, fs = 4500, lp = 7000} = {}) { filter(b, 'highshelf', fs, .7071, sr, shelf); filter(b, 'lowpass', lp, .7071, sr); filter(b, 'lowpass', lp, .7071, sr); return b; }
function tailFade(b, sr, sec = .008) { const nf = Math.min(b.length, Math.round(sec * sr)); for (let i = 0; i < nf; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(PI * i / nf); return b; }
function strike(out, sr, at, modes, {tc = .001, amp = 1, tail = 1.35} = {}) {
  const x = halfSine(tc, sr), i0 = Math.max(0, Math.round(at * sr)); if (i0 >= out.length) return out;
  for (const m of modes) {
    if (!(m.f > 0) || m.f > sr * .45 || !m.a) continue;
    const len = Math.min(out.length - i0, x.length + Math.round(m.t60 * tail * sr));
    const w = 2 * PI * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = amp * m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0, i = 0;
    for (const ne = Math.min(len, x.length + 1); i < ne; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < x.length ? x[i] : 0; y2 = y1; y1 = y; out[i0 + i] += y; }
    for (; i < len; i++) { const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; out[i0 + i] += y; }
  }
  return out;
}
// noise under a smooth attack-decay envelope, to -80 dB, band-limited, faded end
function puff(sr, R, {a = .0005, d = .01, color = 'pink', bp = null, q = .7, hp = null, lp = null}) {
  const n = Math.round((3 * a + 9.2 * d + .012) * sr), b = color === 'white' ? white(n, R) : color === 'brown' ? brown(n, R) : pink(n, R);
  for (let i = 0; i < n; i++) { const t = i / sr; b[i] *= (1 - Math.exp(-t / a)) * Math.exp(-t / d); }
  if (bp) filter(b, 'bandpass', bp, q, sr); if (hp) filter(b, 'highpass', hp, .7071, sr); if (lp) filter(b, 'lowpass', lp, .7071, sr);
  return tailFade(b, sr);
}
const BEAM = [1, 2.756, 5.404, 8.933, 13.345];
// a solid wooden thock: dense heavily damped bending modes
function woodThock(R, f0, q0) { return BEAM.map((r, i) => ({f: f0 * r * R.jit(.03), t60: q60(Math.max(5, q0 * (1 - .06 * i)), f0 * r), a: (i ? 1.1 / (1 + .4 * i) : .8) * R.range(.7, 1.2)})); }
// dry straw: stalks snapping, 2 hollow-tube modes each, snaps thin out as the push slows
function straw(n, sr, R, count, len) {
  const out = new Float32Array(n);
  for (let k = 0; k < count; k++) {
    const t = R.range(0, .004) + len * Math.pow(R(), 1.6), fs = R.range(1000, 2800), q1 = R.range(4, 10), f2 = fs * R.range(1.9, 2.6);
    strike(out, sr, t, [{f: fs, t60: q60(q1, fs), a: 1}, {f: f2, t60: q60(q1, f2), a: R.range(.3, .7)}], {tc: R.range(.04, .12) / 1000, amp: R.pow(.1, 1, 1.5) * Math.pow(1 - Math.min(1, t / (len + .004)), 1.3)});
  }
  return filter(out, 'highpass', 600, .7071, sr);
}
function grains(n, sr, R, energyFn, opts) { const en = new Float32Array(n); for (let i = 0; i < n; i++) en[i] = energyFn(i / sr); return tailFade(phisem(n, sr, R, {...opts, energy: en}), sr, .02); }

// ============================================================================================ cases
function hop(p, R, sr) {
  const out = new Float32Array(Math.round(.6 * sr)), I = p.intensity, tcB = lerp(14e-3, 8e-3, I) * R.jit(.15);
  // one landing, `amp` scales it (the settle is a smaller copy with different random details)
  const landing = (at, amp, full) => {
    const f0 = R.range(70, 110), body = new Float32Array(out.length);
    strike(body, sr, 0, [{f: f0, t60: q60(R.range(1.8, 3), f0), a: 1}, {f: f0 * R.range(2.1, 2.7), t60: q60(2.2, f0 * 2.4), a: R.range(.3, .55)}], {tc: tcB});
    add(out, norm(body), Math.round(at * sr), amp * R.range(.85, 1));
    const fw = R.range(130, 260), post = new Float32Array(out.length);
    strike(post, sr, 0, woodThock(R, fw, R.range(6, 12)), {tc: R.range(1.2, 2.6) / 1000});
    filter(post, 'highpass', 90, .7071, sr);
    add(out, norm(post), Math.round(at * sr), amp * R.range(.4, .65));
    const cr = straw(Math.round(.25 * sr), sr, R, Math.round(R.range(25, 60) * (full ? 1 : .4)), R.range(.05, .14) * (full ? 1 : .6));
    add(out, norm(cr), Math.round((at + R.range(.001, .006)) * sr), amp * R.range(.4, .65));
    add(out, norm(puff(sr, R, {a: .0012, d: R.range(.01, .02), bp: R.range(500, 1000), q: .6})), Math.round(at * sr), amp * R.range(.4, .6));
    if (full) {   // dry straw rustle after the landing: dense tiny grains 3-6 kHz over ~100-180 ms
      const rn = Math.round(.28 * sr), rd = R.range(.04, .07), rs = grains(rn, sr, R, t => Math.exp(-t / rd) * Math.min(1, t / .005), {objects: R.range(180, 360), soundDecay: .82, res: [[R.range(1800, 3000), .55, 1], [R.range(3500, 4500), .45, .4]]});
      add(out, norm(filter(rs, 'highpass', 1200, .7071, sr)), Math.round((at + .004) * sr), amp * R.range(.15, .25));
    }
  };
  landing(0, 1, true);
  landing(R.range(.065, .115), R.range(.28, .42), false);   // rocks back: a smaller second contact
  filter(out, 'highpass', 50, .7071, sr); warm(out, sr, {shelf: -9, fs: 3500, lp: 5500});
  return out;
}

function slam(p, R, sr) {
  const out = new Float32Array(Math.round(1.7 * sr)), I = p.intensity;
  // the blow: thump + ground wave sweep + earth crack + dirt thud
  const f0 = R.range(42, 70), th = new Float32Array(out.length);
  strike(th, sr, 0, [{f: f0, t60: q60(R.range(2.5, 4), f0), a: 1}, {f: f0 * R.range(1.9, 2.4), t60: q60(3, f0 * 2.1), a: R.range(.35, .6)}, {f: f0 * R.range(3.1, 3.8), t60: q60(3, f0 * 3.4), a: .2}], {tc: R.range(.012, .02)});
  add(out, norm(th), 0, 1);
  const sn = Math.round(.7 * sr), sub = new Float32Array(sn); let ph = 0; const s0 = R.range(52, 66), s1 = R.range(28, 36);
  for (let i = 0; i < sn; i++) { const t = i / sr; ph += 2 * PI * (s1 + (s0 - s1) * Math.exp(-t / .12)) / sr; sub[i] = Math.sin(ph) * (1 - Math.exp(-t / .006)) * Math.exp(-t / .13); }
  add(out, norm(sub), 0, R.range(.35, .55));
  add(out, norm(puff(sr, R, {a: .0006, d: R.range(.012, .022), bp: R.range(400, 900), q: .6})), 0, R.range(.7, .95));
  add(out, norm(puff(sr, R, {a: .004, d: R.range(.05, .09), color: 'brown', lp: 380, hp: 40})), 0, R.range(.6, .85));
  add(out, norm(puff(sr, R, {a: .0001, d: R.range(.0012, .003), color: 'white', hp: 1000, lp: 4000})), 0, R.range(.14, .26));   // the surface snap of the blow
  // dirt clods thrown up land: soft single-mode thuds, sizes power-law; flight 2v/g with v 1.5-5 m/s
  const clods = new Float32Array(out.length), nC = R.int(10, 25);
  let first = 9;
  for (let k = 0; k < nC; k++) {
    const sz = R.pow(.1, 1, 1.5), v = R.range(1.5, 5) * R.range(.6, 1), tl = 2 * v / G + R.range(0, .05), f = R.range(70, 190) / Math.pow(sz, .4);
    first = Math.min(first, tl);
    strike(clods, sr, tl, [{f, t60: q60(R.range(1.8, 3.2), f), a: 1}, {f: f * R.range(2.2, 3), t60: q60(2.5, f * 2.5), a: .35}], {tc: R.range(3, 7) / 1000, amp: Math.pow(sz, .8) * (v / 5)});
    add(clods, norm(puff(sr, R, {a: .0005, d: R.range(.004, .01), bp: R.range(450, 1100), q: .6})), Math.round(tl * sr), Math.pow(sz, .6) * (v / 5) * .6);
  }
  add(out, norm(clods), 0, R.range(.35, .55));
  // gravel: a spray at once, then the rain when the pieces fall back
  const gn = Math.round(1.55 * sr), tp = R.range(.35, .7), wd = R.range(.15, .25);
  const gv = grains(gn, sr, R, t => (.55 * Math.exp(-t / .12) + Math.exp(-.5 * ((t - tp) / wd) ** 2)) * Math.min(1, t / .015), {...PHISEM.littleRocks, objects: 1100, res: [[R.range(1300, 2200), .85, 1], [R.range(3000, 4200), .7, .3]]});
  add(out, norm(filter(gv, 'highpass', 800, .7071, sr)), 0, R.range(.2, .32));
  const bg = grains(gn, sr, R, t => (.4 * Math.exp(-t / .1) + .8 * Math.exp(-.5 * ((t - tp - .05) / wd) ** 2)) * Math.min(1, t / .01), {...PHISEM.bigRocks, objects: 14, res: [[R.range(900, 1500), .9, 1], [R.range(2400, 3400), .85, .4]]});
  add(out, norm(filter(bg, 'highpass', 500, .7071, sr)), 0, R.range(.12, .22));
  // rumble: the ground settling, falling cut-off
  const tr = puff(sr, R, {a: .02, d: R.range(.22, .32), color: 'brown'});
  sweep(tr, 'lowpass', t => 160 * Math.exp(-t / .3) + 55, .8, sr, {every: 64});
  add(out, norm(tr), 0, R.range(.35, .5));
  filter(out, 'highpass', 28, .7071, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5500});
  const nf = Math.round(out.length * .25); for (let i = 0; i < nf; i++) out[out.length - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  return out;
}

function hurt(p, R, sr) {
  const out = new Float32Array(Math.round(.55 * sr)), I = p.intensity, hard = Math.pow(I, .7);
  // padded body impact: a lossy 90-170 Hz mode struck by a long soft contact, the leather's soft slap
  const f0 = R.range(95, 170), th = new Float32Array(out.length);
  strike(th, sr, 0, [{f: f0, t60: q60(R.range(1.4, 2.4), f0), a: 1}, {f: f0 * R.range(2.2, 2.8), t60: q60(2, f0 * 2.5), a: R.range(.3, .5)}], {tc: lerp(11e-3, 6e-3, hard) * R.jit(.15)});
  add(out, norm(th), 0, 1);
  add(out, norm(puff(sr, R, {a: .0008, d: R.range(.006, .012), bp: lerp(700, 1500, hard) * R.jit(.2), q: .6})), 0, R.range(.6, .85));
  add(out, norm(puff(sr, R, {a: .0004, d: R.range(.002, .005), bp: R.range(1400, 2400), q: .8})), 0, R.range(.12, .22) * hard);   // leather slap edge
  // gear rattle: 4-8 tiny metal ticks over ~90-200 ms (buckles, rivets), dense then thinning, + bell grains at low gain
  const nT = R.int(4, 8), len = R.range(.09, .2);
  for (let k = 0; k < nT; k++) {
    const t = R.range(.004, .02) + len * Math.pow(R(), 1.5), fm = R.range(1100, 2800), g = Math.pow(1 - t / (len + .03), 1.2) * R.range(.4, 1);
    const ck = new Float32Array(Math.round(.1 * sr)); strike(ck, sr, 0, [{f: fm, t60: R.range(.012, .04), a: 1}, {f: fm * R.range(1.5, 2.3), t60: R.range(.008, .025), a: .5}, {f: fm * R.range(2.8, 3.8), t60: .01, a: .25}], {tc: R.range(.08, .2) / 1000});
    add(out, norm(ck), Math.round(t * sr), g * .3);
  }
  const rn = Math.round(.3 * sr), rdd = R.range(.05, .09), rl = grains(rn, sr, R, t => Math.exp(-t / rdd) * Math.min(1, t / .006), {objects: R.range(14, 22), soundDecay: .95, systemDecay: .9994, res: PHISEM.sleighBells.res.slice(0, 4).map(([f, r, g]) => [f * R.range(.4, .5), .92, g])});
  add(out, norm(filter(rl, 'highpass', 800, .7071, sr)), Math.round(R.range(.008, .02) * sr), R.range(.07, .13));
  // the leather/cloth flap: a short band of pink noise 300-900 Hz as the armour shifts
  add(out, norm(puff(sr, R, {a: .006, d: R.range(.03, .06), bp: R.range(350, 800), q: .8})), Math.round(R.range(.01, .03) * sr), R.range(.15, .28));
  filter(out, 'highpass', 75, .7071, sr); warm(out, sr, {shelf: -10, fs: 3000, lp: 4800});
  const nf = Math.round(out.length * .3); for (let i = 0; i < nf; i++) out[out.length - nf + i] *= .5 + .5 * Math.cos(PI * i / nf);
  return out;
}

function render(p, R, sr) {
  const out = ({hop, slam, hurt}[p.action] || hop)(p, R, sr);
  return saturate(norm(out, .9), 1.2);
}

export default {
  id: 'stomp', version: 2, desc: 'Heavy ground impacts: dummy hop (straw + wood), creature slam (boom + dirt/gravel), player hurt (padded hit + gear rattle)',
  params: {
    action: {values: ['hop', 'slam', 'hurt'], def: 'hop'},
    intensity: {min: 0, max: 1, def: .8},
  },
  cases: {hop: {action: 'hop'}, slam: {action: 'slam'}, hurt: {action: 'hurt'}},
  variants: 6,
  render,
  // v2 (brightness pass): gear ticks 1.1-2.8 kHz and bells at 0.4-0.5x, quieter; shelf -10 dB above 3 kHz; validated on 36 seeds (1-24, 44291-44296, 6 large)
  criteria: {
    hop: {durMs: [180, 360], attackMs: [1, 25], t60Ms: [180, 480], centroidHz: [150, 1000], lowHz: [30, 120], highHz: [800, 3200], flatness: [0, .03], crest: [13, 23], clickEnd: [0, .01]},
    slam: {durMs: [1300, 1700], attackMs: [0, 60], t60Ms: [1000, 3200], centroidHz: [150, 650], lowHz: [20, 80], highHz: [800, 2800], flatness: [0, .03], crest: [15, 24], clickEnd: [0, .01]},
    hurt: {durMs: [230, 560], attackMs: [0, 15], t60Ms: [130, 480], centroidHz: [250, 1300], lowHz: [30, 200], highHz: [1000, 3400], flatness: [0, .03], crest: [15, 25], clickEnd: [0, .01]},
  },
  notes: 'dull damped low modes (q 1.5-4, τc 6-20 ms) + wood thock + straw snaps (impact.js model); slam = thump + ground wave + falling clods/gravel (fracture-style debris); hurt = padded hit + metal ticks',
};
