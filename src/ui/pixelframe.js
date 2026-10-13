// PIXEL FRAMES: the pixel-art UI's frames (dev/wardrobe.js, ui/gearpanel.js, ui/geartip.js): a 9-slice image painted in code
// (rings from the outside in: [top-left, bottom-right], then the fill), its outer corner pixels cut (a pixel-rounded corner).
// Painted once each, as CSS url()s a border-image stretches by whole UI pixels (image-rendering: pixelated).
// API: frame9(rings, fill) -> 'url(data:...)'; FRAMES.<name>() the shared set (panel, btn, hot, down, on, card, well); DK the ink.
//   uiUnit() -> css px a UI pixel by the window's height (2 at 1080, 3 at 1440, 4 at 2160).
export const DK = '#0c0907';

export function frame9(rings, fill) {
  const n = rings.length, N = 2 * n + 1, c = document.createElement('canvas'); c.width = c.height = N;
  const q = c.getContext('2d');
  q.fillStyle = fill; q.fillRect(n, n, 1, 1);
  rings.forEach(([tl, br], k) => {
    const a = k, b = N - 1 - k, L = b - a + 1;
    q.fillStyle = tl; q.fillRect(a, a, L, 1); q.fillRect(a, a, 1, L);
    q.fillStyle = br; q.fillRect(a, b, L, 1); q.fillRect(b, a, 1, L);
  });
  for (const [x, y] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) q.clearRect(x, y, 1, 1);
  return `url(${c.toDataURL()})`;
}

const made = {};
const once = (k, f) => () => made[k] ??= f();
export const FRAMES = {
  panel: once('panel', () => frame9([[DK, DK], ['#7a5f3e', '#2e2218'], ['#3a2c1e', '#241b13']], '#1e1812')),
  btn: once('btn', () => frame9([[DK, DK], ['#8a6c47', '#3a2b1d']], '#45341f')),
  hot: once('hot', () => frame9([[DK, DK], ['#b08c5c', '#4a3826']], '#58432a')),
  down: once('down', () => frame9([[DK, DK], ['#2a1f15', '#8a6c47']], '#3a2c1e')),
  on: once('on', () => frame9([[DK, DK], ['#ffe08a', '#a3762a']], '#6e5222')),
  card: once('card', () => frame9([[DK, DK], ['#5e4a32', '#2a1f15']], '#2a2018')),
  well: once('well', () => frame9([[DK, DK], ['#140f0b', '#4e3d2a']], '#15100c')),
};

export const uiUnit = () => Math.max(2, Math.min(5, Math.round(innerHeight / 480)));
