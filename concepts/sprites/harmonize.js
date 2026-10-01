// HARMONIZE: step 1 of fitting the character into the environment (see out/integration/). BAKED into pixelize.py
// (palette_harm.py) on 2026-09-30; this stays as a runtime shim for atlases not re-pixelized yet (and their cloth
// colours): it only touches the OLD palette's colours, so baked sheets pass through unchanged. The environment's art rules (arena/biomes.js) are calm values, colour that
// stays in its own hue, and selective outlines. The character had near-black outlines, twice the saturation and
// the darkest masses on screen. This remaps every sprite pixel by its palette (family, tone):
//   tones 0-2   saturation x SAT[fam], highlight value x HI_V, shade lifted toward the base (SHADE_LIFT),
//               the dark 'char' family (pants) lifted as a whole (CHAR_V)
//   tone 3      interior lines / eyes: lifted a little toward the shade (LINE_LIFT)
//               exterior outline, lit side (empty pixel above or left of it: the light is top-left): the family's
//               SHADE tone; shadow side: the darkest tone lifted toward the shade (OUTLINE_LIFT)
// The runtime cloak (cloth.js) gets the same ramps (its outline has no sides: shadow-side colour).
//
//   import {harmonizeSet, setHarmonized} from './harmonize.js';
//   harmonizeSet(set)       // once per loaded set (idempotent): SP[p].img becomes a getter, cloth colours kept
//   setHarmonized(on)       // flips every harmonized set; sheets are converted lazily on first draw
export const HARM = {
  SAT: {default: .8, red: .92, hair: .72, skin: .9},
  HI_V: .94, SHADE_LIFT: .15, CHAR_V: 1.14, LINE_LIFT: .2, OUTLINE_LIFT: .42,
};
// the palette families: pixelize.py's master FAMS (out/ranger_master_layers.json) + the wardrobe's garment families
const FAMS = {
  skin: ['f4cfa0', 'e0a47a', 'b8755a', '6a3a34'], hair: ['b0703e', '84502e', '5c3522', '2e1a16'],
  red: ['d8573e', 'a8342b', '72222a', '3e1420'], green: ['9aaa62', '6c7e48', '4a5836', '283222'],
  leather: ['9a6c44', '6e4a2e', '4a3020', '261814'], char: ['5e5860', '423e48', '2e2b34', '18161c'],
  linen: ['efe4c8', 'cfbf9c', 'a08e70', '4a3e30'], cloth: ['8c6a4a', '6a4e36', '4a3626', '221812'],
  wood: ['c89a5e', '9a6c44', '6e4a2e', '2e1a16'],
};
const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
function hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx];
}
function rgb([h, s, v]) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const adjust = (c, sat, val) => { const [h, s, v] = hsv(c); return rgb([h, s * sat, Math.min(255, v * val)]).map(Math.round); };

// new ramp per family: [hi, base, shade, line, outlineShadow, outlineLit]
export function ramps() {
  const R = {};
  for (const [f, hs] of Object.entries(FAMS)) {
    const o = hs.map(hex), sat = HARM.SAT[f] ?? HARM.SAT.default, cv = f === 'char' ? HARM.CHAR_V : 1;
    const hi = adjust(o[0], sat, HARM.HI_V * cv), base = adjust(o[1], sat, cv), shade = adjust(mix(o[2], o[1], HARM.SHADE_LIFT), sat, cv);
    const dark = adjust(o[3], sat, 1);
    R[f] = [hi, base, shade, mix(dark, shade, HARM.LINE_LIFT).map(Math.round), mix(dark, shade, HARM.OUTLINE_LIFT).map(Math.round), shade];
  }
  return R;
}
let LUT = null;   // packed rgb -> [family, tone] (a colour shared by two families maps by the first: same look)
function lut() {
  if (LUT) return LUT;
  LUT = {map: new Map(), R: ramps()};
  for (const [f, hs] of Object.entries(FAMS)) hs.forEach((h, t) => { const [r, g, b] = hex(h), k = r << 16 | g << 8 | b; if (!LUT.map.has(k)) LUT.map.set(k, [f, t]); });
  return LUT;
}

export function harmonizeImage(img) {
  const {map, R} = lut(), w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const q = c.getContext('2d', {willReadFrequently: true}); q.drawImage(img, 0, 0);
  const id = q.getImageData(0, 0, w, h), D = id.data, A = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) A[i] = D[i * 4 + 3] ? 1 : 0;
  let changed = false;
  const empty = (x, y) => x < 0 || y < 0 || x >= w || y >= h || !A[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!A[i]) continue;
    const p = i * 4, hit = map.get(D[p] << 16 | D[p + 1] << 8 | D[p + 2]); if (!hit) continue;
    const [f, t] = hit, r = R[f];
    let col = r[t];
    if (t === 3) {
      const lit = empty(x - 1, y) || empty(x, y - 1), out = lit || empty(x + 1, y) || empty(x, y + 1);
      col = !out ? r[3] : lit ? r[5] : r[4];
    }
    D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2]; changed = true;
  }
  if (!changed) return img;   // an already baked sheet (pixelize.py now paints this palette): keep the original
  q.putImageData(id, 0, 0);
  return c;
}

const sets = [];
let ON = false;
export const isHarmonized = () => ON;
export function harmonizeSet(set) {
  if (set.harm) return set;
  const cloth = (set.rig?.cloths || []).map(C => ({C, orig: C.colours, harm: null}));
  const warm = [];
  for (const sp of Object.values(set.SP)) {
    const o = sp.img; let hImg = null;
    const get = () => (hImg ??= harmonizeImage(o));
    Object.defineProperty(sp, 'img', {configurable: true, enumerable: true, get: () => ON ? get() : o});
    warm.push(get);
  }
  set.harm = {cloth, warm};
  sets.push(set); applyCloth(set); if (ON) prewarm();
  return set;
}
// convert every sheet in the background (a few ms per slice), so the first sight of a pose doesn't hitch
let warming = false;
function prewarm() {
  if (warming) return; warming = true;
  const todo = sets.flatMap(s => s.harm.warm);
  const slice = () => { const t = performance.now(); while (todo.length && performance.now() - t < 6) todo.pop()();
    if (todo.length && ON) setTimeout(slice, 16); else warming = false; };
  setTimeout(slice, 0);
}
function applyCloth(set) {
  const R = lut().R;
  for (const e of set.harm.cloth) {
    const r = R[e.C.def?.fam] || null;
    e.harm ??= r ? [r[0], r[1], r[2], r[4]] : e.orig;
    e.C.colours = ON ? e.harm : e.orig;
  }
}
export function setHarmonized(on) { ON = !!on; for (const s of sets) applyCloth(s); if (ON) prewarm(); }
