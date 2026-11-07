// HD PIXEL: the pixel-art UI a feature draws on the HD layer (its hd(q, sc) pass: the display-resolution 2D canvas over the
// game): frames and text in whole UI pixels, the pixel font (ui/pixelfont.js 'RiftPixel'). Shared by fishing (the prompt,
// the meter, the gauge, the catch card), meals (the timer chip), foraging and mining (their prompts).
//   hdUnit() -> display px a UI pixel (by the window's height and the device's pixel ratio)
//   hdFontOK() -> the pixel font is loaded (asked for at the first call); hdFont(u, k = 1, fb) -> a canvas font string: k x 10 u
//   px of RiftPixel, else the fallback (fb: '7u ui-monospace')
//   hdFrame(q, x, y, w, h, u, hot?) a pixel frame (ui/pixelframe.js panel's rings); hdText(q, s, x, y, u, col, align?) the pixel
//   font with a one-pixel ink shadow
// OWNS: nothing but the font's loaded flag. BUDGET: a few fillRects a call; no allocation but the font string.
import {loadPixelFont} from './pixelfont.js';

export const INK = '#0c0907', PANEL = '#1e1812', EDGE_HI = '#7a5f3e', EDGE_LO = '#2e2218';
let fontOK = false, asked = false;
export function hdFontOK() { if (!asked) { asked = true; loadPixelFont().then(f => { fontOK = !!f; }, () => {}); } return fontOK; }
export const hdUnit = () => Math.max(2, Math.round(innerHeight / 480)) * Math.max(1, Math.round(devicePixelRatio || 1));
export const hdFont = (u, k = 1) => hdFontOK() ? `${10 * k * u}px RiftPixel` : `${7 * k * u}px ui-monospace, monospace`;
export function hdFrame(q, x, y, w, h, u, hot = false) {   // whole UI pixels: ink, a lit and a shaded ring, the fill
  q.fillStyle = INK; q.fillRect(x + u, y, w - 2 * u, h); q.fillRect(x, y + u, w, h - 2 * u);
  q.fillStyle = hot ? '#e2644d' : EDGE_HI; q.fillRect(x + u, y + u, w - 2 * u, u); q.fillRect(x + u, y + u, u, h - 2 * u);
  q.fillStyle = hot ? '#852c24' : EDGE_LO; q.fillRect(x + u, y + h - 2 * u, w - 2 * u, u); q.fillRect(x + w - 2 * u, y + u, u, h - 2 * u);
  q.fillStyle = PANEL; q.fillRect(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u);
}
export function hdText(q, s, x, y, u, col, align = 'left') {   // (10 u = a glyph's 10 rows)
  q.font = hdFont(u); q.textAlign = align; q.textBaseline = 'alphabetic';
  q.fillStyle = INK; q.fillText(s, x + u, y + u); q.fillStyle = col; q.fillText(s, x, y);
}
// a one-line prompt in a pixel frame, centred on (x, y) (its bottom edge at y): the foraging and mining prompts' look
export function hdPrompt(q, s, x, y, u, col) {
  q.font = hdFont(u);
  const w = Math.ceil(q.measureText(s).width / u) * u + 8 * u;
  hdFrame(q, Math.round(x - w / 2), y - 13 * u, w, 13 * u, u);
  hdText(q, s, Math.round(x), y - 4 * u, u, col, 'center');
}
