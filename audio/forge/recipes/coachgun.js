// COACHGUN: the bruiser's double-barrelled 12-gauge coach gun (features/foes: content/foes.js TYPES.bruiser): black
// powder, paper shells with brass heads, external hammers, a top lever and a hinged break action. Physical parts on one
// timeline per case:
//   fire   one barrel: the hammer falls on the pin (a dull tick), ~4-6 ms later the charge: a broad pressure pulse (a
//          long Friedlander positive phase: more push than snap; its crackle pink and low-passed ~3 kHz), the black
//          powder's CHUFF (a slower gas burst round 300-600 Hz), a rough, wide BODY (pink noise low-passed, its level
//          roughened by a slow random grain: the powder burning unevenly), a deep THUMP (a long pressure pulse into 3
//          heavily damped modes ~45-60 Hz and up: felt in the chest, no note), then the ROLLING DESERT TAIL: a dark brown
//          decay whose level rolls (a smoothed random swell) and 3-5 soft slaps off far rock 70-600 ms out, each darker
//          and later than the one before. Open ground: no room, nothing tonal rings. Every part is drawn from the seed:
//          two barrels in a row (two variants: the runtime never repeats the last two) differ in pulse, chuff, grain
//          and echoes. Against the revolver's navy (recipes/revolver.js): a longer pulse, more thump and chuff, a
//          rougher body, a tail twice as long, and darker everywhere.
//   break  the top lever thumbed aside (a damped click), the barrels swinging down on the hinge pin (a short dark
//          friction), the solid clack at the stop (a dense low-mid thock and a short damped steel tick)
//   eject  the extractor lifting both spent shells (a dull paper-on-steel scrape, the rims clearing), the shells
//          dropping into the sand: two dull taps (a low-passed thud, the brass head's damped knock, a few dark grains)
//   load   one shell thumbed into a chamber: the hull sliding in (a short dark scrape), seated with a firm tap
//   close  the barrels swung up and snapping shut: a heavy, damped lock on the standing breech, then the top lever
//          springing back over (a short damped click)
//   cock   a hammer thumbed back to full cock (the aim's telegraph): two notch clicks, heavier and lower than the
//          revolver's, no cylinder
//   dry    the hammer on a spent chamber: the sear, then a dull, heavy knock
// The user's taste (RECIPE_GUIDE): no hollow or ringing impacts (every mode dies in a few periods, Q <= ~6), no clinky
// metal (steel ticks sit at 1.2-2.4 kHz, t60 <= 8 ms, over a damped low-mid body), highs only as short grains, no hiss;
// every case ends through dsp.warm (a -10 dB shelf above 5 kHz).
import {add, filter, halfSine, modal, burst, pink, brown, white, saturate, scale, peak, warm} from '../dsp.js';

