// REVOLVER: the cowboys' single-action revolvers and their handling (sim/player/gun.js: player.shoot / dryfire / draw /
// reload / holster). Physical parts on one timeline per case:
//   shot     the hammer falls (a faint tick), ~3-4 ms later the powder: a muzzle CRACK (a Friedlander-shaped pressure
//            pulse, short white crackle on top, high-passed: the snap), the gas BODY (pink noise low-passed, a fast
//            exponential decay: the bark), a low THUMP (half-sine pulse into 2 heavily damped low modes: the push in
//            your chest, no ring), then the DRY DESERT TAIL: open ground, so no room: a dark brown-noise decay
//            (low-passed ~1 kHz) and one or two soft low-passed slap echoes off rock 50-140 ms out. Nothing tonal rings.
//            peacemaker: a sharp crack, tighter, brighter; navy: a deeper, longer boom (more thump, darker body).
//   dry      the hammer on an empty chamber: a sear tick, then the click: tiny steel modes, all dead in < 15 ms
//   cock     the draw: leather swish out of the holster, then the hammer's two notch clicks and the cylinder's index
//   load     a round pushed into the chamber (a short brass-on-steel slide), seated with a soft tap; the cylinder clicks on
//   eject    the ejector rod's scrape, then spent cases dropping into the sand: dull, damped brass taps (no tinkle)
//   spin     the cylinder spun by hand: a ratchet of clicks slowing from ~26/s to ~7/s with a faint whir, the gate shut
//   holster  the twirl's last turn and the gun dropping into leather: a swish and a soft slap
// The user's taste (RECIPE_GUIDE): no hollow or ringing impacts, darker one-shots: every mode is short and every case
// ends through a high shelf.
import {add, filter, halfSine, modal, burst, pink, brown, white, saturate, scale, peak} from '../dsp.js';

const PI = Math.PI;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const ad = (b, sr, a, d, at = 0) => { for (let i = 0; i < b.length; i++) { const t = i / sr - at; b[i] *= t < 0 ? 0 : (1 - Math.exp(-t / a)) * Math.exp(-t / d); } return b; };
// a small steel tick: a half-sine contact into short modes (t60 a few ms), added at `at` s
function tick(out, sr, R, at, {f = 3200, amp = 1, t60 = .008, tc = .00025, body = 0} = {}) {
  const i0 = Math.round(at * sr); if (i0 >= out.length) return;
  const n = Math.min(out.length - i0, Math.round((t60 * 1.6 + .02) * sr));
  const modes = [{f: f * R.jit(.06), t60, a: 1}, {f: f * R.range(1.47, 1.62), t60: t60 * .7, a: .55}, {f: f * R.range(2.2, 2.6), t60: t60 * .5, a: .3}];
  if (body) modes.push({f: R.range(650, 950), t60: R.range(.015, .025), a: body});   // the frame / grip under the hand
  add(out, norm(modal(halfSine(tc * R.jit(.2), sr), modes, sr, n), amp), i0);
}
// leather / cloth friction: band-passed pink noise under a bell envelope
function swish(out, sr, R, at, dur, {f = 900, q = .8, amp = .4} = {}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round(dur * sr)); if (n <= 0) return;
  const b = filter(pink(n, R), 'bandpass', f * R.jit(.15), q, sr);
  for (let i = 0; i < n; i++) b[i] *= Math.sin(PI * i / n) ** 2;
  add(out, norm(b, amp), i0);
}

