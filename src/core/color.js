// COLOR: colour parsing, one copy each. Each takes '#rrggbb'; rgbOf / hexAny255 also take '#rgb' (and rgbOf passes
// arrays through). Parse at load or cache: never per particle per frame.
export const rgbOf = c => { if (Array.isArray(c)) return c; let s = String(c || '#fff').replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m); const n = parseInt(s, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };   // -> [r, g, b] 0..1
export const hex01 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };   // '#rrggbb' -> 0..1
export const hex255 = s => { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };   // '#rrggbb' -> 0..255
export const hexAny255 = h => { let s = String(h).replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m); const n = parseInt(s, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const hexU32 = s => { const n = parseInt(s.slice(1), 16); return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0; };   // '#rrggbb' -> ImageData u32 (ABGR)
export const hexRaw255 = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];   // 'rrggbb' (no #) -> 0..255
export const lum = c => c[0] * .3 + c[1] * .55 + c[2] * .15;   // the arena's luminance weights

// any CSS colour -> [r, g, b, a] 0..1, as a canvas reads it (alpha in 1/255 steps): '#rgb' / '#rrggbb' and 'rgb(a)(...)'
// read here, anything else by a scratch canvas's own parser. Cached per string (a fresh string each frame: one parse)
const CSS_HEX = /^#([\da-f]{3}|[\da-f]{6})$/i, CSS_RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/, cssC = new Map();
let cssQ = null;
export function cssRGBA(s) {
  let c = cssC.get(s); if (c) return c;
  let m = CSS_RGB.exec(s), h = m || !CSS_HEX.test(s) ? null : s;
  if (!m && !h) { cssQ ??= document.createElement('canvas').getContext('2d'); cssQ.fillStyle = '#000'; cssQ.fillStyle = s; m = CSS_RGB.exec(cssQ.fillStyle); if (!m) h = cssQ.fillStyle; }
  if (m) c = [Math.round(+m[1]) / 255, Math.round(+m[2]) / 255, Math.round(+m[3]) / 255, Math.round(Math.min(1, m[4] === undefined ? 1 : +m[4]) * 255) / 255];
  else {
    let x = h.slice(1); if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
    const v = parseInt(x, 16); c = [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255, 1];
  }
  if (cssC.size > 1024) cssC.clear();
  cssC.set(s, c); return c;
}