const PI = Math.PI;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
// attack a, 1/e decay d (s): (1 - e^-t/a) e^-t/d, by running products (no exp per sample)
const ad = (b, sr, a, d) => {
  const ka = Math.exp(-1 / (a * sr)), kd = Math.exp(-1 / (d * sr)); let ea = 1, ed = 1;
  for (let i = 0; i < b.length; i++) { b[i] *= (1 - ea) * ed; ea *= ka; ed *= kd; }
  return b;
};
const TAIL = 9.2;   // time constants to -80 dB: every decaying layer gets a buffer this long (RECIPE_GUIDE rule 2)
// a smoothed random wobble round 0 (peak 1): white noise through two one-pole low-passes at fc Hz
function rough(n, sr, R, fc) {
  const b = white(n, R), k = 1 - Math.exp(-2 * PI * fc / sr); let y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) { y1 += (b[i] - y1) * k; y2 += (y1 - y2) * k; b[i] = y2; }
  return norm(b, 1);
}
// a damped steel tick: a short modal strike, lower and shorter than the revolver's (heavier parts), over an optional
// low-mid body (the frame, the stock under the hand)
function tick(out, sr, R, at, {f = 1800, amp = 1, t60 = .006, tc = .0004, body = 0} = {}) {
  const i0 = Math.round(at * sr); if (i0 >= out.length) return;
  const n = Math.min(out.length - i0, Math.round((Math.max(t60, .03) * 1.6 + .02) * sr));
  const modes = [{f: f * R.jit(.06), t60, a: 1}, {f: f * R.range(1.45, 1.6), t60: t60 * .65, a: .45}, {f: f * R.range(2.1, 2.5), t60: t60 * .45, a: .2}];
  if (body) modes.push({f: R.range(520, 800), t60: R.range(.011, .018), a: body});
  add(out, norm(modal(halfSine(tc * R.jit(.2), sr), modes, sr, n), amp), i0);
}
// a heavy, dense hit (barrels on the stop, the breech, a shell seated): a broad contact into inharmonic low-mid modes that
// die in a few periods (no cavity tone), with a little dark noise for the grit
function thock(out, sr, R, at, {f = 380, amp = 1, t60 = .03, tc = .0012, grit = .3, gritLP = 2000} = {}) {
  const i0 = Math.round(at * sr); if (i0 >= out.length) return;
  const n = Math.min(out.length - i0, Math.round((t60 * 1.6 + .03) * sr));
  const modes = [{f: f * R.jit(.08), t60, a: 1}, {f: f * R.range(1.55, 1.75), t60: t60 * .7, a: .6},
    {f: f * R.range(2.3, 2.7), t60: t60 * .5, a: .35}, {f: f * R.range(3.4, 3.9), t60: t60 * .35, a: .18}];
  const b = norm(modal(halfSine(tc * R.jit(.2), sr), modes, sr, n), 1);
  if (grit) { const g = burst(Math.min(.03, n / sr), sr, R, {a: .0002, d: .003, color: 'pink'}); filter(g, 'lowpass', gritLP, .7, sr); add(b, norm(g, grit)); }
  add(out, norm(b, amp), i0);
}
// friction (a hinge pin, paper on steel): band-passed pink under a bell, its level grained
function scrape(out, sr, R, at, dur, {f = 900, q = .9, amp = .4, lp = 1600} = {}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round(dur * sr)); if (n <= 0) return;
  const b = filter(pink(n, R), 'bandpass', f * R.jit(.15), q, sr); filter(b, 'lowpass', lp, .7, sr); filter(b, 'lowpass', lp * 1.5, .7, sr);
  const g = rough(n, sr, R, R.range(60, 110));
  for (let i = 0; i < n; i++) b[i] *= Math.sin(PI * i / n) ** 2 * Math.max(0, 1 + .6 * g[i]);
  add(out, norm(b, amp), i0);
}
// a spent shell landing in sand: a dull low-passed thud (the paper hull), the brass head's damped knock, a few dark grains
function sandTap(out, sr, R, at, amp) {
  const i0 = Math.round(at * sr); if (i0 >= out.length) return;
  const th = ad(burst(.07, sr, R, {a: .0006, d: .007, color: 'pink'}), sr, .0006, .009);
  const tl = R.range(650, 900); filter(th, 'lowpass', tl, .7, sr); filter(th, 'lowpass', tl * 1.4, .7, sr); filter(th, 'highpass', 120, .7, sr);
  add(out, norm(th, amp), i0);
  thock(out, sr, R, at + .0005, {f: R.range(480, 650), amp: amp * R.range(.35, .5), t60: .016, tc: .0016, grit: 0});
  for (let k = R.int(2, 4); k > 0; k--) {   // grains of sand: sparse, dark, well under the thud
    const g = burst(.012, sr, R, {a: .0001, d: .0012, color: 'white'}); filter(g, 'bandpass', R.range(1600, 2400), 1.2, sr);
    add(out, norm(g, amp * R.range(.06, .11)), i0 + Math.round(R.range(.002, .03) * sr));
  }
}