function shot(out, sr, R, P) {
  const t0 = R.range(.003, .0045);                              // hammer fall -> ignition
  tick(out, sr, R, 0, {f: R.range(2400, 3000), amp: .08, t60: .006});
  const i0 = Math.round(t0 * sr), n = out.length - i0;
  // 1. the crack: a Friedlander pulse (positive phase tp, then the small suction) + a crackle, high-passed
  const tp = P.tp * R.jit(.15), nc = Math.round(.03 * sr), crack = new Float32Array(nc);
  for (let i = 0; i < nc; i++) { const t = i / sr / tp; crack[i] = t < 6 ? (1 - t) * Math.exp(-R.range(.9, 1.1) * t) : 0; }
  const cr = burst(.03, sr, R, {a: .00005, d: P.crackD * R.jit(.2), color: 'white'});
  add(crack, norm(cr, .55));
  filter(crack, 'highpass', P.crackHP, .7, sr); filter(crack, 'lowpass', P.crackLP, .7, sr);
  add(out, norm(crack, P.crack), i0);
  // 2. the body: the gas bark
  const nb = Math.min(n, Math.round((P.bodyD * 7 + .02) * sr)), body = ad(pink(nb, R), sr, .0006, P.bodyD * R.jit(.15));
  filter(body, 'lowpass', P.bodyLP * R.jit(.1), .8, sr); filter(body, 'highpass', 120, .7, sr);
  add(out, norm(body, P.body), i0);
  // 3. the thump: a pressure pulse into two heavily damped low modes (felt, not heard as a note)
  const nt = Math.min(n, Math.round(.25 * sr));
  const th = modal(halfSine(R.range(.0035, .006), sr), [{f: P.thumpF * R.jit(.08), t60: P.thumpT, a: 1}, {f: P.thumpF * R.range(1.7, 2.1), t60: P.thumpT * .55, a: .45}], sr, nt);
  add(out, norm(th, P.thump), i0);
  // 4. the dry desert tail: dark brown decay + one or two soft slaps off rock (no room, nothing that rings)
  const nl = Math.min(n, Math.round((P.tailD * 7 + .05) * sr)), tail = ad(brown(nl, R), sr, .012, P.tailD * R.jit(.12));
  filter(tail, 'lowpass', P.tailLP, .7, sr); filter(tail, 'highpass', 70, .7, sr);
  add(out, norm(tail, P.tail), i0);
  const echoes = R() < .5 ? 1 : 2;
  for (let k = 0; k < echoes; k++) {
    const d = R.range(.05, .14) * (k + 1), ne = Math.min(n - Math.round(d * sr), Math.round(.12 * sr)); if (ne <= 0) continue;
    const e = ad(pink(ne, R), sr, .002, R.range(.018, .03));
    filter(e, 'lowpass', R.range(700, 1100), .7, sr);
    add(out, norm(e, P.echo * (k ? .55 : 1) * R.jit(.2)), i0 + Math.round(d * sr));
  }
}

const SHOT = {
  peacemaker: {tp: .0009, crackD: .003, crackHP: 900, crackLP: 7000, crack: 1.4, bodyD: .013, bodyLP: 4200, body: .55, thumpF: 105, thumpT: .06, thump: .35,
    tailD: .075, tailLP: 1100, tail: .16, echo: .1},
  navy: {tp: .0017, crackD: .005, crackHP: 450, crackLP: 4200, crack: .7, bodyD: .03, bodyLP: 1800, body: .9, thumpF: 68, thumpT: .11, thump: 1,
    tailD: .13, tailLP: 750, tail: .28, echo: .15},
};
const DUR = {peacemaker: .75, navy: .95, dry: .12, cock: .3, load: .26, eject: .55, spin: .85, holster: .32};

