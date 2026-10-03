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

// ======================================================================================================================
// v3: THE WESTERN-MOVIE FLAVORS (the user, on v2: "I don't like the sounds, we should try to make them sound more
// 'western movie'"). Three stylised sets the game switches between (?gunsfx= / menu > Audio > Gun sounds); the v2 cases
// above stay as they were (the "before"). A flavored shot has v2's physical parts (hammer, crack, blast, body, thump)
// voiced for the screen, then the place it rolls off, baked in (no convolver per shot: the engine's one shared reverb
// only adds the biome's air on top):
//   spaghetti  Leone. The Dollars films' gunshots were recorded in a canyon outside Rome with rifles (now and then a
//              cannon) standing in for pistols, then treated electronically and played loud: a whip CRACK, the genre's
//              metallic PING inside the report (a kicked spring reverb: dispersion turns the click into a falling
//              chirp, repeated down the spring), an artillery THUMP, then the CANYON: a hard slapback and 5 discrete
//              echoes off far walls, each later, darker and more smeared, over a long rolling roll (RT60 2.6-3 s)
//   hollywood  the 1950s studio western: a stock-library BANG, fat and compressed (the core driven hard, band-limited
//              like an optical track: thin under ~70 Hz, rolled off over ~7 kHz), in the studio's echo chamber (dense early
//              reflections, a smooth tail, RT60 1.7-2 s) with one canyon slap ~0.2 s out
//   gritty     the modern realistic western (Unforgiven, Red Dead): a short, sharp crack, a heavy low punch (a deep,
//              long thump), dense early reflections off the town's walls and a grounded, dark, rolling tail (the terrain
//              answering: RT60 1.7-2 s, no musical echoes, one faint far slap)
//   peacemaker tighter and higher in every flavor; navy heavier (a longer pulse, a deeper thump, a bigger place)
// The cock (the draw and the aim's telegraph): the movie double click: leather, a lighter half-cock click, a deliberate
// beat, the full-cock CLACK on the frame, the cylinder indexing; spaghetti's close-up rings in the canyon, gritty's is
// heavier and darker with the mainspring between the clicks.
// Echoes and tails here are mixed by ENERGY against the shot's core (g = amplitude ratio of the RMS totals).
const STYLES = ['spaghetti', 'hollywood', 'gritty'];
// a smoothed random wobble round 0 (peak 1): white noise through two one-pole low-passes at fc Hz
function rough(n, sr, R, fc) {
  const b = white(n, R), k = 1 - Math.exp(-2 * PI * fc / sr); let y1 = 0, y2 = 0, m = 1e-9;
  for (let i = 0; i < n; i++) { y1 += (b[i] - y1) * k; y2 += (y1 - y2) * k; b[i] = y2; m = Math.max(m, Math.abs(y2)); }
  return scale(b, 1 / m);
}
const energy = b => { let e = 0; for (let i = 0; i < b.length; i++) e += b[i] * b[i]; return e; };
// a discrete echo of `src` (energy en) at sample i0: smeared by sparse taps over sm s (a rough, far wall), darkened by two
// low-passes at lp, thinned below hp; energy g^2 of the source's
function echo(out, sr, R, src, en, i0, g, lp, sm, hp = 120) {
  if (i0 >= out.length || !(g > 0)) return;
  const ns = Math.min(out.length - i0, src.length + Math.round(sm * sr)), e = new Float32Array(ns), k = 1 + Math.round(sm * 260);
  for (let j = 0; j < k; j++) {
    const o = j ? Math.round(Math.pow(R(), 1.4) * sm * sr) : 0, a = j ? R.range(.25, .75) * R.sign() : 1;
    for (let i = 0; i + o < ns && i < src.length; i++) e[i + o] += src[i] * a;
  }
  filter(e, 'lowpass', lp, .7, sr); filter(e, 'lowpass', lp * 1.3, .7, sr); filter(e, 'highpass', hp, .7, sr);
  const ee = energy(e); if (ee > 0) add(out, scale(e, g * Math.sqrt(en / ee)), i0);
}
// the diffuse tail at sample i0: noise built up over a s, decaying to -60 dB in rt s (sized to -80 dB), darkening from lp0
// to lp1 Hz (two one-poles whose cutoff falls exponentially over rt), rolling (a slow random swell, depth roll at ~rollF Hz),
// thinned below hp; energy g^2 of the core's (en)
function tail(out, sr, R, en, i0, {rt, a = .02, lp0, lp1, roll = 0, rollF = 4, hp = 90, g, color = 'pink'}) {
  const n = Math.min(out.length - i0, Math.round((rt * 1.34 + a * 4) * sr)); if (n <= 0 || !(g > 0)) return;
  const b = color === 'brown' ? brown(n, R) : pink(n, R), rl = roll ? rough(n, sr, R, rollF) : null;
  const kd = Math.exp(-6.9078 / (rt * sr)), ka = Math.exp(-1 / (a * sr)), kf = Math.pow(lp1 / lp0, 32 / (rt * sr));
  let y = 0, y2 = 0, k = 0, fc = lp0, ea = 1, ed = 1;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) { k = 1 - Math.exp(-2 * PI * fc / sr); if (i < rt * sr) fc *= kf; }
    y += (b[i] - y) * k; y2 += (y - y2) * k; b[i] = y2 * (1 - ea) * ed * (rl ? Math.max(0, 1 + roll * rl[i]) : 1); ea *= ka; ed *= kd;
  }
  filter(b, 'highpass', hp, .7, sr);
  for (let i = n - Math.min(n, Math.round(.02 * sr)); i < n; i++) b[i] *= .5 + .5 * Math.cos(PI * (i - n + .02 * sr) / (.02 * sr));
  const eb = energy(b); if (eb > 0) add(out, scale(b, g * Math.sqrt(en / eb)), i0);
}
// the spaghetti PING at sample i0: a falling chirp f0 -> f1 Hz (time constant T / 3), repeated n times down the spring
// dly s apart, each fb quieter; peak g relative to pk
function ping(out, sr, R, i0, pk, {f0, f1, T, n, dly, fb, g}) {
  const len = Math.min(out.length - i0, Math.round((T * 3 + n * dly * 1.2) * sr)); if (len <= 0) return;
  const b = new Float32Array(len);
  for (let c = 0, s0 = 0; c < n; c++, s0 += Math.round(dly * R.jit(.12) * sr)) {
    const A = Math.pow(fb, c) * R.jit(.15), F0 = f0 * R.jit(.05) * (1 - .05 * c), F1 = f1 * R.jit(.08), kt = Math.exp(-3 / (T * sr)), kd = Math.exp(-1 / (T * .5 * sr)), ka = Math.exp(-1 / (.0004 * sr));
    let ph = R() * 2 * PI, ex = 1, ed = A, ea = 1;
    for (let i = 0; s0 + i < len && ed > 1e-5; i++) {
      ph += 2 * PI * (F1 + (F0 - F1) * ex) / sr; ex *= kt;
      b[s0 + i] += (1 - ea) * ed * (Math.sin(ph) + .16 * Math.sin(2 * ph + .7)); ea *= ka; ed *= kd;
    }
  }
  filter(b, 'lowpass', 5000, .7, sr); filter(b, 'highpass', 500, .7, sr);
  add(out, norm(b, g * pk), i0);
}

