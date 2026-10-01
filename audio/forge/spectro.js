// FORGE SPECTROGRAM: a picture of a sound for review (by the AI designer or by eye). Shared by Node (PNG files) and the
// browser (canvas ImageData). Layout, top to bottom:
//   - a waveform strip (WAVE_H px): min/max per column, with a -6 dB guide line
//   - the spectrogram: log frequency 30 Hz .. sr/2 (low at the bottom), ABSOLUTE dBFS colour scale -100 .. -10 dB
//     (sounds are loudness-normalised before this, so brightness can be compared across images)
//   - dim guide lines at 100 Hz, 1 kHz and 10 kHz, and a tick every 100 ms (every 1 s for sounds longer than 3 s)
// spectrogramImage(ch, sr, {width, height}) -> {width, height, data: Uint8ClampedArray RGBA}

import {stft} from './metrics.js';

export const WAVE_H = 56;
const FMIN = 30, DB_LO = -100, DB_HI = -10;
function magma(u) {   // compact magma-like ramp
  const stops = [[0, 4, 4, 18], [.2, 60, 15, 110], [.4, 140, 40, 130], [.6, 220, 80, 100], [.8, 250, 160, 90], [1, 252, 250, 190]];
  u = Math.min(1, Math.max(0, u)); let i = 0; while (i < stops.length - 2 && u > stops[i + 1][0]) i++;
  const [a, ...ca] = stops[i], [b, ...cb] = stops[i + 1], t = (u - a) / (b - a);
  return ca.map((c, k) => c + (cb[k] - c) * t);
}
export function spectrogramImage(ch, sr, {width = 640, height = 300} = {}) {
  const x = Array.isArray(ch) ? (ch.length === 1 ? ch[0] : ch[0].map((v, i) => (v + ch[1][i]) * .5)) : ch;
  const W = width, H = height, SH = H - WAVE_H, data = new Uint8ClampedArray(W * H * 4);
  const set = (px, py, [r, g, b]) => { const o = (py * W + px) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255; };
  for (let i = 0; i < W * H; i++) { data[i * 4] = 14; data[i * 4 + 1] = 13; data[i * 4 + 2] = 18; data[i * 4 + 3] = 255; }
  // waveform
  const spc = x.length / W, mid = WAVE_H / 2, g6 = Math.round(mid * .5);
  for (let px = 0; px < W; px++) {
    let lo = 0, hi = 0; for (let i = Math.floor(px * spc); i < Math.min(x.length, Math.floor((px + 1) * spc) + 1); i++) { if (x[i] < lo) lo = x[i]; if (x[i] > hi) hi = x[i]; }
    const y0 = Math.round(mid - hi * (mid - 2)), y1 = Math.round(mid - lo * (mid - 2));
    for (let py = Math.max(0, y0); py <= Math.min(WAVE_H - 2, y1); py++) set(px, py, [120, 170, 210]);
    set(px, mid - g6, [45, 45, 58]); set(px, mid + g6, [45, 45, 58]); set(px, WAVE_H - 1, [30, 30, 38]);
  }
  // spectrogram: choose the hop so there is about one frame per column
  const n = x.length / sr < 1.5 ? 1024 : 2048, hop = Math.max(32, Math.floor(x.length / W)), S = stft(x, sr, {n, hop}), fmax = sr / 2, lf0 = Math.log(FMIN), lf1 = Math.log(fmax);
  const rowF = new Float32Array(SH); for (let r = 0; r < SH; r++) rowF[r] = Math.exp(lf1 - (lf1 - lf0) * (r + .5) / SH);
  for (let px = 0; px < W; px++) {
    const fi = Math.min(S.mags.length - 1, Math.floor(px * (x.length / W) / hop)), m = S.mags[Math.max(0, fi)];
    for (let r = 0; r < SH; r++) {
      const kf = rowF[r] / sr * n, k0 = Math.floor(kf), t = kf - k0, v = (m[k0] || 0) * (1 - t) + (m[k0 + 1] || 0) * t;
      set(px, WAVE_H + r, magma((20 * Math.log10(v + 1e-12) - DB_LO) / (DB_HI - DB_LO)));
    }
  }
  // guides
  const dur = x.length / sr, tick = dur > 3 ? 1 : .1;
  for (const f of [100, 1000, 10000]) if (f < fmax) { const r = Math.round((lf1 - Math.log(f)) / (lf1 - lf0) * SH); for (let px = 0; px < W; px += 3) set(px, WAVE_H + r, [90, 90, 110]); }
  for (let t = tick; t < dur; t += tick) { const px = Math.round(t / dur * W); for (let py = 0; py < H; py += 4) set(Math.min(W - 1, px), py, [70, 70, 90]); }
  return {width: W, height: H, data};
}
