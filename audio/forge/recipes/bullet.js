// BULLET: what a bullet sounds like where it ends (sim/projectiles.js and features/foes/sim.js: bullet.impact {surf}; combat's
// hits on the gunmen; bullet.pierce). Physical parts on one timeline per case:
//   sand     into sand or dirt: a dull THUD (a broad contact into a damped low mode + a low-passed pink burst), the PUFF of
//            dirt kicked up (a soft low swell), then the GRAIN SPRAY falling back: sparse, dark ticks over ~150 ms
//   stone    into stone or adobe: a hard CHIP (a very short contact into short stone modes over a damped mass mode, a
//            band-passed chip burst), a few chips falling back, a breath of dust (low-passed, short)
//   wood     into a post, a plank, a wagon bed: a solid THUNK (damped low-mid modes, Q ~4) and a short dark splinter
//   metal    into an iron cart, a steel tank: a damped CLANK (thick-plate modes dying in tens of ms, a dull thud under it)
//            and at most one short spark tick. Never a ring
//   ricochet off stone or metal (the runtime layers it now and then): a falling whine (a tone and a swept band of noise,
//            starting at 1.4-2.2 kHz and dropping to under half as the bullet leaves, a tumbling wobble), dark
//   flesh    a hit on a gunman: a punchy, meaty THUMP (a broad pulse into damped body modes ~100 / ~250 Hz) and the slap of
//            cloth and skin (a short band-passed burst); not gory: nothing wet, nothing that cracks
//   crit     the same, heavier: a lower punch, the body's second jolt a few ms on, a dull knock
//   confirm  the player's hit-confirm: a soft, low, short "thock" (two heavily damped modes ~400 / ~650 Hz, a slow
//            contact): it says you hit, at any range, without being a UI beep
//   pierce   a bullet through a gunman: a wet, tearing WHUMP: a low swell, a torn band of noise (fast rough grain), a short
//            vowel-like sweep down: short and dark
// The user's taste (RECIPE_GUIDE): no hollow or ringing impacts (every mode dies in a few periods), nothing bright, highs only
// as sparse grains, no hiss; every decay sized to -80 dB, every case through dsp.warm (-10 dB above 5 kHz).
import {add, filter, halfSine, modal, burst, pink, white, saturate, scale, peak, warm, sweep} from '../dsp.js';

const PI = Math.PI;
const norm = (b, g = 1) => { const p = peak(b); return p > 0 ? scale(b, g / p) : b; };
const TAIL = 9.2;   // time constants to -80 dB
// attack a, 1/e decay d (s), by running products
const ad = (b, sr, a, d) => {
  const ka = Math.exp(-1 / (a * sr)), kd = Math.exp(-1 / (d * sr)); let ea = 1, ed = 1;
  for (let i = 0; i < b.length; i++) { b[i] *= (1 - ea) * ed; ea *= ka; ed *= kd; }
  return b;
};
// a smoothed random wobble round 0 (peak 1)
function rough(n, sr, R, fc) {
  const b = white(n, R), k = 1 - Math.exp(-2 * PI * fc / sr); let y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) { y1 += (b[i] - y1) * k; y2 += (y1 - y2) * k; b[i] = y2; }
  return norm(b, 1);
}
// a contact into modes ([[f, t60, a], ...]), added at `at` s with peak `amp`
function strike(out, sr, R, at, tc, modes, amp) {
  const i0 = Math.round(at * sr); if (i0 >= out.length) return;
  let T = 0; for (const m of modes) T = Math.max(T, m[1]);
  const n = Math.min(out.length - i0, Math.round((T * 1.6 + .02) * sr));
  add(out, norm(modal(halfSine(tc * R.jit(.2), sr), modes.map(([f, t60, a]) => ({f, t60, a})), sr, n), amp), i0);
}
// a noise burst: colour, attack a, 1/e decay d, then band-pass (f, q) and / or low-pass, added at `at` s with peak `amp`
function puff(out, sr, R, at, {a = .0005, d = .01, color = 'pink', bp = 0, q = .8, lp = 0, hp = 0, amp = 1} = {}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round((d * TAIL + a * 3) * sr)); if (n <= 0) return;
  const b = ad(color === 'white' ? white(n, R) : pink(n, R), sr, a, d);
  if (bp) filter(b, 'bandpass', bp, q, sr);
  if (lp) { filter(b, 'lowpass', lp, .7, sr); filter(b, 'lowpass', lp * 1.4, .7, sr); }
  if (hp) filter(b, 'highpass', hp, .7, sr);
  add(out, norm(b, amp), i0);
}
// sparse grains (sand, chips, splinters): k tiny band-passed ticks over [t0, t1] s, fading, peak amp
function grains(out, sr, R, t0, t1, k, {f = [1200, 2400], amp = .1, d = [.0006, .0012]} = {}) {
  for (let i = 0; i < k; i++) {
    const u = R(), at = t0 + (t1 - t0) * u * u;   // more of them early
    const fb = R.range(f[0], f[1]);
    puff(out, sr, R, at, {a: .00008, d: R.range(d[0], d[1]), color: 'white', bp: fb, q: 1.3, lp: fb * 1.5, amp: amp * (1 - .6 * u) * R.range(.5, 1)});
  }
}

