// EQUIPMENT ART: the gadgets' pixel art, painted once (the first time the experiment is switched on) into small canvases
// the view draws as world sprites (host.sprite: lit billboards, a sun shadow each). Each sheet is a strip of frames, an
// albedo canvas and an emissive one (what glows: a rag alight, a lit fuse, the cache's brass under its lamp).
//   flask / dynamite / smoke / hook / crow8   8 turns each (tumbling in the air; the hook points where it flies)
//   crow     the scarecrow planted: 0 still, 1 leaning left, 2 leaning right, 3 hit (squashed), 4 falling apart
//   trap     0 open (lying flat), 1 shut (jaws up)          cache   0 shut, 1 open and empty
// The shapes are char maps (one char a pixel, '.' empty) over a palette, or painted by code where a map would be long.
// OWNS: the canvases. READS: nothing (pure painting). BUDGET: ~2 ms once.
const PAL = {
  // flask: rag, cork, glass, oil
  r: '#e8d8b0', R: '#b89868', c: '#8a6a44', g: '#b8e0d8', w: '#ffffff', G: '#4e7c7a', o: '#ff9a3a', O: '#c8501e',
  // dynamite: stick light / mid / dark, caps, paper band, fuse
  L: '#e8584a', M: '#c0342a', D: '#7a2018', a: '#f0dcc0', b: '#c8b090', P: '#ece0c4', p: '#b8a888', f: '#3a3028',
  // smoke bomb: iron, highlight, fuse
  k: '#30303a', K: '#4c4c58', h: '#9a9aaa', t: '#c8a060',
  // hook: steel light / mid / dark
  s: '#e0e4ec', S: '#9aa0ac', d: '#565c68',
};
const GLOW = {r: '#a04a10', R: '#602808', o: '#5a2406', O: '#401804', t: '#000000'};   // emissive: the rag alight, the oil's warmth

const MAPS = {
  flask: [
    '...rr...',
    '..rRr...',
    '...cc...',
    '...gg...',
    '..gwgG..',
    '.gwooOG.',
    'gwoooOOG',
    'gooooOOG',
    'gooooOOG',
    '.GoOOOG.',
    '..GGGG..'],
  dynamite: [
    '....f....',
    '....f....',
    '...f.....',
    'abcabcabc',
    'LMDLMDLMD',
    'LMDLMDLMD',
    'PPPPPPPPP',
    'ppppppppp',
    'LMDLMDLMD',
    'LMDLMDLMD',
    'LMDLMDLMD',
    'DDDDDDDDD'],
  smoke: [
    '....t..',
    '...t...',
    '..kkk..',
    '.kKhkk.',
    'kKhKkkk',
    'kKKkkkk',
    '.kkkkk.',
    '..kkk..'],
  hook: [
    '...sss...',
    '...s.s...',
    '...sss...',
    '....S....',
    '....S....',
    '....S....',
    's...S...s',
    'S...S...S',
    '.S.SdS.S.',
    '..dd.dd..'],
};
// where the fuse burns (its tip, in the map's pixels from its centre) for the sparks: dynamite, smoke; the flask's rag
export const TIPS = {dynamite: [0, -6], smoke: [1, -4], flask: [-.5, -5.5]};

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d'); q.imageSmoothingEnabled = false; return [c, q]; }
const px = (q, x, y, c, w = 1, h = 1) => { q.fillStyle = c; q.fillRect(x, y, w, h); };

// a char map turned by angle a (nearest pixel), centred in a cell of size n x n, into frame i of a strip
function turned(map, n, frames, glow = GLOW) {
  const w = map[0].length, h = map.length, [img, q] = canvas(n * frames, n), [em, e] = canvas(n * frames, n);
  let lit = false;
  for (let i = 0; i < frames; i++) {
    const a = i / frames * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x + .5 - n / 2, dy = y + .5 - n / 2, sx = Math.floor(dx * c + dy * s + w / 2), sy = Math.floor(-dx * s + dy * c + h / 2);
      const ch = sx >= 0 && sy >= 0 && sx < w && sy < h ? map[sy][sx] : '.';
      if (ch === '.' || !PAL[ch]) continue;
      px(q, i * n + x, y, PAL[ch]);
      if (glow[ch] && glow[ch] !== '#000000') { px(e, i * n + x, y, glow[ch]); lit = true; }
    }
  }
  return {img, em: lit ? em : null, w: n, h: n, frames};
}

