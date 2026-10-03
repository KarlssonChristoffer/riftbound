// EQUIPMENT SLOT: the equipment experiment's slot on the HD overlay (features/equip.js), right of the combat feature's
// ability bar (combat/draw.js barGeo: the same slot size, its row; a gun loadout's cylinder sits in the middle and is clear
// of it too). The gadget's glyph in its colour, a cooldown sweep (clockwise from 12 o'clock) with the seconds left, the key,
// a red flash when F is denied, a bright one when it's ready again, a pulse while you aim, the name rising as it's thrown,
// and a tooltip on hover (name, what it does, the cooldown). No gadget: a dashed empty slot.
// OWNS: its hover state. READS: the sim's S (slot, cd, aiming, deny, ready, cast), content/gadgets.js.
// BUDGET: ui, ~.02 ms a frame drawn live (one slot: a few paths and one or two texts).
import {GADGETS} from '../content/gadgets.js';
import {clamp, TAU} from '../core/mathx.js';

const FONT = '"Segoe UI", system-ui, sans-serif';

export function createEquipSlot() {
  const mouse = {x: -1, y: -1};
  let canvas = null;
  const onMove = e => { if (!canvas) return; const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) * canvas.width / (r.width || 1); mouse.y = (e.clientY - r.top) * canvas.height / (r.height || 1); };
  addEventListener('mousemove', onMove);

  // the slot's place: combat's bar geometry (5 slots + 4 gaps, centred, at the bottom), three gaps right of its end
  const GEO = {Sz: 0, x: 0, y: 0};
  function geo(W, HH, sc) {
    const Sz = Math.round(clamp(sc * 12, 26, 56)), gap = Math.round(Sz * .22), tw = 5 * Sz + 4 * gap, bx = Math.round((W - tw) / 2);
    const S = Math.round(Sz * 1.12);
    GEO.Sz = S; GEO.x = bx + tw + gap * 3 + 6; GEO.y = HH - Sz - Math.round(Sz * .35) - (S - Sz); return GEO;
  }
  // THE CACHE: the slot's still parts (its box, the glyph, the key) are painted once into a small canvas per look (scale x
  // gadget x cooling) and blitted; per frame only the sweep (an arc), the frame's line and the countdown (its digits cached
  // as small canvases, one per string) are drawn. Hovered (the tooltip) or just thrown (the name rising) it draws those live
  let base = null, bSc = 0, bId = null, bCool = false, bSz = 0;
  const digits = new Map();   // the countdown's strings -> a canvas each (for this slot size)
  let dSz = 0;
  const STR_INT = Array.from({length: 100}, (_, i) => '' + i), STR_DEC = Array.from({length: 10}, (_, i) => '0.' + i);
  function digit(s, Sz) {
    if (Sz !== dSz) { digits.clear(); dSz = Sz; }
    let c = digits.get(s); if (c) return c;
    c = document.createElement('canvas'); const fs = Math.round(Sz * .34); c.width = Math.ceil(fs * .62 * s.length + 8); c.height = fs + 8;
    const q = c.getContext('2d'); q.font = `700 ${fs}px ${FONT}`; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.lineWidth = 3; q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(s, c.width / 2, c.height / 2 + 1); q.fillStyle = '#f4efe4'; q.fillText(s, c.width / 2, c.height / 2 + 1);
    digits.set(s, c); return c;
  }
  function draw(q, sc, St) {
    canvas = q.canvas;
    const W = canvas.width, HH = canvas.height, {Sz, x, y} = geo(W, HH, sc), sl = St.slot, G = sl ? GADGETS[sl.id] : null;
    const hover = mouse.x >= x && mouse.x < x + Sz && mouse.y >= y && mouse.y < y + Sz;
    if (hover) { paint(q, W, HH, sc, St, hover); return; }
    const cool = !!sl && sl.cd > 0, id = sl ? sl.id : '', B = Sz + 16;
    if (!base || bSc !== sc || bId !== id || bCool !== cool || bSz !== Sz) {
      base ??= document.createElement('canvas');
      if (base.width !== B || base.height !== B) { base.width = B; base.height = B; }
      const c = base.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, B, B); c.translate(8 - x, 8 - y);
      paintBase(c, Sz, x, y, sl, G, cool); bSc = sc; bId = id; bCool = cool; bSz = Sz;
    }
    q.drawImage(base, x - 8, y - 8);
    if (G) live(q, Sz, x, y, sl, G, cool, St);
    if (G && St.cast > 0) {   // the name rises over the slot as it's thrown (its text cached per gadget and size)
      const k = 1 - St.cast / .9, c = nameOf(sl.id, G, Sz);
      q.globalAlpha = k > .7 ? 1 - (k - .7) / .3 : 1; q.drawImage(c, Math.round(x + Sz / 2 - c.width / 2), Math.round(y - 10 - k * 6 - c.height)); q.globalAlpha = 1;
    }
    else if (St.deny > 0) { q.setLineDash([3, 3]); q.lineWidth = 1; q.strokeStyle = '#e0483a'; q.strokeRect(x + 2.5, y + 2.5, Sz - 5, Sz - 5); q.setLineDash([]); }
  }
  const names = new Map(); let nSz = 0;
  function nameOf(id, G, Sz) {
    if (Sz !== nSz) { names.clear(); nSz = Sz; }
    let c = names.get(id); if (c) return c;
    c = document.createElement('canvas'); const fs = Math.max(11, Math.round(Sz * .3)), q = c.getContext('2d'), font = `700 ${fs}px ${FONT}`;
    q.font = font; c.width = Math.ceil(q.measureText(G.name).width + 8); c.height = fs + 8;
    q.font = font; q.textAlign = 'center'; q.textBaseline = 'middle'; q.lineJoin = 'round';
    q.lineWidth = 3; q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(G.name, c.width / 2, c.height / 2); q.fillStyle = G.col; q.fillText(G.name, c.width / 2, c.height / 2);
    names.set(id, c); return c;
  }
  // the still parts: the box, the glyph (grey while cooling), the key; no gadget: a dashed frame
  function paintBase(q, Sz, x, y, sl, G, cool) {
    const cx = x + Sz / 2, cy = y + Sz / 2;
    q.fillStyle = 'rgba(12,10,16,.55)'; q.fillRect(x - 6, y - 6, Sz + 12, Sz + 12);
    q.fillStyle = '#16141c'; q.fillRect(x, y, Sz, Sz);
    q.fillStyle = 'rgba(255,255,255,.05)'; q.fillRect(x + 1, y + 1, Sz - 2, Sz * .45);
    if (G) glyph(q, sl.id, cx, cy + Sz * .04, Sz * .3, cool ? '#8a8490' : G.col);
    else { q.setLineDash([3, 3]); q.lineWidth = 1; q.strokeStyle = 'rgba(240,150,70,.45)'; q.strokeRect(x + 2.5, y + 2.5, Sz - 5, Sz - 5); q.setLineDash([]); }
    q.font = `700 ${Math.max(9, Math.round(Sz * .24))}px ${FONT}`; q.textAlign = 'left'; q.textBaseline = 'top';
    const kw = q.measureText('F').width + 5;
    q.fillStyle = 'rgba(10,8,12,.85)'; q.fillRect(x + 1, y + 1, kw, Math.round(Sz * .28));
    q.fillStyle = '#f0a050'; q.fillText('F', x + 3.5, y + 2);
  }
  // what moves: the cooldown's sweep and countdown, the frame (denied, aiming, ready, cooling, idle)
  function live(q, Sz, x, y, sl, G, cool, St) {
    const cx = x + Sz / 2, cy = y + Sz / 2;
    if (cool) {
      const f = clamp(sl.cd / G.cd, 0, 1);
      q.save(); q.beginPath(); q.rect(x, y, Sz, Sz); q.clip();
      q.fillStyle = 'rgba(6,4,10,.66)'; q.beginPath(); q.moveTo(cx, cy); q.arc(cx, cy, Sz, -Math.PI / 2, -Math.PI / 2 + TAU * f); q.closePath(); q.fill();
      q.restore();
      const d = digit(sl.cd >= 1 ? STR_INT[Math.min(99, Math.ceil(sl.cd))] : STR_DEC[Math.min(9, Math.max(1, Math.round(sl.cd * 10)))], Sz);
      q.drawImage(d, Math.round(cx - d.width / 2), Math.round(cy - d.height / 2));
    }
    q.lineWidth = 1.5;
    q.strokeStyle = St.deny > 0 ? '#e0483a' : St.aiming ? G.col : St.ready > 0 ? '#fff8e0' : cool ? '#3a3640' : 'rgba(240,150,70,.75)';
    q.strokeRect(x + .5, y + .5, Sz - 1, Sz - 1);
    if (St.aiming) { q.globalAlpha = .55 + .45 * Math.sin(performance.now() / 90); q.strokeStyle = G.col; q.lineWidth = 2; q.strokeRect(x - 2.5, y - 2.5, Sz + 5, Sz + 5); q.globalAlpha = 1; }
    if (St.ready > 0) { q.globalAlpha = St.ready / .3; q.strokeStyle = G.col; q.lineWidth = 2; q.strokeRect(x - 2, y - 2, Sz + 4, Sz + 4); q.globalAlpha = 1; }
  }
  // all of it, live (hovered: the tooltip; just thrown: the name rising)
  function paint(q, W, HH, sc, St, hover) {
    const {Sz, x, y} = geo(W, HH, sc), cx = x + Sz / 2, sl = St.slot, G = sl ? GADGETS[sl.id] : null, cool = !!sl && sl.cd > 0;
    q.save();
    paintBase(q, Sz, x, y, sl, G, cool);
    if (G) live(q, Sz, x, y, sl, G, cool, St);
    if (G && St.cast > 0) {   // the name rises over the slot as it's thrown
      const k = 1 - St.cast / .9; q.globalAlpha = k > .7 ? 1 - (k - .7) / .3 : 1;
      q.font = `700 ${Math.max(11, Math.round(Sz * .3))}px ${FONT}`; q.textAlign = 'center'; q.textBaseline = 'bottom';
      q.lineWidth = 3; q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(G.name, cx, y - 10 - k * 6); q.fillStyle = G.col; q.fillText(G.name, cx, y - 10 - k * 6);
      q.globalAlpha = 1;
    }
    if (hover) {   // the tooltip
      const t1 = G ? G.name : 'No equipment', t2 = G ? `${G.desc} · ${G.cd}s` : 'find one in a cache or a chest; F uses it', t0 = 'Equipment · F (hold to aim)';
      const f0 = `600 ${Math.max(10, Math.round(Sz * .22))}px ${FONT}`, f1 = `700 ${Math.max(12, Math.round(Sz * .3))}px ${FONT}`, f2 = `500 ${Math.max(11, Math.round(Sz * .24))}px ${FONT}`;
      q.font = f1; const w1 = q.measureText(t1).width; q.font = f2; const w2 = q.measureText(t2).width; q.font = f0; const w0 = q.measureText(t0).width;
      const w = Math.max(w0, w1, w2) + 20, h = Sz * 1.45, tx = clamp(cx - w / 2, 4, W - w - 4), ty = y - h - 12;
      q.fillStyle = 'rgba(16,14,20,.92)'; q.fillRect(tx, ty, w, h); q.strokeStyle = G ? G.col : 'rgba(240,150,70,.6)'; q.lineWidth = 1; q.strokeRect(tx + .5, ty + .5, w - 1, h - 1);
      q.textAlign = 'left'; q.textBaseline = 'top';
      q.font = f0; q.fillStyle = '#9a937f'; q.fillText(t0, tx + 10, ty + 6);
      q.font = f1; q.fillStyle = G ? G.col : '#d8d0c0'; q.fillText(t1, tx + 10, ty + 6 + Sz * .3);
      q.font = f2; q.fillStyle = '#d8d0c0'; q.fillText(t2, tx + 10, ty + 6 + Sz * .72);
    }
    q.restore();
  }

  // the gadgets' glyphs (vector, like combat's ability icons): r = the glyph's half size
  function glyph(q, id, x, y, r, col) {
    q.save(); q.strokeStyle = col; q.fillStyle = col; q.lineWidth = Math.max(1.5, r * .16); q.lineCap = 'round'; q.lineJoin = 'round';
    const L = (x0, y0, x1, y1) => { q.beginPath(); q.moveTo(x + x0 * r, y + y0 * r); q.lineTo(x + x1 * r, y + y1 * r); q.stroke(); };
    const O = (ox, oy, rr, fill = true) => { q.beginPath(); q.arc(x + ox * r, y + oy * r, rr * r, 0, TAU); fill ? q.fill() : q.stroke(); };
    if (id === 'flask') {   // a round bottle, its neck, a rag alight
      O(0, .35, .62); q.fillRect(x - r * .17, y - r * .65, r * .34, r * .5);
      q.fillStyle = '#fff4c0'; O(-.22, .18, .14); q.fillStyle = '#ffd060'; O(.05, -.92, .2); q.fillStyle = '#fff6c8'; O(.05, -.95, .09);
    } else if (id === 'dynamite') {   // three sticks, a band, a fuse with a spark
      for (const ox of [-.5, 0, .5]) q.fillRect(x + (ox - .2) * r, y - r * .35, r * .4, r * 1.25);
      q.fillStyle = '#e8dcc0'; q.fillRect(x - r * .72, y + r * .2, r * 1.44, r * .22);
      q.strokeStyle = '#d8d0c0'; q.lineWidth = Math.max(1, r * .1); q.beginPath(); q.moveTo(x, y - r * .35); q.quadraticCurveTo(x + r * .1, y - r * .8, x + r * .5, y - r * .85); q.stroke();
      q.fillStyle = '#fff4c0'; O(.55, -.88, .16);
    } else if (id === 'beartrap') {   // a jaw: an arc of teeth on a bar
      q.beginPath(); q.arc(x, y + r * .25, r * .85, Math.PI, 0); q.stroke();
      for (let i = 0; i < 6; i++) { const a = Math.PI + (i + .5) / 6 * Math.PI; L(Math.cos(a) * .85, .25 + Math.sin(a) * .85, Math.cos(a) * .5, .25 + Math.sin(a) * .5); }
      L(-1, .25, 1, .25); O(0, .55, .16);
    } else if (id === 'scarecrow') {   // a post and a crossbar, a round head, a hat
      L(0, -.3, 0, 1); L(-.95, -.05, .95, -.05); O(0, -.48, .3);
      q.fillRect(x - r * .5, y - r * .82, r, r * .12); q.fillRect(x - r * .22, y - r * 1.05, r * .44, r * .28);
      L(-.95, -.05, -1.05, .2); L(.95, -.05, 1.05, .2);
    } else if (id === 'smoke') {   // a cloud over a small bomb
      O(-.42, -.15, .38); O(.1, -.38, .45); O(.5, -.08, .34); O(0, .05, .4);
      q.fillStyle = '#3a3a44'; O(-.1, .62, .3); q.fillStyle = col; q.fillRect(x - r * .02, y + r * .2, r * .12, r * .2);
    } else if (id === 'grapple') {   // a three-pronged hook on a rope
      L(0, -.95, 0, .45); O(0, -.95, .14, false);
      q.beginPath(); q.arc(x - r * .4, y + r * .45, r * .4, 0, Math.PI * .85); q.stroke();
      q.beginPath(); q.arc(x + r * .4, y + r * .45, r * .4, Math.PI * .15, Math.PI); q.stroke();
      L(0, .45, 0, .85);
      q.setLineDash([r * .15, r * .12]); L(0, -1.1, -.6, -1.4); q.setLineDash([]);
    }
    q.restore();
  }
  return {draw, glyph, dispose() { removeEventListener('mousemove', onMove); }};
}