function flesh(out, sr, R, heavy) {
  const fB = (heavy ? R.range(76, 98) : R.range(96, 128)), tB = heavy ? R.range(.06, .075) : R.range(.045, .055);
  strike(out, sr, R, 0, heavy ? .0045 : .0035, [[fB, tB, 1], [fB * R.range(2.2, 2.6), tB * .55, .55], [fB * R.range(3.6, 4.2), tB * .35, .25]], 1);   // the punch
  puff(out, sr, R, .0005, {a: .0003, d: R.range(.006, .009), bp: R.range(700, 1050), q: .8, lp: 2000, amp: heavy ? .5 : .62});   // cloth and skin
  puff(out, sr, R, .001, {a: .001, d: R.range(.012, .018), lp: R.range(420, 600), hp: 90, amp: .5});                         // the muffled mass
  if (heavy) {
    strike(out, sr, R, R.range(.008, .014), .004, [[fB * R.range(1.15, 1.3), tB * .8, 1], [fB * R.range(2.4, 2.8), tB * .4, .4]], .6);   // the body's second jolt
    strike(out, sr, R, R.range(.002, .005), .0012, [[R.range(380, 480), .02, 1], [R.range(700, 850), .012, .5]], .45);         // a dull knock
  }
}

const DUR = {sand: .55, stone: .45, wood: .3, metal: .35, ricochet: .6, flesh: .25, crit: .32, confirm: .12, pierce: .42};