// THE SCARECROW: a post and a crossbar, a ragged coat, a stitched sack head under a straw hat, straw out of the sleeves
function crowFrame(q, ox, lean, squash, broken) {
  const W = '#8a6a44', Wd = '#5c4430', CO = '#5e6c3c', COd = '#3e4a28', COl = '#7a8a50', PA = '#8a5a3a';
  const SK = '#d8c098', SKd = '#a89070', SKl = '#ecdab4', HT = '#8a6a3a', HTd = '#5e4424', HTl = '#a8844e', BAND = '#7a2a22';
  const ST = ['#f0d070', '#d8b048', '#a88030'];
  const top = squash ? 3 : 0, sh = (y, k) => ox + (y < 30 ? Math.round(lean * (30 - y) / 30) : 0) + k;
  if (broken) {   // fallen: the post snapped, the coat a heap, the hat beside it
    px(q, ox + 4, 40, Wd, 13, 2); px(q, ox + 4, 39, W, 13, 1);
    px(q, ox + 6, 36, COd, 9, 4); px(q, ox + 7, 35, CO, 7, 2); px(q, ox + 8, 37, COl, 3, 1);
    px(q, ox + 14, 38, SKd, 4, 3); px(q, ox + 14, 37, SK, 4, 1);
    px(q, ox + 1, 41, HTd, 6, 1); px(q, ox + 2, 39, HT, 4, 2);
    for (let i = 0; i < 9; i++) px(q, ox + 3 + i * 2, 42 - (i % 2), ST[i % 3], 1, 1);
    return;
  }
  // the post (below the coat) and its foot
  px(q, ox + 9, 30, W, 3, 16); px(q, ox + 11, 30, Wd, 1, 16); px(q, ox + 8, 44, Wd, 5, 2);
  // straw hanging under the hem
  for (let i = 0; i < 7; i++) px(q, sh(30, 6 + i), 30 + top, ST[(i * 2) % 3], 1, 2 + (i % 2));
  // the coat: the body, its sleeves along the crossbar, a patch, buttons
  for (let y = 13 + top; y < 31; y++) {
    const w0 = y < 18 ? 9 : 11 + ((y - 18) >> 2), x0 = sh(y, 10 - (w0 >> 1));
    px(q, x0, y, CO, w0, 1); px(q, x0 + w0 - 2, y, COd, 2, 1); px(q, x0, y, COl, 1, 1);
  }
  px(q, sh(22, 7), 22, PA, 3, 3); px(q, sh(22, 7), 22, '#a87452', 1, 1);
  for (let y = 18; y < 29; y += 4) px(q, sh(y, 10), y, '#2a2418', 1, 1);
  // the sleeves (on the crossbar), ragged, straw out of the cuffs
  const ay = 14 + top;
  px(q, sh(ay, 1), ay, CO, 19, 3); px(q, sh(ay, 1), ay + 2, COd, 19, 1); px(q, sh(ay, 1), ay, COl, 19, 1);
  px(q, sh(ay, 2), ay + 3, COd, 1, 1); px(q, sh(ay, 17), ay + 3, COd, 1, 1); px(q, sh(ay, 4), ay + 3, CO, 1, 1);
  for (let i = 0; i < 3; i++) { px(q, sh(ay, -1), ay + i, ST[i], 1, 1); px(q, sh(ay, 20), ay + i, ST[(i + 1) % 3], 1, 1); }
  px(q, sh(ay, -2), ay + 1, ST[0], 1, 1); px(q, sh(ay, 21), ay + 1, ST[1], 1, 1);
  // the sack head: round-ish, tied at the neck, a stitched face
  const hy = 4 + top;
  for (let y = 0; y < 9; y++) { const w0 = y === 0 || y === 8 ? 5 : y === 1 || y === 7 ? 7 : 9, x0 = sh(hy + y, 10 - (w0 >> 1)); px(q, x0, hy + y, SK, w0, 1); px(q, x0 + w0 - 2, hy + y, SKd, 2, 1); if (y < 4) px(q, x0 + 1, hy + y, SKl, 1, 1); }
  px(q, sh(hy + 9, 8), hy + 9, '#9a7a40', 5, 1);   // the tie
  px(q, sh(hy + 3, 6), hy + 3, '#2a2018', 1, 1); px(q, sh(hy + 3, 8), hy + 3, '#2a2018', 1, 1); px(q, sh(hy + 3, 7), hy + 4, '#2a2018', 1, 1); px(q, sh(hy + 3, 6), hy + 5, '#2a2018', 1, 1); px(q, sh(hy + 3, 8), hy + 5, '#2a2018', 1, 1);   // an X for an eye
  px(q, sh(hy + 3, 12), hy + 3, '#2a2018', 2, 2);   // a button eye
  for (let i = 0; i < 5; i++) px(q, sh(hy + 6, 7 + i), hy + 6 + (i % 2), '#4a3424', 1, 1);   // the stitched grin
  for (let i = 0; i < 3; i++) px(q, sh(hy + 9, 7 + i * 3), hy + 9 + 1, ST[i], 1, 2);   // straw at the neck
  // the hat: a wide floppy brim, a dented crown, a red band
  px(q, sh(hy, 3), hy, HTd, 15, 1); px(q, sh(hy, 4), hy - 1, HT, 13, 1); px(q, sh(hy, 3), hy - 1, HTl, 2, 1);
  px(q, sh(hy - 2, 6), hy - 5, HT, 8, 4); px(q, sh(hy - 2, 6), hy - 5, HTl, 2, 3); px(q, sh(hy - 2, 12), hy - 5, HTd, 2, 4);
  px(q, sh(hy - 2, 9), hy - 5, HTd, 1, 1); px(q, sh(hy - 2, 6), hy - 2, BAND, 8, 1);
}
function crowSheet() {
  const n = 5, w = 22, h = 47, [img, q] = canvas(w * n, h);
  crowFrame(q, 0, 0, false, false); crowFrame(q, w, -2, false, false); crowFrame(q, w * 2, 2, false, false); crowFrame(q, w * 3, 0, true, false); crowFrame(q, w * 4, 0, false, true);
  return {img, em: null, w, h, frames: n};
}
// the scarecrow tumbling through the air: frame 0 turned 8 ways
function crowTurned() {
  const [src, sq] = canvas(22, 47); crowFrame(sq, 0, 0, false, false);
  const d = sq.getImageData(0, 0, 22, 47).data, n = 48, frames = 8, [img, q] = canvas(n * frames, n);
  for (let i = 0; i < frames; i++) {
    const a = i / frames * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x + .5 - n / 2, dy = y + .5 - n / 2, sx = Math.floor(dx * c + dy * s + 11), sy = Math.floor(-dx * s + dy * c + 23.5);
      if (sx < 0 || sy < 0 || sx >= 22 || sy >= 47) continue;
      const k = (sy * 22 + sx) * 4; if (d[k + 3] < 128) continue;
      q.fillStyle = `rgb(${d[k]},${d[k + 1]},${d[k + 2]})`; q.fillRect(i * n + x, y, 1, 1);
    }
  }
  return {img, em: null, w: n, h: n, frames};
}
// THE BEAR TRAP: 0 open (two flat iron half-rings, teeth up, the pan in the middle, springs out to the sides, a chain),
// 1 shut (the jaws up, teeth meshed). Dark outlines: it must read on grey flagstones
function trapSheet() {
  const w = 25, h = 14, [img, q] = canvas(w * 2, h), I = ['#f2f4f8', '#b4b8c2', '#7a7e88', '#4a4c54', '#1e1e24'];
  // open: a ring 21 x 7 lying on the ground (its centre a little above the cell's bottom)
  const cx = 12, cy = 9;
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    px(q, Math.round(cx + c * 10.5), Math.round(cy + sn * 3.9), I[4]);   // the outline
  }
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    px(q, Math.round(cx + c * 9.5), Math.round(cy + sn * 3.2), sn > .2 ? I[1] : I[2]);
    px(q, Math.round(cx + c * 8.6), Math.round(cy + sn * 2.6), sn > .2 ? I[2] : I[3]);
  }
  for (let i = 0; i < 14; i++) {   // teeth on the inner edge, pointing up
    const a = (i + .5) / 14 * Math.PI * 2, x = Math.round(cx + Math.cos(a) * 7.4), y = Math.round(cy + Math.sin(a) * 2.1);
    px(q, x, y - 2, I[0]); px(q, x, y - 1, I[1]); px(q, x, y, I[3]);
  }
  px(q, cx - 3, cy, I[4], 7, 2); px(q, cx - 3, cy - 1, I[2], 7, 1); px(q, cx - 2, cy - 1, I[1], 3, 1);   // the pan
  px(q, 0, cy - 1, I[4], 2, 3); px(q, 0, cy, I[2], 2, 1); px(q, w - 2, cy - 1, I[4], 2, 3); px(q, w - 2, cy, I[2], 2, 1);   // the springs' ends
  for (let i = 0; i < 4; i++) px(q, w - 4 + (i & 1), cy + 2 + i, i & 1 ? I[2] : I[3]);   // a chain, to its stake
  // shut: an arch of iron, the two jaws' teeth meshing along the top, outlined
  const o = w;
  for (let y = 0; y < 12; y++) {
    const hw = Math.round(Math.sqrt(Math.max(0, 1 - ((11 - y) / 11.5) ** 2)) * 9);
    if (hw < 1) continue;
    px(q, o + 12 - hw - 1, y + 1, I[4], hw * 2 + 3, 1);
    px(q, o + 12 - hw, y + 1, I[2], hw * 2 + 1, 1); px(q, o + 12 - hw, y + 1, I[1], 2, 1); px(q, o + 12 + hw - 1, y + 1, I[3], 2, 1);
  }
  for (let i = 0; i < 8; i++) { px(q, o + 5 + i * 2, 2 + (i % 2), I[0]); px(q, o + 6 + i * 2, 3 - (i % 2), I[0]); px(q, o + 5 + i * 2, 4, I[3]); }
  px(q, o + 2, 12, I[4], 21, 2); px(q, o + 3, 12, I[3], 19, 1); px(q, o + 6, 8, I[4], 13, 1);
  return {img, em: null, w, h, frames: 2};
}
// THE CACHE: an iron-bound wooden crate on a stone step, brass at the corners; open: the lid back, the inside dark
function cacheSheet() {
  const w = 24, h = 26, [img, q] = canvas(w * 2, h), [em, e] = canvas(w * 2, h);
  const WD = ['#b07a44', '#9a6a3a', '#7a4e2a', '#5a3820'], ST = ['#bcb8b2', '#9a9690', '#76726e', '#56524f'], BR = ['#ffe08a', '#e8c060', '#a8823a'], IR = '#3a3a42';
  for (let f = 0; f < 2; f++) {
    const o = f * w;
    px(q, o + 1, 21, ST[1], 22, 1); px(q, o + 1, 22, ST[2], 22, 3); px(q, o + 1, 25, ST[3], 22, 1); px(q, o + 2, 21, ST[0], 6, 1);   // the step
    for (let y = 10; y < 21; y++) { const pl = (y - 10) % 4; px(q, o + 3, y, pl === 3 ? WD[3] : pl === 0 ? WD[0] : WD[1], 18, 1); px(q, o + 19, y, WD[2], 2, 1); }   // planks
    for (const x of [7, 16]) { px(q, o + x, 10, IR, 1, 11); }   // iron bands
    px(q, o + 3, 10, BR[1], 2, 2); px(q, o + 19, 10, BR[1], 2, 2); px(q, o + 3, 19, BR[2], 2, 2); px(q, o + 19, 19, BR[2], 2, 2);   // brass corners
    if (f === 0) {   // the lid, shut, and the lock
      px(q, o + 2, 6, WD[2], 20, 4); px(q, o + 2, 6, WD[1], 20, 1); px(q, o + 2, 9, WD[3], 20, 1);
      px(q, o + 7, 6, IR, 1, 4); px(q, o + 16, 6, IR, 1, 4);
      px(q, o + 11, 9, BR[1], 2, 3); px(q, o + 11, 9, BR[0], 1, 1); px(e, o + 11, 9, '#7a5a10', 2, 3);
    } else {         // open: the lid thrown back, the dark inside, nothing in it
      px(q, o + 2, 1, WD[2], 20, 4); px(q, o + 2, 1, WD[1], 20, 1); px(q, o + 7, 1, IR, 1, 4); px(q, o + 16, 1, IR, 1, 4);
      px(q, o + 3, 5, WD[3], 18, 2); px(q, o + 4, 7, '#1c140e', 16, 3); px(q, o + 3, 7, WD[2], 1, 3); px(q, o + 20, 7, WD[2], 1, 3);
    }
  }
  return {img, em, w, h, frames: 2};
}

export function paintArt() {
  return {
    flask: turned(MAPS.flask, 12, 8), dynamite: turned(MAPS.dynamite, 14, 8), smoke: turned(MAPS.smoke, 10, 8), hook: turned(MAPS.hook, 12, 8),
    crow: crowSheet(), crow8: crowTurned(), trap: trapSheet(), cache: cacheSheet(),
  };
}
