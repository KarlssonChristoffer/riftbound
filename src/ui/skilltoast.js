// SKILL TOASTS (docs/SKILLS.md): a level reached, a move learned, a title earned: a small pixel frame (ui/hdpixel.js) that
// slides up at the bottom centre, under the HUD's toasts, and fades after `dur` s. Line one in the skill's colour ("Mining 5"),
// line two, when there is one, the move's name; nothing more (no explaining: the world teaches the move). Drawn on the HD
// layer by features/pack.js's hd().
//   const T = createSkillToasts(); T.push(title, sub, col, dur?); T.update(dt); T.draw(q, W, H, u)
// OWNS: its queue (a few entries). BUDGET: a frame and two lines of text a toast while one shows; nothing otherwise.
import {hdFrame, hdText, hdFont} from './hdpixel.js';

const DUR = 4, MAX = 4, IN = .25, OUT = .6;

export function createSkillToasts() {
  const Q = [];
  return {
    push(title, sub = '', col = '#f4efe4', dur = DUR) { Q.push({title, sub, col, dur, t: 0, u: '', w: 0}); if (Q.length > MAX) Q.shift(); },
    update(dt) { for (let i = Q.length - 1; i >= 0; i--) if ((Q[i].t += dt) > Q[i].dur) Q.splice(i, 1); },
    get length() { return Q.length; },
    draw(q, W, H, u) {
      if (!Q.length) return;
      q.save(); q.imageSmoothingEnabled = false;
      let y = Math.round(H * .9);
      for (let i = Q.length - 1; i >= 0; i--) {   // (the newest at the bottom, the older ones above it)
        const T = Q[i], k = Math.min(1, T.t / IN), a = Math.min(1, (T.dur - T.t) / OUT);
        const f = hdFont(u); if (T.u !== f) { q.font = f; T.u = f; T.w = Math.ceil(Math.max(q.measureText(T.title).width, T.sub ? q.measureText(T.sub).width : 0) / u) * u + 12 * u; }   // (measured once a size, and again when the pixel font has come)
        const w = T.w, h = (T.sub ? 25 : 14) * u;
        const x = Math.round(W / 2 - w / 2), yy = y - h + Math.round((1 - k * (2 - k)) * 18) * u;   // (slides up as it comes)
        q.globalAlpha = Math.max(0, a);
        hdFrame(q, x, yy, w, h, u);
        hdText(q, T.title, Math.round(W / 2), yy + 11 * u, u, T.col, 'center');
        if (T.sub) hdText(q, T.sub, Math.round(W / 2), yy + 22 * u, u, '#e8dcc0', 'center');
        y = yy - 3 * u;
      }
      q.restore();
    },
  };
}
