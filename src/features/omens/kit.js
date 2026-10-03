// OMENS' KIT (view): the drawing the omens share. Rings on the ground (dashed, turning: a telegraph's language, like the
// run's spawn rings in game/game.js), a brute's glowing eyes where its painted ones are (world/biomes.js brute: two 2 x 2 px
// eyes 36 px over its feet, 4 and 8 px toward the way it faces), the screen's axes on the ground, reused point options.
// Presentation only: nothing here is read by the sim. Allocation-free per call (colours are [r, g, b] arrays, parsed once).
//   const K = createKit(host); K.ring(x, y, h, r, col, turn, of, on, o?); K.eyes(b, col, t, glow?); K.axes() -> {x, y}
import {hash3} from '../../core/mathx.js';
import {rgbOf} from '../../core/color.js';

export const TAU = Math.PI * 2;
export const C = c => rgbOf(c);   // '#rrggbb' -> [r, g, b] (once, at load)

export function createKit(host) {
  const PPM = host.PPM, PPMY = host.PPMY, PPMH = host.PPMH, G = host.G;
  const E1 = {emit: true, size: 1}, E2 = {emit: true, size: 2}, P1 = {size: 1}, P2 = {size: 2};
  // the screen's right on the ground (arena x, y) at the camera's yaw: 1 art px = 1 / PPM m along it
  const SR = {x: 1, y: 0};
  const axes = () => { const a = host.yaw; SR.x = Math.cos(a); SR.y = -Math.sin(a); return SR; };
  // a dashed ring on the ground: one point per screen pixel round the ellipse, `on` of every `of` lit, turned by `turn` (rad)
  function ring(x, y, h, r, col, turn, of, on, o = E1) {
    const n = Math.max(12, Math.round(r * (PPM + PPMY) * 1.6)), sh = Math.floor(turn * n / TAU);
    for (let i = 0; i < n; i++) {
      if ((((i + sh) % of) + of) % of >= on) continue;
      const a = i / n * TAU; host.point(x + Math.sin(a) * r, y + Math.cos(a) * r, h, col, o);
    }
  }
  // a brute's eyes: two glowing 2 x 2 px points over its painted ones (it blinks now and then, each on its own beat); glow > 0
  // adds a soft halo in the HD fx pass on top of everything (fog, darkness) at that strength, in gcol (default: col)
  const GLOWC = [0, 0, 0];
  function eyes(b, col, t, glow = 0, gcol = col) {
    const ph = hash3(Math.round((b.home?.[0] ?? b.x) * 10), Math.round((b.home?.[1] ?? b.y) * 10), 7);
    if ((t * .23 + ph) % 1 < .03) return;   // a blink (~.13 s every ~4.3 s)
    const f = b.face, left = typeof f === 'number' && (f === -1 || f === 1 ? f < 0 : Math.sin(f * TAU / 16) < -.01);   // (biomes.js faceLeft)
    const s = axes(), d = left ? -1 : 1, h = (b.z || 0) + (b.h || 0) + 36 / PPMH, x0 = b.x, y0 = b.y;
    for (const o of EYE_DX) {
      const k = d * o / PPM;
      host.point(x0 + s.x * k, y0 + s.y * k, h, col, E2);
    }
    if (glow > 0 && G.fx) {
      const k = d * 6 / PPM; GLOWC[0] = gcol[0]; GLOWC[1] = gcol[1]; GLOWC[2] = gcol[2];
      G.fx(x0 + s.x * k, h, y0 + s.y * k, .16, GLOWC, glow, 'add');
    }
  }
  const EYE_DX = [4, 8];
  return {E1, E2, P1, P2, axes, ring, eyes, PPM, PPMY, PPMH};
}
