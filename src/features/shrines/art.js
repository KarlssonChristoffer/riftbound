// SHRINES' PIXEL ART (features/shrines.js): each shrine's floating glyph (lit: an emissive sigil in its colour; spent: the
// same sigil in grey stone, cracked in two and slumped), the Altar of Exchange's floating rift crystal (lit / dead), the
// trader's lantern (lit / out), as one sprite sheet (albedo + emit, kit3d.pack) for host.sprite. Built once, at the first
// draw: nothing here depends on the biome. The shapes are drawn without their outline; outline() adds the dark rim.
//   buildArt() -> {img, em, fr: {name: {sx, sy, sw, sh, px, py}}}   names: '<type>' / '<type>_spent', 'crystal' /
//   'crystal_dead', 'lantern' / 'lantern_out'
import {art, pack} from '../../world/kit3d.js';

// the sigils' fills: a = the body, W = its highlight, b = its shade (all three glow), p / h = dark, unlit details
export const GLYPHS = {
  // a die stood on its corner: three pips
  chance: [
    '.....W.....',
    '....WaW....',
    '...WaaaW...',
    '..WapaaaW..',
    '.WaaaaaaaW.',
    'Waaaapaaaab',
    '.aaaaaaaab.',
    '..aaaapab..',
    '...aaabb...',
    '....abb....',
    '.....b.....'],
  // two swords crossed, hilts down
  combat: [
    '...........',
    '.W.......W.',
    '..a.....a..',
    '...a...a...',
    '....a.a....',
    '.....a.....',
    '..b.a.a.b..',
    '...b...b...',
    '..h.b.b.h..',
    '.W.......W.'],
  // a drop of blood
  blood: [
    '.....a.....',
    '.....a.....',
    '....aaa....',
    '....aWa....',
    '...aWaaa...',
    '..aWaaaaa..',
    '..aaaaaaa..',
    '..aaaaaab..',
    '..aaaaabb..',
    '...abbbb...',
    '....bbb....'],
  // a snow-capped peak and its shoulder
  mountain: [
    '.....W.....',
    '....WWW....',
    '...WWaWW...',
    '..WaaaaaW..',
    '..aaaaaaa.W',
    '.aaaaaaaaWW',
    '.aaaabaaaaW',
    'aaaabbbaaaa',
    'aaabbbbbaaa'],
  // two arrows, one each way
  exchange: [
    '......a....',
    '......aa...',
    '.aWaaaaaa..',
    '......aa...',
    '......a....',
    '...........',
    '....b......',
    '...bb......',
    '..bbbbbbWb.',
    '...bb......',
    '....b......'],
  // a tied purse
  trader: [
    '....bbb....',
    '.....a.....',
    '....bbb....',
    '...aaaaa...',
    '..aaWaaaa..',
    '.aaWaaaaaa.',
    '.aaaaaaaab.',
    '.aaaaaaabb.',
    '..aaaaabb..',
    '...bbbbb...'],
};
// each sigil's glow: [highlight, body, shade]
export const GLOW = {
  chance: ['#fff4c0', '#ffcf4a', '#d0902a'],
  combat: ['#ffe2c8', '#ff7448', '#c8381e'],
  blood: ['#ffd0d8', '#ff3a52', '#a8102a'],
  mountain: ['#ffffff', '#b8e2ff', '#6a9ad8'],
  exchange: ['#f6e4ff', '#c890ff', '#7a48d0'],
  trader: ['#fff0c8', '#ffc060', '#b07a2a'],
};
const CRYSTAL = [
  '...W...',
  '..WaW..',
  '..Waa..',
  '.WWaab.',
  '.Waaab.',
  'Waaaabb',
  'Waaaabb',
  '.aaaab.',
  '.aaabb.',
  '..aab..',
  '..abb..',
  '...b...'];
const LANTERN = ['..m..', '.mmm.', 'mgggm', 'mgWgm', 'mgggm', 'mmmmm'];
const OUT = '#1c1618', GREY = ['#a49e96', '#7c7670', '#56514c'];

// pad by 1 px, then a dark rim round everything drawn (4-neighbours)
function outline(rows) {
  const W = Math.max(...rows.map(r => r.length)) + 2, g = ['.'.repeat(W), ...rows.map(r => '.' + r.padEnd(W - 2, '.') + '.'), '.'.repeat(W)].map(r => [...r]);
  const H = g.length, at = (x, y) => x >= 0 && y >= 0 && x < W && y < H ? g[y][x] : '.';
  const out = g.map(r => r.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== '.') continue;
    const n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    if (n.some(c => c !== '.' && c !== 'O')) out[y][x] = 'O';
  }
  return out.map(r => r.join(''));
}
// spent: split along a zigzag crack down the middle, the right half slumped a pixel
function cracked(rows) {
  const W = Math.max(...rows.map(r => r.length)), H = rows.length, c0 = Math.floor(W / 2);
  const g = Array.from({length: H + 1}, () => Array(W).fill('.'));
  for (let y = 0; y < H; y++) {
    const cx = c0 + (y % 3 === 1 ? 1 : y % 3 === 2 ? 0 : -1);
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x] || '.'; if (ch === '.' || x === cx) continue;
      if (x < cx) g[y][x] = ch; else g[y + 1][x] = ch;
    }
  }
  return g.map(r => r.join(''));
}
const lit = ([hi, mid, lo]) => ({O: OUT, W: {emit: true, c: hi, base: mid}, a: {emit: true, c: mid, base: lo}, b: {emit: true, c: lo, base: lo},
  p: '#3a2410', h: '#5a3a22'});
const dead = {O: OUT, W: GREY[0], a: GREY[1], b: GREY[2], p: '#2e2a28', h: '#3a3432'};

export function buildArt() {
  const items = [], add = (name, rows, key, pivot) => { const A = art(rows, key); items.push({name, img: A.P.canvas(), em: A.E.used ? A.E.canvas() : null, pivot: pivot(A)}); };
  const mid = A => [A.W >> 1, A.H >> 1];   // (glyphs and the crystal hang by their middle)
  for (const [k, rows] of Object.entries(GLYPHS)) {
    add(k, outline(rows), lit(GLOW[k]), mid);
    add(k + '_spent', outline(cracked(rows)), dead, mid);
  }
  add('crystal', outline(CRYSTAL), lit(['#fbf0ff', '#c890ff', '#6a3ac0']), mid);
  add('crystal_dead', outline(cracked(CRYSTAL)), {O: OUT, W: '#5a5068', a: '#423a4e', b: '#2c2636'}, mid);
  const LK = {m: '#4a3a26', g: {emit: true, c: '#ffd890', base: '#c89040'}, W: {emit: true, c: '#ffffff', base: '#e0b060'}};
  add('lantern', outline(LANTERN), LK, A => [A.W >> 1, 0]);
  add('lantern_out', outline(LANTERN), {m: '#4a3a26', g: '#3a3430', W: '#4a4440'}, A => [A.W >> 1, 0]);
  return pack(items, 256);
}
