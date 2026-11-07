// THE LOOKING-LAKE (features/surprises.js; content/surprises.js LOOKING): swim out into the lake at night and float there, still,
// for LOOKING.still s. A ring of moonlight closes in on you on the water; when it meets you the world turns over into its
// reflection: the whole picture flips left for right (the screen folds to a line and opens the other way) and so do your hands,
// so walking, aiming and the mouse all go the wrong way, for LOOKING.dur s. Float still again to come back sooner. The last
// LOOKING.warn s the chip blinks; then it folds back.
// SIM: the stillness, the time mirrored (it changes what your keys do on screen: the truth of it is the clock here). VIEW: the
// ring, the fold (view/screenwarp.js: CSS on the frame, no pixel work).
// MULTIPLAYER: your own eyes only: the others see you walk the right way round.
import {LOOKING} from '../../content/surprises.js';
import {FOREST} from '../../world/layout.js';
import {TAU, smooth} from '../../core/mathx.js';

export function createLooking(C) {
  const {host} = C;
  let still = 0, left = 0, shown = 1;   // shown: the picture's sx as drawn (1 .. -1, eased through 0)
  const SX = {sx: 1};
  function flip(on) {
    const P = host.player;
    left = on ? LOOKING.dur : 0; still = -2;   // (a breath before the stillness counts again)
    host.events.push({type: 'looking.flip', x: P.x, y: P.y, on});
    if (on) C.toast('Through the looking-lake', 'left is right now', '#c8d8ff');
  }
  return {
    get on() { return left > 0; },
    update(dt) {
      if (!C.active()) { if (left > 0) flip(false); still = 0; return; }
      const P = host.player, inLake = P.state === 'swim' && !!FOREST?.inLake?.(P.x, P.y);
      const ok = inLake && host.env.part === 'night' && Math.hypot(P.vx, P.vy) < LOOKING.speed;
      still = ok ? still + dt : Math.max(Math.min(still, 0), still - dt * 3);
      if (still >= LOOKING.still) flip(left <= 0);
      if (left > 0 && (left -= dt) <= 0) flip(false);
    },
    view(dt) {
      const want = left > 0 ? -1 : 1;
      if (shown !== want) {
        const v = 2 / LOOKING.flip * dt; shown = want < shown ? Math.max(want, shown - v) : Math.min(want, shown + v);
        SX.sx = Math.sign(shown || want) * Math.max(.02, smooth(Math.abs(shown)));
        if (shown === 1) C.warp.clear('looking'); else C.warp.set('looking', SX);
      }
    },
    frame(f) {
      if (still <= .8 || left > 0 && still < LOOKING.still * .5) return;
      const P = host.player, k = Math.min(1, still / LOOKING.still), r = 4.5 * (1 - k) + .5, n = 36, h = P.z + .02;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + f.t * .3;
        if ((i + ((f.t * 6) | 0)) % 3 === 0) continue;
        host.point(P.x + Math.cos(a) * r, P.y + Math.sin(a) * r, h, k > .8 ? '#ffffff' : '#c8d8ff', C.PE);
      }
    },
    chip() { return left > 0 ? {text: `Mirror world ${C.mmss(left)}`, col: '#c8d8ff', blink: left < LOOKING.warn} : null; },
    menu: () => [{label: 'Surprise: through the looking-lake (mirror world)', run: () => C.queue(() => flip(left <= 0))}],
    dispose() { C.warp.clear('looking'); },
  };
}