function shot(out, sr, R, P) {
  // which barrel: the choked one throws a slightly tighter, quicker pulse and a higher chuff than the open (cylinder) bore
  const choke = R() < .5, kT = choke ? .9 : 1.06, kF = choke ? 1.12 : .94;
  const t0 = R.range(.004, .006);                               // the hammer falls -> the charge goes
  tick(out, sr, R, 0, {f: R.range(1400, 1800), amp: .05, t60: .005, body: .5});
  const i0 = Math.round(t0 * sr), n = out.length - i0;
  // 1. the pressure pulse: a long positive phase, then the suction; a short pink crackle on it, all under ~3 kHz
  const tp = P.tp * kT * R.jit(.12), kq = R.range(.9, 1.1), nc = Math.round(.06 * sr), crack = new Float32Array(nc);
  for (let i = 0; i < nc; i++) { const t = i / sr / tp; crack[i] = t < 9 ? (1 - t) * Math.exp(-kq * t) : 0; }
  add(crack, norm(burst(.06, sr, R, {a: .0001, d: P.crackD * R.jit(.25), color: 'pink'}), .5));
  filter(crack, 'highpass', P.crackHP, .7, sr); filter(crack, 'lowpass', P.crackLP, .7, sr); filter(crack, 'lowpass', P.crackLP * 1.3, .7, sr);
  add(out, norm(crack, P.crack * R.jit(.1)), i0);
  // 2. the chuff: the black powder's gas, slower than the pulse, round 300-600 Hz
  const cA = P.chuffA * R.jit(.25), cD = P.chuffD * R.jit(.2), nh = Math.min(n, Math.round((cD * TAIL + cA * 3) * sr));
  const ch = ad(pink(nh, R), sr, cA, cD);
  filter(ch, 'bandpass', P.chuffF * kF * R.jit(.15), .75, sr); filter(ch, 'lowpass', 1500, .7, sr);
  add(out, norm(ch, P.chuff * R.jit(.3)), i0 + Math.round(R.range(.0005, .0025) * sr));
  // 3. the body: rough and wide: pink, low-passed (12 dB/oct twice), its level grained by a slow random wobble
  const bD = P.bodyD * R.jit(.15), nb = Math.min(n, Math.round((bD * TAIL + .01) * sr)), body = ad(pink(nb, R), sr, .0009, bD);
  const gr = rough(nb, sr, R, P.roughF * R.jit(.3)), dep = P.rough * R.jit(.25);
  for (let i = 0; i < nb; i++) body[i] *= Math.max(0, 1 + dep * gr[i]);
  const bLP = P.bodyLP * R.jit(.22);
  filter(body, 'lowpass', bLP, .7, sr); filter(body, 'lowpass', bLP * 1.4, .7, sr); filter(body, 'highpass', 90, .7, sr);
  add(out, norm(body, P.body), i0);
  // 4. the thump: a long pressure pulse into three heavily damped low modes (felt, not heard as a note)
  const tT = P.thumpT * R.jit(.12), nt = Math.min(n, Math.round((tT * 1.6 + .05) * sr)), tF = P.thumpF * R.jit(.08);
  const th = modal(halfSine(P.thumpTc * R.jit(.2), sr), [{f: tF, t60: tT, a: 1}, {f: tF * R.range(1.75, 2.05), t60: tT * .55, a: .5},
    {f: tF * R.range(2.9, 3.4), t60: tT * .35, a: .22}], sr, nt);
  add(out, norm(th, P.thump * R.jit(.15)), i0);
  // 5. the rolling desert tail: a dark brown decay whose level rolls, then soft slaps off far rock, each darker and later
  const lD = P.tailD * R.jit(.12), nl = Math.min(n, Math.round((lD * TAIL + .06) * sr)), tail = ad(brown(nl, R), sr, .02 * R.jit(.3), lD);
  const rl = rough(nl, sr, R, R.range(4, 8)), rd = R.range(.4, .65);
  for (let i = 0; i < nl; i++) tail[i] *= Math.max(0, 1 + rd * rl[i]);
  filter(tail, 'lowpass', P.tailLP * R.jit(.2), .7, sr); filter(tail, 'lowpass', P.tailLP * 1.5, .7, sr); filter(tail, 'highpass', 55, .7, sr);
  add(out, norm(tail, P.tail * R.jit(.12)), i0 + Math.round(.006 * sr));
  const ne = R.int(3, 5); let d = R.range(.07, .12);
  for (let k = 0; k < ne; k++) {
    const at = i0 + Math.round(d * sr), eA = R.range(.003, .007) * (1 + k * .6), eD = R.range(.022, .034) * (1 + .3 * k);
    const len = Math.min(out.length - at, Math.round((eD * TAIL + eA * 3) * sr)); if (len <= 0) break;
    const e = ad(pink(len, R), sr, eA, eD);
    const eL = R.range(620, 850) * Math.pow(.84, k); filter(e, 'lowpass', eL, .7, sr); filter(e, 'lowpass', eL * 1.5, .7, sr); filter(e, 'highpass', 70, .7, sr);
    add(out, norm(e, P.echo * Math.pow(.68, k) * R.jit(.25)), at);
    d += R.range(.06, .13) * (1 + .3 * k);
  }
}

