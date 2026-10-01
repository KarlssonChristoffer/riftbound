// EXAMPLE recipe: the smallest complete use of the contract (recipes/index.js). A struck wooden bar: a half-sine
// contact excites beam modes (1 : 2.76 : 5.40 : 8.93), plus a short noise residue for the "knock".
import {buf, halfSine, modal, modesFrom, burst, add} from '../dsp.js';

export default {
  id: 'example', version: 1, desc: 'Struck wooden bar (contract example)',
  params: {f0: {min: 150, max: 900, def: 420}, hardness: {min: 0, max: 1, def: .6}},
  cases: {low: {f0: 220}, mid: {f0: 420}, high: {f0: 760, hardness: .9}},
  variants: 4,
  render(p, R, sr) {
    const n = Math.round(.5 * sr), tc = .003 - .0025 * p.hardness;                    // harder = shorter contact = brighter
    const modes = modesFrom({f0: p.f0, ratios: [1, 2.76, 5.40, 8.93], amps: [1, .5, .3, .15], q: 40, hiDamp: .6, jitter: .01, R});
    const out = modal(halfSine(tc, sr), modes, sr, n);
    add(out, burst(.03, sr, R, {d: .004, color: 'pink', bp: 2500, q: .8}), 0, .25);   // the residue
    return out;
  },
  criteria: {'*': {attackMs: [0, 4], t60Ms: [40, 600], clickEnd: [0, .01]}},
  notes: 'modal synthesis (van den Doel; Cook, Real Sound Synthesis)',
};
