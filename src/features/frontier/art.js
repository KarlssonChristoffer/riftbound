// FRONTIER ART: the pixel pictures of the frontier dressing (features/frontier.js), painted once, the first time the
// desert is entered, and kept for the feature's life (the renderer caches a texture per canvas): the lettering (a 3 x 5
// font), the wanted board's face (planks, two posters with pixel faces, "WANTED", the rewards), the signpost's boards
// (front and back, arrow tips), the water in the tanks, the cow skull and bones lying in the sand, the mine's lantern.
// Hash noise only (no Math.random): the same pictures every time. Colours come from the biome's style (wood, water) so
// the painted faces sit with the 3D wood toned by the same ramps; the paper, ink and bone are their own.
// 1 texel = 1 art px when the face is seen square on: a vertical face is PPM px a metre across, PPMH px a metre high.
//   const A = frontierArt(style)   -> {board, signs: {name: {front, back, w, h}}, moon, water, deep, skull, ribs, bone, lantern}
//   textWidth(s), text(P, s, x, y, col)
import {ART} from '../../world/biomes.js';
import {art} from '../../world/kit3d.js';

const {Pix, hex, hsh} = ART;

// ---------------------------------------------------------------- a 3 x 5 font (M and W five wide, N four)
const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'], G: ['.##', '#..', '#.#', '#.#', '.##'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'], M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  $: ['.##', '##.', '.#.', '.##', '##.'], 0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'], 5: ['###', '#..', '##.', '..#', '##.'], ' ': ['.', '.', '.', '.', '.'],
};
export const textWidth = s => [...s].reduce((w, ch, i) => w + (FONT[ch] || FONT[' '])[0].length + (i ? 1 : 0), 0);
export function text(P, s, x, y, col) {
  const c = hex(col);
  for (const ch of s) {
    const g = FONT[ch] || FONT[' '];
    g.forEach((row, j) => [...row].forEach((v, i) => { if (v === '#') P.c(x + i, y + j, c); }));
    x += g[0].length + 1;
  }
}

// ---------------------------------------------------------------- planks (the boards' wood, the biome's wood ramp)
// horizontal planks, h px each, a dark seam under every plank, grain streaks and the odd knot by hash, a lit top edge
function planks(P, x0, y0, w, h, ph, W, seed) {
  for (let y = y0; y < y0 + h; y++) {
    const r = (y - y0) % ph, k = Math.floor((y - y0) / ph);
    for (let x = x0; x < x0 + w; x++) {
      let t = 1;
      if (r === ph - 1 && y < y0 + h - 1) t = 3;                                  // the seam
      else if (r === 0 && hsh(x, k, seed) < .55) t = 0;                           // the plank's lit edge
      else if (hsh(Math.floor(x / 4), y, seed + 1) < .16) t = 2;                  // grain
      if (t !== 3 && hsh(x, y, seed + 2) < .012) t = 3;                           // a nail hole / knot
      P.c(x, y, W[t]);
    }
  }
}

// ---------------------------------------------------------------- the wanted posters
const PAPER = ['#efe2bf', '#dccb9f', '#b8a47a'], INK = '#3a2a1f', RED = '#9c3427';
// faces (10 x 10): O outline, h hat, H hat band, s skin, z skin shade, e eye, m mustache / beard, k kerchief, K its shade
const FACES = [
  ['..OOOOOO..', '.OhhhhhhO.', '.OhhhHHhO.', 'OhhhhhhhhO', '.OssssszO.', '.OsessezO.', '.OsssszzO.', '.OmmmmmmO.', '.OkkkkKKO.', 'OkkkkkkKKO'],
  ['...OOOO...', '..OhhhhO..', '.OOHHHHOO.', 'OhhhhhhhhO', '.OszssszO.', '.OsesesO..', '.OsmmmmzO.', '.OmmmmmmO.', '..OmmmmO..', '.OkkKKkkO.'],
];
const FACE_KEY = {O: INK, h: '#4a3628', H: '#7a2e24', s: '#d0a07a', z: '#a8785a', e: INK, m: '#5a3e2c', k: '#8a3a2c', K: '#6a2a20'};
function poster(P, x0, y0, w, h, face, reward, title) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    P.c(x0 + x, y0 + y, hex(edge ? PAPER[2] : hsh(x, y, 61) < .07 ? PAPER[1] : PAPER[0]));
  }
  // rows: [title 5 + 1 | small print 1 + 1], the face 10, the name 1 + 1, the reward 5, the bottom edge: h = 26 / 22
  let y = y0 + 2;
  if (title) { text(P, title, x0 + Math.floor((w - textWidth(title)) / 2), y, INK); y += 6; }
  else { for (let x = x0 + 3; x < x0 + w - 3; x++) if (hsh(x, 3, 62) < .7) P.c(x, y, hex(INK)); y += 2; }   // small print
  const F = FACES[face], fx = x0 + Math.floor((w - 10) / 2);
  F.forEach((row, j) => [...row].forEach((v, i) => { if (FACE_KEY[v]) P.c(fx + i, y + j, hex(FACE_KEY[v])); }));
  y += 10;
  for (let x = x0 + 3; x < x0 + w - 3; x++) if (hsh(x, 9, 63) < .75) P.c(x, y, hex('#6a5a44'));   // the name, in small print
  y += 2;
  text(P, reward, x0 + Math.floor((w - textWidth(reward)) / 2), y, RED);
  // a nail at the top corners, a corner curled (the paper's back shows)
  P.c(x0 + 1, y0 + 1, hex('#2e241c')); P.c(x0 + w - 2, y0 + 1, hex('#2e241c'));
  P.c(x0 + w - 1, y0 + h - 1, 0); P.c(x0 + w - 2, y0 + h - 1, hex(PAPER[2])); P.c(x0 + w - 1, y0 + h - 2, hex(PAPER[2]));
}

