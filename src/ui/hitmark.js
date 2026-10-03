// HIT MARKER: a crisp little X round the reticle when a shot lands on a body (features/gunfx.js feeds it the revolver's
// hits from combat.hit and draws it): white for a hit, gold and a pixel longer for a crit, red, thicker and bigger for a
// kill. Pixel art on the 'front' layer (the reticle's, core/loop.js: 1 px per art pixel), each arm a diagonal of pixels
// with a dark drop one pixel down-right so it reads on bright sand; it pops out a pixel for its first moment and fades
// over the last part of its life. A plain hit doesn't cut short a crit or a kill still showing.
// OWNS: its timer and kind. READS: nothing (the caller hands it the reticle's position).
// BUDGET: <= 64 fillRects a frame while it shows; nothing allocated.
//   const hm = createHitmark(); hm.hit(0 hit | 1 crit | 2 kill); hm.view(dt); if (hm.on) hm.draw(q, mx, my)
export const TUNE = {
  life: [.2, .26, .36],          // s it shows: a hit, a crit, a kill (it fades over the last `fade` of it)
  fade: .4,
  gap: [2, 2, 3],                // px from the reticle's centre to an arm's first pixel
  arm: [3, 4, 5],                // px along each diagonal
  w: [1, 1, 2],                  // px thick
  pop: .05, popPx: [1, 1, 2],    // s: the arms start this many px further out, then settle
  col: ['#f4efe4', '#ffd25a', '#ff4a32'], drop: 'rgba(16,10,12,.85)',
};

export function createHitmark() {
  let t = 9, kind = 0;
  function arms(q, x, y, g, n, w) {
    for (let i = g; i < g + n; i++) { q.fillRect(x + i, y + i, w, w); q.fillRect(x - i - w + 1, y + i, w, w); q.fillRect(x + i, y - i - w + 1, w, w); q.fillRect(x - i - w + 1, y - i - w + 1, w, w); }
  }
  return {
    TUNE,
    hit(k) { if (t < TUNE.life[kind] && k < kind) return; kind = k; t = 0; },
    view(dt) { if (t < 9) t += dt; },
    get on() { return t < TUNE.life[kind]; },
    draw(q, mx, my) {
      const L = TUNE.life[kind]; if (t >= L) return;
      const f0 = L * (1 - TUNE.fade), g = TUNE.gap[kind] + (t < TUNE.pop ? TUNE.popPx[kind] : 0), n = TUNE.arm[kind], w = TUNE.w[kind];
      q.globalAlpha = t > f0 ? 1 - (t - f0) / (L - f0) : 1;
      q.fillStyle = TUNE.drop; arms(q, mx + 1, my + 1, g, n, w);
      q.fillStyle = TUNE.col[kind]; arms(q, mx, my, g, n, w);
      q.globalAlpha = 1;
    },
  };
}
