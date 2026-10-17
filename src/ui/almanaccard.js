// THE ALMANAC'S CARD (docs/ALMANAC.md): the chapter you're on, top left, in a pixel frame on the HD layer (ui/hdpixel.js):
// its name, its goals (a box each: ticked when done, the count beside it), the pointer's distance on the goal it points for,
// then Today's three. A chapter just done shows its name, "done" and its page for a while instead. Folded (Shift+J): a small tab.
// And the POINTER: a small pixel arrow on a ring round the player, toward what the first goal with a place asks for.
//   const card = createAlmanacCard(); card.set(model) (a new model: laid out again on the next draw) / card.draw(q, u, W, H)
//   card.arrow(q, x, y, dx, dy, u, col) (screen px: the player's point, the unit way)
//   model = {title, rows: [{text, n, of, done, far?: '34 m'}], today: [{text, n, of, done}] | null, page: null | {title, text},
//            fold, hot (0..1: a flash on the frame), key ('J')}
// OWNS: its laid-out lines (made again when the model or the size changes). BUDGET: a frame's worth of fillRect / fillText while
// shown; measureText only on a new model.
import {hdFrame, hdText, hdFont, INK} from './hdpixel.js';

const GOLD = '#f2d27a', INKC = '#efe6cf', DIM = '#a39478', DONE = '#9ad878', FAR = '#cbb98f', TODAY = '#8ac8e8';
const W_TEXT = 128;   // UI px the card's text may run before it wraps (the page)

export function createAlmanacCard() {
  let M = null, L = null, lu = 0, lf = '';
  // lay the model out: lines [{s, x, col, box?: 0 | 1 (a box before it, ticked), right?: string, rcol}], w, h (UI px)
  function layout(q, u) {
    const f = hdFont(u); q.font = f;
    const meas = s => Math.ceil(q.measureText(s).width / u);
    const out = []; let w = 60;
    const line = (s, col, o = {}) => { out.push({s, col, ...o}); w = Math.max(w, (o.box !== undefined ? 9 : 0) + meas(s) + (o.right ? 6 + meas(o.right) : 0)); };
    const wrap = (s, col) => {   // the page's words, wrapped at W_TEXT
      let cur = '';
      for (const word of s.split(' ')) { const t = cur ? cur + ' ' + word : word; if (meas(t) > W_TEXT && cur) { line(cur, col); cur = word; } else cur = t; }
      if (cur) line(cur, col);
    };
    if (M.fold) { line(`Almanac  ${M.key}`, GOLD); return {lines: out, w: w + 8, h: out.length * 12 + 6}; }
    if (M.page) {
      line(M.page.title, GOLD); line('done', DONE); out.push({gap: 1}); wrap(M.page.text, INKC);
    } else {
      line(M.title, GOLD);
      for (const r of M.rows) line(r.text, r.done ? DONE : INKC, {box: r.done ? 1 : 0, right: r.done ? '' : (r.of > 1 ? `${r.n}/${r.of}` : '') + (r.far ? (r.of > 1 ? '  ' : '') + r.far : ''), rcol: r.far ? FAR : DIM});
    }
    if (M.today) {
      out.push({gap: 1}); line('Today', TODAY);
      for (const r of M.today) line(r.text, r.done ? DONE : INKC, {box: r.done ? 1 : 0, right: r.done ? '' : r.of > 1 ? `${r.n}/${r.of}` : '', rcol: DIM});
    }
    let h = 4; for (const l of out) h += l.gap ? 4 : 12;
    return {lines: out, w: w + 8, h: h + 2};
  }
  return {
    set(model) { M = model; L = null; },
    get model() { return M; },
    draw(q, u, W, H) {
      if (!M) return;
      const f = hdFont(u);
      if (!L || lu !== u || lf !== f) { L = layout(q, u); lu = u; lf = f; }
      const x0 = 8 * u, y0 = Math.round(H * .16), w = L.w * u, h = L.h * u;
      q.save(); q.imageSmoothingEnabled = false;
      hdFrame(q, x0, y0, w, h, u, M.hot > 0 && (M.hot * 6 | 0) % 2 === 0);
      let y = y0 + 3 * u;
      for (const l of L.lines) {
        if (l.gap) { q.fillStyle = '#3a2c1e'; q.fillRect(x0 + 4 * u, y + u, w - 8 * u, u); y += 4 * u; continue; }
        let x = x0 + 4 * u;
        if (l.box !== undefined) {   // a 6 x 6 box, ticked when done
          q.fillStyle = INK; q.fillRect(x, y + 3 * u, 6 * u, 6 * u);
          q.fillStyle = l.box ? DONE : '#5e4a32'; q.fillRect(x + u, y + 4 * u, 4 * u, 4 * u);
          if (l.box) { q.fillStyle = INK; q.fillRect(x + 2 * u, y + 5 * u, 2 * u, 2 * u); }
          x += 9 * u;
        }
        hdText(q, l.s, x, y + 9 * u, u, l.col);
        if (l.right) hdText(q, l.right, x0 + w - 4 * u, y + 9 * u, u, l.rcol, 'right');
        y += 12 * u;
      }
      q.restore();
    },
    // the pointer: a 5-pixel chevron 26 UI px out from the player's point on the screen, toward (dx, dy)
    arrow(q, x, y, dx, dy, u, col = GOLD) {
      const r = 26 * u, cx = Math.round(x + dx * r), cy = Math.round(y + dy * r), px = -dy, py = dx;
      q.save(); q.imageSmoothingEnabled = false;
      for (let k = 0; k < 2; k++) {   // ink under, the colour over
        q.fillStyle = k ? col : INK; const o = k ? 0 : u;
        for (let i = 0; i < 4; i++) for (let s = -1; s <= 1; s += 2) {
          if (i === 0 && s > 0) continue;
          const ax = cx - dx * i * 1.6 * u + px * s * i * 1.6 * u, ay = cy - dy * i * 1.6 * u + py * s * i * 1.6 * u;
          q.fillRect(Math.round(ax - u) + o, Math.round(ay - u) + o, 2 * u, 2 * u);
        }
      }
      q.restore();
    },
  };
}