// the flavored shot: the core (crack, blast, body, thump, all from ignition), the ping, the place (early reflections,
// discrete echoes [t s, g, lp Hz, smear s], the diffuse tail). Params per flavor and gun in WEST below.
function wshot(out, sr, R, P) {
  const t0 = R.range(.003, .0045);                              // hammer fall -> ignition
  tick(out, sr, R, 0, {f: R.range(2000, 2500), amp: .05, t60: .005});
  const i0 = Math.round(t0 * sr), nC = Math.round(P.core * sr), core = new Float32Array(nC);
  // 1. the crack: a Friedlander pulse + a short crackle, band-limited
  const tp = P.tp * R.jit(.15), kq = R.range(.9, 1.1), nc = Math.round(.03 * sr), crack = new Float32Array(nc);
  for (let i = 0; i < nc; i++) { const t = i / sr / tp; crack[i] = t < 7 ? (1 - t) * Math.exp(-kq * t) : 0; }
  add(crack, norm(burst(.03, sr, R, {a: .00004, d: P.crackD * R.jit(.2), color: 'pink'}), P.crackN));
  filter(crack, 'highpass', P.crackHP, .7, sr); filter(crack, 'lowpass', P.crackLP, .7, sr); filter(crack, 'lowpass', P.crackLP * 1.3, .7, sr);
  add(core, norm(crack, P.crack * R.jit(.08)));
  // 2. the powder blast: a quick band-passed burst
  const bA = P.blastA * R.jit(.3), bD = P.blastD * R.jit(.2), nB = Math.min(nC, Math.round((bD * TAIL + bA * 3) * sr));
  const blast = adr(pink(nB, R), sr, bA, bD);
  filter(blast, 'bandpass', P.blastF * R.jit(.15), .8, sr); filter(blast, 'lowpass', P.blastLP, .7, sr);
  add(core, norm(blast, P.blast * R.jit(.12)));
  // 3. the body: low-passed pink with a fast exponential decay
  const dD = P.bodyD * R.jit(.15), nb = Math.min(nC, Math.round((dD * TAIL + .005) * sr)), body = adr(pink(nb, R), sr, .0006, dD);
  const bL = P.bodyLP * R.jit(.1); filter(body, 'lowpass', bL, .8, sr); filter(body, 'lowpass', bL * 1.5, .7, sr); filter(body, 'highpass', 100, .7, sr);
  add(core, norm(body, P.body * R.jit(.1)));
  // 4. the thump: a pressure pulse into two heavily damped low modes
  const tT = P.thumpT * R.jit(.1), nt = Math.min(nC, Math.round((tT * 1.6 + .04) * sr));
  add(core, norm(modal(halfSine(P.thumpTc * R.jit(.2), sr), [{f: P.thumpF * R.jit(.08), t60: tT, a: 1}, {f: P.thumpF * R.range(1.7, 2.1), t60: tT * .55, a: .45}], sr, nt), P.thump * R.jit(.08)));
  if (P.drive) saturate(core, P.drive);                          // hollywood: the stock bang, fat and compressed
  const pk = peak(core), en = energy(core);
  add(out, core, i0);
  if (P.ping) ping(out, sr, R, i0 + Math.round(R.range(.001, .003) * sr), pk, P.ping);
  // 5. the place: early reflections (the chamber, the town's walls), discrete echoes, the diffuse tail
  if (P.er) for (let j = 0; j < P.er.n; j++) echo(out, sr, R, core, en, i0 + Math.round(R.range(P.er.t[0], P.er.t[1]) * sr), P.er.g * R.range(.5, 1), P.er.lp * R.jit(.15), .003, 150);
  for (const [t, g, lp, sm] of P.echoes) echo(out, sr, R, core, en, i0 + Math.round(t * R.jit(.08) * sr), g * R.jit(.2), lp * R.jit(.1), sm);
  tail(out, sr, R, en, i0 + Math.round(P.tail.at * sr), {...P.tail, rt: P.tail.rt * R.jit(.08), roll: (P.tail.roll || 0) * R.jit(.25), rollF: (P.tail.rollF || 4) * R.jit(.3)});
}