// ---------------------------------------------------------------- the signpost's boards
// a board with lettering; tip 'L' / 'R': the arrow's point at that end (a 45 degree point, half the height long)
function signBoard(str, W, ink, tip, pad = 2) {
  const h = 7, tw = textWidth(str), tl = tip ? 3 : 0, w = tw + pad * 2 + tl, P = new Pix(w, h), x0 = tip === 'L' ? tl : 0;
  planks(P, x0, 0, w - tl, h, h, W, str.length * 7);
  for (let x = x0; x < x0 + w - tl; x++) { P.c(x, 0, W[0]); P.c(x, h - 1, W[2]); }
  if (tip) for (let y = 0; y < h; y++) {   // the point: rows shrink toward the tip
    const n = Math.max(0, tl - Math.abs(y - 3));
    for (let i = 0; i < n; i++) P.c(tip === 'R' ? w - tl + i : tl - 1 - i, y, W[y < 3 ? 1 : 2]);
  }
  text(P, str, x0 + pad + (tip === 'L' ? 0 : 0), 1, ink);
  return {cv: P.canvas(), w, h};
}

// ---------------------------------------------------------------- water seen from above (a stock tank, a trough, a well)
function waterTex(Wr, n, deep) {
  const P = new Pix(n, n), c = Wr.map(hex);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = hsh(Math.floor(x / 4), y, 71 + n);   // calm: the dark of the water, a few ripples, the odd glint
    P.c(x, y, deep ? (v < .06 ? c[2] : c[3]) : v < .025 ? c[1] : v < .1 ? c[2] : c[3]);
  }
  return P.canvas();
}

// ---------------------------------------------------------------- bones (cards: they lie in the sand, they face you)
const BONE = {O: '#5a4a36', b: '#f1e8d2', B: '#d8cbab', d: '#b4a27e', S: '#3a2e24', h: '#e2d6b8', H: '#8a7656'};
const SKULL = [
  'OO.............OO',
  'OhO...........OhO',
  '.OhO..OOOOO..OhO.',
  '..OhOObbbbbOOhO..',
  '...OObbbbbbbOO...',
  '....ObSSbSSdO....',
  '....ObSSbSSdO....',
  '.....ObbbbdO.....',
  '.....ObbBbdO.....',
  '......ObBdO......',
  '......OSbSO......',
  '.......OOO.......',
];
const RIBS = [
  '..O.O.O.O.....',
  '.ObObObObO....',
  '.ObObObObOOO..',
  'ObbBbBbBbbbbO.',
  '.ObObObObOOO..',
  '..ObObObO.....',
  '...O.O.O......',
];
const LONG = ['.OO......OO.', 'ObbBBBBBBbdO', '.OO......OO.'];

// ---------------------------------------------------------------- the moon cut in the outhouse's door (dark: the inside)
const MOON = ['..###.', '.##...', '##....', '##....', '##....', '.##...', '..###.'];

// ---------------------------------------------------------------- the lantern (glass = emissive)
const LAN = ['..O..', '.OmO.', 'OmmmO', 'OgggO', 'OgGgO', 'OgggO', 'OmmmO', '.OOO.'];

export function frontierArt(S) {
  const W = S.wood.h.map(hex), WR = S.water.h;
  // the wanted board's face: 49 x 30 px (1.6 x 1.05 m), planks, two posters, nails
  const board = new Pix(49, 30);
  planks(board, 0, 0, 49, 30, 8, W, 51);
  poster(board, 2, 2, 28, 26, 0, '$500', 'WANTED');
  poster(board, 32, 4, 15, 22, 1, '$200', null);
  // the signpost: name -> {front, back} canvases (the back reads right way round from behind: the tip swaps ends)
  const signs = {};
  for (const [name, str, tip, ink] of [['top', 'RED MESA', null, '#7c2a1e'], ['fort', 'FORT', 'L', INK], ['mesa', 'MESA', 'R', INK], ['canyon', 'CANYON', 'R', INK]]) {
    const f = signBoard(str, W, ink, tip), b = signBoard(str, W, ink, tip === 'L' ? 'R' : tip === 'R' ? 'L' : null);
    signs[name] = {front: f.cv, back: b.cv, w: f.w, h: f.h};
  }
  const bones = (rows, pivot) => { const A = art(rows, BONE); return {cv: A.P.canvas(), w: A.W, h: A.H, px: pivot ? pivot[0] : A.W >> 1, py: pivot ? pivot[1] : A.H - 1}; };
  const LM = ART.ramp('#a08650', '#7a6438', '#56452a', '#352a1c');
  const L = art(LAN, {O: '#241a14', m: [LM, 1], g: {emit: true, c: '#ffe0a0', base: '#c89040'}, G: {emit: true, c: '#ffffff', base: '#e0b060'}});
  return {
    board: board.canvas(), signs, moon: art(MOON, {'#': '#2a2018'}).P.canvas(),
    water: waterTex(WR, 48, false), deep: waterTex(WR, 24, true),
    skull: bones(SKULL), ribs: bones(RIBS), bone: bones(LONG),
    lantern: {cv: L.P.canvas(), em: L.E.canvas(), w: L.W, h: L.H, px: 2, py: 0},
  };
}
