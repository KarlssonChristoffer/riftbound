// FORGE CORE: turn (recipe, case, seed) into a finished, measured sound. Used by the forge CLI (Node), the lab page and,
// later, the runtime's bake Worker. See docs/AUDIO.md §2 and recipes/index.js for the recipe contract.
//
//   bake(recipe, caseName, seed, sr) -> {ch: Float32Array | [L, R], metrics, check: {pass, fails}, gainDb}
//     1. render: recipe.render(params, rng, sr) with params = {...defaults, ...recipe.cases[caseName]}
//     2. clean: DC block (circular for loops), trim trailing silence below -80 dB (not for loops), 1 ms / 20 ms fades (not for loops)
//     3. level: scale so the momentary-max loudness hits recipe.lufs (default -20 LUFS), then pull down if the true
//        peak would pass -1 dBTP. Equal loudness makes A/B comparisons fair; the runtime mixes with event gains.
//     4. measure (metrics.js) and check the case's pass criteria
//   defaults(recipe) -> params with every param at its default

import {makeRng, dcBlock, trim, fades, dbToGain} from './dsp.js';
import {analyze, check, lufsMomentaryMax} from './metrics.js';

export function defaults(recipe) {
  const p = {};
  for (const [k, d] of Object.entries(recipe.params || {})) p[k] = d.def ?? (d.values ? d.values[0] : d.min ?? 0);
  return p;
}
export function bake(recipe, caseName, seed = 1, sr = 48000) {
  const params = {...defaults(recipe), ...(recipe.cases?.[caseName] || {})};
  const R = makeRng(((seed * 2654435761) ^ hash(recipe.id + ':' + caseName)) >>> 0);
  let out = recipe.render(params, R, sr);
  let ch = Array.isArray(out) ? out : [out];
  if (!recipe.loop) {
    const len = Math.max(...ch.map(c => trim(c.slice(), sr, {thresh: -80, tailMs: 20}).length));
    ch = ch.map(c => fades(dcBlock(c.slice(0, len)), sr, 1, 20));   // -80 dB trim + 20 ms fade: no visible or audible end edge
  } else ch = ch.map(c => dcBlockLoop(c, sr));   // circular: no step at the wrap point
  const target = recipe.lufs ?? -20, cur = lufsMomentaryMax(ch.length === 1 ? ch[0] : ch, sr);
  let g = Number.isFinite(cur) ? dbToGain(target - cur) : 1;
  let tp = 0; for (const c of ch) for (let i = 0; i < c.length; i++) tp = Math.max(tp, Math.abs(c[i]));
  if (tp * g > dbToGain(-1.2)) g = dbToGain(-1.2) / tp;   // sample peak -1.2 dB leaves room for the inter-sample peak
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g;
  const res = ch.length === 1 ? ch[0] : ch, metrics = analyze(res, sr);
  return {ch: res, metrics, check: check(metrics, recipe.criteria?.[caseName] || recipe.criteria?.['*'] || {}), gainDb: +(20 * Math.log10(g)).toFixed(1), params};
}
// DC blocker for loops: warm the filter state on the last second first, so the start continues the end seamlessly
function dcBlockLoop(c, sr, r = .995) {
  let x1 = 0, y1 = 0; const w = Math.min(c.length, sr);
  for (let i = c.length - w; i < c.length; i++) { const y = c[i] - x1 + r * y1; x1 = c[i]; y1 = y; }
  for (let i = 0; i < c.length; i++) { const y = c[i] - x1 + r * y1; x1 = c[i]; y1 = y; c[i] = y; }
  return c;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
