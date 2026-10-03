// REVOLVER: the cowboys' single-action revolvers and their handling (sim/player/gun.js: player.shoot / dryfire / draw /
// reload / holster). Physical parts on one timeline per case:
//   shot     the hammer falls (a faint tick), ~3-4 ms later the powder: a muzzle CRACK (a Friedlander-shaped pressure
//            pulse, a short pink crackle on top, band-limited: the snap), the POWDER BLAST (a quick band-passed burst at
//            500-800 Hz: the gas out of the muzzle and the cylinder gap), the gas BODY (pink noise low-passed, a fast
//            exponential decay: the bark), a low THUMP (half-sine pulse into 2 heavily damped low modes: the push in your
//            chest, no ring), the DRY DESERT TAIL (open ground, so no room: a dark brown decay with a slow swell), and the
//            SLAPBACK: the shot's first 70 ms off a wall or a rock face 12-19 m away, one discrete, darker copy 65-110 ms
//            out, then one faint far answer off the mesa. Every decay is sized to -80 dB. Nothing tonal rings.
//            peacemaker: tighter and higher (a crisper crack, a shorter tail); navy: heavier (more thump, a darker,
//            longer body and tail). v2 (the user: "heavier, more power"): more blast, body and thump, a weightier tail,
//            the slapback, darker on top.
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

// attack a, 1/e decay d (s) by running products (no exp per sample): the shot's long layers
const adr = (b, sr, a, d) => {
  const ka = Math.exp(-1 / (a * sr)), kd = Math.exp(-1 / (d * sr)); let ea = 1, ed = 1;
  for (let i = 0; i < b.length; i++) { b[i] *= (1 - ea) * ed; ea *= ka; ed *= kd; }
  return b;
};
const TAIL = 9.2;   // time constants to -80 dB: every decaying layer of the shot gets a buffer this long (RECIPE_GUIDE rule 2)

