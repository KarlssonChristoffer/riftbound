// ATLAS: loads a loadout from its PACKED sheets (tools/pack_atlas.py: ~8 files instead of ~1000, seconds instead of
// ~40 s) and returns exactly what player.js loadSet returns: {idx, SP, CLIP, OV, rig}, SP[pose] = {img, nrm, depth,
// bones, sim}. Each pose's sheet / normals / depth is a canvas cut from the big sheet, so everything that draws
// SP[pose].img (the host, cloth.js, the pixel bow) works unchanged; set.warm(names) cuts them ahead (see warm below).
// Falls back to player.js loadSet (the slow per-file path) when the pack is missing or older than poses.json.
import {loadSet} from '../sim/player/player.js';

const loadImg = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error(src)); i.src = src; });
async function sha1(text) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
const cache = {};
// one sheet decoded at a time across every atlas's warm() (each is ~50 MB decoded): the jobs queue up here
let warmQueue = Promise.resolve();
// a slice to cut in (ms): the idle time after a frame (up to 4 ms), or 2 ms within 20 ms whatever the page is doing (an
// uncapped or busy page has no idle time). A cut is ~0.2 ms: a slice stays inside a 164 Hz frame's slack
const idleSlice = () => new Promise(r => (window.requestIdleCallback || (f => setTimeout(() => f({didTimeout: true, timeRemaining: () => 0}), 16)))(
  d => r(d.didTimeout ? 2 : Math.max(1, Math.min(4, d.timeRemaining()))), {timeout: 20}));
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
    // poses are cut out of the big sheets into their own small canvas: warmed ahead (warm(), below) or LAZILY on first use.
    // Cutting all 255 x 3 up front on the main thread took ~8 s and ~380 MB. A pose's canvas is CPU-backed
    // (willReadFrequently): its readers (hero.compose, the hair, contact's masks, the cloth's depth, foes' corpse shadows)
    // read it on the CPU, where a GPU canvas costs a read-back that waits on the GPU; the renderer uploads it once (the
    // sheets' alpha is 0 or 255 and they carry no colour profile, so the pixels are the same either way)
    const SP = {}, memos = {};
    const cut = (src, r) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d', {willReadFrequently: true}).drawImage(src, 0, r * h, w, h, 0, 0, w, h); return c; };
    for (const name of idx.poses) {
      const [k, r] = packed.poses[name], set = imgs[k], m = packed.meta[name], memo = memos[name] = [];
      const lazy = i => () => memo[i] ??= set[i] ? cut(set[i], r) : null;
      const gi = lazy(0), gn = lazy(1), gd = lazy(2);
      SP[name] = {bones: m.bones, sim: m.sim, get img() { return gi(); }, get nrm() { return gn(); }, get depth() { return depth ? gd() : null; }};
    }
    // WARM: cut poses ahead of their first sight. A lazy cut from the big <img> pays for decoding its whole sheet (1536 x
    // 8160 px: ~30-50 ms on the main thread), and with a few dozen sheets in play (the player's, three gunmen's) Chrome's
    // decoded-image cache can't keep them: nearly every pose seen for the first time paid it again (a fight with 14
    // gunmen: frames of 30-470 ms). warm() decodes each sheet ONCE, off the main thread (its PNG as a blob ->
    // createImageBitmap), cuts the poses asked for out of it in idle slices (~0.1 ms each) and lets it go: one decoded
    // sheet at a time. A pose shown before its turn is cut lazily as before (the same pixels).
    //   set.warm(names, layers = [0, 1]) -> a promise (layers: 0 albedo, 1 normals, 2 depth); unknown names are skipped
    function warm(names, want = [0, 1]) {
      const by = new Map();   // sheet -> its poses asked for
      for (const n of names) { const p = packed.poses[n]; if (!p) continue; let a = by.get(p[0]); if (!a) by.set(p[0], a = []); a.push(n); }
      return (warmQueue = warmQueue.then(async () => {
        for (const [k, list] of by) for (const i of want) {
          if (i >= layers.length) continue;
          const need = list.filter(n => !memos[n][i]); if (!need.length) continue;
          let bm = null;
          try { bm = await createImageBitmap(await (await fetch(`${root}packed/${layers[i]}_${k}.png`)).blob()); } catch (e) { continue; }   // (lazy cuts cover it)
          for (let j = 0; j < need.length;) {
            const ms = await idleSlice(), t0 = performance.now();
            while (j < need.length && performance.now() - t0 < ms) {
              const n = need[j++]; if (memos[n][i]) continue;
              const c = memos[n][i] = cut(bm, packed.poses[n][1]);
              c.getContext('2d').getImageData(0, 0, 1, 1);   // (draws it now: a canvas only records the drawImage until it's read, holding the decoded sheet)
            }
          }
          bm.close();
        }
      }).catch(e => console.warn(`atlas ${root}: warm failed`, e)));
    }
    for (const c of Object.values(idx.clips)) if (c.advance) { c.cum = [0]; c.advance.forEach((a, i) => c.cum.push(c.cum[i] + a)); }   // as loadSet
    const OV = await fetch(root + 'overlays.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
    const rig = opts.ClothRig && idx.sim ? new opts.ClothRig(idx) : {active: false, update() {}, draw() {}, reset() {}};
    return {idx, SP, CLIP: idx.clips, OV, rig, packed: true, warm};
  })();
  return (cache[root] = p);
}