// ======================================================================================================================
// v2: THE WESTERN-MOVIE FLAVORS (with recipes/revolver.js v3 and coachgun.js v2: the user wanted the guns "more 'western
// movie'"); the v1 cases above stay as they were. Movie bullet hits are stylised: louder, cleaner, each material told at
// once:
//   sand     the squib's PUFF of dirt: a snap as the ground opens, a thud, the dirt thrown up (a soft swell) and the spray
//            falling back (grains, brighter than v1, still sparse); hollywood adds the stock "tsip" of the bullet arriving
//   stone    a hard CHIP (a sharp crack + short stone modes over a damped mass), chips and dust; spaghetti and hollywood
//            add the ZING off the rock (a short falling whine: the ricochet's cousin)
//   wood     a solid THOCK (damped low-mid modes, no ring) with a bright tock on top and the splinters crackling
//   metal    spaghetti / hollywood: the movie PTANG (a thick plate's inharmonic partials with a short ring, under ~4 kHz);
//            gritty: a dull, heavy TUNK
//   ricochet the iconic falling whine. Physics: a tumbling bullet whistles a chord (the measured peaks 324 / 633 / 910 Hz:
//            .51 / 1 / 1.44) whose pitch falls EXPONENTIALLY (drag on the tumble, the Doppler of leaving) while its level
//            decays; films stretch and sweeten it:
//              spaghetti  the long, bright "pyeeeooww" (3.5 kHz falling to ~0.85 kHz over ~1 s) with canyon echoes
//              hollywood  the stock ricochet: a purer tone with the classic warble (2.9 -> 1.05 kHz, ~0.8 s), a chamber slap
//              gritty     short and turbulent: a lower, noisier whirr (1.8 -> 0.5 kHz, ~0.5 s), no echo
//   flesh    the dry Foley body hit: a punch (a broad pulse into damped body modes ~90-130 Hz), the SLAP of leather and
//            cloth (a short band of noise ~1-2.5 kHz: it reads), the muffled mass; gritty meatier with a crunch of cloth
//   crit     heavier: a lower punch, the body's second jolt, a dull knock
//   pierce   through: the punch, the THWIP of the bullet tearing through (a fast band of noise sweeping up then down), the
//            exit spray (a short cluster of dark grains), the whump
const STYLES = ['spaghetti', 'hollywood', 'gritty'];
const W_ACTS = ['sand', 'stone', 'wood', 'metal', 'ricochet', 'flesh', 'crit', 'pierce'];
// a tumbling bullet's whine at `at` s: the chord (partials r1, 1, r2 of the main tone, the 2nd harmonic h2) falling
// exponentially from f0 to f1 Hz (time constant tau s), warbling at the tumble rate wF (which slows with the pitch: FM depth
// wD, AM depth am), a band of torn air on it (air), attack atk / decay dec s, T s long (a raised-cosine end); peak amp
function whine(out, sr, R, at, {f0, f1, tau, T, atk = .012, dec, wF, wD, am = .3, air = .4, chord = [.35, .25], h2 = .1, q = 5, amp = 1}) {
  const i0 = Math.round(at * sr), n = Math.min(out.length - i0, Math.round(T * sr)); if (n <= 0) return;
  const F0 = f0 * R.jit(.08), F1 = f1 * R.jit(.1), TAU = tau * R.jit(.15), WF = wF * R.jit(.2), r1 = R.range(.49, .53), r2 = R.range(1.4, 1.48);
  const kt = Math.exp(-1 / (TAU * sr)), ka = Math.exp(-1 / (atk * sr)), kd = Math.exp(-1 / (dec * R.jit(.12) * sr)), nf = Math.round(Math.min(.25, T * .3) * sr);
  const tone = new Float32Array(n), fs = new Float32Array(n);
  let ex = 1, ea = 1, ed = 1, p0 = R() * 6.28, p1 = R() * 6.28, p2 = R() * 6.28, pw = R() * 6.28;
  for (let i = 0; i < n; i++) {
    const fb = F1 + (F0 - F1) * ex, wr = WF * fb / F0;   // the tumble slows with the spin
    pw += 2 * PI * wr / sr; const f = fb * (1 + wD * Math.sin(pw)); fs[i] = f;
    p0 += 2 * PI * f / sr; p1 += 2 * PI * f * r1 / sr; p2 += 2 * PI * f * r2 / sr;
    const env = (1 - ea) * ed * (1 + am * Math.sin(pw + 1.3)) * (i > n - nf ? .5 + .5 * Math.cos(PI * (i - n + nf) / nf) : 1);
    tone[i] = env * (Math.sin(p0) + h2 * Math.sin(2 * p0 + .5) + chord[0] * Math.sin(p1) + chord[1] * Math.sin(p2));
    ex *= kt; ea *= ka; ed *= kd;
  }
  add(out, norm(tone, amp * (1 - air * .5)), i0);
  if (air > 0) {   // the air torn behind it: white noise in a band that follows the tone
    const zz = sweep(white(n, R), 'bandpass', t => fs[Math.min(n - 1, Math.round(t * sr))], q, sr);
    ea = 1; ed = 1; for (let i = 0; i < n; i++) { zz[i] *= (1 - ea) * ed * (i > n - nf ? .5 + .5 * Math.cos(PI * (i - n + nf) / nf) : 1); ea *= ka; ed *= kd; }
    add(out, norm(zz, amp * air), i0);
  }
}
// a delayed, darker copy of out[0..len) added at +t s (an echo off a wall: its second half faded out), level g
function slap(out, sr, len, t, g, lp) {
  const d = Math.round(t * sr), n = Math.min(len, out.length - d); if (n <= 0) return;
  const e = out.slice(0, n); for (let i = n >> 1; i < n; i++) e[i] *= .5 + .5 * Math.cos(PI * (i - (n >> 1)) / (n - (n >> 1)));
  filter(filter(e, 'lowpass', lp, .7, sr), 'highpass', 200, .7, sr);
  add(out, e, d, g);
}
// the stock "tsip": a rising band of noise into the hit, ending at `end` s
function zip(out, sr, R, end, amp) {
  const n = Math.round(R.range(.018, .028) * sr), i0 = Math.round(end * sr) - n; if (i0 < 0) return;
  const f0 = R.range(900, 1300), f1 = R.range(2400, 3200), b = sweep(white(n, R), 'bandpass', t => f0 + (f1 - f0) * t * sr / n, 3, sr);
  for (let i = 0; i < n; i++) b[i] *= Math.pow(i / n, 2.2);
  add(out, norm(b, amp), i0);
}
// the flavors (levels relative; the forge normalises each case)
const WB = {
  spaghetti: {sand: {snap: .5, snapF: 2200, thud: .9, thudF: [110, 150], puff: .45, spray: .16, sprayN: [10, 16], sprayF: [1400, 3600], sprayT: [.14, .22], zip: 0, echo: [.12, .22, 1800]},
    stone: {chipF: [1600, 2300], crackle: .6, zing: {f0: 3200, f1: 1500, tau: .07, T: .2, atk: .004, dec: .09, wF: 34, wD: .03, am: .25, air: .3, amp: .38}, dust: .25, chips: [3, 6], echo: [.12, .2, 2000]},
    wood: {f: [190, 250], tock: .45, splinter: .2, knock: 0},
    metal: {f: [850, 1100], ring: .2, thud: .3, spark: .14},
    ricochet: {hit: .55, whine: {f0: 3500, f1: 850, tau: .32, T: 1.05, atk: .012, dec: .5, wF: 30, wD: .025, am: .35, air: .32, chord: [.32, .22], h2: .1, q: 5, amp: 1}, echoes: [[.24, .3, 2400], [.52, .14, 1600]], lp: 6000},
    flesh: {fB: [92, 120], tB: .055, tc: .0032, slap: 1, slapF: [1100, 1700], slapD: .009, smack: .8, smackF: [420, 520], mass: .45, crunch: 0},
    pierce: {thwip: .55, spray: .2}},
  hollywood: {sand: {snap: .4, snapF: 2000, thud: .85, thudF: [120, 160], puff: .4, spray: .13, sprayN: [8, 13], sprayF: [1300, 3200], sprayT: [.1, .16], zip: .35},
    stone: {chipF: [1500, 2100], crackle: .55, zing: {f0: 2900, f1: 1500, tau: .06, T: .17, atk: .004, dec: .08, wF: 26, wD: .045, am: .2, air: .2, amp: .38}, dust: .22, chips: [2, 5]},
    wood: {f: [200, 260], tock: .5, splinter: .17, knock: 0},
    metal: {f: [800, 1050], ring: .15, thud: .32, spark: .12},
    ricochet: {hit: .5, whine: {f0: 2900, f1: 1050, tau: .28, T: .8, atk: .01, dec: .38, wF: 26, wD: .045, am: .25, air: .2, chord: [.2, .15], h2: .14, q: 6, amp: 1}, echoes: [[.17, .2, 2600]], lp: 7000},
    flesh: {fB: [100, 128], tB: .05, tc: .003, slap: 1.1, slapF: [1300, 2100], slapD: .008, smack: .75, smackF: [460, 580], mass: .4, crunch: 0},
    pierce: {thwip: .6, spray: .18}},
  gritty: {sand: {snap: .3, snapF: 1700, thud: 1, thudF: [95, 130], puff: .5, spray: .12, sprayN: [12, 20], sprayF: [1000, 2600], sprayT: [.18, .28], zip: 0},
    stone: {chipF: [1300, 1900], crackle: .45, zing: null, dust: .32, chips: [4, 8], knock: .5},
    wood: {f: [160, 220], tock: .3, splinter: .26, knock: .5},
    metal: {f: [520, 720], ring: .06, thud: .45, spark: .1},
    ricochet: {hit: .45, whine: {f0: 1800, f1: 520, tau: .14, T: .5, atk: .008, dec: .2, wF: 40, wD: .03, am: .5, air: .7, chord: [.45, .35], h2: .05, q: 3.5, amp: 1}, echoes: [], lp: 4200},
    flesh: {fB: [82, 108], tB: .065, tc: .004, slap: .8, slapF: [850, 1300], slapD: .009, smack: .9, smackF: [360, 450], mass: .6, crunch: .3},
    pierce: {thwip: .45, spray: .26}},
};
const WDUR = {sand: .7, stone: .6, wood: .3, metal: .5, ricochet: 1.9, flesh: .25, crit: .32, pierce: .42};
const WOUT = {spaghetti: {shelf: -3, lp: 0}, hollywood: {shelf: -4, lp: 7500}, gritty: {shelf: -6, lp: 0}};
function westHit(out, sr, R, a, style) {
  const S = WB[style];
  if (a === 'sand') {
    const P = S.sand, t = P.zip ? R.range(.02, .028) : 0;
    if (P.zip) zip(out, sr, R, t, P.zip);
    puff(out, sr, R, t, {a: .00005, d: R.range(.002, .0035), color: 'white', bp: P.snapF * R.jit(.15), q: .9, lp: P.snapF * 2, amp: P.snap});   // the ground opens
    strike(out, sr, R, t, R.range(.0018, .0026), [[R.range(P.thudF[0], P.thudF[1]), .045, 1], [R.range(260, 340), .022, .45]], P.thud);           // the thud
    puff(out, sr, R, t, {a: .0004, d: R.range(.01, .014), lp: R.range(650, 850), hp: 80, amp: .7});
    puff(out, sr, R, t + .002, {a: R.range(.003, .006), d: R.range(.035, .05), bp: R.range(500, 800), q: .6, lp: 2400, amp: P.puff});          // the dirt thrown up
    grains(out, sr, R, t + .01, t + R.range(P.sprayT[0], P.sprayT[1]), R.int(P.sprayN[0], P.sprayN[1]), {f: P.sprayF, amp: P.spray, d: [.0005, .0011]});   // falling back
    if (P.echo) slap(out, sr, Math.round(.1 * sr), R.range(P.echo[0], P.echo[1]), .22, P.echo[2]);
  } else if (a === 'stone') {
    const P = S.stone, f = R.range(P.chipF[0], P.chipF[1]);
    strike(out, sr, R, 0, R.range(.00013, .0002), [[f, .008, 1], [f * R.range(1.6, 1.8), .005, .6], [f * R.range(2.5, 2.8), .0035, .35], [R.range(380, 520), .02, .7]], 1);   // the chip
    puff(out, sr, R, 0, {a: .00004, d: R.range(.0025, .004), color: 'white', bp: R.range(2300, 3200), q: .8, lp: 6000, amp: P.crackle});
    if (P.knock) strike(out, sr, R, 0, .0012, [[R.range(160, 220), .03, 1], [R.range(330, 420), .018, .5]], P.knock);   // gritty: the rock's mass
    if (P.zing) whine(out, sr, R, R.range(.003, .008), P.zing);                                                         // off the rock
    puff(out, sr, R, .003, {a: .003, d: R.range(.02, .03), lp: R.range(800, 1100), hp: 120, amp: P.dust});             // a breath of dust
    grains(out, sr, R, .03, R.range(.16, .26), R.int(P.chips[0], P.chips[1]), {f: [1200, 2600], amp: .2, d: [.0006, .0014]});   // chips falling back
    if (P.echo) slap(out, sr, Math.round(.08 * sr), R.range(P.echo[0], P.echo[1]), .2, P.echo[2]);
  } else if (a === 'wood') {
    const P = S.wood, f = R.range(P.f[0], P.f[1]);
    strike(out, sr, R, 0, R.range(.0007, .001), [[f, .038, 1], [f * R.range(1.55, 1.75), .026, .6], [f * R.range(2.4, 2.8), .016, .35], [f * R.range(3.6, 4), .01, .2]], 1);   // the thock
    puff(out, sr, R, 0, {a: .0001, d: R.range(.0025, .0035), color: 'white', bp: R.range(1500, 2200), q: 1, lp: 4000, amp: P.tock});           // the tock
    if (P.knock) strike(out, sr, R, 0, .0016, [[R.range(110, 140), .045, 1]], P.knock);                                                          // gritty: the post's mass
    grains(out, sr, R, .002, R.range(.03, .05), R.int(5, 9), {f: [900, 2600], amp: P.splinter, d: [.0005, .001]});                              // the splinters
  } else if (a === 'metal') {
    const P = S.metal, f = R.range(P.f[0], P.f[1]), T = P.ring * R.jit(.15);
    strike(out, sr, R, 0, R.range(.0002, .0003), [[f, T, 1], [f * R.range(1.45, 1.55), T * .8, .8], [f * R.range(2.05, 2.2), T * .6, .6],
      [f * R.range(2.8, 3.1), T * .45, .4], [f * R.range(3.5, 3.9), T * .3, .25]], 1);                                                           // the plate
    puff(out, sr, R, 0, {a: .0004, d: R.range(.008, .012), lp: R.range(500, 700), hp: 90, amp: P.thud});                                       // the thud under it
    strike(out, sr, R, R.range(.001, .004), .00012, [[R.range(2600, 3200), .003, 1]], P.spark);                                                // a spark tick
  } else if (a === 'ricochet') {
    const P = S.ricochet, n = Math.round(1.25 * sr), b = new Float32Array(n);
    puff(b, sr, R, 0, {a: .00004, d: R.range(.002, .003), color: 'white', bp: R.range(2400, 3400), q: .8, lp: 6500, amp: P.hit});               // the strike off the rock
    strike(b, sr, R, 0, .00015, [[R.range(1500, 2100), .006, 1], [R.range(400, 520), .014, .6]], P.hit * .8);
    whine(b, sr, R, R.range(.004, .012), P.whine);
    add(out, b);
    for (const [t, g, lp] of P.echoes) { const e = filter(filter(b.slice(), 'lowpass', lp, .7, sr), 'highpass', 300, .7, sr); add(out, e, Math.round(t * R.jit(.1) * sr), g * R.jit(.15)); }
    filter(out, 'lowpass', P.lp, .7, sr);
  } else if (a === 'flesh' || a === 'crit') {
    const P = S.flesh, heavy = a === 'crit', fB = R.range(P.fB[0], P.fB[1]) * (heavy ? .82 : 1), tB = P.tB * R.jit(.12) * (heavy ? 1.25 : 1);
    strike(out, sr, R, 0, P.tc * (heavy ? 1.25 : 1), [[fB, tB, 1], [fB * R.range(2.2, 2.6), tB * .55, .55], [fB * R.range(3.6, 4.2), tB * .35, .25]], 1);   // the punch
    puff(out, sr, R, .0004, {a: .00015, d: P.slapD * R.jit(.2), color: 'white', bp: R.range(P.slapF[0], P.slapF[1]), q: .8, lp: 4500, amp: P.slap});   // the slap
    const fs = R.range(P.smackF[0], P.smackF[1]) * (heavy ? .85 : 1);
    strike(out, sr, R, .0006, .0011, [[fs, .026, 1], [fs * R.range(1.6, 1.8), .016, .5], [fs * R.range(2.5, 2.8), .01, .25]], P.smack * (heavy ? 1.2 : 1));   // the smack: the meat's thock (it reads)
    puff(out, sr, R, .001, {a: .0008, d: R.range(.012, .018), lp: R.range(500, 700), hp: 80, amp: P.mass});                                     // the mass
    if (P.crunch) grains(out, sr, R, .002, .03, R.int(3, 5), {f: [700, 1600], amp: P.crunch, d: [.0006, .0012]});                              // cloth and meat
    if (heavy) {
      strike(out, sr, R, R.range(.008, .014), .004, [[fB * R.range(1.15, 1.3), tB * .8, 1], [fB * R.range(2.4, 2.8), tB * .4, .4]], .6);       // the body's second jolt
      strike(out, sr, R, R.range(.002, .005), .0012, [[R.range(380, 480), .02, 1], [R.range(700, 850), .012, .5]], .45);                       // a dull knock
    }
  } else {   // pierce
    const P = S.pierce, F = S.flesh, fB = R.range(F.fB[0], F.fB[1]) * .9;
    strike(out, sr, R, 0, .004, [[fB, .06, 1], [fB * R.range(2.1, 2.5), .035, .45]], .9);                                                       // the punch
    puff(out, sr, R, .0004, {a: .00015, d: F.slapD, color: 'white', bp: R.range(F.slapF[0], F.slapF[1]), q: .8, lp: 4500, amp: F.slap * .75});
    const fs = R.range(F.smackF[0], F.smackF[1]);
    strike(out, sr, R, .0006, .0011, [[fs, .026, 1], [fs * R.range(1.6, 1.8), .016, .5]], F.smack * .8);
    const n = Math.round(R.range(.045, .06) * sr), i0 = Math.round(R.range(.004, .008) * sr), fa = R.range(700, 900), fp = R.range(2000, 2600), fe = R.range(600, 800);
    const th = sweep(pink(n, R), 'bandpass', t => { const u = t * sr / n; return u < .35 ? fa + (fp - fa) * u / .35 : fp + (fe - fp) * (u - .35) / .65; }, 2.5, sr);
    for (let i = 0; i < n; i++) th[i] *= Math.sin(PI * i / n) ** 1.6;
    add(out, norm(th, P.thwip), i0);                                                                                                            // the thwip through
    grains(out, sr, R, .02, R.range(.06, .09), R.int(4, 7), {f: [600, 1500], amp: P.spray, d: [.0008, .0016]});                                // the exit spray
    puff(out, sr, R, .002, {a: .005, d: R.range(.03, .04), lp: R.range(240, 320), amp: .6});                                                   // the whump
  }
}

