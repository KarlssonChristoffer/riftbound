// WESTERN BANK WORKER: renders the desert band's instruments (western_dsp.js) off the main thread. OWNER: music.
// western.js posts one message per note {id, fn, sr, f, kind, seed} and gets {id, data: Float32Array, f0} back (the
// array transferred). Each job carries its own seed, so a bank is the same whichever thread renders it.
import {mulberry32} from '../core/rng.js';
import {renderGuitar, renderTwang, renderMute, renderHarmonic, renderTremolo, renderReed, renderBell, renderPerc} from './western_dsp.js';

const FN = {renderGuitar, renderTwang, renderMute, renderHarmonic, renderTremolo, renderReed, renderBell};
self.onmessage = e => {
  const {id, fn, sr, f, kind, seed} = e.data, R = mulberry32(seed);
  const r = fn === 'renderPerc' ? renderPerc(sr, kind, R) : FN[fn](sr, f, R);
  self.postMessage({id, data: r.data, f0: r.f0}, [r.data.buffer]);
};
