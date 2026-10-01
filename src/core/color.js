// COLOR: colour parsing, one copy each. Each takes '#rrggbb'; rgbOf / hexAny255 also take '#rgb' (and rgbOf passes
// arrays through). Parse at load or cache: never per particle per frame.
export const rgbOf = c => { if (Array.isArray(c)) return c; let s = String(c || '#fff').replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m); const n = parseInt(s, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };   // -> [r, g, b] 0..1
export const hex01 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };   // '#rrggbb' -> 0..1
export const hex255 = s => { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };   // '#rrggbb' -> 0..255
export const hexAny255 = h => { let s = String(h).replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m); const n = parseInt(s, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const hexU32 = s => { const n = parseInt(s.slice(1), 16); return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0; };   // '#rrggbb' -> ImageData u32 (ABGR)
export const hexRaw255 = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];   // 'rrggbb' (no #) -> 0..255
export const lum = c => c[0] * .3 + c[1] * .55 + c[2] * .15;   // the arena's luminance weights