export default {
  id: 'bullet', version: 2,
  desc: 'Bullets where they end: into sand, stone, wood, metal, a ricochet\'s whine, a gunman (flesh, crit, through), the hit-confirm; v2: the western-movie flavors (spaghetti / hollywood / gritty)',
  params: {act: {values: Object.keys(DUR), def: 'sand'}, style: {values: ['v1', ...STYLES], def: 'v1'}},
  cases: {...Object.fromEntries(Object.keys(DUR).map(k => [k, {act: k}])), ...Object.fromEntries(STYLES.flatMap(s => W_ACTS.map(a => [`${s}_${a}`, {act: a, style: s}])))},
  variants: 6,
  render(p, R, sr) {
    const a = p.act;
    if (p.style !== 'v1' && WB[p.style] && W_ACTS.includes(a)) {
      const out = new Float32Array(Math.round(WDUR[a] * sr)), O = WOUT[p.style];
      westHit(out, sr, R, a, p.style);
      filter(out, 'highpass', 35, .7, sr);
      if (O.lp) { filter(out, 'lowpass', O.lp, .5412, sr); filter(out, 'lowpass', O.lp, 1.3066, sr); }
      warm(out, sr, {shelf: O.shelf, fs: 5500});
      return saturate(out, a === 'crit' ? 1.8 : a === 'flesh' || a === 'pierce' ? 1.6 : a === 'ricochet' ? 1.1 : 1.3);
    }
    const out = new Float32Array(Math.round(DUR[a] * sr));
    if (a === 'sand') {
      strike(out, sr, R, 0, R.range(.0022, .003), [[R.range(110, 160), .04, 1], [R.range(260, 340), .022, .45]], .9);   // the thud
      puff(out, sr, R, 0, {a: .0004, d: R.range(.01, .014), lp: R.range(520, 700), hp: 80, amp: .8});
      puff(out, sr, R, .002, {a: .004, d: R.range(.03, .045), bp: R.range(350, 550), q: .7, lp: 1100, amp: .3});        // the puff of dirt
      grains(out, sr, R, .012, R.range(.12, .18), R.int(9, 15), {f: [1100, 2300], amp: .11});                            // the spray falling back
    } else if (a === 'stone') {
      const f = R.range(1100, 1550);
      strike(out, sr, R, 0, R.range(.0002, .0003), [[f, .006, 1], [f * R.range(1.6, 1.8), .004, .6], [f * R.range(2.5, 2.8), .003, .3], [R.range(380, 520), .016, .7]], 1);   // the chip
      puff(out, sr, R, 0, {a: .0001, d: R.range(.002, .003), bp: R.range(1300, 1800), q: .9, lp: 2500, amp: .5});
      puff(out, sr, R, .003, {a: .003, d: R.range(.02, .03), lp: R.range(700, 900), hp: 120, amp: .22});                 // a breath of dust
      grains(out, sr, R, .04, R.range(.16, .24), R.int(2, 5), {f: [1000, 1800], amp: .2, d: [.0008, .0016]});           // chips falling back
    } else if (a === 'wood') {
      const f = R.range(180, 250);
      strike(out, sr, R, 0, R.range(.0009, .0012), [[f, .035, 1], [f * R.range(1.55, 1.75), .024, .6], [f * R.range(2.4, 2.8), .016, .35], [f * R.range(3.6, 4), .01, .2]], 1);   // the thunk
      puff(out, sr, R, 0, {a: .0002, d: R.range(.004, .006), bp: R.range(800, 1150), q: .8, lp: 1900, amp: .35});
      grains(out, sr, R, .002, R.range(.025, .04), R.int(3, 6), {f: [700, 1400], amp: .16});                              // the splinter
    } else if (a === 'metal') {
      const f = R.range(580, 800);
      strike(out, sr, R, 0, R.range(.00025, .00035), [[f, R.range(.035, .045), 1], [f * R.range(1.45, 1.55), .03, .85], [f * R.range(2.05, 2.2), .02, .7],
        [f * R.range(2.8, 3.1), .014, .5], [f * R.range(3.5, 3.9), .009, .32]], 1);                                       // the clank: a thick plate, damped
      puff(out, sr, R, 0, {a: .0004, d: R.range(.008, .012), lp: R.range(500, 700), hp: 90, amp: .22});                   // the dull thud under it
      if (R() < .6) strike(out, sr, R, R.range(.001, .004), .00012, [[R.range(2400, 2900), .0025, 1]], R.range(.1, .16)); // at most a spark tick
    } else if (a === 'ricochet') {
      const f0 = R.range(1400, 2200), f1 = f0 * R.range(.36, .48), T = R.range(.28, .4), wF = R.range(24, 44), wD = R.range(.02, .045);
      const n = Math.min(out.length, Math.round((T + .12) * sr)), fAt = t => (f0 + (f1 - f0) * Math.min(1, t / T)) * (1 + wD * Math.sin(2 * PI * wF * t));
      const tone = new Float32Array(n); let ph = 0;
      const atk = R.range(.012, .025), dec = T * R.range(.35, .5);
      for (let i = 0; i < n; i++) {
        const t = i / sr; ph += 2 * PI * fAt(t) / sr;
        tone[i] = Math.sin(ph) * (1 - Math.exp(-t / atk)) * Math.exp(-t / dec) * (1 + .3 * Math.sin(2 * PI * wF * t + 1.3));
      }
      const zz = sweep(white(n, R), 'bandpass', fAt, 5, sr);                                                          // the air torn behind it
      for (let i = 0; i < n; i++) { const t = i / sr; zz[i] *= (1 - Math.exp(-t / atk)) * Math.exp(-t / dec); }
      add(out, norm(tone, .6)); add(out, norm(zz, .5));
      filter(out, 'lowpass', 2800, .7, sr);
    } else if (a === 'flesh' || a === 'crit') flesh(out, sr, R, a === 'crit');
    else if (a === 'confirm') {
      const f = R.range(370, 440);
      strike(out, sr, R, 0, R.range(.0016, .0022), [[f, .022, 1], [f * R.range(1.55, 1.7), .013, .45], [f * R.range(2.3, 2.6), .008, .18]], 1);
      filter(out, 'highpass', 180, .7, sr); filter(out, 'highpass', 180, .7, sr);   // a small thock: no low end of its own
    } else {   // pierce
      strike(out, sr, R, 0, .005, [[R.range(80, 105), .06, 1], [R.range(180, 230), .035, .4]], .8);                     // the whump
      puff(out, sr, R, .001, {a: .006, d: R.range(.03, .04), lp: R.range(220, 300), amp: .7});
      const n = Math.round(R.range(.05, .07) * sr), i0 = Math.round(.004 * sr), tear = filter(pink(n, R), 'bandpass', R.range(550, 900), 1.1, sr), g = rough(n, sr, R, R.range(150, 240));
      for (let i = 0; i < n; i++) tear[i] *= Math.sin(PI * i / n) ** 1.5 * Math.max(0, .15 + .85 * g[i]);   // torn: a fast, rough grain
      filter(tear, 'lowpass', 1600, .7, sr); add(out, norm(tear, .45), i0);
      const nv = Math.round(.06 * sr), v0 = R.range(850, 1000), v1 = v0 * R.range(.4, .5);                                 // the wet sweep down
      const vw = sweep(pink(nv, R), 'bandpass', t => v0 + (v1 - v0) * Math.min(1, t / .05), 3, sr);
      for (let i = 0; i < nv; i++) vw[i] *= Math.sin(PI * i / nv) ** 2;
      add(out, norm(vw, .3), Math.round(R.range(.008, .016) * sr));
    }
    filter(out, 'highpass', 35, .7, sr);
    warm(out, sr, {shelf: -10, fs: 5000});    // warm game mix (RECIPE_GUIDE)
    return saturate(out, a === 'crit' ? 1.6 : a === 'flesh' || a === 'pierce' ? 1.35 : 1.1);
  },
  // ranges from seeds 1-24, the lab's 44291-44296 and a few large seeds per case (v1), with a margin; hf4kDb (the energy
  // above 4 kHz against the total) bounds the brightness; every one-shot ends clean
  criteria: {
    sand: {attackMs: [0, 10], t60Ms: [120, 360], centroidHz: [220, 560], highHz: [500, 1300], flatness: [0, .01], hf4kDb: [-60, -32], durMs: [220, 460], clickEnd: [0, .01]},
    stone: {attackMs: [0, 6], t60Ms: [120, 700], centroidHz: [320, 880], highHz: [750, 2400], flatness: [0, .01], hf4kDb: [-66, -28], durMs: [160, 330], onsetCount: [0, 3], clickEnd: [0, .01]},
    wood: {attackMs: [0, 6], t60Ms: [25, 100], centroidHz: [230, 650], highHz: [650, 2100], flatness: [0, .01], hf4kDb: [-66, -36], durMs: [55, 90], clickEnd: [0, .01]},
    metal: {attackMs: [0, 6], t60Ms: [35, 110], centroidHz: [240, 660], highHz: [550, 1300], flatness: [0, .01], hf4kDb: [-95, -45], durMs: [70, 150], clickEnd: [0, .01]},
    ricochet: {attackMs: [8, 90], t60Ms: [600, 1100], centroidHz: [1000, 2000], lowHz: [650, 1500], highHz: [1250, 2300], flatness: [0, .01], hf4kDb: [-42, -28], durMs: [380, 600], clickEnd: [0, .01]},
    flesh: {attackMs: [0, 15], t60Ms: [45, 160], centroidHz: [130, 330], highHz: [280, 1350], flatness: [0, .01], hf4kDb: [-75, -46], durMs: [115, 210], clickEnd: [0, .01]},
    crit: {attackMs: [0, 18], t60Ms: [40, 140], centroidHz: [90, 230], highHz: [120, 700], flatness: [0, .01], hf4kDb: [-80, -52], durMs: [120, 210], clickEnd: [0, .01]},
    confirm: {attackMs: [0, 5], t60Ms: [15, 28], centroidHz: [300, 460], highHz: [380, 540], flatness: [0, .01], hf4kDb: [-100, -80], durMs: [45, 60], clickEnd: [0, .01]},
    pierce: {attackMs: [2, 50], t60Ms: [130, 320], centroidHz: [170, 500], highHz: [550, 1450], flatness: [0, .01], hf4kDb: [-48, -32], durMs: [270, 420], clickEnd: [0, .01]},
    // the western-movie flavors (v3 / v2): ranges from 37 seeds (1-24, the lab's 44291-44296, seven large ones) with a margin
    // (t60 x.75..1.25, centroid / highHz x.85..1.15, hf4kDb -4..+3 dB, durMs x.9..1.1); the shots' t60 includes the echoes
    spaghetti_sand: {attackMs: [0, 20], t60Ms: [330, 900], centroidHz: [400, 900], lowHz: [45, 190], highHz: [1150, 2200], flatness: [0, .005], hf4kDb: [-38, -21], durMs: [300, 530], onsetCount: [1, 2], clickEnd: [0, .01]},
    spaghetti_stone: {attackMs: [0, 10], t60Ms: [250, 700], centroidHz: [1550, 2800], lowHz: [130, 750], highHz: [2300, 3900], flatness: [0, .019], hf4kDb: [-26, -12], durMs: [210, 330], onsetCount: [0, 2], clickEnd: [0, .01]},
    spaghetti_wood: {attackMs: [0, 10], t60Ms: [30, 150], centroidHz: [320, 1200], lowHz: [30, 220], highHz: [1300, 3500], flatness: [0, .005], hf4kDb: [-41, -17], durMs: [60, 90], onsetCount: [0, 1], clickEnd: [0, .01]},
    spaghetti_metal: {attackMs: [0, 10], t60Ms: [120, 280], centroidHz: [800, 1500], lowHz: [130, 1450], highHz: [1150, 2700], flatness: [0, .005], hf4kDb: [-49, -30], durMs: [210, 350], onsetCount: [0, 1], clickEnd: [0, .01]},
    spaghetti_ricochet: {attackMs: [15, 115], t60Ms: [1450, 2800], centroidHz: [1650, 2800], lowHz: [670, 1600], highHz: [2500, 4100], flatness: [0, .006], hf4kDb: [-25, -14], durMs: [1380, 1800], onsetCount: [0, 2], clickEnd: [0, .01]},
    spaghetti_flesh: {attackMs: [0, 20], t60Ms: [40, 140], centroidHz: [190, 850], lowHz: [15, 125], highHz: [700, 3600], flatness: [0, .005], hf4kDb: [-33, -16], durMs: [120, 210], onsetCount: [0, 1], clickEnd: [0, .01]},
    spaghetti_crit: {attackMs: [0, 20], t60Ms: [45, 150], centroidHz: [110, 750], lowHz: [15, 95], highHz: [210, 3400], flatness: [0, .005], hf4kDb: [-39, -16], durMs: [110, 210], onsetCount: [0, 1], clickEnd: [0, .01]},
    spaghetti_pierce: {attackMs: [0, 25], t60Ms: [100, 350], centroidHz: [500, 1600], lowHz: [15, 95], highHz: [1800, 3900], flatness: [0, .037], hf4kDb: [-27, -13], durMs: [260, 450], onsetCount: [0, 1], clickEnd: [0, .01]},
    hollywood_sand: {attackMs: [0, 35], t60Ms: [160, 440], centroidHz: [230, 900], lowHz: [30, 160], highHz: [750, 3300], flatness: [0, .005], hf4kDb: [-38, -15], durMs: [320, 560], onsetCount: [1, 2], clickEnd: [0, .01]},
    hollywood_stone: {attackMs: [0, 10], t60Ms: [190, 540], centroidHz: [1550, 2500], lowHz: [145, 1250], highHz: [2200, 3500], flatness: [0, .005], hf4kDb: [-29, -14], durMs: [180, 310], onsetCount: [0, 2], clickEnd: [0, .01]},
    hollywood_wood: {attackMs: [0, 10], t60Ms: [25, 150], centroidHz: [290, 1100], lowHz: [15, 280], highHz: [1350, 3500], flatness: [0, .005], hf4kDb: [-39, -17], durMs: [60, 90], onsetCount: [0, 2], clickEnd: [0, .01]},
    hollywood_metal: {attackMs: [0, 10], t60Ms: [90, 210], centroidHz: [700, 1400], lowHz: [65, 1350], highHz: [1100, 2600], flatness: [0, .005], hf4kDb: [-54, -30], durMs: [160, 270], onsetCount: [0, 1], clickEnd: [0, .01]},
    hollywood_ricochet: {attackMs: [0, 80], t60Ms: [900, 1700], centroidHz: [1600, 2700], lowHz: [820, 1900], highHz: [2100, 3600], flatness: [0, .005], hf4kDb: [-28, -17], durMs: [870, 1110], onsetCount: [0, 2], clickEnd: [0, .01]},
    hollywood_flesh: {attackMs: [0, 15], t60Ms: [45, 150], centroidHz: [170, 1300], lowHz: [15, 125], highHz: [410, 3900], flatness: [0, .005], hf4kDb: [-33, -13], durMs: [110, 210], onsetCount: [0, 1], clickEnd: [0, .01]},
    hollywood_crit: {attackMs: [0, 15], t60Ms: [30, 160], centroidHz: [100, 700], lowHz: [30, 95], highHz: [130, 3100], flatness: [0, .005], hf4kDb: [-38, -14], durMs: [110, 210], onsetCount: [0, 1], clickEnd: [0, .01]},
    hollywood_pierce: {attackMs: [0, 25], t60Ms: [90, 310], centroidHz: [500, 1600], lowHz: [15, 125], highHz: [1900, 3700], flatness: [0, .005], hf4kDb: [-27, -14], durMs: [250, 450], onsetCount: [0, 1], clickEnd: [0, .01]},
    gritty_sand: {attackMs: [0, 20], t60Ms: [200, 490], centroidHz: [380, 900], lowHz: [30, 190], highHz: [1050, 2150], flatness: [0, .005], hf4kDb: [-45, -28], durMs: [310, 520], onsetCount: [0, 1], clickEnd: [0, .01]},
    gritty_stone: {attackMs: [0, 10], t60Ms: [140, 800], centroidHz: [330, 950], lowHz: [45, 160], highHz: [950, 3000], flatness: [0, .005], hf4kDb: [-42, -22], durMs: [180, 320], onsetCount: [0, 4], clickEnd: [0, .01]},
    gritty_wood: {attackMs: [0, 10], t60Ms: [25, 160], centroidHz: [240, 800], lowHz: [15, 65], highHz: [1150, 3600], flatness: [0, .005], hf4kDb: [-44, -14], durMs: [70, 100], onsetCount: [0, 2], clickEnd: [0, .01]},
    gritty_metal: {attackMs: [0, 15], t60Ms: [35, 115], centroidHz: [220, 650], lowHz: [30, 220], highHz: [500, 1300], flatness: [0, .005], hf4kDb: [-76, -50], durMs: [80, 150], onsetCount: [0, 1], clickEnd: [0, .01]},
    gritty_ricochet: {attackMs: [0, 75], t60Ms: [550, 1100], centroidHz: [950, 1600], lowHz: [360, 900], highHz: [1550, 2600], flatness: [0, .005], hf4kDb: [-32, -20], durMs: [460, 590], onsetCount: [0, 2], clickEnd: [0, .01]},
    gritty_flesh: {attackMs: [0, 20], t60Ms: [50, 190], centroidHz: [120, 500], lowHz: [15, 125], highHz: [350, 2150], flatness: [0, .005], hf4kDb: [-39, -20], durMs: [110, 210], onsetCount: [0, 1], clickEnd: [0, .01]},
    gritty_crit: {attackMs: [0, 25], t60Ms: [35, 170], centroidHz: [90, 420], lowHz: [15, 95], highHz: [90, 2050], flatness: [0, .005], hf4kDb: [-44, -21], durMs: [120, 210], onsetCount: [0, 1], clickEnd: [0, .01]},
    gritty_pierce: {attackMs: [0, 25], t60Ms: [110, 380], centroidHz: [400, 1300], lowHz: [15, 95], highHz: [1700, 3500], flatness: [0, .017], hf4kDb: [-29, -15], durMs: [260, 450], onsetCount: [0, 2], clickEnd: [0, .01]},
  },
  notes: 'Contacts into damped modes (thuds, chips, thunks, clanks: Q <= ~6, plates <= 45 ms) + band-passed bursts and sparse grains; a swept whine for the ricochet; see the header',
};
