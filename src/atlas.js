// ATLAS: loads a loadout from its PACKED sheets (tools/pack_atlas.py: ~8 files instead of ~1000, seconds instead of
// ~40 s) and returns exactly what player.js loadSet returns: {idx, SP, CLIP, OV, rig}, SP[pose] = {img, nrm, depth,
// bones, sim}. Each pose's sheet / normals / depth is an ImageBitmap cut from the big sheet, so everything that draws
// SP[pose].img (the host, cloth.js, the pixel bow) works unchanged.
// Falls back to player.js loadSet (the slow per-file path) when the pack is missing or older than poses.json.
import {loadSet} from './sim/player/player.js';

const loadImg = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error(src)); i.src = src; });
async function sha1(text) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
const cache = {};
export async function loadAtlas(root, opts = {}) {
  if (cache[root]) return cache[root];
  const p = (async () => {
    const [idxText, packed] = await Promise.all([
      fetch(root + 'poses.json').then(r => r.text()),
      fetch(root + 'packed/packed.json').then(r => r.ok ? r.json() : null).catch(() => null)]);
    if (!packed || packed.sig !== await sha1(idxText)) {
      console.warn(`atlas ${root}: no fresh pack (run: python tools/pack_atlas.py ${root.replace(/^\.\.\//, 'concepts/')}) - slow per-file load`);
      return {...await loadSet(root, opts), packed: false};
    }
    const idx = JSON.parse(idxText), {w, h, sheets, depth} = packed;
    const layers = ['albedo', 'normals', ...(depth ? ['depth'] : [])];
    const imgs = await Promise.all(Array.from({length: sheets}, (_, k) => Promise.all(layers.map(t => loadImg(`${root}packed/${t}_${k}.png`)))));
    // poses are cut out of the big sheets LAZILY, on first use, into their own small canvas (~0.1 ms each). Cutting all
    // 255 x 3 up front took ~8 s and ~380 MB; a session only ever shows a few dozen poses.
    const SP = {};
    const cut = (img, r, read) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d', read ? {willReadFrequently: true} : undefined); q.drawImage(img, 0, r * h, w, h, 0, 0, w, h); return c; };
    for (const name of idx.poses) {
      const [k, r] = packed.poses[name], set = imgs[k], m = packed.meta[name], memo = {};
      const lazy = (i, read) => () => memo[i] ??= set[i] ? cut(set[i], r, read) : null;
      const gi = lazy(0), gn = lazy(1), gd = lazy(2, true);
      SP[name] = {bones: m.bones, sim: m.sim, get img() { return gi(); }, get nrm() { return gn(); }, get depth() { return depth ? gd() : null; }};
    }
    for (const c of Object.values(idx.clips)) if (c.advance) { c.cum = [0]; c.advance.forEach((a, i) => c.cum.push(c.cum[i] + a)); }   // as loadSet
    const OV = await fetch(root + 'overlays.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
    const rig = opts.ClothRig && idx.sim ? new opts.ClothRig(idx) : {active: false, update() {}, draw() {}, reset() {}};
    return {idx, SP, CLIP: idx.clips, OV, rig, packed: true};
  })();
  return (cache[root] = p);
}