// the flavored cock: leather, the half-cock click, a beat, the full-cock CLACK (a strike + the frame's knock), the
// cylinder's index; then (spaghetti) the close-up's canyon or (hollywood) a small room
function wcock(out, sr, R, P) {
  const n = Math.round(.4 * sr), dry = new Float32Array(n);
  swish(dry, sr, R, 0, R.range(.06, .085), {f: 720, amp: P.swish});                          // out of the leather
  const t1 = R.range(.085, .11), t2 = t1 + R.range(P.gap[0], P.gap[1]);
  tick(dry, sr, R, t1, {f: R.range(P.f1[0], P.f1[1]), amp: .5, t60: P.t60 * .8, tc: P.tc, body: P.body * .8});   // half cock
  if (P.spring) swish(dry, sr, R, t1 + .006, t2 - t1 - .004, {f: R.range(1100, 1500), q: 2.2, amp: P.spring});    // the mainspring, compressed
  tick(dry, sr, R, t2, {f: R.range(P.f2[0], P.f2[1]), amp: 1, t60: P.t60, tc: P.tc, body: P.body});              // full cock: the CLACK
  const kn = modal(halfSine(.0007, sr), [{f: R.range(P.knock[0], P.knock[1]), t60: .022, a: 1}, {f: R.range(1300, 1700), t60: .012, a: .4}], sr, Math.round(.06 * sr));
  add(dry, norm(kn, P.knockA), Math.round((t2 + .0005) * sr));
  tick(dry, sr, R, t2 + R.range(.007, .013), {f: R.range(3100, 3700), amp: .28, t60: .005});                    // the cylinder indexes
  add(out, dry);
  if (P.room) {
    const en = energy(dry);
    for (const [t, g, lp, sm] of P.room.echoes) echo(out, sr, R, dry, en, Math.round((t2 + t * R.jit(.1)) * sr), g * R.jit(.15), lp, sm, 300);
    tail(out, sr, R, en, Math.round((t2 - .02) * sr), {...P.room.tail, rt: P.room.tail.rt * R.jit(.1)});
  }
}

