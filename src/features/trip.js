// TRIP (docs/BUILDING.md): the fly agaric broth (content/meals.js fly_broth, cooked like a meal: features/meals.js start()s it).
// For its time (TUNE.dur s, ?trip= s) the world's colours drift through the hues and back (a grade over the mood: sim/env.js
// setGrade, eased in and out), the view sways slowly as if the world breathed (a camera offset), he sways on his feet
// (view/livehero.js reads F.k) and the watcher comes out and openly stares (features/watcher.js stare()). In the next slice the
// cave's hidden things show to him while it lasts (F.on). PRIVATE: only the one who drank it sees any of it; friends see him sway
// (the live body's bones they are sent). Nothing in the sim reads it but its own clock.
// THE STILL (the burnt broth: start(s, {still: true}), content/meals.js TUNE.still): the trip turned around. The world holds its
// breath: the colours drain toward grey (an even dimming and a grey veil instead of the hues), no sway, no Watcher; every animal
// within 40 m stops and stares at him (features/fauna.js reads F.still).
// OWNS: the trip's time left (sim), its strength k and phase (view), the grade 'trip', the camera offset.
// READS: host.env (setGrade, clearGrade), the watcher (stare). EMITS: trip.start, trip.end.
// API: F.start(s, o?) (o.still: the still), F.tripping (sim), F.still (the still now: sim), F.k (0..1: how strong it shows now:
//   view), F.left (s).
// BUDGET: sim: a subtraction a step. View: a few sines a frame, the grade's numbers written in place (no allocation).
import {flags} from '../core/flags.js';

const STILL = {gain: .78, sun: .7, veil: [.36, .36, .38], veilA: .3};   // the still's grade: even gains (no hue), a grey veil (rgb, alpha)
const TUNE = {dur: 90, ease: 4, hueHz: .07, amt: .6, sunAmt: .5, haze: .16, hazeA: .12, breathe: [2.5, 3.5], breatheHz: [.17, .11]};   // ease s in / out; amt / sunAmt: how far the
// light's colours go; haze: a coloured veil turning with them (fog rgb added, its alpha); breathe: px of sway, Hz
const DUR = (v => v > 0 ? v : 0)(parseFloat(flags.get('trip')));

export async function create(host) {
  let left = 0, k = 0, ph = 0, graded = false, stared = false, still = false;
  const G = {k: 0, amb: [1, 1, 1], sun: [1, 1, 1], lift: [1, 1, 1], fill: [1, 1, 1], fog: [0, 0, 0, TUNE.hazeA], glow: 1.6, sunK: .9};   // (env reads it live)
  const OFF = {x: 0, y: 0};
  const F = {
    name: 'trip', label: 'The trip', on: true,
    get k() { return k; }, get left() { return left; }, get tripping() { return left > 0; }, get still() { return still && left > 0; },
    start(s, o) {
      const P = host.player, t = DUR || s || TUNE.dur;
      if (!!o?.still !== still) { still = !!o?.still; left = 0; }   // (the other kind: it starts over as this one)
      left = Math.max(left, t);
      host.events.push({type: 'trip.start', x: P.x, y: P.y, t, still});
    },
    update(dt) {
      if (left <= 0) return;
      if ((left -= dt) <= 0) { left = 0; const P = host.player; host.events.push({type: 'trip.end', x: P.x, y: P.y}); }
    },
    view(dt) {
      const want = left > 0 ? 1 : 0;
      if (left > 0 && !stared && !still) { stared = true; host.feature('watcher')?.stare?.(left); } else if (left <= 0) stared = false;   // (the watcher's a view: told from here; not in the still)
      k = want > k ? Math.min(1, k + dt / TUNE.ease) : Math.max(0, k - dt / TUNE.ease);
      const env = host.env;
      if (k <= 0) { if (graded) { env?.clearGrade?.('trip'); graded = false; } ph = 0; return; }
      ph += dt;
      if (still) {   // THE STILL: even, dimmer light and a grey veil; nothing moves
        for (let j = 0; j < 3; j++) { G.amb[j] = G.lift[j] = STILL.gain; G.sun[j] = G.fill[j] = STILL.sun; G.fog[j] = STILL.veil[j]; }
        G.fog[3] = STILL.veilA; G.k = k;
        if (!graded && env?.setGrade) { env.setGrade('trip', G); graded = true; }
        return;
      }
      G.fog[3] = TUNE.hazeA;
      // the colours: three channels' gains turning round the hue circle, out of step (the light shifts green, violet, gold ...)
      const a = ph * TUNE.hueHz * Math.PI * 2, A = TUNE.amt, B = TUNE.sunAmt;
      for (let j = 0; j < 3; j++) {
        const g = 1 + A * Math.sin(a + j * 2.094), h = 1 + B * Math.sin(a * 1.31 + j * 2.094 + 1.2);
        G.amb[j] = g; G.lift[j] = g; G.sun[j] = h; G.fill[j] = h;
        G.fog[j] = TUNE.haze * (.5 + .5 * Math.sin(a * .83 + j * 2.094 + 2.6));   // (the veil a third hue round from the light)
      }
      G.k = k * (.75 + .25 * Math.sin(ph * 1.9));   // (it swells and ebbs)
      if (!graded && env?.setGrade) { env.setGrade('trip', G); graded = true; }
    },
    camera() {   // (render/camera.js: px offsets in the view: the world breathing)
      if (k <= 0 || still) return null;
      OFF.x = Math.sin(ph * TUNE.breatheHz[0] * Math.PI * 2) * TUNE.breathe[0] * k;
      OFF.y = Math.sin(ph * TUNE.breatheHz[1] * Math.PI * 2 + 1) * TUNE.breathe[1] * k;
      return OFF;
    },
    menu: () => host.feature('game')?.mode === 'sandbox' ? [{label: 'Trip: drink the fly agaric broth (test)', run: () => F.start(TUNE.dur)}] : [],
    hud: () => left > 0 || k > 0 ? `trip ${Math.ceil(left)}s k ${k.toFixed(2)}` : '',
    biomeChanged() { graded = false; },
  };
  return F;
}