export default {
  id: 'revolver', version: 1, desc: 'Single-action revolvers: shots with a dry desert tail, the dry click, cocking, loading, ejecting, the spin, the holster',
  params: {act: {values: ['peacemaker', 'navy', 'dry', 'cock', 'load', 'eject', 'spin', 'holster'], def: 'peacemaker'}},
  cases: {peacemaker: {act: 'peacemaker'}, navy: {act: 'navy'}, dry: {act: 'dry'}, cock: {act: 'cock'}, load: {act: 'load'}, eject: {act: 'eject'},
    spin: {act: 'spin'}, holster: {act: 'holster'}},
  variants: 5,
  render(p, R, sr) {
    const a = p.act, out = new Float32Array(Math.round(DUR[a] * sr));
    if (a === 'peacemaker' || a === 'navy') shot(out, sr, R, SHOT[a]);
    else if (a === 'dry') {
      tick(out, sr, R, 0, {f: R.range(2000, 2600), amp: .25, t60: .005});                        // the sear lets go
      tick(out, sr, R, R.range(.009, .016), {f: R.range(2600, 3400), amp: 1, t60: R.range(.007, .011), body: .35});   // the hammer on nothing
    } else if (a === 'cock') {
      swish(out, sr, R, 0, R.range(.07, .1), {f: 750, amp: .45});                                  // out of the leather
      const t = R.range(.1, .13);
      tick(out, sr, R, t, {f: R.range(2200, 2800), amp: .6, t60: .007, body: .25});                // first notch
      tick(out, sr, R, t + R.range(.022, .034), {f: R.range(2600, 3200), amp: 1, t60: .008, body: .3});   // full cock
      tick(out, sr, R, t + R.range(.04, .055), {f: R.range(3400, 4000), amp: .25, t60: .005});     // the cylinder indexes
    } else if (a === 'load') {
      swish(out, sr, R, 0, R.range(.04, .06), {f: R.range(1400, 1900), q: 1.4, amp: .3});         // brass sliding in
      tick(out, sr, R, R.range(.045, .065), {f: R.range(1300, 1700), amp: .6, t60: .009, tc: .0006, body: .4});   // seated
      tick(out, sr, R, R.range(.15, .19), {f: R.range(2500, 3000), amp: .4, t60: .006});         // the cylinder clicks on
    } else if (a === 'eject') {
      swish(out, sr, R, 0, R.range(.05, .07), {f: R.range(1500, 2000), q: 1.6, amp: .35});        // the ejector rod
      tick(out, sr, R, R.range(.05, .07), {f: R.range(2600, 3000), amp: .4, t60: .006});
      const n = 2 + (R() < .5 ? 1 : 0);
      for (let k = 0; k < n; k++) {                                                                // cases into the sand
        const at = R.range(.16, .42), i0 = Math.round(at * sr);
        tick(out, sr, R, at, {f: R.range(3000, 3800), amp: R.range(.25, .4), t60: R.range(.01, .016), tc: .0005});
        const th = ad(burst(.04, sr, R, {a: .0004, d: .006, color: 'pink'}), sr, .0005, .008);
        filter(th, 'lowpass', 900, .7, sr); add(out, norm(th, .35), i0);
      }
    } else if (a === 'spin') {
      let t = 0, rate = R.range(24, 28); const end = R.range(.55, .65), r1 = R.range(6, 8);
      while (t < end) {
        const k = t / end;
        tick(out, sr, R, t, {f: R.range(2800, 3600), amp: .55 * (1 - .5 * k), t60: .004});
        rate = rate + (r1 - rate) * .12; t += 1 / rate;
      }
      const nw = Math.round(end * sr), whir = filter(pink(nw, R), 'bandpass', R.range(600, 900), 1.2, sr);
      for (let i = 0; i < nw; i++) whir[i] *= Math.sin(PI * i / nw) * (1 - i / nw);
      add(out, norm(whir, .12));
      tick(out, sr, R, end + R.range(.04, .07), {f: R.range(1900, 2300), amp: .9, t60: .009, tc: .0005, body: .45});   // the gate shut
    } else {   // holster
      swish(out, sr, R, 0, R.range(.12, .16), {f: R.range(600, 850), amp: .4});
      const at = R.range(.14, .17), i0 = Math.round(at * sr);
      const slap = ad(burst(.08, sr, R, {a: .0006, d: .012, color: 'pink'}), sr, .0008, .014);
      filter(slap, 'lowpass', 1100, .7, sr); add(out, norm(slap, .8), i0);
      tick(out, sr, R, at + .004, {f: R.range(1500, 1900), amp: .2, t60: .006, tc: .0007});
    }
    filter(out, 'highpass', 35, .7, sr);
    filter(out, 'highshelf', 5000, .7, sr, -9);    // warm game mix (RECIPE_GUIDE)
    return saturate(out, a === 'peacemaker' || a === 'navy' ? 1.6 : 1.1);
  },
  // ranges from seeds 1-24 per case (v1), with a margin; every one-shot ends clean
  criteria: {
    peacemaker: {attackMs: [0, 5], t60Ms: [350, 850], centroidHz: [300, 800], lowHz: [30, 120], highHz: [1100, 2900], flatness: [0, .01], durMs: [540, 620], clickEnd: [0, .01]},
    navy: {attackMs: [0, 25], t60Ms: [550, 1050], centroidHz: [200, 520], lowHz: [30, 100], highHz: [800, 1800], flatness: [0, .005], durMs: [900, 960], clickEnd: [0, .01]},
    dry: {attackMs: [0, 20], t60Ms: [10, 40], centroidHz: [1000, 2100], highHz: [2300, 3700], flatness: [0, .01], durMs: [60, 95], clickEnd: [0, .01]},
    cock: {t60Ms: [100, 450], centroidHz: [800, 1450], highHz: [2400, 3500], flatness: [0, .02], durMs: [180, 250], onsetCount: [1, 4], clickEnd: [0, .01]},
    load: {t60Ms: [220, 480], centroidHz: [1000, 1800], highHz: [2300, 3500], flatness: [0, .03], durMs: [190, 255], onsetCount: [1, 4], clickEnd: [0, .01]},
    eject: {centroidHz: [750, 1650], highHz: [2200, 3500], flatness: [0, .03], durMs: [260, 520], onsetCount: [1, 6], clickEnd: [0, .01]},
    spin: {centroidHz: [950, 1450], highHz: [2700, 3500], flatness: [0, .01], durMs: [640, 800], onsetCount: [7, 13], clickEnd: [0, .01]},
    holster: {centroidHz: [450, 950], highHz: [1100, 2300], flatness: [0, .012], durMs: [210, 275], clickEnd: [0, .01]},
  },
  notes: 'Friedlander crack + pink gas body + damped low thump + brown desert tail with soft rock slaps; steel ticks are short modal strikes (t60 < 15 ms); see the header',
};
