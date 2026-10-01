// BAKE WORKER: runs forge recipes off the main thread (docs/AUDIO.md §2.1, audio/runtime/CONTRACT.md).
// Module worker, created by bakery.js. One message = one job = one (recipe, case) with all its seeds.
//
//   in : {type: 'bake', id, recipe, case, seeds: number[] | null, variants: number | null, sr}
//   out: {type: 'done', id, recipe, case, version, loop, seeds, ch: Float32Array[][] (per variant, per channel),
//         metrics: [{...analyze(), gainDb, pass}], ms}                     (every channel buffer is transferred)
//        {type: 'error', id, msg}                                          (a recipe exception: only this job fails)
import {bake} from '../forge/forge.js';

const mods = new Map();   // recipe id -> Promise<recipe>
function load(id) {
  if (!/^[a-z0-9_]+$/i.test(id)) return Promise.reject(new Error(`bad recipe id '${id}'`));
  if (!mods.has(id)) {
    const p = import(`../forge/recipes/${id}.js`).then(m => {
      if (!m.default || typeof m.default.render !== 'function') throw new Error(`recipe '${id}' has no default export with render()`);
      return m.default;
    });
    p.catch(() => mods.delete(id));   // a failed import can be retried later
    mods.set(id, p);
  }
  return mods.get(id);
}
// a channel we can transfer on its own: not a view into a bigger (or shared) buffer
const own = c => (c.byteOffset === 0 && c.byteLength === c.buffer.byteLength) ? c : c.slice();

self.onmessage = async ({data: m}) => {
  if (!m || m.type !== 'bake') return;
  const t0 = performance.now();
  try {
    const r = await load(m.recipe);
    if (r.cases && !(m.case in r.cases)) throw new Error(`recipe '${m.recipe}' has no case '${m.case}'`);
    const n = m.variants ?? r.variants ?? 6;
    const seeds = m.seeds?.length ? m.seeds : Array.from({length: n}, (_, i) => i + 1);
    const ch = [], metrics = [], transfer = [], seen = new Set();
    for (const s of seeds) {
      const o = bake(r, m.case, s, m.sr);
      const chans = (Array.isArray(o.ch) ? o.ch : [o.ch]).map(c => {
        let x = own(c);
        if (seen.has(x.buffer)) x = x.slice();   // two channels sharing a buffer can't both be transferred
        seen.add(x.buffer); transfer.push(x.buffer); return x;
      });
      ch.push(chans);
      const {onsets, ...mt} = o.metrics || {};   // onsets can be long and the runtime doesn't need them
      metrics.push({...mt, onsetCount: onsets?.length ?? 0, gainDb: o.gainDb, pass: o.check?.pass ?? true, fails: o.check?.fails});
    }
    self.postMessage({type: 'done', id: m.id, recipe: m.recipe, case: m.case, version: r.version ?? 0, loop: !!r.loop,
      seeds, ch, metrics, ms: performance.now() - t0}, transfer);
  } catch (e) {
    self.postMessage({type: 'error', id: m.id, msg: String(e?.stack || e?.message || e).split('\n').slice(0, 4).join('\n'), ms: performance.now() - t0});
  }
};