// the shot: tp / crackD (s), crackHP / crackLP (Hz), chuffA / chuffD (s) at chuffF Hz, bodyD (s) under bodyLP Hz roughened
// by rough at roughF Hz, thumpF (Hz) / thumpT (t60 s) / thumpTc (pulse s), tailD (s) under tailLP (Hz), echo; levels relative
const SHOT = {tp: .0028, crackD: .006, crackHP: 260, crackLP: 2800, crack: .75, chuffA: .0035, chuffD: .045, chuffF: 420, chuff: .7,
  bodyD: .05, bodyLP: 1300, body: .8, rough: .7, roughF: 55, thumpF: 50, thumpT: .2, thumpTc: .008, thump: 1.6,
  tailD: .18, tailLP: 620, tail: .3, echo: .17};
const DUR = {fire: 1.9, break: .4, eject: .75, load: .3, close: .45, cock: .2, dry: .15};

export default {
  id: 'coachgun', version: 1, desc: 'The bruiser\'s double-barrelled coach gun: a black-powder 12-gauge boom with a rolling desert tail, the break, the shells out, a shell in, the close, the hammer',
  params: {act: {values: ['fire', 'break', 'eject', 'load', 'close', 'cock', 'dry'], def: 'fire'}},
  cases: {fire: {act: 'fire'}, break: {act: 'break'}, eject: {act: 'eject'}, load: {act: 'load'}, close: {act: 'close'}, cock: {act: 'cock'}, dry: {act: 'dry'}},
  variants: 6,
  render(p, R, sr) {
    const a = p.act, out = new Float32Array(Math.round(DUR[a] * sr));
    if (a === 'fire') shot(out, sr, R, SHOT);
    else if (a === 'break') {
      tick(out, sr, R, 0, {f: R.range(1400, 1800), amp: .45, t60: .006, body: .55});                        // the top lever thumbed aside
      scrape(out, sr, R, R.range(.012, .02), R.range(.07, .1), {f: R.range(550, 800), q: 1, amp: .1});     // the barrels swing on the hinge pin
      const at = R.range(.1, .14);
      thock(out, sr, R, at, {f: R.range(320, 420), amp: 1, t60: .03, tc: .0012, grit: .35});                // the clack at the stop
      tick(out, sr, R, at + R.range(.0005, .002), {f: R.range(1300, 1700), amp: .3, t60: .005, tc: .0005});
    } else if (a === 'eject') {
      scrape(out, sr, R, 0, R.range(.06, .09), {f: R.range(650, 950), q: 1.1, amp: .22});                   // the extractor lifts them, paper on steel
      thock(out, sr, R, R.range(.055, .075), {f: R.range(550, 720), amp: .28, t60: .014, tc: .0012, grit: .2});   // the rims clear the chambers
      const t1 = R.range(.26, .32);                                                                          // into the sand
      sandTap(out, sr, R, t1, R.range(.75, .9));
      sandTap(out, sr, R, t1 + R.range(.03, .09), R.range(.55, .75));
    } else if (a === 'load') {
      scrape(out, sr, R, 0, R.range(.045, .065), {f: R.range(800, 1150), q: 1.2, amp: .24});                  // the hull slides in
      const at = R.range(.045, .06);
      thock(out, sr, R, at, {f: R.range(440, 580), amp: 1, t60: .022, tc: .001, grit: .25});                // seated: the rim on the breech
      tick(out, sr, R, at + .001, {f: R.range(1300, 1700), amp: .28, t60: .004});
    } else if (a === 'close') {
      scrape(out, sr, R, 0, R.range(.05, .08), {f: R.range(500, 700), q: .9, amp: .09});                     // swung up on the hinge
      const at = R.range(.06, .085);
      thock(out, sr, R, at, {f: R.range(220, 290), amp: 1, t60: .04, tc: .0016, grit: .4});                 // the barrels slam the breech
      thock(out, sr, R, at + .0008, {f: R.range(620, 780), amp: .45, t60: .018, tc: .001, grit: 0});
      tick(out, sr, R, at + R.range(.012, .022), {f: R.range(1450, 1850), amp: .5, t60: .006, body: .45});   // the top lever snaps back
    } else if (a === 'cock') {
      tick(out, sr, R, 0, {f: R.range(1400, 1700), amp: .5, t60: .005, tc: .0005, body: .3});               // the half-cock notch
      tick(out, sr, R, R.range(.03, .05), {f: R.range(1500, 1900), amp: 1, t60: .007, tc: .0005, body: .38});   // full cock
    } else {   // dry
      tick(out, sr, R, 0, {f: R.range(1500, 1900), amp: .25, t60: .004});                                   // the sear lets go
      const at = R.range(.008, .014);
      thock(out, sr, R, at, {f: R.range(480, 650), amp: 1, t60: .02, tc: .0008, grit: .2});                 // the hammer on the spent cap
      tick(out, sr, R, at, {f: R.range(1700, 2200), amp: .45, t60: .006, body: .3});
    }
    filter(out, 'highpass', 35, .7, sr);
    warm(out, sr, {shelf: -10, fs: 5000});    // warm game mix (RECIPE_GUIDE)
    return saturate(out, a === 'fire' ? 1.8 : 1.1);
  },
  // ranges from seeds 1-24, the lab's 44291-44296 and a few large seeds per case (v1), with a margin; hf4kDb (the energy
  // above 4 kHz against the total) bounds the brightness; every one-shot ends clean. The shot against the revolver's navy
  // (same seeds): centroid 160-295 Hz vs 240-460, the 95% band edge 0.5-1.0 kHz vs 0.9-1.6, t60 0.95-1.9 s vs 0.65-0.95,
  // above 4 kHz -55..-46 dB vs -38..-30, below 150 Hz -3.6..-1.5 dB of the total vs -4.6..-2.2: bigger and lower, not brighter
  criteria: {
    fire: {attackMs: [0, 45], t60Ms: [800, 2100], centroidHz: [130, 340], lowHz: [20, 60], highHz: [420, 1200], flatness: [0, .005], hf4kDb: [-70, -40], durMs: [1250, 1900], clickEnd: [0, .01]},
    break: {attackMs: [60, 170], t60Ms: [15, 70], centroidHz: [250, 560], highHz: [450, 1600], flatness: [0, .01], hf4kDb: [-60, -26], durMs: [150, 240], onsetCount: [1, 3], clickEnd: [0, .01]},
    eject: {centroidHz: [260, 700], highHz: [550, 1500], flatness: [0, .01], hf4kDb: [-55, -28], durMs: [340, 520], onsetCount: [1, 5], clickEnd: [0, .01]},
    load: {attackMs: [10, 70], t60Ms: [12, 60], centroidHz: [350, 720], highHz: [700, 1800], flatness: [0, .01], hf4kDb: [-60, -30], durMs: [85, 150], onsetCount: [1, 2], clickEnd: [0, .01]},
    close: {attackMs: [5, 95], t60Ms: [25, 90], centroidHz: [220, 420], highHz: [450, 1100], flatness: [0, .01], hf4kDb: [-60, -30], durMs: [120, 185], onsetCount: [1, 2], clickEnd: [0, .01]},
    cock: {t60Ms: [8, 35], centroidHz: [600, 1200], highHz: [1400, 2500], flatness: [0, .01], hf4kDb: [-50, -26], durMs: [80, 130], onsetCount: [1, 2], clickEnd: [0, .01]},
    dry: {attackMs: [3, 20], t60Ms: [12, 50], centroidHz: [340, 650], highHz: [500, 1250], flatness: [0, .01], hf4kDb: [-60, -35], durMs: [60, 100], clickEnd: [0, .01]},
  },
  notes: 'Long Friedlander pulse + band-passed black-powder chuff + roughened pink body + damped low thump + rolling brown tail with darker rock slaps; mechanics are damped low-mid thocks and short low steel ticks; see the header',
};