function shot(out, sr, R, P) {
  const t0 = R.range(.003, .0045);                              // hammer fall -> ignition
  tick(out, sr, R, 0, {f: R.range(2000, 2500), amp: .06, t60: .005});
  const i0 = Math.round(t0 * sr), n = out.length - i0, core = new Float32Array(Math.min(n, Math.round(.07 * sr)));
  // 1. the crack: a Friedlander pulse (positive phase tp, then the small suction) + a short crackle, band-limited
  const tp = P.tp * R.jit(.15), kq = R.range(.9, 1.1), nc = Math.round(.03 * sr), crack = new Float32Array(nc);
  for (let i = 0; i < nc; i++) { const t = i / sr / tp; crack[i] = t < 7 ? (1 - t) * Math.exp(-kq * t) : 0; }
  add(crack, norm(burst(.03, sr, R, {a: .00005, d: P.crackD * R.jit(.2), color: 'pink'}), .5));
  filter(crack, 'highpass', P.crackHP, .7, sr); filter(crack, 'lowpass', P.crackLP, .7, sr); filter(crack, 'lowpass', P.crackLP * 1.3, .7, sr);
  add(out, norm(crack, P.crack), i0); add(core, norm(crack, P.crack));
  // 2. the powder blast: the gas leaving the muzzle and the cylinder gap, a quick band-passed burst under the crack
  const bA = P.blastA * R.jit(.3), bD = P.blastD * R.jit(.2), nB = Math.min(n, Math.round((bD * TAIL + bA * 3) * sr));
  const blast = adr(pink(nB, R), sr, bA, bD);
  filter(blast, 'bandpass', P.blastF * R.jit(.15), .8, sr); filter(blast, 'lowpass', 2400, .7, sr);
  add(out, norm(blast, P.blast * R.jit(.12)), i0); add(core, norm(blast, P.blast * .9));
  // 3. the body: the gas bark, low-passed pink with a fast exponential decay
  const dD = P.bodyD * R.jit(.15), nb = Math.min(n, Math.round((dD * TAIL + .005) * sr)), body = adr(pink(nb, R), sr, .0006, dD);
  const bL = P.bodyLP * R.jit(.1); filter(body, 'lowpass', bL, .8, sr); filter(body, 'lowpass', bL * 1.5, .7, sr); filter(body, 'highpass', 110, .7, sr);
  add(out, norm(body, P.body), i0); add(core, norm(body, P.body));
  // 4. the thump: a pressure pulse into two heavily damped low modes (the push in your chest: felt, no ring)
  const tT = P.thumpT * R.jit(.1), nt = Math.min(n, Math.round((tT * 1.6 + .04) * sr));
  const th = modal(halfSine(P.thumpTc * R.jit(.2), sr), [{f: P.thumpF * R.jit(.08), t60: tT, a: 1}, {f: P.thumpF * R.range(1.7, 2.1), t60: tT * .55, a: .45}], sr, nt);
  add(out, norm(th, P.thump * R.jit(.08)), i0); add(core, norm(th, P.thump));
  // 5. the dry desert tail: open ground, no room: a dark brown decay, weightier than a crackle, a slow swell in it
  const lD = P.tailD * R.jit(.12), nl = Math.min(n, Math.round((lD * TAIL + .05) * sr)), tail = adr(brown(nl, R), sr, .01, lD);
  const sw = white(nl, R), kw = 1 - Math.exp(-2 * PI * R.range(5, 9) / sr); let w1 = 0, w2 = 0, wm = 1e-9;
  for (let i = 0; i < nl; i++) { w1 += (sw[i] - w1) * kw; w2 += (w1 - w2) * kw; sw[i] = w2; wm = Math.max(wm, Math.abs(w2)); }
  for (let i = 0; i < nl; i++) tail[i] *= Math.max(0, 1 + .35 * sw[i] / wm);
  filter(tail, 'lowpass', P.tailLP * R.jit(.1), .7, sr); filter(tail, 'lowpass', P.tailLP * 1.5, .7, sr); filter(tail, 'highpass', 65, .7, sr);
  add(out, norm(tail, P.tail * R.jit(.1)), i0);
  // 6. the slapback: the shot's first 70 ms off a wall or a rock face 12-19 m away: one discrete, darker, softer copy
  //    (outdoors: no room behind it), then one faint far answer off the mesa
  const sl = core.slice(), sL = P.slapLP * R.jit(.12), ns = sl.length;
  for (let i = 0; i < ns; i++) sl[i] *= i < ns * .6 ? 1 : .5 + .5 * Math.cos(PI * (i - ns * .6) / (ns * .4));   // its end faded
  filter(sl, 'lowpass', sL, .7, sr); filter(sl, 'lowpass', sL * 1.4, .7, sr); filter(sl, 'highpass', 140, .7, sr);
  add(out, norm(sl, P.slap * R.jit(.15)), i0 + Math.round(R.range(P.slapT[0], P.slapT[1]) * sr));
  const fa = Math.round(R.range(.24, .4) * sr), eD = R.range(.03, .045), ne = Math.min(n - fa, Math.round((eD * TAIL + .01) * sr));
  if (ne > 0) {
    const e = adr(pink(ne, R), sr, R.range(.004, .008), eD); filter(e, 'lowpass', R.range(550, 750), .7, sr); filter(e, 'lowpass', 900, .7, sr); filter(e, 'highpass', 80, .7, sr);
    add(out, norm(e, P.echo * R.jit(.25)), i0 + fa);
  }
}

