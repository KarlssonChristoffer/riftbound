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

export default {
  id: 'bullet', version: 1,
  desc: 'Bullets where they end: into sand, stone, wood, metal, a ricochet\'s whine, a gunman (flesh, crit, through), the hit-confirm',
  params: {act: {values: Object.keys(DUR), def: 'sand'}},
  cases: Object.fromEntries(Object.keys(DUR).map(k => [k, {act: k}])),
  variants: 6,
  render(p, R, sr) {
    const a = p.act, out = new Float32Array(Math.round(DUR[a] * sr));
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
  },
  notes: 'Contacts into damped modes (thuds, chips, thunks, clanks: Q <= ~6, plates <= 45 ms) + band-passed bursts and sparse grains; a swept whine for the ricochet; see the header',
};
