// SCREENWARP: the whole picture bent as one, by CSS on the game's frame (#wrap: the pixel canvas and the HD layer over it), for
// the night surprises (features/surprises.js: the looking-lake's mirror, the dizzy spin's tilt). No pixel work: the browser's
// compositor turns, flips and scales the finished frame. Each source sets its own part; the parts compose (the scales multiply,
// the turns and shifts add) and the style is written only when the result changes.
//   const W = createScreenWarp(el)   W.set(source, {sx?, sy?, rot? (deg), dx?, dy? (css px), s? (an even scale)}) / W.clear(source)
//   W.mirrored (the composed sx < 0: the HD text drawn over it reads backwards unless drawn flipped back)
// OWNS: el.style.transform (the boot sets no transform on #wrap). BUDGET: a few multiplies a call, one style write on a change.
export function createScreenWarp(el) {
  const parts = new Map();
  let last = '', sxAll = 1;
  function apply() {
    let sx = 1, sy = 1, s = 1, rot = 0, dx = 0, dy = 0;
    for (const p of parts.values()) { sx *= p.sx ?? 1; sy *= p.sy ?? 1; s *= p.s ?? 1; rot += p.rot || 0; dx += p.dx || 0; dy += p.dy || 0; }
    sxAll = sx;
    const t = sx === 1 && sy === 1 && s === 1 && !rot && !dx && !dy ? ''
      : `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${(sx * s).toFixed(3)}, ${(sy * s).toFixed(3)})`;
    if (t !== last && el) { last = t; el.style.transform = t; }
  }
  return {
    set(source, p) { const o = parts.get(source) || {}; Object.assign(o, p); parts.set(source, o); apply(); },
    clear(source) { if (parts.delete(source)) apply(); },
    get mirrored() { return sxAll < 0; },
  };
}