// the shots: tp / crackD (s) + crackHP / crackLP (Hz) the crack; blastA / blastD (s) at blastF Hz the powder blast; bodyD (s)
// under bodyLP Hz; thumpF (Hz) / thumpT (t60 s) / thumpTc (pulse s); tailD (s) under tailLP (Hz); slap (level) slapT [s] slapLP
// (Hz) the slapback; echo the far answer; levels relative (the forge normalises). The Peacemaker: tighter and higher.
const SHOT = {
  peacemaker: {tp: .001, crackD: .003, crackHP: 700, crackLP: 4600, crack: 1.05, blastA: .0008, blastD: .016, blastF: 780, blast: .75,
    bodyD: .02, bodyLP: 2600, body: .7, thumpF: 88, thumpT: .085, thumpTc: .0042, thump: .9, tailD: .075, tailLP: 950, tail: .22,
    slap: .3, slapT: [.065, .09], slapLP: 1700, echo: .045},
  navy: {tp: .0018, crackD: .005, crackHP: 420, crackLP: 3600, crack: .75, blastA: .0012, blastD: .026, blastF: 540, blast: .8,
    bodyD: .038, bodyLP: 1700, body: .9, thumpF: 63, thumpT: .13, thumpTc: .0058, thump: 1.45, tailD: .13, tailLP: 760, tail: .3,
    slap: .38, slapT: [.08, .11], slapLP: 1400, echo: .11},
};
const DUR = {peacemaker: 1.05, navy: 1.45, dry: .12, cock: .3, load: .26, eject: .55, spin: .85, holster: .32};

export default {
  id: 'revolver', version: 2, desc: 'Single-action revolvers: shots with a dry desert tail, the dry click, cocking, loading, ejecting, the spin, the holster',
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
    filter(out, 'highshelf', 5000, .7, sr, a === 'peacemaker' || a === 'navy' ? -11 : -9);    // warm game mix (RECIPE_GUIDE)
    return saturate(out, a === 'peacemaker' || a === 'navy' ? 1.9 : 1.1);
  },
  // ranges from seeds 1-24 per case (v1; the shots v2: seeds 1-24, the lab's 44291-44296 and large ones), with a margin;
  // every one-shot ends clean. The shots v2 against v1 (same seeds): energy > 4 kHz peacemaker -38..-30 dB (v1 -25..-19),
  // navy -45..-37 (v1 -38..-30); < 150 Hz peacemaker -6.2..-2.6 dB of the total (v1 -9.4..-2.4); both now decay to -80 dB
  // inside their buffers (v1 cut the tail off at 0.57 / 0.93 s); t60 includes the slapback and the far answer
  criteria: {
    peacemaker: {attackMs: [0, 20], t60Ms: [400, 1300], centroidHz: [300, 680], lowHz: [30, 120], highHz: [950, 2300], flatness: [0, .01], hf4kDb: [-46, -26], durMs: [580, 840], clickEnd: [0, .01]},
    navy: {attackMs: [0, 35], t60Ms: [600, 1350], centroidHz: [200, 500], lowHz: [30, 100], highHz: [650, 1600], flatness: [0, .006], hf4kDb: [-52, -33], durMs: [900, 1450], clickEnd: [0, .01]},
    dry: {attackMs: [0, 20], t60Ms: [10, 40], centroidHz: [1000, 2100], highHz: [2300, 3700], flatness: [0, .01], durMs: [60, 95], clickEnd: [0, .01]},
    cock: {t60Ms: [100, 450], centroidHz: [800, 1450], highHz: [2400, 3500], flatness: [0, .02], durMs: [180, 250], onsetCount: [1, 4], clickEnd: [0, .01]},
    load: {t60Ms: [220, 480], centroidHz: [1000, 1800], highHz: [2300, 3500], flatness: [0, .03], durMs: [190, 255], onsetCount: [1, 4], clickEnd: [0, .01]},
    eject: {centroidHz: [750, 1650], highHz: [2200, 3500], flatness: [0, .03], durMs: [260, 520], onsetCount: [1, 6], clickEnd: [0, .01]},
    spin: {centroidHz: [950, 1450], highHz: [2700, 3500], flatness: [0, .01], durMs: [640, 800], onsetCount: [7, 13], clickEnd: [0, .01]},
    holster: {centroidHz: [450, 950], highHz: [1100, 2300], flatness: [0, .012], durMs: [210, 275], clickEnd: [0, .01]},
  },
  notes: 'Friedlander crack + pink gas body + damped low thump + brown desert tail with soft rock slaps; steel ticks are short modal strikes (t60 < 15 ms); see the header',
};