// the flavors. Shot: tp / crackD (s), crackN (the crackle's share), crackHP / crackLP (Hz), crack; blastA / blastD (s) at
// blastF Hz under blastLP; bodyD (s) under bodyLP; thumpF (Hz) / thumpT (t60 s) / thumpTc (pulse s); core (s: the buffer the
// echoes copy); drive (the core saturated); ping; er {n, t [s], g, lp}; echoes [[t s, g, lp Hz, smear s]]; tail; out: the
// final band (hp / lp Hz, a high shelf [dB, Hz]) and the glue (sat); dur (s, the buffer: the forge trims at -80 dB).
const WEST = {
  spaghetti: {
    peacemaker: {tp: .0007, crackD: .0035, crackN: .55, crackHP: 850, crackLP: 7000, crack: 1.05, blastA: .0006, blastD: .018, blastF: 950, blastLP: 3200, blast: .75,
      bodyD: .04, bodyLP: 2600, body: .8, thumpF: 72, thumpT: .17, thumpTc: .0048, thump: 1.2, core: .45,
      ping: {f0: 3500, f1: 1150, T: .065, n: 4, dly: .031, fb: .5, g: .38},
      echoes: [[.12, .4, 3200, .006], [.34, .32, 2300, .016], [.58, .24, 1800, .026], [.86, .17, 1400, .038], [1.2, .11, 1100, .052], [1.62, .07, 850, .07]],
      tail: {at: .03, rt: 2.6, a: .05, lp0: 3600, lp1: 700, roll: .35, rollF: 3, hp: 100, g: .4},
      out: {hp: 35, shelf: [-2, 6500]}, sat: 2, dur: 3.9},
    navy: {tp: .001, crackD: .0045, crackN: .5, crackHP: 650, crackLP: 6200, crack: .95, blastA: .0008, blastD: .024, blastF: 720, blastLP: 2800, blast: .8,
      bodyD: .055, bodyLP: 2100, body: .9, thumpF: 60, thumpT: .21, thumpTc: .006, thump: 1.5, core: .55,
      ping: {f0: 3000, f1: 950, T: .075, n: 4, dly: .036, fb: .52, g: .32},
      echoes: [[.14, .42, 2900, .007], [.38, .34, 2100, .018], [.65, .26, 1600, .028], [.97, .18, 1250, .04], [1.35, .12, 1000, .055], [1.82, .075, 780, .075]],
      tail: {at: .035, rt: 3, a: .06, lp0: 3200, lp1: 600, roll: .35, rollF: 2.6, hp: 90, g: .44},
      out: {hp: 33, shelf: [-2.5, 6500]}, sat: 2, dur: 4.4},
    cock: {swish: .3, gap: [.075, .11], f1: [2500, 2900], f2: [2900, 3400], t60: .012, tc: .00018, body: .4, knock: [800, 1050], knockA: .55,
      room: {echoes: [[.11, .26, 2600, .008], [.3, .11, 1800, .02]], tail: {rt: .45, a: .008, lp0: 3500, lp1: 1200, hp: 300, g: .24}}, out: {hp: 80, shelf: [-3, 6500]}, sat: 1.2, dur: .75},
  },
  hollywood: {
    peacemaker: {tp: .0011, crackD: .004, crackN: .5, crackHP: 450, crackLP: 5200, crack: .85, blastA: .0008, blastD: .024, blastF: 720, blastLP: 2600, blast: 1,
      bodyD: .05, bodyLP: 2300, body: 1, thumpF: 86, thumpT: .1, thumpTc: .005, thump: 1, core: .4, drive: 2.6,
      er: {n: 7, t: [.008, .045], g: .25, lp: 4200},
      echoes: [[.22, .3, 2400, .012], [.5, .12, 1600, .03]],
      tail: {at: .01, rt: 1.7, a: .015, lp0: 5000, lp1: 1600, hp: 110, g: .45},
      out: {hp: 75, lp: 7000, shelf: [-3, 5000]}, sat: 2.4, dur: 2.6},
    navy: {tp: .0015, crackD: .0045, crackN: .5, crackHP: 380, crackLP: 4600, crack: .8, blastA: .001, blastD: .03, blastF: 580, blastLP: 2300, blast: 1,
      bodyD: .062, bodyLP: 1900, body: 1, thumpF: 70, thumpT: .13, thumpTc: .006, thump: 1.2, core: .45, drive: 2.6,
      er: {n: 7, t: [.01, .05], g: .25, lp: 3800},
      echoes: [[.25, .32, 2200, .014], [.56, .13, 1500, .032]],
      tail: {at: .012, rt: 2, a: .018, lp0: 4500, lp1: 1400, hp: 100, g: .48},
      out: {hp: 70, lp: 6800, shelf: [-3, 5000]}, sat: 2.4, dur: 3},
    cock: {swish: .32, gap: [.06, .085], f1: [2400, 2800], f2: [2800, 3200], t60: .009, tc: .0002, body: .35, knock: [850, 1100], knockA: .45,
      room: {echoes: [], tail: {rt: .35, a: .004, lp0: 5000, lp1: 2000, hp: 300, g: .35}}, out: {hp: 90, lp: 7500, shelf: [-3, 5000]}, sat: 1.3, dur: .5},
  },
  gritty: {
    peacemaker: {tp: .0006, crackD: .0045, crackN: .7, crackHP: 1000, crackLP: 9000, crack: 1.2, blastA: .0005, blastD: .016, blastF: 900, blastLP: 3400, blast: .75,
      bodyD: .03, bodyLP: 2600, body: .75, thumpF: 56, thumpT: .15, thumpTc: .006, thump: 1.7, core: .35,
      er: {n: 12, t: [.012, .09], g: .21, lp: 3600},
      echoes: [[.085, .26, 1900, .01], [.62, .09, 750, .07]],
      tail: {at: .02, rt: 1.7, a: .06, lp0: 1800, lp1: 420, roll: .55, rollF: 4.5, hp: 70, g: .42, color: 'brown'},
      out: {hp: 30, shelf: [-4, 5000]}, sat: 1.9, dur: 2.6},
    navy: {tp: .0009, crackD: .005, crackN: .7, crackHP: 800, crackLP: 8000, crack: 1.1, blastA: .0007, blastD: .022, blastF: 700, blastLP: 3000, blast: .8,
      bodyD: .042, bodyLP: 2100, body: .8, thumpF: 47, thumpT: .19, thumpTc: .0075, thump: 2, core: .42,
      er: {n: 12, t: [.014, .1], g: .22, lp: 3200},
      echoes: [[.095, .28, 1700, .012], [.7, .1, 680, .08]],
      tail: {at: .022, rt: 2, a: .07, lp0: 1600, lp1: 380, roll: .55, rollF: 4, hp: 60, g: .45, color: 'brown'},
      out: {hp: 28, shelf: [-4.5, 5000]}, sat: 1.9, dur: 3},
    cock: {swish: .38, gap: [.07, .1], f1: [2000, 2400], f2: [2300, 2700], t60: .01, tc: .00028, body: .55, knock: [650, 850], knockA: .7, spring: .1,
      out: {hp: 60, shelf: [-5, 5000]}, sat: 1.25, dur: .4},
  },
};
const FLAVORED = ['peacemaker', 'navy', 'cock'];

