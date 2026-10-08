// THE OMEN'S HUD (HD overlay, display resolution): the active omen as an icon top left (its glyph in a frame of its colour,
// gold and doubled for a blessing; the Gale's is an arrow along the wind as the camera sees it), its name and rule beside
// it, and on hover a tooltip with what it does exactly (content/omens.js tip). The frame flashes while a bolt is coming.
// OWNS: nothing kept between frames but the hover. READS: the omen (def, its age), host.mouse / VW / VH / zoom / yaw.
// BUDGET: ~.02 ms (a few fillText).
import {clamp} from '../../core/mathx.js';

const FONT = '"Segoe UI", system-ui, sans-serif';

export function createOmenHud(host) {
  function text(q, s, x, y, size, col, o) {
    q.font = `${o?.w ?? 700} ${Math.round(size)}px ${FONT}`; q.textAlign = o?.align ?? 'left'; q.textBaseline = o?.base ?? 'alphabetic';
    q.lineJoin = 'round'; q.lineWidth = Math.max(2, size * .22); q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(s, x, y);
    q.fillStyle = col; q.fillText(s, x, y);
  }
  const MID = {align: 'center', base: 'middle', w: 600}, SMALL = {w: 600}, TIPT = {w: 700}, TIPL = {w: 500};
  return {
    // def: the omen (content/omens.js), name: as shown (the frost lands' thundersnow), age (s since it began), alert 0..1,
    // wind: [ux, uy] (the Gale: the arrow's way in the world)
    draw(q, sc, def, name, age, alert, wind) {
      const u = clamp(host.hudScale / 2.6, .7, 2.8), s = Math.round(34 * u), x = Math.round(20 * u), y = Math.round(16 * u), W = q.canvas.width;
      q.save(); q.globalAlpha = clamp(age / .6, 0, 1);
      q.fillStyle = 'rgba(16,14,20,.88)'; q.fillRect(x, y, s, s);
      q.strokeStyle = alert > 0 && ((age * 10) | 0) % 2 === 0 ? '#ffffff' : def.col; q.lineWidth = Math.max(1.5, 2 * u * .8); q.strokeRect(x + 1, y + 1, s - 2, s - 2);
      if (def.good) { q.strokeStyle = '#f2d27a'; q.lineWidth = 1; q.strokeRect(x - 2.5, y - 2.5, s + 5, s + 5); }
      if (wind) {   // the Gale: an arrow along the wind, as the camera sees it
        const a = host.yaw, sx = wind[0] * Math.cos(a) - wind[1] * Math.sin(a), sy = (wind[0] * Math.sin(a) + wind[1] * Math.cos(a)) * .75, l = Math.hypot(sx, sy) || 1;
        const ux = sx / l, uy = sy / l, cx = x + s / 2, cy = y + s / 2, r = s * .32;
        q.strokeStyle = def.col; q.lineWidth = Math.max(2, 2.4 * u); q.lineCap = 'round';
        q.beginPath(); q.moveTo(cx - ux * r, cy - uy * r); q.lineTo(cx + ux * r, cy + uy * r);
        q.moveTo(cx + ux * r, cy + uy * r); q.lineTo(cx + ux * r * .35 - uy * r * .45, cy + uy * r * .35 + ux * r * .45);
        q.moveTo(cx + ux * r, cy + uy * r); q.lineTo(cx + ux * r * .35 + uy * r * .45, cy + uy * r * .35 - ux * r * .45); q.stroke();
      } else text(q, def.glyph, x + s / 2, y + s / 2 + 1, s * .58, def.col, MID);
      text(q, name, x + s + 10 * u, y + s * .42, 15 * u, def.col);
      text(q, def.rule, x + s + 10 * u, y + s * .42 + 15 * u, 11 * u, '#e8e2d2', SMALL);
      // the tooltip (hover the icon or its name)
      const mx = (host.VW / 2 + (host.mouse.x - host.VW / 2) * host.zoom) * sc + host.G.sub.x * sc / host.G.display, my = (host.VH / 2 + (host.mouse.y - host.VH / 2) * host.zoom) * sc + host.G.sub.y * sc / host.G.display;   // (+ the sub-pixel camera's slide: the HUD stays put)
      if (mx >= x && mx < x + s + 200 * u && my >= y && my < y + s) {
        q.font = `500 ${Math.round(11 * u)}px ${FONT}`;
        let w = 0; for (const l of def.tip) w = Math.max(w, q.measureText(l).width);
        const lh = 15 * u, bw = w + 20 * u, bh = 30 * u + def.tip.length * lh, bx = clamp(x, 4, W - bw - 4), by = y + s + 8 * u;
        q.globalAlpha = 1; q.fillStyle = 'rgba(16,14,20,.94)'; q.fillRect(bx, by, bw, bh);
        q.strokeStyle = def.col; q.lineWidth = 1; q.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
        text(q, (def.good ? 'Blessing · ' : 'Omen · ') + name, bx + 10 * u, by + 18 * u, 13 * u, def.col, TIPT);
        def.tip.forEach((l, i) => text(q, l, bx + 10 * u, by + 34 * u + i * lh, 11 * u, '#d8d0c0', TIPL));
      }
      q.restore();
    },
  };
}