export default {
  id: 'revolver', version: 3, desc: 'Single-action revolvers: shots with a dry desert tail, the dry click, cocking, loading, ejecting, the spin, the holster; v3: the western-movie flavors (spaghetti / hollywood / gritty shots and cocks)',
  params: {act: {values: ['peacemaker', 'navy', 'dry', 'cock', 'load', 'eject', 'spin', 'holster'], def: 'peacemaker'}, style: {values: ['v2', ...STYLES], def: 'v2'}},
  cases: {peacemaker: {act: 'peacemaker'}, navy: {act: 'navy'}, dry: {act: 'dry'}, cock: {act: 'cock'}, load: {act: 'load'}, eject: {act: 'eject'},
    spin: {act: 'spin'}, holster: {act: 'holster'},
    ...Object.fromEntries(STYLES.flatMap(s => FLAVORED.map(a => [`${s}_${a}`, {act: a, style: s}])))},
  variants: 5,
  render(p, R, sr) {
    const a = p.act;
    if (p.style !== 'v2' && WEST[p.style] && FLAVORED.includes(a)) {
      const P = WEST[p.style][a], out = new Float32Array(Math.round(P.dur * sr));
      if (a === 'cock') wcock(out, sr, R, P); else wshot(out, sr, R, P);
      filter(out, 'highpass', P.out.hp, .7, sr);
      if (P.out.lp) { filter(out, 'lowpass', P.out.lp, .5412, sr); filter(out, 'lowpass', P.out.lp, 1.3066, sr); }   // the optical track's edge
      filter(out, 'highshelf', P.out.shelf[1], .7, sr, P.out.shelf[0]);
      return saturate(out, P.sat);
    }
    const out = new Float32Array(Math.round(DUR[a] * sr));
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
    // the western-movie flavors (v3 / v2): ranges from 37 seeds (1-24, the lab's 44291-44296, seven large ones) with a margin
    // (t60 x.75..1.25, centroid / highHz x.85..1.15, hf4kDb -4..+3 dB, durMs x.9..1.1); the shots' t60 includes the echoes
    spaghetti_peacemaker: {attackMs: [0, 25], t60Ms: [2500, 6100], centroidHz: [700, 1500], lowHz: [30, 95], highHz: [2100, 3500], flatness: [0, .023], hf4kDb: [-26, -15], durMs: [2620, 3870], onsetCount: [2, 6], clickEnd: [0, .01]},
    spaghetti_navy: {attackMs: [0, 30], t60Ms: [3000, 6600], centroidHz: [550, 1050], lowHz: [30, 95], highHz: [1700, 2900], flatness: [0, .012], hf4kDb: [-29, -18], durMs: [3180, 4600], onsetCount: [1, 6], clickEnd: [0, .01]},
    spaghetti_cock: {attackMs: [85, 275], t60Ms: [800, 2000], centroidHz: [1100, 1950], lowHz: [145, 430], highHz: [2400, 4100], flatness: [0, .026], hf4kDb: [-24, -12], durMs: [590, 830], onsetCount: [3, 6], clickEnd: [0, .01]},
    hollywood_peacemaker: {attackMs: [0, 45], t60Ms: [1050, 2050], centroidHz: [550, 1100], lowHz: [45, 190], highHz: [1700, 2900], flatness: [0, .005], hf4kDb: [-27, -18], durMs: [1770, 2590], onsetCount: [0, 3], clickEnd: [0, .01]},
    hollywood_navy: {attackMs: [0, 65], t60Ms: [1200, 2350], centroidHz: [500, 950], lowHz: [45, 190], highHz: [1550, 2600], flatness: [0, .005], hf4kDb: [-28, -19], durMs: [2050, 2910], onsetCount: [0, 3], clickEnd: [0, .01]},
    hollywood_cock: {attackMs: [75, 240], t60Ms: [140, 350], centroidHz: [950, 1800], lowHz: [130, 430], highHz: [2400, 4000], flatness: [0, .01], hf4kDb: [-24, -13], durMs: [450, 550], onsetCount: [2, 4], clickEnd: [0, .01]},
    gritty_peacemaker: {attackMs: [0, 45], t60Ms: [1150, 2500], centroidHz: [370, 700], lowHz: [30, 65], highHz: [1350, 2600], flatness: [0, .005], hf4kDb: [-35, -22], durMs: [1870, 2710], onsetCount: [0, 3], clickEnd: [0, .01]},
    gritty_navy: {attackMs: [0, 40], t60Ms: [1350, 2900], centroidHz: [330, 650], lowHz: [15, 65], highHz: [1100, 2300], flatness: [0, .005], hf4kDb: [-38, -24], durMs: [2260, 3200], onsetCount: [0, 3], clickEnd: [0, .01]},
    gritty_cock: {attackMs: [85, 280], t60Ms: [10, 210], centroidHz: [750, 1350], lowHz: [110, 340], highHz: [1900, 3300], flatness: [0, .019], hf4kDb: [-30, -16], durMs: [180, 290], onsetCount: [3, 4], clickEnd: [0, .01]},
  },
  notes: 'Friedlander crack + pink gas body + damped low thump + brown desert tail with soft rock slaps; steel ticks are short modal strikes (t60 < 15 ms); see the header',
};
